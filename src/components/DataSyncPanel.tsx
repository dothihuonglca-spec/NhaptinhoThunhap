import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Upload, DatabaseZap, FileJson, ShieldAlert, CheckCircle2, Loader2, Cloud, HardDrive, RefreshCw, SearchCheck, Trash2, FileText, Activity } from 'lucide-react';
import type { Household, SurveyArea, Commune } from '../App';
import type { Surveyor } from '../types/user';
import {
  AreaGroup, AreaImportPlan, ReadResult, applyFolderPlan, buildAreaGroups, exportResultAndMark, groupsOfSurveyor, hasEnteredData, planFolderImport, readPackageFiles,
} from '../utils/areaSync';
import {
  ProgressDoc, RosterStatus, doc, fetchProgress, flushPending, getCachedProgress, getRosterExportData, isLocalStoreBroken, loadRosterFileObject, markRosterExported,
  migrateFromLegacyFirestore, migrateFromLegacyLocal, onRosterStatus, pushProgressNow, refreshAll, useNewerRosterFile, writeBatch,
} from '../utils/dataStore';
import { db } from '../firebase';
import { buildAssignIndex } from '../utils/assignIndex';
import { buildRosterFile, parseRosterFile, serializeRosterFile } from '../utils/rosterFile';
import { EntriesBackup, RestoreMode, RestorePlan, applyRestore, buildEntriesBackup, planRestore, readBackupFile } from '../utils/fullBackup';

interface Props {
  currentUser: Surveyor;
  surveyors: Surveyor[];
  households: Household[];
  areas: SurveyArea[];
  communes: Commune[];
  showNotification: (type: 'success' | 'error', message: string) => void;
}

