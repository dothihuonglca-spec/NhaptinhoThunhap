/**
 * areaSync — trao đổi dữ liệu giữa Admin và Điều tra viên (ĐTV) bằng file, không qua Firestore.
 *
 *   Admin  --(ASSIGN: bảng kê của địa bàn)-->  ĐTV
 *   ĐTV    --(RESULT: chỉ hộ mới làm/mới sửa)-->  Admin
 *
 * Tên file = ID địa bàn = mã xã + mã địa bàn  (VD: xã 11953, địa bàn 001  =>  11953001.json)
 */
import JSZip from 'jszip';
import type { Household, SurveyArea, Commune } from '../App';
import { importEntryRows, isBlankQuestionnaire, isHouseholdDirty, markHouseholdsExported } from './dataStore';

export const PACKAGE_FORMAT = 'tnh-area-package';
export const PACKAGE_VERSION = 1;

/** Chỉ còn gói KẾT QUẢ (phiếu đã nhập). Gói 'ASSIGN' của bản cũ không dùng nữa vì bảng kê nay nằm trên Firebase. */
export type PackageKind = 'ASSIGN' | 'RESULT';

export interface AreaPackage {
  format: typeof PACKAGE_FORMAT;
  version: number;
  kind: PackageKind;
  /** ID địa bàn = mã xã + mã địa bàn */
  areaId: string;
  communeCode: string;
  communeName: string;
  tkcsCode: string;
  tkcsName: string;
  areaCode: string;
  areaName: string;
  surveyorId?: string;
  surveyorName?: string;
  surveyorCode?: string;
  exportedAt: string;
  exportedBy: string;
  /** chỉ có khi kind = ASSIGN, để máy ĐTV tạo được xã và địa bàn */
  commune?: Commune;
  area?: SurveyArea;
  /** RESULT: true nếu là bản xuất toàn bộ địa bàn, false nếu chỉ phần thay đổi */
  full?: boolean;
  households: Household[];
}

/**
 * Hộ đã có dữ liệu phiếu nhập: có nội dung phiếu, hoặc đã nhập số nhân khẩu, hoặc trạng thái khác "chưa nhập".
 * Hộ chưa nhập gì chỉ là một dòng của bảng kê nên không đưa vào file kết quả của ĐTV.
 */
const ENTERED_STATUS = new Set(['DANG_NHAP', 'HOAN_THANH', 'DA_HOAN_THANH', 'DA_DUYET', 'COMPLETED', 'IN_PROGRESS']);
export const hasEnteredData = (h: Household): boolean =>
  !isBlankQuestionnaire((h as any).questionnaire) || !!h.membersCountEntered || ENTERED_STATUS.has(String(h.surveyStatus || ''));

/* ------------------------------------------------------------------ gom nhóm theo ID địa bàn */

export const makeAreaId = (communeCode?: string, areaCode?: string) =>
  `${(communeCode || '').trim()}${(areaCode || '').trim()}`;

export interface AreaGroup {
  areaId: string;
  communeCode: string;
  areaCode: string;
  communeName: string;
  tkcsCode: string;
  tkcsName: string;
  areaName: string;
  area?: SurveyArea;
  commune?: Commune;
  households: Household[];
  surveyorId?: string;
  surveyorName?: string;
  /** mọi ĐTV được ghi trên các hộ của địa bàn (đúng ra chỉ có 1) */
  surveyorIds: string[];
  total: number;
  withData: number;
  dirty: number;
}

