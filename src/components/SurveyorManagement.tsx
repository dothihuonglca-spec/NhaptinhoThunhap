/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, UserPlus, Shield, ShieldCheck, CheckCircle2, Lock, 
  Unlock, Edit3, Trash2, MapPin, Check, AlertCircle, Save, 
  X, Search, UserCheck, RefreshCw, Layers, KeyRound, Eye, EyeOff,
  Building2, Briefcase, Phone, Mail, FileText, CheckSquare, Sparkles,
  ArrowRight, ShieldAlert, BadgeHelp, ChevronDown, Square, SlidersHorizontal, Table,
  Download, Upload, FileSpreadsheet
} from 'lucide-react';
import { Surveyor, UserRole, Department, ROLE_LABELS } from '../types/user';
import { 
  exportPermissionExcelTemplate, 
  exportSimpleAssignExcel,
  parsePermissionExcelFile, 
  ParsedPermissionResult 
} from '../utils/permissionExcelHelper';

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

interface CommuneItem {
  id: string;
  communeCode: string;
  communeName: string;
  tkcsCode?: string;
  tkcsName?: string;
}

/** Chỉ mục dựng MỘT LẦN từ toàn bộ hộ (O(H)); mọi tra cứu sau đó là O(1). */
interface AssignIndex {
  areaById: Map<string, SurveyArea>;
  areaByKey: Map<string, SurveyArea>;          // communeId_code  và  communeCode_code
  areaByCode: Map<string, SurveyArea>;         // chỉ các mã địa bàn DUY NHẤT toàn hệ thống
  codeCount: Map<string, number>;
  communeById: Map<string, CommuneItem>;
  communeByCode: Map<string, CommuneItem>;
  ownersByArea: Map<string, Set<string>>;      // địa bàn -> các ĐTV được ghi trên hộ (đúng ra chỉ 1)
  areasBySurveyor: Map<string, Set<string>>;
  statsBySurveyor: Map<string, { total: number; done: number }>;
  statsByAreaSurveyor: Map<string, { total: number; done: number }>;
  sheetNameByArea: Map<string, string>;
  hhAreaNameByArea: Map<string, string>;
  totals: { assigned: number; completed: number; approved: number };
}

const isGenericName = (n: string | undefined, code: string) => {
  const t = (n || '').trim();
  return !t || t === '001' || t === code || t === 'Địa bàn' || t.startsWith('Địa bàn 001');
};

export function buildAssignIndex(areas: SurveyArea[], communes: CommuneItem[], households: Household[]): AssignIndex {
  const areaById = new Map<string, SurveyArea>(); const areaByKey = new Map<string, SurveyArea>();
  const codeCount = new Map<string, number>(); const communeById = new Map<string, CommuneItem>(); const communeByCode = new Map<string, CommuneItem>();
  communes.forEach(c => { communeById.set(c.id, c); communeByCode.set(c.communeCode, c); });
  areas.forEach(a => {
    areaById.set(a.id, a);
    areaByKey.set(`${a.communeId}_${a.code}`, a);
    const cc = (a as any).communeCode || communeById.get(a.communeId)?.communeCode;
    if (cc) areaByKey.set(`${cc}_${a.code}`, a);
    codeCount.set(a.code, (codeCount.get(a.code) || 0) + 1);
  });
  const areaByCode = new Map<string, SurveyArea>();
  areas.forEach(a => { if (codeCount.get(a.code) === 1) areaByCode.set(a.code, a); });

  const ownersByArea = new Map<string, Set<string>>(); const areasBySurveyor = new Map<string, Set<string>>();
  const statsBySurveyor = new Map<string, { total: number; done: number }>(); const statsByAreaSurveyor = new Map<string, { total: number; done: number }>();
  const sheetNameByArea = new Map<string, string>(); const hhAreaNameByArea = new Map<string, string>();
  const totals = { assigned: 0, completed: 0, approved: 0 };
  const bump = (m: Map<string, { total: number; done: number }>, k: string, done: boolean) => {
    const v = m.get(k); if (v) { v.total++; if (done) v.done++; } else m.set(k, { total: 1, done: done ? 1 : 0 });
  };

  households.forEach(h => {
    const done = h.surveyStatus === 'DA_HOAN_THANH' || h.surveyStatus === 'DA_DUYET';
    if (done) totals.completed++;
    if (h.surveyStatus === 'DA_DUYET') totals.approved++;
    const ar = areaById.get(h.areaId) || areaByKey.get(`${h.communeId}_${h.areaCode}`) || areaByKey.get(`${(h as any).communeCode}_${h.areaCode}`);
    const sid = h.assignedSurveyorId;
    if (sid) {
      totals.assigned++;
      bump(statsBySurveyor, sid, done);
      if (ar) {
        bump(statsByAreaSurveyor, `${ar.id}_${sid}`, done);
        (ownersByArea.get(ar.id) || ownersByArea.set(ar.id, new Set()).get(ar.id)!).add(sid);
        (areasBySurveyor.get(sid) || areasBySurveyor.set(sid, new Set()).get(sid)!).add(ar.id);
      }
    }
    if (ar) {
      if (!sheetNameByArea.has(ar.id) && !isGenericName((h as any).sheetName, ar.code)) sheetNameByArea.set(ar.id, String((h as any).sheetName).trim());
      if (!hhAreaNameByArea.has(ar.id) && !isGenericName(h.areaName, ar.code) && h.areaName !== h.areaCode) hhAreaNameByArea.set(ar.id, h.areaName.trim());
    }
  });
  return { areaById, areaByKey, areaByCode, codeCount, communeById, communeByCode, ownersByArea, areasBySurveyor, statsBySurveyor, statsByAreaSurveyor, sheetNameByArea, hhAreaNameByArea, totals };
}

/**
 * Các địa bàn của một tài khoản. So khớp CHÍNH XÁC theo id / communeId_code / communeCode_code;
 * mã trần ("001") chỉ dùng khi mã đó là duy nhất. Địa bàn đã có chủ (ghi trên hộ) thì chỉ tính cho đúng chủ đó.
 */
export function calcAreaIds(ix: AssignIndex, s: Surveyor, pool: SurveyArea[]): string[] {
  const listed = new Set<string>();
  (s.assignedAreas || []).forEach(k => {
    const a = ix.areaById.get(k) || ix.areaByKey.get(k) || ix.areaByCode.get(k);
    if (a) listed.add(a.id);
  });
  return pool.filter(a => {
    const owners = ix.ownersByArea.get(a.id);
    if (owners && owners.size > 0) return owners.has(s.id);
    return listed.has(a.id);
  }).map(a => a.id);
}

interface SurveyorManagementProps {
  surveyors: Surveyor[];
  departments: Department[];
  areas: SurveyArea[];
  communes?: CommuneItem[];
  households: Household[];
  currentUser: Surveyor;
  onSaveSurveyor: (surveyor: Surveyor) => Promise<void>;
  onDeleteSurveyor: (id: string) => Promise<void>;
  onSaveDepartment: (department: Department) => Promise<void>;
  onDeleteDepartment: (id: string) => Promise<void>;
  onBatchAssignArea: (surveyorId: string, areaCode: string | string[], communeIdsOrCodes?: string[], scopeAreaIds?: string[]) => Promise<void>;
  onUnassignArea?: (surveyorId: string, areaIdOrCode: string) => Promise<void>;
  onBatchImportAssignments?: (assignments: { surveyorId: string; areaIds: string[]; communeIds: string[] }[]) => Promise<void>;
  onBatchAssignDepartmentArea: (departmentId: string, areaCodes: string[]) => Promise<void>;
  onSelectActiveUser: (surveyor: Surveyor) => void;
  showNotification: (type: 'success' | 'error', msg: string) => void;
  onSyncFirebase?: () => Promise<void>;
  isSyncing?: boolean;
}

