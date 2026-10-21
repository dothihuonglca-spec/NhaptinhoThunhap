/**
 * rosterAudit — Công cụ kiểm tra/Khẩn cấp: đếm tổng số BẢNG KÊ (hộ & địa bàn)
 *
 * Xuất ra console toàn bộ số liệu thực tế để so sánh với con số chuẩn:
 *   - Tổng địa bàn: 1.640
 *   - Tổng hộ chính thức: 22.960
 *
 * Sử dụng: import { runRosterAudit } from './rosterAudit'; rồi gọi runRosterAudit()
 * trong trình duyệt (F12 → Console) hoặc trong useEffect của App.
 */

import { readLocal } from './dataStore';
import { isOfficialHousehold } from './sampleStatus';
import { OFFICIAL_COMMUNES_CATALOG } from '../data/communesCatalog';
import type { Commune } from '../App';

/* ================================================================
   1. ĐẾM TỪ DANH MỤC XÃ CỔ ĐỊNH (OFFICIAL_COMMUNES_CATALOG)
   ================================================================ */

export function auditCommuneCatalog() {
  const catalog = OFFICIAL_COMMUNES_CATALOG;
  const nCommunes = catalog.length;

  let totalBkTongSo = 0;   // tổng bkTongSo (tổng hộ bảng kê tham chiếu)
  let totalMauTongSo = 0;  // tổng mauTongSo (tổng hộ mẫu chính thức tham chiếu)
  let totalTargetOfficialHH = 0;
  let totalTargetTotalHH = 0;
  const zeroBkCommunes: string[] = [];
  const missingBkField: string[] = [];

  for (const c of catalog) {
    totalBkTongSo += c.bkTongSo || 0;
    totalMauTongSo += c.mauTongSo || 0;
    totalTargetOfficialHH += c.targetOfficialHH || 0;
    totalTargetTotalHH += c.targetTotalHH || 0;
    if ((c.bkTongSo || 0) === 0) zeroBkCommunes.push(`${c.communeCode} - ${c.communeName} (${c.tkcsCode})`);
    if (c.bkTongSo === undefined) missingBkField.push(`${c.communeCode} - ${c.communeName}`);
  }

  console.group('📊 [ROSTER AUDIT] Danh mục xã cố định (OFFICIAL_COMMUNES_CATALOG)');
  console.log(`   Tổng số xã trong catalog: ${nCommunes}`);
  console.log(`   Tổng bkTongSo (tổng hộ bảng kê tham chiếu): ${totalBkTongSo.toLocaleString()}`);
  console.log(`   Tổng mauTongSo (tổng hộ mẫu chính thức tham chiếu): ${totalMauTongSo.toLocaleString()}`);
  console.log(`   Tổng targetOfficialHH: ${totalTargetOfficialHH.toLocaleString()}`);
  console.log(`   Tổng targetTotalHH: ${totalTargetTotalHH.toLocaleString()}`);
  if (zeroBkCommunes.length > 0) {
    console.warn(`   ⚠️  Xã có bkTongSo = 0 (${zeroBkCommunes.length}):`, zeroBkCommunes);
  } else {
    console.log(`   ✅ Không có xã nào bkTongSo = 0`);
  }
  if (missingBkField.length > 0) {
    console.warn(`   ⚠️  Xã thiếu trường bkTongSo (${missingBkField.length}):`, missingBkField);
  }
  console.groupEnd();

  return {
    nCommunes,
    totalBkTongSo,
    totalMauTongSo,
    totalTargetOfficialHH,
    totalTargetTotalHH,
    zeroBkCommunes,
    missingBkField,
  };
}

/* ================================================================
   2. ĐẾM TỪ DATA STORE (bảng kê đã load từ Firebase + IndexedDB)
   ================================================================ */

export async function auditDataStore() {
  await import('./dataStore').then(() => {}); // đảm bảo module đã load
  const { readLocal } = await import('./dataStore');
  const { isOfficialHousehold } = await import('./sampleStatus');

  const households: any[] = await readLocal();
  const nTotal = households.length;

  const official = households.filter(h => isOfficialHousehold(h));
  const reserve = households.filter(h => !isOfficialHousehold(h));
  const nOfficial = official.length;
  const nReserve = reserve.length;

  // Gom theo xã
  const byCommune = new Map<string, { total: number; official: number; reserve: number; ids: string[] }>();
  for (const h of households) {
    const key = h.communeCode || h.communeId || 'UNKNOWN';
    if (!byCommune.has(key)) byCommune.set(key, { total: 0, official: 0, reserve: 0, ids: [] });
    const g = byCommune.get(key)!;
    g.total++;
    g.ids.push(h.id);
    if (isOfficialHousehold(h)) g.official++; else g.reserve++;
  }

  const zeroHhCommunes: string[] = [];
  for (const [code, g] of byCommune) {
    if (g.total === 0) zeroHhCommunes.push(code);
  }

  console.group('📊 [ROSTER AUDIT] Data Store (bảng kê từ Firebase + IndexedDB)');
  console.log(`   Tổng số hộ (merged): ${nTotal.toLocaleString()}`);
  console.log(`   └─ Hộ chính thức (CHÍNH THỨC): ${nOfficial.toLocaleString()}`);
  console.log(`   └─ Hộ dự phòng (DỰ PHÒNG):   ${nReserve.toLocaleString()}`);
  console.log(`   Tổng số xã có hộ: ${byCommune.size.toLocaleString()}`);
  if (zeroHhCommunes.length > 0) {
    console.warn(`   ⚠️  Xã có 0 hộ (${zeroHhCommunes.length}):`, zeroHhCommunes);
  } else {
    console.log(`   ✅ Không có xã nào trong data store có 0 hộ`);
  }
  console.groupEnd();

  return {
    nTotal,
    nOfficial,
    nReserve,
    nCommunesWithHh: byCommune.size,
    zeroHhCommunes,
    byCommune,
  };
}

