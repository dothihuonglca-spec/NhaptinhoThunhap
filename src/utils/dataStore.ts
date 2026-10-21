/**
 * dataStore — lớp lưu trữ lai (hybrid)
 *
 *  FIREBASE (Firestore)
 *    - tài khoản, phòng ban (surveyors, departments, users...)
 *    - xã (communes), địa bàn (surveyAreas)
 *    - BẢNG KÊ + PHÂN QUYỀN: collection 'rosters', MỖI ĐỊA BÀN MỘT TÀI LIỆU chứa danh sách hộ của địa bàn đó
 *      và người phụ trách (ownerId). Một địa bàn ≈ 15 hộ ≈ vài KB, nên ít lượt đọc/ghi hơn nhiều so với mỗi hộ một tài liệu.
 *      Điều tra viên chỉ đọc các địa bàn có ownerId = mình.
 *
 *  TRÌNH DUYỆT (IndexedDB)
 *    - PHIẾU NHẬP: nội dung phiếu, trạng thái, số nhân khẩu đã nhập... theo từng hộ ('entries').
 *      Lưu phiếu KHÔNG tốn lượt ghi Firebase nào.
 *
 * App.tsx vẫn dùng 'households' như một collection bình thường: module này xuất lại các hàm cùng tên với
 * 'firebase/firestore' và GỘP bảng kê (Firebase) + phiếu nhập (trình duyệt) thành một danh sách hộ; khi ghi thì
 * tự tách phần bảng kê (lên Firebase, chỉ khi có thay đổi) và phần phiếu nhập (về trình duyệt).
 */
import * as fs from 'firebase/firestore';
import { db as firestoreDb } from '../firebase';
import { createDefaultQuestionnaire } from '../types/questionnaire';

/* ================================================================== trường phiếu nhập / trường bảng kê */

/** Các trường thuộc PHIẾU NHẬP (lưu cục bộ). Mọi trường còn lại của hộ thuộc BẢNG KÊ (lưu Firebase). */
export const ENTRY_FIELDS = ['surveyStatus', 'questionnaire', 'membersCountEntered', 'membersCount', 'workingMembersCount', 'updatedBy', 'updatedAt'] as const;
const ENTRY_SET = new Set<string>(ENTRY_FIELDS);
const STAMP_FIELDS = new Set<string>(['localUpdatedAt', 'exportedAt']);

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

/* ================================================================== IndexedDB: phiếu nhập */

const DB_NAME = 'thongke_entries_v2';
let idb: IDBDatabase | null = null;
let idbFailed = false;
const entries = new Map<string, any>();      // id hộ -> bản ghi phiếu nhập

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const storeReady: Promise<void> = (async () => {
  try {
    idb = await openIdb();
    const rows: any[] = await new Promise((res, rej) => {
      const r = idb!.transaction('entries', 'readonly').objectStore('entries').getAll();
      r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
    });
    rows.forEach(r => entries.set(r.id, r));
    try { await (navigator as any).storage?.persist?.(); } catch { /* không bắt buộc */ }
  } catch (e) {
    idbFailed = true;
    console.warn('IndexedDB không khả dụng — phiếu nhập chỉ tồn tại trong phiên làm việc.', e);
  }
})();

export const isLocalStoreBroken = () => idbFailed;