export default function SurveyorManagement({
  surveyors,
  departments,
  areas,
  communes = [],
  households,
  currentUser,
  onSaveSurveyor,
  onDeleteSurveyor,
  onSaveDepartment,
  onDeleteDepartment,
  onBatchAssignArea,
  onUnassignArea,
  onBatchImportAssignments,
  onBatchAssignDepartmentArea,
  onSelectActiveUser,
  showNotification,
  onSyncFirebase,
  isSyncing = false
}: SurveyorManagementProps) {
  const [subTab, setSubTab] = useState<'departments' | 'gsv' | 'dtv' | 'permissions'>('gsv');
  const [viewMode, setViewMode] = useState<'grid_areas' | 'summary_accounts'>('grid_areas');
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [gridTkcsFilter, setGridTkcsFilter] = useState<string>('ALL');
  const [gridCommuneFilter, setGridCommuneFilter] = useState<string>('ALL');
  
  // Surveyor Add/Edit Modal
  const [editingSurveyor, setEditingSurveyor] = useState<Surveyor | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Department Add/Edit Modal
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);

  // Quick assignment state
  const [assignSurveyorId, setAssignSurveyorId] = useState<string>(surveyors[0]?.id || '');
  const [quickAssignTkcs, setQuickAssignTkcs] = useState<string>('ALL');
  const [quickAssignCommuneId, setQuickAssignCommuneId] = useState<string>('ALL');
  const [quickAssignSelectedAreaIds, setQuickAssignSelectedAreaIds] = useState<string[]>([]);
  const [isAreaDropdownOpen, setIsAreaDropdownOpen] = useState(false);
  const [surveyorCommuneFilter, setSurveyorCommuneFilter] = useState<string>('ALL');
  const [isAssigning, setIsAssigning] = useState(false);

  // Phạm vi địa bàn & xã mà Giám sát viên được phân công phụ trách
  const allowedSupervisorCommunes = React.useMemo(() => {
    if (!currentUser || currentUser.role !== 'SUPERVISOR') return communes;
    if (currentUser.assignedCommunes && !currentUser.assignedCommunes.includes('ALL') && currentUser.assignedCommunes.length > 0) {
      return communes.filter(c => 
        currentUser.assignedCommunes?.includes(c.id) || 
        currentUser.assignedCommunes?.includes(c.communeCode)
      );
    }
    if (currentUser.assignedAreas && !currentUser.assignedAreas.includes('ALL') && currentUser.assignedAreas.length > 0) {
      const commIds = new Set(areas.filter(a => 
        currentUser.assignedAreas?.includes(a.id) || 
        currentUser.assignedAreas?.includes(a.code) || 
        currentUser.assignedAreas?.includes(`${a.communeId}_${a.code}`)
      ).map(a => a.communeId));
      return communes.filter(c => commIds.has(c.id) || commIds.has(c.communeCode));
    }
    return communes;
  }, [communes, areas, currentUser]);

  const allowedSupervisorAreas = React.useMemo(() => {
    if (!currentUser || currentUser.role !== 'SUPERVISOR') return areas;
    const commIds = new Set(allowedSupervisorCommunes.map(c => c.id));
    const commCodes = new Set(allowedSupervisorCommunes.map(c => c.communeCode));
    return areas.filter(a => 
      commIds.has(a.communeId) || 
      commCodes.has((a as any).communeCode)
    );
  }, [areas, allowedSupervisorCommunes, currentUser]);

  const idx = React.useMemo(() => buildAssignIndex(areas, communes, households), [areas, communes, households]);
  const idxRef = useRef(idx); idxRef.current = idx;

  // Tự động tích chọn các địa bàn mà cán bộ này đang phụ trách. Chỉ chạy lại khi ĐỔI NGƯỜI hoặc khi danh sách địa bàn
  // của chính người đó đổi (không chạy lại mỗi lần bảng kê cập nhật => không làm mất lựa chọn đang tích dở).
  const assignSig = React.useMemo(() => {
    const s = surveyors.find(x => x.id === assignSurveyorId);
    return `${(s?.assignedAreas || []).join('|')}#${Array.from(idx.areasBySurveyor.get(assignSurveyorId) || []).sort().join('|')}`;
  }, [surveyors, assignSurveyorId, idx]);

  useEffect(() => {
    const s = surveyors.find(item => item.id === assignSurveyorId);
    if (!s) { setQuickAssignSelectedAreaIds([]); return; }
    if ((s.assignedAreas || []).includes('ALL')) { setQuickAssignSelectedAreaIds(allowedSupervisorAreas.map(a => a.id)); return; }
    setQuickAssignSelectedAreaIds(calcAreaIds(idxRef.current, s, allowedSupervisorAreas));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignSurveyorId, assignSig, allowedSupervisorAreas]);

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
  const [formAssignedAreas, setFormAssignedAreas] = useState<string[]>([]); // stores area.ids
  // Commune & TKCS filter when assigning areas in Surveyor Modal
  const [modalTkcsFilter, setModalTkcsFilter] = useState<string>('ALL');
  const [modalAreaCommuneFilter, setModalAreaCommuneFilter] = useState<string>(communes[0]?.id || 'ALL');

  const uniqueTkcsList = React.useMemo(() => {
    const map = new Map<string, string>();
    communes.forEach(c => {
      const code = c.tkcsCode || 'TKCS-01';
      const name = c.tkcsName || 'Thống kê cơ sở';
      map.set(code, `${code} - ${name}`);
    });
    return Array.from(map.entries()).map(([code, label]) => ({ code, label }));
  }, [communes]);



  // Supervisor commune assignment state
  const [formAllCommunes, setFormAllCommunes] = useState<boolean>(false);
  const [formAssignedCommunes, setFormAssignedCommunes] = useState<string[]>([]);
  const [supervisorCommuneSearch, setSupervisorCommuneSearch] = useState<string>('');
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
  const [deptModalAreaCommuneFilter, setDeptModalAreaCommuneFilter] = useState<string>(communes[0]?.id || 'ALL');
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

  useEffect(() => {
    if (communes.length > 0) {
      if (modalAreaCommuneFilter === 'ALL') {
        setModalAreaCommuneFilter(communes[0].id);
      }
      if (deptModalAreaCommuneFilter === 'ALL') {
        setDeptModalAreaCommuneFilter(communes[0].id);
      }
    }
  }, [communes, areas]);

  // Tên địa bàn: ưu tiên Tên sheet của bảng kê, rồi tên địa bàn; bỏ qua tên chung chung ("001", "Địa bàn"...). Tra cứu O(1).
  const getAreaDisplayName = (areaIdOrCode: string, communeIdOrCode?: string) => {
    let area = idx.areaById.get(areaIdOrCode);
    if (!area && communeIdOrCode) area = idx.areaByKey.get(`${communeIdOrCode}_${areaIdOrCode}`);
    if (!area) area = idx.areaByCode.get(areaIdOrCode);
    const code = area?.code || areaIdOrCode;
    if (area) {
      const sheet = idx.sheetNameByArea.get(area.id);
      if (sheet) return sheet;
      if (!isGenericName(area.name, code)) return area.name.trim();
      const hn = idx.hhAreaNameByArea.get(area.id);
      if (hn) return hn;
    }
    return `Địa bàn ${code}`;
  };

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
    const targetRole = subTab === 'gsv' ? 'SUPERVISOR' : 'SURVEYOR';
    setFormRole(targetRole);
    setFormDeptId(currentUser.role === 'SUPERVISOR' ? (currentUser.departmentId || 'pb_01') : (defaultDeptId || (departments[0]?.id || 'pb_01')));
    setFormPosition(subTab === 'gsv' ? 'Trưởng phòng' : 'Cán bộ điều tra viên');
    setFormAllAreas(false);
    setFormAssignedAreas([]);
    setModalTkcsFilter('ALL');
    setModalAreaCommuneFilter(communes[0]?.id || 'ALL');
    setFormAllCommunes(false);
    setFormAssignedCommunes([]);
    setSupervisorCommuneSearch('');
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
    const matchedIds = calcAreaIds(idx, s, areas);
    setFormAssignedAreas(matchedIds);
    setModalTkcsFilter('ALL');
    setModalAreaCommuneFilter(communes[0]?.id || 'ALL');
    setFormAllCommunes(Boolean(s.assignedCommunes?.includes('ALL')));
    setFormAssignedCommunes(s.assignedCommunes ? s.assignedCommunes.filter(c => c !== 'ALL') : []);
    setSupervisorCommuneSearch('');
    setFormStatus(s.status === 'LOCKED' ? 'LOCKED' : 'ACTIVE');
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
    setDeptModalAreaCommuneFilter(communes[0]?.id || 'ALL');
    setIsDeptModalOpen(true);
  };

  const openEditDeptModal = (d: Department) => {
    setEditingDepartment(d);
    setDeptFormCode(d.code || '');
    setDeptFormName(d.name);
    setDeptFormDesc(d.description || '');
    setDeptFormLeader(d.leaderName || '');
    setDeptFormPhone(d.leaderPhone || '');
    setDeptFormAreas(d.assignedAreaCodes || []);
    setDeptModalAreaCommuneFilter(communes[0]?.id || 'ALL');
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
      const assigned = formAllAreas ? ['ALL'] : Array.from(new Set(formAssignedAreas.filter(id => id && id !== '001').map(id => {
        const ar = areas.find(a => a.id === id);
        return ar ? ar.id : id;
      })));
      const assignedComm = formAllCommunes ? ['ALL'] : formAssignedCommunes;
      const matchedDept = departments.find(d => d.id === formDeptId);

      const newSurveyor: Surveyor = {
        id: editingSurveyor ? editingSurveyor.id : 'dtv_' + Date.now(),
        code: formCode.trim().toUpperCase(),
        username: editingSurveyor?.username || formCode.trim().toLowerCase(),
        name: formName.trim(),
        phone: formPhone.trim(),
        email: formEmail.trim(),
        password: formPassword.trim() || (editingSurveyor?.password || '123456'),
        role: formRole,
        departmentId: formDeptId,
        department: matchedDept ? matchedDept.name : formDeptId,
        position: formPosition.trim(),
        assignedAreas: assigned,
        assignedCommunes: formRole === 'SUPERVISOR' 
          ? (formAllCommunes ? ['ALL'] : (assignedComm.length === 0 ? ['ALL'] : assignedComm)) 
          : undefined,
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

  const handleToggleAreaCheckbox = (areaId: string) => {
    if (formAssignedAreas.includes(areaId)) {
      setFormAssignedAreas(formAssignedAreas.filter(id => id !== areaId));
    } else {
      setFormAssignedAreas([...formAssignedAreas, areaId]);
    }
  };

  const handleToggleDeptAreaCheckbox = (code: string) => {
    if (deptFormAreas.includes(code)) {
      setDeptFormAreas(deptFormAreas.filter(c => c !== code));
    } else {
      setDeptFormAreas([...deptFormAreas, code]);
    }
  };

  const quickAssignFilteredCommunes = React.useMemo(() => {
    if (quickAssignTkcs === 'ALL') return allowedSupervisorCommunes;
    return allowedSupervisorCommunes.filter(c => (c.tkcsCode || 'TKCS-01') === quickAssignTkcs);
  }, [allowedSupervisorCommunes, quickAssignTkcs]);

  const quickAssignAvailableAreas = React.useMemo(() => {
    return allowedSupervisorAreas.filter(a => {
      const commObj = allowedSupervisorCommunes.find(c => c.id === a.communeId || c.communeCode === (a as any).communeCode);
      if (quickAssignTkcs !== 'ALL' && commObj && (commObj.tkcsCode || 'TKCS-01') !== quickAssignTkcs) {
        return false;
      }
      if (quickAssignCommuneId === 'ALL') return true;
      return a.communeId === quickAssignCommuneId || (a as any).communeCode === quickAssignCommuneId;
    });
  }, [allowedSupervisorAreas, allowedSupervisorCommunes, quickAssignTkcs, quickAssignCommuneId]);

  const gridCommunes = React.useMemo(
    () => (gridTkcsFilter === 'ALL' ? allowedSupervisorCommunes : allowedSupervisorCommunes.filter(c => (c.tkcsCode || 'TKCS-01') === gridTkcsFilter)),
    [allowedSupervisorCommunes, gridTkcsFilter]);
  const quickSelectedSet = React.useMemo(() => new Set(quickAssignSelectedAreaIds), [quickAssignSelectedAreaIds]);

  const handleToggleSelectAllQuickAreas = () => {
    const allIds = quickAssignAvailableAreas.map(a => a.id);
    const allSelected = allIds.length > 0 && allIds.every(id => quickAssignSelectedAreaIds.includes(id));
    if (allSelected) {
      setQuickAssignSelectedAreaIds(quickAssignSelectedAreaIds.filter(id => !allIds.includes(id)));
    } else {
      setQuickAssignSelectedAreaIds(Array.from(new Set([...quickAssignSelectedAreaIds, ...allIds])));
    }
  };

  const handleToggleQuickArea = (areaId: string) => {
    if (quickAssignSelectedAreaIds.includes(areaId)) {
      setQuickAssignSelectedAreaIds(quickAssignSelectedAreaIds.filter(id => id !== areaId));
    } else {
      setQuickAssignSelectedAreaIds([...quickAssignSelectedAreaIds, areaId]);
    }
  };

  const handleExecuteBatchAssign = async () => {
    if (!assignSurveyorId) {
      showNotification('error', 'Vui lòng chọn Cán bộ / Điều tra viên cần phân công.');
      return;
    }
    const targetSurveyor = surveyors.find(s => s.id === assignSurveyorId);
    if (!targetSurveyor) return;

    const areaIdsToAssign = quickAssignSelectedAreaIds;
    const scopeAreaIds = quickAssignAvailableAreas.map(a => a.id);

    const assignedAreasList = allowedSupervisorAreas.filter(a => areaIdsToAssign.includes(a.id));
    const communeIdsToAssign = Array.from(new Set(assignedAreasList.map(a => a.communeId).filter(Boolean)));

    try {
      setIsAssigning(true);
      await onBatchAssignArea(
        assignSurveyorId, 
        areaIdsToAssign, 
        communeIdsToAssign.length > 0 ? communeIdsToAssign : quickAssignFilteredCommunes.map(c => c.id),
        scopeAreaIds
      );
      showNotification('success', `Đã cập nhật phân công cho ${targetSurveyor.name} thành công (${areaIdsToAssign.length} địa bàn được chọn)!`);
      setIsAreaDropdownOpen(false);
    } catch (err: any) {
      showNotification('error', 'Lỗi phân công địa bàn: ' + err.message);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleExportTemplate = () => {
    try {
      exportSimpleAssignExcel(communes, areas, surveyors, households as any);
      showNotification('success', 'Đã tải file phân quyền: điền cột "Tên Người nhập / ĐTV" rồi bấm Tải lên Excel.');
    } catch (err: any) {
      showNotification('error', 'Lỗi khi xuất file: ' + err.message);
    }
  };

  const handleExportFullTemplate = () => {
    try {
      exportPermissionExcelTemplate(communes, areas, surveyors, households as any);
      showNotification('success', 'Đã tải file mẫu đầy đủ cột.');
    } catch (err: any) {
      showNotification('error', 'Lỗi khi xuất file mẫu: ' + err.message);
    }
  };

  const handleImportExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsAssigning(true);
      const result = await parsePermissionExcelFile(file, communes, areas, surveyors);
      if (result.assignments.length === 0) {
        showNotification('error', 'Không có dòng phân công hợp lệ.' + (result.warnings.length ? ' ' + result.warnings.slice(0, 3).join(' | ') : ''));
        return;
      }
      // Xem trước: cho admin thấy sẽ gán gì và những dòng có vấn đề trước khi áp dụng
      const lines = result.assignments.map(a => `• ${a.surveyor.name}: ${a.areaIds.length} địa bàn`).slice(0, 12);
      const warnLines = result.warnings.slice(0, 8).map(w => `  - ${w}`);
      const preview =
        `Sẽ phân công ${result.assignments.reduce((n, a) => n + a.areaIds.length, 0)} địa bàn cho ${result.assignments.length} người:\n${lines.join('\n')}` +
        (result.assignments.length > 12 ? `\n… và ${result.assignments.length - 12} người nữa` : '') +
        (result.blankRows ? `\n\n${result.blankRows} dòng để trống cột ĐTV: giữ nguyên.` : '') +
        (result.warnings.length ? `\n\n⚠ ${result.warnings.length} dòng có vấn đề (sẽ bỏ qua):\n${warnLines.join('\n')}${result.warnings.length > 8 ? '\n  …' : ''}` : '') +
        `\n\nÁp dụng?`;
      if (!window.confirm(preview)) {
        showNotification('error', 'Đã hủy, chưa thay đổi gì.');
        return;
      }
      if (onBatchImportAssignments) {
        const importPayload = result.assignments.map(a => ({
          surveyorId: a.surveyor.id,
          areaIds: a.areaIds,
          communeIds: a.communeIds
        }));
        await onBatchImportAssignments(importPayload);
      }
      let msg = `Đã phân công thành công từ Excel cho ${result.assignments.length} cán bộ (${result.validRows} địa bàn).`;
      if (result.warnings.length > 0) {
        msg += ` Cảnh báo: ${result.warnings.length} dòng có vấn đề.`;
      }
      showNotification('success', msg);
    } catch (err: any) {
      showNotification('error', 'Lỗi khi đọc file Excel phân quyền: ' + err.message);
    } finally {
      setIsAssigning(false);
      e.target.value = '';
    }
  };

  // Stats
  const totalSurveyors = surveyors.length;
  const activeCount = surveyors.filter(s => s.status === 'ACTIVE').length;
  const totalHouseholds = households.length;
  const assignedHouseholds = idx.totals.assigned;
  const completedHouseholds = idx.totals.completed;
  const approvedHouseholds = idx.totals.approved;

  const isGsv = (s: Surveyor) => {
    if (s.role === 'ADMIN') return false;
    return s.role === 'SUPERVISOR' || (s.position || '').toLowerCase().includes('trưởng phòng') || s.name === 'Trần Thị Thanh Huyền';
  };

  const filteredSurveyors = React.useMemo(() => surveyors.filter(s => {
    if (s.role !== 'ADMIN' && currentUser.role === 'ADMIN') {
      const gsvUser = isGsv(s);
      if (subTab === 'gsv' && !gsvUser) return false;
      if (subTab === 'dtv' && gsvUser) return false;
    }

    // Giám sát viên chỉ được thấy và quản lý cán bộ thuộc phòng ban mình phụ trách
    if (currentUser.role === 'SUPERVISOR') {
      const myDeptId = (currentUser.departmentId || '').trim().toLowerCase();
      const myDeptName = (currentUser.department || '').trim().toLowerCase();
      const sDeptId = (s.departmentId || '').trim().toLowerCase();
      const sDeptName = (s.department || '').trim().toLowerCase();

      const matchDept = (myDeptId && sDeptId === myDeptId) || 
                        (myDeptName && sDeptName === myDeptName) ||
                        (myDeptId && sDeptId.includes(myDeptId)) ||
                        (myDeptName && sDeptName.includes(myDeptName)) ||
                        (s.id === currentUser.id);
      if (!matchDept) return false;
    }

    if (roleFilter !== 'ALL' && s.role !== roleFilter) return false;
    if (deptFilter !== 'ALL' && s.departmentId !== deptFilter && s.department !== deptFilter) return false;
    if (surveyorCommuneFilter !== 'ALL') {
      const commObj = idx.communeById.get(surveyorCommuneFilter) || idx.communeByCode.get(surveyorCommuneFilter);
      const cId = commObj?.id || surveyorCommuneFilter;
      const cCode = commObj?.communeCode || surveyorCommuneFilter;
      const inCommune = (a?: SurveyArea) => !!a && (a.communeId === cId || (a as any).communeCode === cCode);

      const matchesSupervisor = s.role === 'SUPERVISOR' && (
        s.assignedCommunes?.includes('ALL') || s.assignedCommunes?.includes(cId) || s.assignedCommunes?.includes(cCode)
      );
      const matchesSurveyor = s.assignedAreas.includes('ALL') ||
        s.assignedAreas.some(item => inCommune(idx.areaById.get(item) || idx.areaByKey.get(item) || idx.areaByCode.get(item))) ||
        Array.from(idx.areasBySurveyor.get(s.id) || []).some(id => inCommune(idx.areaById.get(id)));
      const matchesAdmin = s.role === 'ADMIN';

      if (!matchesSupervisor && !matchesSurveyor && !matchesAdmin) return false;
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      if (
        s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || (s.phone || '').includes(q) ||
        (s.department || '').toLowerCase().includes(q) || (s.position || '').toLowerCase().includes(q) || (s.note || '').toLowerCase().includes(q)
      ) return true;
      // tìm theo tên địa bàn / tên xã / mã xã mà người đó phụ trách
      const ids = new Set<string>(idx.areasBySurveyor.get(s.id) || []);
      s.assignedAreas.forEach(k => { const a = idx.areaById.get(k) || idx.areaByKey.get(k); if (a) ids.add(a.id); });
      for (const id of ids) {
        const a = idx.areaById.get(id); if (!a) continue;
        const c = idx.communeById.get(a.communeId);
        if (getAreaDisplayName(a.id, a.communeId).toLowerCase().includes(q) || (c && (c.communeName.toLowerCase().includes(q) || c.communeCode.includes(q)))) return true;
      }
      return false;
    }
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [surveyors, currentUser, subTab, roleFilter, deptFilter, surveyorCommuneFilter, searchTerm, idx]);

  interface AssignmentGridItem {
    rowKey: string;
    surveyor: Surveyor;
    tkcsCode: string;
    tkcsName: string;
    communeName: string;
    communeCode: string;
    username: string;
    fullName: string;
    departmentName: string;
    roleLabel: string;
    role: UserRole;
    areaDisplayName: string;
    areaCode: string;
    areaId?: string;
    isAssignedArea: boolean;
    totalHh: number;
    completedHh: number;
  }

  const assignmentGridRows = React.useMemo(() => {
    const rows: AssignmentGridItem[] = [];

    filteredSurveyors.forEach(s => {
      const matchedDept = departments.find(d => d.id === s.departmentId || d.name === s.department);
      const deptName = matchedDept ? `${matchedDept.code} - ${matchedDept.name}` : (s.department || 'Chưa chọn');
      const roleConfig = ROLE_LABELS[s.role] || ROLE_LABELS.SURVEYOR;

      const cleanedAreas = (s.assignedAreas || []).filter(item => item !== '001');

      if (cleanedAreas.length > 0 && !cleanedAreas.includes('ALL')) {
        cleanedAreas.forEach(areaKey => {
          const matchedArea = idx.areaById.get(areaKey) || idx.areaByKey.get(areaKey) || idx.areaByCode.get(areaKey);
          const matchedCommune = matchedArea ? (idx.communeById.get(matchedArea.communeId) || idx.communeByCode.get((matchedArea as any).communeCode)) : undefined;
          
          const tkcsCode = matchedCommune?.tkcsCode || 'TKCS-01';
          const tkcsName = matchedCommune?.tkcsName || 'Thống kê cơ sở';
          const communeName = matchedCommune?.communeName || (matchedArea ? `Xã mã ${matchedArea.communeId}` : '---');
          const communeCode = matchedCommune?.communeCode || (matchedArea ? String(matchedArea.communeId) : '---');
          const areaDisplayName = matchedArea ? getAreaDisplayName(matchedArea.id, matchedArea.communeId) : `Địa bàn ${areaKey}`;
          const areaCode = matchedArea?.code || areaKey;

          const st = matchedArea ? idx.statsByAreaSurveyor.get(`${matchedArea.id}_${s.id}`) : undefined;
          const stats = { total: st?.total || 0, completed: st?.done || 0 };

          rows.push({
            rowKey: `${s.id}_${areaKey}`,
            surveyor: s,
            tkcsCode,
            tkcsName: `${tkcsCode} - ${tkcsName}`,
            communeName,
            communeCode,
            username: s.code,
            fullName: s.name,
            departmentName: deptName,
            roleLabel: roleConfig.label,
            role: s.role,
            areaDisplayName: `${areaDisplayName} (ĐB ${areaCode})`,
            areaCode,
            areaId: matchedArea?.id || areaKey,
            isAssignedArea: true,
            totalHh: stats.total,
            completedHh: stats.completed
          });
        });
      } else if (cleanedAreas.includes('ALL')) {
        rows.push({
          rowKey: `${s.id}_ALL`,
          surveyor: s,
          tkcsCode: 'Tất cả',
          tkcsName: 'Tất cả TKCS',
          communeName: 'Toàn bộ xã phụ trách',
          communeCode: 'ALL',
          username: s.code,
          fullName: s.name,
          departmentName: deptName,
          roleLabel: roleConfig.label,
          role: s.role,
          areaDisplayName: 'Toàn bộ địa bàn trong xã',
          areaCode: 'ALL',
          isAssignedArea: true,
          totalHh: idx.statsBySurveyor.get(s.id)?.total || 0,
          completedHh: idx.statsBySurveyor.get(s.id)?.done || 0
        });
      } else {
        rows.push({
          rowKey: `${s.id}_none`,
          surveyor: s,
          tkcsCode: '---',
          tkcsName: '---',
          communeName: '---',
          communeCode: '---',
          username: s.code,
          fullName: s.name,
          departmentName: deptName,
          roleLabel: roleConfig.label,
          role: s.role,
          areaDisplayName: 'Chưa phân công địa bàn',
          areaCode: '---',
          isAssignedArea: false,
          totalHh: 0,
          completedHh: 0
        });
      }
    });

    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSurveyors, departments, areas, communes, idx]);

  const filteredGridRows = React.useMemo(() => {
    return assignmentGridRows.filter(row => {
      if (gridTkcsFilter !== 'ALL') {
        if (row.tkcsCode !== '---' && row.tkcsCode !== 'Tất cả' && row.tkcsCode !== gridTkcsFilter) {
          return false;
        }
      }
      if (gridCommuneFilter !== 'ALL') {
        if (row.communeCode !== '---' && row.communeCode !== 'ALL' && row.communeCode !== gridCommuneFilter) {
          return false;
        }
      }
      return true;
    });
  }, [assignmentGridRows, gridTkcsFilter, gridCommuneFilter]);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Firebase Sync & Quota Info Card */}
      <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-sky-600 text-white rounded-lg mt-0.5">
            <RefreshCw className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <h3 className="font-bold text-sky-950 text-sm flex items-center gap-2">
              <span>Trạng thái Đồng bộ & Hạn mức Firebase Firestore</span>
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-black text-[10px]">Trực tuyến</span>
            </h3>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">                         
              • <em></em>Dữ liệu luôn được lưu tại bộ nhớ trình duyệt (LocalStorage).Bấm nút đồng bộ để kiểm tra kết nối Cloud.
            </p>
          </div>
        </div>
        {onSyncFirebase && (
          <button
            type="button"
            onClick={onSyncFirebase}
            disabled={isSyncing}
            className="px-4 py-2 bg-sky-800 hover:bg-sky-700 active:bg-sky-900 disabled:opacity-50 text-white rounded-lg font-bold text-xs flex items-center gap-2 shadow-sm cursor-pointer transition-colors shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Đang đồng bộ...' : 'Đồng bộ ngay với Firebase'}</span>
          </button>
        )}
      </div>

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
          {/* Sub-tab switcher - Only visible to ADMIN */}
          {currentUser.role === 'ADMIN' ? (
            <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setSubTab('gsv')}
                className={`px-3.5 py-1.5 rounded-md font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                  subTab === 'gsv' 
                    ? 'bg-sky-800 text-white shadow-xs' 
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <Shield className="w-4 h-4" />
                <span>1. DS và phân quyền GSV</span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('dtv')}
                className={`px-3.5 py-1.5 rounded-md font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                  subTab === 'dtv' 
                    ? 'bg-sky-800 text-white shadow-xs' 
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>2. DS và phân quyền cho ĐTV</span>
              </button>
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
                <span>5 Phòng Ban</span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('permissions')}
                className={`px-3.5 py-1.5 rounded-md font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                  subTab === 'permissions' 
                    ? 'bg-sky-800 text-white shadow-xs' 
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Bảng Phân Quyền</span>
              </button>
            </div>
          ) : null}

          {currentUser.role === 'SUPERVISOR' ? (
            <button
              type="button"
              onClick={() => openAddModal()}
              className="px-3.5 py-2 bg-sky-800 hover:bg-sky-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ Cấp Tài Khoản Mới</span>
            </button>
          ) : (
            subTab === 'departments' ? (
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
            )
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 text-sky-700" />
            <span>{currentUser.role === 'SUPERVISOR' ? 'Phòng ban phụ trách' : 'Phòng ban chuyên trách'}</span>
          </span>
          <div className="flex items-baseline justify-between mt-1">
            {currentUser.role === 'SUPERVISOR' ? (
              <>
                <span className="text-sm font-black text-sky-950 truncate max-w-[170px]" title={currentUser.department}>
                  {currentUser.department || 'Phòng ban'}
                </span>
                <span className="text-xs font-bold text-sky-800 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                  Phòng của bạn
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl font-black text-sky-950">{departments.length}</span>
                <span className="text-xs font-bold text-sky-800 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                  5 phòng ban
                </span>
              </>
            )}
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-emerald-700" />
            <span>{currentUser.role === 'SUPERVISOR' ? 'Cán bộ thuộc phòng' : 'Tổng số cán bộ / ĐTV'}</span>
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-black text-slate-900">
              {currentUser.role === 'SUPERVISOR' ? filteredSurveyors.length : totalSurveyors}
            </span>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              {filteredSurveyors.filter(s => s.status === 'ACTIVE').length} đang hoạt động
            </span>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-amber-700" />
            <span>{currentUser.role === 'SUPERVISOR' ? 'Địa bàn phụ trách' : 'Hộ đã phân công ĐTV'}</span>
          </span>
          <div className="flex items-baseline justify-between mt-1">
            {currentUser.role === 'SUPERVISOR' ? (
              <>
                <span className="text-2xl font-black text-amber-900">{allowedSupervisorAreas.length}</span>
                <span className="text-xs font-semibold text-slate-600">
                  {allowedSupervisorCommunes.length} xã/phường
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl font-black text-amber-900">{assignedHouseholds}</span>
                <span className="text-xs font-semibold text-slate-600">
                  / {totalHouseholds} hộ ({totalHouseholds > 0 ? Math.round((assignedHouseholds / totalHouseholds) * 100) : 0}%)
                </span>
              </>
            )}
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
                            setSubTab('dtv');
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
                            <span>{getAreaDisplayName(a.id, a.communeId)} (ĐB {a.code})</span>
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
      {(subTab === 'gsv' || subTab === 'dtv') && (
        <div className="flex flex-col gap-4">
          {/* Quick Batch Assignment Box */}
          <div className="bg-linear-to-r from-sky-50 to-indigo-50 border border-sky-200 rounded-lg p-3.5 flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-sky-800 shrink-0" />
              <div>
                <h4 className="font-bold text-sky-950">Phân công nhanh toàn bộ hộ theo Địa bàn</h4>
                <p className="text-slate-600 text-[11px]">
                  Gán nhanh danh sách hộ thuộc một hoặc nhiều địa bàn cho Cán bộ / ĐTV phụ trách nhập phiếu.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              {/* 1. Gán cho */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-700 font-medium">Gán cho:</span>
                <select
                  value={assignSurveyorId}
                  onChange={e => setAssignSurveyorId(e.target.value)}
                  className="bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-900 focus:outline-sky-500"
                >
                  {filteredSurveyors.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.code} - {s.name} ({s.department || (ROLE_LABELS[s.role as UserRole]?.label ?? 'Không xác định')})
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Lọc theo TKCS - Thêm sau nút lọc Gán cho */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-700 font-medium">Lọc theo TKCS:</span>
                <select
                  value={quickAssignTkcs}
                  onChange={e => {
                    const val = e.target.value;
                    setQuickAssignTkcs(val);
                    setQuickAssignCommuneId('ALL');   // đổi TKCS thì bỏ xã đang chọn (tránh danh sách rỗng do xã không thuộc TKCS mới)
                  }}
                  className="bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-900 focus:outline-sky-500"
                  title="Lọc theo Thống kê cơ sở"
                >
                  <option value="ALL">-- Tất cả TKCS ({uniqueTkcsList.length}) --</option>
                  {uniqueTkcsList.map(t => (
                    <option key={t.code} value={t.code}>
                      [{t.code}] {t.label.split(' - ')[1] || t.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Lọc theo Xã / Phường */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-700 font-bold text-sky-950">Xã / Phường:</span>
                <select
                  value={quickAssignCommuneId}
                  onChange={e => {
                    const cId = e.target.value;
                    setQuickAssignCommuneId(cId);
                  }}
                  className="bg-white border border-sky-400 rounded px-2.5 py-1.5 font-bold text-slate-900 shadow-2xs focus:outline-sky-500"
                  title="Chọn xã để chỉ hiển thị các địa bàn thuộc xã đó"
                >
                  <option value="ALL">-- Tất cả các xã ({quickAssignFilteredCommunes.length}) --</option>
                  {quickAssignFilteredCommunes.map(c => (
                    <option key={c.id} value={c.id}>
                      [{c.communeCode}] {c.communeName}
                    </option>
                  ))}
                </select>
              </div>

              {/* 4. Địa bàn xã có tích chọn theo địa bàn hoặc chọn tất cả các địa bàn */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsAreaDropdownOpen(!isAreaDropdownOpen)}
                  className={`px-3 py-1.5 rounded border flex items-center gap-2 font-bold transition-all cursor-pointer shadow-2xs ${
                    quickAssignSelectedAreaIds.length > 0 
                      ? 'bg-sky-50 border-sky-400 text-sky-950 ring-1 ring-sky-300' 
                      : 'bg-white border-slate-300 text-slate-700 hover:border-slate-400'
                  }`}
                  title="Bấm để chọn từng địa bàn hoặc tất cả các địa bàn"
                >
                  <MapPin className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                  <span>
                    {quickAssignSelectedAreaIds.length === 0 
                      ? `Chọn địa bàn (${quickAssignAvailableAreas.length})` 
                      : quickAssignSelectedAreaIds.length === quickAssignAvailableAreas.length 
                      ? `Tất cả (${quickAssignAvailableAreas.length} địa bàn)` 
                      : `Đã chọn: ${quickAssignSelectedAreaIds.length} địa bàn`}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {/* Dropdown panel with checkboxes */}
                {isAreaDropdownOpen && (
                  <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1.5 w-80 md:w-96 bg-white border border-slate-300 rounded-lg shadow-xl z-50 p-3 text-xs flex flex-col gap-2.5 animate-in fade-in duration-100">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <label className="flex items-center gap-2 font-black text-sky-950 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={quickAssignAvailableAreas.length > 0 && quickAssignAvailableAreas.every(a => quickAssignSelectedAreaIds.includes(a.id))}
                          onChange={handleToggleSelectAllQuickAreas}
                          className="rounded text-sky-700 w-4 h-4 cursor-pointer"
                        />
                        <span>Chọn tất cả các địa bàn hiển thị ({quickAssignAvailableAreas.length})</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsAreaDropdownOpen(false)}
                        className="text-slate-400 hover:text-slate-600 p-1 rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="max-h-60 overflow-y-auto flex flex-col gap-1 pr-1">
                      {quickAssignAvailableAreas.map(a => {
                        const isChecked = quickSelectedSet.has(a.id);
                        const commObj = allowedSupervisorCommunes.find(c => c.id === a.communeId || c.communeCode === (a as any).communeCode);
                        return (
                          <label
                            key={a.id}
                            className={`flex items-start gap-2 p-1.5 rounded cursor-pointer transition-colors border ${
                              isChecked ? 'bg-sky-50 border-sky-300 font-bold text-sky-950' : 'border-slate-100 hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleQuickArea(a.id)}
                              className="rounded text-sky-700 mt-0.5 cursor-pointer"
                            />
                            <div className="flex flex-col min-w-0">
                              <span className="font-bold text-slate-900 truncate">
                                {getAreaDisplayName(a.id, a.communeId)}
                              </span>
                              <span className="text-[10px] text-slate-500 font-normal">
                                ĐB {a.code} {commObj ? `• ${commObj.communeName}` : ''}
                                {(() => {
                                  const o = idx.ownersByArea.get(a.id);
                                  if (!o || o.size === 0 || (o.size === 1 && o.has(assignSurveyorId))) return null;
                                  const n = Array.from(o).map(id => surveyors.find(x => x.id === id)?.name || id).join(', ');
                                  return <span className="text-amber-700 font-bold"> • đang giao: {n} (gán sẽ chuyển sang người này)</span>;
                                })()}
                              </span>
                            </div>
                          </label>
                        );
                      })}
                      {quickAssignAvailableAreas.length === 0 && (
                        <div className="text-center py-4 text-slate-400 italic">
                          Không có địa bàn nào theo bộ lọc xã/TKCS đã chọn.
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-[11px]">
                      <span className="text-slate-600 font-medium">
                        Đã chọn: <strong className="text-sky-900">{quickAssignSelectedAreaIds.length}</strong> địa bàn
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setQuickAssignSelectedAreaIds([])}
                          className="text-rose-600 hover:underline font-bold"
                        >
                          Bỏ chọn tất cả
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsAreaDropdownOpen(false)}
                          className="px-2.5 py-1 bg-sky-800 text-white rounded font-bold hover:bg-sky-700"
                        >
                          Xong
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 5. Nút Áp dụng phân */}
              <button
                type="button"
                onClick={handleExecuteBatchAssign}
                disabled={isAssigning || !assignSurveyorId}
                className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded font-bold cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5 shrink-0"
                title="Gán các địa bàn đã chọn (hoặc toàn bộ địa bàn theo bộ lọc) cho Cán bộ / ĐTV này"
              >
                {isAssigning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>Áp dụng phân</span>
              </button>

              {/* Nút Xuất mẫu Excel */}
              <button
                type="button"
                onClick={handleExportTemplate}
                className="px-3 py-1.5 bg-white border border-emerald-600 text-emerald-800 hover:bg-emerald-50 rounded font-bold cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5 shrink-0"
                title="Tải danh sách địa bàn (STT, TKCS, xã, địa bàn, Tên Người nhập / ĐTV, Tổng số hộ). Điền tên ĐTV rồi tải lên"
              >
                <Download className="w-3.5 h-3.5 text-emerald-700" />
                <span>Tải file phân quyền</span>
              </button>
              <button
                type="button"
                onClick={handleExportFullTemplate}
                className="px-2 py-1.5 bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 rounded font-bold cursor-pointer transition-colors shrink-0"
                title="Mẫu cũ đầy đủ cột (mã cán bộ, tên đăng nhập, phòng ban...)"
              >
                <span>Mẫu đầy đủ</span>
              </button>

              {/* Nút Tải lên Excel phân quyền */}
              <label
                className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-white rounded font-bold cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5 shrink-0"
                title="Chọn file Excel phân quyền đã điền để tải lên hệ thống"
              >
                <Upload className="w-3.5 h-3.5 text-white" />
                <span>Tải lên Excel</span>
                <input
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={handleImportExcelFile}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Main Table Card */}
          <div className="bg-white rounded-lg border border-slate-300 shadow-xs flex flex-col">
            {/* Table Filters & View Mode Header */}
            <div className="p-3 border-b border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                <div className="relative w-full md:w-52">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Tìm theo tên, mã ĐTV, địa bàn..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded focus:border-sky-500 focus:outline-hidden"
                  />
                </div>

                {/* Lọc TKCS trên lưới */}
                <select
                  value={gridTkcsFilter}
                  onChange={e => { setGridTkcsFilter(e.target.value); setGridCommuneFilter('ALL'); }}
                  className="border border-slate-300 rounded px-2.5 py-1.5 font-medium bg-white"
                  title="Lọc bảng theo TKCS"
                >
                  <option value="ALL">Tất cả TKCS ({uniqueTkcsList.length})</option>
                  {uniqueTkcsList.map(t => (
                    <option key={t.code} value={t.code}>[{t.code}] {t.label.split(' - ')[1] || t.label}</option>
                  ))}
                </select>

                {/* Lọc Xã trên lưới */}
                <select
                  value={gridCommuneFilter}
                  onChange={e => setGridCommuneFilter(e.target.value)}
                  className="border border-slate-300 rounded px-2.5 py-1.5 font-medium bg-white"
                  title="Lọc bảng theo Xã"
                >
                  <option value="ALL">Tất cả Xã / Phường ({gridCommunes.length})</option>
                  {gridCommunes.map(c => (
                    <option key={c.communeCode} value={c.communeCode}>[{c.communeCode}] {c.communeName}</option>
                  ))}
                </select>

                {/* Lọc Phòng ban */}
                {currentUser.role === 'SUPERVISOR' ? (
                  <div className="px-2.5 py-1.5 bg-sky-50 text-sky-900 border border-sky-300 rounded font-bold text-xs flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                    <span>Phòng: <strong>{currentUser.department}</strong></span>
                  </div>
                ) : (
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
                )}

                {/* Lọc Vai trò */}
                <select
                  value={roleFilter}
                  onChange={e => setRoleFilter(e.target.value)}
                  className="border border-slate-300 rounded px-2.5 py-1.5 font-medium bg-white"
                >
                  <option value="ALL">Tất cả vai trò</option>
                  <option value="SURVEYOR">Điều tra viên</option>
                  <option value="SUPERVISOR">Giám sát viên</option>
                  <option value="ADMIN">Quản trị viên</option>
                </select>
              </div>

              {/* View mode toggle & row count */}
              <div className="flex items-center gap-3">
                <div className="inline-flex rounded border border-slate-300 bg-slate-100 p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode('grid_areas')}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                      viewMode === 'grid_areas' 
                        ? 'bg-sky-800 text-white shadow-2xs' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Mỗi địa bàn phân công là 1 dòng độc lập"
                  >
                    <Table className="w-3.5 h-3.5" />
                    <span>Lưới theo địa bàn</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('summary_accounts')}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                      viewMode === 'summary_accounts' 
                        ? 'bg-sky-800 text-white shadow-2xs' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Mỗi tài khoản cán bộ là 1 dòng"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Theo tài khoản</span>
                  </button>
                </div>

                <span className="text-slate-500 text-xs hidden sm:inline">
                  {viewMode === 'grid_areas' ? (
                    <>Hiển thị <strong>{filteredGridRows.length}</strong> dòng địa bàn</>
                  ) : (
                    <>Hiển thị <strong>{filteredSurveyors.length}</strong> tài khoản</>
                  )}
                </span>
              </div>
            </div>

            {/* VIEW MODE 1: LƯỚI PHÂN CÔNG CHI TIẾT (MỖI ĐỊA BÀN LÀ 1 DÒNG) */}
            {viewMode === 'grid_areas' ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#058da0] text-white text-center font-bold">
                      <th className="border border-[#047484] p-2.5 w-12 text-center">STT</th>
                      <th className="border border-[#047484] p-2.5 text-left min-w-[140px]">Tên TKCS</th>
                      <th className="border border-[#047484] p-2.5 text-left min-w-[130px]">Tên xã</th>
                      <th className="border border-[#047484] p-2.5 text-center w-20">Mã xã</th>
                      <th className="border border-[#047484] p-2.5 text-center w-28">Tên đăng nhập</th>
                      <th className="border border-[#047484] p-2.5 text-left min-w-[150px]">Họ và tên</th>
                      <th className="border border-[#047484] p-2.5 text-left min-w-[150px]">Phòng ban phụ trách</th>
                      <th className="border border-[#047484] p-2.5 text-center w-32">Vai trò hệ thống</th>
                      <th className="border border-[#047484] p-2.5 text-left min-w-[200px]">Địa bàn phân công</th>
                      <th className="border border-[#047484] p-2.5 text-center w-28">Tiến độ hộ</th>
                      <th className="border border-[#047484] p-2.5 text-center w-28">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGridRows.map((row, idx) => {
                      const isCurrentActive = currentUser?.id === row.surveyor.id;
                      const roleColorClass = 
                        row.role === 'ADMIN' ? 'text-rose-700 font-bold' :
                        row.role === 'SUPERVISOR' ? 'text-amber-700 font-bold' :
                        'text-sky-700 font-medium';

                      return (
                        <tr
                          key={row.rowKey}
                          className={`hover:bg-sky-50/70 transition-colors border-b border-slate-200 ${
                            isCurrentActive ? 'bg-sky-50/60 font-medium' : 'odd:bg-white even:bg-slate-50/40'
                          }`}
                        >
                          {/* 1. STT */}
                          <td className="border-r border-slate-200 p-2.5 text-center text-slate-500 font-semibold">{idx + 1}</td>

                          {/* 2. Tên TKCS */}
                          <td className="border-r border-slate-200 p-2.5 text-slate-700 text-left">
                            {row.tkcsName}
                          </td>

                          {/* 3. Tên xã */}
                          <td className="border-r border-slate-200 p-2.5 text-slate-900 font-medium text-left">
                            {row.communeName}
                          </td>

                          {/* 4. Mã xã */}
                          <td className="border-r border-slate-200 p-2.5 text-center font-mono text-slate-600">
                            {row.communeCode}
                          </td>

                          {/* 5. Tên đăng nhập */}
                          <td className="border-r border-slate-200 p-2.5 text-center font-mono font-bold text-sky-950">
                            {row.username}
                          </td>

                          {/* 6. Họ và tên */}
                          <td className="border-r border-slate-200 p-2.5 text-slate-900 font-bold text-left">
                            <div className="flex items-center gap-1.5">
                              <span>{row.fullName}</span>
                              {isCurrentActive && (
                                <span className="text-[10px] text-sky-700 font-black">
                                  (Đang đăng nhập)
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 7. Phòng ban phụ trách */}
                          <td className="border-r border-slate-200 p-2.5 text-slate-700 text-left">
                            {row.departmentName}
                          </td>

                          {/* 8. Vai trò hệ thống */}
                          <td className={`border-r border-slate-200 p-2.5 text-center ${roleColorClass}`}>
                            {row.roleLabel}
                          </td>

                          {/* 9. Địa bàn phân công - Mỗi địa bàn 1 dòng rõ ràng */}
                          <td className="border-r border-slate-200 p-2.5 text-left">
                            {row.isAssignedArea ? (
                              <span className="font-bold text-slate-900">
                                {row.areaDisplayName}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">
                                Chưa phân công địa bàn
                              </span>
                            )}
                          </td>

                          {/* 10. Tiến độ hộ */}
                          <td className="border-r border-slate-200 p-2.5 text-center text-slate-700">
                            {row.totalHh > 0 ? (
                              <span className={row.completedHh === row.totalHh ? 'text-emerald-700 font-bold' : 'font-medium'}>
                                {row.completedHh}/{row.totalHh} hộ
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>

                          {/* 11. Thao tác */}
                          <td className="p-2.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {row.isAssignedArea && row.areaId && onUnassignArea && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (confirm(`Hủy phân công địa bàn "${row.areaDisplayName}" khỏi cán bộ ${row.fullName}?`)) {
                                      await onUnassignArea(row.surveyor.id, row.areaId!);
                                      showNotification('success', `Đã hủy phân công địa bàn cho ${row.fullName}`);
                                    }
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                                  title="Hủy phân công địa bàn này"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditModal(row.surveyor)}
                                className="p-1.5 text-slate-400 hover:text-sky-700 hover:bg-sky-50 rounded transition-colors"
                                title="Chỉnh sửa tài khoản & Phân quyền"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSurveyorToResetPassword(row.surveyor);
                                  setNewResetPassword('123456');
                                  setResetMustChange(true);
                                }}
                                className="p-1.5 text-slate-400 hover:text-amber-700 hover:bg-amber-50 rounded transition-colors"
                                title="Đổi mật khẩu tài khoản"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredGridRows.length === 0 && (
                      <tr>
                        <td colSpan={11} className="p-8 text-center text-slate-400 italic">
                          Không tìm thấy dòng phân công nào phù hợp với bộ lọc hiện tại.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              /* VIEW MODE 2: DANH SÁCH TÀI KHOẢN TỔNG HỢP */
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#058da0] text-white text-center font-bold">
                      <th className="border border-[#047484] p-2.5 w-12">STT</th>
                      <th className="border border-[#047484] p-2.5 w-24">Tên đăng nhập</th>
                      <th className="border border-[#047484] p-2.5 text-left min-w-[160px]">Họ và tên cán bộ</th>
                      <th className="border border-[#047484] p-2.5 text-left w-44">Phòng ban</th>
                      <th className="border border-[#047484] p-2.5 text-center w-36">Vai trò hệ thống</th>
                      <th className="border border-[#047484] p-2.5 text-left min-w-[200px]">Địa bàn / Xã phụ trách</th>
                      <th className="border border-[#047484] p-2.5 text-center w-36">Tiến độ nhập</th>
                      <th className="border border-[#047484] p-2.5 text-center w-32">Bảo mật</th>
                      <th className="border border-[#047484] p-2.5 text-center w-36">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSurveyors.map((s, rowNo) => {
                      const roleConfig = ROLE_LABELS[s.role] || ROLE_LABELS.SURVEYOR;
                      const matchedDept = departments.find(d => d.id === s.departmentId || d.name === s.department);
                      const hhStat = idx.statsBySurveyor.get(s.id) || { total: 0, done: 0 };
                      const assignedHh = { length: hhStat.total };
                      const completedHh = hhStat.done;
                      const isCurrentActive = currentUser?.id === s.id;

                      return (
                        <tr key={s.id} className={`hover:bg-sky-50/80 transition-colors ${isCurrentActive ? 'bg-sky-50 font-medium' : 'odd:bg-slate-50/40'}`}>
                          <td className="border border-slate-300 p-2.5 text-center text-slate-600 font-bold">{rowNo + 1}</td>
                          <td className="border border-slate-300 p-2.5 text-center font-black text-sky-900 bg-sky-50/50 font-mono">
                            {s.code}
                          </td>
                          <td className="border border-slate-300 p-2.5 text-slate-900 font-bold">
                            <div className="flex items-center gap-1.5">
                              <span>{s.name}</span>
                              {isCurrentActive && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-sky-700 text-white">
                                  Đang đăng nhập
                                </span>
                              )}
                            </div>
                            {s.phone && <span className="text-[10px] text-slate-500 block font-normal">SĐT: {s.phone}</span>}
                          </td>
                          <td className="border border-slate-300 p-2.5 text-slate-700">
                            {matchedDept ? `${matchedDept.code} - ${matchedDept.name}` : 'Chưa chọn'}
                          </td>
                          <td className="border border-slate-300 p-2.5 text-center">
                            <span className={s.role === 'ADMIN' ? 'text-rose-700 font-bold' : s.role === 'SUPERVISOR' ? 'text-amber-700 font-bold' : 'text-sky-700 font-medium'}>
                              {roleConfig.label}
                            </span>
                          </td>
                          <td className="border border-slate-300 p-2.5">
                            {s.role === 'SUPERVISOR' ? (
                              <span>Giám sát: {s.assignedCommunes?.includes('ALL') || !s.assignedCommunes ? `Tất cả các xã (${communes.length})` : `${s.assignedCommunes.length} xã`}</span>
                            ) : s.role === 'ADMIN' ? (
                              <span className="text-purple-700 font-bold">Toàn quyền hệ thống</span>
                            ) : s.assignedAreas.includes('ALL') ? (
                              <span className="text-sky-800 font-bold">Toàn bộ địa bàn trong xã</span>
                            ) : s.assignedAreas.length > 0 ? (
                              <span>Được phân công: <strong className="text-sky-900">{s.assignedAreas.filter(a => a !== '001').length}</strong> địa bàn</span>
                            ) : (
                              <span className="text-slate-400 italic">Chưa phân công địa bàn</span>
                            )}
                          </td>
                          <td className="border border-slate-300 p-2.5 text-center">
                            <span className="font-bold text-slate-800">{completedHh} / {assignedHh.length} hộ</span>
                          </td>
                          <td className="border border-slate-300 p-2.5 text-center">
                            {s.mustChangePassword ? (
                              <span className="text-amber-700 font-semibold">Cần đổi MK</span>
                            ) : (
                              <span className="text-emerald-700 font-semibold">Đã bảo mật</span>
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
                                className="px-2 py-1 text-amber-800 bg-amber-50 hover:bg-amber-100 rounded border border-amber-300 font-bold text-[11px] flex items-center gap-1"
                                title="Reset mật khẩu"
                              >
                                <KeyRound className="w-3 h-3" />
                                <span>Reset MK</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(s)}
                                className="p-1.5 text-sky-700 hover:text-sky-900 bg-sky-50 rounded border border-sky-200"
                                title="Sửa thông tin"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {currentUser.role === 'ADMIN' && (
                                <button
                                  type="button"
                                  onClick={() => setSurveyorToDelete(s)}
                                  className="p-1.5 text-rose-600 hover:text-rose-800 bg-rose-50 rounded border border-rose-200"
                                  title="Xóa tài khoản"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 3: BẢNG PHÂN QUYỀN & VAI TRÒ HỆ THỐNG */}
      {subTab === 'permissions' && (
        <div className="flex flex-col gap-4">
          {/* Header Banner */}
          <div className="bg-linear-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg p-4 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-purple-700 text-white rounded-lg shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-purple-950 text-sm">
                  Ma Trận Phân Quyền & Vai Trò Hệ Thống (RBAC)
                </h3>
                <p className="text-slate-600 mt-1 leading-relaxed">
                  Thiết lập vai trò, phân định ranh giới phụ trách và kiểm soát quyền truy cập dữ liệu giữa Quản trị viên, Giám sát viên và Điều tra viên theo đúng chuẩn quy trình thống kê.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => openAddModal()}
                className="px-3.5 py-2 bg-purple-800 hover:bg-purple-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                <span>+ Cấp Tài Khoản Mới</span>
              </button>
            </div>
          </div>

          {/* Ma trận phân quyền */}
          <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden">
            <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wide flex items-center gap-2">
                <Shield className="w-4 h-4 text-purple-700" />
                <span>1. Ma trận quyền hạn chi tiết theo 3 vai trò</span>
              </h4>
              <span className="text-[11px] text-slate-500 font-medium">Bảo mật cấp độ tài khoản & địa bàn</span>
            </div>

            <div className="overflow-x-auto text-xs">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-800 border-b border-slate-300 font-bold">
                    <th className="p-3 text-left w-64 border-r border-slate-200">Chức năng & Tác vụ</th>
                    <th className="p-3 text-center border-r border-slate-200 bg-rose-50/50 text-rose-900 w-64">
                      <div className="font-black text-xs">QUẢN TRỊ VIÊN (ADMIN)</div>
                      <div className="text-[10px] text-rose-700 font-normal">Toàn quyền cấp huyện</div>
                    </th>
                    <th className="p-3 text-center border-r border-slate-200 bg-amber-50/50 text-amber-900 w-64">
                      <div className="font-black text-xs">GIÁM SÁT VIÊN (SUPERVISOR)</div>
                      <div className="text-[10px] text-amber-700 font-normal">Quản lý theo phòng & xã phụ trách</div>
                    </th>
                    <th className="p-3 text-center bg-sky-50/50 text-sky-900 w-64">
                      <div className="font-black text-xs">ĐIỀU TRA VIÊN (SURVEYOR)</div>
                      <div className="text-[10px] text-sky-700 font-normal">Chỉ trong phạm vi địa bàn được giao</div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  <tr>
                    <td className="p-2.5 font-bold text-slate-800 border-r border-slate-200">Phạm vi xem dữ liệu hộ & xã</td>
                    <td className="p-2.5 text-center border-r border-slate-200 text-slate-700 font-medium">Toàn bộ 100% các xã, địa bàn và hộ</td>
                    <td className="p-2.5 text-center border-r border-slate-200 text-slate-700 font-medium">Chỉ xem các xã được phân công phụ trách</td>
                    <td className="p-2.5 text-center text-slate-700 font-medium">Chỉ xem hộ thuộc đúng các địa bàn được giao</td>
                  </tr>
                   <tr className="bg-slate-50/40">
                     <td className="p-2.5 font-bold text-slate-800 border-r border-slate-200">Thu thập & Nhập tin phiếu điều tra</td>
                     <td className="p-2.5 text-center border-r border-slate-200 text-emerald-700 font-bold">✓ Toàn quyền nhập & sửa mọi phiếu</td>
                     <td className="p-2.5 text-center border-r border-slate-200 text-amber-800 font-bold">✕ Không trực tiếp nhập tin (Chỉ giám sát & quản lý)</td>
                     <td className="p-2.5 text-center text-emerald-700 font-bold">✓ Nhập phiếu cho các địa bàn của mình</td>
                   </tr>
                  <tr>
                    <td className="p-2.5 font-bold text-slate-800 border-r border-slate-200">Kiểm tra, phúc tra & Duyệt số liệu</td>
                    <td className="p-2.5 text-center border-r border-slate-200 text-emerald-700 font-bold">✓ Duyệt & Chốt số liệu toàn huyện</td>
                    <td className="p-2.5 text-center border-r border-slate-200 text-emerald-700 font-bold">✓ Kiểm tra & Duyệt phiếu ĐTV thuộc phòng</td>
                    <td className="p-2.5 text-center text-rose-600 font-medium">✕ Không có quyền duyệt</td>
                  </tr>
                  <tr className="bg-slate-50/40">
                    <td className="p-2.5 font-bold text-slate-800 border-r border-slate-200">Phân công địa bàn cho ĐTV</td>
                    <td className="p-2.5 text-center border-r border-slate-200 text-emerald-700 font-bold">✓ Toàn quyền phân công tất cả các xã</td>
                    <td className="p-2.5 text-center border-r border-slate-200 text-emerald-700 font-bold">✓ Phân công cho ĐTV thuộc phòng phụ trách</td>
                    <td className="p-2.5 text-center text-rose-600 font-medium">✕ Không có quyền phân công</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-bold text-slate-800 border-r border-slate-200">Cấp tài khoản & Reset mật khẩu</td>
                    <td className="p-2.5 text-center border-r border-slate-200 text-emerald-700 font-bold">✓ Cấp mới, đổi quyền & reset mọi tài khoản</td>
                    <td className="p-2.5 text-center border-r border-slate-200 text-emerald-700 font-bold">✓ Cấp tài khoản ĐTV thuộc phòng mình</td>
                    <td className="p-2.5 text-center text-slate-700 font-medium">Chỉ tự đổi mật khẩu cá nhân</td>
                  </tr>
                  <tr className="bg-slate-50/40">
                    <td className="p-2.5 font-bold text-slate-800 border-r border-slate-200">Nhập bảng kê Excel / Sao lưu Cloud</td>
                    <td className="p-2.5 text-center border-r border-slate-200 text-emerald-700 font-bold">✓ Toàn quyền import, export & đồng bộ</td>
                    <td className="p-2.5 text-center border-r border-slate-200 text-rose-600 font-medium">✕ Không có quyền nạp bảng kê</td>
                    <td className="p-2.5 text-center text-rose-600 font-medium">✕ Không có quyền nạp bảng kê</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Bảng danh sách phân quyền cán bộ */}
          <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden flex flex-col">
            <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wide flex items-center gap-2">
                <Users className="w-4 h-4 text-sky-700" />
                <span>2. Danh sách cấu hình phân quyền hiện tại ({surveyors.length} tài khoản)</span>
              </h4>
              <span className="text-[11px] text-slate-500 font-medium">Bấm vào biểu tượng sửa để thay đổi vai trò hoặc phạm vi địa bàn</span>
            </div>

            <div className="overflow-x-auto text-xs">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#058da0] text-white text-center font-bold">
                    <th className="border border-[#047484] p-2.5 w-12 text-center">STT</th>
                    <th className="border border-[#047484] p-2.5 text-center w-24">Mã cán bộ</th>
                    <th className="border border-[#047484] p-2.5 text-left min-w-[160px]">Họ và tên</th>
                    <th className="border border-[#047484] p-2.5 text-left w-48">Phòng ban</th>
                    <th className="border border-[#047484] p-2.5 text-center w-36">Vai trò hệ thống</th>
                    <th className="border border-[#047484] p-2.5 text-left min-w-[240px]">Phạm vi phân quyền</th>
                    <th className="border border-[#047484] p-2.5 text-center w-32">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {surveyors.map((s, idx) => {
                    const roleConfig = ROLE_LABELS[s.role] || ROLE_LABELS.SURVEYOR;
                    const matchedDept = departments.find(d => d.id === s.departmentId || d.name === s.department);
                    return (
                      <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-2.5 text-center font-semibold text-slate-500 border-r border-slate-200">{idx + 1}</td>
                        <td className="p-2.5 text-center font-mono font-bold text-sky-950 border-r border-slate-200">{s.code}</td>
                        <td className="p-2.5 text-left font-bold text-slate-900 border-r border-slate-200">
                          {s.name}
                          {s.position && <span className="text-[10px] text-slate-500 block font-normal">{s.position}</span>}
                        </td>
                        <td className="p-2.5 text-left text-slate-700 border-r border-slate-200">
                          {matchedDept ? `${matchedDept.code} - ${matchedDept.name}` : (s.department || '---')}
                        </td>
                        <td className="p-2.5 text-center border-r border-slate-200">
                          <span className={s.role === 'ADMIN' ? 'text-rose-700 font-bold' : s.role === 'SUPERVISOR' ? 'text-amber-700 font-bold' : 'text-sky-700 font-medium'}>
                            {roleConfig.label}
                          </span>
                        </td>
                        <td className="p-2.5 text-left border-r border-slate-200">
                          {s.role === 'ADMIN' ? (
                            <span className="text-purple-700 font-semibold">Toàn bộ tất cả các xã và địa bàn</span>
                          ) : s.role === 'SUPERVISOR' ? (
                            <span>Giám sát: {s.assignedCommunes?.includes('ALL') || !s.assignedCommunes || s.assignedCommunes.length === 0 ? `Toàn bộ ${communes.length} xã` : `${s.assignedCommunes.length} xã phụ trách`}</span>
                          ) : s.assignedAreas.includes('ALL') ? (
                            <span className="text-sky-800 font-semibold">Toàn bộ địa bàn trong xã</span>
                          ) : s.assignedAreas.length > 0 ? (
                            <span>Phụ trách: <strong>{s.assignedAreas.filter(a => a !== '001').length}</strong> địa bàn được phân công</span>
                          ) : (
                            <span className="text-slate-400 italic">Chưa phân công địa bàn</span>
                          )}
                        </td>
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => openEditModal(s)}
                            className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded border border-sky-300 font-bold text-xs flex items-center gap-1 mx-auto transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Cấu hình quyền</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
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
                    disabled={currentUser.role === 'SUPERVISOR'}
                    className="w-full border border-slate-300 rounded p-2 font-bold text-slate-900 bg-slate-50 disabled:opacity-85"
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
                {currentUser.role === 'SUPERVISOR' ? (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 leading-tight">
                    ✓ Vai trò: <span className="text-sky-800 font-extrabold">{ROLE_LABELS['SURVEYOR'].label}</span>
                    <p className="font-normal text-[11px] text-slate-500 mt-1 leading-normal">
                      Cán bộ Giám sát viên chỉ được quyền cấp tài khoản Điều tra viên thuộc phòng ban phụ trách.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {(['SURVEYOR', 'ADMIN', 'SUPERVISOR'] as UserRole[]).map(role => {
                      const r = ROLE_LABELS[role as UserRole] ?? { label: 'Không xác định' };
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
                )}
              </div>

              {/* Area & Commune assignment based on Role */}
              {formRole === 'SUPERVISOR' && (
                <div className="border border-amber-300 rounded-lg p-3.5 bg-amber-50/70 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-amber-700" />
                      <label className="font-bold text-amber-950 text-xs">
                        Phân quyền Giám sát viên theo Phòng ban & Xã phụ trách
                      </label>
                    </div>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-amber-900">
                      <input
                        type="checkbox"
                        checked={formAllCommunes}
                        onChange={e => setFormAllCommunes(e.target.checked)}
                        className="rounded text-amber-700 w-4 h-4"
                      />
                      <span>Giám sát tất cả các xã</span>
                    </label>
                  </div>

                  <p className="text-[11px] text-amber-800 leading-tight">
                    Giám sát viên thuộc phòng <strong>{departments.find(d => d.id === formDeptId)?.name || 'đã chọn'}</strong> chỉ được phép xem các báo cáo và số liệu tổng hợp thuộc các xã mình được phân công phụ trách.
                  </p>

                  {!formAllCommunes ? (
                    <div className="flex flex-col gap-2 bg-white p-2.5 rounded border border-amber-200">
                      <div className="flex items-center justify-between gap-2">
                        <div className="relative flex-1">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                          <input
                            type="text"
                            placeholder="Tìm kiếm xã để phân công..."
                            value={supervisorCommuneSearch}
                            onChange={e => setSupervisorCommuneSearch(e.target.value)}
                            className="w-full pl-7 pr-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:border-amber-500"
                          />
                        </div>
                        <div className="flex items-center gap-2 text-xs shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setFormAssignedCommunes(communes.map(c => c.id));
                            }}
                            className="text-[11px] text-amber-800 hover:underline font-bold"
                          >
                            Chọn tất cả ({communes.length})
                          </button>
                          <span className="text-slate-300">|</span>
                          <button
                            type="button"
                            onClick={() => setFormAssignedCommunes([])}
                            className="text-[11px] text-rose-700 hover:underline font-bold"
                          >
                            Bỏ chọn tất cả
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-44 overflow-y-auto p-1 border border-slate-200 rounded">
                        {communes
                          .filter(c => {
                            if (!supervisorCommuneSearch.trim()) return true;
                            const q = supervisorCommuneSearch.toLowerCase().trim();
                            return c.communeName.toLowerCase().includes(q) || c.communeCode.includes(q);
                          })
                          .map(c => {
                            const isChecked = formAssignedCommunes.includes(c.id) || formAssignedCommunes.includes(c.communeCode);
                            return (
                              <label
                                key={c.id}
                                className={`flex items-center gap-2 p-1.5 rounded cursor-pointer text-[11px] border transition-colors ${
                                  isChecked ? 'bg-amber-100/80 border-amber-400 font-bold text-amber-950' : 'border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    if (isChecked) {
                                      setFormAssignedCommunes(formAssignedCommunes.filter(id => id !== c.id && id !== c.communeCode));
                                    } else {
                                      setFormAssignedCommunes([...formAssignedCommunes, c.id]);
                                    }
                                  }}
                                  className="rounded text-amber-700"
                                />
                                <span>[{c.communeCode}] {c.communeName}</span>
                              </label>
                            );
                          })}
                      </div>
                      <div className="text-[11px] text-slate-500 font-medium">
                        Đã chọn: <strong className="text-amber-900 font-black">{formAssignedCommunes.length}</strong> / {communes.length} xã phụ trách
                      </div>
                    </div>
                  ) : (
                    <div className="p-2 bg-amber-100 text-amber-900 rounded font-medium text-xs">
                      ✓ Giám sát viên này được quyền xem và kiểm tra toàn bộ {communes.length} xã.
                    </div>
                  )}
                </div>
              )}

              {formRole === 'SURVEYOR' && (
                <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50/60 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-slate-900 text-xs">
                      Phân công Địa bàn được phép nhập phiếu (Điều tra viên)
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

                  <p className="text-[11px] text-slate-600 leading-tight">
                    Điều tra viên chỉ được xem và nhập phiếu thuộc đúng các địa bàn được phân công ("tránh xem lung tung").
                  </p>

                  {!formAllAreas ? (
                    <div className="flex flex-col gap-2 bg-white p-2.5 rounded border border-slate-200">
                      {/* Bộ lọc theo TKCS và Xã trong modal */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-200">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1">
                            <span className="font-bold text-slate-700 text-[11px]">TKCS:</span>
                            <select
                              value={modalTkcsFilter}
                              onChange={e => {
                                const val = e.target.value;
                                setModalTkcsFilter(val);
                                const filteredComms = val === 'ALL' ? allowedSupervisorCommunes : allowedSupervisorCommunes.filter(c => (c.tkcsCode || 'TKCS-01') === val);
                                if (filteredComms.length > 0 && !filteredComms.some(c => c.id === modalAreaCommuneFilter)) {
                                  setModalAreaCommuneFilter(filteredComms[0].id);
                                }
                              }}
                              className="bg-white border border-slate-300 rounded px-2 py-0.5 text-xs font-bold text-slate-800 focus:outline-none"
                            >
                              <option value="ALL">Tất cả TKCS</option>
                              {uniqueTkcsList.map(t => (
                                <option key={t.code} value={t.code}>{t.label}</option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="font-bold text-slate-700 text-[11px]">Xã:</span>
                            <select
                              value={modalAreaCommuneFilter}
                              onChange={e => setModalAreaCommuneFilter(e.target.value)}
                              className="bg-white border border-slate-300 rounded px-2 py-0.5 text-xs font-bold text-slate-800 focus:outline-none"
                            >
                              {(modalTkcsFilter === 'ALL' ? allowedSupervisorCommunes : allowedSupervisorCommunes.filter(c => (c.tkcsCode || 'TKCS-01') === modalTkcsFilter)).map(c => (
                                <option key={c.id} value={c.id}>
                                  [{c.communeCode}] {c.communeName}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-xs shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              const filteredComms = modalTkcsFilter === 'ALL' ? allowedSupervisorCommunes : allowedSupervisorCommunes.filter(c => (c.tkcsCode || 'TKCS-01') === modalTkcsFilter);
                              const targetCommuneIds = modalAreaCommuneFilter === 'ALL' ? filteredComms.map(c => c.id) : [modalAreaCommuneFilter];
                              const commAreas = allowedSupervisorAreas
                                .filter(a => targetCommuneIds.includes(a.communeId) || targetCommuneIds.includes((a as any).communeCode))
                                .map(a => a.id);
                              const combined = Array.from(new Set([...formAssignedAreas, ...commAreas]));
                              setFormAssignedAreas(combined);
                            }}
                            className="text-[11px] text-sky-700 hover:underline font-bold"
                          >
                            Chọn tất cả ĐB
                          </button>
                          <span className="text-slate-300">|</span>
                          <button
                            type="button"
                            onClick={() => {
                              const filteredComms = modalTkcsFilter === 'ALL' ? allowedSupervisorCommunes : allowedSupervisorCommunes.filter(c => (c.tkcsCode || 'TKCS-01') === modalTkcsFilter);
                              const targetCommuneIds = modalAreaCommuneFilter === 'ALL' ? filteredComms.map(c => c.id) : [modalAreaCommuneFilter];
                              const commAreas = allowedSupervisorAreas
                                .filter(a => targetCommuneIds.includes(a.communeId) || targetCommuneIds.includes((a as any).communeCode))
                                .map(a => a.id);
                              setFormAssignedAreas(formAssignedAreas.filter(c => !commAreas.includes(c)));
                            }}
                            className="text-[11px] text-rose-700 hover:underline font-bold"
                          >
                            Bỏ chọn ĐB
                          </button>
                        </div>
                      </div>

                      {/* Danh sách địa bàn hiển thị theo bộ lọc TKCS và xã */}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto p-1 bg-white rounded">
                        {allowedSupervisorAreas
                          .filter(a => {
                            const commObj = allowedSupervisorCommunes.find(c => c.id === a.communeId || c.communeCode === (a as any).communeCode);
                            if (modalTkcsFilter !== 'ALL' && commObj && (commObj.tkcsCode || 'TKCS-01') !== modalTkcsFilter) {
                              return false;
                            }
                            if (modalAreaCommuneFilter === 'ALL') return true;
                            return a.communeId === modalAreaCommuneFilter || (a as any).communeCode === modalAreaCommuneFilter;
                          })
                          .map(area => {
                            const isChecked = formAssignedAreas.includes(area.id);
                            const commObj = allowedSupervisorCommunes.find(c => c.id === area.communeId || c.communeCode === (area as any).communeCode);
                            return (
                              <label
                                key={area.id}
                                className={`flex items-start gap-2 p-1.5 rounded cursor-pointer text-[11px] border transition-colors ${
                                  isChecked ? 'bg-sky-50 border-sky-300 font-bold text-sky-950 shadow-2xs' : 'border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleToggleAreaCheckbox(area.id)}
                                  className="rounded text-sky-700 mt-0.5 shrink-0"
                                />
                                <div className="flex flex-col min-w-0">
                                  <span className="font-bold text-slate-900 truncate">
                                    {getAreaDisplayName(area.id, area.communeId)}
                                  </span>
                                  <span className="text-[10px] text-slate-500 font-normal truncate">
                                    ĐB {area.code} {commObj ? `• ${commObj.communeName}` : ''}
                                  </span>
                                </div>
                              </label>
                            );
                          })}
                        {areas.filter(a => {
                          const commObj = communes.find(c => c.id === a.communeId || c.communeCode === (a as any).communeCode);
                          if (modalTkcsFilter !== 'ALL' && commObj && (commObj.tkcsCode || 'TKCS-01') !== modalTkcsFilter) {
                            return false;
                          }
                          if (modalAreaCommuneFilter === 'ALL') return true;
                          return a.communeId === modalAreaCommuneFilter || (a as any).communeCode === modalAreaCommuneFilter;
                        }).length === 0 && (
                          <div className="col-span-3 text-center py-3 text-slate-400 italic text-xs">
                            Không tìm thấy địa bàn nào phù hợp.
                          </div>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-medium">
                        Đang phân công: <strong className="text-sky-900 font-black">{formAssignedAreas.length}</strong> địa bàn
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-purple-50 text-purple-900 rounded border border-purple-200 text-xs">
                      ✓ Người này được phép xem và nhập phiếu của <strong>tất cả các địa bàn</strong> trong xã.
                    </div>
                  )}
                </div>
              )}

              {formRole === 'ADMIN' && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-purple-900 text-xs flex items-center gap-2">
                  <Shield className="w-4 h-4 text-purple-700 shrink-0" />
                  <span>Tài khoản <strong>Quản trị viên / Giám sát xã</strong> có toàn quyền truy cập, giám sát toàn bộ các xã, địa bàn và quản lý tài khoản trên hệ thống.</span>
                </div>
              )}

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
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-700 text-[11px]">Lọc theo Xã:</span>
                    <select
                      value={deptModalAreaCommuneFilter}
                      onChange={e => setDeptModalAreaCommuneFilter(e.target.value)}
                      className="bg-white border border-slate-300 rounded px-2 py-0.5 text-xs font-bold text-slate-800 focus:outline-none"
                    >
                      {communes.map(c => (
                        <option key={c.id} value={c.id}>
                          [{c.communeCode}] {c.communeName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2 text-xs shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const commAreas = areas
                          .filter(a => a.communeId === deptModalAreaCommuneFilter || (a as any).communeCode === deptModalAreaCommuneFilter)
                          .map(a => a.code);
                        const combined = Array.from(new Set([...deptFormAreas, ...commAreas]));
                        setDeptFormAreas(combined);
                      }}
                      className="text-[11px] text-sky-700 hover:underline font-bold"
                    >
                      Chọn tất cả ĐB xã này
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => {
                        const commAreas = areas
                          .filter(a => a.communeId === deptModalAreaCommuneFilter || (a as any).communeCode === deptModalAreaCommuneFilter)
                          .map(a => a.code);
                        setDeptFormAreas(deptFormAreas.filter(c => !commAreas.includes(c)));
                      }}
                      className="text-[11px] text-rose-700 hover:underline font-bold"
                    >
                      Bỏ chọn ĐB xã này
                    </button>
                  </div>
                </div>

                <label className="block font-bold text-slate-900 text-[11px]">
                  Danh sách địa bàn giao cho Phòng ban phụ trách ({deptFormAreas.length} địa bàn):
                </label>

                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto p-1 border border-slate-200 bg-white rounded">
                  {areas
                    .filter(a => a.communeId === deptModalAreaCommuneFilter || (a as any).communeCode === deptModalAreaCommuneFilter)
                    .map(area => {
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
                          <span>{getAreaDisplayName(area.id, area.communeId)} (ĐB {area.code})</span>
                        </label>
                      );
                    })}
                  {areas.filter(a => a.communeId === deptModalAreaCommuneFilter || (a as any).communeCode === deptModalAreaCommuneFilter).length === 0 && (
                    <div className="col-span-2 text-center py-4 text-slate-400 italic">
                      Xã này chưa có địa bàn nào được tải lên.
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
