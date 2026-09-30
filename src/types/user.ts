/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'ADMIN' | 'SURVEYOR' | 'SUPERVISOR';

export type SurveyStatus = 'CHUA_NHAP' | 'DANG_NHAP' | 'DA_HOAN_THANH' | 'DA_DUYET';

export interface Department {
  id: string;
  code: string; // PB01, PB02, PB03, PB04, PB05
  name: string; // Tên phòng ban
  description?: string; // Chức năng, nhiệm vụ
  leaderName?: string; // Trưởng phòng / Cán bộ phụ trách
  leaderPhone?: string;
  assignedAreaCodes: string[]; // Danh sách mã địa bàn phân công cho phòng ban này
  colorTheme?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Surveyor {
  id: string;
  stt?: number;
  code: string; // Tên đăng nhập / Mã tài khoản: "ADMIN", "PB01_DTV1"...
  username?: string; // Tên đăng nhập
  password?: string; // Mật khẩu lưu trên Firebase Firestore
  name: string; // Họ và tên cán bộ / điều tra viên
  position?: string; // Chức vụ: "Trưởng phòng", "Phó phòng", "Cán bộ điều tra", "Thôn đội trưởng"...
  departmentId?: string; // ID phòng ban: pb_01, pb_02...
  department?: string; // Tên Phòng ban
  phone: string; // Số điện thoại
  email?: string; // Email tài khoản
  role: UserRole; // ADMIN, SURVEYOR, SUPERVISOR
  assignedAreas: string[]; // Mảng mã địa bàn: ['001', '002'] hoặc ['ALL']
  status: 'ACTIVE' | 'LOCKED'; // ACTIVE, LOCKED
  mustChangePassword?: boolean; // Bắt buộc đổi mật khẩu khi đăng nhập lần đầu / sau khi admin reset
  lastPasswordChange?: string; // Thời gian đổi mật khẩu gần nhất
  note?: string; // Ghi chú đơn vị / tổ điều tra
  createdAt: string;
  updatedAt?: string;
}

export const DEFAULT_5_DEPARTMENTS: Department[] = [
  {
    id: 'pb_tkth',
    code: 'PB01',
    name: 'Phòng Thống kê Tổng hợp',
    description: 'Tổng hợp số liệu toàn diện, điều phối nhập tin, giám sát điều tra thu nhập dân cư',
    leaderName: 'Đỗ Xuân Phú (Trưởng phòng)',
    assignedAreaCodes: ['ALL'],
    colorTheme: 'sky'
  },
  {
    id: 'pb_tchc',
    code: 'PB02',
    name: 'Phòng TCHC',
    description: 'Phòng Tổ chức Hành chính phụ trách rà soát nhân sự, hộ gia đình và hỗ trợ địa bàn',
    leaderName: 'Nguyễn Thị Hiếu (Trưởng phòng)',
    assignedAreaCodes: [],
    colorTheme: 'blue'
  },
  {
    id: 'pb_tmdv',
    code: 'PB03',
    name: 'Phòng Thống kê TMDV & Giá',
    description: 'Phụ trách thu thập, rà soát hộ kinh doanh thương mại, dịch vụ, giá cả thị trường (Mục 6)',
    leaderName: 'Trần Thị Thanh Huyền (Phó Phòng)',
    assignedAreaCodes: [],
    colorTheme: 'emerald'
  },
  {
    id: 'pb_cnxd',
    code: 'PB04',
    name: 'Phòng Thống kê CNXD',
    description: 'Phụ trách thu thập, thẩm định số liệu công nghiệp, tiểu thủ công nghiệp và xây dựng',
    leaderName: 'Nguyễn Văn Định (Trưởng phòng)',
    assignedAreaCodes: [],
    colorTheme: 'amber'
  },
  {
    id: 'pb_nnxh',
    code: 'PB05',
    name: 'Phòng Thống kê NN&XH',
    description: 'Phụ trách điều tra hộ nông, lâm, thủy sản, lao động việc làm và an sinh xã hội (Mục 2-5, 1, 7)',
    leaderName: 'Hoàng Thị Thu Trang (Trưởng phòng)',
    assignedAreaCodes: [],
    colorTheme: 'purple'
  }
];

export const DEPARTMENTS = DEFAULT_5_DEPARTMENTS.map(d => d.name);

export const ROLE_LABELS: Record<UserRole, { label: string; color: string; desc: string }> = {
  ADMIN: {
    label: 'Quản trị viên / Giám sát xã',
    color: 'bg-purple-100 text-purple-800 border-purple-300',
    desc: 'Toàn quyền: Tạo ĐTV, phân công địa bàn, import Excel, duyệt & khóa phiếu, sửa toàn bộ'
  },
  SURVEYOR: {
    label: 'Điều tra viên',
    color: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    desc: 'Quyền nhập phiếu: Chỉ nhập và sửa phiếu thuộc các địa bàn được phân công, không sửa phiếu đã duyệt'
  },
  SUPERVISOR: {
    label: 'Tổ trưởng / Giám sát viên',
    color: 'bg-amber-100 text-amber-800 border-amber-300',
    desc: 'Quyền kiểm tra: Xem tổng hợp số liệu, kiểm tra tính hợp lệ và duyệt phiếu của các địa bàn'
  }
};

export const SURVEY_STATUS_LABELS: Record<SurveyStatus, { label: string; badge: string; iconColor: string }> = {
  CHUA_NHAP: {
    label: 'Chưa nhập tin',
    badge: 'bg-slate-100 text-slate-700 border-slate-300',
    iconColor: 'text-slate-400'
  },
  DANG_NHAP: {
    label: 'Đang nhập tin',
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    iconColor: 'text-amber-500'
  },
  DA_HOAN_THANH: {
    label: 'Đã nhập tin',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    iconColor: 'text-emerald-600'
  },
  DA_DUYET: {
    label: 'Đã nhập tin (Đã duyệt)',
    badge: 'bg-blue-100 text-blue-800 border-blue-300',
    iconColor: 'text-blue-600'
  }
};
