/**
 * listingLocalService — Bộ Service đọc/lưu dữ liệu Bảng kê hoàn toàn offline/local
 *
 * Chức năng:
 *  1. getListingData()        : Đọc dữ liệu từ LocalStorage/IndexedDB, fallback về Master List
 *  2. saveListingHousehold()  : Lưu/cập nhật một hộ vào local
 *  3. updateListingData()     : Cập nhật bulk danh sách hộ vào local
 *  4. syncProgressToFirebase(): Gửi bản tổng hợp tiến độ nhẹ lên Firebase (không đẩy chi tiết hộ)
 *  5. getListingProgressSummary(): Lấy tổng kết tiến độ local
 *
 * Lưu trữ:
 *  - Chi tiết hộ: IndexedDB (db name: 'thongke_listing_v1', store: 'households')
 *  - Meta/tiến độ: LocalStorage (key: 'listing_meta_*')
 *  - Dữ liệu mặc định: src/data/masterListingData.ts
 */

import type { Household, SurveyArea, Commune } from '../App';
import { isOfficialHousehold } from '../utils/sampleStatus';
import { MASTER_LISTING_AREAS } from '../data/masterListingData';
import {
  buildActualHouseholds,
  normalizeActualHousehold,
  leftJoinHouseholdsToAreas
} from '../data/actualListingData';
import { OFFICIAL_COMMUNES_CATALOG } from '../data/communesCatalog';
import { db, auth } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

/* =========================================================================
   CẤU HÌNH INDEXEDDB & LOCALSTORAGE
   ========================================================================= */

const IDB_NAME = 'thongke_listing_v1';
const IDB_STORE_HH = 'households';
const IDB_STORE_AREA = 'areas';
const IDB_STORE_COMMUNE = 'communes';

let idbInstance: IDBDatabase | null = null;
let idbReady: Promise<void> | null = null;

/** LocalStorage keys */
const LS_KEY_HOUSEHOLDS = 'listing_local_households';
const LS_KEY_AREAS = 'listing_local_areas';
const LS_KEY_COMMUNES = 'listing_local_communes';
const LS_KEY_META = 'listing_local_meta';
const LS_KEY_INITIALIZED = 'listing_local_initialized';

/* =========================================================================
   INDEXEDDB HELPERS
   ========================================================================= */

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(IDB_STORE_HH)) d.createObjectStore(IDB_STORE_HH, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(IDB_STORE_AREA)) d.createObjectStore(IDB_STORE_AREA, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(IDB_STORE_COMMUNE)) d.createObjectStore(IDB_STORE_COMMUNE, { keyPath: 'id' });
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

