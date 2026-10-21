/**
 * fullBackup — sao lưu / khôi phục PHIẾU ĐÃ NHẬP của trình duyệt này.
 * (Bảng kê và phân quyền nằm trên Firebase nên không cần sao lưu ở đây; phiếu nhập chỉ nằm trong trình duyệt,
 *  nên cần sao lưu định kỳ và dùng khi đổi máy / đổi trình duyệt.)
 * File: .zip chứa một file backup.json.
 */
import JSZip from 'jszip';
import type { Household } from '../App';
import { ENTRY_FIELDS, importEntryRows, wipeEntries } from './dataStore';
import { hasEnteredData } from './areaSync';

export const BACKUP_FORMAT = 'tnh-entries-backup';
export const BACKUP_VERSION = 1;

export interface EntriesBackup {
  format: typeof BACKUP_FORMAT; version: number;
  exportedAt: string; exportedBy: string;
  counts: { entries: number; areas: number };
  entries: any[];
}

const pad = (n: number) => String(n).padStart(2, '0');
export const backupFileName = (d = new Date()) =>
  `PHIEU_DA_NHAP_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.zip`;

export async function buildEntriesBackup(households: Household[], by: string): Promise<{ blob: Blob; name: string; counts: EntriesBackup['counts'] }> {
  const rows = households.filter(hasEnteredData).map(h => {
    const e: any = { id: h.id, areaKey: `${h.communeCode || ''}${h.areaCode || ''}`, householdHead: h.householdHead, sttMau: h.sttMau };
    for (const k of ENTRY_FIELDS) if ((h as any)[k] !== undefined) e[k] = (h as any)[k];
    e.localUpdatedAt = (h as any).localUpdatedAt;
    return e;
  });
  const counts = { entries: rows.length, areas: new Set(rows.map(r => r.areaKey)).size };
  const backup: EntriesBackup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), exportedBy: by, counts, entries: rows };
  const zip = new JSZip();
  zip.file('backup.json', JSON.stringify(backup));
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }), name: backupFileName(), counts };
}

export async function readBackupFile(file: File): Promise<EntriesBackup> {
  let text: string;
  if (/\.zip$/i.test(file.name)) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entry = zip.file('backup.json') || Object.values(zip.files).find(e => !e.dir && /\.json$/i.test(e.name));
    if (!entry) throw new Error('Không thấy file backup.json trong file zip.');
    text = await entry.async('string');
  } else if (/\.json$/i.test(file.name)) text = await file.text();
  else throw new Error('Chỉ nhận file .zip hoặc .json.');
  let b: any;
  try { b = JSON.parse(text); } catch { throw new Error('File hỏng, không đọc được.'); }
  if (!b || b.format !== BACKUP_FORMAT) throw new Error('Đây không phải file sao lưu phiếu đã nhập của phần mềm này.');
  if (b.version > BACKUP_VERSION) throw new Error('File do phiên bản phần mềm mới hơn tạo ra.');
  return b as EntriesBackup;
}

export type RestoreMode = 'merge' | 'replace';

export interface RestorePlan {
  mode: RestoreMode;
  added: number; updated: number; same: number; keptLocalNewer: number; missingInRoster: number;
  writes: any[];
}

/**
 * Gộp: hộ nào chưa có phiếu thì thêm; đã có phiếu thì bản có thời điểm sửa mới hơn được giữ.
 * Thay toàn bộ: xóa phiếu đang có trên máy này rồi nạp từ file.
 * Hộ không có trong bảng kê trên Firebase thì bỏ qua (đếm lại).
 */
export function planRestore(b: EntriesBackup, households: Household[], mode: RestoreMode): RestorePlan {
  const cur = new Map(households.map(h => [h.id, h]));
  const p: RestorePlan = { mode, added: 0, updated: 0, same: 0, keptLocalNewer: 0, missingInRoster: 0, writes: [] };
  for (const inc of b.entries) {
    const c = cur.get(inc.id);
    if (!c) { p.missingInRoster++; continue; }
    if (mode === 'replace' || !hasEnteredData(c)) { p.added++; p.writes.push(inc); continue; }
    const a = inc.localUpdatedAt || '', l = (c as any).localUpdatedAt || '';
    if (a === l) p.same++;
    else if (a > l) { p.updated++; p.writes.push(inc); }
    else p.keptLocalNewer++;
  }
  return p;
}

export async function applyRestore(plan: RestorePlan) {
  if (plan.mode === 'replace') await wipeEntries();
  const r = await importEntryRows(plan.writes);
  return r.written;
}