export function buildAreaGroups(households: Household[], areas: SurveyArea[], communes: Commune[]): AreaGroup[] {
  const communeById = new Map(communes.map(c => [c.id, c]));
  const communeByCode = new Map(communes.filter(c => c.communeCode).map(c => [c.communeCode, c]));
  const areaById = new Map(areas.map(a => [a.id, a]));
  const map = new Map<string, AreaGroup>();

  for (const h of households) {
    const commune = communeById.get(h.communeId) || communeByCode.get(h.communeCode);
    const communeCode = (h.communeCode || commune?.communeCode || '').trim();
    const areaCode = (h.areaCode || '').trim();
    if (!communeCode || !areaCode) continue; // không xác định được ID địa bàn
    const areaId = makeAreaId(communeCode, areaCode);
    let g = map.get(areaId);
    if (!g) {
      g = {
        areaId, communeCode, areaCode,
        communeName: h.communeName || commune?.communeName || '',
        tkcsCode: h.tkcsCode || commune?.tkcsCode || '',
        tkcsName: h.tkcsName || commune?.tkcsName || '',
        areaName: h.areaName || h.sheetName || `Địa bàn ${areaCode}`,
        area: areaById.get(h.areaId),
        commune,
        households: [], surveyorIds: [], total: 0, withData: 0, dirty: 0,
      };
      map.set(areaId, g);
    }
    g.households.push(h);
    g.total++;
    if (hasEnteredData(h)) { g.withData++; if (isHouseholdDirty(h)) g.dirty++; }   // dirty = phiếu đã nhập mà chưa xuất / mới sửa
    if (h.assignedSurveyorId && !g.surveyorIds.includes(h.assignedSurveyorId)) g.surveyorIds.push(h.assignedSurveyorId);
    if (!g.surveyorId && h.assignedSurveyorId) { g.surveyorId = h.assignedSurveyorId; g.surveyorName = h.assignedSurveyorName; }
  }
  return Array.from(map.values()).sort((a, b) => a.areaId.localeCompare(b.areaId));
}

/** Địa bàn thuộc phạm vi phân quyền của một tài khoản (so khớp theo id nội bộ, id cũ dạng communeId_code, hoặc ID địa bàn mới). */
export function groupsOfSurveyor(assigned: string[] | undefined, groups: AreaGroup[]): AreaGroup[] {
  const set = new Set(assigned || []);
  if (set.has('ALL')) return groups;
  return groups.filter(g =>
    set.has(g.areaId) ||
    (g.area && (set.has(g.area.id) || set.has(`${g.area.communeId}_${g.area.code}`))));
}

/* ------------------------------------------------------------------ xuất */

export interface ExportedFile { name: string; content: string; areaId: string; count: number; householdIds: string[] }

export function buildPackage(
  g: AreaGroup, kind: PackageKind,
  opts: { by: string; full?: boolean; surveyorId?: string; surveyorName?: string; surveyorCode?: string },
): AreaPackage | null {
  const rows = kind === 'RESULT'
    ? g.households.filter(h => hasEnteredData(h) && (opts.full || isHouseholdDirty(h)))   // chỉ phiếu đã nhập (mới sửa nếu không xuất toàn bộ)
    : g.households;
  if (rows.length === 0) return null;
  const pkg: AreaPackage = {
    format: PACKAGE_FORMAT, version: PACKAGE_VERSION, kind,
    areaId: g.areaId, communeCode: g.communeCode, communeName: g.communeName,
    tkcsCode: g.tkcsCode, tkcsName: g.tkcsName, areaCode: g.areaCode, areaName: g.areaName,
    surveyorId: opts.surveyorId ?? g.surveyorId, surveyorName: opts.surveyorName ?? g.surveyorName, surveyorCode: opts.surveyorCode,
    exportedAt: new Date().toISOString(), exportedBy: opts.by,
    full: kind === 'RESULT' ? !!opts.full : undefined,
    households: rows,
  };
  return pkg;
}

export function buildFiles(
  groups: AreaGroup[], kind: PackageKind,
  opts: { by: string; full?: boolean; surveyorId?: string; surveyorName?: string; surveyorCode?: string },
): ExportedFile[] {
  const files: ExportedFile[] = [];
  for (const g of groups) {
    const pkg = buildPackage(g, kind, opts);
    if (!pkg) continue;
    files.push({ name: `${g.areaId}.json`, content: JSON.stringify(pkg), areaId: g.areaId, count: pkg.households.length, householdIds: pkg.households.map(h => h.id) });
  }
  return files;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 1 file => tải thẳng {ID địa bàn}.json ; nhiều file => nén zip, bên trong vẫn là {ID địa bàn}.json */
export async function downloadFiles(files: ExportedFile[], zipName: string) {
  if (files.length === 0) return;
  if (files.length === 1) {
    saveBlob(new Blob([files[0].content], { type: 'application/json' }), files[0].name);
    return;
  }
  const zip = new JSZip();
  files.forEach(f => zip.file(f.name, f.content));
  saveBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), zipName);
}

/** ĐTV xuất kết quả; sau khi tải xong thì đánh dấu các hộ là đã xuất. */
export async function exportResultAndMark(groups: AreaGroup[], by: string, full: boolean, zipName: string) {
  const files = buildFiles(groups, 'RESULT', { by, full });
  await downloadFiles(files, zipName);
  await markHouseholdsExported(files.flatMap(f => f.householdIds)); // xuất (kể cả toàn bộ) đều coi là đã đồng bộ
  return files;
}