function idbTransaction(storeName: string, mode: IDBTransactionMode) {
  return (dbInst: IDBDatabase) =>
    new Promise<IDBObjectStore>((resolve, reject) => {
      const tx = dbInst.transaction(storeName, mode);
      tx.oncomplete = () => resolve(tx.objectStore(storeName));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      resolve(tx.objectStore(storeName));
    });
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
  items.forEach(it => os.put(it));
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

/* =========================================================================
   LOAD / SAVE DỮ LIỆU BẢNG KÊ (LocalFirst)
   ========================================================================= */

/**
 * Kiểm tra xem dữ liệu local đã được khởi tạo hay chưa.
 */
export function isListingInitialized(): boolean {
  try {
    return localStorage.getItem(LS_KEY_INITIALIZED) === 'true';
  } catch { return false; }
}

/**
 * Đánh dấu dữ liệu local đã khởi tạo.
 */
export function markListingInitialized(): void {
  try { localStorage.setItem(LS_KEY_INITIALIZED, 'true'); } catch {}
}

/**
 * Lấy timestamp hiện tại (ISO string).
 */
function nowISO(): string {
  return new Date().toISOString();
}

/** Tổng kết thống kê từ danh sách hộ thực tế (không dựa trên mock). */
function buildListingStats(households: Household[], areas: SurveyArea[], communes: Commune[]) {
  const totalHH = households.length;
  const officialHH = households.filter(isOfficialHousehold).length;
  const reserveHH = totalHH - officialHH;
  return {
    totalCommunes: communes.length,
    totalAreas: areas.length,
    totalHouseholds: totalHH,
    totalOfficialHH: officialHH,
    totalReserveHH: reserveHH,
    generatedAt: nowISO(),
    lastSyncedAt: nowISO()
  };
}

/**
 * getListingData()
 *  - Đầu tiên kiểm tra LocalStorage/IndexedDB (bản ghi do người dùng nhập/chỉnh sửa).
 *  - Nếu ĐÃ CÓ: Trả về dữ liệu mới nhất từ local.
 *  - Nếu CHƯA CÓ: Tải dữ liệu mặc định từ masterListingData và lưu khởi tạo vào Local.
 *
 * Trả về: { households, areas, communes, stats, source: 'local' | 'master' }
 */
export async function getListingData(): Promise<{
  households: Household[];
  areas: SurveyArea[];
  communes: Commune[];
  stats: {
    totalCommunes: number;
    totalAreas: number;
    totalHouseholds: number;
    totalOfficialHH: number;
    totalReserveHH: number;
    generatedAt: string;
    lastSyncedAt: string;
  };
  source: 'local' | 'master';
  loadedAt: string;
}> {
  // 1. Thử đọc từ LocalStorage trước (nhanh nhất)
  try {
    const lsHh = localStorage.getItem(LS_KEY_HOUSEHOLDS);
    const lsArea = localStorage.getItem(LS_KEY_AREAS);
    const lsCom = localStorage.getItem(LS_KEY_COMMUNES);
    const lsMeta = localStorage.getItem(LS_KEY_META);

    if (lsHh && lsArea && lsCom && lsMeta) {
      const households = JSON.parse(lsHh) as Household[];
      const areas = JSON.parse(lsArea) as SurveyArea[];
      const communes = JSON.parse(lsCom) as Commune[];
      const meta = JSON.parse(lsMeta) as { initializedAt: string; updatedAt: string; version: number };

      if (Array.isArray(households) && households.length > 0) {
        return {
          households,
          areas,
          communes,
          stats: {
            ...buildListingStats(households, areas, communes),
            lastSyncedAt: meta?.updatedAt || nowISO()
          },
          source: 'local',
          loadedAt: nowISO()
        };
      }
    }
  } catch (e) {
    console.warn('[listingLocalService] Lỗi đọc LocalStorage:', e);
  }

  // 2. Thử đọc từ IndexedDB (nếu LocalStorage trống/hỏng)
  try {
    const idbHh = await idbGetAll(IDB_STORE_HH);
    const idbArea = await idbGetAll(IDB_STORE_AREA);
    const idbCom = await idbGetAll(IDB_STORE_COMMUNE);

    if (idbHh.length > 0 && idbArea.length > 0) {
      return {
        households: idbHh as Household[],
        areas: idbArea as SurveyArea[],
        communes: idbCom as Commune[],
        stats: buildListingStats(idbHh, idbArea, idbCom),
        source: 'local',
        loadedAt: nowISO()
      };
    }
  } catch (e) {
    console.warn('[listingLocalService] Lỗi đọc IndexedDB:', e);
  }

  // 3. Chưa có dữ liệu local → xây dựng dữ liệu hộ thật từ Danh mục xã (không mock)
  const households = buildActualHouseholds(MASTER_LISTING_AREAS).map(normalizeActualHousehold);
  const areas = MASTER_LISTING_AREAS;
  const communes = OFFICIAL_COMMUNES_CATALOG;

  // Lưu vào LocalStorage (đồng bộ, nhanh)
  try {
    localStorage.setItem(LS_KEY_HOUSEHOLDS, JSON.stringify(households));
    localStorage.setItem(LS_KEY_AREAS, JSON.stringify(areas));
    localStorage.setItem(LS_KEY_COMMUNES, JSON.stringify(communes));
    localStorage.setItem(LS_KEY_META, JSON.stringify({
      initializedAt: nowISO(),
      updatedAt: nowISO(),
      version: 1
    }));
    markListingInitialized();
  } catch (e) {
    console.warn('[listingLocalService] Không lưu được LocalStorage:', e);
  }

  // Lưu vào IndexedDB (bền hơn, chứa nhiều dữ liệu hơn)
  try {
    await idbPut(IDB_STORE_HH, households);
    await idbPut(IDB_STORE_AREA, areas);
    await idbPut(IDB_STORE_COMMUNE, communes);
  } catch (e) {
    console.warn('[listingLocalService] Không lưu được IndexedDB:', e);
  }

  return {
    households,
    areas,
    communes,
    stats: buildListingStats(households, areas, communes),
    source: 'master',
    loadedAt: nowISO()
  };
}

/**
 * saveListingHousehold(householdData)
 *  - Cập nhật trực tiếp thông tin một hộ vào LocalStorage + IndexedDB.
 *  - Tự động cập nhật trạng thái/tiến độ hoàn thành local.
 */
export async function saveListingHousehold(householdData: Partial<Household> & { id: string; isMasterListing?: boolean; isReserveHousehold?: boolean; createdAt?: string }): Promise<{
  success: boolean;
  household: Household | null;
  error?: string;
}> {
  if (!householdData.id) {
    return { success: false, household: null, error: 'Thiếu ID hộ gia đình' };
  }

  try {
    // Chuẩn hóa dữ liệu hộ
    const base: any = {
      id: householdData.id,
      communeId: householdData.communeId || '',
      communeCode: householdData.communeCode || '',
      communeName: householdData.communeName || '',
      tkcsCode: householdData.tkcsCode || '',
      tkcsName: householdData.tkcsName || '',
      areaId: householdData.areaId || '',
      areaCode: householdData.areaCode || '001',
      areaName: householdData.areaName || '',
      sheetName: householdData.sheetName || householdData.areaName || '',
      sttMau: householdData.sttMau || '',
      sampleStatus: householdData.sampleStatus || 'CHÍNH THỨC',
      sttGoc: householdData.sttGoc || '',
      householdHead: householdData.householdHead || '',
      address: householdData.address || '',
      phone: householdData.phone || '',
      membersCount: householdData.membersCount ?? 0,
      workingMembersCount: householdData.workingMembersCount ?? 0,
      membersCountEntered: householdData.membersCountEntered ?? false,
      sectorCode: householdData.sectorCode ?? 1,
      sectorName: householdData.sectorName || '',
      note: householdData.note || '',
      assignedSurveyorId: householdData.assignedSurveyorId,
      assignedSurveyorName: householdData.assignedSurveyorName,
      surveyStatus: householdData.surveyStatus || 'CHUA_NHAP',
      updatedBy: householdData.updatedBy,
      updatedAt: nowISO(),
      questionnaire: householdData.questionnaire,
      isMasterListing: householdData.isMasterListing ?? true,
      isReserveHousehold: householdData.isReserveHousehold ?? false,
      createdAt: householdData.createdAt || nowISO()
    };
    const normalized: Household = base;

    // Lưu vào LocalStorage (cập nhật mảng)
    try {
      const lsHh = localStorage.getItem(LS_KEY_HOUSEHOLDS);
      let households: Household[] = [];
      if (lsHh) {
        households = JSON.parse(lsHh) as Household[];
      }
      const idx = households.findIndex(h => h.id === normalized.id);
      if (idx >= 0) {
        households[idx] = normalized;
      } else {
        households.push(normalized);
      }
      localStorage.setItem(LS_KEY_HOUSEHOLDS, JSON.stringify(households));

      // Cập nhật meta
      const lsMeta = localStorage.getItem(LS_KEY_META);
      const meta = lsMeta ? JSON.parse(lsMeta) : { version: 1, initializedAt: nowISO() };
      meta.updatedAt = nowISO();
      localStorage.setItem(LS_KEY_META, JSON.stringify(meta));
    } catch (e) {
      console.warn('[listingLocalService] Lỗi cập nhật LocalStorage:', e);
    }

    // Lưu vào IndexedDB
    try {
      await idbPut(IDB_STORE_HH, [normalized]);
    } catch (e) {
      console.warn('[listingLocalService] Lỗi cập nhật IndexedDB:', e);
    }

    return { success: true, household: normalized };
  } catch (e: any) {
    return { success: false, household: null, error: e.message || 'Lỗi không xác định' };
  }
}

/**
 * updateListingData(newList)
 *  - Cập nhật bulk danh sách hộ vào local (LocalStorage + IndexedDB).
 *  - Dùng khi nhập dữ liệu từ file hoặc đồng bộ hàng loạt.
 */
export async function updateListingData(newList: Household[]): Promise<{
  success: boolean;
  saved: number;
  error?: string;
}> {
  try {
    // Chuẩn hóa tất cả hộ
    const normalized = newList.map(hh => normalizeActualHousehold(hh));

    // Lưu vào LocalStorage
    try {
      localStorage.setItem(LS_KEY_HOUSEHOLDS, JSON.stringify(normalized));
      const meta = {
        version: 1,
        initializedAt: nowISO(),
        updatedAt: nowISO(),
        totalHouseholds: normalized.length
      };
      localStorage.setItem(LS_KEY_META, JSON.stringify(meta));
      markListingInitialized();
    } catch (e) {
      console.warn('[listingLocalService] Lỗi ghi LocalStorage:', e);
    }

    // Lưu vào IndexedDB
    try {
      await idbClear(IDB_STORE_HH);
      await idbPut(IDB_STORE_HH, normalized);
    } catch (e) {
      console.warn('[listingLocalService] Lỗi ghi IndexedDB:', e);
    }

    return { success: true, saved: normalized.length };
  } catch (e: any) {
    return { success: false, saved: 0, error: e.message || 'Lỗi không xác định' };
  }
}

/**
 * getListingProgressSummary()
 *  - Lấy tổng kết tiến độ local: tổng hộ, đã nhập, chưa nhập, theo địa bàn...
 */
export async function getListingProgressSummary(): Promise<{
  totalHouseholds: number;
  totalOfficialHH: number;
  totalReserveHH: number;
  completedHH: number;
  inProgressHH: number;
  notStartedHH: number;
  totalAreas: number;
  areasCompleted: number;
  overallRate: number;
  lastUpdated: string;
  source: 'local' | 'master';
}> {
  const data = await getListingData();
  const { households, areas } = data;

  const totalHH = households.length;
  const officialHH = households.filter(isOfficialHousehold);
  const reserveHH = households.filter(h => !isOfficialHousehold(h));

  const completed = officialHH.filter(h =>
    h.surveyStatus === 'DA_HOAN_THANH' || h.surveyStatus === 'DA_DUYET'
  ).length;
  const inProgress = officialHH.filter(h => h.surveyStatus === 'DANG_NHAP').length;
  const notStarted = officialHH.length - completed - inProgress;

  // Tính theo địa bàn
  const areaIds = new Set(households.map(h => h.areaId || h.areaCode).filter(Boolean));
  const areasWithData = areaIds.size;
  let areasCompleted = 0;
  for (const aid of areaIds) {
    const areaHHs = households.filter(h => (h.areaId || h.areaCode) === aid);
    const areaOfficial = areaHHs.filter(isOfficialHousehold);
    const areaDone = areaOfficial.filter(h =>
      h.surveyStatus === 'DA_HOAN_THANH' || h.surveyStatus === 'DA_DUYET'
    ).length;
    if (areaOfficial.length > 0 && areaDone === areaOfficial.length) areasCompleted++;
  }

  const overallRate = officialHH.length > 0 ? Math.round(((completed + inProgress) / officialHH.length) * 100) : 0;

  return {
    totalHouseholds: totalHH,
    totalOfficialHH: officialHH.length,
    totalReserveHH: reserveHH.length,
    completedHH: completed,
    inProgressHH: inProgress,
    notStartedHH: notStarted,
    totalAreas: areas.length,
    areasCompleted,
    overallRate,
    lastUpdated: data.stats.lastSyncedAt || nowISO(),
    source: data.source
  };
}

/**
 * syncProgressToFirebase(summaryData)
 *  - Sau khi lưu thông tin hộ ở local, chỉ gửi duy nhất bản tổng hợp tiến độ nhẹ
 *    (số hộ hoàn thành, ID địa bàn, trạng thái, thời gian cập nhật) lên Firebase.
 *  - KHÔNG đẩy toàn bộ bảng kê chi tiết lên Firebase.
 */
export async function syncProgressToFirebase(summaryData: {
  areaId: string;
  areaCode: string;
  communeCode: string;
  totalHouseholds: number;
  completedHouseholds: number;
  inProgressHouseholds: number;
  notStartedHouseholds: number;
  completionRate: number;
  updatedBy?: string;
  updatedAt?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const user = auth.currentUser;
    const uid = user?.uid || summaryData.updatedBy || 'system';
    const docId = `progress_${summaryData.areaId || summaryData.areaCode}`;

    const payload = {
      areaId: summaryData.areaId,
      areaCode: summaryData.areaCode,
      communeCode: summaryData.communeCode,
      totalHouseholds: summaryData.totalHouseholds,
      completedHouseholds: summaryData.completedHouseholds,
      inProgressHouseholds: summaryData.inProgressHouseholds,
      notStartedHouseholds: summaryData.notStartedHouseholds,
      completionRate: summaryData.completionRate,
      updatedBy: uid,
      updatedAt: summaryData.updatedAt || nowISO(),
      syncedAt: serverTimestamp(),
      source: 'local_first'
    };

    // Ghi lên Firebase collection 'listing_progress' (chỉ tổng hợp, không chi tiết hộ)
    const ref = doc(db, 'listing_progress', docId);
    await setDoc(ref, payload, { merge: true });

    // Cập nhật meta local đánh dấu đã sync
    try {
      const lsMeta = localStorage.getItem(LS_KEY_META);
      const meta = lsMeta ? JSON.parse(lsMeta) : {};
      meta.lastFirebaseSync = nowISO();
      localStorage.setItem(LS_KEY_META, JSON.stringify(meta));
    } catch {}

    return { success: true };
  } catch (e: any) {
    console.warn('[listingLocalService] Lỗi sync progress lên Firebase:', e);
    return { success: false, error: e.message || 'Lỗi sync Firebase' };
  }
}

/**
 * syncAllProgressToFirebase()
 *  - Đồng bộ toàn bộ tiến độ từng địa bàn lên Firebase (bản tổng hợp nhẹ).
 */
export async function syncAllProgressToFirebase(): Promise<{
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}> {
  const data = await getListingData();
  const { households } = data;

  // Gom tiến độ theo địa bàn
  const areaProgress = new Map<string, {
    areaId: string; areaCode: string; communeCode: string;
    total: number; completed: number; inProgress: number; notStarted: number;
  }>();

  households.forEach(h => {
    const key = h.areaId || h.areaCode || 'unknown';
    if (!areaProgress.has(key)) {
      areaProgress.set(key, {
        areaId: h.areaId || key,
        areaCode: h.areaCode || '001',
        communeCode: h.communeCode || '',
        total: 0, completed: 0, inProgress: 0, notStarted: 0
      });
    }
    const p = areaProgress.get(key)!;
    p.total++;
    if (h.surveyStatus === 'DA_HOAN_THANH' || h.surveyStatus === 'DA_DUYET') p.completed++;
    else if (h.surveyStatus === 'DANG_NHAP') p.inProgress++;
    else p.notStarted++;
  });

  let synced = 0, failed = 0;
  const errors: string[] = [];

  for (const [, p] of areaProgress) {
    const rate = p.total > 0 ? Math.round(((p.completed + p.inProgress) / p.total) * 100) : 0;
    const result = await syncProgressToFirebase({
      areaId: p.areaId,
      areaCode: p.areaCode,
      communeCode: p.communeCode,
      totalHouseholds: p.total,
      completedHouseholds: p.completed,
      inProgressHouseholds: p.inProgress,
      notStartedHouseholds: p.notStarted,
      completionRate: rate
    });
    if (result.success) synced++;
    else { failed++; errors.push(result.error || 'Lỗi không xác định'); }
  }

  return { success: failed === 0, synced, failed, errors };
}

/**
 * clearListingLocalData()
 *  - Xóa toàn bộ dữ liệu local (dùng khi muốn reset về Master List ban đầu).
 */
export async function clearListingLocalData(): Promise<{ success: boolean; error?: string }> {
  try {
    localStorage.removeItem(LS_KEY_HOUSEHOLDS);
    localStorage.removeItem(LS_KEY_AREAS);
    localStorage.removeItem(LS_KEY_COMMUNES);
    localStorage.removeItem(LS_KEY_META);
    localStorage.removeItem(LS_KEY_INITIALIZED);

    await idbClear(IDB_STORE_HH);
    await idbClear(IDB_STORE_AREA);
    await idbClear(IDB_STORE_COMMUNE);

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || 'Lỗi xóa dữ liệu local' };
  }
}

/**
 * getHouseholdById(id)
 *  - Lấy một hộ theo ID từ local.
 */
export async function getHouseholdById(id: string): Promise<Household | null> {
  const data = await getListingData();
  const hh = data.households.find(h => h.id === id);
  return hh || null;
}

/**
 * searchHouseholds(keyword)
 *  - Tìm hộ theo tên chủ hộ, mã xã, mã địa bàn, SĐT.
 */
export async function searchHouseholds(keyword: string): Promise<Household[]> {
  const data = await getListingData();
  const kw = keyword.toLowerCase().trim();
  if (!kw) return data.households;
  return data.households.filter(h =>
    (h.householdHead || '').toLowerCase().includes(kw) ||
    (h.communeName || '').toLowerCase().includes(kw) ||
    (h.communeCode || '').toLowerCase().includes(kw) ||
    (h.areaName || '').toLowerCase().includes(kw) ||
    (h.areaCode || '').toLowerCase().includes(kw) ||
    (h.phone || '').toLowerCase().includes(kw) ||
    (h.address || '').toLowerCase().includes(kw)
  );
}
