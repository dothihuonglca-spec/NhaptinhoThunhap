/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { MultidimensionalPovertyQuestionnaire } from '../../types/questionnaire';
import { ShieldAlert, CheckCircle2, Award, Home, CheckSquare, Square, AlertCircle, FileText } from 'lucide-react';

interface PovertyQuestionnaireViewProps {
  povertyForm: MultidimensionalPovertyQuestionnaire;
  setPovertyForm: React.Dispatch<React.SetStateAction<MultidimensionalPovertyQuestionnaire>>;
  membersCount: number | string;
  isLocked: boolean;
}

export const PovertyQuestionnaireView: React.FC<PovertyQuestionnaireViewProps> = ({
  povertyForm,
  setPovertyForm,
  membersCount,
  isLocked
}) => {
  // Tính tổng điểm B1 tự động
  const calculatedB1Score = useMemo(() => {
    let score = 0;
    // 1. Nhà ở
    if (povertyForm.b1_houseQuality === 'Kiên cố') score += 30;
    else if (povertyForm.b1_houseQuality === 'Bán kiên cố') score += 20;
    else if (povertyForm.b1_houseQuality === 'Thiếu kiên cố') score += 10;

    // 2. Diện tích
    const area = Number(povertyForm.b1_housePerCapita) || 0;
    if (area >= 15) score += 20;
    else if (area >= 8) score += 10;

    // 3. Tài sản
    if (povertyForm.b1_hasMotorbike) score += 15;
    if (povertyForm.b1_hasRefrigerator) score += 15;
    if (povertyForm.b1_hasWashingMachine) score += 10;
    if (povertyForm.b1_hasColorTV) score += 10;
    if (povertyForm.b1_hasSmartPhone) score += 10;
    if (povertyForm.b1_hasCultivationLand) score += 10;

    // 4. Nước sạch
    if (povertyForm.b1_waterSource === 'Nước máy/nước đóng chai') score += 15;
    else if (povertyForm.b1_waterSource === 'Giếng khoan sạch') score += 10;

    // 5. Nhà tiêu
    if (povertyForm.b1_toiletType === 'Tự hoại khép kín') score += 15;
    else if (povertyForm.b1_toiletType === 'Bán tự hoại') score += 10;

    return score;
  }, [
    povertyForm.b1_houseQuality,
    povertyForm.b1_housePerCapita,
    povertyForm.b1_hasMotorbike,
    povertyForm.b1_hasRefrigerator,
    povertyForm.b1_hasWashingMachine,
    povertyForm.b1_hasColorTV,
    povertyForm.b1_hasSmartPhone,
    povertyForm.b1_hasCultivationLand,
    povertyForm.b1_waterSource,
    povertyForm.b1_toiletType
  ]);

  // Đếm số lượng chỉ số thiếu hụt B2
  const deprivations = povertyForm.b2_deprivations;
  const deprivationCount = useMemo(() => {
    return Object.values(deprivations).filter(Boolean).length;
  }, [deprivations]);

  // Phân loại tự động theo chuẩn nghèo đa chiều
  const autoClassification = useMemo(() => {
    if (calculatedB1Score <= 45 || deprivationCount >= 4) {
      return 'Hộ nghèo';
    }
    if ((calculatedB1Score <= 75) || (deprivationCount >= 2)) {
      return 'Hộ cận nghèo';
    }
    if (calculatedB1Score <= 105) {
      return 'Hộ có mức sống trung bình';
    }
    return 'Hộ không nghèo';
  }, [calculatedB1Score, deprivationCount]);

  const toggleDeprivation = (key: keyof typeof deprivations) => {
    if (isLocked) return;
    setPovertyForm(prev => {
      const nextDep = { ...prev.b2_deprivations, [key]: !prev.b2_deprivations[key] };
      const nextCount = Object.values(nextDep).filter(Boolean).length;
      return {
        ...prev,
        b2_deprivations: nextDep,
        b2_deprivationCount: nextCount,
        b1_totalScore: calculatedB1Score,
        povertyClassification: autoClassification
      };
    });
  };

  const updateB1Field = (field: keyof MultidimensionalPovertyQuestionnaire, value: any) => {
    if (isLocked) return;
    setPovertyForm(prev => ({
      ...prev,
      [field]: value,
      b1_totalScore: calculatedB1Score,
      povertyClassification: autoClassification
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Banner kết quả phân loại chuẩn đa chiều */}
      <div className={`p-4 rounded-xl border-2 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
        autoClassification === 'Hộ nghèo'
          ? 'bg-rose-50 border-rose-400 text-rose-950'
          : autoClassification === 'Hộ cận nghèo'
          ? 'bg-amber-50 border-amber-400 text-amber-950'
          : autoClassification === 'Hộ có mức sống trung bình'
          ? 'bg-blue-50 border-blue-400 text-blue-950'
          : 'bg-emerald-50 border-emerald-400 text-emerald-950'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
            autoClassification === 'Hộ nghèo'
              ? 'bg-rose-600 text-white shadow-rose-200 shadow-md'
              : autoClassification === 'Hộ cận nghèo'
              ? 'bg-amber-600 text-white shadow-amber-200 shadow-md'
              : autoClassification === 'Hộ có mức sống trung bình'
              ? 'bg-blue-600 text-white shadow-blue-200 shadow-md'
              : 'bg-emerald-600 text-white shadow-emerald-200 shadow-md'
          }`}>
            {autoClassification === 'Hộ nghèo' || autoClassification === 'Hộ cận nghèo' ? (
              <ShieldAlert className="w-7 h-7" />
            ) : (
              <CheckCircle2 className="w-7 h-7" />
            )}
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider block opacity-75">
              Kết luận rà soát chuẩn nghèo đa chiều quốc gia
            </span>
            <h3 className="text-xl font-black flex items-center gap-2">
              <span>{autoClassification}</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-white/80 border shadow-2xs">
                {calculatedB1Score} điểm B1 • {deprivationCount}/12 chỉ số thiếu hụt
              </span>
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2 self-stretch md:self-auto justify-end">
          <div className="text-right bg-white/90 p-2 rounded-lg border border-slate-300 shadow-2xs">
            <span className="text-[10px] text-slate-500 font-bold block uppercase">Tổng điểm tài sản (B1):</span>
            <strong className="text-base font-black text-sky-900">{calculatedB1Score} / 150 điểm</strong>
          </div>
          <div className="text-right bg-white/90 p-2 rounded-lg border border-slate-300 shadow-2xs">
            <span className="text-[10px] text-slate-500 font-bold block uppercase">Chỉ số thiếu hụt (B2):</span>
            <strong className={`text-base font-black ${deprivationCount >= 3 ? 'text-rose-600' : 'text-emerald-700'}`}>
              {deprivationCount} / 12 chỉ số
            </strong>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Phần B1: Đặc điểm tài sản và điều kiện sinh hoạt */}
        <div className="bg-white rounded-lg border border-slate-300 shadow-2xs p-3.5 flex flex-col gap-3">
          <div className="border-b border-slate-200 pb-2">
            <h4 className="font-extrabold text-xs text-sky-900 uppercase flex items-center gap-1.5">
              <Home className="w-4 h-4 text-sky-700" />
              <span>Phần B1: Chấm điểm tài sản & điều kiện sinh hoạt (Max 150 điểm)</span>
            </h4>
            <p className="text-[11px] text-slate-500">Đánh giá hiện trạng nhà ở, phương tiện sinh hoạt và đất sản xuất của hộ.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Chất lượng nhà ở */}
            <div>
              <label className="font-bold text-slate-700 block mb-1">1. Chất lượng nhà ở:</label>
              <select
                disabled={isLocked}
                value={povertyForm.b1_houseQuality}
                onChange={e => updateB1Field('b1_houseQuality', e.target.value)}
                className="w-full border border-slate-300 rounded p-1.5 text-xs font-semibold focus:border-sky-500"
              >
                <option value="Kiên cố">Kiên cố (30 điểm)</option>
                <option value="Bán kiên cố">Bán kiên cố (20 điểm)</option>
                <option value="Thiếu kiên cố">Thiếu kiên cố (10 điểm)</option>
                <option value="Đơn sơ">Đơn sơ, tạm bợ (0 điểm)</option>
              </select>
            </div>

            {/* Diện tích nhà bình quân */}
            <div>
              <label className="font-bold text-slate-700 block mb-1">2. Diện tích nhà bình quân (m²/người):</label>
              <input
                type="number"
                disabled={isLocked}
                value={povertyForm.b1_housePerCapita || ''}
                onChange={e => updateB1Field('b1_housePerCapita', e.target.value ? parseFloat(e.target.value) : 0)}
                placeholder="Ví dụ: 18"
                className="w-full border border-slate-300 rounded p-1.5 text-xs font-bold focus:border-sky-500"
                min="1"
              />
              <span className="text-[10px] text-slate-500 block mt-0.5">
                {Number(povertyForm.b1_housePerCapita) >= 15 ? 'Đạt ≥15 m² (+20 đ)' : Number(povertyForm.b1_housePerCapita) >= 8 ? 'Đạt 8-14 m² (+10 đ)' : 'Dưới 8 m² (0 đ)'}
              </span>
            </div>

            {/* Nguồn nước */}
            <div>
              <label className="font-bold text-slate-700 block mb-1">3. Nguồn nước sinh hoạt:</label>
              <select
                disabled={isLocked}
                value={povertyForm.b1_waterSource}
                onChange={e => updateB1Field('b1_waterSource', e.target.value)}
                className="w-full border border-slate-300 rounded p-1.5 text-xs font-semibold focus:border-sky-500"
              >
                <option value="Nước máy/nước đóng chai">Nước máy / đóng chai (15 điểm)</option>
                <option value="Giếng khoan sạch">Giếng khoan sạch (10 điểm)</option>
                <option value="Giếng đào/ao hồ">Giếng đào / sông ao hồ (0 điểm)</option>
              </select>
            </div>

            {/* Nhà tiêu */}
            <div>
              <label className="font-bold text-slate-700 block mb-1">4. Loại nhà tiêu sử dụng:</label>
              <select
                disabled={isLocked}
                value={povertyForm.b1_toiletType}
                onChange={e => updateB1Field('b1_toiletType', e.target.value)}
                className="w-full border border-slate-300 rounded p-1.5 text-xs font-semibold focus:border-sky-500"
              >
                <option value="Tự hoại khép kín">Tự hoại khép kín (15 điểm)</option>
                <option value="Bán tự hoại">Bán tự hoại / 2 ngăn (10 điểm)</option>
                <option value="Hố xí thô sơ/không có">Thô sơ / Chưa có (0 điểm)</option>
              </select>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-2.5">
            <span className="font-bold text-slate-700 block mb-2 text-xs">5. Đồ dùng sinh hoạt & tư liệu sản xuất có trong hộ:</span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded cursor-pointer hover:bg-sky-50">
                <input
                  type="checkbox"
                  disabled={isLocked}
                  checked={Boolean(povertyForm.b1_hasMotorbike)}
                  onChange={e => updateB1Field('b1_hasMotorbike', e.target.checked)}
                  className="w-4 h-4 text-sky-600 rounded"
                />
                <span className="font-medium text-slate-800">Xe máy hoạt động tốt (+15đ)</span>
              </label>

              <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded cursor-pointer hover:bg-sky-50">
                <input
                  type="checkbox"
                  disabled={isLocked}
                  checked={Boolean(povertyForm.b1_hasRefrigerator)}
                  onChange={e => updateB1Field('b1_hasRefrigerator', e.target.checked)}
                  className="w-4 h-4 text-sky-600 rounded"
                />
                <span className="font-medium text-slate-800">Tủ lạnh gia đình (+15đ)</span>
              </label>

              <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded cursor-pointer hover:bg-sky-50">
                <input
                  type="checkbox"
                  disabled={isLocked}
                  checked={Boolean(povertyForm.b1_hasWashingMachine)}
                  onChange={e => updateB1Field('b1_hasWashingMachine', e.target.checked)}
                  className="w-4 h-4 text-sky-600 rounded"
                />
                <span className="font-medium text-slate-800">Máy giặt (+10đ)</span>
              </label>

              <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded cursor-pointer hover:bg-sky-50">
                <input
                  type="checkbox"
                  disabled={isLocked}
                  checked={Boolean(povertyForm.b1_hasColorTV)}
                  onChange={e => updateB1Field('b1_hasColorTV', e.target.checked)}
                  className="w-4 h-4 text-sky-600 rounded"
                />
                <span className="font-medium text-slate-800">Tivi màu / Smart TV (+10đ)</span>
              </label>

              <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded cursor-pointer hover:bg-sky-50">
                <input
                  type="checkbox"
                  disabled={isLocked}
                  checked={Boolean(povertyForm.b1_hasSmartPhone)}
                  onChange={e => updateB1Field('b1_hasSmartPhone', e.target.checked)}
                  className="w-4 h-4 text-sky-600 rounded"
                />
                <span className="font-medium text-slate-800">Smartphone / Máy tính (+10đ)</span>
              </label>

              <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded cursor-pointer hover:bg-sky-50">
                <input
                  type="checkbox"
                  disabled={isLocked}
                  checked={Boolean(povertyForm.b1_hasCultivationLand)}
                  onChange={e => updateB1Field('b1_hasCultivationLand', e.target.checked)}
                  className="w-4 h-4 text-sky-600 rounded"
                />
                <span className="font-medium text-slate-800">Có đất sản xuất (+10đ)</span>
              </label>
            </div>
          </div>
        </div>

        {/* Phần B2: 12 Chỉ số thiếu hụt dịch vụ xã hội cơ bản */}
        <div className="bg-white rounded-lg border border-slate-300 shadow-2xs p-3.5 flex flex-col gap-3">
          <div className="border-b border-slate-200 pb-2">
            <h4 className="font-extrabold text-xs text-rose-900 uppercase flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              <span>Phần B2: 12 Chỉ số đo lường mức độ thiếu hụt dịch vụ xã hội</span>
            </h4>
            <p className="text-[11px] text-slate-500">Tích chọn nếu hộ gia đình BỊ THIẾU HỤT chỉ số đó.</p>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="bg-sky-50/70 p-2 rounded border border-sky-100 font-bold text-sky-900 text-[11px] uppercase">
              I. Chiều việc làm & Y tế
            </div>
            
            <label className={`flex items-start gap-2.5 p-2 rounded border transition-colors cursor-pointer ${deprivations.viecLam ? 'bg-rose-50 border-rose-300 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(deprivations.viecLam)}
                onChange={() => toggleDeprivation('viecLam')}
                className="w-4 h-4 text-rose-600 rounded mt-0.5"
              />
              <div>
                <span>1. Thiếu hụt về Việc làm</span>
                <p className="text-[10px] text-slate-500 font-normal">Hộ có ít nhất 1 người trong độ tuổi lao động có khả năng lao động nhưng không có việc làm.</p>
              </div>
            </label>

            <label className={`flex items-start gap-2.5 p-2 rounded border transition-colors cursor-pointer ${deprivations.nguoiPhuThuoc ? 'bg-rose-50 border-rose-300 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(deprivations.nguoiPhuThuoc)}
                onChange={() => toggleDeprivation('nguoiPhuThuoc')}
                className="w-4 h-4 text-rose-600 rounded mt-0.5"
              />
              <div>
                <span>2. Thiếu hụt Người phụ thuộc trong hộ</span>
                <p className="text-[10px] text-slate-500 font-normal">Tỷ lệ người phụ thuộc (trẻ em, người già, người khuyết tật) cao trên 50% tổng số nhân khẩu.</p>
              </div>
            </label>

            <label className={`flex items-start gap-2.5 p-2 rounded border transition-colors cursor-pointer ${deprivations.dinhDuong ? 'bg-rose-50 border-rose-300 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(deprivations.dinhDuong)}
                onChange={() => toggleDeprivation('dinhDuong')}
                className="w-4 h-4 text-rose-600 rounded mt-0.5"
              />
              <div>
                <span>3. Thiếu hụt về Dinh dưỡng</span>
                <p className="text-[10px] text-slate-500 font-normal">Hộ có trẻ em dưới 16 tuổi bị suy dinh dưỡng thể thấp còi hoặc nhẹ cân.</p>
              </div>
            </label>

            <label className={`flex items-start gap-2.5 p-2 rounded border transition-colors cursor-pointer ${deprivations.bhyt ? 'bg-rose-50 border-rose-300 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(deprivations.bhyt)}
                onChange={() => toggleDeprivation('bhyt')}
                className="w-4 h-4 text-rose-600 rounded mt-0.5"
              />
              <div>
                <span>4. Thiếu hụt về Bảo hiểm y tế</span>
                <p className="text-[10px] text-slate-500 font-normal">Hộ có thành viên từ 6 tuổi trở lên hiện không tham gia bất kỳ loại BHYT nào.</p>
              </div>
            </label>

            <div className="bg-sky-50/70 p-2 rounded border border-sky-100 font-bold text-sky-900 text-[11px] uppercase mt-2">
              II. Chiều Giáo dục & Nhà ở
            </div>

            <label className={`flex items-start gap-2.5 p-2 rounded border transition-colors cursor-pointer ${deprivations.trinhDoGiaoDuc ? 'bg-rose-50 border-rose-300 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(deprivations.trinhDoGiaoDuc)}
                onChange={() => toggleDeprivation('trinhDoGiaoDuc')}
                className="w-4 h-4 text-rose-600 rounded mt-0.5"
              />
              <div>
                <span>5. Thiếu hụt Trình độ giáo dục người lớn</span>
                <p className="text-[10px] text-slate-500 font-normal">Thành viên từ 16 đến 30 tuổi chưa học xong THCS hoặc không tiếp tục đi học.</p>
              </div>
            </label>

            <label className={`flex items-start gap-2.5 p-2 rounded border transition-colors cursor-pointer ${deprivations.tinhTrangDiHoc ? 'bg-rose-50 border-rose-300 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(deprivations.tinhTrangDiHoc)}
                onChange={() => toggleDeprivation('tinhTrangDiHoc')}
                className="w-4 h-4 text-rose-600 rounded mt-0.5"
              />
              <div>
                <span>6. Thiếu hụt Tình trạng đi học của trẻ em</span>
                <p className="text-[10px] text-slate-500 font-normal">Có trẻ em từ 3 đến dưới 16 tuổi hiện không được đến trường đi học.</p>
              </div>
            </label>

            <label className={`flex items-start gap-2.5 p-2 rounded border transition-colors cursor-pointer ${deprivations.chatLuongNhaO ? 'bg-rose-50 border-rose-300 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(deprivations.chatLuongNhaO)}
                onChange={() => toggleDeprivation('chatLuongNhaO')}
                className="w-4 h-4 text-rose-600 rounded mt-0.5"
              />
              <div>
                <span>7. Thiếu hụt về Chất lượng nhà ở</span>
                <p className="text-[10px] text-slate-500 font-normal">Hộ đang sống trong nhà thiếu kiên cố hoặc nhà tạm bợ, đơn sơ.</p>
              </div>
            </label>

            <label className={`flex items-start gap-2.5 p-2 rounded border transition-colors cursor-pointer ${deprivations.dienTichNhaO ? 'bg-rose-50 border-rose-300 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(deprivations.dienTichNhaO)}
                onChange={() => toggleDeprivation('dienTichNhaO')}
                className="w-4 h-4 text-rose-600 rounded mt-0.5"
              />
              <div>
                <span>8. Thiếu hụt Diện tích nhà ở bình quân</span>
                <p className="text-[10px] text-slate-500 font-normal">Diện tích nhà ở bình quân đầu người dưới 8 m²/người.</p>
              </div>
            </label>

            <div className="bg-sky-50/70 p-2 rounded border border-sky-100 font-bold text-sky-900 text-[11px] uppercase mt-2">
              III. Chiều Nước sạch, Vệ sinh & Thông tin
            </div>

            <label className={`flex items-start gap-2.5 p-2 rounded border transition-colors cursor-pointer ${deprivations.nuocSinhHoat ? 'bg-rose-50 border-rose-300 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(deprivations.nuocSinhHoat)}
                onChange={() => toggleDeprivation('nuocSinhHoat')}
                className="w-4 h-4 text-rose-600 rounded mt-0.5"
              />
              <div>
                <span>9. Thiếu hụt Nguồn nước sinh hoạt hợp vệ sinh</span>
                <p className="text-[10px] text-slate-500 font-normal">Hộ không được tiếp cận nguồn nước sinh hoạt an toàn, hợp vệ sinh.</p>
              </div>
            </label>

            <label className={`flex items-start gap-2.5 p-2 rounded border transition-colors cursor-pointer ${deprivations.nhaTieuHopVeSinh ? 'bg-rose-50 border-rose-300 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(deprivations.nhaTieuHopVeSinh)}
                onChange={() => toggleDeprivation('nhaTieuHopVeSinh')}
                className="w-4 h-4 text-rose-600 rounded mt-0.5"
              />
              <div>
                <span>10. Thiếu hụt Nhà tiêu hợp vệ sinh</span>
                <p className="text-[10px] text-slate-500 font-normal">Hộ không có nhà tiêu hoặc sử dụng nhà tiêu thô sơ không hợp vệ sinh.</p>
              </div>
            </label>

            <label className={`flex items-start gap-2.5 p-2 rounded border transition-colors cursor-pointer ${deprivations.dichVuVienThong ? 'bg-rose-50 border-rose-300 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(deprivations.dichVuVienThong)}
                onChange={() => toggleDeprivation('dichVuVienThong')}
                className="w-4 h-4 text-rose-600 rounded mt-0.5"
              />
              <div>
                <span>11. Thiếu hụt Sử dụng dịch vụ viễn thông</span>
                <p className="text-[10px] text-slate-500 font-normal">Không có thành viên nào sử dụng dịch vụ điện thoại hay mạng internet.</p>
              </div>
            </label>

            <label className={`flex items-start gap-2.5 p-2 rounded border transition-colors cursor-pointer ${deprivations.phuongTienNgheNhin ? 'bg-rose-50 border-rose-300 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(deprivations.phuongTienNgheNhin)}
                onChange={() => toggleDeprivation('phuongTienNgheNhin')}
                className="w-4 h-4 text-rose-600 rounded mt-0.5"
              />
              <div>
                <span>12. Thiếu hụt Phương tiện tiếp cận thông tin</span>
                <p className="text-[10px] text-slate-500 font-normal">Hộ không có tivi, radio, máy tính hay điện thoại thông minh để tiếp cận tin tức.</p>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Chữ ký cán bộ điều tra */}
      <div className="bg-white rounded-lg border border-slate-300 p-3 flex flex-wrap justify-between items-center gap-3">
        <div className="text-xs text-slate-600">
          <span className="font-bold text-slate-800">Cơ sở pháp lý:</span> Rà soát theo Nghị định số 07/2021/NĐ-CP ngày 27/01/2021 của Chính phủ quy định chuẩn nghèo đa chiều giai đoạn 2021 - 2025.
        </div>

        <div className="flex items-center gap-3 self-end">
          <div>
            <span className="text-[10px] text-slate-500 block">Ngày rà soát:</span>
            <input 
              type="text" 
              disabled={isLocked}
              value={povertyForm.surveyDate || ''} 
              onChange={e => setPovertyForm(prev => ({ ...prev, surveyDate: e.target.value }))}
              className="border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-center w-28" 
            />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block">Cán bộ rà soát:</span>
            <input 
              type="text" 
              disabled={isLocked}
              placeholder="Họ tên cán bộ..." 
              value={povertyForm.surveyorName || ''} 
              onChange={e => setPovertyForm(prev => ({ ...prev, surveyorName: e.target.value }))}
              className="border border-slate-300 rounded px-2 py-1 text-xs font-bold text-center w-40"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
