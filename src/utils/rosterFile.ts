/**
 * rosterFile — định dạng file BẢNG KÊ (bangke.json) đi kèm ứng dụng.
 *
 * Dạng GỌN để nhẹ: xã / địa bàn khai báo một lần, mỗi hộ là một mảng cột (không lặp tên cột, tên xã, tên địa bàn...).
 * Đo thực tế bằng hàm này: ~75 byte/hộ (16.440 hộ ≈ 1,17 MB; nén gzip ≈ 0,14 MB).
 *
 * Mã hộ (id) suy ra từ địa bàn + số thứ tự trong địa bàn; chỉ ghi rõ id khi không theo quy tắc đó (dữ liệu cũ).
 */
export const ROSTER_FILE_FORMAT = 'tnh-bangke';
export const ROSTER_FILE_VERSION = 1;

/** thứ tự cột của mỗi hộ trong file */
export const ROSTER_COLS = ['a', 'id', 'n', 'g', 'name', 'addr', 'tel', 'mem', 'work', 'sc', 'sec', 'dp', 'note'] as const;

export interface RosterFile {
  format: typeof ROSTER_FILE_FORMAT;
  version: number;
  /** phiên bản = thời điểm xuất (ISO). File mới hơn thì máy người dùng tự nhận. */
  v: string;
  generatedBy?: string;
  counts?: { communes: number; areas: number; households: number };
  sectors: string[];
  communes: any[];
  areas: any[];
  cols: string[];
  hh: any[][];
}

export interface RosterDocLike { id: string; areaId: string; communeId?: string; households: any[] }

export const deriveHouseholdId = (communeId: string, areaCode: string, seq: number) => `hh-${communeId}-${areaCode}-${seq}`;
const SAMPLE_OFFICIAL = 'CHÍNH THỨC', SAMPLE_RESERVE = 'DỰ PHÒNG';

/** Gom bảng kê hiện có thành file gọn. `docs` là các địa bàn (mỗi địa bàn một danh sách hộ). */
export function buildRosterFile(
  data: { communes: any[]; areas: any[]; docs: RosterDocLike[] }, by: string, v: string = new Date().toISOString(),
): RosterFile {
  const sectors: string[] = []; const secIdx = new Map<string, number>();
  const communeById = new Map<string, any>(data.communes.map(c => [c.id, c]));
  const areaById = new Map<string, any>(data.areas.map(a => [a.id, a]));
  const outAreas: any[] = []; const areaIndex = new Map<string, number>();
  const outCommunes: any[] = []; const communeSeen = new Set<string>();
  const hh: any[][] = [];

  const docs = [...data.docs].filter(d => d.households.length > 0).sort((x, y) => x.areaId.localeCompare(y.areaId));
  for (const d of docs) {
    const first = d.households[0];
    const communeId = d.communeId || first.communeId;
    if (!communeSeen.has(communeId)) {
      communeSeen.add(communeId);
      const c = communeById.get(communeId) || { id: communeId, communeCode: first.communeCode, communeName: first.communeName, tkcsCode: first.tkcsCode, tkcsName: first.tkcsName };
      outCommunes.push(c);
    }
    const ar = areaById.get(d.areaId) || { id: d.areaId, communeId, code: first.areaCode, name: first.sheetName || first.areaName };
    const entry: any = { ...ar, communeId };
    if (first.sheetName && first.sheetName !== ar.name) entry.sn = first.sheetName;
    if (first.areaName && first.areaName !== ar.name) entry.an = first.areaName;
    areaIndex.set(d.areaId, outAreas.length); outAreas.push(entry);
    const a = areaIndex.get(d.areaId)!;

    d.households.forEach((h, i) => {
      const seq = i + 1;
      const explicitId = h.id !== deriveHouseholdId(communeId, ar.code, seq) ? h.id : 0;
      let sec = 0;
      if (h.sectorName) { if (!secIdx.has(h.sectorName)) { secIdx.set(h.sectorName, sectors.length); sectors.push(h.sectorName); } sec = secIdx.get(h.sectorName)! + 1; }
      const dp = h.sampleStatus === SAMPLE_RESERVE ? 1 : (h.sampleStatus === SAMPLE_OFFICIAL || !h.sampleStatus) ? 0 : h.sampleStatus;
      const row: any[] = [a, explicitId, h.sttMau ?? '', h.sttGoc ?? '', h.householdHead ?? '', h.address ?? '', h.phone ?? '', h.membersCount ?? 0, h.workingMembersCount ?? 0, h.sectorCode ?? 0, sec, dp, h.note ?? ''];
      while (row.length > 5 && (row[row.length - 1] === '' || row[row.length - 1] === 0)) row.pop();       // bỏ cột cuối còn mặc định cho gọn
      hh.push(row);
    });
  }
  return {
    format: ROSTER_FILE_FORMAT, version: ROSTER_FILE_VERSION, v, generatedBy: by,
    counts: { communes: outCommunes.length, areas: outAreas.length, households: hh.length },
    sectors, communes: outCommunes, areas: outAreas, cols: [...ROSTER_COLS], hh,
  };
}