/* ------------------------------------------------------------------ đọc file */

export interface ReadResult { items: { fileName: string; pkg: AreaPackage }[]; errors: string[] }

function validate(pkg: any): string | null {
  if (!pkg || pkg.format !== PACKAGE_FORMAT) return 'không phải file dữ liệu của phần mềm này';
  if (pkg.version > PACKAGE_VERSION) return 'file do phiên bản phần mềm mới hơn tạo ra';
  if (pkg.kind !== 'ASSIGN' && pkg.kind !== 'RESULT') return 'thiếu loại gói (ASSIGN/RESULT)';
  if (!pkg.areaId || !Array.isArray(pkg.households)) return 'thiếu ID địa bàn hoặc danh sách hộ';
  return null;
}

export async function readPackageFiles(files: File[]): Promise<ReadResult> {
  const items: ReadResult['items'] = []; const errors: string[] = [];
  const push = (name: string, text: string) => {
    try {
      const pkg = JSON.parse(text);
      const err = validate(pkg);
      if (err) errors.push(`${name}: ${err}`); else items.push({ fileName: name, pkg });
    } catch { errors.push(`${name}: file hỏng hoặc không đọc được`); }
  };
  for (const f of files) {
    const label = (f as any).webkitRelativePath || f.name;
    if (/\.zip$/i.test(f.name)) {
      try {
        const zip = await JSZip.loadAsync(await f.arrayBuffer());
        const entries = Object.values(zip.files).filter(e => !e.dir && /\.json$/i.test(e.name));
        if (entries.length === 0) errors.push(`${label}: không có file .json bên trong`);
        for (const e of entries) push(`${label} › ${e.name}`, await e.async('string'));
      } catch { errors.push(`${label}: không giải nén được`); }
    } else if (/\.json$/i.test(f.name)) {
      push(label, await f.text());
    } else {
      errors.push(`${label}: chỉ nhận .json hoặc .zip`);
    }
  }
  return { items, errors };
}

/* ------------------------------------------------------------------ nhập */

const compKey = (areaId: string, h: any) => `${areaId}|${h.sttGoc ?? ''}|${h.sttMau ?? ''}`;

/* ------------------------------------------------------------------ admin: nhập cả thư mục kết quả */

export interface AreaImportPlan {
  areaId: string;
  files: string[];
  surveyorNames: string[];
  /** số hộ trong file(s) sau khi gộp bản trùng giữa các file */
  incoming: number;
  /** số bản trùng giữa nhiều file (chỉ giữ bản mới nhất) */
  duplicatesAcrossFiles: number;
  /** ghi bình thường: hộ chưa có ở máy này, hoặc hộ ở máy này chưa có dữ liệu nhập */
  fresh: Household[];
  unchanged: number;
  /** máy này ĐÃ có dữ liệu nhập khác với trong file => phải hỏi có ghi đè không */
  conflicts: { row: Household; name: string; incomingNewer: boolean }[];
  /** số hộ của địa bàn này đã có dữ liệu nhập ở máy này (để thông báo) */
  existingWithData: number;
  /** hộ có trong file nhưng không có trong bảng kê trên Firebase (bỏ qua) */
  missingInRoster: number;
  invalid: number;
  /** các file bị chặn (sai người gửi...) kèm lý do */
  rejected: { file: string; reason: string }[];
}

const contentSig = (h: any) => JSON.stringify([h.questionnaire ?? null, h.surveyStatus ?? '', h.membersCount ?? 0, h.workingMembersCount ?? 0, !!h.membersCountEntered]);

/**
 * Gộp nhiều file (nhiều ĐTV, nhiều lần xuất) theo từng ID địa bàn rồi so với dữ liệu hiện có:
 *  - hộ chưa có dữ liệu ở máy này  -> "ghi bình thường" (fresh)
 *  - hộ đã có dữ liệu, giống nhau   -> không đổi
 *  - hộ đã có dữ liệu, khác nhau    -> "trùng" => admin quyết định ghi đè hay không
 * Cùng một hộ có trong nhiều file: lấy bản có thời điểm sửa mới nhất.
 */