const card = 'bg-white rounded border border-slate-300 shadow-sm p-4 flex flex-col gap-3';
const btn = 'px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export default function DataSyncPanel({ currentUser, surveyors, households, areas, communes, showNotification }: Props) {
  const isAdmin = currentUser.role === 'ADMIN';
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => buildAreaGroups(households, areas, communes), [households, areas, communes]);
  const myGroups = useMemo(
    () => (isAdmin || currentUser.role === 'MANAGER' ? groups : currentUser.role === 'SURVEYOR' ? groups : groupsOfSurveyor(currentUser.assignedAreas, groups)),
    [isAdmin, groups, currentUser]);
  const dirtyGroups = myGroups.filter(g => g.dirty > 0);
  const groupById = useMemo(() => new Map(groups.map(g => [g.areaId, g] as const)), [groups]);

  /* ---------------- xuất phiếu đã nhập theo địa bàn ---------------- */
  const exportResult = async (gs: AreaGroup[], full: boolean) => {
    if (gs.length === 0) return;
    const files = await exportResultAndMark(gs, currentUser.name, full, `KETQUA_${currentUser.code || currentUser.id}.zip`);
    if (files.length === 0) { showNotification('error', 'Chưa có phiếu nào đã nhập để xuất.'); return; }
    showNotification('success', `Đã xuất ${files.reduce((s, f) => s + f.count, 0)} phiếu của ${files.length} địa bàn.`);
  };

  /* ---------------- ADMIN: nhập cả thư mục kết quả ---------------- */
  const dirRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [fRead, setFRead] = useState<{ items: ReadResult['items']; errors: string[]; ignored: number } | null>(null);
  const [fPlans, setFPlans] = useState<AreaImportPlan[]>([]);
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [ignoreOwner, setIgnoreOwner] = useState(false);
  const [fResult, setFResult] = useState('');

  const onPickFolder = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true); setFResult('');
    try {
      const all = Array.from(files);
      const relevant = all.filter(f => /\.(json|zip)$/i.test(f.name));
      const r = await readPackageFiles(relevant);
      const wrong = r.items.filter(i => i.pkg.kind !== 'RESULT');
      const ok = r.items.filter(i => i.pkg.kind === 'RESULT');
      setFRead({ items: ok, errors: [...r.errors, ...wrong.map(w => `${w.fileName}: là gói giao việc của bản cũ, không phải kết quả của ĐTV`)], ignored: all.length - relevant.length });
      setFPlans(planFolderImport(ok, households, { ignoreOwner }));
      setOverwrite(new Set());      // mặc định KHÔNG ghi đè
    } finally {
      setBusy(false);
      if (dirRef.current) dirRef.current.value = '';
      if (filesRef.current) filesRef.current.value = '';
    }
  };
  const replanFolder = (ig: boolean) => { setIgnoreOwner(ig); if (fRead) { setFPlans(planFolderImport(fRead.items, households, { ignoreOwner: ig })); setOverwrite(new Set()); } };
  const toggleOverwrite = (id: string) => setOverwrite(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const withConflicts = fPlans.filter(p => p.conflicts.length > 0);
  const sumFresh = fPlans.reduce((n, p) => n + p.fresh.length, 0);
  const sumConf = withConflicts.reduce((n, p) => n + p.conflicts.length, 0);
  const sumOver = withConflicts.filter(p => overwrite.has(p.areaId)).reduce((n, p) => n + p.conflicts.length, 0);
  const sumMissing = fPlans.reduce((n, p) => n + p.missingInRoster, 0);
  const areasHavingData = fPlans.filter(p => p.existingWithData > 0 && p.files.length > 0);

  const applyFolder = async () => {
    if (sumOver > 0 && !window.confirm(`Sẽ GHI ĐÈ ${sumOver} hộ đã có dữ liệu ở máy này (${[...overwrite].length} địa bàn) bằng dữ liệu trong file. Tiếp tục?`)) return;
    setBusy(true);
    try {
      const r = await applyFolderPlan(fPlans, overwrite);
      const msg = `Đã ghi ${r.fresh} phiếu (dữ liệu mới)${r.overwritten ? `, ghi đè ${r.overwritten} phiếu` : ''}${r.skipped ? `, giữ nguyên ${r.skipped} phiếu đã có dữ liệu` : ''}.`;
      setFResult(msg); showNotification('success', msg);
      setFRead(null); setFPlans([]); setOverwrite(new Set());
    } catch (e: any) { showNotification('error', `Nhập thất bại: ${e?.message || e}`); } finally { setBusy(false); }
  };

  /* ---------------- sao lưu / khôi phục phiếu trên máy này ---------------- */
  const bkRef = useRef<HTMLInputElement>(null);
  const [bk, setBk] = useState<EntriesBackup | null>(null);
  const [bkMode, setBkMode] = useState<RestoreMode>('merge');
  const [bkPlan, setBkPlan] = useState<RestorePlan | null>(null);
  const [bkErr, setBkErr] = useState('');
  const myEntries = useMemo(() => households.filter(hasEnteredData).length, [households]);

  const exportBackup = async () => {
    setBusy(true);
    try {
      const { blob, name, counts } = await buildEntriesBackup(households, currentUser.name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showNotification('success', `Đã sao lưu ${counts.entries} phiếu của ${counts.areas} địa bàn.`);
    } catch (e: any) { showNotification('error', `Sao lưu thất bại: ${e?.message || e}`); } finally { setBusy(false); }
  };
  const pickBackup = async (files: FileList | null) => {
    const f = files?.[0]; if (!f) return;
    setBusy(true); setBkErr(''); setBk(null); setBkPlan(null);
    try { const b = await readBackupFile(f); setBk(b); setBkPlan(planRestore(b, households, bkMode)); }
    catch (e: any) { setBkErr(e?.message || String(e)); } finally { setBusy(false); if (bkRef.current) bkRef.current.value = ''; }
  };
  const changeBkMode = (m: RestoreMode) => { setBkMode(m); if (bk) setBkPlan(planRestore(bk, households, m)); };
  const applyBackup = async () => {
    if (!bk || !bkPlan) return;
    if (bkMode === 'replace' && !window.confirm('THAY TOÀN BỘ: xóa hết phiếu đã nhập đang có trên trình duyệt này rồi nạp từ file. Tiếp tục?')) return;
    setBusy(true);
    try { const n = await applyRestore(bkPlan); showNotification('success', `Đã nạp ${n} phiếu.`); setBk(null); setBkPlan(null); }
    catch (e: any) { showNotification('error', `Nạp thất bại: ${e?.message || e}`); } finally { setBusy(false); }
  };

  /* ---------------- trạng thái dữ liệu ---------------- */
  const [fb, setFb] = useState<RosterStatus | null>(null);
  useEffect(() => onRosterStatus(setFb), []);
  const srcText = !fb ? '—' : fb.source === 'file' ? `File bangke.json${fb.fileVersion ? ` (${new Date(fb.fileVersion).toLocaleDateString('vi-VN')})` : ''}` : fb.source === 'local' ? 'Bảng kê trên máy (chưa xuất ra file)' : 'Chưa có bảng kê';
  const doRefresh = async () => {
    setBusy(true);
    try { const st = await refreshAll(); showNotification(st.error ? 'error' : 'success', st.error ? st.error : `Đã cập nhật: ${st.areaDocs} địa bàn, ${st.households} hộ.`); }
    catch (e: any) { showNotification('error', `Cập nhật thất bại: ${e?.message || e}`); } finally { setBusy(false); }
  };

  /* ---------------- BẢNG KÊ: xuất / nạp bangke.json ---------------- */
  const bkFileRef = useRef<HTMLInputElement>(null);
  const [bkMsg, setBkMsg] = useState('');
  const gzipSize = async (text: string): Promise<number | null> => {
    try { return (await new Response(new Blob([text]).stream().pipeThrough(new (window as any).CompressionStream('gzip'))).blob()).size; } catch { return null; }
  };
  const exportBangKe = async () => {
    setBusy(true); setBkMsg('');
    try {
      const file = buildRosterFile(await getRosterExportData(), currentUser.name);
      if ((file.counts?.households || 0) === 0) { showNotification('error', 'Máy này chưa có bảng kê để xuất.'); return; }
      const text = serializeRosterFile(file);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'bangke.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      await markRosterExported(file.v);
      const gz = await gzipSize(text);
      setBkMsg(`Đã xuất bangke.json: ${file.counts!.households} hộ, ${file.counts!.areas} địa bàn, ${file.counts!.communes} xã — ${(blob.size / 1048576).toFixed(2)} MB${gz ? ` (khi tải qua mạng nén còn khoảng ${(gz / 1048576).toFixed(2)} MB)` : ''}. Chép file vào thư mục public/ của mã nguồn (thay file cũ), chạy npm run build rồi đưa thư mục dist/ lên máy chủ.`);
    } catch (e: any) { showNotification('error', `Xuất thất bại: ${e?.message || e}`); } finally { setBusy(false); }
  };
  const pickBangKe = async (files: FileList | null) => {
    const f = files?.[0]; if (!f) return;
    setBusy(true); setBkMsg('');
    try {
      const file = parseRosterFile(await f.text());
      if (!window.confirm(`Dùng file bảng kê này trên máy: ${file.hh.length} hộ, ${file.areas.length} địa bàn, ${file.communes.length} xã (xuất ${new Date(file.v).toLocaleString('vi-VN')}). Bảng kê hiện có trên máy sẽ được thay; phiếu đã nhập và phân quyền giữ nguyên. Tiếp tục?`)) return;
      const r = await loadRosterFileObject(file);
      setBkMsg(`Đã nạp: ${r.households} hộ, ${r.areas} địa bàn, ${r.communes} xã.`);
    } catch (e: any) { showNotification('error', e?.message || String(e)); } finally { setBusy(false); if (bkFileRef.current) bkFileRef.current.value = ''; }
  };

  /* ---------------- TIẾN ĐỘ điều tra viên (Firebase) ---------------- */
  const [prog, setProg] = useState<{ at: string; docs: ProgressDoc[] } | null>(null);
  useEffect(() => { void getCachedProgress().then(p => { if (p) setProg(p); }); }, []);
  const loadProg = async () => {
    setBusy(true);
    try { setProg(await fetchProgress()); } catch (e: any) { showNotification('error', `Không tải được tiến độ: ${e?.message || e}`); } finally { setBusy(false); }
  };
  const progRows = useMemo(() => (prog?.docs || []).map(d => {
    let t = 0, e = 0, cc = 0, last = '';
    Object.values(d.areas || {}).forEach(a => { t += a.t; e += a.e; cc += a.c; if (a.at && a.at > last) last = a.at; });
    return { id: d.surveyorId, name: surveyors.find(s => s.id === d.surveyorId)?.name || d.surveyorId, areas: Object.keys(d.areas || {}).length, t, e, c: cc, last, sent: d.updatedAt };
  }).sort((x, y) => x.name.localeCompare(y.name, 'vi')), [prog, surveyors]);

  /* ---------------- ADMIN: kiểm tra địa bàn thừa / thiếu ---------------- */
  const checks = useMemo(() => {
    if (!isAdmin || !fb || !fb.loaded || households.length === 0) return null;
    const ix = buildAssignIndex(areas as any, communes as any, households as any);
    const hhCount = new Map<string, number>(); const communesWithHh = new Set<string>();
    const unknown = new Map<string, { id: string; name: string; n: number; communeId?: string; code: string; communeName?: string }>();
    households.forEach(h => {
      communesWithHh.add(h.communeId);
      const a = ix.areaById.get(h.areaId) || ix.areaByKey.get(`${h.communeId}_${h.areaCode}`) || ix.areaByKey.get(`${h.communeCode}_${h.areaCode}`);
      if (a) hhCount.set(a.id, (hhCount.get(a.id) || 0) + 1);
      else { const u = unknown.get(h.areaId) || { id: h.areaId, name: h.sheetName || h.areaName, n: 0, communeId: h.communeId, code: h.areaCode, communeName: h.communeName }; u.n++; unknown.set(h.areaId, u); }
    });
    const keyOf = (a: any) => `${ix.communeById.get(a.communeId)?.communeCode || a.communeCode || a.communeId}${a.code}`;
    const empty = areas.filter(a => !hhCount.get(a.id) && communesWithHh.has(a.communeId)).map(a => ({ a, key: keyOf(a), commune: ix.communeById.get(a.communeId)?.communeName || a.communeId }));
    const groupsDup = new Map<string, any[]>();
    areas.forEach(a => { const k = keyOf(a); groupsDup.set(k, [...(groupsDup.get(k) || []), a]); });
    const dups = Array.from(groupsDup.entries()).filter(([, v]) => v.length > 1).map(([key, v]) => ({ key, list: v.map(a => ({ a, n: hhCount.get(a.id) || 0 })) }));
    return { empty, dups, missing: Array.from(unknown.values()), totalAreas: areas.length, withHh: hhCount.size };
  }, [isAdmin, fb, households, areas, communes]);
  const [delSel, setDelSel] = useState<Set<string>>(new Set());
  const [chkMsg, setChkMsg] = useState('');
  const toggleDel = (id: string) => setDelSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const deleteAreas = async () => {
    if (delSel.size === 0 || !window.confirm(`Xóa ${delSel.size} địa bàn đã chọn khỏi danh mục trên máy này? (Chỉ xóa địa bàn trống, không có hộ nào.) Sau đó hãy xuất lại bangke.json.`)) return;
    setBusy(true);
    try { const b = writeBatch(db); delSel.forEach(id => b.delete(doc(db, 'surveyAreas', id))); await b.commit(); setChkMsg(`Đã xóa ${delSel.size} địa bàn. Hãy xuất lại bangke.json.`); setDelSel(new Set()); }
    catch (e: any) { setChkMsg(`Lỗi: ${e?.message || e}`); } finally { setBusy(false); }
  };
  const createMissing = async () => {
    if (!checks || checks.missing.length === 0) return;
    setBusy(true);
    try {
      const b = writeBatch(db);
      checks.missing.forEach(u => b.set(doc(db, 'surveyAreas', u.id), { communeId: u.communeId, code: u.code, name: u.name || `Địa bàn ${u.code}`, householdCount: u.n }));
      await b.commit(); setChkMsg(`Đã tạo ${checks.missing.length} địa bàn còn thiếu trong danh mục. Hãy xuất lại bangke.json.`);
    } catch (e: any) { setChkMsg(`Lỗi: ${e?.message || e}`); } finally { setBusy(false); }
  };

  /* ---------------- ADMIN: chuyển dữ liệu từ bản cũ ---------------- */
  const [migMsg, setMigMsg] = useState('');
  const runMig = async (kind: 'local' | 'firestore') => {
    const q = kind === 'local'
      ? 'Chuyển bảng kê (xã, địa bàn, hộ), phiếu đã nhập và người phụ trách đang lưu trong trình duyệt này (bản trước) sang cách lưu mới? Phân quyền sẽ được gửi lên Firebase (1 tài liệu); bảng kê ở lại máy này — sau đó hãy xuất bangke.json.'
      : "Đọc collection 'households' cũ trên Firestore (TỐN nhiều lượt đọc hạn ngạch: mỗi hộ một lượt), tách thành bảng kê + phiếu nhập trên máy này và phân quyền? Chỉ làm khi thật cần.";
    if (!window.confirm(q)) return;
    setBusy(true); setMigMsg('');
    try {
      if (kind === 'local') {
        const r = await migrateFromLegacyLocal(setMigMsg);
        setMigMsg(r.found ? `Xong: ${r.households} hộ, ${r.surveyAreas} địa bàn, ${r.communes} xã đã chuyển vào bảng kê trên máy. Hãy xuất bangke.json (mục 4) để mọi người dùng chung.` : `Không thấy bảng kê của bản trước trong trình duyệt này. Dữ liệu trình duyệt gắn với từng địa chỉ web: bạn đang mở ở ${window.location.origin}. Hãy mở lại đúng địa chỉ (và cổng) đã dùng lần trước, hoặc tải bảng kê Excel.`);
      } else {
        const r = await migrateFromLegacyFirestore(setMigMsg);
        setMigMsg(r.found ? `Xong: ${r.households} hộ đã chuyển vào bảng kê trên máy. Hãy xuất bangke.json (mục 4).` : "Collection 'households' cũ trên Firestore đang trống.");
      }
    } catch (e: any) { setMigMsg(`Lỗi: ${e?.message || e}`); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4 w-full">
      {isLocalStoreBroken() && (
        <div className="bg-rose-50 border border-rose-300 text-rose-800 rounded p-3 text-xs flex gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Trình duyệt không cho lưu dữ liệu cục bộ (có thể đang ở chế độ riêng tư). Phiếu nhập sẽ mất khi đóng tab — hãy dùng cửa sổ thường.</span>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3 text-xs">
        <div className="bg-sky-50 border border-sky-300 text-sky-900 rounded p-3 flex gap-2"><Cloud className="w-4 h-4 shrink-0 mt-0.5" /><span><b>Trên Firebase (rất ít dữ liệu):</b> tài khoản, <b>phân quyền</b> (một tài liệu) và <b>tiến độ</b> của điều tra viên. Bảng kê không nằm trên Firebase.</span></div>
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded p-3 flex gap-2"><HardDrive className="w-4 h-4 shrink-0 mt-0.5" /><span><b>Trong file bangke.json và trình duyệt này:</b> bảng kê (đọc từ file đi kèm ứng dụng) và nội dung các phiếu đã nhập ({myEntries} phiếu). Xóa dữ liệu trình duyệt hoặc đổi máy sẽ mất phiếu chưa xuất — làm xong mỗi địa bàn hãy xuất file và giữ lại.</span></div>
      </div>

      {/* ===== TRẠNG THÁI DỮ LIỆU ===== */}
      <div className={card}>
        <h3 className="font-bold text-slate-800 text-sm uppercase flex items-center gap-2"><Cloud className="w-4 h-4 text-sky-800" />Trạng thái dữ liệu</h3>
        <div className="grid sm:grid-cols-5 gap-2 text-xs">
          <div className="bg-slate-50 border border-slate-200 rounded p-2"><div className="text-slate-500">Nguồn bảng kê</div><b>{srcText}</b></div>
          <div className="bg-slate-50 border border-slate-200 rounded p-2"><div className="text-slate-500">Phân quyền cập nhật lúc</div><b>{fb?.assignAt ? new Date(fb.assignAt).toLocaleString('vi-VN') : '—'}</b></div>
          <div className="bg-slate-50 border border-slate-200 rounded p-2"><div className="text-slate-500">Địa bàn / hộ đang thấy</div><b>{fb?.areaDocs ?? 0} / {fb?.households ?? 0}</b></div>
          <div className="bg-slate-50 border border-slate-200 rounded p-2"><div className="text-slate-500">Phạm vi</div><b>{fb?.scope.kind === 'owner' ? 'Địa bàn của tôi' : fb?.scope.kind === 'all' ? 'Tất cả địa bàn' : '—'}</b></div>
          <div className={`border rounded p-2 ${fb && fb.pending > 0 ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'}`}><div className="text-slate-500">Chờ gửi lên Firebase</div><b>{fb?.pending ?? 0} thay đổi</b></div>
        </div>
        {fb?.error && <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded p-2 text-xs">⚠ {fb.error}</div>}
        {fb?.fileBlocked && (
          <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded p-2 text-xs flex flex-wrap items-center gap-2">
            <span><b>Có bangke.json mới hơn</b> (xuất {new Date(fb.fileBlocked).toLocaleString('vi-VN')}) nhưng máy này đang giữ bảng kê tự tải/chỉnh sửa chưa xuất ra file.</span>
            <button onClick={async () => { if (!window.confirm('Bỏ bảng kê tự tải trên máy này và dùng bangke.json mới? (Phiếu đã nhập và phân quyền giữ nguyên.)')) return; setBusy(true); try { await useNewerRosterFile(); showNotification('success', 'Đã dùng bangke.json mới.'); } catch (e: any) { showNotification('error', e?.message || String(e)); } finally { setBusy(false); } }} className="px-2 py-1 rounded bg-amber-600 text-white font-bold cursor-pointer">Dùng bangke.json mới</button>
          </div>
        )}
        <p className="text-xs text-slate-600"><b>Cách hoạt động:</b> ứng dụng đọc bảng kê từ file <code>bangke.json</code> đi kèm rồi làm việc và lưu <b>trực tiếp trên máy</b>. Firebase chỉ được gọi để đọc <b>phân quyền</b> (1 lượt đọc mỗi lần mở) và gửi <b>phân quyền / tiến độ</b> khi có thay đổi; chưa gửi được (mất mạng, hết hạn ngạch) thì giữ lại và gửi sau. Phiếu nhập không bao giờ lên Firebase.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={doRefresh} disabled={busy} className={`${btn} bg-sky-800 hover:bg-sky-700 text-white`}><RefreshCw className="w-3.5 h-3.5" />Cập nhật (tải lại bangke.json + phân quyền)</button>
          <button onClick={async () => { setBusy(true); try { await flushPending(); showNotification('success', 'Đã gửi thay đổi lên Firebase.'); } catch (e: any) { showNotification('error', `Chưa gửi được: ${e?.message || e}`); } finally { setBusy(false); } }} disabled={busy || !fb || fb.pending === 0} className={`${btn} bg-white border border-amber-500 text-amber-800`}>Gửi {fb?.pending ?? 0} thay đổi lên Firebase</button>
          {fb?.scope.kind === 'owner' && <button onClick={async () => { setBusy(true); try { await pushProgressNow(); showNotification('success', 'Đã gửi tiến độ lên Firebase.'); } catch (e: any) { showNotification('error', `Chưa gửi được: ${e?.message || e}`); } finally { setBusy(false); } }} disabled={busy} className={`${btn} bg-white border border-sky-500 text-sky-900`}>Gửi tiến độ của tôi ngay</button>}
        </div>
      </div>

      {/* ===== XUẤT PHIẾU ĐÃ NHẬP ===== */}
      <div className={card}>
        <h3 className="font-bold text-slate-800 text-sm uppercase flex items-center gap-2"><Download className="w-4 h-4 text-sky-800" />{isAdmin ? '1. Xuất phiếu đã nhập theo địa bàn' : '1. Xuất phiếu đã nhập gửi cho admin'}</h3>
        <p className="text-xs text-slate-600">File chứa <b>nội dung các phiếu đã nhập</b> (không gồm bảng kê). “Xuất phần mới” chỉ gồm phiếu mới nhập hoặc mới sửa kể từ lần xuất trước; “Xuất toàn bộ phiếu đã nhập” gồm mọi phiếu của địa bàn. Mỗi file đặt tên theo ID địa bàn (mã xã + mã địa bàn).</p>
        {myGroups.length === 0 ? (
          <p className="text-xs text-slate-500">Chưa có địa bàn nào được giao cho tài khoản này.</p>
        ) : (
          <>
            <div><button onClick={() => exportResult(dirtyGroups, false)} disabled={dirtyGroups.length === 0} className={`${btn} bg-sky-800 hover:bg-sky-700 text-white`}><Download className="w-3.5 h-3.5" />Xuất tất cả phiếu mới/sửa ({dirtyGroups.reduce((s, g) => s + g.dirty, 0)} phiếu / {dirtyGroups.length} địa bàn)</button></div>
            <div className="max-h-72 overflow-auto border border-slate-200 rounded">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 sticky top-0"><tr><th className="p-1.5 text-left">ID địa bàn</th><th className="p-1.5 text-left">Xã</th><th className="p-1.5 text-left">Địa bàn</th><th className="p-1.5 text-right">Tổng hộ</th><th className="p-1.5 text-right">Phiếu đã nhập</th><th className="p-1.5 text-right">Mới/sửa chưa xuất</th><th className="p-1.5" /></tr></thead>
                <tbody>
                  {myGroups.map(g => (
                    <tr key={g.areaId} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-1.5 font-mono font-bold text-[#047484]">{g.areaId}</td><td className="p-1.5">{g.communeName}</td><td className="p-1.5">{g.areaName}</td>
                      <td className="p-1.5 text-right">{g.total}</td><td className="p-1.5 text-right">{g.withData}</td>
                      <td className={`p-1.5 text-right font-bold ${g.dirty ? 'text-amber-700' : 'text-slate-400'}`}>{g.dirty}</td>
                      <td className="p-1.5 whitespace-nowrap text-right">
                        <button disabled={g.dirty === 0} onClick={() => exportResult([g], false)} className="px-2 py-1 text-[11px] font-bold rounded bg-sky-700 text-white disabled:opacity-30 mr-1 cursor-pointer">Xuất phần mới</button>
                        <button disabled={g.withData === 0} onClick={() => exportResult([g], true)} className="px-2 py-1 text-[11px] font-bold rounded border border-slate-300 text-slate-700 cursor-pointer disabled:opacity-30">Xuất toàn bộ phiếu đã nhập</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ===== ADMIN: nhập cả thư mục kết quả ===== */}
      {isAdmin && (
        <div className={card}>
          <h3 className="font-bold text-slate-800 text-sm uppercase flex items-center gap-2"><Upload className="w-4 h-4 text-emerald-700" />2. Nhập phiếu của các điều tra viên (cả thư mục)</h3>
          <p className="text-xs text-slate-600">Gom file của mọi ĐTV (.json hoặc .zip) vào <b>một thư mục</b> rồi bấm “Chọn thư mục”. Hệ thống đọc hết các file trong thư mục (kể cả thư mục con), gộp theo ID địa bàn, <b>địa bàn nào chưa có dữ liệu thì ghi luôn</b>; hộ nào máy này đã có dữ liệu khác thì <b>hỏi có ghi đè không</b> (mặc định không ghi đè). Phiếu được ghi vào trình duyệt của admin; bảng kê trên Firebase không bị đụng tới.</p>
          <div className="flex flex-wrap gap-2">
            <input ref={dirRef} type="file" multiple className="hidden" {...({ webkitdirectory: '', directory: '' } as any)} onChange={e => onPickFolder(e.target.files)} />
            <input ref={filesRef} type="file" accept=".json,.zip" multiple className="hidden" onChange={e => onPickFolder(e.target.files)} />
            <button onClick={() => dirRef.current?.click()} disabled={busy} className={`${btn} bg-emerald-700 hover:bg-emerald-600 text-white`}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileJson className="w-3.5 h-3.5" />}Chọn thư mục…</button>
            <button onClick={() => filesRef.current?.click()} disabled={busy} className={`${btn} bg-white border border-slate-300 text-slate-700`}>Hoặc chọn từng file…</button>
          </div>
          {fResult && <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 rounded p-2 text-xs">{fResult}</div>}

          {fRead && (
            <div className="flex flex-col gap-2 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded p-2">
                Đọc được <b>{fRead.items.length}</b> file kết quả → <b>{fPlans.length}</b> địa bàn.
                {fRead.ignored > 0 && <> Bỏ qua {fRead.ignored} file khác loại (không phải .json/.zip).</>}
                {fPlans.some(p => p.duplicatesAcrossFiles > 0) && <> Có {fPlans.reduce((n, p) => n + p.duplicatesAcrossFiles, 0)} hộ xuất hiện ở nhiều file, chỉ lấy bản mới nhất.</>}
              </div>
              {fRead.errors.length > 0 && <ul className="bg-rose-50 border border-rose-200 rounded p-2 text-rose-800 list-disc pl-5">{fRead.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              {sumMissing > 0 && <div className="bg-rose-50 border border-rose-200 rounded p-2 text-rose-800">⛔ {sumMissing} hộ trong file KHÔNG có trong bảng kê trên Firebase nên bị bỏ qua (kiểm tra xem bảng kê đã được tải lên đúng chưa).</div>}
              {areasHavingData.length > 0 && (
                <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded p-2">
                  <b>⚠ {areasHavingData.length} địa bàn đã có dữ liệu nhập ở máy này:</b>{' '}
                  {areasHavingData.map(p => `${p.areaId} (${p.existingWithData} hộ có dữ liệu; file: ${p.files.map(f => f.split(/[\\/›]/).pop()?.trim()).join(', ')})`).join('; ')}
                </div>
              )}
              {fPlans.length > 0 && (
                <div className="overflow-auto border border-slate-200 rounded max-h-96">
                  <table className="w-full">
                    <thead className="bg-slate-100 sticky top-0"><tr>
                      <th className="p-1.5 text-center">Ghi đè</th><th className="p-1.5 text-left">ID địa bàn</th><th className="p-1.5 text-left">Xã / địa bàn</th><th className="p-1.5 text-left">ĐTV gửi</th>
                      <th className="p-1.5 text-right">Ghi bình thường</th><th className="p-1.5 text-right">Không đổi</th><th className="p-1.5 text-right">Đã có dữ liệu ở máy này</th><th className="p-1.5 text-right">Trùng (cần hỏi)</th><th className="p-1.5 text-left">Ghi chú</th>
                    </tr></thead>
                    <tbody>
                      {fPlans.map(p => {
                        const g = groupById.get(p.areaId); const n = p.conflicts.length; const newer = p.conflicts.filter(c => c.incomingNewer).length;
                        return (
                          <tr key={p.areaId} className={`border-t border-slate-100 align-top ${n > 0 ? 'bg-amber-50/60' : ''}`}>
                            <td className="p-1.5 text-center"><input type="checkbox" disabled={n === 0} checked={overwrite.has(p.areaId)} onChange={() => toggleOverwrite(p.areaId)} title={n === 0 ? 'Không có hộ trùng' : 'Ghi đè các hộ trùng của địa bàn này'} /></td>
                            <td className="p-1.5 font-mono font-bold text-[#047484]">{p.areaId}</td>
                            <td className="p-1.5">{g ? `${g.communeName} — ${g.areaName}` : <span className="text-rose-700">không có trong bảng kê</span>}</td>
                            <td className="p-1.5">{p.surveyorNames.join(', ') || '—'}</td>
                            <td className="p-1.5 text-right font-bold text-emerald-700">{p.fresh.length}</td>
                            <td className="p-1.5 text-right text-slate-500">{p.unchanged}</td>
                            <td className="p-1.5 text-right">{p.existingWithData}</td>
                            <td className="p-1.5 text-right font-bold text-amber-700" title={p.conflicts.map(c => c.name).join(', ')}>{n}{n > 0 && <span className="font-normal text-slate-500"> ({newer} file mới hơn, {n - newer} máy này mới hơn)</span>}</td>
                            <td className="p-1.5 text-rose-700">{p.rejected.map(r => <div key={r.file}>⛔ {r.file.split(/[\\/›]/).pop()?.trim()}: {r.reason}</div>)}{p.missingInRoster > 0 && <div>{p.missingInRoster} hộ không có trong bảng kê</div>}{p.invalid > 0 && <div>{p.invalid} hộ sai địa bàn (bỏ qua)</div>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {withConflicts.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-700"><b>{sumConf}</b> hộ ở <b>{withConflicts.length}</b> địa bàn đã có dữ liệu khác với file. Ghi đè:</span>
                  <button className="underline text-sky-800" onClick={() => setOverwrite(new Set(withConflicts.map(p => p.areaId)))}>tất cả</button>
                  <button className="underline text-sky-800" onClick={() => setOverwrite(new Set(withConflicts.filter(p => p.conflicts.every(c => c.incomingNewer)).map(p => p.areaId)))}>chỉ địa bàn mà file mới hơn</button>
                  <button className="underline text-slate-600" onClick={() => setOverwrite(new Set())}>không ghi đè</button>
                </div>
              )}
              <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={ignoreOwner} onChange={e => replanFolder(e.target.checked)} />Nhận cả file do người không được phân công địa bàn đó gửi (chỉ dùng khi đã phân công lại)</label>
              <div className="flex gap-2">
                <button onClick={applyFolder} disabled={busy || (sumFresh === 0 && sumOver === 0)} className={`${btn} bg-emerald-700 hover:bg-emerald-600 text-white`}><CheckCircle2 className="w-3.5 h-3.5" />Áp dụng: ghi {sumFresh} phiếu{sumOver > 0 ? ` + ghi đè ${sumOver} phiếu` : ''}{sumConf - sumOver > 0 ? `, giữ nguyên ${sumConf - sumOver} phiếu` : ''}</button>
                <button onClick={() => { setFRead(null); setFPlans([]); setOverwrite(new Set()); }} className={`${btn} bg-white border border-slate-300 text-slate-700`}>Hủy</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== SAO LƯU / KHÔI PHỤC PHIẾU TRÊN MÁY ===== */}
      <div className={card}>
        <h3 className="font-bold text-slate-800 text-sm uppercase flex items-center gap-2"><HardDrive className="w-4 h-4 text-amber-700" />{isAdmin ? '3.' : '2.'} Sao lưu / khôi phục phiếu đã nhập trên máy này</h3>
        <p className="text-xs text-slate-600">Phiếu đã nhập chỉ nằm trong trình duyệt này. Hãy sao lưu định kỳ; khi đổi máy hoặc đổi trình duyệt thì nạp lại bằng file sao lưu. (Bảng kê và phân quyền không cần sao lưu vì đã ở trên Firebase.)</p>
        <div><button onClick={exportBackup} disabled={busy || myEntries === 0} className={`${btn} bg-sky-800 hover:bg-sky-700 text-white`}><Download className="w-3.5 h-3.5" />Sao lưu toàn bộ phiếu đã nhập ({myEntries} phiếu)</button></div>
        <div className="border-t border-slate-200 pt-3 flex flex-col gap-2">
          <input ref={bkRef} type="file" accept=".zip,.json" className="hidden" onChange={e => pickBackup(e.target.files)} />
          <div><button onClick={() => bkRef.current?.click()} disabled={busy} className={`${btn} bg-emerald-700 hover:bg-emerald-600 text-white`}><Upload className="w-3.5 h-3.5" />Nạp file sao lưu…</button></div>
          {bkErr && <div className="bg-rose-50 border border-rose-200 rounded p-2 text-xs text-rose-800">{bkErr}</div>}
          {bk && bkPlan && (
            <div className="flex flex-col gap-2 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded p-2">File xuất lúc <b>{new Date(bk.exportedAt).toLocaleString('vi-VN')}</b> bởi <b>{bk.exportedBy}</b>: {bk.counts.entries} phiếu của {bk.counts.areas} địa bàn.</div>
              <label className="flex items-center gap-2"><input type="radio" checked={bkMode === 'merge'} onChange={() => changeBkMode('merge')} /><span><b>Gộp</b> vào phiếu hiện có (phiếu nào có thời điểm sửa mới hơn thì được giữ)</span></label>
              <label className="flex items-center gap-2"><input type="radio" checked={bkMode === 'replace'} onChange={() => changeBkMode('replace')} /><span><b>Thay toàn bộ</b> (xóa phiếu hiện có trên máy này, dùng khi máy mới còn trống)</span></label>
              <div className="overflow-auto border border-slate-200 rounded"><table className="w-full"><thead className="bg-slate-100"><tr><th className="p-1.5 text-right">Phiếu mới</th><th className="p-1.5 text-right">Phiếu cập nhật</th><th className="p-1.5 text-right">Không đổi</th><th className="p-1.5 text-right">Giữ bản ở máy này (mới hơn)</th><th className="p-1.5 text-right">Không có trong bảng kê</th></tr></thead>
                <tbody><tr className="border-t border-slate-100"><td className="p-1.5 text-right font-bold text-emerald-700">{bkPlan.added}</td><td className="p-1.5 text-right font-bold text-sky-700">{bkPlan.updated}</td><td className="p-1.5 text-right text-slate-500">{bkPlan.same}</td><td className="p-1.5 text-right font-bold text-amber-700">{bkPlan.keptLocalNewer}</td><td className="p-1.5 text-right text-rose-700">{bkPlan.missingInRoster}</td></tr></tbody></table></div>
              <div className="flex gap-2">
                <button onClick={applyBackup} disabled={busy} className={`${btn} bg-emerald-700 hover:bg-emerald-600 text-white`}><CheckCircle2 className="w-3.5 h-3.5" />Áp dụng</button>
                <button onClick={() => { setBk(null); setBkPlan(null); }} className={`${btn} bg-white border border-slate-300 text-slate-700`}>Hủy</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== BẢNG KÊ (bangke.json) ===== */}
      <div className={card}>
        <h3 className="font-bold text-slate-800 text-sm uppercase flex items-center gap-2"><FileText className="w-4 h-4 text-sky-800" />{isAdmin ? '4.' : '3.'} Bảng kê (file bangke.json)</h3>
        <p className="text-xs text-slate-600">Bảng kê nằm trong file <code>bangke.json</code> đi kèm ứng dụng (thư mục <code>public/</code>). File dạng gọn: khoảng <b>75 byte mỗi hộ</b> — 16.440 hộ chỉ khoảng <b>1,2 MB</b> (khi tải qua mạng được nén còn khoảng 0,15 MB). Máy nào mở ứng dụng cũng tự nhận file mới hơn.</p>
        {isAdmin && (
          <div className="flex flex-col gap-1">
            <div><button onClick={exportBangKe} disabled={busy || !fb || fb.households === 0 || fb.scope.kind !== 'all'} className={`${btn} bg-sky-800 hover:bg-sky-700 text-white`}><Download className="w-3.5 h-3.5" />Xuất file bangke.json ({fb?.households ?? 0} hộ)</button></div>
            <p className="text-xs text-slate-500">Dùng sau khi tải bảng kê Excel (hoặc sửa bảng kê) trên máy admin: xuất file, chép vào <code>public/</code> thay file cũ, chạy <code>npm run build</code> rồi đưa <code>dist/</code> lên máy chủ. Phân quyền và tiến độ không nằm trong file này.</p>
          </div>
        )}
        {bkMsg && <div className="bg-emerald-50 border border-emerald-300 rounded p-2 text-xs text-emerald-900">{bkMsg}</div>}
        <div className="border-t border-slate-200 pt-3 flex flex-col gap-1">
          <input ref={bkFileRef} type="file" accept=".json" className="hidden" onChange={e => pickBangKe(e.target.files)} />
          <div><button onClick={() => bkFileRef.current?.click()} disabled={busy} className={`${btn} bg-emerald-700 hover:bg-emerald-600 text-white`}><Upload className="w-3.5 h-3.5" />Nạp file bangke.json từ máy…</button></div>
          <p className="text-xs text-slate-500">Dùng ngay file đã chọn mà không cần build lại ứng dụng (ví dụ file admin gửi qua Zalo/USB).</p>
        </div>
      </div>

      {/* ===== ADMIN: tiến độ điều tra viên ===== */}
      {isAdmin && (
        <div className={card}>
          <h3 className="font-bold text-slate-800 text-sm uppercase flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-700" />5. Tiến độ các điều tra viên (từ Firebase)</h3>
          <p className="text-xs text-slate-600">Mỗi điều tra viên tự gửi tiến độ (số phiếu đã nhập / hoàn thành theo địa bàn) lên Firebase sau khi lưu phiếu (gộp 20 giây một lần). Bấm tải để xem; mỗi điều tra viên tốn 1 lượt đọc. Nội dung phiếu vẫn chỉ nằm ở máy điều tra viên.</p>
          <div><button onClick={loadProg} disabled={busy} className={`${btn} bg-sky-800 hover:bg-sky-700 text-white`}><RefreshCw className="w-3.5 h-3.5" />Tải tiến độ từ Firebase</button>{prog && <span className="text-xs text-slate-500 ml-2">Tải lúc {new Date(prog.at).toLocaleString('vi-VN')}</span>}</div>
          {prog && (progRows.length === 0 ? <p className="text-xs text-slate-500">Chưa có điều tra viên nào gửi tiến độ.</p> : (
            <div className="overflow-auto border border-slate-200 rounded"><table className="w-full text-xs"><thead className="bg-slate-100"><tr><th className="p-1.5 text-left">Điều tra viên</th><th className="p-1.5 text-right">Địa bàn</th><th className="p-1.5 text-right">Tổng hộ</th><th className="p-1.5 text-right">Đã nhập</th><th className="p-1.5 text-right">Hoàn thành</th><th className="p-1.5 text-right">% nhập</th><th className="p-1.5 text-left">Phiếu mới nhất</th><th className="p-1.5 text-left">Gửi lúc</th></tr></thead>
              <tbody>{progRows.map(r => (
                <tr key={r.id} className="border-t border-slate-100"><td className="p-1.5 font-bold">{r.name}</td><td className="p-1.5 text-right">{r.areas}</td><td className="p-1.5 text-right">{r.t}</td><td className="p-1.5 text-right">{r.e}</td><td className="p-1.5 text-right">{r.c}</td>
                  <td className="p-1.5 text-right font-bold text-sky-800">{r.t ? Math.round((r.e / r.t) * 100) : 0}%</td><td className="p-1.5">{r.last ? new Date(r.last).toLocaleString('vi-VN') : '—'}</td><td className="p-1.5 text-slate-500">{r.sent ? new Date(r.sent).toLocaleString('vi-VN') : '—'}</td></tr>
              ))}</tbody></table></div>
          ))}
        </div>
      )}

      {/* ===== ADMIN: kiểm tra địa bàn thừa / thiếu ===== */}
      {isAdmin && (
        <div className={card}>
          <h3 className="font-bold text-slate-800 text-sm uppercase flex items-center gap-2"><SearchCheck className="w-4 h-4 text-emerald-700" />6. Kiểm tra địa bàn thừa / thiếu</h3>
          {!checks ? <p className="text-xs text-slate-500">Chưa có dữ liệu để kiểm tra (cần đăng nhập admin và đã có bảng kê).</p> : (
            <div className="flex flex-col gap-3 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded p-2">Danh mục có <b>{checks.totalAreas}</b> địa bàn; <b>{checks.withHh}</b> địa bàn có hộ trong bảng kê.</div>
              {chkMsg && <div className="bg-emerald-50 border border-emerald-300 rounded p-2 text-emerald-900">{chkMsg}</div>}
              <div>
                <b className={checks.empty.length ? 'text-amber-700' : 'text-emerald-700'}>{checks.empty.length ? `⚠ ${checks.empty.length} địa bàn không có hộ nào` : '✓ Không có địa bàn trống'}</b>
                {checks.empty.length > 0 && (
                  <>
                    <span className="text-slate-500"> (thuộc các xã đã có bảng kê — thường là địa bàn sót lại do tải nhầm/tải lại)</span>
                    <div className="overflow-auto border border-slate-200 rounded mt-1 max-h-56"><table className="w-full"><thead className="bg-slate-100"><tr><th className="p-1.5 w-8" /><th className="p-1.5 text-left">ID địa bàn</th><th className="p-1.5 text-left">Xã</th><th className="p-1.5 text-left">Tên</th><th className="p-1.5 text-left">Mã nội bộ</th></tr></thead>
                      <tbody>{checks.empty.map(({ a, key, commune }) => (
                        <tr key={a.id} className="border-t border-slate-100"><td className="p-1.5 text-center"><input type="checkbox" checked={delSel.has(a.id)} onChange={() => toggleDel(a.id)} /></td><td className="p-1.5 font-mono font-bold text-[#047484]">{key}</td><td className="p-1.5">{commune}</td><td className="p-1.5">{a.name}</td><td className="p-1.5 font-mono text-slate-500">{a.id}</td></tr>
                      ))}</tbody></table></div>
                    <div className="flex gap-2 mt-1">
                      <button onClick={() => setDelSel(new Set(checks.empty.map(e => e.a.id)))} className="underline text-sky-800 cursor-pointer">Chọn tất cả</button>
                      <button onClick={deleteAreas} disabled={busy || delSel.size === 0} className={`${btn} bg-rose-600 hover:bg-rose-500 text-white`}><Trash2 className="w-3.5 h-3.5" />Xóa {delSel.size} địa bàn đã chọn</button>
                    </div>
                  </>
                )}
              </div>
              <div>
                <b className={checks.dups.length ? 'text-amber-700' : 'text-emerald-700'}>{checks.dups.length ? `⚠ ${checks.dups.length} ID địa bàn bị trùng` : '✓ Không có ID địa bàn trùng'}</b>
                {checks.dups.map(d => <div key={d.key} className="mt-1 border border-amber-200 rounded p-2 bg-amber-50">ID <b className="font-mono">{d.key}</b>: {d.list.map(x => `${x.a.name} [${x.a.id}] — ${x.n} hộ`).join('  |  ')}</div>)}
              </div>
              <div>
                <b className={checks.missing.length ? 'text-rose-700' : 'text-emerald-700'}>{checks.missing.length ? `⛔ ${checks.missing.length} địa bàn có hộ nhưng KHÔNG có trong danh mục` : '✓ Mọi hộ đều thuộc một địa bàn có trong danh mục'}</b>
                {checks.missing.length > 0 && (
                  <div className="mt-1">{checks.missing.map(u => <div key={u.id}>{u.communeName} — {u.name} ({u.n} hộ) <span className="font-mono text-slate-500">{u.id}</span></div>)}
                    <button onClick={createMissing} disabled={busy} className={`${btn} bg-amber-600 hover:bg-amber-500 text-white mt-1`}>Tạo các địa bàn còn thiếu vào danh mục</button></div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== ADMIN: chuyển dữ liệu từ bản cũ ===== */}
      {isAdmin && (
        <div className={card}>
          <h3 className="font-bold text-slate-800 text-sm uppercase flex items-center gap-2"><DatabaseZap className="w-4 h-4 text-amber-700" />7. Chuyển dữ liệu từ bản cũ (làm một lần)</h3>
          <p className="text-xs text-slate-600">Nếu trước đây bảng kê nằm trong trình duyệt (bản trước) hoặc trong collection <code>households</code> trên Firestore, dùng một trong hai nút dưới để chuyển sang cách lưu mới: bảng kê và phiếu ở lại máy này, phân quyền gửi lên Firebase (1 tài liệu). Sau đó xuất bangke.json để cả nhóm dùng chung.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => runMig('local')} disabled={busy} className={`${btn} bg-amber-600 hover:bg-amber-500 text-white`}><DatabaseZap className="w-3.5 h-3.5" />Từ trình duyệt này (bản trước)</button>
            <button onClick={() => runMig('firestore')} disabled={busy} className={`${btn} bg-white border border-amber-500 text-amber-800`}>Từ Firestore cũ (collection households)</button>
          </div>
          {migMsg && <div className="text-xs text-slate-700">{migMsg}</div>}
        </div>
      )}
    </div>
  );
}
