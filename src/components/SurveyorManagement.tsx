/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Users, UserPlus, Shield, ShieldCheck, CheckCircle2, Lock, 
  Unlock, Edit3, Trash2, MapPin, Check, AlertCircle, Save, 
  X, Search, UserCheck, RefreshCw, Layers, KeyRound, Eye, EyeOff,
  Building2, Briefcase, Phone, Mail, FileText, CheckSquare, Sparkles,
  ArrowRight, ShieldAlert, BadgeHelp
} from 'lucide-react';
import { Surveyor, UserRole, Department, DEFAULT_5_DEPARTMENTS, ROLE_LABELS } from '../types/user';

interface SurveyArea {
  id: string;
  communeId: string;
  code: string;
  name: string;
}

interface Household {
  id: string;
  areaCode: string;
  areaName: string;
  assignedSurveyorId?: string;
  assignedSurveyorName?: string;
  surveyStatus?: string;
  [key: string]: any;
}

interface SurveyorManagementProps {
  surveyors: Surveyor[];
  departments: Department[];
  areas: SurveyArea[];
  households: Household[];
  currentUser: Surveyor | null;
  onSaveSurveyor: (surveyor: Surveyor) => Promise<void>;
  onDeleteSurveyor: (id: string) => Promise<void>;
  onSaveDepartment: (department: Department) => Promise<void>;
  onDeleteDepartment: (id: string) => Promise<void>;
  onBatchAssignArea: (surveyorId: string, areaCode: string) => Promise<void>;
  onBatchAssignDepartmentArea: (departmentId: string, areaCodes: string[]) => Promise<void>;
  onSelectActiveUser: (surveyor: Surveyor) => void;
  showNotification: (type: 'success' | 'error', msg: string) => void;
}

