/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Plus, Trash2, Users, Briefcase, Award, ShieldCheck, CheckSquare, Calendar, UserCheck } from 'lucide-react';
import { LaborQuestionnaire, LaborMemberRow } from '../../types/questionnaire';

interface LaborQuestionnaireViewProps {
  laborForm: LaborQuestionnaire;
  setLaborForm: React.Dispatch<React.SetStateAction<LaborQuestionnaire>>;
  membersCount: number | string;
  workingMembersCount: number | string;
  householdHead: string;
  isLocked: boolean;
}

export const LaborQuestionnaireView: React.FC<LaborQuestionnaireViewProps> = ({
  laborForm,
  setLaborForm,
  membersCount,
  workingMembersCount,
  householdHead,
  isLocked
}) => {
  const members = laborForm.members || [];

  const handleAddMember = () => {
    if (isLocked) return;
    const newStt = members.length + 1;
    const newMember: LaborMemberRow = {
      id: `mem_${Date.now()}_${newStt}`,
      stt: newStt,
      fullName: '',
      relationWithHead: newStt === 1 ? 'Chủ hộ' : 'Con',
      gender: 'Nam',
      birthYear: 1995,
      educationLevel: 'THPT',
      technicalQualification: 'Chưa qua đào tạo',
      employmentStatus: 'Có việc làm',
      mainJob: 'Lao động tự do',
      workplaceSector: 'Nông lâm thủy sản',
      hasLaborContract: false,
      hasSocialInsurance: false,
      monthlyIncomeEst: 5000
    };
    setLaborForm(prev => ({
      ...prev,
      members: [...prev.members, newMember]
    }));
  };

  const handleRemoveMember = (id: string) => {
    if (isLocked) return;
    setLaborForm(prev => {
      const filtered = prev.members.filter(m => m.id !== id);
      const reIndexed = filtered.map((m, idx) => ({ ...m, stt: idx + 1 }));
      return { ...prev, members: reIndexed };
    });
  };

  const handleUpdateMember = (id: string, field: keyof LaborMemberRow, value: any) => {
    if (isLocked) return;
    setLaborForm(prev => ({
      ...prev,
      members: prev.members.map(m => m.id === id ? { ...m, [field]: value } : m)
    }));
  };

  const handleSyncFromMembersCount = () => {
    if (isLocked) return;
    const targetCount = Number(membersCount);
    if (!targetCount || targetCount <= 0) return;

    if (members.length >= targetCount) return;

    const newMembers = [...members];
    for (let i = members.length; i < targetCount; i++) {
      const stt = i + 1;
      newMembers.push({
        id: `mem_${Date.now()}_${stt}`,
        stt,
        fullName: stt === 1 ? (householdHead || 'Chủ hộ') : `Thành viên ${stt}`,
        relationWithHead: stt === 1 ? 'Chủ hộ' : stt === 2 ? 'Vợ/Chồng' : 'Con',
        gender: stt % 2 === 1 ? 'Nam' : 'Nữ',
        birthYear: 1980 + (i * 3),
        educationLevel: 'THPT',
        technicalQualification: 'Chưa qua đào tạo',
        employmentStatus: 'Có việc làm',
        mainJob: 'Lao động tự do',
        workplaceSector: 'Nông lâm thủy sản',
        hasLaborContract: false,
        hasSocialInsurance: false,
        monthlyIncomeEst: 5000
      });
    }

    setLaborForm(prev => ({ ...prev, members: newMembers }));
  };

  const employedCount = members.filter(m => m.employmentStatus === 'Có việc làm').length;
  const insuredCount = members.filter(m => m.hasSocialInsurance).length;
  const trainedCount = members.filter(m => m.technicalQualification && m.technicalQualification !== 'Chưa qua đào tạo').length;
  const totalMonthlyIncome = members.reduce((sum, m) => sum + (Number(m.monthlyIncomeEst) || 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Overview stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <div className="bg-white border border-sky-200 rounded-lg p-2.5 shadow-2xs">
          <span className="text-[10px] text-slate-500 font-bold block uppercase flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-sky-600" />
            Nhân khẩu hộ
          </span>
          <strong className="text-base text-sky-950 block mt-0.5">
            {membersCount ? `${membersCount} người` : `${members.length} người`}
          </strong>
        </div>

        <div className="bg-white border border-emerald-200 rounded-lg p-2.5 shadow-2xs">
          <span className="text-[10px] text-slate-500 font-bold block uppercase flex items-center gap-1">
            <Briefcase className="w-3.5 h-3.5 text-emerald-600" />
            Có việc làm
          </span>
          <strong className="text-base text-emerald-800 block mt-0.5">
            {employedCount} người
          </strong>
        </div>

        <div className="bg-white border border-indigo-200 rounded-lg p-2.5 shadow-2xs">
          <span className="text-[10px] text-slate-500 font-bold block uppercase flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
            Có BHXH
          </span>
          <strong className="text-base text-indigo-800 block mt-0.5">
            {insuredCount} người
          </strong>
        </div>

        <div className="bg-white border border-amber-200 rounded-lg p-2.5 shadow-2xs">
          <span className="text-[10px] text-slate-500 font-bold block uppercase flex items-center gap-1">
            <Award className="w-3.5 h-3.5 text-amber-600" />
            Qua đào tạo
          </span>
          <strong className="text-base text-amber-800 block mt-0.5">
            {trainedCount} người
          </strong>
        </div>

        <div className="bg-emerald-900 text-white rounded-lg p-2.5 shadow-2xs text-right col-span-2 sm:col-span-1">
          <span className="text-[10px] text-emerald-200 font-bold block uppercase">
            Tổng thu việc làm / tháng
          </span>
          <strong className="text-base text-amber-300 block mt-0.5">
            {totalMonthlyIncome.toLocaleString()} (1.000 đ)
          </strong>
        </div>
      </div>

      {/* Main Table section */}
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xs overflow-hidden">
        <div className="p-3 bg-sky-900 text-white flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="font-extrabold text-xs uppercase tracking-wide flex items-center gap-1.5">
              <span>Biểu danh sách thành viên trong độ tuổi lao động của hộ</span>
              <span className="text-[10px] bg-sky-700 text-sky-100 px-2 py-0.5 rounded font-normal">
                {members.length} thành viên
              </span>
            </h4>
          </div>

          <div className="flex items-center gap-2">
            {Number(membersCount) > members.length && (
              <button
                type="button"
                disabled={isLocked}
                onClick={handleSyncFromMembersCount}
                className="px-2.5 py-1 bg-sky-700 hover:bg-sky-600 text-white font-bold rounded text-[11px] cursor-pointer"
                title="Tự động điền danh sách dòng đủ theo tổng số nhân khẩu của hộ"
              >
                + Khởi tạo đủ {membersCount} nhân khẩu
              </button>
            )}

            <button
              type="button"
              disabled={isLocked}
              onClick={handleAddMember}
              className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded text-[11px] flex items-center gap-1 cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm thành viên</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 border-b border-slate-300 font-bold text-[11px]">
                <th className="p-2 border-r border-slate-300 text-center w-10">STT</th>
                <th className="p-2 border-r border-slate-300 min-w-[140px]">Họ và tên</th>
                <th className="p-2 border-r border-slate-300 min-w-[110px]">Quan hệ với chủ hộ</th>
                <th className="p-2 border-r border-slate-300 text-center w-20">Giới tính</th>
                <th className="p-2 border-r border-slate-300 text-center w-20">Năm sinh</th>
                <th className="p-2 border-r border-slate-300 min-w-[100px]">Học vấn</th>
                <th className="p-2 border-r border-slate-300 min-w-[120px]">Trình độ CMKT</th>
                <th className="p-2 border-r border-slate-300 min-w-[120px]">Tình trạng việc làm</th>
                <th className="p-2 border-r border-slate-300 min-w-[140px]">Nghề nghiệp chính</th>
                <th className="p-2 border-r border-slate-300 min-w-[120px]">Khu vực kinh tế</th>
                <th className="p-2 border-r border-slate-300 text-center w-16" title="Có hợp đồng lao động">HĐLĐ</th>
                <th className="p-2 border-r border-slate-300 text-center w-16" title="Có tham gia BHXH bắt buộc hoặc tự nguyện">BHXH</th>
                <th className="p-2 border-r border-slate-300 text-right min-w-[100px]">Thu nhập/tháng (1.000 đ)</th>
                <th className="p-2 text-center w-12">Xóa</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={14} className="text-center p-6 text-slate-500 italic">
                    Chưa có nhân khẩu nào được nhập. Bấm "Thêm thành viên" hoặc "Khởi tạo đủ nhân khẩu" để bắt đầu.
                  </td>
                </tr>
              ) : (
                members.map((m, idx) => (
                  <tr key={m.id} className="border-b border-slate-200 hover:bg-sky-50/50">
                    <td className="p-2 border-r border-slate-200 text-center font-bold text-slate-600">
                      {idx + 1}
                    </td>

                    {/* Họ và tên */}
                    <td className="p-1.5 border-r border-slate-200">
                      <input 
                        type="text"
                        disabled={isLocked}
                        value={m.fullName}
                        onChange={e => handleUpdateMember(m.id, 'fullName', e.target.value)}
                        placeholder="Họ và tên..."
                        className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-semibold focus:border-sky-500 focus:outline-none"
                      />
                    </td>

                    {/* Quan hệ với chủ hộ */}
                    <td className="p-1.5 border-r border-slate-200">
                      <select
                        disabled={isLocked}
                        value={m.relationWithHead}
                        onChange={e => handleUpdateMember(m.id, 'relationWithHead', e.target.value)}
                        className="w-full border border-slate-300 rounded px-1.5 py-1 text-xs focus:border-sky-500 focus:outline-none font-medium"
                      >
                        <option value="Chủ hộ">Chủ hộ</option>
                        <option value="Vợ/Chồng">Vợ/Chồng</option>
                        <option value="Con">Con</option>
                        <option value="Bố/Mẹ">Bố/Mẹ</option>
                        <option value="Ông/Bà">Ông/Bà</option>
                        <option value="Cháu">Cháu</option>
                        <option value="Anh/Chị/Em">Anh/Chị/Em</option>
                        <option value="Khác">Khác</option>
                      </select>
                    </td>

                    {/* Giới tính */}
                    <td className="p-1.5 border-r border-slate-200 text-center">
                      <select
                        disabled={isLocked}
                        value={m.gender}
                        onChange={e => handleUpdateMember(m.id, 'gender', e.target.value as any)}
                        className="w-full border border-slate-300 rounded px-1 py-1 text-xs text-center focus:border-sky-500 focus:outline-none"
                      >
                        <option value="Nam">Nam</option>
                        <option value="Nữ">Nữ</option>
                      </select>
                    </td>

                    {/* Năm sinh */}
                    <td className="p-1.5 border-r border-slate-200">
                      <input 
                        type="number"
                        disabled={isLocked}
                        value={m.birthYear}
                        onChange={e => handleUpdateMember(m.id, 'birthYear', e.target.value ? parseInt(e.target.value, 10) : '')}
                        className="w-full border border-slate-300 rounded px-1 py-1 text-xs text-center font-bold"
                        min="1920"
                        max="2025"
                      />
                    </td>

                    {/* Học vấn phổ thông */}
                    <td className="p-1.5 border-r border-slate-200">
                      <select
                        disabled={isLocked}
                        value={m.educationLevel}
                        onChange={e => handleUpdateMember(m.id, 'educationLevel', e.target.value)}
                        className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
                      >
                        <option value="Chưa đi học">Chưa đi học</option>
                        <option value="Tiểu học">Tiểu học</option>
                        <option value="THCS">THCS</option>
                        <option value="THPT">THPT</option>
                      </select>
                    </td>

                    {/* Trình độ CMKT */}
                    <td className="p-1.5 border-r border-slate-200">
                      <select
                        disabled={isLocked}
                        value={m.technicalQualification}
                        onChange={e => handleUpdateMember(m.id, 'technicalQualification', e.target.value)}
                        className="w-full border border-slate-300 rounded px-1 py-1 text-xs font-medium"
                      >
                        <option value="Chưa qua đào tạo">Chưa qua đào tạo</option>
                        <option value="Sơ cấp">Sơ cấp nghề</option>
                        <option value="Trung cấp">Trung cấp</option>
                        <option value="Cao đẳng">Cao đẳng</option>
                        <option value="Đại học">Đại học</option>
                        <option value="Sau đại học">Sau đại học</option>
                      </select>
                    </td>

                    {/* Tình trạng việc làm */}
                    <td className="p-1.5 border-r border-slate-200">
                      <select
                        disabled={isLocked}
                        value={m.employmentStatus}
                        onChange={e => handleUpdateMember(m.id, 'employmentStatus', e.target.value as any)}
                        className={`w-full border rounded px-1 py-1 text-xs font-bold ${
                          m.employmentStatus === 'Có việc làm' 
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900' 
                            : m.employmentStatus === 'Thất nghiệp'
                            ? 'border-rose-300 bg-rose-50 text-rose-900'
                            : 'border-slate-300 text-slate-800'
                        }`}
                      >
                        <option value="Có việc làm">Có việc làm</option>
                        <option value="Thất nghiệp">Thất nghiệp</option>
                        <option value="Nội trợ">Nội trợ</option>
                        <option value="Hưu trí/Mất sức">Hưu trí/Mất sức</option>
                        <option value="Đang đi học">Đang đi học</option>
                      </select>
                    </td>

                    {/* Nghề nghiệp chính */}
                    <td className="p-1.5 border-r border-slate-200">
                      <input 
                        type="text"
                        disabled={isLocked}
                        value={m.mainJob}
                        onChange={e => handleUpdateMember(m.id, 'mainJob', e.target.value)}
                        placeholder="Nghề nghiệp chính..."
                        className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                      />
                    </td>

                    {/* Khu vực kinh tế */}
                    <td className="p-1.5 border-r border-slate-200">
                      <select
                        disabled={isLocked}
                        value={m.workplaceSector}
                        onChange={e => handleUpdateMember(m.id, 'workplaceSector', e.target.value)}
                        className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
                      >
                        <option value="Nông lâm thủy sản">Nông lâm thủy sản</option>
                        <option value="CN - Xây dựng">CN - Xây dựng</option>
                        <option value="TMDV - Vận tải">TMDV - Vận tải</option>
                        <option value="Nhà nước/Hành chính">Nhà nước/Hành chính</option>
                      </select>
                    </td>

                    {/* HĐLĐ */}
                    <td className="p-1.5 border-r border-slate-200 text-center">
                      <input 
                        type="checkbox"
                        disabled={isLocked}
                        checked={Boolean(m.hasLaborContract)}
                        onChange={e => handleUpdateMember(m.id, 'hasLaborContract', e.target.checked)}
                        className="w-4 h-4 text-sky-600 rounded cursor-pointer"
                      />
                    </td>

                    {/* BHXH */}
                    <td className="p-1.5 border-r border-slate-200 text-center">
                      <input 
                        type="checkbox"
                        disabled={isLocked}
                        checked={Boolean(m.hasSocialInsurance)}
                        onChange={e => handleUpdateMember(m.id, 'hasSocialInsurance', e.target.checked)}
                        className="w-4 h-4 text-emerald-600 rounded cursor-pointer"
                      />
                    </td>

                    {/* Thu nhập tháng */}
                    <td className="p-1.5 border-r border-slate-200">
                      <input 
                        type="number"
                        disabled={isLocked}
                        value={m.monthlyIncomeEst || ''}
                        onChange={e => handleUpdateMember(m.id, 'monthlyIncomeEst', e.target.value ? parseFloat(e.target.value) : 0)}
                        placeholder="0"
                        className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-bold text-right text-emerald-900"
                        min="0"
                      />
                    </td>

                    {/* Xóa */}
                    <td className="p-1.5 text-center">
                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => handleRemoveMember(m.id)}
                        className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded cursor-pointer disabled:opacity-30"
                        title="Xóa thành viên này"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {members.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                  <td colSpan={10} className="p-2 text-right uppercase text-[11px] text-slate-700">
                    Tổng số người có việc làm: <span className="text-emerald-700 font-black">{employedCount}</span> | Số người có BHXH: <span className="text-indigo-700 font-black">{insuredCount}</span>
                  </td>
                  <td colSpan={2} className="p-2 text-right uppercase text-[11px] text-slate-700">
                    Tổng thu/tháng:
                  </td>
                  <td className="p-2 text-right font-black text-emerald-900 text-sm">
                    {totalMonthlyIncome.toLocaleString()}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Ghi chú và chữ ký ĐTV */}
      <div className="bg-white rounded-lg border border-slate-300 p-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="w-full sm:w-1/2">
          <label className="text-[11px] text-slate-600 font-bold block mb-1">Ghi chú về lao động - việc làm của hộ:</label>
          <input
            type="text"
            disabled={isLocked}
            value={laborForm.note || ''}
            onChange={e => setLaborForm(prev => ({ ...prev, note: e.target.value }))}
            placeholder="Ghi chú về việc làm thời vụ, tìm việc, đào tạo nghề..."
            className="w-full border border-slate-300 rounded p-1.5 text-xs"
          />
        </div>

        <div className="flex items-center gap-3 self-end">
          <div>
            <span className="text-[10px] text-slate-500 block">Ngày khảo sát:</span>
            <input 
              type="text" 
              disabled={isLocked}
              value={laborForm.surveyDate || ''} 
              onChange={e => setLaborForm(prev => ({ ...prev, surveyDate: e.target.value }))}
              className="border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-center w-28" 
            />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block">Điều tra viên:</span>
            <input 
              type="text" 
              disabled={isLocked}
              placeholder="Họ tên ĐTV..." 
              value={laborForm.surveyorName || ''} 
              onChange={e => setLaborForm(prev => ({ ...prev, surveyorName: e.target.value }))}
              className="border border-slate-300 rounded px-2 py-1 text-xs font-bold text-center w-40"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
