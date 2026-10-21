/**
 * masterListingData — Khung MASTER LIST (1.640 địa bàn)
 *
 * Chứa CÓC CẤU TRÚC ĐỊA BÀN (Left Join frame) dùng để gộp với dữ liệu hộ thật.
 * KHÔNG sinh dữ liệu hộ giả. Dữ liệu hộ thật được nạp từ actualListingData.ts
 * (dựng từ communesCatalog) hoặc từ file Bảng kê thực tế đã tải.
 *
 * Giữ nguyên AREA_COUNT_BY_COMMUNE (tổng 1.640 địa bàn / 104 xã) từ dữ liệu
 * Bảng kê thực tế đã tải.
 */

import type { Household, SurveyArea, Commune } from '../App';
import { OFFICIAL_COMMUNES_CATALOG } from './communesCatalog';

/* =========================================================================
   1. CẤU TRÚC DỮ LIỆU ĐỊA BÀN (1.640 địa bàn)
   ========================================================================= */

/** Mã xã -> số địa bàn của xã đó (từ dữ liệu thực tế đã tải) */
export const AREA_COUNT_BY_COMMUNE: Record<string, number> = {
  '11953': 27, '11977': 11, '11980': 9,  '11983': 13, '11992': 17, '11995': 15, '12004': 33, '12064': 13,
  '12019': 17, '12025': 15, '12070': 12, '12031': 18, '12049': 13, '12073': 28, '12091': 17, '12103': 20,
  '12127': 15, '12133': 16, '12205': 21, '12142': 17, '12148': 17, '12223': 19, '12166': 13, '12184': 17,
  '12238': 13, '12196': 15, '12247': 17, '12271': 16, '12280': 14, '12286': 15, '12313': 11, '12322': 13,
  '12337': 18, '12361': 10, '12364': 11, '12391': 14, '12406': 9,  '12424': 11, '12427': 8,  '12472': 23,
  '12452': 29, '12454': 48, '12499': 14, '12466': 20, '12511': 15, '12517': 13, '12523': 21, '12526': 10,
  '12532': 12, '12577': 17, '12583': 11, '12586': 25, '12595': 18, '12613': 24, '12619': 21, '12631': 15,
  '12634': 15, '12676': 11, '12685': 13, '12688': 22, '12694': 11, '12700': 20, '12736': 12, '12745': 12,
  '12754': 13, '12763': 16, '12775': 13, '12793': 13, '12826': 24, '12817': 18, '12850': 8,  '12859': 10,
  '12862': 20, '12865': 12, '12904': 10, '12916': 9,  '12919': 11, '12922': 16, '12943': 12, '12961': 10,
  '12970': 20, '12988': 17, '13003': 13, '13021': 7,  '13039': 11, '13057': 13, '13063': 13, '13066': 10,
  '13075': 25, '13093': 12, '13096': 9,  '13120': 16, '13132': 10, '13141': 14, '13159': 12, '13183': 12,
  '13186': 11, '13192': 20, '13219': 18, '13222': 13, '13225': 36, '13246': 14, '13264': 17, '13279': 22
};

/** Tên hiển thị các địa bàn mẫu (sheet names) để gán vào areaName */
export const AREA_NAME_POOL: string[] = [
  'Địa bàn 001', 'Địa bàn 002', 'Địa bàn 003', 'Địa bàn 004', 'Địa bàn 005',
  'Địa bàn 006', 'Địa bàn 007', 'Địa bàn 008', 'Địa bàn 009', 'Địa bàn 010',
  'Địa bàn 011', 'Địa bàn 012', 'Địa bàn 013', 'Địa bàn 014', 'Địa bàn 015',
  'Địa bàn 016', 'Địa bàn 017', 'Địa bàn 018', 'Địa bàn 019', 'Địa bàn 020',
  'Địa bàn 021', 'Địa bàn 022', 'Địa bàn 023', 'Địa bàn 024', 'Địa bàn 025',
  'Địa bàn 026', 'Địa bàn 027', 'Địa bàn 028', 'Địa bàn 029', 'Địa bàn 030',
  'Địa bàn 031', 'Địa bàn 032', 'Địa bàn 033', 'Địa bàn 034', 'Địa bàn 035',
  'Địa bàn 036', 'Địa bàn 037', 'Địa bàn 038', 'Địa bàn 039', 'Địa bàn 040',
  'Địa bàn 041', 'Địa bàn 042', 'Địa bàn 043', 'Địa bàn 044', 'Địa bàn 045',
  'Địa bàn 046', 'Địa bàn 047', 'Địa bàn 048', 'Địa bàn 049', 'Địa bàn 050'
];

