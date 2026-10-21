/**
 * actualListingData — Dữ liệu BẢNG KÊ THỰC TẾ (không mock)
 *
 * Xây dựng khung hộ từ Danh mục xã (communesCatalog): tổng 104 xã,
 * tổng mauTongSo = 16.400 hộ (tất cả là HỘ CHÍNH THỨC, phân loại theo
 * 4 ngành s1-s4). Dùng làm dữ liệu chính thức thay vì buildMasterListingHouseholds()
 * (sinh mock 001..010 / DP01..DP04).
 *
 * Cung cấp:
 *  - buildActualHouseholds(areas): dựng 16.400 hộ thật, gán householdType
 *    theo phân loại ngành của từng xã, phân phối đều lên các địa bàn của xã.
 *  - loadActualListingFromFile(file): nạp TRỰC TIẾP file Bảng kê thực tế
 *    đã tải (JSON/TS, 16.310 hộ) để thay thế dữ liệu dựng sẵn.
 *  - leftJoinHouseholdsToAreas(areas, households): gộp hộ thật vào khung
 *    1.640 địa bản (Left Join). Địa bàn có hộ thật thì giữ hộ thật; địa bàn
 *    chưa có dữ liệu thì để trống (không chèn hộ giả).
 */

import type { Household, SurveyArea } from '../App';
import { OFFICIAL_COMMUNES_CATALOG } from './communesCatalog';

/* =========================================================================
   1. PHÂN LOẠI 4 LOẠI HỘ (householdType) theo nghiệp vụ thống kê
   ========================================================================= */

export type HouseholdType =
  | 'NONG_LAM_THUY_SAN'
  | 'CONG_NGHIEP_XAY_DUNG'
  | 'THUONG_MAI_DICH_VU'
  | 'THU_KHAC_LUONG';

export const HOUSEHOLD_TYPE_LABELS: Record<HouseholdType, string> = {
  NONG_LAM_THUY_SAN: 'Nông, lâm thủy sản',
  CONG_NGHIEP_XAY_DUNG: 'Công nghiệp xây dựng',
  THUONG_MAI_DICH_VU: 'Thương mại dịch vụ',
  THU_KHAC_LUONG: 'Thu khác / Lương'
};

/** Mã ngành (sectorCode 1-4) -> householdType */
export const SECTOR_TO_HOUSEHOLD_TYPE: Record<number, HouseholdType> = {
  1: 'NONG_LAM_THUY_SAN',
  2: 'CONG_NGHIEP_XAY_DUNG',
  3: 'THUONG_MAI_DICH_VU',
  4: 'THU_KHAC_LUONG'
};

/* =========================================================================
   2. HẠNG MỤC THÔNG TIN CHÍNH THỨC CỦA MỖI HỘ
   ========================================================================= */

export const ACTUAL_LISTING_TOTAL_COMMUNES = 104;
export const ACTUAL_LISTING_TOTAL_AREAS = 1640;

function getAreasForCommune(areas: SurveyArea[], communeId: string): SurveyArea[] {
  return areas.filter(a => a.communeId === communeId);
}

/**
 * Dựng danh sách hộ thật từ Danh mục xã.
 * Mỗi xã tạo chính xác mauTongSo hộ, phân bố theo sectorTargets {s1,s2,s3,s4},
 * tất cả sampleStatus = 'CHÍNH THỨC', householdType phân loại theo ngành.
 * Phân phối đều các hộ lên địa bàn của xã đó (round-robin).
 */
export function buildActualHouseholds(areas: SurveyArea[]): Household[] {
  const households: Household[] = [];
  let globalIndex = 1;

  for (const com of OFFICIAL_COMMUNES_CATALOG) {
    const comAreas = getAreasForCommune(areas, com.id);
    if (comAreas.length === 0) continue;

    const total = com.mauTongSo || 0;
    const targets = com.sectorTargets || { s1: 0, s2: 0, s3: 0, s4: 0 };
    const sectorCounts: Record<number, number> = {
      1: targets.s1 || 0,
      2: targets.s2 || 0,
      3: targets.s3 || 0,
      4: targets.s4 || 0
    };

    let hhOrdinal = 1;
    for (const sector of [1, 2, 3, 4]) {
      const count = sectorCounts[sector] || 0;
      const householdType = SECTOR_TO_HOUSEHOLD_TYPE[sector];
      for (let k = 0; k < count; k++) {
        const area = comAreas[k % comAreas.length];
        const sttMau = String(hhOrdinal).padStart(3, '0');

        households.push({
          id: `hh-${com.id}-${sector}-${String(globalIndex).padStart(6, '0')}`,
          communeId: com.id,
          communeCode: com.communeCode,
          communeName: com.communeName,
          tkcsCode: com.tkcsCode,
          tkcsName: com.tkcsName,
          areaId: area.id,
          areaCode: area.code,
          areaName: area.name,
          sheetName: area.name,
          sttMau,
          sampleStatus: 'CHÍNH THỨC',
          sttGoc: String(globalIndex),
          householdHead: '',
          address: '',
          phone: '',
          membersCount: 0,
          workingMembersCount: 0,
          membersCountEntered: false,
          sectorCode: sector as 1 | 2 | 3 | 4,
          sectorName: HOUSEHOLD_TYPE_LABELS[householdType],
          householdType,
          note: '',
          surveyStatus: 'CHUA_NHAP',
          updatedBy: '',
          updatedAt: new Date().toISOString(),
          isMasterListing: true,
          isReserveHousehold: false,
          createdAt: new Date().toISOString()
        } as Household);

        globalIndex++;
        hhOrdinal++;
      }
    }
  }

  return households;
}