/** Mở file gọn ra thành các địa bàn đầy đủ trường như App dùng. */
export function expandRosterFile(file: RosterFile): { docs: RosterDocLike[]; communes: any[]; areas: any[] } {
  const communeById = new Map<string, any>(file.communes.map(c => [c.id, c]));
  const seq = new Map<number, number>();
  const byArea = new Map<number, any[]>();
  for (const row of file.hh) {
    const [a, id, n, g, name, addr, tel, mem, work, sc, sec, dp, note] = row;
    const ar = file.areas[a]; const c = communeById.get(ar.communeId) || {};
    const s = (seq.get(a) || 0) + 1; seq.set(a, s);
    const h: any = {
      id: id || deriveHouseholdId(ar.communeId, ar.code, s),
      communeId: ar.communeId, tkcsCode: c.tkcsCode, tkcsName: c.tkcsName, communeCode: c.communeCode, communeName: c.communeName,
      areaId: ar.id, areaCode: ar.code, areaName: ar.an ?? ar.name, sheetName: ar.sn ?? ar.name,
      sttMau: String(n ?? ''), sttGoc: String(g ?? ''), householdHead: name ?? '', address: addr ?? '', phone: tel ?? '',
      membersCount: mem ?? 0, workingMembersCount: work ?? 0, sectorCode: sc ?? 0,
      sampleStatus: dp === 1 ? SAMPLE_RESERVE : (!dp ? SAMPLE_OFFICIAL : dp),
    };
    if (sec) h.sectorName = file.sectors[sec - 1];
    if (note) h.note = note;
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    (byArea.get(a) || byArea.set(a, []).get(a)!).push(h);
  }
  const docs: RosterDocLike[] = Array.from(byArea.entries()).map(([a, households]) => ({ id: file.areas[a].id, areaId: file.areas[a].id, communeId: file.areas[a].communeId, households }));
  const areas = file.areas.map(({ sn, an, ...rest }) => rest);
  return { docs, communes: file.communes, areas };
}

export function parseRosterFile(text: string): RosterFile {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error('File hỏng, không đọc được (không phải JSON hợp lệ).'); }
  if (!j || j.format !== ROSTER_FILE_FORMAT) throw new Error('Đây không phải file bảng kê bangke.json của phần mềm này.');
  if (j.version > ROSTER_FILE_VERSION) throw new Error('File do phiên bản phần mềm mới hơn tạo ra.');
  if (!Array.isArray(j.hh) || !Array.isArray(j.areas) || !Array.isArray(j.communes)) throw new Error('File thiếu dữ liệu bảng kê.');
  return j as RosterFile;
}

export const serializeRosterFile = (f: RosterFile) => JSON.stringify(f);

/** Dung lượng thô (byte) khi lưu file. */
export const rosterFileBytes = (f: RosterFile) => new Blob([serializeRosterFile(f)]).size;