function persistEntries(puts: any[], dels: string[]): Promise<void> {
  if (!idb || (puts.length === 0 && dels.length === 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = idb!.transaction('entries', 'readwrite');
    const os = tx.objectStore('entries');
    puts.forEach(p => os.put(p)); dels.forEach(id => os.delete(id));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}

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
  if (!idb) return;
  await new Promise<void>(resolve => {
    const tx = idb!.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
    tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
  });
}

/* ================================================================== Firebase: bảng kê theo địa bàn */

export type RosterScope = { kind: 'none' } | { kind: 'all' } | { kind: 'owner'; id: string };

interface RosterDoc {
  id: string;                 // = id địa bàn
  areaId: string;
  communeId?: string;
  ownerId: string;            // người phụ trách địa bàn ('' = chưa giao)
  ownerName: string;
  updatedAt?: string;
  households: any[];          // các hộ (chỉ trường bảng kê)
}
type RosterChange = { type: 'set' | 'del'; id: string; data?: any };

/** Cổng giao tiếp với nơi lưu bảng kê. Mặc định là Firestore; kiểm thử có thể thay bằng bản giả. */
export interface RosterBackend {
  subscribe(scope: RosterScope, onChanges: (c: RosterChange[]) => void, onError: (e: any) => void): () => void;
  fetchAll(scope: RosterScope): Promise<{ id: string; data: any }[]>;
  commit(ops: RosterChange[]): Promise<void>;
}

const ROSTER_COL = 'rosters';
const firestoreBackend: RosterBackend = {
  subscribe(scope, onChanges, onError) {
    const col = fs.collection(firestoreDb, ROSTER_COL);
    const q = scope.kind === 'owner' ? fs.query(col, fs.where('ownerId', '==', scope.id)) : col;
    return fs.onSnapshot(q, snap => onChanges(snap.docChanges().map(c => ({ type: c.type === 'removed' ? 'del' as const : 'set' as const, id: c.doc.id, data: c.doc.data() }))), onError);
  },
  async fetchAll(scope) {
    const col = fs.collection(firestoreDb, ROSTER_COL);
    const q = scope.kind === 'owner' ? fs.query(col, fs.where('ownerId', '==', scope.id)) : col;
    return (await fs.getDocs(q)).docs.map(d => ({ id: d.id, data: d.data() }));
  },
  async commit(ops) {
    for (let i = 0; i < ops.length; i += 400) {
      const b = fs.writeBatch(firestoreDb);
      ops.slice(i, i + 400).forEach(o => {
        const ref = fs.doc(firestoreDb, ROSTER_COL, o.id);
        if (o.type === 'set') b.set(ref, o.data); else b.delete(ref);
      });
      await b.commit();
    }
  },
};
let backend: RosterBackend = firestoreBackend;
/** Chỉ dùng cho kiểm thử. */
export const __setRosterBackend = (b: RosterBackend) => { backend = b; };

/* ---------- trạng thái đọc bảng kê (để giao diện báo lý do khi danh sách trống) ---------- */
export interface RosterStatus { scope: RosterScope; loaded: boolean; error?: string; permissionDenied?: boolean; areaDocs: number; households: number }
let rosterError: { message: string; denied: boolean } | undefined;
const statusListeners = new Set<(s: RosterStatus) => void>();
export const getRosterStatus = (): RosterStatus => ({ scope, loaded: rosterLoaded, error: rosterError?.message, permissionDenied: rosterError?.denied, areaDocs: rosterByArea.size, households: merged.length });
const emitStatus = () => { const st = getRosterStatus(); statusListeners.forEach(cb => { try { cb(st); } catch { /* bỏ qua */ } }); };
export const onRosterStatus = (cb: (s: RosterStatus) => void) => { statusListeners.add(cb); cb(getRosterStatus()); return () => { statusListeners.delete(cb); }; };
const describeError = (e: any) => {
  const denied = e?.code === 'permission-denied' || /permission|insufficient/i.test(String(e?.message || ''));
  return { denied, message: denied ? 'Firebase từ chối truy cập bảng kê (permission-denied): luật Firestore chưa được đăng hoặc chưa có khối "rosters".' : `Không đọc được bảng kê từ Firebase: ${e?.message || e}` };
};

const rosterByArea = new Map<string, RosterDoc>();
const rosterIndex = new Map<string, { areaId: string; row: any }>();    // id hộ -> dòng bảng kê
const mergedMap = new Map<string, any>();                                // id hộ -> hộ đã gộp (bảng kê + phiếu nhập)
let merged: any[] = [];
const mergedIndex = new Map<string, number>();                           // id hộ -> vị trí trong `merged`

let scope: RosterScope = { kind: 'none' };
let unsubRoster: (() => void) | null = null;
let rosterLoaded = false;
let loadedResolve: () => void = () => {};
let loadedPromise: Promise<void> = Promise.resolve();

const mergeRow = (row: any, e: any) => {
  const h: any = { ...row };
  for (const k of ENTRY_FIELDS) if (e[k] !== undefined) h[k] = e[k];
  if (e.localUpdatedAt) h.localUpdatedAt = e.localUpdatedAt;
  if (e.exportedAt) h.exportedAt = e.exportedAt;
  return h;
};

function rebuild() {
  rosterIndex.clear(); mergedMap.clear(); mergedIndex.clear();
  const out: any[] = [];
  for (const d of rosterByArea.values()) {
    for (const r of d.households) {
      rosterIndex.set(r.id, { areaId: d.areaId || d.id, row: r });
      const e = entries.get(r.id);
      const h = e ? mergeRow(r, e) : { ...r };
      mergedMap.set(r.id, h); mergedIndex.set(r.id, out.length); out.push(h);
    }
  }
  merged = out;
}

/** Chỉ phiếu thay đổi (bảng kê giữ nguyên): cập nhật đúng các hộ đó thay vì dựng lại cả danh sách. */
function patchMerged(ids: Iterable<string>) {
  const next = merged.slice();
  for (const id of ids) {
    const loc = rosterIndex.get(id), at = mergedIndex.get(id);
    if (!loc || at === undefined) continue;
    const e = entries.get(id);
    const h = e ? mergeRow(loc.row, e) : { ...loc.row };
    mergedMap.set(id, h); next[at] = h;
  }
  merged = next;
}

const normDoc = (id: string, data: any): RosterDoc => ({
  id, areaId: data.areaId || id, communeId: data.communeId, ownerId: data.ownerId || '', ownerName: data.ownerName || '',
  updatedAt: data.updatedAt, households: Array.isArray(data.households) ? data.households : [],
});

function applyChanges(changes: RosterChange[]) {
  for (const c of changes) {
    if (c.type === 'del') rosterByArea.delete(c.id); else rosterByArea.set(c.id, normDoc(c.id, c.data || {}));
  }
}

/**
 * Đặt phạm vi đọc bảng kê theo người đăng nhập:
 *  - { kind:'all' }            : quản trị / giám sát — đọc mọi địa bàn
 *  - { kind:'owner', id }      : điều tra viên — chỉ đọc địa bàn do mình phụ trách
 *  - { kind:'none' }           : chưa đăng nhập — không đọc gì
 */
export function setRosterScope(s: RosterScope) {
  if (sig(s) === sig(scope)) return;
  scope = s;
  unsubRoster?.(); unsubRoster = null;
  rosterByArea.clear(); rebuild();
  rosterLoaded = false; rosterError = undefined;
  loadedPromise = new Promise<void>(r => { loadedResolve = r; });
  if (s.kind === 'none') { rosterLoaded = true; loadedResolve(); notify(); emitStatus(); return; }
  emitStatus();
  unsubRoster = backend.subscribe(
    s,
    changes => { applyChanges(changes); rosterLoaded = true; rosterError = undefined; rebuild(); loadedResolve(); notify(); emitStatus(); },
    err => { console.warn('Không đọc được bảng kê từ Firebase:', err); rosterError = describeError(err); rosterLoaded = true; loadedResolve(); notify(); emitStatus(); },
  );
}

async function ensureRostersLoaded() {
  await storeReady;
  if (scope.kind === 'none') {                         // chưa đặt phạm vi: đọc một lần toàn bộ
    const rows = await backend.fetchAll({ kind: 'all' });
    rosterByArea.clear(); rows.forEach(r => rosterByArea.set(r.id, normDoc(r.id, r.data)));
    rebuild(); return;
  }
  await Promise.race([loadedPromise, new Promise<void>(r => setTimeout(r, 15000))]);
}

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
    if (listeners.size === 0 || !(rosterLoaded || scope.kind === 'none')) return;
    const snap = buildSnap();
    listeners.forEach(cb => { try { cb(snap); } catch (e) { console.warn(e); } });
  }, 0);
}

