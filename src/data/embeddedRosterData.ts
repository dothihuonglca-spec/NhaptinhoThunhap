/**
 * embeddedRosterData.ts — Dữ liệu bảng kê nhúng trực tiếp vào mã nguồn.
 * Ưu tiên đọc từ file này trước IndexedDB và Firebase.
 *
 * Cách dùng:
 *  1. Xuất toàn bộ bảng kê từ Firebase ra file JSON (nút "Xuất bảng kê ra file JSON" trong DataSyncPanel).
 *  2. Copy nội dung JSON vào mảng `communes`, `surveyAreas`, `rosters` bên dưới.
 *  3. Lưu file này, chạy lại `npm run build` để dữ liệu mới có hiệu lực.
 */

export interface EmbeddedRosterData {
  version: number;
  exportedAt: string;
  communes: any[];
  surveyAreas: any[];
  rosters: any[]; // mỗi roster: { id, areaId, ownerId, ownerName, households: [...] }
}

/**
 * Dữ liệu mặc định (trống) — thay thế bằng dữ liệu thật khi xuất từ Firebase.
 */
export const EMBEDDED_ROSTER_DATA: EmbeddedRosterData = {
  version: 1,
  exportedAt: new Date().toISOString(),
  communes: [],
  surveyAreas: [],
  rosters: [],
};
