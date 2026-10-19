import React, { useMemo, useRef, useState } from 'react';
import { Download, Upload, DatabaseZap, FileJson, ShieldAlert, CheckCircle2, Loader2, Cloud, HardDrive } from 'lucide-react';
import type { Household, SurveyArea, Commune } from '../App';
import type { Surveyor } from '../types/user';
import {
  AreaGroup, AreaImportPlan, ReadResult, applyFolderPlan, buildAreaGroups, exportResultAndMark, groupsOfSurveyor, hasEnteredData, planFolderImport, readPackageFiles,
} from '../utils/areaSync';
import { isLocalStoreBroken, migrateFromLegacyFirestore, migrateFromLegacyLocal } from '../utils/dataStore';
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

export default function DataSyncPanel({ currentUser, households, areas, communes, showNotification }: Props) {
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

  /* ---------------- ADMIN: chuyển dữ liệu từ bản cũ ---------------- */
  const [migMsg, setMigMsg] = useState('');
  const runMig = async (kind: 'local' | 'firestore') => {
    const q = kind === 'local'
      ? 'Đẩy bảng kê (xã, địa bàn, hộ) đang lưu trong trình duyệt này (bản trước) lên Firebase? Phiếu đã nhập vẫn ở lại máy. Dữ liệu trùng ID trên Firebase sẽ bị ghi đè.'
      : "Đọc collection 'households' cũ trên Firestore, tách thành bảng kê theo địa bàn (Firebase) và phiếu nhập (trình duyệt này)? Dữ liệu trùng sẽ bị ghi đè.";
    if (!window.confirm(q)) return;
    setBusy(true); setMigMsg('');
    try {
      if (kind === 'local') {
        const r = await migrateFromLegacyLocal(setMigMsg);
        setMigMsg(r.found ? `Xong: ${r.households} hộ → ${r.areasDocs} tài liệu địa bàn, ${r.communes} xã, ${r.surveyAreas} địa bàn đã lên Firebase.` : 'Không tìm thấy dữ liệu bảng kê của bản trước trong trình duyệt này.');
      } else {
        const r = await migrateFromLegacyFirestore(setMigMsg);
        setMigMsg(r.found ? `Xong: ${r.households} hộ → ${r.areasDocs} tài liệu địa bàn.` : "Collection 'households' cũ trên Firestore đang trống.");
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
        <div className="bg-sky-50 border border-sky-300 text-sky-900 rounded p-3 flex gap-2"><Cloud className="w-4 h-4 shrink-0 mt-0.5" /><span><b>Trên Firebase:</b> tài khoản, bảng kê, địa bàn và phân quyền. Mở trên máy nào, đăng nhập là thấy ngay (điều tra viên chỉ thấy địa bàn của mình).</span></div>
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded p-3 flex gap-2"><HardDrive className="w-4 h-4 shrink-0 mt-0.5" /><span><b>Trong trình duyệt này:</b> nội dung các phiếu đã nhập ({myEntries} phiếu). Xóa dữ liệu trình duyệt hoặc đổi máy sẽ mất phiếu chưa xuất. Làm xong mỗi địa bàn hãy bấm xuất file và giữ lại.</span></div>
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
          <h3 className="font-bold text-slate-800 text-sm uppercase flex items-center gap-2"><Upload className="w-4 h-4 text-emerald-700" />2. Nhập phiếu của các user nhập tin (cả thư mục)</h3>
          <p className="text-xs text-slate-600">Gom file của mọi use nhập tin (.json hoặc .zip) vào <b>một thư mục</b> rồi bấm “Chọn thư mục”. Hệ thống đọc hết các file trong thư mục (kể cả thư mục con), gộp theo ID địa bàn, <b>địa bàn nào chưa có dữ liệu thì ghi luôn</b>; hộ nào máy này đã có dữ liệu khác thì <b>hỏi có ghi đè không</b> (mặc định không ghi đè). Phiếu được ghi vào trình duyệt của admin; bảng kê trên Firebase không bị đụng tới.</p>
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

      {/* ===== ADMIN: chuyển dữ liệu từ bản cũ ===== */}
      {isAdmin && (
        <div className={card}>
          <h3 className="font-bold text-slate-800 text-sm uppercase flex items-center gap-2"><DatabaseZap className="w-4 h-4 text-amber-700" />4. Chuyển dữ liệu từ bản cũ lên Firebase (làm một lần)</h3>
          <p className="text-xs text-slate-600">Nếu trước đây bảng kê nằm trong trình duyệt (bản trước) hoặc nằm trong collection <code>households</code> trên Firestore, dùng một trong hai nút dưới để chuyển sang cách lưu mới: bảng kê và phân quyền lên Firebase theo từng địa bàn, phiếu đã nhập ở lại trình duyệt này.</p>
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
