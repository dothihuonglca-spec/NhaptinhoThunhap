/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bảng dòng chi tiết cho Trồng trọt, Chăn nuôi, Lâm nghiệp, Thủy sản
export interface ProductionRow {
  id: string;
  name: string; // Tên sản phẩm / cây trồng / vật nuôi từ danh mục hoặc tự nhập
  catalogId?: number;
  col1_ban: number; // Giá trị đã bán/đổi/cho/biếu/tặng
  col2_tuDung: number; // Giá trị đã thu hoạch để lại sử dụng & tồn kho
  col4_giong: number; // Giống (bao gồm tự sản xuất)
  col5_vatTu: number; // Phân bón, BVTV / Thức ăn, thuốc phòng bệnh
  col6_chiKhac: number; // Chi khác
}

// Bảng dòng chi tiết Mục 6: SXKD phi nông nghiệp hoặc chế biến
export interface NonAgriRow {
  id: string;
  name: string; // Mô tả hoạt động
  col1_ban: number; // Giá trị bán
  col2_tuDung: number; // Giá trị để lại sử dụng
  col4_nguyenLieu: number; // Nguyên vật liệu chính, phụ
  col5_nangLuong: number; // Năng lượng, nhiên liệu
  col6_chiKhac: number; // Chi khác
}

// Mục 1: Tiền lương, tiền công
export interface SalaryRow {
  id: string;
  name: string; // Họ tên thành viên
  job: string; // Mô tả công việc chính
  col1_luong: number; // Thu nhập từ tiền lương, tiền công (kể cả hiện vật)
  col2_troCap: number; // Lương hưu, trợ cấp thôi việc
}

export interface FullQuestionnaire {
  // Mục 1: Tiền lương tiền công (Trang 1)
  muc1_has: boolean;
  muc1_rows: SalaryRow[];

  // Mục 2: Trồng trọt (Trang 2)
  muc2_has: boolean;
  muc2_cayTrongRows: ProductionRow[]; // 1. Cây trồng các loại (tra cứu 63 loại)
  muc2_giong: { col1: number; col2: number; col4: number; col5: number; col6: number }; // 2. Nhân giống
  muc2_sanPhamPhu: { col1: number; col2: number; col6: number }; // 3. Sản phẩm phụ
  muc2_dichVu: { col3: number; col6: number }; // 4. Dịch vụ trồng trọt
  muc2_denBu: number; // 5. Tiền đền bù/hỗ trợ

  // Mục 3: Chăn nuôi (Trang 4, 5)
  muc3_has: boolean;
  muc3_giaSucRows: ProductionRow[]; // 1. Gia súc
  muc3_giaCamRows: ProductionRow[]; // 2. Gia cầm
  muc3_khacRows: ProductionRow[]; // 3. Chăn nuôi khác
  muc3_khongGietMoRows: ProductionRow[]; // 4. Sản phẩm không qua giết mổ
  muc3_giongRows: ProductionRow[]; // 5. Giống vật nuôi
  muc3_sanPhamPhu: { col1: number; col2: number; col6: number }; // 6. Sản phẩm phụ
  muc3_dichVu: { col3: number; col6: number }; // 7. Dịch vụ chăn nuôi
  muc3_sanBat: { col3: number; col6: number }; // 8. Săn bắt, đánh bẫy
  muc3_denBu: number; // 9. Tiền đền bù/hỗ trợ

  // Mục 4: Lâm nghiệp (Trang 7)
  muc4_has: boolean;
  muc4_khaiThacRows: ProductionRow[]; // 1. Khai thác thu nhặt lâm sản
  muc4_uomGiong: { col1: number; col2: number; col4: number; col5: number; col6: number }; // 2. Ươm giống
  muc4_trongRung: { col1: number; col2: number; col4: number; col5: number; col6: number }; // 3. Trồng rừng, chăm sóc
  muc4_dichVu: { col3: number; col6: number }; // 4. Dịch vụ lâm nghiệp
  muc4_denBu: number; // 5. Tiền đền bù/hỗ trợ

  // Mục 5: Thủy sản (Trang 9, 10)
  muc5_has: boolean;
  muc5_nuoiTrongRows: ProductionRow[]; // 1. Nuôi trồng thủy sản
  muc5_danhBatRows: ProductionRow[]; // 2. Đánh bắt thủy sản
  muc5_sanXuatGiongRows: ProductionRow[]; // 3. Sản xuất giống thủy sản
  muc5_denBu: number; // 4. Tiền đền bù/hỗ trợ

  // Mục 6: SXKD phi nông nghiệp, dịch vụ hoặc chế biến (Trang 11)
  muc6_has: boolean;
  muc6_rows: NonAgriRow[];

