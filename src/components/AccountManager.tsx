/**
 * AccountManager — Tài khoản & Phân quyền địa bàn (làm lại hoàn toàn).
 *
 *  1. Tài khoản : Họ và tên, Tên đăng nhập, Mật khẩu (hiện rõ), Phòng ban, Vai trò. Nhập hàng loạt từ Excel.
 *  2. Phân quyền: chọn 1 người ở bên trái -> tích các địa bàn bên phải -> Lưu. Mỗi địa bàn chỉ một người.
 *  3. Phòng ban : thêm / đổi tên / xóa.
 */
import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Users, MapPin, Building2, Plus, Pencil, Trash2, Download, Upload, Search, LogIn,
  Eye, EyeOff, Save, X, FileSpreadsheet,
} from 'lucide-react';
import { Surveyor, Department, UserRole, ROLE_LABELS } from '../types/user';
import { CommuneItem, Household, SurveyArea, buildAssignIndex, calcAreaIds, isGenericName } from '../utils/assignIndex';
import { exportSimpleAssignExcel, normText, parsePermissionExcelFile } from '../utils/permissionExcelHelper';
import { INITIAL_DEFAULT_PASSWORD } from '../constants/officialPersonnel';

interface Props {
  surveyors: Surveyor[];
  departments: Department[];
  areas: SurveyArea[];
  communes?: CommuneItem[];
  households: Household[];
  currentUser: Surveyor;
  onSaveSurveyor: (s: Surveyor) => Promise<void>;
  onDeleteSurveyor: (id: string) => Promise<void>;
  onSaveDepartment: (d: Department) => Promise<void>;
  onDeleteDepartment: (id: string) => Promise<void>;
  onBatchAssignArea: (surveyorId: string, areaIds: string | string[], communeIds?: string[], scopeAreaIds?: string[]) => Promise<void>;
  onBatchImportAssignments?: (a: { surveyorId: string; areaIds: string[]; communeIds: string[] }[]) => Promise<void>;
  onSelectActiveUser: (s: Surveyor) => void;
  showNotification: (type: 'success' | 'error', msg: string) => void;
}

const box = 'bg-white rounded border border-slate-300 shadow-sm';
const btn = 'px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'h-8 border border-slate-300 rounded px-2 text-xs bg-white focus:outline-none focus:border-sky-600';

const slug = (s: string) => normText(s).replace(/[^a-z0-9]/g, '');
const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

interface Form { id?: string; name: string; username: string; password: string; department: string; role: UserRole; phone: string; note: string; status: Surveyor['status'] }
const emptyForm = (dept = ''): Form => ({ name: '', username: '', password: INITIAL_DEFAULT_PASSWORD, department: dept, role: 'SURVEYOR', phone: '', note: '', status: 'ACTIVE' });

interface AreaRowData { a: SurveyArea; c?: CommuneItem; key: string; title: string; official: number; owners: string[] }

/** Một dòng địa bàn. React.memo: tích một ô chỉ vẽ lại đúng dòng đó chứ không vẽ lại cả 1.200 dòng. */
const AreaRow = React.memo(function AreaRow({ r, on, selName, onToggle }: { r: AreaRowData; on: boolean; selName: string; onToggle: (id: string) => void }) {
  const others = r.owners.filter(n => n !== selName);
  return (
    <tr onClick={() => onToggle(r.a.id)} className={`border-t border-slate-100 cursor-pointer ${on ? 'bg-teal-50/70' : 'hover:bg-slate-50'}`}>
      <td className="p-1.5 text-center"><input type="checkbox" checked={on} onChange={() => onToggle(r.a.id)} onClick={e => e.stopPropagation()} /></td>
      <td className="p-1.5 font-mono font-bold text-[#047484]">{r.key}</td>
      <td className="p-1.5">{r.c?.communeName || '—'}</td>
      <td className="p-1.5">{r.title}</td>
      <td className="p-1.5 text-right">{r.official}</td>
      <td className="p-1.5">{r.owners.length === 0 ? <span className="text-slate-400">chưa giao</span> : r.owners.includes(selName) && others.length === 0 ? <span className="text-teal-800 font-bold">{selName}</span> : <span className="text-amber-700 font-bold">{r.owners.join(', ')}{on && others.length > 0 ? ' → chuyển' : ''}</span>}</td>
    </tr>
  );
});