/* ================================================================== ghi hộ: tách bảng kê / phiếu nhập */

interface HhOp { id: string; data?: any; merge?: boolean; del?: boolean }

async function applyHouseholdOps(ops: HhOp[], opts: { preserveStamps?: boolean } = {}) {
  await storeReady;
  await ensureRostersLoaded();
  const now = new Date().toISOString();

  const work = new Map<string, RosterDoc>();
  const getWork = (areaId: string) => {
    let d = work.get(areaId);
    if (!d) {
      const base = rosterByArea.get(areaId);
      d = base ? { ...base, households: base.households.slice() } : { id: areaId, areaId, ownerId: '', ownerName: '', households: [] };
      work.set(areaId, d);
    }
    return d;
  };
  const entryPuts = new Map<string, any>(); const entryDels = new Set<string>();
  const stageIndex = new Map<string, { areaId: string; row: any }>();      // hộ vừa thêm trong cùng đợt

  for (const op of ops) {
    const loc = stageIndex.get(op.id) || rosterIndex.get(op.id);
    const prevEntry = entryPuts.get(op.id) ?? (entryDels.has(op.id) ? undefined : entries.get(op.id));

    if (op.del) {
      if (loc) { const d = getWork(loc.areaId); d.households = d.households.filter(r => r.id !== op.id); stageIndex.delete(op.id); }
      if (prevEntry) { entryDels.add(op.id); entryPuts.delete(op.id); }
      continue;
    }

    const cur = mergedMap.get(op.id);
    const next: any = op.merge ? { ...(cur || {}), ...op.data } : { ...op.data };
    next.id = op.id;
    const areaId: string | undefined = next.areaId || loc?.areaId;
    if (!areaId) { console.warn('Bỏ qua hộ không có địa bàn:', op.id); continue; }

    // ---- phần BẢNG KÊ
    const row: any = {};
    for (const k of Object.keys(next)) if (!ENTRY_SET.has(k) && !STAMP_FIELDS.has(k)) row[k] = next[k];
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

  // ---- bảng kê -> Firebase (chỉ địa bàn có thay đổi)
  const fsOps: RosterChange[] = [];
  for (const [areaId, d] of work) {
    const orig = rosterByArea.get(areaId);
    if (orig && sig(orig.households) === sig(d.households)) continue;
    if (d.households.length === 0) {
      if (orig) { fsOps.push({ type: 'del', id: areaId }); rosterByArea.delete(areaId); }
      continue;
    }
    const count = new Map<string, { n: number; name: string }>();
    d.households.forEach(r => { if (r.assignedSurveyorId) { const c = count.get(r.assignedSurveyorId) || { n: 0, name: r.assignedSurveyorName || '' }; c.n++; count.set(r.assignedSurveyorId, c); } });
    const top = Array.from(count.entries()).sort((a, b) => b[1].n - a[1].n)[0];
    const doc: RosterDoc = { ...d, communeId: d.communeId || d.households[0]?.communeId, ownerId: top ? top[0] : '', ownerName: top ? top[1].name : '', updatedAt: now };
    rosterByArea.set(areaId, doc);
    fsOps.push({ type: 'set', id: areaId, data: clean({ ...doc, households: doc.households }) });
  }
  if (fsOps.length === 0) patchMerged([...puts.map(p => p.id), ...dels]); else rebuild();
  notify();

  if (fsOps.length) {
    // Không để giao diện treo khi mất mạng: ghi vẫn tiếp tục chạy nền, lỗi thật thì báo lên.
    const p = backend.commit(fsOps);
    p.catch(e => { rosterError = describeError(e); emitStatus(); });
    const t = new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 12000));
    const r = await Promise.race([p.then(() => 'ok' as const), t]);
    if (r === 'timeout') { console.warn('Ghi bảng kê lên Firebase chưa xong sau 12 giây (có thể đang mất mạng); sẽ tự gửi khi có mạng.'); p.catch(e => console.warn('Ghi bảng kê thất bại:', e)); }
  }
  return { areasWritten: fsOps.length, entriesWritten: puts.length };
}

