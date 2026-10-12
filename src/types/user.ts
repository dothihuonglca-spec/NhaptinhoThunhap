export interface Department {
  id: string;
  name: string;
}

export type UserRole = 'ADMIN' | 'MANAGER' | 'SURVEYOR';

export interface Surveyor {
  id: string;
  code: string;
  username: string;
  name: string;
  departmentId: string;
  department: string;
  position: string;
  phone: string;
  email: string;
  password?: string;
  role: UserRole;
  assignedAreas: string[];
  status: 'ACTIVE' | 'INACTIVE';
  mustChangePassword: boolean;
  note: string;
  createdAt: string;
}

export const ROLE_LABELS: Record<UserRole, { label: string }> = {
  ADMIN: { label: 'Quản trị viên' },
  MANAGER: { label: 'Quản lý' },
  SURVEYOR: { label: 'Điều tra viên' }
};

export type SurveyStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export const SURVEY_STATUS_LABELS: Record<SurveyStatus, { label: string }> = {
  PENDING: { label: 'Chờ điều tra' },
  IN_PROGRESS: { label: 'Đang điều tra' },
  COMPLETED: { label: 'Hoàn thành' }
};

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'manager' | 'surveyor';
  departmentId: string;
  assignedAreaCodes: string[]; // VD: ['TKO01', 'TKO02'] hoặc ['ALL']
  updatedAt: string;
}