export default function AccountManager({
  surveyors, departments, areas, communes = [], households, currentUser,
  onSaveSurveyor, onDeleteSurveyor, onSaveDepartment, onDeleteDepartment,
  onBatchAssignArea, onBatchImportAssignments, onSelectActiveUser, showNotification,
}: Props) {
  const isAdmin = currentUser.role === 'ADMIN';
  const [tab, setTab] = useState<'accounts' | 'areas' | 'departments'>('areas');
  const [busy, setBusy] = useState(false);

  const idx = useMemo(() => buildAssignIndex(areas, communes, households), [areas, communes, households]);

  /* ---------- phạm vi nhìn thấy ---------- */
  const sameDept = (s: Surveyor) =>
    (!!currentUser.departmentId && s.departmentId === currentUser.departmentId) ||
    (!!currentUser.department && normText(s.department) === normText(currentUser.department)) || s.id === currentUser.id;
  const visibleSurveyors = useMemo(
    () => surveyors.filter(s => isAdmin || (s.role === 'SURVEYOR' && sameDept(s))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surveyors, currentUser, isAdmin]);
  /** Địa bàn người đăng nhập được QUẢN (khác "đang làm"): admin = tất cả; GSV = đúng các địa bàn được giao cho mình, kể cả khi đã giao tiếp cho ĐTV. */
  const poolAreas = useMemo(() => {
    const mine = currentUser.assignedAreas || [];
    const comm = currentUser.assignedCommunes || [];
    if (isAdmin || mine.includes('ALL') || comm.includes('ALL')) return areas;
    const ids = new Set<string>();
    mine.forEach(k => { const a = idx.areaById.get(k) || idx.areaByKey.get(k) || idx.areaByCode.get(k); if (a) ids.add(a.id); });
    if (ids.size === 0 && comm.length > 0) areas.forEach(a => { const c = idx.communeById.get(a.communeId); if (comm.includes(a.communeId) || (c && comm.includes(c.communeCode))) ids.add(a.id); });   // dữ liệu cũ: phân theo xã
    return areas.filter(a => ids.has(a.id));
  }, [isAdmin, currentUser, areas, idx]);

  const areaTitle = (a: SurveyArea) =>
    idx.sheetNameByArea.get(a.id) || (!isGenericName(a.name, a.code) ? a.name.trim() : idx.hhAreaNameByArea.get(a.id)) || `Địa bàn ${a.code}`;

  /* ====================================================================== TÀI KHOẢN */
  const [q, setQ] = useState('');
  const [roleF, setRoleF] = useState<'ALL' | UserRole>('ALL');
  const [deptF, setDeptF] = useState('ALL');
  const [showPw, setShowPw] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const xlsAccRef = useRef<HTMLInputElement>(null);

  const deptNames = useMemo(() => {
    const set = new Set<string>(departments.map(d => d.name));
    surveyors.forEach(s => s.department && set.add(s.department));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [departments, surveyors]);

  const filteredAccounts = useMemo(() => {
    const nq = normText(q);
    return visibleSurveyors.filter(s => {
      if (roleF !== 'ALL' && s.role !== roleF) return false;
      if (deptF !== 'ALL' && normText(s.department) !== normText(deptF)) return false;
      if (!nq) return true;
      return [s.name, s.username, s.code, s.department, s.phone].some(v => normText(v).includes(nq));
    });
  }, [visibleSurveyors, q, roleF, deptF]);

  const ensureDepartment = async (name: string): Promise<Department | undefined> => {
    const n = name.trim(); if (!n) return undefined;
    const found = departments.find(d => normText(d.name) === normText(n));
    if (found) return found;
    const d: Department = { id: `pb-${slug(n) || Date.now()}`, name: n, code: (slug(n) || 'PB').toUpperCase().slice(0, 12), createdAt: new Date().toISOString() };
    await onSaveDepartment(d);
    return d;
  };

  const usernameTaken = (u: string, exceptId?: string) =>
    surveyors.some(s => s.id !== exceptId && (normText(s.username) === normText(u) || normText(s.code) === normText(u)));

  const openAdd = () => setForm(emptyForm(isAdmin ? '' : currentUser.department || ''));
  const openEdit = (s: Surveyor) => setForm({
    id: s.id, name: s.name, username: s.username || s.code, password: s.password || (s.id === 'admin' ? 'admin' : INITIAL_DEFAULT_PASSWORD),
    department: s.department || '', role: s.role, phone: s.phone || '', note: s.note || '', status: s.status,
  });

  const saveForm = async () => {
    if (!form) return;
    const name = form.name.trim(), username = form.username.trim(), password = form.password.trim();
    if (!name) return showNotification('error', 'Chưa nhập Họ và tên.');
    if (!username) return showNotification('error', 'Chưa nhập Tên đăng nhập.');
    if (!password) return showNotification('error', 'Chưa nhập Mật khẩu.');
    if (usernameTaken(username, form.id)) return showNotification('error', `Tên đăng nhập "${username}" đã có người dùng.`);
    setBusy(true);
    try {
      const old = form.id ? surveyors.find(s => s.id === form.id) : undefined;
      const role = old?.id === 'admin' ? 'ADMIN' : (isAdmin ? form.role : 'SURVEYOR');
      const dept = await ensureDepartment(isAdmin ? form.department : (currentUser.department || form.department));
      const now = new Date().toISOString();
      let areasList = old?.assignedAreas || [];
      if (role === 'ADMIN' || role === 'MANAGER') areasList = ['ALL'];
      else if (areasList.includes('ALL')) areasList = [];
      const s: Surveyor = {
        stt: old?.stt ?? surveyors.length + 1,
        assignedCommunes: old?.assignedCommunes || [],
        createdAt: old?.createdAt || now,
        ...(old || {}),
        id: old?.id || `sv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        name, username, code: username, password,
        department: dept?.name || form.department.trim() || undefined,
        departmentId: dept?.id,
        role, phone: form.phone.trim() || undefined, note: form.note.trim() || undefined,
        status: form.status, assignedAreas: areasList,
        mustChangePassword: false, updatedAt: now,
        lastPasswordChange: old && old.password === password ? old.lastPasswordChange : now,
      };
      await onSaveSurveyor(s);
      showNotification('success', old ? `Đã cập nhật tài khoản ${name}.` : `Đã thêm tài khoản ${name}.`);
      setForm(null);
    } catch (e: any) { showNotification('error', `Lưu thất bại: ${e?.message || e}`); } finally { setBusy(false); }
  };

  const removeAccount = async (s: Surveyor) => {
    if (s.id === 'admin' || s.id === currentUser.id) return showNotification('error', 'Không xóa được tài khoản quản trị gốc hoặc chính tài khoản đang đăng nhập.');
    const own = idx.statsBySurveyor.get(s.id)?.total || 0;
    if (!window.confirm(`Xóa tài khoản "${s.name}"?${own ? `\n\nNgười này đang được giao ${own} hộ. Các hộ đó sẽ KHÔNG còn người phụ trách cho tới khi gán lại.` : ''}`)) return;
    setBusy(true);
    try {
      if (own) await onBatchAssignArea(s.id, [], [], areas.map(a => a.id));   // trả các địa bàn về "chưa giao"
      await onDeleteSurveyor(s.id);
      showNotification('success', `Đã xóa ${s.name}.`);
    } catch (e: any) { showNotification('error', `Xóa thất bại: ${e?.message || e}`); } finally { setBusy(false); }
  };

  const downloadAccountTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([['STT', 'Họ và tên', 'Tên đăng nhập', 'Mật khẩu', 'Phòng ban', 'Vai trò', 'Số điện thoại']]);
    ws['!cols'] = [{ wch: 6 }, { wch: 28 }, { wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 16 }];
    const guide = XLSX.utils.aoa_to_sheet([
      ['HƯỚNG DẪN'],
      ['Bắt buộc: Họ và tên. Tên đăng nhập để trống thì tự tạo từ họ tên (không dấu, viết liền). Mật khẩu để trống thì dùng mật khẩu mặc định ' + INITIAL_DEFAULT_PASSWORD + '.'],
      ['Vai trò: Điều tra viên (mặc định) | Giám sát viên | Quản lý | Quản trị viên.'],
      ['Tên đăng nhập đã có: cập nhật họ tên, mật khẩu, phòng ban, vai trò, SĐT (giữ nguyên địa bàn đã phân).'],
    ]);
    guide['!cols'] = [{ wch: 130 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'TaiKhoan'); XLSX.utils.book_append_sheet(wb, guide, 'HuongDan');
    XLSX.writeFile(wb, 'MauTaiKhoan.xlsx');
  };

  const importAccounts = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const pick = (r: Record<string, any>, keys: string[]) => {
        for (const k of Object.keys(r)) if (keys.includes(normText(k))) return String(r[k] ?? '').trim();
        return '';
      };
      const used = new Set(surveyors.flatMap(s => [normText(s.username), normText(s.code)]));
      const plan: { s: Surveyor; isNew: boolean }[] = []; let skipped = 0; const newDepts = new Set<string>();
      const batchUsers = new Map<string, number>();
      for (const r of rows) {
        const name = pick(r, ['ho va ten', 'ho ten', 'ten']); if (!name) { skipped++; continue; }
        let user = pick(r, ['ten dang nhap', 'tai khoan', 'ma']) || slug(name);
        const roleText = normText(pick(r, ['vai tro']));
        const role: UserRole = !isAdmin ? 'SURVEYOR' : /quan tri|admin/.test(roleText) ? 'ADMIN' : /quan ly/.test(roleText) ? 'MANAGER' : /giam sat/.test(roleText) ? 'SUPERVISOR' : 'SURVEYOR';
        const existing = surveyors.find(s => normText(s.username) === normText(user) || normText(s.code) === normText(user));
        if (!existing) {                                   // tên mới trùng thì thêm số
          let u = user, n = 1; while (used.has(normText(u)) || batchUsers.has(normText(u))) u = `${user}${++n}`;
          user = u; batchUsers.set(normText(user), 1);
        }
        if (existing && !isAdmin && !sameDept(existing)) { skipped++; continue; }
        const dept = pick(r, ['phong ban', 'don vi']);
        if (dept && !departments.some(d => normText(d.name) === normText(dept))) newDepts.add(dept);
        const pw = pick(r, ['mat khau']);
        const now = new Date().toISOString();
        const s: Surveyor = {
          assignedAreas: role === 'ADMIN' || role === 'MANAGER' ? ['ALL'] : [], assignedCommunes: [], createdAt: now, stt: surveyors.length + plan.length + 1,
          ...(existing || {}),
          id: existing?.id || `sv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name, username: existing?.username || user, code: existing?.code || user,
          password: pw || existing?.password || INITIAL_DEFAULT_PASSWORD,
          department: dept || existing?.department, role: existing ? (isAdmin ? role : existing.role) : role,
          phone: pick(r, ['so dien thoai', 'sdt', 'dien thoai']) || existing?.phone,
          status: existing?.status || 'ACTIVE', mustChangePassword: false, updatedAt: now,
        };
        plan.push({ s, isNew: !existing });
      }
      if (plan.length === 0) return showNotification('error', 'Không có dòng hợp lệ trong file (cần cột "Họ và tên").');
      const nNew = plan.filter(p => p.isNew).length;
      if (!window.confirm(`Thêm ${nNew} tài khoản mới, cập nhật ${plan.length - nNew} tài khoản.${newDepts.size ? `\nTạo thêm ${newDepts.size} phòng ban: ${Array.from(newDepts).join(', ')}.` : ''}${skipped ? `\nBỏ qua ${skipped} dòng (thiếu họ tên hoặc ngoài quyền).` : ''}\n\nÁp dụng?`)) return;
      for (const p of plan) {
        const d = await ensureDepartment(p.s.department || '');
        await onSaveSurveyor({ ...p.s, department: d?.name || p.s.department, departmentId: d?.id || p.s.departmentId });
      }
      showNotification('success', `Đã nhập ${plan.length} tài khoản (${nNew} mới).`);
    } catch (e: any) { showNotification('error', `Nhập file thất bại: ${e?.message || e}`); } finally { setBusy(false); if (xlsAccRef.current) xlsAccRef.current.value = ''; }
  };

  /* ====================================================================== PHÂN QUYỀN */
  const permRef = useRef<HTMLInputElement>(null);
  const [selId, setSelId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [base, setBase] = useState<Set<string>>(new Set());
  const [personQ, setPersonQ] = useState('');
  const [tkcsF, setTkcsF] = useState('ALL');
  const [communeF, setCommuneF] = useState('ALL');
  const [areaQ, setAreaQ] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);

  const assignable = useMemo(() => visibleSurveyors.filter(s => s.role === 'SURVEYOR' || s.role === 'SUPERVISOR'), [visibleSurveyors]);
  const people = useMemo(() => {
    const nq = normText(personQ);
    return assignable.filter(s => !nq || [s.name, s.username, s.department].some(v => normText(v).includes(nq)));
  }, [assignable, personQ]);
  const sel = surveyors.find(s => s.id === selId);

  const communeById = idx.communeById;
  const officialByArea = useMemo(() => {
    const m = new Map<string, number>();
    households.forEach(h => {
      const st = String(h.sampleStatus || '').toUpperCase();
      if (st && !st.includes('CHÍNH')) return;
      const a = idx.areaById.get(h.areaId) || idx.areaByKey.get(`${h.communeId}_${h.areaCode}`);
      if (a) m.set(a.id, (m.get(a.id) || 0) + 1);
    });
    return m;
  }, [households, idx]);

  /** địa bàn -> tên những người đang giữ (theo hộ; nếu hộ chưa ghi thì theo danh sách phân quyền cũ) */
  const ownersByArea = useMemo(() => {
    const byId = new Map(surveyors.map(s => [s.id, s] as const));
    const m = new Map<string, string[]>();
    idx.ownersByArea.forEach((set, aid) => m.set(aid, Array.from(set).map(id => byId.get(id)?.name || id)));
    surveyors.forEach(s => {
      if (s.role === 'ADMIN' || (s.assignedAreas || []).includes('ALL')) return;
      calcAreaIds(idx, s, poolAreas).forEach(aid => { if (!idx.ownersByArea.get(aid)?.size) m.set(aid, [...(m.get(aid) || []), s.name]); });
    });
    return m;
  }, [surveyors, idx, poolAreas]);

  const rows = useMemo(() => {
    const list: AreaRowData[] = poolAreas.map(a => {
      const c = communeById.get(a.communeId) || idx.communeByCode.get(a.communeCode || '');
      return { a, c, key: `${c?.communeCode || a.communeCode || ''}${a.code}`, title: areaTitle(a), official: officialByArea.get(a.id) || 0, owners: ownersByArea.get(a.id) || [] };
    });
    return list.sort((x, y) => x.key.localeCompare(y.key, undefined, { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolAreas, idx, officialByArea, ownersByArea]);

  const tkcsList = useMemo(() => Array.from(new Set(communes.map(c => c.tkcsCode || 'TKCS-01'))), [communes]);
  const communeList = useMemo(() => communes.filter(c => tkcsF === 'ALL' || (c.tkcsCode || 'TKCS-01') === tkcsF), [communes, tkcsF]);

  const filteredRows = useMemo(() => {
    const nq = normText(areaQ);
    return rows.filter(r => {
      if (tkcsF !== 'ALL' && (r.c?.tkcsCode || 'TKCS-01') !== tkcsF) return false;
      if (communeF !== 'ALL' && r.c?.id !== communeF) return false;
      if (onlyFree && r.owners.length > 0) return false;
      return !nq || normText(`${r.key} ${r.title} ${r.c?.communeName || ''}`).includes(nq);
    });
  }, [rows, tkcsF, communeF, onlyFree, areaQ]);

  const choose = (s: Surveyor) => {
    const init = new Set(calcAreaIds(idx, s, poolAreas));
    setSelId(s.id); setPicked(init); setBase(new Set(init));
  };
  const toggle = React.useCallback((id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const checkAllVisible = (on: boolean) => setPicked(p => { const n = new Set(p); filteredRows.forEach(r => on ? n.add(r.a.id) : n.delete(r.a.id)); return n; });

  const added = useMemo(() => Array.from(picked).filter(id => !base.has(id)), [picked, base]);
  const removed = useMemo(() => Array.from(base).filter(id => !picked.has(id)), [picked, base]);
  const moved = useMemo(() => added.filter(id => (ownersByArea.get(id) || []).some(n => n !== sel?.name)), [added, ownersByArea, sel]);

  const savePerm = async () => {
    if (!sel || (added.length === 0 && removed.length === 0)) return;
    if (moved.length > 0 && !window.confirm(`${moved.length} địa bàn đang thuộc người khác sẽ CHUYỂN sang "${sel.name}" (mỗi địa bàn chỉ một người). Tiếp tục?`)) return;
    setBusy(true);
    try {
      const scope = Array.from(new Set([...filteredRows.map(r => r.a.id), ...added, ...removed]));
      await onBatchAssignArea(sel.id, Array.from(picked), [], scope);
      setBase(new Set(picked));
      showNotification('success', `Đã lưu phân quyền cho ${sel.name}: thêm ${added.length}, bỏ ${removed.length} địa bàn.`);
    } catch (e: any) { showNotification('error', `Lưu thất bại: ${e?.message || e}`); } finally { setBusy(false); }
  };

  const importPermissions = async (file: File | undefined) => {
    if (!file || !onBatchImportAssignments) return;
    setBusy(true);
    try {
      const r = await parsePermissionExcelFile(file, communes as any, areas as any, surveyors as any);
      if (r.assignments.length === 0) return showNotification('error', 'Không có dòng phân công hợp lệ.' + (r.warnings.length ? ' ' + r.warnings.slice(0, 3).join(' | ') : ''));
      const lines = r.assignments.map(a => `• ${a.surveyor.name}: ${a.areaIds.length} địa bàn`).slice(0, 12);
      const warn = r.warnings.slice(0, 8).map(w => `  - ${w}`);
      const msg = `Sẽ phân công ${r.assignments.reduce((n, a) => n + a.areaIds.length, 0)} địa bàn cho ${r.assignments.length} người:\n${lines.join('\n')}` +
        (r.assignments.length > 12 ? `\n… và ${r.assignments.length - 12} người nữa` : '') +
        (r.blankRows ? `\n\n${r.blankRows} dòng để trống cột ĐTV: giữ nguyên.` : '') +
        (r.warnings.length ? `\n\n⚠ ${r.warnings.length} dòng có vấn đề (bỏ qua):\n${warn.join('\n')}${r.warnings.length > 8 ? '\n  …' : ''}` : '') + '\n\nÁp dụng?';
      if (!window.confirm(msg)) return showNotification('error', 'Đã hủy, chưa thay đổi gì.');
      await onBatchImportAssignments(r.assignments.map(a => ({ surveyorId: a.surveyor.id, areaIds: a.areaIds, communeIds: a.communeIds })));
      setSelId(''); setPicked(new Set()); setBase(new Set());
      showNotification('success', `Đã phân công xong cho ${r.assignments.length} người.`);
    } catch (e: any) { showNotification('error', `Nhập file thất bại: ${e?.message || e}`); } finally { setBusy(false); if (permRef.current) permRef.current.value = ''; }
  };

  /* ====================================================================== PHÒNG BAN */
  const [newDept, setNewDept] = useState('');
  const deptCount = (d: Department) => surveyors.filter(s => s.departmentId === d.id || normText(s.department) === normText(d.name)).length;
  const addDept = async () => {
    const n = newDept.trim(); if (!n) return;
    if (departments.some(d => normText(d.name) === normText(n))) return showNotification('error', 'Phòng ban này đã có.');
    await ensureDepartment(n); setNewDept(''); showNotification('success', `Đã thêm phòng ban ${n}.`);
  };
  const renameDept = async (d: Department) => {
    const n = window.prompt('Tên phòng ban mới:', d.name)?.trim(); if (!n || n === d.name) return;
    await onSaveDepartment({ ...d, name: n, updatedAt: new Date().toISOString() });
    for (const s of surveyors.filter(x => x.departmentId === d.id || normText(x.department) === normText(d.name))) await onSaveSurveyor({ ...s, department: n, departmentId: d.id });
    showNotification('success', 'Đã đổi tên phòng ban.');
  };
  const removeDept = async (d: Department) => {
    if (deptCount(d) > 0) return showNotification('error', `Phòng ban còn ${deptCount(d)} người, hãy chuyển họ sang phòng khác trước.`);
    if (window.confirm(`Xóa phòng ban "${d.name}"?`)) { await onDeleteDepartment(d.id); showNotification('success', 'Đã xóa phòng ban.'); }
  };

  /* ====================================================================== GIAO DIỆN */
  const tabBtn = (id: typeof tab, label: string, icon: React.ReactNode) => (
    <button onClick={() => setTab(id)} className={`px-3 py-2 text-xs font-bold flex items-center gap-1.5 rounded-t border-b-2 cursor-pointer ${tab === id ? 'border-teal-700 text-teal-900 bg-white' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{icon}{label}</button>
  );

  return (
    <div className="flex flex-col gap-3 w-full text-xs">
      <div className="flex gap-1 border-b border-slate-300">
        {tabBtn('areas', 'Phân quyền địa bàn', <MapPin className="w-3.5 h-3.5" />)}
        {tabBtn('accounts', 'Tài khoản', <Users className="w-3.5 h-3.5" />)}
        {isAdmin && tabBtn('departments', 'Phòng ban', <Building2 className="w-3.5 h-3.5" />)}
      </div>

      {/* ======================= PHÂN QUYỀN ======================= */}
      {tab === 'areas' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-600">Chọn một người ở bên trái → tích các địa bàn họ làm → bấm <b>Lưu</b>. Mỗi địa bàn chỉ một người; một người làm được nhiều địa bàn.</span>
            {isAdmin && (
              <div className="ml-auto flex gap-2">
                <input ref={permRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => importPermissions(e.target.files?.[0])} />
                <button className={`${btn} bg-white border border-slate-300 text-slate-700`} onClick={() => exportSimpleAssignExcel(communes as any, areas as any, surveyors as any, households as any)}><Download className="w-3.5 h-3.5 text-emerald-700" />Tải file phân quyền</button>
                <button className={`${btn} bg-emerald-700 hover:bg-emerald-600 text-white`} disabled={busy} onClick={() => permRef.current?.click()}><Upload className="w-3.5 h-3.5" />Tải lên Excel</button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-[280px_1fr] gap-3 items-start">
            {/* ---- trái: người ---- */}
            <div className={`${box} flex flex-col`}>
              <div className="p-2 border-b border-slate-200"><div className="relative"><Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" /><input className={`${input} w-full pl-7`} placeholder="Tìm người…" value={personQ} onChange={e => setPersonQ(e.target.value)} /></div></div>
              <div className="max-h-[560px] overflow-auto">
                {people.length === 0 && <div className="p-3 text-slate-500">Chưa có điều tra viên. Thêm ở tab Tài khoản.</div>}
                {people.map(s => {
                  const st = idx.statsBySurveyor.get(s.id); const n = calcAreaIds(idx, s, poolAreas).length;
                  return (
                    <button key={s.id} onClick={() => choose(s)} className={`w-full text-left px-3 py-2 border-b border-slate-100 cursor-pointer ${selId === s.id ? 'bg-teal-50 border-l-4 border-l-teal-700' : 'hover:bg-slate-50'}`}>
                      <div className="font-bold text-slate-800">{s.name}</div>
                      <div className="text-[11px] text-slate-500">{s.department || '—'} · {ROLE_LABELS[s.role]?.label}</div>
                      <div className="text-[11px] text-slate-600">{n} địa bàn · {st ? `${st.done}/${st.total} hộ xong` : '0 hộ'}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ---- phải: địa bàn ---- */}
            <div className={`${box} flex flex-col`}>
              <div className="p-2 border-b border-slate-200 flex flex-wrap items-center gap-2">
                <select className={input} value={tkcsF} onChange={e => { setTkcsF(e.target.value); setCommuneF('ALL'); }}>
                  <option value="ALL">Tất cả TKCS</option>{tkcsList.map(t => <option key={t} value={t}>{communes.find(c => (c.tkcsCode || 'TKCS-01') === t)?.tkcsName || t}</option>)}
                </select>
                <select className={input} value={communeF} onChange={e => setCommuneF(e.target.value)}>
                  <option value="ALL">Tất cả xã / phường</option>{communeList.map(c => <option key={c.id} value={c.id}>{c.communeName}</option>)}
                </select>
                <div className="relative"><Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" /><input className={`${input} pl-7 w-52`} placeholder="Tìm ID, tên địa bàn…" value={areaQ} onChange={e => setAreaQ(e.target.value)} /></div>
                <label className="flex items-center gap-1 text-slate-700"><input type="checkbox" checked={onlyFree} onChange={e => setOnlyFree(e.target.checked)} />Chỉ địa bàn chưa giao</label>
                <span className="ml-auto text-slate-500">{filteredRows.length}/{rows.length} địa bàn</span>
              </div>
              {!sel ? (
                <div className="p-10 text-center text-slate-500">← Chọn một điều tra viên để bắt đầu phân quyền.</div>
              ) : (
                <>
                  <div className="px-3 py-2 bg-teal-50 border-b border-teal-200 flex flex-wrap items-center gap-3">
                    <b className="text-teal-900">{sel.name}</b>
                    <span>đang chọn <b>{picked.size}</b> địa bàn</span>
                    <button className="underline text-sky-800 cursor-pointer" onClick={() => checkAllVisible(true)}>Tích tất cả đang lọc</button>
                    <button className="underline text-slate-600 cursor-pointer" onClick={() => checkAllVisible(false)}>Bỏ tích đang lọc</button>
                  </div>
                  <div className="max-h-[480px] overflow-auto">
                    <table className="w-full">
                      <thead className="bg-slate-100 sticky top-0"><tr>
                        <th className="p-1.5 w-8" /><th className="p-1.5 text-left">ID địa bàn</th><th className="p-1.5 text-left">Xã / phường</th><th className="p-1.5 text-left">Tên địa bàn</th><th className="p-1.5 text-right">Hộ chính thức</th><th className="p-1.5 text-left">Đang giao cho</th>
                      </tr></thead>
                      <tbody>
                        {filteredRows.map(r => <AreaRow key={r.a.id} r={r} on={picked.has(r.a.id)} selName={sel.name} onToggle={toggle} />)}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-2 border-t border-slate-200 flex flex-wrap items-center gap-3 bg-slate-50">
                    <span>Thay đổi: <b className="text-emerald-700">+{added.length}</b> · <b className="text-rose-700">−{removed.length}</b>{moved.length > 0 && <> · <b className="text-amber-700">{moved.length} địa bàn chuyển từ người khác</b></>}</span>
                    <button className={`${btn} bg-teal-700 hover:bg-teal-600 text-white ml-auto`} disabled={busy || (added.length === 0 && removed.length === 0)} onClick={savePerm}><Save className="w-3.5 h-3.5" />Lưu phân quyền</button>
                    <button className={`${btn} bg-white border border-slate-300 text-slate-700`} disabled={added.length === 0 && removed.length === 0} onClick={() => setPicked(new Set(base))}>Hoàn tác</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================= TÀI KHOẢN ======================= */}
      {tab === 'accounts' && (
        <div className={`${box} p-3 flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative"><Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" /><input className={`${input} pl-7 w-56`} placeholder="Tìm tên, tên đăng nhập, phòng ban…" value={q} onChange={e => setQ(e.target.value)} /></div>
            {isAdmin && <select className={input} value={roleF} onChange={e => setRoleF(e.target.value as any)}><option value="ALL">Mọi vai trò</option>{(Object.keys(ROLE_LABELS) as UserRole[]).map(r => <option key={r} value={r}>{ROLE_LABELS[r].label}</option>)}</select>}
            {isAdmin && <select className={input} value={deptF} onChange={e => setDeptF(e.target.value)}><option value="ALL">Mọi phòng ban</option>{deptNames.map(d => <option key={d} value={d}>{d}</option>)}</select>}
            <label className="flex items-center gap-1 text-slate-600"><input type="checkbox" checked={showPw} onChange={e => setShowPw(e.target.checked)} />Hiện mật khẩu</label>
            <div className="ml-auto flex gap-2">
              <input ref={xlsAccRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => importAccounts(e.target.files?.[0])} />
              <button className={`${btn} bg-white border border-slate-300 text-slate-700`} onClick={downloadAccountTemplate}><FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />Tải mẫu Excel</button>
              <button className={`${btn} bg-white border border-slate-300 text-slate-700`} disabled={busy} onClick={() => xlsAccRef.current?.click()}><Upload className="w-3.5 h-3.5" />Nhập từ Excel</button>
              <button className={`${btn} bg-teal-700 hover:bg-teal-600 text-white`} onClick={openAdd}><Plus className="w-3.5 h-3.5" />Thêm tài khoản</button>
            </div>
          </div>
          <div className="overflow-auto border border-slate-200 rounded max-h-[600px]">
            <table className="w-full">
              <thead className="bg-slate-100 sticky top-0"><tr>
                <th className="p-1.5 w-10">STT</th><th className="p-1.5 text-left">Họ và tên</th><th className="p-1.5 text-left">Tên đăng nhập</th><th className="p-1.5 text-left">Mật khẩu</th><th className="p-1.5 text-left">Phòng ban</th>
                <th className="p-1.5 text-left">Vai trò</th><th className="p-1.5 text-right">Địa bàn</th><th className="p-1.5 text-right">Hộ xong / giao</th><th className="p-1.5 text-center">Trạng thái</th><th className="p-1.5" />
              </tr></thead>
              <tbody>
                {filteredAccounts.map((s, i) => {
                  const st = idx.statsBySurveyor.get(s.id); const all = (s.assignedAreas || []).includes('ALL');
                  return (
                    <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-1.5 text-center text-slate-500">{i + 1}</td>
                      <td className="p-1.5 font-bold">{s.name}</td>
                      <td className="p-1.5 font-mono">{s.username || s.code}</td>
                      <td className="p-1.5 font-mono">{showPw ? (s.password || (s.id === 'admin' ? 'admin' : INITIAL_DEFAULT_PASSWORD)) : '••••••'}</td>
                      <td className="p-1.5">{s.department || '—'}</td>
                      <td className="p-1.5"><span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${ROLE_LABELS[s.role]?.color}`}>{ROLE_LABELS[s.role]?.label}</span></td>
                      <td className="p-1.5 text-right">{all ? 'Tất cả' : calcAreaIds(idx, s, areas).length}</td>
                      <td className="p-1.5 text-right">{st ? `${st.done}/${st.total}` : '—'}</td>
                      <td className="p-1.5 text-center">{s.status === 'ACTIVE' ? <span className="text-emerald-700 font-bold">Hoạt động</span> : <span className="text-rose-700 font-bold">Khóa</span>}</td>
                      <td className="p-1.5 whitespace-nowrap text-right">
                        {isAdmin && s.id !== currentUser.id && <button title="Đăng nhập thử bằng tài khoản này" className="p-1 text-sky-700 cursor-pointer" onClick={() => onSelectActiveUser(s)}><LogIn className="w-3.5 h-3.5" /></button>}
                        <button title="Sửa" className="p-1 text-slate-700 cursor-pointer" onClick={() => openEdit(s)}><Pencil className="w-3.5 h-3.5" /></button>
                        <button title="Xóa" className="p-1 text-rose-700 cursor-pointer" onClick={() => removeAccount(s)}><Trash2 className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  );
                })}
                {filteredAccounts.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-slate-500">Không có tài khoản nào.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ======================= PHÒNG BAN ======================= */}
      {tab === 'departments' && isAdmin && (
        <div className={`${box} p-3 flex flex-col gap-3 max-w-2xl`}>
          <div className="flex gap-2">
            <input className={`${input} flex-1`} placeholder="Tên phòng ban mới…" value={newDept} onChange={e => setNewDept(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDept()} />
            <button className={`${btn} bg-teal-700 hover:bg-teal-600 text-white`} onClick={addDept}><Plus className="w-3.5 h-3.5" />Thêm</button>
          </div>
          <table className="w-full"><thead className="bg-slate-100"><tr><th className="p-1.5 text-left">Phòng ban</th><th className="p-1.5 text-right">Số người</th><th className="p-1.5" /></tr></thead>
            <tbody>{departments.map(d => (
              <tr key={d.id} className="border-t border-slate-100"><td className="p-1.5 font-bold">{d.name}</td><td className="p-1.5 text-right">{deptCount(d)}</td>
                <td className="p-1.5 text-right whitespace-nowrap"><button className="p-1 cursor-pointer" title="Đổi tên" onClick={() => renameDept(d)}><Pencil className="w-3.5 h-3.5" /></button><button className="p-1 text-rose-700 cursor-pointer" title="Xóa" onClick={() => removeDept(d)}><Trash2 className="w-3.5 h-3.5" /></button></td></tr>
            ))}{departments.length === 0 && <tr><td colSpan={3} className="p-3 text-center text-slate-500">Chưa có phòng ban.</td></tr>}</tbody></table>
        </div>
      )}

      {/* ======================= FORM TÀI KHOẢN ======================= */}
      {form && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl w-full max-w-lg">
            <div className="p-3 bg-teal-800 text-white font-bold flex items-center justify-between">{form.id ? 'Sửa tài khoản' : 'Thêm tài khoản'}<button className="cursor-pointer" onClick={() => setForm(null)}><X className="w-4 h-4" /></button></div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <label className="col-span-2 flex flex-col gap-1">Họ và tên *<input className={input} autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value, username: form.id || form.username ? form.username : slug(e.target.value) })} /></label>
              <label className="flex flex-col gap-1">Tên đăng nhập *<input className={input} value={form.username} onChange={e => setForm({ ...form, username: e.target.value.trim() })} /></label>
              <label className="flex flex-col gap-1">Mật khẩu *
                <div className="relative"><input className={`${input} w-full pr-8 font-mono`} type={showPw ? 'text' : 'password'} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
                  <button type="button" className="absolute right-2 top-2 text-slate-500 cursor-pointer" onClick={() => setShowPw(v => !v)}>{showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button></div></label>
              <label className="flex flex-col gap-1">Phòng ban
                <input className={input} list="dept-list" value={isAdmin ? form.department : (currentUser.department || '')} disabled={!isAdmin} onChange={e => setForm({ ...form, department: e.target.value })} />
                <datalist id="dept-list">{deptNames.map(d => <option key={d} value={d} />)}</datalist></label>
              <label className="flex flex-col gap-1">Vai trò
                <select className={input} value={form.role} disabled={!isAdmin || form.id === 'admin'} onChange={e => setForm({ ...form, role: e.target.value as UserRole })}>
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map(r => <option key={r} value={r}>{ROLE_LABELS[r].label}</option>)}</select></label>
              <label className="flex flex-col gap-1">Số điện thoại<input className={input} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
              <label className="flex flex-col gap-1">Trạng thái
                <select className={input} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as any })}><option value="ACTIVE">Hoạt động</option><option value="LOCKED">Khóa</option></select></label>
              <label className="col-span-2 flex flex-col gap-1">Ghi chú<input className={input} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
            </div>
            <div className="p-3 border-t border-slate-200 flex justify-end gap-2">
              <button className={`${btn} bg-white border border-slate-300 text-slate-700`} onClick={() => setForm(null)}>Hủy</button>
              <button className={`${btn} bg-teal-700 hover:bg-teal-600 text-white`} disabled={busy} onClick={saveForm}><Save className="w-3.5 h-3.5" />Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