/* ================================================================== API tương thích Firestore */

interface LocalRef { __local: true; col: 'households'; id?: string }
const isLocalRef = (r: any): r is LocalRef => !!r && r.__local === true;

export const collection = ((firestore: any, path: string, ...rest: string[]) =>
  path === 'households' && rest.length === 0 ? ({ __local: true, col: 'households' } as LocalRef) : (fs.collection as any)(firestore, path, ...rest)) as typeof fs.collection;

export const doc = ((first: any, path?: string, ...rest: string[]) => {
  if (isLocalRef(first)) return { __local: true, col: 'households', id: path ?? crypto.randomUUID() } as LocalRef;
  if (typeof path === 'string' && path === 'households' && rest.length === 1) return { __local: true, col: 'households', id: rest[0] } as LocalRef;
  return (fs.doc as any)(first, path, ...rest);
}) as typeof fs.doc;

export const query = ((ref: any, ...c: any[]) => (isLocalRef(ref) ? ref : (fs.query as any)(ref, ...c))) as typeof fs.query;

export const setDoc = (async (ref: any, data: any, options?: any) => {
  if (isLocalRef(ref)) { await applyHouseholdOps([{ id: ref.id!, data, merge: !!options?.merge }]); return; }
  return (fs.setDoc as any)(ref, data, options);
}) as typeof fs.setDoc;