export default function SurveyorManagement({
  surveyors,
  departments,
  areas,
  households,
  currentUser,
  onSaveSurveyor,
  onDeleteSurveyor,
  onSaveDepartment,
  onDeleteDepartment,
  onBatchAssignArea,
  onBatchAssignDepartmentArea,
  onSelectActiveUser,
  showNotification
}: SurveyorManagementProps) {
  const [subTab, setSubTab] = useState<'departments' | 'surveyors'>('departments');
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  
  // Surveyor Add/Edit Modal
  const [editingSurveyor, setEditingSurveyor] = useState<Surveyor | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Department Add/Edit Modal
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);

  // Quick assignment state
  const [assignSurveyorId, setAssignSurveyorId] = useState<string>(surveyors[0]?.id || '');
  const [assignAreaCode, setAssignAreaCode] = useState<string>(areas[0]?.code || '');
  const [isAssigning, setIsAssigning] = useState(false);

  // Department quick assign state
  const [assignDeptId, setAssignDeptId] = useState<string>(departments[0]?.id || '');
  const [deptAssignAreas, setDeptAssignAreas] = useState<string[]>([]);
  const [isDeptAssigning, setIsDeptAssigning] = useState(false);

  // Surveyor Form state
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [showPasswordInForm, setShowPasswordInForm] = useState(false);
  const [formRole, setFormRole] = useState<UserRole>('SURVEYOR');
  const [formDeptId, setFormDeptId] = useState<string>('pb_01');
  const [formPosition, setFormPosition] = useState('');
  const [formAllAreas, setFormAllAreas] = useState<boolean>(false);
  const [formAssignedAreas, setFormAssignedAreas] = useState<string[]>([]);
  const [formStatus, setFormStatus] = useState<'ACTIVE' | 'LOCKED'>('ACTIVE');
  const [formMustChangePassword, setFormMustChangePassword] = useState<boolean>(true);
  const [formNote, setFormNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Department Form state
  const [deptFormCode, setDeptFormCode] = useState('');
  const [deptFormName, setDeptFormName] = useState('');
  const [deptFormDesc, setDeptFormDesc] = useState('');
  const [deptFormLeader, setDeptFormLeader] = useState('');
  const [deptFormPhone, setDeptFormPhone] = useState('');
  const [deptFormAreas, setDeptFormAreas] = useState<string[]>([]);
  const [isDeptSubmitting, setIsDeptSubmitting] = useState(false);

  // Deletion modals
  const [surveyorToDelete, setSurveyorToDelete] = useState<Surveyor | null>(null);
  const [departmentToDelete, setDepartmentToDelete] = useState<Department | null>(null);

  // Admin Reset Password Modal
  const [surveyorToResetPassword, setSurveyorToResetPassword] = useState<Surveyor | null>(null);
  const [newResetPassword, setNewResetPassword] = useState('');
  const [resetMustChange, setResetMustChange] = useState(true);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [showResetPasswordText, setShowResetPasswordText] = useState(false);

  const openAddModal = (defaultDeptId?: string) => {
    const count = surveyors.length + 1;
    const nextCode = `DTV${count < 10 ? '0' + count : count}`;
    setEditingSurveyor(null);
    setFormCode(nextCode);
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormPassword('123456');
    setShowPasswordInForm(false);
    setFormRole('SURVEYOR');
    setFormDeptId(defaultDeptId || (departments[0]?.id || 'pb_01'));
    setFormPosition('Cán bộ điều tra viên');
    setFormAllAreas(false);
    setFormAssignedAreas(areas.length > 0 ? [areas[0].code] : []);
    setFormStatus('ACTIVE');
    setFormMustChangePassword(true);
    setFormNote('');
    setIsModalOpen(true);
  };

  const openEditModal = (s: Surveyor) => {
    setEditingSurveyor(s);
    setFormCode(s.code);
    setFormName(s.name);
    setFormPhone(s.phone || '');
    setFormEmail(s.email || '');
    setFormPassword(s.password || '');
    setShowPasswordInForm(false);
    setFormRole(s.role);
    setFormDeptId(s.departmentId || 'pb_01');
    setFormPosition(s.position || '');
    setFormAllAreas(s.assignedAreas.includes('ALL'));
    setFormAssignedAreas(s.assignedAreas.filter(a => a !== 'ALL'));
    setFormStatus(s.status);
    setFormMustChangePassword(s.mustChangePassword ?? false);
    setFormNote(s.note || '');
    setIsModalOpen(true);
  };

  const openAddDeptModal = () => {
    const nextNum = departments.length + 1;
    setEditingDepartment(null);
    setDeptFormCode(`PB0${nextNum}`);
    setDeptFormName('');
    setDeptFormDesc('');
    setDeptFormLeader('');
    setDeptFormPhone('');
    setDeptFormAreas([]);
    setIsDeptModalOpen(true);
  };

  const openEditDeptModal = (d: Department) => {
    setEditingDepartment(d);
    setDeptFormCode(d.code);
    setDeptFormName(d.name);
    setDeptFormDesc(d.description || '');
    setDeptFormLeader(d.leaderName || '');
    setDeptFormPhone(d.leaderPhone || '');
    setDeptFormAreas(d.assignedAreaCodes || []);
    setIsDeptModalOpen(true);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formCode.trim()) {
      showNotification('error', 'Vui lòng nhập Mã tài khoản và Họ tên người điều tra.');
      return;
    }

    try {
      setIsSubmitting(true);
      const assigned = formAllAreas ? ['ALL'] : formAssignedAreas;
      const matchedDept = departments.find(d => d.id === formDeptId);

      const newSurveyor: Surveyor = {
        id: editingSurveyor ? editingSurveyor.id : 'dtv_' + Date.now(),
        code: formCode.trim().toUpperCase(),
        name: formName.trim(),
        phone: formPhone.trim(),
        email: formEmail.trim(),
        password: formPassword.trim() || (editingSurveyor?.password || '123456'),
        role: formRole,
        departmentId: formDeptId,
        department: matchedDept ? matchedDept.name : formDeptId,
        position: formPosition.trim(),
        assignedAreas: assigned.length === 0 ? ['ALL'] : assigned,
        status: formStatus,
        mustChangePassword: formMustChangePassword,
        note: formNote.trim(),
        createdAt: editingSurveyor ? editingSurveyor.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await onSaveSurveyor(newSurveyor);
      setIsModalOpen(false);
      showNotification('success', `Đã lưu tài khoản: ${newSurveyor.name} (${newSurveyor.code}) lên Firebase Firestore thành công.`);
    } catch (err: any) {
      showNotification('error', 'Lỗi khi lưu thông tin điều tra viên: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitDeptForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptFormName.trim() || !deptFormCode.trim()) {
      showNotification('error', 'Vui lòng nhập Mã và Tên phòng ban.');
      return;
    }

    try {
      setIsDeptSubmitting(true);
      const newDept: Department = {
        id: editingDepartment ? editingDepartment.id : 'pb_' + Date.now(),
        code: deptFormCode.trim().toUpperCase(),
        name: deptFormName.trim(),
        description: deptFormDesc.trim(),
        leaderName: deptFormLeader.trim(),
        leaderPhone: deptFormPhone.trim(),
        assignedAreaCodes: deptFormAreas,
        createdAt: editingDepartment ? editingDepartment.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await onSaveDepartment(newDept);
      setIsDeptModalOpen(false);
      showNotification('success', `Đã lưu thông tin phòng ban "${newDept.name}" lên Firebase thành công.`);
    } catch (err: any) {
      showNotification('error', 'Lỗi khi lưu phòng ban: ' + err.message);
    } finally {
      setIsDeptSubmitting(false);
    }
  };

  const handleExecuteResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!surveyorToResetPassword) return;
    if (!newResetPassword.trim() || newResetPassword.trim().length < 4) {
      showNotification('error', 'Mật khẩu mới phải có ít nhất 4 ký tự.');
      return;
    }

    try {
      setIsResettingPassword(true);
      const updated: Surveyor = {
        ...surveyorToResetPassword,
        password: newResetPassword.trim(),
        mustChangePassword: resetMustChange,
        updatedAt: new Date().toISOString()
      };
      await onSaveSurveyor(updated);
      showNotification('success', `Đã đặt lại mật khẩu cho "${updated.name}" (${updated.code}). Trạng thái bắt buộc đổi mật khẩu: ${resetMustChange ? 'BẬT' : 'TẮT'}.`);
      setSurveyorToResetPassword(null);
      setNewResetPassword('');
    } catch (err: any) {
      showNotification('error', 'Lỗi khi đặt lại mật khẩu: ' + err.message);
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleToggleAreaCheckbox = (code: string) => {
    if (formAssignedAreas.includes(code)) {
      setFormAssignedAreas(formAssignedAreas.filter(c => c !== code));
    } else {
      setFormAssignedAreas([...formAssignedAreas, code]);
    }
  };

  const handleToggleDeptAreaCheckbox = (code: string) => {
    if (deptFormAreas.includes(code)) {
      setDeptFormAreas(deptFormAreas.filter(c => c !== code));
    } else {
      setDeptFormAreas([...deptFormAreas, code]);
    }
  };

  const handleExecuteBatchAssign = async () => {
    if (!assignSurveyorId || !assignAreaCode) {
      showNotification('error', 'Vui lòng chọn Điều tra viên và Địa bàn cần phân công.');
      return;
    }
    const targetSurveyor = surveyors.find(s => s.id === assignSurveyorId);
    if (!targetSurveyor) return;

    try {
      setIsAssigning(true);
      await onBatchAssignArea(assignSurveyorId, assignAreaCode);
      showNotification('success', `Đã phân công toàn bộ hộ thuộc Địa bàn ${assignAreaCode} cho ${targetSurveyor.name}.`);
    } catch (err: any) {
      showNotification('error', 'Lỗi phân công địa bàn: ' + err.message);
    } finally {
      setIsAssigning(false);
    }
  };

  // Stats
  const totalSurveyors = surveyors.length;
  const activeCount = surveyors.filter(s => s.status === 'ACTIVE').length;
  const totalHouseholds = households.length;
  const assignedHouseholds = households.filter(h => !!h.assignedSurveyorId).length;
  const completedHouseholds = households.filter(h => h.surveyStatus === 'DA_HOAN_THANH' || h.surveyStatus === 'DA_DUYET').length;
  const approvedHouseholds = households.filter(h => h.surveyStatus === 'DA_DUYET').length;

  const filteredSurveyors = surveyors.filter(s => {
    if (roleFilter !== 'ALL' && s.role !== roleFilter) return false;
    if (deptFilter !== 'ALL' && s.departmentId !== deptFilter && s.department !== deptFilter) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.phone.includes(q) ||
        (s.department || '').toLowerCase().includes(q) ||
        (s.position || '').toLowerCase().includes(q) ||
        (s.note || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Top Banner and Navigation */}
      <div className="bg-white p-4 rounded-lg border border-slate-300 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-sky-800 text-white rounded-lg shadow-xs">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-black text-sky-950 text-base">
                Quản trị 5 Phòng Ban & Danh sách Tài khoản Phân công Nhập tin
              </h2>
              <p className="text-xs text-slate-600">
                Phân công phụ trách địa bàn theo 5 Phòng ban chuyên môn, quản lý tài khoản điều tra viên, reset mật khẩu và bắt buộc đổi mật khẩu khi đăng nhập.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sub-tab switcher */}
          <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setSubTab('departments')}
              className={`px-3.5 py-1.5 rounded-md font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                subTab === 'departments' 
                  ? 'bg-sky-800 text-white shadow-xs' 
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>5 Phòng Ban ({departments.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('surveyors')}
              className={`px-3.5 py-1.5 rounded-md font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                subTab === 'surveyors' 
                  ? 'bg-sky-800 text-white shadow-xs' 
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Tài khoản ĐTV ({surveyors.length})</span>
            </button>
          </div>

          {subTab === 'departments' ? (
            <button
              type="button"
              onClick={openAddDeptModal}
              className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
            >
              <Building2 className="w-4 h-4" />
              <span>+ Thêm Phòng Ban</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openAddModal()}
              className="px-3.5 py-2 bg-sky-800 hover:bg-sky-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ Cấp Tài Khoản Mới</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 text-sky-700" />
            <span>Phòng ban chuyên trách</span>
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-black text-sky-950">{departments.length}</span>
            <span className="text-xs font-bold text-sky-800 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
              5 phòng ban
            </span>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-emerald-700" />
            <span>Tổng số cán bộ / ĐTV</span>
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-black text-slate-900">{totalSurveyors}</span>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              {activeCount} đang hoạt động
            </span>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-amber-700" />
            <span>Hộ đã phân công ĐTV</span>
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-black text-amber-900">{assignedHouseholds}</span>
            <span className="text-xs font-semibold text-slate-600">
              / {totalHouseholds} hộ ({totalHouseholds > 0 ? Math.round((assignedHouseholds / totalHouseholds) * 100) : 0}%)
            </span>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-purple-700" />
            <span>Phiếu đã duyệt & Khóa</span>
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-black text-purple-900">{approvedHouseholds}</span>
            <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
              {totalHouseholds > 0 ? Math.round((approvedHouseholds / totalHouseholds) * 100) : 0}% xã
            </span>
          </div>
        </div>
      </div>

      {/* VIEW 1: 5 DEPARTMENTS MANAGEMENT */}
      {subTab === 'departments' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {departments.map((dept, index) => {
              const deptMembers = surveyors.filter(s => s.departmentId === dept.id || s.department === dept.name);
              const assignedAreaObjs = areas.filter(a => (dept.assignedAreaCodes || []).includes(a.code));
              
              // Households assigned to this department or its members
              const deptHh = households.filter(h => {
                if ((dept.assignedAreaCodes || []).includes(h.areaCode)) return true;
                if (h.assignedSurveyorId && deptMembers.some(m => m.id === h.assignedSurveyorId)) return true;
                return false;
              });
              const completedDeptHh = deptHh.filter(h => h.surveyStatus === 'DA_HOAN_THANH' || h.surveyStatus === 'DA_DUYET').length;
              const progressPct = deptHh.length > 0 ? Math.round((completedDeptHh / deptHh.length) * 100) : 0;

              return (
                <div 
                  key={dept.id} 
                  className="bg-white rounded-lg border border-slate-300 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between overflow-hidden"
                >
                  {/* Card Header */}
                  <div className="p-4 bg-linear-to-r from-sky-900 via-sky-850 to-slate-900 text-white flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="px-2 py-0.5 rounded bg-sky-700 text-sky-100 font-mono font-black text-xs border border-sky-500">
                        {dept.code}
                      </span>
                      <div>
                        <h3 className="font-extrabold text-sm text-white leading-tight">
                          {dept.name}
                        </h3>
                        <span className="text-[11px] text-sky-200">Phòng ban thứ {index + 1}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditDeptModal(dept)}
                        className="p-1.5 text-sky-200 hover:text-white hover:bg-sky-700/50 rounded cursor-pointer"
                        title="Chỉnh sửa phòng ban"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDepartmentToDelete(dept)}
                        className="p-1.5 text-rose-300 hover:text-rose-100 hover:bg-rose-900/40 rounded cursor-pointer"
                        title="Xóa phòng ban này"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-4 flex flex-col gap-3 text-xs flex-1">
                    {dept.description && (
                      <p className="text-slate-600 italic bg-slate-50 p-2 rounded border border-slate-200 text-[11px]">
                        {dept.description}
                      </p>
                    )}

                    {/* Leader info */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="text-slate-500 font-medium">Lãnh đạo / Phụ trách:</span>
                      <span className="font-bold text-slate-800 flex items-center gap-1">
                        <Briefcase className="w-3.5 h-3.5 text-sky-700" />
                        <span>{dept.leaderName || 'Chưa phân công'}</span>
                      </span>
                    </div>

                    {/* Member Count */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="text-slate-500 font-medium">Cán bộ / Điều tra viên:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-sky-950 text-sm">{deptMembers.length} người</span>
                        <button
                          type="button"
                          onClick={() => {
                            setDeptFilter(dept.id);
                            setSubTab('surveyors');
                          }}
                          className="text-[10px] text-sky-700 hover:underline font-bold"
                        >
                          (Xem DS)
                        </button>
                      </div>
                    </div>

                    {/* Assigned Areas */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">Địa bàn phân công ({assignedAreaObjs.length}):</span>
                        {(dept.assignedAreaCodes || []).includes('ALL') && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-black bg-purple-100 text-purple-800">
                            Toàn xã
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto p-1 bg-slate-50 rounded border border-slate-200">
                        {assignedAreaObjs.map(a => (
                          <span
                            key={a.id}
                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-900 border border-sky-200 flex items-center gap-1"
                          >
                            <MapPin className="w-2.5 h-2.5 text-sky-700" />
                            <span>ĐB {a.code} ({a.name})</span>
                          </span>
                        ))}
                        {assignedAreaObjs.length === 0 && !(dept.assignedAreaCodes || []).includes('ALL') && (
                          <span className="text-slate-400 italic text-[11px] p-1">
                            Chưa gán địa bàn cụ thể
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-1 bg-slate-50 p-2.5 rounded border border-slate-200">
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="font-bold text-slate-700">Tiến độ nhập phiếu:</span>
                        <span className="font-black text-emerald-700">{completedDeptHh} / {deptHh.length} hộ ({progressPct}%)</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-emerald-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card Footer Actions */}
                  <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => openAddModal(dept.id)}
                      className="px-2.5 py-1.5 bg-sky-800 hover:bg-sky-700 text-white rounded font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>+ Cấp ĐTV</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openEditDeptModal(dept)}
                      className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <MapPin className="w-3.5 h-3.5 text-sky-700" />
                      <span>Phân công ĐB</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 2: SURVEYORS & ACCOUNTS MANAGEMENT */}
      {subTab === 'surveyors' && (
        <div className="flex flex-col gap-4">
          {/* Quick Batch Assignment Box */}
          <div className="bg-linear-to-r from-sky-50 to-indigo-50 border border-sky-200 rounded-lg p-3.5 flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-sky-800 shrink-0" />
              <div>
                <h4 className="font-bold text-sky-950">Phân công nhanh toàn bộ hộ theo Địa bàn</h4>
                <p className="text-slate-600 text-[11px]">
                  Gán nhanh toàn bộ danh sách hộ thuộc một địa bàn cho Cán bộ / ĐTV phụ trách nhập phiếu.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-700 font-medium">Gán cho:</span>
                <select
                  value={assignSurveyorId}
                  onChange={e => setAssignSurveyorId(e.target.value)}
                  className="bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-900"
                >
                  {surveyors.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.code} - {s.name} ({s.department || ROLE_LABELS[s.role].label})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-700 font-medium">Địa bàn:</span>
                <select
                  value={assignAreaCode}
                  onChange={e => setAssignAreaCode(e.target.value)}
                  className="bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-900"
                >
                  {areas.map(a => (
                    <option key={a.id} value={a.code}>
                      ĐB {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleExecuteBatchAssign}
                disabled={isAssigning || areas.length === 0 || surveyors.length === 0}
                className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-400 text-white rounded font-bold cursor-pointer transition-colors shadow-2xs flex items-center gap-1"
              >
                {isAssigning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>Áp dụng phân công</span>
              </button>
            </div>
          </div>

          {/* Main Surveyor Table Card */}
          <div className="bg-white rounded-lg border border-slate-300 shadow-xs flex flex-col">
            {/* Table Filters Header */}
            <div className="p-3 border-b border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                <div className="relative w-full md:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Tìm theo tên, mã ĐTV, SĐT..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded focus:border-sky-500 focus:outline-hidden"
                  />
                </div>

                <select
                  value={deptFilter}
                  onChange={e => setDeptFilter(e.target.value)}
                  className="border border-slate-300 rounded px-2.5 py-1.5 font-medium bg-white"
                >
                  <option value="ALL">Tất cả Phòng ban</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.code} - {d.name}</option>
                  ))}
                </select>

                <select
                  value={roleFilter}
                  onChange={e => setRoleFilter(e.target.value)}
                  className="border border-slate-300 rounded px-2.5 py-1.5 font-medium bg-white"
                >
                  <option value="ALL">Tất cả vai trò</option>
                  <option value="ADMIN">Quản trị viên / Giám sát xã</option>
                  <option value="SURVEYOR">Điều tra viên</option>
                  <option value="SUPERVISOR">Giám sát viên</option>
                </select>
              </div>

              <div className="flex items-center gap-2 text-slate-500 text-xs">
                <span>Hiển thị <strong>{filteredSurveyors.length}</strong> / {surveyors.length} tài khoản</span>
              </div>
            </div>

            {/* Surveyor Table */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-[#058da0] text-white text-center font-bold">
                    <th className="border border-[#047484] p-2.5 w-12">STT</th>
                    <th className="border border-[#047484] p-2.5 w-24">Tên đăng nhập / Mã</th>
                    <th className="border border-[#047484] p-2.5 text-left min-w-[160px]">Họ và tên cán bộ</th>
                    <th className="border border-[#047484] p-2.5 text-left w-44">Phòng ban phụ trách</th>
                    <th className="border border-[#047484] p-2.5 text-left w-36">Vai trò hệ thống</th>
                    <th className="border border-[#047484] p-2.5 text-left min-w-[200px]">Địa bàn được phân công</th>
                    <th className="border border-[#047484] p-2.5 text-center w-36">Tiến độ nhập hộ</th>
                    <th className="border border-[#047484] p-2.5 text-center w-36">Bảo mật / Đổi MK</th>
                    <th className="border border-[#047484] p-2.5 text-center w-40">Thao tác Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSurveyors.map((s, idx) => {
                    const roleConfig = ROLE_LABELS[s.role] || ROLE_LABELS.SURVEYOR;
                    const matchedDept = departments.find(d => d.id === s.departmentId || d.name === s.department);
                    
                    const assignedHh = households.filter(h => h.assignedSurveyorId === s.id);
                    const completedHh = assignedHh.filter(h => h.surveyStatus === 'DA_HOAN_THANH' || h.surveyStatus === 'DA_DUYET').length;
                    const isCurrentActive = currentUser?.id === s.id;

                    return (
                      <tr key={s.id} className={`hover:bg-sky-50/80 transition-colors ${isCurrentActive ? 'bg-sky-50 font-medium' : 'odd:bg-slate-50/40'}`}>
                        <td className="border border-slate-300 p-2.5 text-center text-slate-600 font-bold">{idx + 1}</td>
                        
                        <td className="border border-slate-300 p-2.5 text-center font-black text-sky-900 bg-sky-50/50 font-mono">
                          {s.code}
                        </td>

                        <td className="border border-slate-300 p-2.5 text-slate-900">
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-sm">{s.name}</span>
                            {isCurrentActive && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-sky-700 text-white shadow-2xs">
                                Đang đăng nhập
                              </span>
                            )}
                          </div>
                          {s.position && (
                            <span className="text-[10px] text-slate-500 font-medium block">
                              {s.position}
                            </span>
                          )}
                          {s.phone && (
                            <span className="text-[10px] text-slate-500 block">
                              SĐT: {s.phone}
                            </span>
                          )}
                        </td>

                        <td className="border border-slate-300 p-2.5">
                          {matchedDept ? (
                            <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-slate-100 text-slate-800 border border-slate-300 inline-block">
                              {matchedDept.code} - {matchedDept.name}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">Chưa chọn</span>
                          )}
                        </td>

                        <td className="border border-slate-300 p-2.5">
                          <span className={`px-2 py-0.5 rounded font-bold text-[11px] border inline-block ${roleConfig.color}`}>
                            {roleConfig.label}
                          </span>
                        </td>

                        <td className="border border-slate-300 p-2.5">
                          {s.assignedAreas.includes('ALL') ? (
                            <span className="px-2 py-0.5 rounded font-black text-[11px] bg-purple-100 text-purple-900 border border-purple-300 inline-block">
                              Toàn bộ địa bàn trong xã
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {s.assignedAreas.map(code => {
                                const areaObj = areas.find(a => a.code === code);
                                return (
                                  <span
                                    key={code}
                                    className="px-2 py-0.5 rounded font-bold text-[11px] bg-sky-100 text-sky-900 border border-sky-300 inline-flex items-center gap-1"
                                  >
                                    <MapPin className="w-3 h-3 text-sky-700" />
                                    <span>ĐB {code} {areaObj ? `(${areaObj.name})` : ''}</span>
                                  </span>
                                );
                              })}
                              {s.assignedAreas.length === 0 && (
                                <span className="text-slate-400 italic text-[11px]">Chưa phân công địa bàn</span>
                              )}
                            </div>
                          )}
                        </td>

                        <td className="border border-slate-300 p-2.5 text-center">
                          <div className="font-bold text-slate-800">
                            <span className="text-emerald-700 font-extrabold">{completedHh}</span> / <span>{assignedHh.length} hộ</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-1.5 mt-1 overflow-hidden">
                            <div 
                              className="bg-emerald-600 h-1.5 rounded-full transition-all"
                              style={{ width: `${assignedHh.length > 0 ? (completedHh / assignedHh.length) * 100 : 0}%` }}
                            />
                          </div>
                        </td>

                        <td className="border border-slate-300 p-2.5 text-center">
                          {s.mustChangePassword ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-1">
                              <ShieldAlert className="w-3 h-3 text-amber-700" />
                              <span>Yêu cầu đổi MK</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 inline-flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3 text-emerald-700" />
                              <span>Đã bảo mật</span>
                            </span>
                          )}
                        </td>

                        <td className="border border-slate-300 p-2.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSurveyorToResetPassword(s);
                                setNewResetPassword('123456');
                                setResetMustChange(true);
                              }}
                              className="px-2 py-1 text-amber-800 hover:text-amber-950 bg-amber-50 hover:bg-amber-100 rounded border border-amber-300 font-bold text-[11px] flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                              title="Admin Đặt lại Mật khẩu cho tài khoản này"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              <span>Reset MK</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openEditModal(s)}
                              className="p-1.5 text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 rounded border border-sky-200 cursor-pointer"
                              title="Sửa thông tin & Phân quyền"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => setSurveyorToDelete(s)}
                              className="p-1.5 text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200 cursor-pointer"
                              title="Xóa tài khoản này"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredSurveyors.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-500 italic">
                        Không tìm thấy tài khoản nào phù hợp. Vui lòng bấm "+ Cấp Tài Khoản Mới" để tạo mới.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: ADD / EDIT SURVEYOR */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-xl w-full flex flex-col overflow-hidden text-xs">
            <div className="bg-sky-800 text-white p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-sky-200" />
                <h3 className="font-bold text-sm">
                  {editingSurveyor ? `Cập nhật tài khoản: ${editingSurveyor.name}` : 'Thêm mới Cán bộ / Điều tra viên'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-sky-200 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="p-4 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Tên đăng nhập / Mã tài khoản *</label>
                  <input
                    type="text"
                    required
                    value={formCode}
                    onChange={e => setFormCode(e.target.value)}
                    placeholder="VD: DTV01, CANBO_PKT..."
                    className="w-full border border-slate-300 rounded p-2 font-bold text-sky-900 uppercase font-mono"
                  />
                  <span className="text-[10px] text-slate-500">Dùng để đăng nhập hệ thống</span>
                </div>

                <div>
                  <label className="block font-bold text-slate-800 mb-1">Họ và tên cán bộ / ĐTV *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="Nhập họ và tên..."
                    className="w-full border border-slate-300 rounded p-2 font-bold text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Thuộc Phòng Ban Chuyên Trách</label>
                  <select
                    value={formDeptId}
                    onChange={e => setFormDeptId(e.target.value)}
                    className="w-full border border-slate-300 rounded p-2 font-bold text-slate-900"
                  >
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.code} - {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-800 mb-1">Chức vụ / Vị trí công tác</label>
                  <input
                    type="text"
                    value={formPosition}
                    onChange={e => setFormPosition(e.target.value)}
                    placeholder="VD: Trưởng phòng, Cán bộ thống kê..."
                    className="w-full border border-slate-300 rounded p-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Số điện thoại liên hệ</label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={e => setFormPhone(e.target.value)}
                    placeholder="0987.xxx.xxx"
                    className="w-full border border-slate-300 rounded p-2"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-800 mb-1">Email tài khoản</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={e => setFormEmail(e.target.value)}
                    placeholder="canbo@domain.gov.vn"
                    className="w-full border border-slate-300 rounded p-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">
                    Mật khẩu khởi tạo {editingSurveyor ? '(Để trống nếu giữ nguyên)' : '*'}
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswordInForm ? "text" : "password"}
                      value={formPassword}
                      onChange={e => setFormPassword(e.target.value)}
                      placeholder={editingSurveyor ? "Nhập nếu muốn đổi..." : "Nhập mật khẩu..."}
                      className="w-full border border-slate-300 rounded p-2 pr-8 font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordInForm(!showPasswordInForm)}
                      className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPasswordInForm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <span className="text-[10px] text-slate-500">Mật khẩu được lưu trực tiếp an toàn trên Firebase</span>
                </div>

                <div>
                  <label className="block font-bold text-slate-800 mb-1">Trạng thái tài khoản</label>
                  <select
                    value={formStatus}
                    onChange={e => setFormStatus(e.target.value as any)}
                    className="w-full border border-slate-300 rounded p-2 font-bold"
                  >
                    <option value="ACTIVE">Hoạt động (Cho phép đăng nhập)</option>
                    <option value="LOCKED">Khóa (Tạm khóa đăng nhập)</option>
                  </select>
                </div>
              </div>

              {/* Must change password option */}
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-amber-900">
                  <input
                    type="checkbox"
                    checked={formMustChangePassword}
                    onChange={e => setFormMustChangePassword(e.target.checked)}
                    className="rounded text-amber-700 w-4 h-4"
                  />
                  <span>Bắt buộc đổi mật khẩu khi đăng nhập lần đầu vào hệ thống</span>
                </label>
                <p className="text-[11px] text-amber-800 mt-0.5 pl-6">
                  Khi bật, người dùng đăng nhập sẽ hiện ngay hộp thoại bắt buộc thiết lập mật khẩu mới trước khi được vào ứng dụng.
                </p>
              </div>

              {/* Role selection */}
              <div>
                <label className="block font-bold text-slate-800 mb-1">Vai trò & Phân quyền hệ thống</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['SURVEYOR', 'ADMIN', 'SUPERVISOR'] as UserRole[]).map(role => {
                    const r = ROLE_LABELS[role];
                    const isSelected = formRole === role;
                    return (
                      <button
                        type="button"
                        key={role}
                        onClick={() => setFormRole(role)}
                        className={`p-2 rounded-lg border text-left cursor-pointer transition-all flex flex-col gap-1 ${
                          isSelected 
                            ? 'border-sky-700 bg-sky-50 ring-1 ring-sky-700' 
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                        }`}
                      >
                        <span className="font-extrabold text-xs text-slate-900">{r.label}</span>
                        <span className="text-[10px] text-slate-600 leading-tight">{r.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Area assignment */}
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/60">
                <div className="flex items-center justify-between mb-2">
                  <label className="font-bold text-slate-900 text-xs">
                    Phân công Địa bàn được phép nhập phiếu
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-sky-800">
                    <input
                      type="checkbox"
                      checked={formAllAreas}
                      onChange={e => setFormAllAreas(e.target.checked)}
                      className="rounded text-sky-700 w-4 h-4"
                    />
                    <span>Toàn quyền tất cả địa bàn trong xã</span>
                  </label>
                </div>

                {!formAllAreas ? (
                  <div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto p-1 border border-slate-200 bg-white rounded">
                      {areas.map(area => {
                        const isChecked = formAssignedAreas.includes(area.code);
                        return (
                          <label
                            key={area.id}
                            className={`flex items-center gap-2 p-1.5 rounded cursor-pointer text-[11px] border transition-colors ${
                              isChecked ? 'bg-sky-50 border-sky-300 font-bold text-sky-950' : 'border-transparent hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleAreaCheckbox(area.code)}
                              className="rounded text-sky-700"
                            />
                            <span>ĐB {area.code} - {area.name}</span>
                          </label>
                        );
                      })}
                      {areas.length === 0 && (
                        <div className="col-span-3 text-center py-3 text-slate-400 italic">
                          Chưa có danh sách địa bàn. Hãy tải file Excel lên trước.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 bg-purple-50 text-purple-900 rounded border border-purple-200 text-xs">
                    ✓ Người này được phép xem và nhập phiếu của <strong>tất cả các địa bàn</strong> trong xã.
                  </div>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Ghi chú thêm</label>
                <input
                  type="text"
                  value={formNote}
                  onChange={e => setFormNote(e.target.value)}
                  placeholder="Ghi chú đơn vị, nhiệm vụ công tác..."
                  className="w-full border border-slate-300 rounded p-2"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 mt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-sky-800 hover:bg-sky-700 text-white rounded font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSubmitting ? 'Đang lưu lên Firebase...' : 'Lưu Tài Khoản'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD / EDIT DEPARTMENT */}
      {isDeptModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-lg w-full flex flex-col overflow-hidden text-xs">
            <div className="bg-sky-900 text-white p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-sky-200" />
                <h3 className="font-bold text-sm">
                  {editingDepartment ? `Cập nhật Phòng Ban: ${editingDepartment.name}` : 'Thêm mới Phòng Ban Chuyên Trách'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDeptModalOpen(false)}
                className="text-sky-200 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitDeptForm} className="p-4 flex flex-col gap-3.5 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Mã Phòng Ban *</label>
                  <input
                    type="text"
                    required
                    value={deptFormCode}
                    onChange={e => setDeptFormCode(e.target.value)}
                    placeholder="VD: PB01"
                    className="w-full border border-slate-300 rounded p-2 font-bold text-sky-900 uppercase font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-bold text-slate-800 mb-1">Tên Phòng Ban *</label>
                  <input
                    type="text"
                    required
                    value={deptFormName}
                    onChange={e => setDeptFormName(e.target.value)}
                    placeholder="VD: Phòng Thống kê Tổng hợp..."
                    className="w-full border border-slate-300 rounded p-2 font-bold text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Chức năng, Nhiệm vụ điều tra</label>
                <textarea
                  rows={2}
                  value={deptFormDesc}
                  onChange={e => setDeptFormDesc(e.target.value)}
                  placeholder="Mô tả các mảng công việc thu thập, thẩm tra số liệu..."
                  className="w-full border border-slate-300 rounded p-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Trưởng phòng / Phụ trách</label>
                  <input
                    type="text"
                    value={deptFormLeader}
                    onChange={e => setDeptFormLeader(e.target.value)}
                    placeholder="Họ tên người phụ trách..."
                    className="w-full border border-slate-300 rounded p-2"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Số điện thoại liên hệ</label>
                  <input
                    type="text"
                    value={deptFormPhone}
                    onChange={e => setDeptFormPhone(e.target.value)}
                    placeholder="09xx.xxx.xxx"
                    className="w-full border border-slate-300 rounded p-2"
                  />
                </div>
              </div>

              {/* Area assignment for Department */}
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                <label className="block font-bold text-slate-900 mb-1.5">
                  Phân công các Địa bàn giao cho Phòng ban này phụ trách ({deptFormAreas.length} địa bàn):
                </label>
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto p-1 border border-slate-200 bg-white rounded">
                  {areas.map(area => {
                    const isChecked = deptFormAreas.includes(area.code);
                    return (
                      <label
                        key={area.id}
                        className={`flex items-center gap-2 p-1.5 rounded cursor-pointer text-[11px] border transition-colors ${
                          isChecked ? 'bg-sky-50 border-sky-300 font-bold text-sky-950' : 'border-transparent hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleDeptAreaCheckbox(area.code)}
                          className="rounded text-sky-700"
                        />
                        <span>ĐB {area.code} - {area.name}</span>
                      </label>
                    );
                  })}
                  {areas.length === 0 && (
                    <div className="col-span-2 text-center py-2 text-slate-400 italic">
                      Chưa có địa bàn trong hệ thống.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 mt-2">
                <button
                  type="button"
                  onClick={() => setIsDeptModalOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isDeptSubmitting}
                  className="px-5 py-2 bg-sky-800 hover:bg-sky-700 text-white rounded font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>{isDeptSubmitting ? 'Đang lưu...' : 'Lưu Phòng Ban'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: ADMIN RESET PASSWORD */}
      {surveyorToResetPassword && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full flex flex-col overflow-hidden text-xs">
            <div className="bg-amber-700 text-white p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-200" />
                <h3 className="font-bold text-sm">Admin Đặt lại Mật khẩu</h3>
              </div>
              <button
                type="button"
                onClick={() => setSurveyorToResetPassword(null)}
                className="text-white hover:bg-amber-800 p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteResetPassword} className="p-4 flex flex-col gap-3.5">
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-950 flex flex-col gap-1">
                <span className="font-extrabold text-sm">
                  {surveyorToResetPassword.name}
                </span>
                <span className="text-xs font-mono font-bold text-amber-800">
                  Tên đăng nhập: {surveyorToResetPassword.code}
                </span>
                <span className="text-[11px] text-slate-600">
                  Phòng ban: {surveyorToResetPassword.department || '---'}
                </span>
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Mật khẩu mới cấp lại *</label>
                <div className="relative">
                  <input
                    type={showResetPasswordText ? "text" : "password"}
                    required
                    minLength={4}
                    value={newResetPassword}
                    onChange={e => setNewResetPassword(e.target.value)}
                    placeholder="Nhập mật khẩu mới..."
                    className="w-full border border-slate-300 rounded p-2 pr-8 font-bold text-slate-900 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPasswordText(!showResetPasswordText)}
                    className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showResetPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-slate-500">Mật khẩu lưu trực tiếp trên Firebase Cloud</span>
                  <button
                    type="button"
                    onClick={() => setNewResetPassword('123456')}
                    className="text-[10px] text-sky-700 font-bold hover:underline cursor-pointer"
                  >
                    (Đặt mặc định 123456)
                  </button>
                </div>
              </div>

              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800">
                  <input
                    type="checkbox"
                    checked={resetMustChange}
                    onChange={e => setResetMustChange(e.target.checked)}
                    className="rounded text-amber-700 w-4 h-4"
                  />
                  <span>Bắt buộc đổi mật khẩu khi tài khoản đăng nhập tiếp theo</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 mt-1">
                <button
                  type="button"
                  onClick={() => setSurveyorToResetPassword(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isResettingPassword}
                  className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded font-bold cursor-pointer shadow-xs flex items-center gap-1"
                >
                  {isResettingPassword ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Lưu & Đổi mật khẩu</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: DELETE SURVEYOR CONFIRMATION */}
      {surveyorToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full flex flex-col overflow-hidden text-xs">
            <div className="bg-rose-700 text-white p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-200" />
                <h3 className="font-bold text-sm">Xác nhận xóa Người nhập phiếu</h3>
              </div>
              <button
                type="button"
                onClick={() => setSurveyorToDelete(null)}
                className="text-white hover:bg-rose-800 p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-slate-700 text-sm">
                Bạn có chắc chắn muốn xóa tài khoản <strong className="text-rose-700 font-bold">{surveyorToDelete.name}</strong> ({surveyorToDelete.code}) khỏi hệ thống và Firebase?
              </p>
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setSurveyorToDelete(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const target = surveyorToDelete;
                    setSurveyorToDelete(null);
                    await onDeleteSurveyor(target.id);
                    showNotification('success', `Đã xóa người nhập phiếu ${target.name} thành công.`);
                  }}
                  className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded font-bold cursor-pointer shadow-xs"
                >
                  Xác nhận xóa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: DELETE DEPARTMENT CONFIRMATION */}
      {departmentToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full flex flex-col overflow-hidden text-xs">
            <div className="bg-rose-700 text-white p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-200" />
                <h3 className="font-bold text-sm">Xác nhận xóa Phòng Ban</h3>
              </div>
              <button
                type="button"
                onClick={() => setDepartmentToDelete(null)}
                className="text-white hover:bg-rose-800 p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-slate-700 text-sm">
                Bạn có chắc chắn muốn xóa phòng ban <strong className="text-rose-700 font-bold">{departmentToDelete.name}</strong> ({departmentToDelete.code})?
              </p>
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setDepartmentToDelete(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const target = departmentToDelete;
                    setDepartmentToDelete(null);
                    await onDeleteDepartment(target.id);
                    showNotification('success', `Đã xóa phòng ban ${target.name} thành công.`);
                  }}
                  className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded font-bold cursor-pointer shadow-xs"
                >
                  Xác nhận xóa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