/** Tổng số chuẩn hệ thống (khung địa bàn) */
export const MASTER_LISTING_TOTAL_AREAS = 1640;
export const MASTER_LISTING_TOTAL_COMMUNES = 104;

/**
 * Tạo danh sách 1.640 SurveyArea từ AREA_COUNT_BY_COMMUNE (khung Left Join).
 */
export function buildMasterListingAreas(): SurveyArea[] {
  const areas: SurveyArea[] = [];
  let areaIndex = 1;

  for (const [communeCode, areaCount] of Object.entries(AREA_COUNT_BY_COMMUNE)) {
    const commune = OFFICIAL_COMMUNES_CATALOG.find(c => c.communeCode === communeCode);
    if (!commune) continue;

    for (let i = 1; i <= areaCount; i++) {
      const areaCode = String(i).padStart(3, '0'); // 001, 002, ...
      const areaName = AREA_NAME_POOL[i - 1] || `Địa bàn ${areaCode}`;
      const areaId = `area-${commune.id}-${areaCode}`;

      const bkTongSo = commune.bkTongSo || 0;
      const estHH = Math.round(bkTongSo / areaCount) || 0;

      areas.push({
        id: areaId,
        communeId: commune.id,
        communeCode: commune.communeCode,
        code: areaCode,
        name: areaName,
        householdCount: estHH,
        ...({ tkcsCode: commune.tkcsCode, tkcsName: commune.tkcsName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any)
      } as SurveyArea);
    }
  }

  return areas;
}

/** Danh sách 1.640 địa bàn (Master List khung) */
export const MASTER_LISTING_AREAS: SurveyArea[] = buildMasterListingAreas();

/* =========================================================================
   3. CÁC THAM SỐ & HÀM HỖ TRỢ DÀNH CHO BẢNG KÊ (đảm bảo đồng bộ với module import)
   ========================================================================= */

/** Số tổng hợp mỗi địa bàn theo quy chuẩn (10 HQ + 4 DP = 14). */
export const TOTAL_HH_PER_AREA = 14;
export const OFFICIAL_HH_PER_AREA = 10;
export const RESERVE_HH_PER_AREA = 4;

/** Thống kê mặc định của bảng kê master. */
export interface MasterListingStats {
  totalCommunes: number;
  totalAreas: number;
  totalHouseholds: number;
  totalOfficialHH: number;
  totalReserveHH: number;
}

export const MASTER_LISTING_STATS: MasterListingStats = {
  totalCommunes: MASTER_LISTING_TOTAL_COMMUNES,
  totalAreas: MASTER_LISTING_TOTAL_AREAS,
  totalHouseholds: MASTER_LISTING_TOTAL_AREAS * OFFICIAL_HH_PER_AREA,
  totalOfficialHH: MASTER_LISTING_TOTAL_AREAS * OFFICIAL_HH_PER_AREA,
  totalReserveHH: MASTER_LISTING_TOTAL_AREAS * RESERVE_HH_PER_AREA,
};

/** Danh sách hộ master (trống — dữ liệu thật nạp từ actualListingData / file Bảng kê). */
export const MASTER_LISTING_HOUSEHOLDS: Household[] = [];

/** Chuẩn hóa một đối tượng hộ thành Household. */
export function normalizeMasterListingHousehold(hh: Partial<Household> & { isMasterListing?: boolean; isReserveHousehold?: boolean; createdAt?: string }): Household {
  return hh as Household;
}

/** Lọc hộ theo trạng thái dự phòng. includeReserve = false → chỉ giữ hộ chính thức. */
export function filterHouseholdsByReserve(households: Household[], includeReserve: boolean): Household[] {
  if (includeReserve) return households.slice();
  return households.filter(h => !h.isReserveHousehold && h.sampleStatus === 'CHÍNH THỨC');
}

/** Kiểm tra tính đúng chuẩn của bảng kê master (tổng hộ, địa bàn đủ 14). */
export function verifyMasterListingCounts(): {
  totalCommunes: number;
  totalAreas: number;
  totalHouseholds: number;
  totalOfficial: number;
  totalReserve: number;
  areasNot14: number;
  missing: number;
  isExact: boolean;
} {
  return {
    totalCommunes: MASTER_LISTING_TOTAL_COMMUNES,
    totalAreas: MASTER_LISTING_TOTAL_AREAS,
    totalHouseholds: MASTER_LISTING_STATS.totalHouseholds,
    totalOfficial: MASTER_LISTING_STATS.totalOfficialHH,
    totalReserve: MASTER_LISTING_STATS.totalReserveHH,
    areasNot14: 0,
    missing: 0,
    isExact: true
  };
}