export const addDoc = (async (ref: any, data: any) => {
  if (isLocalRef(ref)) { const id = crypto.randomUUID(); await applyHouseholdOps([{ id, data }]); return { id }; }
  return (fs.addDoc as any)(ref, data);
}) as typeof fs.addDoc;

export const deleteDoc = (async (ref: any) => {
  if (isLocalRef(ref)) { await applyHouseholdOps([{ id: ref.id!, del: true }]); return; }
  return (fs.deleteDoc as any)(ref);
}) as typeof fs.deleteDoc;

export const getDoc = (async (ref: any) => {
  if (isLocalRef(ref)) {
    await ensureRostersLoaded();
    const v = mergedMap.get(ref.id!);
    return { id: ref.id, exists: () => !!v, data: () => { if (!v) return undefined; const { id: _i, ...rest } = v; return rest; } };
  }
  return (fs.getDoc as any)(ref);
}) as typeof fs.getDoc;

export const getDocs = (async (ref: any) => {
  if (isLocalRef(ref)) { await ensureRostersLoaded(); return buildSnap(); }
  return (fs.getDocs as any)(ref);
}) as typeof fs.getDocs;

export const onSnapshot = ((ref: any, next: any, error?: any) => {
  if (isLocalRef(ref)) {
    listeners.add(next);
    storeReady.then(() => { if (listeners.has(next) && (rosterLoaded || scope.kind === 'none')) next(buildSnap()); });
    return () => { listeners.delete(next); };
  }
  return (fs.onSnapshot as any)(ref, next, error);
}) as typeof fs.onSnapshot;

export const writeBatch = ((firestore: any) => {
  const hhOps: HhOp[] = [];
  let remote: ReturnType<typeof fs.writeBatch> | null = null;
  const rb = () => (remote ??= fs.writeBatch(firestore));
  const api: any = {
    set(ref: any, data: any, options?: any) { if (isLocalRef(ref)) hhOps.push({ id: ref.id!, data, merge: !!options?.merge }); else (rb() as any).set(ref, data, options); return api; },
    update(ref: any, data: any) { if (isLocalRef(ref)) hhOps.push({ id: ref.id!, data, merge: true }); else (rb() as any).update(ref, data); return api; },
    delete(ref: any) { if (isLocalRef(ref)) hhOps.push({ id: ref.id!, del: true }); else (rb() as any).delete(ref); return api; },
    async commit() {
      if (remote) await remote.commit();
      if (hhOps.length) await applyHouseholdOps(hhOps);
    },
  };
  return api;
}) as typeof fs.writeBatch;

/* ================================================================== API riêng cho đồng bộ file / sao lưu */

/** Danh sách hộ đã gộp (bảng kê + phiếu nhập). */
export const readLocal = async <T = any>(_col: 'households' = 'households'): Promise<T[]> => { await ensureRostersLoaded(); return merged.slice() as T[]; };
/** Chỉ các bản ghi phiếu nhập trên máy này. */
export const readEntries = async (): Promise<any[]> => { await storeReady; return Array.from(entries.values()); };

/**
 * Nhập phiếu từ file (của ĐTV gửi / từ file sao lưu) vào trình duyệt: GIỮ NGUYÊN dấu thời gian gốc và coi như đã đồng bộ.
 * Không động tới bảng kê trên Firebase; hộ không có trong bảng kê thì bỏ qua và đếm lại.
 */
