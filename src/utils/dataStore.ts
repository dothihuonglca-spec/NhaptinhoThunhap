/**
 * dataStore — lưu trữ "máy trước, Firebase sau"
 *
 *  FILE bangke.json (đi kèm ứng dụng, thư mục public/)
 *    - BẢNG KÊ (hộ), danh mục xã, danh mục địa bàn. Không lên Firebase. Ứng dụng đọc file này rồi chép vào bộ nhớ
 *      của trình duyệt; từ đó đọc/ghi trực tiếp trên máy. Có file mới hơn (trường `v`) thì tự nhận.
 *
 *  FIREBASE (rất ít lượt đọc/ghi)
 *    - tài khoản, phòng ban (surveyors, departments ...)          — như cũ
 *    - PHÂN QUYỀN: MỘT tài liệu `surveys/assignments` (địa bàn → điều tra viên)   — mỗi lần mở app chỉ 1 lượt đọc
 *    - TIẾN ĐỘ: mỗi điều tra viên một tài liệu `surveys/progress_<id>`             — chỉ ghi khi có phiếu mới, gộp 20 giây
 *
 *  TRÌNH DUYỆT (IndexedDB)
 *    - PHIẾU NHẬP ('entries'): không bao giờ lên Firebase
 *    - bản chép của bảng kê / xã / địa bàn / phân quyền, hàng đợi thay đổi chờ gửi lên Firebase
 *
 * App.tsx vẫn dùng 'households', 'communes', 'surveyAreas' như collection Firestore bình thường; module này xuất lại
 * các hàm cùng tên với 'firebase/firestore' và tự định tuyến (các collection này nằm trên máy).
 */
import * as fs from 'firebase/firestore';
import { db as firestoreDb } from '../firebase';
import { createDefaultQuestionnaire } from '../types/questionnaire';
import { RosterDocLike, RosterFile, expandRosterFile, parseRosterFile } from './rosterFile';

/* ================================================================== trường phiếu nhập / trường bảng kê / trường phân quyền */

/** Các trường thuộc PHIẾU NHẬP (lưu cục bộ). */
export const ENTRY_FIELDS = ['surveyStatus', 'questionnaire', 'membersCountEntered', 'membersCount', 'workingMembersCount', 'updatedBy', 'updatedAt'] as const;
const ENTRY_SET = new Set<string>(ENTRY_FIELDS);
const STAMP_FIELDS = new Set<string>(['localUpdatedAt', 'exportedAt']);
/** Người phụ trách không nằm trong hàng bảng kê mà nằm trong bảng PHÂN QUYỀN (theo địa bàn). */
const OWNER_FIELDS = new Set<string>(['assignedSurveyorId', 'assignedSurveyorName']);

type Owner = { o: string; n: string };

/** Một thay đổi đã lưu trên máy, đang chờ gửi lên Firebase. */
type PendingItem =
  | { kind: 'assignOwner'; id: string; value: Owner | null }
  | { kind: 'assignOverride'; id: string; value: Owner | null }
  | { kind: 'progress'; id: 'progress'; data: any };
const pending = new Map<string, PendingItem>();
const pkey = (it: PendingItem) => (it.kind === 'progress' ? 'progress' : `${it.kind}/${it.id}`);

const clean = <T extends Record<string, any>>(o: T): T => {
  const out: any = {};
  for (const k of Object.keys(o)) if (o[k] !== undefined) out[k] = o[k];
  return out;
};
const sig = (v: any): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((a: any, k) => { a[k] = x[k]; return a; }, {}) : x);
const pickEntry = (e: any) => { const o: any = {}; for (const k of ENTRY_FIELDS) if (e[k] !== undefined) o[k] = e[k]; return o; };

/**
 * App gắn sẵn một phiếu MẶC ĐỊNH (rỗng) cho mọi hộ khi tải bảng kê và khi "xóa trắng phiếu".
 * Phiếu mặc định = chưa nhập gì (bỏ qua ngày/tên điều tra viên vì tự điền).
 */
let defaultQSig: string | null = null;
const stripQ = (q: any) => { if (!q || typeof q !== 'object') return q; const { surveyorDate, surveyorName, ...rest } = q; return rest; };
export const isBlankQuestionnaire = (q: any): boolean => {
  if (!q) return true;
  if (Object.keys(q).some(k => k.endsWith('_has') && q[k])) return false;      // có mục nào được tích => đã nhập
  defaultQSig ??= sig(stripQ(createDefaultQuestionnaire()));
  return sig(stripQ(q)) === defaultQSig;
};

export const isHouseholdDirty = (h: any): boolean =>
  !!h.localUpdatedAt && (!h.exportedAt || h.localUpdatedAt > h.exportedAt);

const ENTERED_STATUS = new Set(['DANG_NHAP', 'HOAN_THANH', 'DA_HOAN_THANH', 'DA_DUYET', 'COMPLETED', 'IN_PROGRESS']);
const DONE_STATUS = new Set(['HOAN_THANH', 'DA_HOAN_THANH', 'DA_DUYET', 'COMPLETED']);
const isEnteredRow = (h: any) => !isBlankQuestionnaire(h.questionnaire) || !!h.membersCountEntered || ENTERED_STATUS.has(String(h.surveyStatus || ''));

/* ================================================================== IndexedDB */

