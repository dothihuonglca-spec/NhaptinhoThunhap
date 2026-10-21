/**
 * Nhận dạng "Trạng thái mẫu" (CHÍNH THỨC / DỰ PHÒNG) của một dòng bảng kê.
 *
 * Thứ tự ưu tiên:
 *  1. Đọc ĐÚNG cột "Trạng thái mẫu" (nếu file có cột này và ô có giá trị nhận ra được).
 *  2. Không có cột / ô trống: tìm trong cả dòng nhưng chỉ nhận cụm "DỰ PHÒNG" hoặc "DP" đứng RIÊNG
 *     (không nằm trong từ khác). Trước đây dùng includes('DP') nên địa chỉ "Đội 6 TDP Đông Chiểu"
 *     (TDP = tổ dân phố) bị hiểu nhầm là dự phòng.
 */
export type SampleStatus = 'CHÍNH THỨC' | 'DỰ PHÒNG';

const norm = (v: unknown) => String(v ?? '').normalize('NFC').trim().toUpperCase();
const RESERVE_WORD = /DỰ\s*PH[OÒ]NG|DU\s*PH[OÒ]NG/;
const OFFICIAL_WORD = /CH[ÍI]NH\s*TH[ỨU]C/;
const STANDALONE_DP = /(^|[^A-ZĐ0-9])DP($|[^A-ZĐ0-9])/;

export function detectSampleStatus(row: unknown[], statusCol: number): SampleStatus {
  if (statusCol >= 0) {
    const v = norm(row[statusCol]);
    if (v) {
      if (RESERVE_WORD.test(v) || v === 'DP') return 'DỰ PHÒNG';
      if (OFFICIAL_WORD.test(v) || v === 'CT') return 'CHÍNH THỨC';
    }
  }
  const full = row.map(norm).join(' | ');
  return RESERVE_WORD.test(full) || STANDALONE_DP.test(full) ? 'DỰ PHÒNG' : 'CHÍNH THỨC';
}
