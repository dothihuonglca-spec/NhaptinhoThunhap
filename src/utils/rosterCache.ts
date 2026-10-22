/**
 * rosterCache — Lưu bảng kê (communes, surveyAreas, rosters) vào IndexedDB local
 * để đọc trước, giảm lượt đọc Firebase. Phân quyền vẫn đọc Firebase như cũ.
 *
 * Các bảng kê được cache:
 *  - communes: xã/phường
 *  - surveyAreas: địa bàn (mã sheet)
 *  - rosters: bảng kê theo địa bàn, mỗi bản có mảng households
 */

import { EMBEDDED_ROSTER_DATA } from '../data/embeddedRosterData';
import type { EmbeddedRosterData } from '../data/embeddedRosterData';

const DB_NAME = 'thongke_roster_cache_v1';
const STORE_COMMUNES = 'communes';
const STORE_AREAS = 'surveyAreas';
const STORE_ROSTERS = 'rosters';
const STORE_META = 'meta';

let idbInstance: IDBDatabase | null = null;
let idbReady: Promise<void> | null = null;

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of [STORE_COMMUNES, STORE_AREAS, STORE_ROSTERS, STORE_META]) {
        if (!d.objectStoreNames.contains(s)) {
          d.createObjectStore(s, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function ensureIDB(): Promise<IDBDatabase> {
  if (idbInstance) return idbInstance;
  if (idbReady) { await idbReady; return idbInstance!; }
  idbReady = (async () => {
    idbInstance = await openIDB();
  })();
  await idbReady;
  return idbInstance!;
}

async function idbGetAll(storeName: string): Promise<any[]> {
  const d = await ensureIDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, 'readonly');
    const os = tx.objectStore(storeName);
    const req = os.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName: string, items: any[]): Promise<void> {
  const d = await ensureIDB();
  const tx = d.transaction(storeName, 'readwrite');
  const os = tx.objectStore(storeName);
  items.forEach((it) => os.put(it));
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function idbClear(storeName: string): Promise<void> {
  const d = await ensureIDB();
  const tx = d.transaction(storeName, 'readwrite');
  const os = tx.objectStore(storeName);
  os.clear();
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export interface CachedRosterData {
  version: number;
  cachedAt: string;
  communes: any[];
  surveyAreas: any[];
  rosters: any[];
}

/** Lưu xã vào IndexedDB (không xóa collections khác). */
export async function saveCommunes(communes: any[]): Promise<void> {
  await idbClear(STORE_COMMUNES);
  await idbPut(STORE_COMMUNES, communes.map((c: any) => ({ ...c, id: c.id || `commune-${Math.random()}` })));
  await saveMeta();
}

/** Lưu địa bàn vào IndexedDB (không xóa collections khác). */
export async function saveAreas(areas: any[]): Promise<void> {
  await idbClear(STORE_AREAS);
  await idbPut(STORE_AREAS, areas.map((a: any) => ({ ...a, id: a.id || `area-${Math.random()}` })));
  await saveMeta();
}

/** Lưu rosters (bảng kê theo địa bàn) vào IndexedDB (không xóa collections khác). */
export async function saveRosters(rosters: any[]): Promise<void> {
  await idbClear(STORE_ROSTERS);
  await idbPut(
    STORE_ROSTERS,
    rosters.map((r: any) => ({ ...r, id: r.id || `roster-${Math.random()}` }))
  );
  await saveMeta();
}

async function saveMeta(): Promise<void> {
  await idbPut(STORE_META, [{ id: 'meta', version: 1, cachedAt: new Date().toISOString() }]);
}

/**
 * Lưu toàn bộ bảng kê xuống IndexedDB local (ghi đè tất cả).
 * Gọi sau khi nhập file JSON từ máy khác.
 */
export async function cacheRosterData(data: {
  communes: any[];
  surveyAreas: any[];
  rosters: any[];
}): Promise<void> {
  await saveCommunes(data.communes);
  await saveAreas(data.surveyAreas);
  await saveRosters(data.rosters);
}

/**
 * Đọc toàn bộ bảng kê từ IndexedDB local.
 * Trả về null nếu chưa có dữ liệu.
 */
export async function getCachedRosterData(): Promise<CachedRosterData | null> {
  try {
    const [communes, areas, rosters, metaRows] = await Promise.all([
      idbGetAll(STORE_COMMUNES),
      idbGetAll(STORE_AREAS),
      idbGetAll(STORE_ROSTERS),
      idbGetAll(STORE_META),
    ]);

    if (communes.length === 0 && areas.length === 0 && rosters.length === 0) {
      return null;
    }

    const meta = metaRows.find((m: any) => m.id === 'meta');
    return {
      version: meta?.version ?? 1,
      cachedAt: meta?.cachedAt ?? new Date().toISOString(),
      communes,
      surveyAreas: areas,
      rosters,
    };
  } catch {
    return null;
  }
}

/** Xóa toàn bộ bảng kê cache trong máy (dùng khi muốn reset về Firebase). */
export async function clearCachedRosterData(): Promise<void> {
  await Promise.all([
    idbClear(STORE_COMMUNES),
    idbClear(STORE_AREAS),
    idbClear(STORE_ROSTERS),
    idbClear(STORE_META),
  ]);
}

/**
 * Đọc dữ liệu bảng kê nhúng từ mã nguồn (file src/data/embeddedRosterData.ts).
 * Trả về null nếu mảng rosters rỗng (chưa có dữ liệu thật).
 */
export function loadEmbeddedRosterData(): EmbeddedRosterData | null {
  const data = EMBEDDED_ROSTER_DATA;
  if (!data || !Array.isArray(data.rosters) || data.rosters.length === 0) {
    return null;
  }
  return data;
}

/**
 * Đọc file bảng kê JSON từ thư mục public/ (ví dụ public/bangke.json).
 * Trả về null nếu file không tồn tại hoặc lỗi.
 */
export async function fetchRosterFromPublic(fileName: string): Promise<EmbeddedRosterData | null> {
  try {
    const res = await fetch(`/${fileName}`);
    if (!res.ok) return null;
    const data = (await res.json()) as EmbeddedRosterData;
    if (!data || !Array.isArray(data.rosters) || data.rosters.length === 0) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Xuất toàn bộ bảng kê hiện tại trong máy ra file JSON Blob.
 * Dùng để gửi cho admin nhập tại các máy khác.
 */
export async function exportRosterToJson(): Promise<{ blob: Blob; name: string }> {
  const data = await getCachedRosterData();
  if (!data) {
    throw new Error('Không có dữ liệu bảng kê trong máy để xuất.');
  }
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const name = `bangke_${new Date().toISOString().slice(0, 10)}.json`;
  return { blob, name };
}

/**
 * Nhập file JSON từ máy cục bộ vào IndexedDB (ghi đè toàn bộ bảng kê cũ).
 * Không động tới phân quyền Firebase.
 */
export async function importRosterFromJson(file: File): Promise<{
  communes: number;
  surveyAreas: number;
  households: number;
}> {
  const text = await file.text();
  const data = JSON.parse(text) as CachedRosterData;
  if (!data.communes || !data.surveyAreas || !data.rosters) {
    throw new Error('File JSON không đúng định dạng bảng kê.');
  }

  await clearCachedRosterData();
  await cacheRosterData({
    communes: data.communes,
    surveyAreas: data.surveyAreas,
    rosters: data.rosters,
  });

  const households = data.rosters.reduce(
    (n: number, r: any) => n + (Array.isArray(r.households) ? r.households.length : 0),
    0
  );

  return {
    communes: data.communes.length,
    surveyAreas: data.surveyAreas.length,
    households,
  };
}