  // Mục 7: Thu nhập khác (Trang 12)
  muc7_has: boolean;
  muc7_1_1: number; // Biếu, tặng, mừng, giúp
  muc7_1_2: number; // Trợ cấp xã hội, chính sách, thiên tai
  muc7_1_3: number; // Học bổng, giáo dục, y tế
  muc7_2_1: number; // Cho thuê tài sản, đất đai, nhà ở
  muc7_2_2: number; // Lãi đầu tư, tiết kiệm, cổ tức, cho vay
  muc7_3: number; // Trúng số, vui chơi có thưởng, khác

  // Điều tra viên (Trang 13)
  surveyorDate?: string;
  surveyorName?: string;
}

// -------------------------------------------------------------
// ĐỊNH NGHĨA CÁC LOẠI PHIẾU ĐIỀU TRA (HỖ TRỢ MỞ RỘNG ĐA PHIẾU)
// -------------------------------------------------------------

export type QuestionnaireType = 
  | 'PHIEU_01_THU_NHAP'   // Phiếu 01/ĐTTN: Khảo sát Thu nhập hộ dân cư 7 mục (Phụ lục II)
  | 'PHIEU_02_LAO_DONG'   // Phiếu 02/LĐVL: Thu thập thông tin Lao động & Việc làm
  | 'PHIEU_03_HO_NGHEO'   // Phiếu 03/ĐTC: Rà soát Hộ nghèo, Cận nghèo đa chiều
  | 'PHIEU_04_RUT_GON';   // Phiếu 04/RG: Thu thập Thu nhập nhanh (Mẫu rút gọn)

export interface QuestionnaireTypeMeta {
  id: QuestionnaireType;
  code: string;
  name: string;
  badge: string;
  description: string;
}

export const QUESTIONNAIRE_TYPES: QuestionnaireTypeMeta[] = [
  {
    id: 'PHIEU_01_THU_NHAP',
    code: '01/ĐTTN',
    name: 'Phiếu 01: Thu nhập hộ dân cư',
    badge: 'bg-sky-100 text-sky-800 border-sky-300',
    description: 'Biểu mẫu Phụ lục II chuẩn với 7 mục chi tiết (Lương, Trồng trọt, Chăn nuôi, Lâm nghiệp, Thủy sản, Phi nông, Thu khác).'
  },
  {
    id: 'PHIEU_02_LAO_DONG',
    code: '02/LĐVL',
    name: 'Phiếu 02: Lao động & Việc làm',
    badge: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    description: 'Thu thập thông tin từng nhân khẩu trong độ tuổi lao động, trình độ chuyên môn kỹ thuật, ngành nghề, việc làm và BHXH.'
  },
  {
    id: 'PHIEU_03_HO_NGHEO',
    code: '03/ĐTC',
    name: 'Phiếu 03: Rà soát Hộ nghèo đa chiều',
    badge: 'bg-rose-100 text-rose-800 border-rose-300',
    description: 'Chấm điểm tài sản B1 và đánh giá 12 chỉ số thiếu hụt dịch vụ xã hội cơ bản B2 theo chuẩn nghèo đa chiều quốc gia.'
  },
  {
    id: 'PHIEU_04_RUT_GON',
    code: '04/RG',
    name: 'Phiếu 04: Thu nhập rút gọn',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    description: 'Thu thập nhanh doanh thu - chi phí theo 4 nhóm ngành kinh tế (NLTS, CN-XD, TMDV, Lương/Khác) cho hộ kê khai nhanh.'
  }
];

// -------------------------------------------------------------
// PHIẾU 02: THU THẬP THÔNG TIN LAO ĐỘNG VÀ VIỆC LÀM
// -------------------------------------------------------------

export interface LaborMemberRow {
  id: string;
  stt: number;
  fullName: string;
  relationWithHead: string; // Chủ hộ, Vợ/Chồng, Con, Bố/Mẹ, Anh/Chị/Em, Khác
  gender: 'Nam' | 'Nữ';
  birthYear: number | string;
  educationLevel: string; // Chưa đi học, Tiểu học, THCS, THPT
  technicalQualification: string; // Chưa qua đào tạo, Sơ cấp, Trung cấp, Cao đẳng, Đại học, Sau đại học
  employmentStatus: 'Có việc làm' | 'Thất nghiệp' | 'Nội trợ' | 'Hưu trí/Mất sức' | 'Đang đi học';
  mainJob: string; // Nghề nghiệp, công việc chính
  workplaceSector: string; // Nông lâm thủy sản, CN - Xây dựng, TMDV - Vận tải, Nhà nước/Hành chính
  hasLaborContract: boolean; // Có HĐLĐ (Có thời hạn / Không thời hạn)
  hasSocialInsurance: boolean; // Có tham gia BHXH (Bắt buộc / Tự nguyện)
  monthlyIncomeEst: number; // Ước tính thu nhập từ việc làm (1.000 đồng/tháng)
}

