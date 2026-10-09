/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { QuickIncomeQuestionnaire } from '../../types/questionnaire';
import { Calculator, DollarSign, TrendingUp, Users, CheckCircle2 } from 'lucide-react';

interface QuickIncomeQuestionnaireViewProps {
  quickIncomeForm: QuickIncomeQuestionnaire;
  setQuickIncomeForm: React.Dispatch<React.SetStateAction<QuickIncomeQuestionnaire>>;
  membersCount: number | string;
  isLocked: boolean;
}

export const QuickIncomeQuestionnaireView: React.FC<QuickIncomeQuestionnaireViewProps> = ({
  quickIncomeForm,
  setQuickIncomeForm,
  membersCount,
  isLocked
}) => {
  // Tính toán thu nhập ròng cho từng nhóm
  const netNLTS = Math.max(0, (Number(quickIncomeForm.nongLamThuySanRevenue) || 0) - (Number(quickIncomeForm.nongLamThuySanCost) || 0));
  const netCNXD = Math.max(0, (Number(quickIncomeForm.congNghiepXayDungRevenue) || 0) - (Number(quickIncomeForm.congNghiepXayDungCost) || 0));
  const netTMDV = Math.max(0, (Number(quickIncomeForm.thuongMaiDichVuRevenue) || 0) - (Number(quickIncomeForm.thuongMaiDichVuCost) || 0));
  const netLuong = Number(quickIncomeForm.luongVaThuKhacRevenue) || 0;

  const totalNet = netNLTS + netCNXD + netTMDV + netLuong;
  const memCountNum = Number(membersCount) || 1;
  const perCapitaPerMonth = memCountNum > 0 ? Math.round(totalNet / memCountNum / 12) : 0;

  const updateField = (field: keyof QuickIncomeQuestionnaire, value: number | string) => {
    if (isLocked) return;
    setQuickIncomeForm(prev => {
      const next = { ...prev, [field]: value };
      const n1 = Math.max(0, (Number(field === 'nongLamThuySanRevenue' ? value : next.nongLamThuySanRevenue) || 0) - (Number(field === 'nongLamThuySanCost' ? value : next.nongLamThuySanCost) || 0));
      const n2 = Math.max(0, (Number(field === 'congNghiepXayDungRevenue' ? value : next.congNghiepXayDungRevenue) || 0) - (Number(field === 'congNghiepXayDungCost' ? value : next.congNghiepXayDungCost) || 0));
      const n3 = Math.max(0, (Number(field === 'thuongMaiDichVuRevenue' ? value : next.thuongMaiDichVuRevenue) || 0) - (Number(field === 'thuongMaiDichVuCost' ? value : next.thuongMaiDichVuCost) || 0));
      const n4 = Number(field === 'luongVaThuKhacRevenue' ? value : next.luongVaThuKhacRevenue) || 0;
      next.totalNetIncome = n1 + n2 + n3 + n4;
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Banner giới thiệu mẫu rút gọn */}
      <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs">
        <div>
          <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wide block">
            Phiếu 04/RG: Biểu mẫu kê khai Thu nhập nhanh (Mẫu rút gọn)
          </span>
          <p className="text-xs text-slate-600 mt-0.5">
            Dành cho hộ gia đình kê khai tổng hợp theo 4 nhóm ngành kinh tế chính mà không cần kê chi tiết từng sản phẩm.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-white p-2 rounded-lg border border-emerald-200 text-right">
            <span className="text-[10px] text-slate-500 font-bold block uppercase">Tổng thu nhập hộ:</span>
            <strong className="text-base font-black text-emerald-900">{totalNet.toLocaleString()} (1.000 đ)</strong>
          </div>
          <div className="bg-emerald-800 text-white p-2 rounded-lg text-right">
            <span className="text-[10px] text-emerald-200 font-bold block uppercase">TNBQ 1 người/tháng:</span>
            <strong className="text-base font-black text-amber-300">
              {perCapitaPerMonth > 0 ? `${perCapitaPerMonth.toLocaleString()} đ/người/tháng` : 'Chờ nhân khẩu'}
            </strong>
          </div>
        </div>
      </div>

      {/* Bảng nhập 4 nhóm lĩnh vực kinh tế */}
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xs overflow-hidden">
        <div className="p-3 bg-slate-800 text-white font-extrabold text-xs uppercase flex items-center justify-between">
          <span>Kê khai Doanh thu & Chi phí 4 lĩnh vực kinh tế của hộ (Đơn vị tính: 1.000 đồng)</span>
          <span className="text-[11px] text-amber-300 font-bold">Thu nhập ròng = Doanh thu - Chi phí</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 border-b border-slate-300 font-bold">
                <th className="p-2.5 border-r border-slate-300 text-center w-12">STT</th>
                <th className="p-2.5 border-r border-slate-300 min-w-[220px]">Lĩnh vực hoạt động kinh tế</th>
                <th className="p-2.5 border-r border-slate-300 text-right min-w-[140px]">
                  Tổng Thu / Doanh thu bán ra (1)
                </th>
                <th className="p-2.5 border-r border-slate-300 text-right min-w-[140px]">
                  Tổng Chi phí sản xuất (2)
                </th>
                <th className="p-2.5 text-right min-w-[150px] bg-emerald-50 text-emerald-950 font-black">
                  Thu nhập ròng (3 = 1 - 2)
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Nhóm 1: NLTS */}
              <tr className="border-b border-slate-200 hover:bg-slate-50">
                <td className="p-2.5 border-r border-slate-200 text-center font-bold text-slate-600">1</td>
                <td className="p-2.5 border-r border-slate-200">
                  <strong className="text-slate-900 block font-bold">Nông nghiệp, Lâm nghiệp và Thủy sản</strong>
                  <span className="text-[11px] text-slate-500 block">Trồng trọt, chăn nuôi, nuôi trồng & đánh bắt thủy hải sản, lâm nghiệp</span>
                </td>
                <td className="p-2 border-r border-slate-200">
                  <input
                    type="number"
                    disabled={isLocked}
                    value={quickIncomeForm.nongLamThuySanRevenue || ''}
                    onChange={e => updateField('nongLamThuySanRevenue', e.target.value ? parseFloat(e.target.value) : 0)}
                    placeholder="0"
                    className="w-full border border-slate-300 rounded p-1.5 text-xs text-right font-bold focus:border-sky-500"
                    min="0"
                  />
                </td>
                <td className="p-2 border-r border-slate-200">
                  <input
                    type="number"
                    disabled={isLocked}
                    value={quickIncomeForm.nongLamThuySanCost || ''}
                    onChange={e => updateField('nongLamThuySanCost', e.target.value ? parseFloat(e.target.value) : 0)}
                    placeholder="0"
                    className="w-full border border-slate-300 rounded p-1.5 text-xs text-right font-bold focus:border-sky-500"
                    min="0"
                  />
                </td>
                <td className="p-2.5 text-right font-black text-emerald-900 text-sm bg-emerald-50/50">
                  {netNLTS.toLocaleString()}
                </td>
              </tr>

              {/* Nhóm 2: CNXD */}
              <tr className="border-b border-slate-200 hover:bg-slate-50">
                <td className="p-2.5 border-r border-slate-200 text-center font-bold text-slate-600">2</td>
                <td className="p-2.5 border-r border-slate-200">
                  <strong className="text-slate-900 block font-bold">Công nghiệp, Tiểu thủ công nghiệp & Xây dựng</strong>
                  <span className="text-[11px] text-slate-500 block">Chế biến nông sản, mộc, may mặc, gò hàn, thợ hồ, thi công xây dựng</span>
                </td>
                <td className="p-2 border-r border-slate-200">
                  <input
                    type="number"
                    disabled={isLocked}
                    value={quickIncomeForm.congNghiepXayDungRevenue || ''}
                    onChange={e => updateField('congNghiepXayDungRevenue', e.target.value ? parseFloat(e.target.value) : 0)}
                    placeholder="0"
                    className="w-full border border-slate-300 rounded p-1.5 text-xs text-right font-bold focus:border-sky-500"
                    min="0"
                  />
                </td>
                <td className="p-2 border-r border-slate-200">
                  <input
                    type="number"
                    disabled={isLocked}
                    value={quickIncomeForm.congNghiepXayDungCost || ''}
                    onChange={e => updateField('congNghiepXayDungCost', e.target.value ? parseFloat(e.target.value) : 0)}
                    placeholder="0"
                    className="w-full border border-slate-300 rounded p-1.5 text-xs text-right font-bold focus:border-sky-500"
                    min="0"
                  />
                </td>
                <td className="p-2.5 text-right font-black text-emerald-900 text-sm bg-emerald-50/50">
                  {netCNXD.toLocaleString()}
                </td>
              </tr>

              {/* Nhóm 3: TMDV */}
              <tr className="border-b border-slate-200 hover:bg-slate-50">
                <td className="p-2.5 border-r border-slate-200 text-center font-bold text-slate-600">3</td>
                <td className="p-2.5 border-r border-slate-200">
                  <strong className="text-slate-900 block font-bold">Thương mại, Dịch vụ & Du lịch</strong>
                  <span className="text-[11px] text-slate-500 block">Tạp hóa, ăn uống, vận tải, sửa chữa xe máy, cho thuê máy móc</span>
                </td>
                <td className="p-2 border-r border-slate-200">
                  <input
                    type="number"
                    disabled={isLocked}
                    value={quickIncomeForm.thuongMaiDichVuRevenue || ''}
                    onChange={e => updateField('thuongMaiDichVuRevenue', e.target.value ? parseFloat(e.target.value) : 0)}
                    placeholder="0"
                    className="w-full border border-slate-300 rounded p-1.5 text-xs text-right font-bold focus:border-sky-500"
                    min="0"
                  />
                </td>
                <td className="p-2 border-r border-slate-200">
                  <input
                    type="number"
                    disabled={isLocked}
                    value={quickIncomeForm.thuongMaiDichVuCost || ''}
                    onChange={e => updateField('thuongMaiDichVuCost', e.target.value ? parseFloat(e.target.value) : 0)}
                    placeholder="0"
                    className="w-full border border-slate-300 rounded p-1.5 text-xs text-right font-bold focus:border-sky-500"
                    min="0"
                  />
                </td>
                <td className="p-2.5 text-right font-black text-emerald-900 text-sm bg-emerald-50/50">
                  {netTMDV.toLocaleString()}
                </td>
              </tr>

              {/* Nhóm 4: Lương & Thu khác */}
              <tr className="border-b border-slate-200 hover:bg-slate-50">
                <td className="p-2.5 border-r border-slate-200 text-center font-bold text-slate-600">4</td>
                <td className="p-2.5 border-r border-slate-200">
                  <strong className="text-slate-900 block font-bold">Tiền lương, tiền công & Thu nhập khác</strong>
                  <span className="text-[11px] text-slate-500 block">Lương cán bộ, công nhân, phụ cấp, kiều hối, quà biếu tặng, lãi tiền gửi</span>
                </td>
                <td className="p-2 border-r border-slate-200" colSpan={2}>
                  <input
                    type="number"
                    disabled={isLocked}
                    value={quickIncomeForm.luongVaThuKhacRevenue || ''}
                    onChange={e => updateField('luongVaThuKhacRevenue', e.target.value ? parseFloat(e.target.value) : 0)}
                    placeholder="Nhập tổng thu tiền lương và thu khác cả năm..."
                    className="w-full border border-slate-300 rounded p-1.5 text-xs text-right font-bold focus:border-sky-500"
                    min="0"
                  />
                </td>
                <td className="p-2.5 text-right font-black text-emerald-900 text-sm bg-emerald-50/50">
                  {netLuong.toLocaleString()}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="bg-emerald-100/80 font-black border-t-2 border-emerald-300 text-emerald-950">
                <td colSpan={2} className="p-3 uppercase text-xs">
                  TỔNG THU NHẬP HỘ GIA ĐÌNH CẢ NĂM:
                </td>
                <td colSpan={2} className="p-3 text-right text-xs uppercase text-slate-700">
                  Tổng thu nhập ròng:
                </td>
                <td className="p-3 text-right text-base text-emerald-900">
                  {totalNet.toLocaleString()} (1.000 đ)
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Ghi chú và chữ ký */}
      <div className="bg-white rounded-lg border border-slate-300 p-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="w-full sm:w-1/2">
          <label className="text-[11px] text-slate-600 font-bold block mb-1">Ghi chú điều tra:</label>
          <input
            type="text"
            disabled={isLocked}
            value={quickIncomeForm.note || ''}
            onChange={e => updateField('note', e.target.value)}
            placeholder="Ghi chú về nguồn thu, chi phí bất thường..."
            className="w-full border border-slate-300 rounded p-1.5 text-xs"
          />
        </div>

        <div className="flex items-center gap-3 self-end">
          <div>
            <span className="text-[10px] text-slate-500 block">Ngày lập phiếu:</span>
            <input 
              type="text" 
              disabled={isLocked}
              value={quickIncomeForm.surveyDate || ''} 
              onChange={e => updateField('surveyDate', e.target.value)}
              className="border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-center w-28" 
            />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block">Điều tra viên:</span>
            <input 
              type="text" 
              disabled={isLocked}
              placeholder="Họ tên ĐTV..." 
              value={quickIncomeForm.surveyorName || ''} 
              onChange={e => updateField('surveyorName', e.target.value)}
              className="border border-slate-300 rounded px-2 py-1 text-xs font-bold text-center w-40"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