/** Chuẩn hóa một hộ thật nhập từ file, đảm bảo đủ toàn trường Household. */
export function normalizeActualHousehold(
  hh: Partial<Household> & { isMasterListing?: boolean; isReserveHousehold?: boolean; createdAt?: string }
): Household {
  const base: any = {
    id: hh.id || crypto.randomUUID(),
    communeId: hh.communeId || '',
    communeCode: hh.communeCode || '',
    communeName: hh.communeName || '',
    tkcsCode: hh.tkcsCode || '',
    tkcsName: hh.tkcsName || '',
    areaId: hh.areaId || '',
    areaCode: hh.areaCode || '001',
    areaName: hh.areaName || '',
    sheetName: hh.sheetName || hh.areaName || '',
    sttMau: hh.sttMau || '',
    sampleStatus: hh.sampleStatus || 'CHÍNH THỨC',
    sttGoc: hh.sttGoc || '',
    householdHead: hh.householdHead || '',
    address: hh.address || '',
    phone: hh.phone || '',
    membersCount: hh.membersCount ?? 0,
    workingMembersCount: hh.workingMembersCount ?? 0,
    membersCountEntered: hh.membersCountEntered ?? false,
    sectorCode: (hh.sectorCode ?? 1) as 1 | 2 | 3 | 4,
    sectorName: hh.sectorName || '',
    householdType: hh.householdType || '',
    note: hh.note || '',
    assignedSurveyorId: hh.assignedSurveyorId,
    assignedSurveyorName: hh.assignedSurveyorName,
    surveyStatus: hh.surveyStatus || 'CHUA_NHAP',
    updatedBy: hh.updatedBy,
    updatedAt: hh.updatedAt || new Date().toISOString(),
    questionnaire: hh.questionnaire,
    isMasterListing: hh.isMasterListing ?? true,
    isReserveHousehold: hh.isReserveHousehold ?? false,
    createdAt: hh.createdAt || new Date().toISOString()
  };
  return base as Household;
}

/* =========================================================================
   3. NẠP TRỰC TIẾP FILE BẢNG KÊ THỰC TẾ (JSON/TS, 16.310 hộ)
   ========================================================================= */

export interface LoadedListingFile {
  households: Household[];
  source: 'file' | 'built';
  count: number;
}

/**
 * Nạp dữ liệu Bảng kê thực tế từ file đã tải (JSON hoặc TS export mảng).
 * File phải chứa mảng các đối tượng hộ có đủ trường nghiệp vụ.
 * Trả về danh sách hộ đã chuẩn hóa, nguồn = 'file'.
 */
export async function loadActualListingFromFile(file: File): Promise<LoadedListingFile> {
  const text = await file.text();
  let raw: any;

  try {
    raw = JSON.parse(text);
  } catch {
    // Nếu là file TS export const ... = [...]; -> tách mảng ra
    const arrMatch = text.match(/=\s*(\[[\s\S]*\])\s*;?\s*$/);
    if (arrMatch) {
      raw = JSON.parse(arrMatch[1]);
    } else {
      throw new Error('File Bảng kê không phải mảng JSON/TS hợp lệ.');
    }
  }

  if (!Array.isArray(raw)) {
    throw new Error('Nội dung file Bảng kê phải là một mảng danh sách hộ.');
  }

  const households = raw.map((hh: any) => normalizeActualHousehold(hh));
  return {
    households,
    source: 'file',
    count: households.length
  };
}

/* =========================================================================
   4. LEFT JOIN: GỘP HỘ THẬT VÀO KHUNG 1.640 ĐỊA BÀN
   ========================================================================= */

/**
 * Gộp danh sách hộ thật vào khung địa bàn (Left Join).
 * - Địa bàn có hộ thật: giữ nguyên toàn bộ dữ liệu hộ thật của địa bàn đó.
 * - Địa bàn chưa có dữ liệu: không chèn hộ giả (để trống).
 * Trả về { areasWithData, areasEmpty, householdsByArea }.
 */
export function leftJoinHouseholdsToAreas(
  areas: SurveyArea[],
  households: Household[]
): {
  areasWithData: number;
  areasEmpty: number;
  householdsByArea: Map<string, Household[]>;
  allHouseholds: Household[];
} {
  const householdsByArea = new Map<string, Household[]>();
  households.forEach(h => {
    const key = h.areaId || h.areaCode || 'unknown';
    if (!householdsByArea.has(key)) householdsByArea.set(key, []);
    householdsByArea.get(key)!.push(h);
  });

  let areasWithData = 0;
  let areasEmpty = 0;
  areas.forEach(a => {
    const list = householdsByArea.get(a.id) || householdsByArea.get(a.code) || [];
    if (list.length > 0) areasWithData++;
    else areasEmpty++;
  });

  return {
    areasWithData,
    areasEmpty,
    householdsByArea,
    allHouseholds: households
  };
}