export function planFolderImport(
  items: ReadResult['items'], existing: Household[], opts: { ignoreOwner?: boolean } = {},
): AreaImportPlan[] {
  const byId = new Map(existing.map(h => [h.id, h]));
  const byComp = new Map<string, Household>();
  const dataInArea = new Map<string, number>();
  existing.forEach(h => {
    const aid = makeAreaId(h.communeCode, h.areaCode);
    byComp.set(compKey(aid, h), h);
    if (hasEnteredData(h)) dataInArea.set(aid, (dataInArea.get(aid) || 0) + 1);
  });
  const ownerOf = new Map<string, { id: string; name?: string }>();
  existing.forEach(h => {
    const aid = makeAreaId(h.communeCode, h.areaCode);
    if (h.assignedSurveyorId && !ownerOf.has(aid)) ownerOf.set(aid, { id: h.assignedSurveyorId, name: h.assignedSurveyorName });
  });

  const plans = new Map<string, AreaImportPlan>();
  const best = new Map<string, Map<string, { h: Household; at: string }>>();   // areaId -> hộ -> bản mới nhất

  for (const { fileName, pkg } of items) {
    if (pkg.kind !== 'RESULT') continue;
    let plan = plans.get(pkg.areaId);
    if (!plan) {
      plan = { areaId: pkg.areaId, files: [], surveyorNames: [], incoming: 0, duplicatesAcrossFiles: 0, fresh: [], unchanged: 0, conflicts: [], existingWithData: dataInArea.get(pkg.areaId) || 0, missingInRoster: 0, invalid: 0, rejected: [] };
      plans.set(pkg.areaId, plan); best.set(pkg.areaId, new Map());
    }
    const owner = ownerOf.get(pkg.areaId);
    if (!opts.ignoreOwner && owner && pkg.surveyorId && owner.id !== pkg.surveyorId) {
      plan.rejected.push({ file: fileName, reason: `địa bàn đang phân cho "${owner.name || owner.id}" nhưng file do "${pkg.surveyorName || pkg.surveyorId}" gửi` });
      continue;
    }
    plan.files.push(fileName);
    if (pkg.surveyorName && !plan.surveyorNames.includes(pkg.surveyorName)) plan.surveyorNames.push(pkg.surveyorName);
    const m = best.get(pkg.areaId)!;
    for (const inc of pkg.households) {
      if (makeAreaId(inc.communeCode || pkg.communeCode, inc.areaCode || pkg.areaCode) !== pkg.areaId) { plan.invalid++; continue; }
      const key = byId.has(inc.id) ? inc.id : (byComp.get(compKey(pkg.areaId, inc))?.id || inc.id);
      const at = (inc as any).localUpdatedAt || '';
      const prev = m.get(key);
      if (prev) { plan.duplicatesAcrossFiles++; if (at <= prev.at) continue; }
      m.set(key, { h: { ...inc, id: key }, at });
    }
  }

  for (const [areaId, plan] of plans) {
    for (const { h: inc } of best.get(areaId)!.values()) {
      plan.incoming++;
      const cur = byId.get(inc.id) || byComp.get(compKey(areaId, inc));
      const name = inc.householdHead || inc.id;
      if (!cur) { plan.missingInRoster++; continue; }     // bảng kê (Firebase) không có hộ này: không ghi, chỉ báo
      // giữ phân công của admin
      const row: Household = { ...inc, id: cur.id, assignedSurveyorId: cur.assignedSurveyorId ?? inc.assignedSurveyorId, assignedSurveyorName: cur.assignedSurveyorName ?? inc.assignedSurveyorName };
      if (!hasEnteredData(cur)) { plan.fresh.push(row); continue; }
      const a = (inc as any).localUpdatedAt || '', b = (cur as any).localUpdatedAt || '';
      if ((a && a === b) || contentSig(inc) === contentSig(cur)) { plan.unchanged++; continue; }
      plan.conflicts.push({ row, name, incomingNewer: a > b });
    }
  }
  return Array.from(plans.values()).sort((x, y) => x.areaId.localeCompare(y.areaId));
}

export async function applyFolderPlan(plans: AreaImportPlan[], overwriteAreas: Set<string>) {
  const writes: Household[] = []; let overwritten = 0, skipped = 0, fresh = 0;
  for (const p of plans) {
    fresh += p.fresh.length; writes.push(...p.fresh);
    if (overwriteAreas.has(p.areaId)) { overwritten += p.conflicts.length; writes.push(...p.conflicts.map(c => c.row)); }
    else skipped += p.conflicts.length;
  }
  // phiếu nhập chỉ ghi vào trình duyệt (không đụng bảng kê trên Firebase)
  if (writes.length) await importEntryRows(writes as any[]);
  return { fresh, overwritten, skipped };
}