export interface LaborQuestionnaire {
  members: LaborMemberRow[];
  workingAgeCount: number; // Số người trong độ tuổi lao động
  employedCount: number; // Số người có việc làm
  insuredCount: number; // Số người tham gia BHXH
  trainedCount: number; // Số người qua đào tạo nghề
  surveyDate?: string;
  surveyorName?: string;
  note?: string;
}

export const createDefaultLaborQuestionnaire = (householdHead: string = '', membersCount: number = 1): LaborQuestionnaire => {
  const initialMembers: LaborMemberRow[] = [
    {
      id: 'mem_1',
      stt: 1,
      fullName: householdHead || 'Chủ hộ',
      relationWithHead: 'Chủ hộ',
      gender: 'Nam',
      birthYear: 1980,
      educationLevel: 'THPT',
      technicalQualification: 'Chưa qua đào tạo',
      employmentStatus: 'Có việc làm',
      mainJob: 'Lao động sản xuất nông nghiệp / Tự do',
      workplaceSector: 'Nông lâm thủy sản',
      hasLaborContract: false,
      hasSocialInsurance: false,
      monthlyIncomeEst: 5000
    }
  ];

  return {
    members: initialMembers,
    workingAgeCount: 1,
    employedCount: 1,
    insuredCount: 0,
    trainedCount: 0,
    surveyDate: new Date().toLocaleDateString('vi-VN'),
    surveyorName: '',
    note: ''
  };
};

// -------------------------------------------------------------
// PHIẾU 03: RÀ SOÁT HỘ NGHÈO, CẬN NGHÈO ĐA CHIỀU (NĐ 07/2021)
// -------------------------------------------------------------

export interface MultidimensionalPovertyQuestionnaire {
  // Điểm tài sản và điều kiện sinh hoạt (Thang điểm B1: Tối đa 140 điểm)
  b1_houseQuality: 'Kiên cố' | 'Bán kiên cố' | 'Thiếu kiên cố' | 'Đơn sơ'; // 30, 20, 10, 0
  b1_housePerCapita: number; // m2/người
  b1_hasMotorbike: boolean; // Có xe máy (15 điểm)
  b1_hasRefrigerator: boolean; // Có tủ lạnh (15 điểm)
  b1_hasWashingMachine: boolean; // Có máy giặt (10 điểm)
  b1_hasColorTV: boolean; // Có TV màu/Smart TV (10 điểm)
  b1_hasSmartPhone: boolean; // Có Smartphone/Máy tính (10 điểm)
  b1_hasCultivationLand: boolean; // Có đất sản xuất nông nghiệp (10 điểm)
  b1_waterSource: 'Nước máy/nước đóng chai' | 'Giếng khoan sạch' | 'Giếng đào/ao hồ'; // 15, 10, 0
  b1_toiletType: 'Tự hoại khép kín' | 'Bán tự hoại' | 'Hố xí thô sơ/không có'; // 15, 10, 0
  b1_totalScore: number;

  // 12 Chỉ số thiếu hụt dịch vụ xã hội cơ bản (Tiêu chí B2)
  b2_deprivations: {
    viecLam: boolean;            // 1. Việc làm
    nguoiPhuThuoc: boolean;      // 2. Người phụ thuộc trong hộ
    dinhDuong: boolean;          // 3. Dinh dưỡng
    bhyt: boolean;               // 4. Bảo hiểm y tế
    trinhDoGiaoDuc: boolean;     // 5. Trình độ giáo dục người lớn
    tinhTrangDiHoc: boolean;     // 6. Tình trạng đi học của trẻ em
    chatLuongNhaO: boolean;      // 7. Chất lượng nhà ở
    dienTichNhaO: boolean;       // 8. Diện tích nhà ở bình quân
    nuocSinhHoat: boolean;       // 9. Nguồn nước sinh hoạt hợp vệ sinh
    nhaTieuHopVeSinh: boolean;   // 10. Nhà tiêu hợp vệ sinh
    dichVuVienThong: boolean;    // 11. Sử dụng dịch vụ viễn thông
    phuongTienNgheNhin: boolean; // 12. Phương tiện tiếp cận thông tin
  };
  b2_deprivationCount: number; // Số lượng chỉ số bị thiếu hụt

  // Kết luận phân loại chuẩn đa chiều
  povertyClassification: 'Hộ nghèo' | 'Hộ cận nghèo' | 'Hộ có mức sống trung bình' | 'Hộ không nghèo';
  surveyDate?: string;
  surveyorName?: string;
  verifierName?: string;
}