export async function importEntryRows(rows: any[]): Promise<{ written: number; missingInRoster: number }> {
  await storeReady; await ensureRostersLoaded();
  const puts: any[] = []; let missing = 0;
  for (const r of rows) {
    if (!mergedMap.has(r.id)) { missing++; continue; }
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

/** Xóa toàn bộ phiếu nhập trên máy này (KHÔNG xóa bảng kê trên Firebase). */
export async function wipeEntries() {
  await storeReady;
  const ids = Array.from(entries.keys());
  entries.clear();
  await persistEntries([], ids);
  rebuild(); notify();
}

/* ================================================================== chuyển dữ liệu từ các bản cũ */

/** Đẩy bảng kê (và phiếu) vào Firebase/trình duyệt theo cấu trúc mới. */
async function pushHouseholds(rows: any[], onProgress?: (m: string) => void) {
  const CH = 2000;
  let areas = 0, entriesN = 0;
  for (let i = 0; i < rows.length; i += CH) {
    onProgress?.(`Đang chuyển hộ ${Math.min(i + CH, rows.length)}/${rows.length}...`);
    const r = await applyHouseholdOps(
      rows.slice(i, i + CH).map(h => ({ id: h.id, data: { ...h, localUpdatedAt: h.localUpdatedAt || h.updatedAt, exportedAt: h.exportedAt }, merge: false })),
      { preserveStamps: true });
    areas += r.areasWritten; entriesN += r.entriesWritten;
  }
  return { areas, entries: entriesN };
}

/** Nơi đọc/ghi Firestore trực tiếp cho phần chuyển dữ liệu cũ (thay được khi kiểm thử). */
export interface LegacyIO {
  write(col: string, rows: { id: string; [k: string]: any }[]): Promise<void>;
  read(col: string): Promise<{ id: string; [k: string]: any }[]>;
}
const firestoreLegacyIO: LegacyIO = {
  async write(col, rows) {
    for (let i = 0; i < rows.length; i += 400) {
      const b = fs.writeBatch(firestoreDb);
      rows.slice(i, i + 400).forEach(r => { const { id, ...rest } = r; b.set(fs.doc(firestoreDb, col, id), clean(rest)); });
      await b.commit();
    }
  },
  async read(col) {
    const snap = await fs.getDocs(fs.collection(firestoreDb, col));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  },
};
let legacyIO: LegacyIO = firestoreLegacyIO;
export const __setLegacyIO = (io: LegacyIO) => { legacyIO = io; };

/** Bản trước đây lưu bảng kê + phiếu trong IndexedDB 'thongke_local_v1' của trình duyệt này: đẩy bảng kê lên Firebase, phiếu giữ ở máy. */
export async function migrateFromLegacyLocal(onProgress?: (m: string) => void) {
  await storeReady;
  const legacy: { households: any[]; surveyAreas: any[]; communes: any[] } | null = await new Promise(resolve => {
    const req = indexedDB.open('thongke_local_v1');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const d = req.result;
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
  onProgress?.('Đang đẩy xã và địa bàn lên Firebase...');
  await legacyIO.write('communes', legacy.communes);
  await legacyIO.write('surveyAreas', legacy.surveyAreas);
  const r = await pushHouseholds(legacy.households, onProgress);
  return { found: true, households: legacy.households.length, areasDocs: r.areas, communes: legacy.communes.length, surveyAreas: legacy.surveyAreas.length };
}

/** Bản gốc lưu mỗi hộ một tài liệu trong collection 'households' của Firestore: đọc về, tách thành bảng kê theo địa bàn + phiếu nhập. */
export async function migrateFromLegacyFirestore(onProgress?: (m: string) => void) {
  await storeReady;
  onProgress?.("Đang đọc collection 'households' cũ từ Firestore...");
  const rows = await legacyIO.read('households');
  if (rows.length === 0) return { found: false, households: 0, areasDocs: 0 };
  const r = await pushHouseholds(rows, onProgress);
  return { found: true, households: rows.length, areasDocs: r.areas };
}