/* ================================================================
   3. ĐẾM TỪ FIREBASE collections (communes, surveyAreas, households)
   ================================================================ */

export async function auditFirebaseCollections() {
  // Đọc dữ liệu từ local (LocalStorage/IndexedDB/Master List) thay vì Firebase
  const { getListingData } = await import('../services/listingLocalService');
  const { isOfficialHousehold } = await import('../utils/sampleStatus');

  let nCommunes = 0;
  let nAreas = 0;
  let nHouseholds = 0;
  let nOfficial = 0;
  let nReserve = 0;

  try {
    const data = await getListingData();
    nCommunes = data.communes.length;
    nAreas = data.areas.length;
    nHouseholds = data.households.length;
    nOfficial = data.households.filter((h: any) => isOfficialHousehold(h)).length;
    nReserve = nHouseholds - nOfficial;
  } catch (e) {
    console.warn('[ROSTER AUDIT] Không đọc được dữ liệu local:', e);
  }

  console.group('📊 [ROSTER AUDIT] Dữ liệu local (thay vì Firebase)');
  console.log(`   Tổng số xã (communes): ${nCommunes.toLocaleString()}`);
  console.log(`   Tổng số địa bà
n (surveyAreas): ${nAreas.toLocaleString()}`);
  console.log(`   Tổng số hộ (households): ${nHouseholds.toLocaleString()}`);
  console.log(`   └─ Hộ chính thức: ${nOfficial.toLocaleString()}`);
  console.log(`   └─ Hộ dự phòng:   ${nReserve.toLocaleString()}`);
  console.groupEnd();

  return { nCommunes, nAreas, nHouseholds, nOfficial, nReserve };
}

/* ================================================================
   4. TỔ HỢP: Chạy toàn bộ kiểm tra và xuất báo cáo
   ================================================================ */

export async function runRosterAudit() {
  console.group('🔍 [ROSTER AUDIT] BÁO CÁO ĐẾM BẢNG KÊ — KIỂM TRA KHẨN CẤU');
  console.log('   Thời gian:', new Date().toISOString());
  console.log('   Con số chuẩn hệ thống: 1.640 địa bàn | 22.960 hộ');
  console.log('');

  // 1. Catalog
  const catalogResult = auditCommuneCatalog();
  console.log('');

  // 2. Data Store
  const dsResult = await auditDataStore();
  console.log('');

  // 3. Firebase (nếu có kết nối)
  try {
    const fbResult = await auditFirebaseCollections();
    console.log('');

    // So sánh
    console.group('📋 [ROSTER AUDIT] SO SÁNH VỚI CON SỐ CHUẨN');
    console.log(`   Địa bàn: Firebase=${fbResult.nAreas.toLocaleString()} | Chuẩn=1.640 | ${fbResult.nAreas >= 1640 ? '✅ Đủ' : '❌ Thiếu ' + (1640 - fbResult.nAreas).toLocaleString()}`);
    console.log(`   Hộ chính thức: DataStore=${dsResult.nOfficial.toLocaleString()} | Firebase=${fbResult.nOfficial.toLocaleString()} | Chuẩn=22.960 | ${fbResult.nOfficial >= 22960 ? '✅ Đủ' : '❌ Thiếu ' + (22960 - fbResult.nOfficial).toLocaleString()}`);
    console.log(`   Tổng hộ (chính thức + dự phòng): DataStore=${dsResult.nTotal.toLocaleString()} | Firebase=${fbResult.nHouseholds.toLocaleString()}`);
    console.groupEnd();
  } catch (e) {
    console.warn('[ROSTER AUDIT] Không thể truy vấn Firebase:', e);
  }

  console.groupEnd();

  return {
    catalog: catalogResult,
    dataStore: dsResult,
  };
}

/* ================================================================
   5. Helper: gắn vào window để gọi từ Console (F12)
   ================================================================ */

declare global {
  interface Window {
    __rosterAudit?: {
      run: () => Promise<void>;
      catalog: () => void;
      dataStore: () => Promise<void>;
      firebase: () => Promise<void>;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__rosterAudit = {
    run: async () => { await runRosterAudit(); },
    catalog: () => { auditCommuneCatalog(); },
    dataStore: async () => { await auditDataStore(); },
    firebase: async () => { await auditFirebaseCollections(); },
  };
  console.info('[ROSTER AUDIT] Đã sẵn sàng. Gõ window.__rosterAudit.run() trong Console để kiểm tra.');
}