export const createDefaultPovertyQuestionnaire = (): MultidimensionalPovertyQuestionnaire => ({
  b1_houseQuality: 'Bán kiên cố',
  b1_housePerCapita: 18,
  b1_hasMotorbike: true,
  b1_hasRefrigerator: true,
  b1_hasWashingMachine: false,
  b1_hasColorTV: true,
  b1_hasSmartPhone: true,
  b1_hasCultivationLand: true,
  b1_waterSource: 'Giếng khoan sạch',
  b1_toiletType: 'Tự hoại khép kín',
  b1_totalScore: 85,

  b2_deprivations: {
    viecLam: false,
    nguoiPhuThuoc: false,
    dinhDuong: false,
    bhyt: false,
    trinhDoGiaoDuc: false,
    tinhTrangDiHoc: false,
    chatLuongNhaO: false,
    dienTichNhaO: false,
    nuocSinhHoat: false,
    nhaTieuHopVeSinh: false,
    dichVuVienThong: false,
    phuongTienNgheNhin: false
  },
  b2_deprivationCount: 0,
  povertyClassification: 'Hộ không nghèo',
  surveyDate: new Date().toLocaleDateString('vi-VN'),
  surveyorName: ''
});

// -------------------------------------------------------------
// PHIẾU 04: THU THẬP THU NHẬP RÚT GỌN (NHẬP NHANH 4 LĨNH VỰC)
// -------------------------------------------------------------

export interface QuickIncomeQuestionnaire {
  // 1. Nông lâm thủy sản
  nongLamThuySanRevenue: number;
  nongLamThuySanCost: number;
  // 2. Công nghiệp & Xây dựng
  congNghiepXayDungRevenue: number;
  congNghiepXayDungCost: number;
  // 3. Thương mại & Dịch vụ
  thuongMaiDichVuRevenue: number;
  thuongMaiDichVuCost: number;
  // 4. Lương, công & Thu khác
  luongVaThuKhacRevenue: number;
  // Tổng hợp
  totalNetIncome: number;
  surveyDate?: string;
  surveyorName?: string;
  note?: string;
}

export const createDefaultQuickIncomeQuestionnaire = (): QuickIncomeQuestionnaire => ({
  nongLamThuySanRevenue: 0,
  nongLamThuySanCost: 0,
  congNghiepXayDungRevenue: 0,
  congNghiepXayDungCost: 0,
  thuongMaiDichVuRevenue: 0,
  thuongMaiDichVuCost: 0,
  luongVaThuKhacRevenue: 0,
  totalNetIncome: 0,
  surveyDate: new Date().toLocaleDateString('vi-VN'),
  surveyorName: '',
  note: ''
});

export const createDefaultQuestionnaire = (): FullQuestionnaire => ({
  muc1_has: false,
  muc1_rows: [],

  muc2_has: false,
  muc2_cayTrongRows: [],
  muc2_giong: { col1: 0, col2: 0, col4: 0, col5: 0, col6: 0 },
  muc2_sanPhamPhu: { col1: 0, col2: 0, col6: 0 },
  muc2_dichVu: { col3: 0, col6: 0 },
  muc2_denBu: 0,

  muc3_has: false,
  muc3_giaSucRows: [],
  muc3_giaCamRows: [],
  muc3_khacRows: [],
  muc3_khongGietMoRows: [],
  muc3_giongRows: [],
  muc3_sanPhamPhu: { col1: 0, col2: 0, col6: 0 },
  muc3_dichVu: { col3: 0, col6: 0 },
  muc3_sanBat: { col3: 0, col6: 0 },
  muc3_denBu: 0,

  muc4_has: false,
  muc4_khaiThacRows: [],
  muc4_uomGiong: { col1: 0, col2: 0, col4: 0, col5: 0, col6: 0 },
  muc4_trongRung: { col1: 0, col2: 0, col4: 0, col5: 0, col6: 0 },
  muc4_dichVu: { col3: 0, col6: 0 },
  muc4_denBu: 0,

  muc5_has: false,
  muc5_nuoiTrongRows: [],
  muc5_danhBatRows: [],
  muc5_sanXuatGiongRows: [],
  muc5_denBu: 0,

  muc6_has: false,
  muc6_rows: [],

  muc7_has: false,
  muc7_1_1: 0,
  muc7_1_2: 0,
  muc7_1_3: 0,
  muc7_2_1: 0,
  muc7_2_2: 0,
  muc7_3: 0,

  surveyorDate: new Date().toLocaleDateString('vi-VN'),
  surveyorName: ''
});