const DB_NAME = 'thongke_entries_v2';
const DB_VERSION = 3;
type Store = 'entries' | 'meta' | 'rosterCache' | 'colCache' | 'pendingWrites';
let idb: IDBDatabase | null = null;
let idbFailed = false;
const entries = new Map<string, any>();      // id hộ -> bản ghi phiếu nhập

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('rosterCache')) d.createObjectStore('rosterCache', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('colCache')) d.createObjectStore('colCache', { keyPath: 'k' });
      if (!d.objectStoreNames.contains('pendingWrites')) d.createObjectStore('pendingWrites', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const idbAll = (store: Store): Promise<any[]> => new Promise(resolve => {
  if (!idb) return resolve([]);
  const r = idb.transaction(store, 'readonly').objectStore(store).getAll();
  r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]);
});
/** ghi/xóa nhiều bản ghi trong MỘT giao dịch; clear=true thì xóa sạch kho trước khi ghi */
const idbWrite = (store: Store, puts: any[], dels: string[] = [], clear = false): Promise<void> => {
  if (!idb || (!clear && puts.length === 0 && dels.length === 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = idb!.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    if (clear) os.clear();
    puts.forEach(p => os.put(p)); dels.forEach(k => os.delete(k));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
};

export const storeReady: Promise<void> = (async () => {
  try {
    idb = await openIdb();
    (await idbAll('entries')).forEach(r => entries.set(r.id, r));
    (await idbAll('pendingWrites')).forEach(r => pending.set(r.k, r.item));
    try { await (navigator as any).storage?.persist?.(); } catch { /* không bắt buộc */ }
  } catch (e) {
    idbFailed = true;
    console.warn('IndexedDB không khả dụng — dữ liệu chỉ tồn tại trong phiên làm việc.', e);
  }
})();

export const isLocalStoreBroken = () => idbFailed;
const persistEntries = (puts: any[], dels: string[]) => idbWrite('entries', puts, dels);

export async function getMeta<T = any>(key: string): Promise<T | undefined> {
  await storeReady;
  if (!idb) return undefined;
  return new Promise(resolve => {
    const r = idb!.transaction('meta', 'readonly').objectStore('meta').get(key);
    r.onsuccess = () => resolve(r.result?.value); r.onerror = () => resolve(undefined);
  });
}
export async function setMeta(key: string, value: any): Promise<void> {
  await storeReady;
  await idbWrite('meta', [{ key, value }]).catch(() => {});
}

/* ================================================================== nguồn bên ngoài (thay được khi kiểm thử) */

/** Nơi lấy file bangke.json. Mặc định: tải file đi kèm ứng dụng. */
export interface RosterFileSource { load(): Promise<RosterFile | null> }
const defaultFileSource: RosterFileSource = {
  async load() {
    const base = (import.meta as any)?.env?.BASE_URL ?? '/';
    const r = await fetch(`${base}bangke.json`, { cache: 'no-cache' });     // no-cache: hỏi lại máy chủ, chưa đổi thì chỉ nhận 304 (gần như không tốn dữ liệu)
    if (!r.ok) return null;
    try { return parseRosterFile(await r.text()); } catch { return null; }   // máy chủ trả trang web thay vì file => coi như chưa có file
  },
};
let fileSource: RosterFileSource = defaultFileSource;
export const __setRosterFileSource = (s: RosterFileSource) => { fileSource = s; basePromise = null; };

export interface AssignDoc { v: string; accV?: string; owners: Record<string, Owner>; overrides: Record<string, Owner> }
/** Phân quyền trên Firebase: MỘT tài liệu. */
export interface AssignBackend {
  fetch(): Promise<AssignDoc | undefined>;
  /** giá trị null = xóa. Trả về phiên bản mới. */
  patch(p: { owners?: Record<string, Owner | null>; overrides?: Record<string, Owner | null>; accounts?: boolean }): Promise<string>;
}
const ASSIGN_REF = () => fs.doc(firestoreDb, 'surveys', 'assignments');          // 'surveys' đã có luật cho phép sẵn
const firestoreAssign: AssignBackend = {
  async fetch() {
    const d = await fs.getDoc(ASSIGN_REF());
    if (!d.exists()) return undefined;
    const x = d.data() as any;
    return { v: x.v || '', accV: x.accV, owners: x.owners || {}, overrides: x.overrides || {} };
  },
  async patch(p) {
    const v = new Date().toISOString();
    const wrap = (m?: Record<string, Owner | null>) => m && Object.fromEntries(Object.entries(m).map(([k, val]) => [k, val === null ? fs.deleteField() : val]));
    await fs.setDoc(ASSIGN_REF(), clean({ v, accV: p.accounts ? v : undefined, owners: wrap(p.owners), overrides: wrap(p.overrides) }), { merge: true });
    return v;
  },
};
let assignBackend: AssignBackend = firestoreAssign;
export const __setAssignBackend = (b: AssignBackend) => { assignBackend = b; };

/** Tài khoản + phòng ban trên Firebase: đọc/ghi qua cổng này (thay được khi kiểm thử). */
export interface AccountsIO {
  read(col: string): Promise<{ id: string; [k: string]: any }[]>;
  commit(ops: { type: 'set' | 'del'; col: string; id: string; data?: any; merge?: boolean }[]): Promise<void>;
}
const firestoreAccounts: AccountsIO = {
  async read(col) {
    const snap = await fs.getDocs(fs.collection(firestoreDb, col));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  },
  async commit(ops) {
    for (let i = 0; i < ops.length; i += 400) {
      const b = fs.writeBatch(firestoreDb);
      ops.slice(i, i + 400).forEach(o => {
        const ref = fs.doc(firestoreDb, o.col, o.id);
        if (o.type === 'set') b.set(ref, o.data, { merge: !!o.merge }); else b.delete(ref);
      });
      await b.commit();
    }
  },
};
let accountsIO: AccountsIO = firestoreAccounts;
export const __setAccountsIO = (io: AccountsIO) => { accountsIO = io; };

export interface ProgressDoc { surveyorId: string; updatedAt: string; areas: Record<string, { t: number; e: number; c: number; ap: number; at?: string }> }
/** Tiến độ trên Firebase: mỗi điều tra viên một tài liệu. */
export interface ProgressBackend {
  put(surveyorId: string, data: ProgressDoc): Promise<void>;
  getAll(): Promise<ProgressDoc[]>;
}
const firestoreProgress: ProgressBackend = {
  async put(id, data) { await fs.setDoc(fs.doc(firestoreDb, 'surveys', `progress_${id}`), data); },
  async getAll() {
    const q = fs.query(fs.collection(firestoreDb, 'surveys'), fs.where(fs.documentId(), '>=', 'progress_'), fs.where(fs.documentId(), '<', 'progress_\uf8ff'));
    return (await fs.getDocs(q)).docs.map(d => d.data() as ProgressDoc);
  },
};
let progressBackend: ProgressBackend = firestoreProgress;
export const __setProgressBackend = (b: ProgressBackend) => { progressBackend = b; };
let progressDebounceMs = 20000;
export const __setProgressDebounce = (ms: number) => { progressDebounceMs = ms; };

/* ================================================================== trạng thái (để giao diện báo lý do) */

export type RosterScope = { kind: 'none' } | { kind: 'all' } | { kind: 'owner'; id: string };
export type DataSource = 'none' | 'file' | 'local';

export interface RosterStatus {
  scope: RosterScope; loaded: boolean;
  error?: string; permissionDenied?: boolean;
  areaDocs: number; households: number;
  /** 'file' = đúng bản bangke.json; 'local' = bảng kê trên máy có chỉnh sửa/tải thêm chưa xuất ra file */
  source: DataSource;
  /** phiên bản bangke.json đang dùng (thời điểm xuất file) */
  fileVersion?: string;
  /** có bangke.json mới hơn nhưng máy này đang giữ bảng kê chưa xuất => chưa tự thay */
  fileBlocked?: string;
  /** lần cuối đọc phân quyền từ Firebase */
  assignAt?: string;
  /** số thay đổi (phân quyền / tiến độ) đã lưu trên máy nhưng chưa gửi lên Firebase */
  pending: number;
}

let rosterError: { message: string; denied: boolean } | undefined;
let rosterBase: { v: string; dirty: boolean } = { v: '', dirty: false };
let fileBlocked: string | undefined;
let assignAt: string | undefined;
const statusListeners = new Set<(s: RosterStatus) => void>();
const describeError = (e: any) => {
  const code = String(e?.code || '');
  const denied = code === 'permission-denied' || /permission|insufficient/i.test(String(e?.message || ''));
  const quota = code === 'resource-exhausted' || /quota|exhausted/i.test(String(e?.message || ''));
  return {
    denied,
    message: quota ? 'Firebase đã hết hạn ngạch trong ngày (resource-exhausted). Bảng kê và phiếu vẫn làm việc bình thường trên máy; phân quyền / tiến độ sẽ gửi sau.'
      : denied ? 'Firebase từ chối truy cập (permission-denied): luật Firestore chưa cho phép (cần luật cho collection "surveys").'
      : `Không kết nối được Firebase: ${e?.message || e}`,
  };
};

/* ================================================================== trạng thái bảng kê trong bộ nhớ */

interface RosterDoc { id: string; areaId: string; communeId?: string; households: any[] }

const rosterByArea = new Map<string, RosterDoc>();
const owners = new Map<string, Owner>();                                 // địa bàn -> người phụ trách
const overrides = new Map<string, Owner>();                              // hộ -> người phụ trách riêng (khác chủ địa bàn)
let assignV = '';
const rosterIndex = new Map<string, { areaId: string; row: any }>();    // id hộ -> dòng bảng kê (mọi hộ)
const mergedMap = new Map<string, any>();                                // id hộ -> hộ đã gộp (chỉ hộ người dùng được thấy)
let merged: any[] = [];
const mergedIndex = new Map<string, number>();

let scope: RosterScope = { kind: 'none' };
let rosterLoaded = false;
let loadedResolve: () => void = () => {};
let loadedPromise: Promise<void> = Promise.resolve();
let scopeSeq = 0;

const ownerOf = (areaId: string, hhId: string): Owner | undefined => overrides.get(hhId) ?? owners.get(areaId);

const mergeRow = (row: any, e: any) => {
  const h: any = { ...row };
  for (const k of ENTRY_FIELDS) if (e[k] !== undefined) h[k] = e[k];
  if (e.localUpdatedAt) h.localUpdatedAt = e.localUpdatedAt;
  if (e.exportedAt) h.exportedAt = e.exportedAt;
  return h;
};
const mkHousehold = (areaId: string, row: any) => {
  const ow = ownerOf(areaId, row.id);
  const base = { ...row, assignedSurveyorId: ow?.o ?? '', assignedSurveyorName: ow?.n ?? '' };
  const e = entries.get(row.id);
  return e ? mergeRow(base, e) : base;
};

function rebuild() {
  rosterIndex.clear(); mergedMap.clear(); mergedIndex.clear();
  const out: any[] = [];
  const me = scope.kind === 'owner' ? scope.id : null;
  for (const d of rosterByArea.values()) {
    for (const r of d.households) {
      rosterIndex.set(r.id, { areaId: d.areaId || d.id, row: r });
      if (scope.kind === 'none') continue;                               // chưa đăng nhập: không thấy hộ nào
      if (me && ownerOf(d.areaId || d.id, r.id)?.o !== me) continue;     // điều tra viên chỉ thấy hộ của mình
      const h = mkHousehold(d.areaId || d.id, r);
      mergedMap.set(r.id, h); mergedIndex.set(r.id, out.length); out.push(h);
    }
  }
  merged = out;
}

/** Chỉ phiếu thay đổi (bảng kê và phân quyền giữ nguyên): cập nhật đúng các hộ đó thay vì dựng lại cả danh sách. */
function patchMerged(ids: Iterable<string>) {
  const next = merged.slice();
  for (const id of ids) {
    const loc = rosterIndex.get(id), at = mergedIndex.get(id);
    if (!loc || at === undefined) continue;
    const h = mkHousehold(loc.areaId, loc.row);
    mergedMap.set(id, h); next[at] = h;
  }
  merged = next;
}

export const getRosterStatus = (): RosterStatus => ({
  scope, loaded: rosterLoaded, error: rosterError?.message, permissionDenied: rosterError?.denied,
  areaDocs: new Set(merged.map(h => h.areaId)).size, households: merged.length,
  source: rosterBase.v || rosterByArea.size ? (rosterBase.dirty ? 'local' : 'file') : 'none',
  fileVersion: rosterBase.v || undefined, fileBlocked, assignAt, pending: pending.size,
});
const emitStatus = () => { if (statusListeners.size === 0) return; const st = getRosterStatus(); statusListeners.forEach(cb => { try { cb(st); } catch { /* bỏ qua */ } }); };
export const onRosterStatus = (cb: (s: RosterStatus) => void) => { statusListeners.add(cb); cb(getRosterStatus()); return () => { statusListeners.delete(cb); }; };

/* ================================================================== lắng nghe (households gộp) */

type Snap = { docs: { id: string; data: () => any }[]; empty: boolean; size: number };
const listeners = new Set<(s: Snap) => void>();
let notifyPending = false;

const buildSnap = (): Snap => {
  const docs = merged.map(v => ({ id: v.id as string, data: () => { const { id, ...rest } = v; return rest; } }));
  return { docs, empty: docs.length === 0, size: docs.length };
};
function notify() {
  if (notifyPending) return;
  notifyPending = true;
  setTimeout(() => {
    notifyPending = false;
    if (listeners.size === 0 || !rosterLoaded) return;
    const snap = buildSnap();
    listeners.forEach(cb => { try { cb(snap); } catch (e) { console.warn(e); } });
  }, 0);
}

/* ================================================================== xã / địa bàn: nằm trên máy */

type CachedCol = 'communes' | 'surveyAreas';
const CACHED_COLS: CachedCol[] = ['communes', 'surveyAreas'];
const colRows: Record<CachedCol, Map<string, any>> = { communes: new Map(), surveyAreas: new Map() };
const colListeners: Record<CachedCol, Set<(s: Snap) => void>> = { communes: new Set(), surveyAreas: new Set() };
const colPending = new Set<CachedCol>();
let baseReady = false;

const colSnap = (col: CachedCol): Snap => {
  const docs = Array.from(colRows[col].values()).map(v => ({ id: v.id as string, data: () => { const { id, ...rest } = v; return rest; } }));
  return { docs, empty: docs.length === 0, size: docs.length };
};
function emitCol(col: CachedCol) {
  if (colPending.has(col)) return;
  colPending.add(col);
  setTimeout(() => {
    colPending.delete(col);
    if (!baseReady || colListeners[col].size === 0) return;
    const snap = colSnap(col);
    colListeners[col].forEach(cb => { try { cb(snap); } catch (e) { console.warn(e); } });
  }, 0);
}

type ColOp = { id: string; data?: any; merge?: boolean; del?: boolean };
/** Ghi xã / địa bàn trên máy (không lên Firebase). Bảng kê trên máy khác file => cần xuất lại bangke.json. */
async function writeCol(col: CachedCol, ops: ColOp[]) {
  await ensureBase();
  const puts: any[] = []; const dels: string[] = [];
  for (const o of ops) {
    if (o.del) { colRows[col].delete(o.id); dels.push(`${col}/${o.id}`); continue; }
    const base = o.merge ? { ...(colRows[col].get(o.id) || {}), ...o.data } : { ...o.data };
    const { id: _i, ...data } = base;
    const cdata = clean(data);
    colRows[col].set(o.id, { id: o.id, ...cdata });
    puts.push({ k: `${col}/${o.id}`, col, id: o.id, data: cdata });
  }
  await idbWrite('colCache', puts, dels).catch(() => {});
  await markRosterDirty();
  emitCol(col);
}

async function markRosterDirty() {
  if (rosterBase.dirty) return;
  rosterBase = { ...rosterBase, dirty: true };
  await setMeta('rosterBase', rosterBase); emitStatus();
}

/* ================================================================== nạp nền: bộ nhớ trên máy + bangke.json + phân quyền */

let basePromise: Promise<void> | null = null;
/** Nạp bảng kê/xã/địa bàn/phân quyền từ bộ nhớ trình duyệt, rồi so với bangke.json (một lần mỗi phiên). */
function ensureBase(): Promise<void> {
  return (basePromise ??= (async () => {
    await storeReady;
    rosterByArea.clear(); owners.clear(); overrides.clear();
    (await idbAll('rosterCache')).forEach(d => rosterByArea.set(d.id, { id: d.id, areaId: d.areaId || d.id, communeId: d.communeId, households: d.households || [] }));
    (await idbAll('colCache')).forEach(r => { if (r.col === 'communes' || r.col === 'surveyAreas') colRows[r.col as CachedCol].set(r.id, { id: r.id, ...r.data }); });
    rosterBase = (await getMeta<{ v: string; dirty: boolean }>('rosterBase')) || { v: '', dirty: false };
    const ac = await getMeta<AssignDoc & { at?: string }>('assignCache');
    if (ac) { Object.entries(ac.owners || {}).forEach(([k, v]) => owners.set(k, v)); Object.entries(ac.overrides || {}).forEach(([k, v]) => overrides.set(k, v)); assignV = ac.v || ''; assignAt = ac.at; }
    await syncRosterFile();
    baseReady = true;
    CACHED_COLS.forEach(emitCol);
    rebuild(); emitStatus();
  })());
}

/** Đổi bảng kê trên máy sang nội dung của một file bangke.json (xã, địa bàn, hộ). Phiếu nhập và phân quyền giữ nguyên. */
async function adoptRosterFile(file: RosterFile) {
  const { docs, communes, areas } = expandRosterFile(file);
  await idbWrite('rosterCache', docs, [], true);
  const rows = [
    ...communes.map(r => ({ k: `communes/${r.id}`, col: 'communes', id: r.id, data: clean((({ id, ...x }) => x)(r)) })),
    ...areas.map(r => ({ k: `surveyAreas/${r.id}`, col: 'surveyAreas', id: r.id, data: clean((({ id, ...x }) => x)(r)) })),
  ];
  await idbWrite('colCache', rows, [], true);
  rosterByArea.clear(); docs.forEach(d => rosterByArea.set(d.id, d as RosterDoc));
  colRows.communes = new Map(communes.map(r => [r.id, r])); colRows.surveyAreas = new Map(areas.map(r => [r.id, r]));
  rosterBase = { v: file.v, dirty: false }; fileBlocked = undefined; rosterError = undefined;
  await setMeta('rosterBase', rosterBase);
  if (baseReady) CACHED_COLS.forEach(emitCol);
}

/**
 * So bangke.json với bảng kê trên máy: file MỚI HƠN thì tự nhận — trừ khi máy này đang giữ bảng kê tự tải/sửa chưa xuất ra file
 * (khi đó giữ nguyên và báo để người dùng quyết định).
 */
async function syncRosterFile() {
  let file: RosterFile | null = null;
  try { file = await fileSource.load(); } catch { file = null; }
  if (file && file.v > rosterBase.v) {
    if (rosterBase.dirty) fileBlocked = file.v; else await adoptRosterFile(file);
  } else if (!file && rosterByArea.size === 0) {
    rosterError = { denied: false, message: 'Không tìm thấy file bangke.json cùng với ứng dụng và máy này chưa có bảng kê. Hãy đặt bangke.json vào thư mục public/ rồi build lại, hoặc nạp file ở tab 9, hoặc tải bảng kê Excel (admin).' };
  }
}

/** Bấm "Nạp file bangke.json từ máy": dùng ngay file đã chọn (không cần build lại), thay bảng kê trên máy. */
export async function loadRosterFileObject(file: RosterFile) {
  await ensureBase();
  await adoptRosterFile(file);
  rebuild(); notify(); emitStatus();
  return { households: file.hh.length, areas: file.areas.length, communes: file.communes.length };
}

let sharedAssign: { at: number; doc: AssignDoc | undefined } | null = null;
/** Đọc tài liệu phân quyền; trong 60 giây dùng chung một lần đọc (trang đăng nhập + sau đăng nhập chỉ tốn 1 lượt). */
async function fetchAssignShared(force = false) {
  if (!force && sharedAssign && Date.now() - sharedAssign.at < 60000) return sharedAssign.doc;
  const doc = await assignBackend.fetch();
  sharedAssign = { at: Date.now(), doc };
  return doc;
}

/** Đọc phân quyền từ Firebase (1 lượt đọc). Mục nào đang chờ gửi thì giữ bản trên máy. */
async function syncAssignments(force = false) {
  try {
    const doc = await fetchAssignShared(force);
    assignAt = new Date().toISOString();
    if (doc?.accV) { const v = doc.accV; void ensureAccounts().then(() => syncAccounts(v)); }     // chờ nạp xong phiên bản đang có trên máy rồi mới so
    if (doc && (force || doc.v !== assignV)) {
      owners.clear(); overrides.clear();
      Object.entries(doc.owners || {}).forEach(([k, v]) => { if (!pending.has(`assignOwner/${k}`)) owners.set(k, v); });
      Object.entries(doc.overrides || {}).forEach(([k, v]) => { if (!pending.has(`assignOverride/${k}`)) overrides.set(k, v); });
      pending.forEach(it => {                                            // áp lại các thay đổi còn chờ gửi
        if (it.kind === 'assignOwner') it.value ? owners.set(it.id, it.value) : owners.delete(it.id);
        if (it.kind === 'assignOverride') it.value ? overrides.set(it.id, it.value) : overrides.delete(it.id);
      });
      assignV = doc.v;
      await persistAssign();
    } else await persistAssign();
    if (rosterError && rosterError.denied === false && /Firebase/.test(rosterError.message)) rosterError = undefined;
  } catch (e) {
    console.warn('Không đọc được phân quyền từ Firebase, dùng bản trên máy:', e);
    rosterError = describeError(e);
  }
}
const persistAssign = () => setMeta('assignCache', { v: assignV, at: assignAt, owners: Object.fromEntries(owners), overrides: Object.fromEntries(overrides) });

/**
 * Đặt phạm vi đọc theo người đăng nhập:
 *  - { kind:'all' }       : quản trị / giám sát — thấy mọi địa bàn
 *  - { kind:'owner', id } : điều tra viên — chỉ thấy địa bàn (và hộ) được giao cho mình
 *  - { kind:'none' }      : chưa đăng nhập
 */
export function setRosterScope(s: RosterScope) {
  if (sig(s) === sig(scope)) return;
  scope = s;
  const seq = ++scopeSeq;
  rosterLoaded = false; rosterError = undefined;
  loadedPromise = new Promise<void>(r => { loadedResolve = r; });
  emitStatus();
  void (async () => {
    await ensureBase();
    if (seq !== scopeSeq) return;
    if (s.kind !== 'none') { await syncAssignments(); if (seq !== scopeSeq) return; void flushPending().catch(() => {}); }
    rosterLoaded = true; rebuild(); loadedResolve(); notify(); emitStatus();
  })();
}

async function ensureRostersLoaded() {
  await ensureBase();
  if (scope.kind === 'none') { if (!rosterLoaded) { rosterLoaded = true; rebuild(); } return; }
  await Promise.race([loadedPromise, new Promise<void>(r => setTimeout(r, 15000))]);
}

/** Bấm "Cập nhật": gửi thay đổi đang chờ, tải lại bangke.json và đọc lại phân quyền. */
export async function refreshAll(): Promise<RosterStatus> {
  await ensureBase();
  await flushPending().catch(() => {});
  await syncRosterFile();
  if (scope.kind !== 'none') await syncAssignments(true);
  await ensureAccounts(); const d = await fetchAssignShared(true).catch(() => undefined); await refreshAccounts(d?.accV);
  rebuild(); notify(); emitStatus();
  return getRosterStatus();
}

/** Bảng kê trên máy khác file và có file mới hơn: bỏ bảng kê trên máy, dùng file mới. */
export async function useNewerRosterFile() {
  await ensureBase();
  const file = await fileSource.load();
  if (!file) throw new Error('Không tải được bangke.json.');
  await adoptRosterFile(file); rebuild(); notify(); emitStatus();
}

/* ================================================================== hàng đợi gửi lên Firebase (phân quyền, tiến độ) */

async function queuePending(items: PendingItem[]) {
  if (items.length === 0) return;
  items.forEach(it => pending.set(pkey(it), it));
  await idbWrite('pendingWrites', items.map(it => ({ k: pkey(it), item: it }))).catch(() => {});
  emitStatus();
}

let flushing: Promise<void> | null = null;
async function doFlush() {
  if (pending.size === 0) return;
  const snapshot = Array.from(pending.entries());
  const items = snapshot.map(([, it]) => it);
  try {
    const ow: Record<string, Owner | null> = {}; const ov: Record<string, Owner | null> = {};
    items.forEach(it => { if (it.kind === 'assignOwner') ow[it.id] = it.value; if (it.kind === 'assignOverride') ov[it.id] = it.value; });
    if (Object.keys(ow).length || Object.keys(ov).length) {
      const v = await assignBackend.patch({ owners: Object.keys(ow).length ? ow : undefined, overrides: Object.keys(ov).length ? ov : undefined });
      assignV = v; assignAt = new Date().toISOString(); sharedAssign = null; await persistAssign();
    }
    for (const it of items) if (it.kind === 'progress') await progressBackend.put(it.data.surveyorId, it.data);
    const sent: string[] = [];
    snapshot.forEach(([k, it]) => { if (pending.get(k) === it) { pending.delete(k); sent.push(k); } });    // mục vừa bị ghi đè bởi thay đổi mới hơn thì giữ lại
    await idbWrite('pendingWrites', [], sent).catch(() => {});
    rosterError = undefined;
  } catch (e) {
    rosterError = describeError(e);
    throw e;
  } finally { emitStatus(); }
}
/** Gửi các thay đổi đang chờ lên Firebase. */
export function flushPending(): Promise<void> {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}
/** wait = true: chờ xong và báo lỗi thật. Ngược lại: chạy nền, quá 12 giây thì trả quyền cho người dùng. */
async function flushWithin(wait?: boolean) {
  if (pending.size === 0) return;
  const p = flushPending();
  if (wait) { await p; return; }
  p.catch(() => {});
  await Promise.race([p.catch(() => {}), new Promise<void>(r => setTimeout(r, 12000))]);
}

/* ================================================================== tiến độ điều tra viên */

let progressTimer: ReturnType<typeof setTimeout> | null = null;
function computeProgress(surveyorId: string): ProgressDoc {
  const areas: ProgressDoc['areas'] = {};
  for (const h of merged) {
    const a = (areas[h.areaId] ||= { t: 0, e: 0, c: 0, ap: 0 });
    a.t++;
    if (isEnteredRow(h)) {
      a.e++;
      if (DONE_STATUS.has(String(h.surveyStatus))) a.c++;
      if (h.surveyStatus === 'DA_DUYET') a.ap++;
      if (h.localUpdatedAt && (!a.at || h.localUpdatedAt > a.at)) a.at = h.localUpdatedAt;
    }
  }
  return { surveyorId, updatedAt: new Date().toISOString(), areas };
}
/** Điều tra viên vừa lưu phiếu: gộp trong 20 giây rồi gửi tiến độ (một tài liệu nhỏ) lên Firebase. */
function scheduleProgress() {
  if (scope.kind !== 'owner') return;
  if (progressTimer) clearTimeout(progressTimer);
  progressTimer = setTimeout(() => { progressTimer = null; void pushProgressNow().catch(() => {}); }, progressDebounceMs);
}
export async function pushProgressNow() {
  if (scope.kind !== 'owner') return;
  await queuePending([{ kind: 'progress', id: 'progress', data: computeProgress(scope.id) }]);
  await flushWithin(false);
}
/** Quản trị: tải tiến độ của các điều tra viên từ Firebase (mỗi người 1 lượt đọc) và lưu lại trên máy. */
export async function fetchProgress(): Promise<{ at: string; docs: ProgressDoc[] }> {
  const docs = await progressBackend.getAll();
  const out = { at: new Date().toISOString(), docs };
  await setMeta('progressCache', out);
  return out;
}
export const getCachedProgress = () => getMeta<{ at: string; docs: ProgressDoc[] }>('progressCache');

/* ================================================================== ghi hộ: tách bảng kê / phiếu nhập / phân quyền */

interface HhOp { id: string; data?: any; merge?: boolean; del?: boolean }

async function applyHouseholdOps(ops: HhOp[], opts: { preserveStamps?: boolean; waitFull?: boolean } = {}) {
  await ensureRostersLoaded();
  const now = new Date().toISOString();

  const work = new Map<string, RosterDoc>();
  const getWork = (areaId: string) => {
    let d = work.get(areaId);
    if (!d) {
      const base = rosterByArea.get(areaId);
      d = base ? { ...base, households: base.households.slice() } : { id: areaId, areaId, households: [] };
      work.set(areaId, d);
    }
    return d;
  };
  const entryPuts = new Map<string, any>(); const entryDels = new Set<string>();
  const stageIndex = new Map<string, { areaId: string; row: any }>();      // hộ vừa thêm trong cùng đợt
  const intents = new Map<string, Owner>();                                // hộ -> người phụ trách mới ('' = bỏ giao)
  const removedHh = new Set<string>();

  for (const op of ops) {
    const loc = stageIndex.get(op.id) || rosterIndex.get(op.id);
    const prevEntry = entryPuts.get(op.id) ?? (entryDels.has(op.id) ? undefined : entries.get(op.id));

    if (op.del) {
      if (loc) { const d = getWork(loc.areaId); d.households = d.households.filter(r => r.id !== op.id); stageIndex.delete(op.id); }
      if (prevEntry) { entryDels.add(op.id); entryPuts.delete(op.id); }
      removedHh.add(op.id);
      continue;
    }

    const cur = mergedMap.get(op.id);
    const next: any = op.merge ? { ...(cur || {}), ...op.data } : { ...op.data };
    next.id = op.id;
    const areaId: string | undefined = next.areaId || loc?.areaId;
    if (!areaId) { console.warn('Bỏ qua hộ không có địa bàn:', op.id); continue; }

    // ---- PHÂN QUYỀN: chỉ ghi nhận khi khác người đang phụ trách hộ này
    if (next.assignedSurveyorId !== undefined) {
      const effective = (loc ? ownerOf(loc.areaId, op.id)?.o : '') ?? '';
      const val = next.assignedSurveyorId || '';
      // Ghi đè cả hộ (tải lại bảng kê) với chủ rỗng = "không có thông tin", giữ nguyên người phụ trách đã phân. Chỉ cập nhật từng phần mới được bỏ giao.
      if (val !== effective && (val || op.merge)) intents.set(op.id, { o: val, n: val ? (next.assignedSurveyorName || '') : '' });
    }

    // ---- phần BẢNG KÊ
    const row: any = {};
    for (const k of Object.keys(next)) if (!ENTRY_SET.has(k) && !STAMP_FIELDS.has(k) && !OWNER_FIELDS.has(k)) row[k] = next[k];
    row.areaId = areaId;
    if (loc) { row.membersCount = loc.row.membersCount; row.workingMembersCount = loc.row.workingMembersCount; }   // số liệu gốc của bảng kê giữ nguyên
    else { row.membersCount = next.membersCount; row.workingMembersCount = next.workingMembersCount; }                // hộ mới: lấy làm số liệu gốc
    const cleanedRow = clean(row);
    const d = getWork(areaId);
    const i = d.households.findIndex(r => r.id === op.id);
    if (i < 0) d.households.push(cleanedRow); else if (sig(d.households[i]) !== sig(cleanedRow)) d.households[i] = cleanedRow;
    stageIndex.set(op.id, { areaId, row: cleanedRow });

    // ---- phần PHIẾU NHẬP
    const status = next.surveyStatus;
    const entered = !!next.membersCountEntered;
    const blankQ = isBlankQuestionnaire(next.questionnaire);
    const blank = (!status || status === 'CHUA_NHAP' || status === 'PENDING') && blankQ && !entered;
    if (blank) {
      if (prevEntry) { entryDels.add(op.id); entryPuts.delete(op.id); }
      continue;
    }
    const ev: any = { id: op.id };
    if (status) ev.surveyStatus = status;
    if (!blankQ) ev.questionnaire = next.questionnaire;
    if (entered) { ev.membersCountEntered = true; ev.membersCount = next.membersCount; ev.workingMembersCount = next.workingMembersCount; }
    if (next.updatedBy) ev.updatedBy = next.updatedBy;
    if (next.updatedAt) ev.updatedAt = next.updatedAt;
    const same = prevEntry && sig(pickEntry(prevEntry)) === sig(pickEntry(ev));
    if (same) continue;                                                       // không đổi nội dung phiếu => không đóng dấu "mới sửa"
    ev.localUpdatedAt = opts.preserveStamps ? (op.data?.localUpdatedAt || now) : now;
    ev.exportedAt = opts.preserveStamps ? (op.data?.exportedAt || ev.localUpdatedAt) : prevEntry?.exportedAt;
    entryPuts.set(op.id, clean(ev)); entryDels.delete(op.id);
  }

  // ---- phiếu nhập -> trình duyệt
  const puts = Array.from(entryPuts.values()); const dels = Array.from(entryDels);
  puts.forEach(p => entries.set(p.id, p)); dels.forEach(id => entries.delete(id));
  await persistEntries(puts, dels);

  // ---- bảng kê -> trình duyệt (chỉ địa bàn có thay đổi)
  const changedDocs: RosterDoc[] = []; const deletedDocs: string[] = [];
  for (const [areaId, d] of work) {
    const orig = rosterByArea.get(areaId);
    if (orig && sig(orig.households) === sig(d.households)) continue;
    if (d.households.length === 0) { if (orig) { deletedDocs.push(areaId); rosterByArea.delete(areaId); } continue; }
    const doc: RosterDoc = { id: areaId, areaId, communeId: d.communeId || d.households[0]?.communeId, households: d.households };
    rosterByArea.set(areaId, doc); changedDocs.push(doc);
  }
  const rosterChanged = changedDocs.length > 0 || deletedDocs.length > 0;
  if (rosterChanged) { await idbWrite('rosterCache', changedDocs, deletedDocs); await markRosterDirty(); }

  // ---- phân quyền: cả địa bàn cùng một người => ghi theo địa bàn; lẻ từng hộ => ghi riêng từng hộ
  const ownerPatch: { id: string; value: Owner | null }[] = []; const ovrPatch: { id: string; value: Owner | null }[] = [];
  const byArea = new Map<string, string[]>();
  for (const hid of intents.keys()) { const loc = stageIndex.get(hid) || rosterIndex.get(hid); if (loc) (byArea.get(loc.areaId) || byArea.set(loc.areaId, []).get(loc.areaId)!).push(hid); }
  for (const [areaId, ids] of byArea) {
    const doc = rosterByArea.get(areaId) || work.get(areaId);
    const total = doc?.households.length || 0;
    const vals = new Set(ids.map(id => intents.get(id)!.o));
    const ao = owners.get(areaId)?.o ?? '';
    if (ids.length >= total && total > 0 && vals.size === 1) {
      const it = intents.get(ids[0])!;
      ownerPatch.push({ id: areaId, value: it.o ? { o: it.o, n: it.n } : null });
      doc!.households.forEach(r => { if (overrides.has(r.id)) ovrPatch.push({ id: r.id, value: null }); });
    } else {
      ids.forEach(id => {
        const it = intents.get(id)!;
        if (it.o === ao) { if (overrides.has(id)) ovrPatch.push({ id, value: null }); }
        else ovrPatch.push({ id, value: { o: it.o, n: it.n } });
      });
    }
  }
  removedHh.forEach(id => { if (overrides.has(id)) ovrPatch.push({ id, value: null }); });
  const assignItems: PendingItem[] = [];
  ownerPatch.forEach(p => { p.value ? owners.set(p.id, p.value) : owners.delete(p.id); assignItems.push({ kind: 'assignOwner', id: p.id, value: p.value }); });
  ovrPatch.forEach(p => { p.value ? overrides.set(p.id, p.value) : overrides.delete(p.id); assignItems.push({ kind: 'assignOverride', id: p.id, value: p.value }); });
  if (assignItems.length) await persistAssign();

  if (rosterChanged || assignItems.length) rebuild(); else patchMerged([...puts.map(p => p.id), ...dels]);
  notify();

  if (assignItems.length) { await queuePending(assignItems); await flushWithin(opts.waitFull); }   // máy trước, Firebase sau
  if (puts.length || dels.length) scheduleProgress();
  return { areasWritten: changedDocs.length, entriesWritten: puts.length, assignWritten: assignItems.length };
}

/* ================================================================== tài khoản / phòng ban: bản chép trên máy */

type AccCol = 'surveyors' | 'departments';
const ACC_COLS: AccCol[] = ['surveyors', 'departments'];
const accRows: Record<AccCol, Map<string, any>> = { surveyors: new Map(), departments: new Map() };
const accListeners: Record<AccCol, Set<(s: Snap) => void>> = { surveyors: new Set(), departments: new Set() };
const accPendingEmit = new Set<AccCol>();
let accLoaded = false;
let accSeen = '';                                   // phiên bản tài khoản đã tải về máy
let accPromise: Promise<void> | null = null;

const accSnap = (col: AccCol): Snap => {
  const docs = Array.from(accRows[col].values()).map(v => ({ id: v.id as string, data: () => { const { id, ...rest } = v; return rest; } }));
  return { docs, empty: docs.length === 0, size: docs.length };
};
function emitAcc(col: AccCol) {
  if (accPendingEmit.has(col)) return;
  accPendingEmit.add(col);
  setTimeout(() => {
    accPendingEmit.delete(col);
    if (!accLoaded || accListeners[col].size === 0) return;
    const snap = accSnap(col);
    accListeners[col].forEach(cb => { try { cb(snap); } catch (e) { console.warn(e); } });
  }, 0);
}

let accRefresh: Promise<void> | null = null;
/** Tải lại tài khoản + phòng ban từ Firebase (mỗi tài liệu 1 lượt đọc). Nhiều nơi cùng yêu cầu thì chỉ tải MỘT lần. */
function refreshAccounts(v?: string): Promise<void> {
  if (!accRefresh) accRefresh = doRefreshAccounts(v).finally(() => { accRefresh = null; });
  return accRefresh;
}
async function doRefreshAccounts(v?: string) {
  try {
    for (const col of ACC_COLS) {
      const rows = (await accountsIO.read(col)).map(({ id, ...data }) => ({ id, data: data as any }));
      const old = (await idbAll('colCache')).filter(r => r.col === col).map(r => r.k);
      accRows[col] = new Map(rows.map(r => [r.id, { id: r.id, ...r.data }]));
      const keep = new Set(rows.map(r => `${col}/${r.id}`));
      await idbWrite('colCache', rows.map(r => ({ k: `${col}/${r.id}`, col, id: r.id, data: r.data })), old.filter(k => !keep.has(k)));
      emitAcc(col);
    }
    if (v) { accSeen = v; await setMeta('accSeen', v); }
  } catch (e) {
    console.warn('Không đọc được tài khoản từ Firebase, dùng bản trên máy:', e);
    if (!rosterError) { rosterError = describeError(e); emitStatus(); }
  }
}
async function syncAccounts(remoteV: string) { if (remoteV !== accSeen) await refreshAccounts(remoteV); }

/**
 * Tài khoản/phòng ban: hiện ngay từ bản chép trên máy. Chỉ đọc Firebase khi máy chưa có, hoặc admin vừa đổi tài khoản
 * (dấu phiên bản nằm ngay trong tài liệu phân quyền nên không tốn thêm lượt đọc).
 */
function ensureAccounts(): Promise<void> {
  return (accPromise ??= (async () => {
    await ensureBase();
    (await idbAll('colCache')).forEach(r => { if (r.col === 'surveyors' || r.col === 'departments') accRows[r.col as AccCol].set(r.id, { id: r.id, ...r.data }); });
    accSeen = (await getMeta<string>('accSeen')) || '';
    accLoaded = true; ACC_COLS.forEach(emitAcc);
    const empty = accRows.surveyors.size === 0 && accRows.departments.size === 0;
    const doc = await fetchAssignShared().catch(() => undefined);
    if (doc?.accV && doc.accV !== accSeen) await refreshAccounts(doc.accV);
    else if (empty) await refreshAccounts(doc?.accV);
  })());
}

type AccOp = { type: 'set' | 'del'; col: AccCol; id: string; data?: any; merge?: boolean };
/** Ghi tài khoản/phòng ban lên Firebase (như cũ), rồi cập nhật bản chép trên máy và báo cho máy khác biết có thay đổi. */
async function writeAcc(ops: AccOp[]) {
  await ensureAccounts();
  await accountsIO.commit(ops.map(o => ({ type: o.type, col: o.col, id: o.id, data: o.data !== undefined ? clean(o.data) : undefined, merge: o.merge })));
  const touched = new Set<AccCol>(); const puts: any[] = []; const dels: string[] = [];
  for (const o of ops) {
    touched.add(o.col);
    if (o.type === 'del') { accRows[o.col].delete(o.id); dels.push(`${o.col}/${o.id}`); continue; }
    const base = o.merge ? { ...(accRows[o.col].get(o.id) || {}), ...o.data } : { ...o.data };
    const { id: _i, ...data } = base; const cdata = clean(data);
    accRows[o.col].set(o.id, { id: o.id, ...cdata }); puts.push({ k: `${o.col}/${o.id}`, col: o.col, id: o.id, data: cdata });
  }
  await idbWrite('colCache', puts, dels).catch(() => {});
  touched.forEach(emitAcc);
  try { const v = await assignBackend.patch({ accounts: true }); accSeen = v; sharedAssign = null; await setMeta('accSeen', v); } catch { /* máy khác sẽ nhận ở lần đổi sau */ }
}

/* ================================================================== API tương thích Firestore */

interface HhRef { __local: true; col: 'households'; id?: string }
interface ColRef { __cached: true; col: CachedCol; id?: string; real: any }
interface AccRef { __acc: true; col: AccCol; id?: string }
const isAcc = (r: any): r is AccRef => !!r && r.__acc === true;
const isAccName = (p: string): p is AccCol => (ACC_COLS as string[]).includes(p);
const isHh = (r: any): r is HhRef => !!r && r.__local === true;
const isCol = (r: any): r is ColRef => !!r && r.__cached === true;
const isColName = (p: string): p is CachedCol => (CACHED_COLS as string[]).includes(p);

export const collection = ((firestore: any, path: string, ...rest: string[]) => {
  if (rest.length === 0 && path === 'households') return { __local: true, col: 'households' } as HhRef;
  if (rest.length === 0 && isColName(path)) return { __cached: true, col: path, real: null } as ColRef;
  if (rest.length === 0 && isAccName(path)) return { __acc: true, col: path } as AccRef;
  return (fs.collection as any)(firestore, path, ...rest);
}) as typeof fs.collection;

export const doc = ((first: any, path?: string, ...rest: string[]) => {
  if (isHh(first)) return { __local: true, col: 'households', id: path ?? crypto.randomUUID() } as HhRef;
  if (isCol(first)) return { __cached: true, col: first.col, id: path ?? crypto.randomUUID(), real: null } as ColRef;
  if (isAcc(first)) return { __acc: true, col: first.col, id: path ?? crypto.randomUUID() } as AccRef;
  if (typeof path === 'string' && rest.length === 1) {
    if (path === 'households') return { __local: true, col: 'households', id: rest[0] } as HhRef;
    if (isColName(path)) return { __cached: true, col: path, id: rest[0], real: null } as ColRef;
    if (isAccName(path)) return { __acc: true, col: path, id: rest[0] } as AccRef;
  }
  return (fs.doc as any)(first, path, ...rest);
}) as typeof fs.doc;

export const query = ((ref: any, ...c: any[]) => (isHh(ref) || isCol(ref) ? ref : isAcc(ref) ? (fs.query as any)(fs.collection(firestoreDb, ref.col), ...c) : (fs.query as any)(ref, ...c))) as typeof fs.query;

export const setDoc = (async (ref: any, data: any, options?: any) => {
  if (isHh(ref)) { await applyHouseholdOps([{ id: ref.id!, data, merge: !!options?.merge }]); return; }
  if (isCol(ref)) { await writeCol(ref.col, [{ id: ref.id!, data, merge: !!options?.merge }]); return; }
  if (isAcc(ref)) { await writeAcc([{ type: 'set', col: ref.col, id: ref.id!, data, merge: !!options?.merge }]); return; }
  return (fs.setDoc as any)(ref, data, options);
}) as typeof fs.setDoc;

export const addDoc = (async (ref: any, data: any) => {
  if (isHh(ref)) { const id = crypto.randomUUID(); await applyHouseholdOps([{ id, data }]); return { id }; }
  if (isCol(ref)) { const id = crypto.randomUUID(); await writeCol(ref.col, [{ id, data }]); return { id }; }
  if (isAcc(ref)) { const id = crypto.randomUUID(); await writeAcc([{ type: 'set', col: ref.col, id, data }]); return { id }; }
  return (fs.addDoc as any)(ref, data);
}) as typeof fs.addDoc;

export const deleteDoc = (async (ref: any) => {
  if (isHh(ref)) { await applyHouseholdOps([{ id: ref.id!, del: true }]); return; }
  if (isCol(ref)) { await writeCol(ref.col, [{ id: ref.id!, del: true }]); return; }
  if (isAcc(ref)) { await writeAcc([{ type: 'del', col: ref.col, id: ref.id! }]); return; }
  return (fs.deleteDoc as any)(ref);
}) as typeof fs.deleteDoc;

export const getDoc = (async (ref: any) => {
  if (isHh(ref)) {
    await ensureRostersLoaded();
    const v = mergedMap.get(ref.id!);
    return { id: ref.id, exists: () => !!v, data: () => { if (!v) return undefined; const { id: _i, ...rest } = v; return rest; } };
  }
  if (isCol(ref)) {
    await ensureBase();
    const v = colRows[ref.col].get(ref.id!);
    return { id: ref.id, exists: () => !!v, data: () => { if (!v) return undefined; const { id: _i, ...rest } = v; return rest; } };
  }
  if (isAcc(ref)) {
    await ensureAccounts();
    const v = accRows[ref.col].get(ref.id!);
    return { id: ref.id, exists: () => !!v, data: () => { if (!v) return undefined; const { id: _i, ...rest } = v; return rest; } };
  }
  return (fs.getDoc as any)(ref);
}) as typeof fs.getDoc;

export const getDocs = (async (ref: any) => {
  if (isHh(ref)) { await ensureRostersLoaded(); return buildSnap(); }
  if (isCol(ref)) { await ensureBase(); return colSnap(ref.col); }
  if (isAcc(ref)) { await ensureAccounts(); return accSnap(ref.col); }
  return (fs.getDocs as any)(ref);
}) as typeof fs.getDocs;

export const onSnapshot = ((ref: any, next: any, error?: any) => {
  if (isHh(ref)) {
    listeners.add(next);
    void ensureBase().then(() => { if (scope.kind === 'none' && !rosterLoaded) { rosterLoaded = true; rebuild(); } if (listeners.has(next) && rosterLoaded) next(buildSnap()); });
    return () => { listeners.delete(next); };
  }
  if (isCol(ref)) {
    const col = ref.col;
    colListeners[col].add(next);
    void ensureBase().then(() => { if (colListeners[col].has(next)) next(colSnap(col)); });
    return () => { colListeners[col].delete(next); };
  }
  if (isAcc(ref)) {
    const col = ref.col;
    accListeners[col].add(next);
    void ensureAccounts().then(() => { if (accListeners[col].has(next)) next(accSnap(col)); });
    return () => { accListeners[col].delete(next); };
  }
  return (fs.onSnapshot as any)(ref, next, error);
}) as typeof fs.onSnapshot;

export const writeBatch = ((firestore: any) => {
  const hhOps: HhOp[] = [];
  const colOps: { col: CachedCol; id: string; data?: any; merge?: boolean; del?: boolean }[] = [];
  const accOps: AccOp[] = [];
  let remote: ReturnType<typeof fs.writeBatch> | null = null;
  const rb = () => (remote ??= fs.writeBatch(firestore));
  const api: any = {
    set(ref: any, data: any, options?: any) {
      if (isHh(ref)) hhOps.push({ id: ref.id!, data, merge: !!options?.merge });
      else if (isCol(ref)) colOps.push({ col: ref.col, id: ref.id!, data, merge: !!options?.merge });
      else if (isAcc(ref)) accOps.push({ type: 'set', col: ref.col, id: ref.id!, data, merge: !!options?.merge });
      else (rb() as any).set(ref, data, options);
      return api;
    },
    update(ref: any, data: any) {
      if (isHh(ref)) hhOps.push({ id: ref.id!, data, merge: true });
      else if (isCol(ref)) colOps.push({ col: ref.col, id: ref.id!, data, merge: true });
      else if (isAcc(ref)) accOps.push({ type: 'set', col: ref.col, id: ref.id!, data, merge: true });
      else (rb() as any).update(ref, data);
      return api;
    },
    delete(ref: any) {
      if (isHh(ref)) hhOps.push({ id: ref.id!, del: true });
      else if (isCol(ref)) colOps.push({ col: ref.col, id: ref.id!, del: true });
      else if (isAcc(ref)) accOps.push({ type: 'del', col: ref.col, id: ref.id! });
      else (rb() as any).delete(ref);
      return api;
    },
    async commit() {
      if (remote) await remote.commit();
      for (const col of CACHED_COLS) { const m = colOps.filter(x => x.col === col); if (m.length) await writeCol(col, m); }
      if (accOps.length) await writeAcc(accOps);
      if (hhOps.length) await applyHouseholdOps(hhOps);
    },
  };
  return api;
}) as typeof fs.writeBatch;

/* ================================================================== API riêng cho đồng bộ file / sao lưu */

/** Danh sách hộ đã gộp (bảng kê + phiếu nhập + phân quyền). */
export const readLocal = async <T = any>(_col: 'households' = 'households'): Promise<T[]> => { await ensureRostersLoaded(); return merged.slice() as T[]; };
/** Chỉ các bản ghi phiếu nhập trên máy này. */
export const readEntries = async (): Promise<any[]> => { await storeReady; return Array.from(entries.values()); };

/**
 * Nhập phiếu từ file (của ĐTV gửi / từ file sao lưu) vào trình duyệt: GIỮ NGUYÊN dấu thời gian gốc và coi như đã đồng bộ.
 * Hộ không có trong bảng kê thì bỏ qua và đếm lại.
 */
export async function importEntryRows(rows: any[]): Promise<{ written: number; missingInRoster: number }> {
  await ensureRostersLoaded();
  const puts: any[] = []; let missing = 0;
  for (const r of rows) {
    if (!rosterIndex.has(r.id)) { missing++; continue; }
    const ev: any = { id: r.id };
    for (const k of ENTRY_FIELDS) if (r[k] !== undefined) ev[k] = r[k];
    ev.localUpdatedAt = r.localUpdatedAt || new Date().toISOString();
    ev.exportedAt = ev.localUpdatedAt;
    puts.push(clean(ev));
  }
  puts.forEach(p => entries.set(p.id, p));
  await persistEntries(puts, []);
  patchMerged(puts.map(p => p.id)); notify();
  return { written: puts.length, missingInRoster: missing };
}

/** Đánh dấu đã xuất: các hộ này không còn là "mới sửa" cho tới khi sửa tiếp. */
export async function markHouseholdsExported(ids: string[], at = new Date().toISOString()) {
  await storeReady;
  const puts: any[] = [];
  ids.forEach(id => {
    const e = entries.get(id);
    if (e) { const ne = { ...e, exportedAt: at > (e.localUpdatedAt || '') ? at : e.localUpdatedAt }; entries.set(id, ne); puts.push(ne); }
  });
  await persistEntries(puts, []);
  patchMerged(puts.map(p => p.id)); notify();
}

/** Xóa toàn bộ phiếu nhập trên máy này (KHÔNG xóa bảng kê). */
export async function wipeEntries() {
  await storeReady;
  const ids = Array.from(entries.keys());
  entries.clear();
  await persistEntries([], ids);
  rebuild(); notify();
}

/* ================================================================== xuất bảng kê ra bangke.json */

/** Dữ liệu bảng kê / xã / địa bàn đang có trên máy để xuất thành bangke.json. */
export async function getRosterExportData(): Promise<{ communes: any[]; areas: any[]; docs: RosterDocLike[] }> {
  await ensureBase();
  return {
    communes: Array.from(colRows.communes.values()), areas: Array.from(colRows.surveyAreas.values()),
    docs: Array.from(rosterByArea.values()).map(d => ({ ...d })),
  };
}
/** Sau khi xuất bangke.json: máy này coi như đã khớp với file đó (không còn "chưa xuất"). */
export async function markRosterExported(v: string) {
  rosterBase = { v, dirty: false }; fileBlocked = undefined;
  await setMeta('rosterBase', rosterBase); emitStatus();
}

/* ================================================================== chuyển dữ liệu từ các bản cũ */

/** Nơi đọc Firestore cho phần chuyển dữ liệu từ bản gốc (thay được khi kiểm thử). */
export interface LegacyIO { read(col: string): Promise<{ id: string; [k: string]: any }[]> }
const firestoreLegacyIO: LegacyIO = {
  async read(col) {
    const snap = await fs.getDocs(fs.collection(firestoreDb, col));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  },
};
let legacyIO: LegacyIO = firestoreLegacyIO;
export const __setLegacyIO = (io: LegacyIO) => { legacyIO = io; };

/** Đưa bảng kê (và phiếu, phân quyền) của bản cũ vào bảng kê trên máy theo cấu trúc mới. */
async function pushHouseholds(rows: any[], onProgress?: (m: string) => void) {
  const CH = 2000;
  let areas = 0, entriesN = 0, assigns = 0;
  for (let i = 0; i < rows.length; i += CH) {
    onProgress?.(`Đang chuyển hộ ${Math.min(i + CH, rows.length)}/${rows.length}...`);
    const r = await applyHouseholdOps(
      rows.slice(i, i + CH).map(h => ({ id: h.id, data: { ...h, localUpdatedAt: h.localUpdatedAt || h.updatedAt, exportedAt: h.exportedAt }, merge: false })),
      { preserveStamps: true });
    areas += r.areasWritten; entriesN += r.entriesWritten; assigns += r.assignWritten;
  }
  return { areas, entries: entriesN, assigns };
}

/** Bản trước đây lưu bảng kê + phiếu trong IndexedDB 'thongke_local_v1' của trình duyệt này: chuyển vào bảng kê trên máy. */
export async function migrateFromLegacyLocal(onProgress?: (m: string) => void) {
  await ensureBase();
  const legacy: { households: any[]; surveyAreas: any[]; communes: any[] } | null = await new Promise(resolve => {
    const req = indexedDB.open('thongke_local_v1');
    let created = false;                                  // true = trước đó chưa có DB này (vừa bị tạo rỗng)
    req.onupgradeneeded = () => { created = true; };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const d = req.result;
      if (created) { d.close(); indexedDB.deleteDatabase('thongke_local_v1'); resolve(null); return; }
      const names = ['households', 'surveyAreas', 'communes'];
      if (!names.every(n => d.objectStoreNames.contains(n))) { d.close(); resolve(null); return; }
      const out: any = {}; let left = names.length;
      names.forEach(n => {
        const r = d.transaction(n, 'readonly').objectStore(n).getAll();
        r.onsuccess = () => { out[n] = r.result || []; if (--left === 0) { d.close(); resolve(out); } };
        r.onerror = () => { out[n] = []; if (--left === 0) { d.close(); resolve(out); } };
      });
    };
  });
  if (!legacy || legacy.households.length === 0) return { found: false, households: 0, areasDocs: 0, communes: 0, surveyAreas: 0 };
  onProgress?.(`Tìm thấy ${legacy.households.length} hộ, ${legacy.surveyAreas.length} địa bàn, ${legacy.communes.length} xã trong trình duyệt này.`);
  await writeCol('communes', legacy.communes.map(r => ({ id: r.id, data: r })));
  await writeCol('surveyAreas', legacy.surveyAreas.map(r => ({ id: r.id, data: r })));
  const r = await pushHouseholds(legacy.households, onProgress);
  return { found: true, households: legacy.households.length, areasDocs: r.areas, communes: legacy.communes.length, surveyAreas: legacy.surveyAreas.length, assigns: r.assigns };
}

/** Bản gốc lưu mỗi hộ một tài liệu trong collection 'households' của Firestore: đọc về (tốn lượt đọc!), tách thành bảng kê + phiếu nhập + phân quyền. */
export async function migrateFromLegacyFirestore(onProgress?: (m: string) => void) {
  await ensureBase();
  onProgress?.("Đang đọc collection 'households' cũ từ Firestore...");
  const rows = await legacyIO.read('households');
  if (rows.length === 0) return { found: false, households: 0, areasDocs: 0 };
  const r = await pushHouseholds(rows, onProgress);
  return { found: true, households: rows.length, areasDocs: r.areas };
}
