import * as XLSX from 'xlsx';

export interface CommuneItem {
  id: string;
  communeCode: string;
  communeName: string;
  tkcsCode?: string;
  tkcsName?: string;
  [key: string]: any;
}

export interface SurveyAreaItem {
  id: string;
  communeId: string;
  communeCode?: string;
  code: string;
  name: string;
  householdCount?: number;
  [key: string]: any;
}

export interface SurveyorItem {
  id: string;
  code: string;
  username: string;
  name: string;
  role: string;
  department?: string;
  departmentId?: string;
  position?: string;
  assignedAreas?: string[];
  assignedCommunes?: string[];
  [key: string]: any;
}

export interface HouseholdItem {
  id: string;
  communeId: string;
  communeCode?: string;
  areaId: string;
  areaCode: string;
  assignedSurveyorId?: string;
  assignedSurveyorName?: string;
  [key: string]: any;
}

export interface ParsedSurveyorAssignment {
  surveyor: SurveyorItem;
  areaIds: string[];
  areaLabels: string[];
  communeIds: string[];
  communeNames: string[];
  rowCount: number;
}

export interface ParsedPermissionResult {
  totalRows: number;
  validRows: number;
  assignments: ParsedSurveyorAssignment[];
  warnings: string[];
  /** số dòng bỏ trống cột ĐTV (giữ nguyên phân công hiện tại) */
  blankRows?: number;
}

/** So sánh tên không phân biệt hoa/thường, dấu và khoảng trắng thừa. */
export const normText = (v: unknown) =>
  String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();

type FindResult = { surveyor?: SurveyorItem; problem?: string };

/**
 * Tìm tài khoản theo mã / tên đăng nhập / họ tên (không phân biệt dấu). Trùng tên thì KHÔNG đoán mà báo để ghi mã.
 */
function findSurveyor(surveyors: SurveyorItem[], rawCode: string, rawUsername: string, rawName: string): FindResult {
  const nc = normText(rawCode), nu = normText(rawUsername), nn = normText(rawName);
  const byKey = (k: string) => surveyors.filter(s => normText(s.code) === k || normText(s.username) === k);
  let hit: SurveyorItem[] = [];
  if (nc) hit = byKey(nc);
  if (hit.length === 0 && nu) hit = byKey(nu);
  if (hit.length === 0 && nn) {
    hit = surveyors.filter(s => normText(s.name) === nn);
    if (hit.length === 0) hit = byKey(nn);                       // người dùng gõ mã vào cột tên
  }
  if (hit.length === 1) {
    if (hit[0].role === 'ADMIN') return { problem: `"${hit[0].name}" là tài khoản Admin, không nhận địa bàn` };
    return { surveyor: hit[0] };
  }
  if (hit.length > 1) return { problem: `có ${hit.length} tài khoản trùng tên "${rawName || rawCode}" (${hit.map(h => h.code).join(', ')}), hãy ghi Mã cán bộ thay cho tên` };
  const q = nn || nc || nu;
  const near = surveyors.filter(s => { const n = normText(s.name); return q.length >= 2 && (n.includes(q) || q.includes(n)); }).slice(0, 3);
  return { problem: `không tìm thấy "${rawName || rawCode || rawUsername}" trong danh sách tài khoản${near.length ? `. Có phải: ${near.map(n => `${n.name} (${n.code})`).join('; ')}?` : ''}` };
}

/**
 * Xuất file phân quyền gọn: đúng các cột STT | Mã TKCS | Tên TKCS | Mã xã | Tên xã | Mã địa bàn | Tên địa bàn |
 * Tên Người nhập / ĐTV | Tổng số hộ. Admin chỉ cần điền cột "Tên Người nhập / ĐTV" rồi tải lên lại.
 */
export function buildSimpleAssignWorkbook(
  communes: CommuneItem[], areas: SurveyAreaItem[], surveyors: SurveyorItem[], households: HouseholdItem[],
) {
  const officialByArea = new Map<string, number>();
  const ownerCount = new Map<string, Map<string, number>>();
  households.forEach(h => {
    const k = `${h.communeId}_${h.areaCode}`;
    const st = String((h as any).sampleStatus || '').toUpperCase();
    if (!st || st.includes('CHÍNH')) { officialByArea.set(h.areaId, (officialByArea.get(h.areaId) || 0) + 1); officialByArea.set(k, (officialByArea.get(k) || 0) + 1); }
    if (h.assignedSurveyorId) for (const key of [h.areaId, k]) {
      const m = ownerCount.get(key) || new Map<string, number>(); m.set(h.assignedSurveyorId, (m.get(h.assignedSurveyorId) || 0) + 1); ownerCount.set(key, m);
    }
  });
  const byId = new Map(surveyors.map(s => [s.id, s] as const));
  const ownerOf = (a: SurveyAreaItem) => {
    const m = ownerCount.get(a.id) || ownerCount.get(`${a.communeId}_${a.code}`);
    if (m) { const top = Array.from(m.entries()).sort((x, y) => y[1] - x[1])[0][0]; return byId.get(top); }
    return surveyors.find(s => (s.assignedAreas || []).includes(a.id) || (s.assignedAreas || []).includes(`${a.communeId}_${a.code}`));
  };

  const rows: any[][] = [['STT', 'Mã TKCS', 'Tên TKCS', 'Mã xã', 'Tên xã', 'Mã địa bàn', 'Tên địa bàn', 'Tên Người nhập / ĐTV', 'Tổng số hộ']];
  let stt = 1;
  const sortedCommunes = [...communes].sort((a, b) => (a.tkcsCode || '').localeCompare(b.tkcsCode || '') || a.communeCode.localeCompare(b.communeCode));
  sortedCommunes.forEach(c => {
    areas.filter(a => a.communeId === c.id || (!!c.communeCode && a.communeCode === c.communeCode))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
      .forEach(a => {
        const total = officialByArea.get(a.id) ?? officialByArea.get(`${a.communeId}_${a.code}`) ?? a.householdCount ?? 0;
        rows.push([stt++, c.tkcsCode || '', c.tkcsName || '', c.communeCode, c.communeName, a.code, a.name || `Địa bàn ${a.code}`, ownerOf(a)?.name || '', total]);
      });
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 22 }, { wch: 10 }, { wch: 24 }, { wch: 12 }, { wch: 28 }, { wch: 28 }, { wch: 12 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 } as any;
  ws['!autofilter'] = { ref: `A1:I${rows.length}` };

  const staff: any[][] = [['STT', 'Họ và tên (chép vào cột "Tên Người nhập / ĐTV")', 'Mã cán bộ', 'Tên đăng nhập', 'Vai trò', 'Số địa bàn đang làm']];
  const count = new Map<string, number>();
  areas.forEach(a => { const o = ownerOf(a); if (o) count.set(o.id, (count.get(o.id) || 0) + 1); });
  surveyors.filter(s => s.role !== 'ADMIN').forEach((s, i) => staff.push([i + 1, s.name, s.code, s.username, s.role === 'SUPERVISOR' ? 'Giám sát viên' : 'Điều tra viên', count.get(s.id) || 0]));
  const wsStaff = XLSX.utils.aoa_to_sheet(staff);
  wsStaff['!cols'] = [{ wch: 6 }, { wch: 44 }, { wch: 14 }, { wch: 22 }, { wch: 16 }, { wch: 20 }];

  const guide = XLSX.utils.aoa_to_sheet([
    ['HƯỚNG DẪN'],
    ['1. Điền họ tên điều tra viên vào cột "Tên Người nhập / ĐTV" ở sheet PhanCong_DiaBan (chép từ sheet DanhSach_DTV cho chắc).'],
    ['2. Mỗi địa bàn chỉ một người. Một người có thể nhiều địa bàn (nhiều dòng cùng tên).'],
    ['3. Dòng để TRỐNG cột ĐTV: giữ nguyên phân công hiện tại, không thay đổi.'],
    ['4. Không sửa các cột Mã xã, Mã địa bàn (hệ thống dựa vào mã xã + mã địa bàn để nhận đúng địa bàn). Không cần sửa cột khác.'],
    ['5. Hai người trùng họ tên thì ghi Mã cán bộ thay cho tên. Tên không dấu hoặc gõ thường/hoa đều nhận.'],
    ['6. "Tổng số hộ" chỉ là số hộ mẫu chính thức của địa bàn để tham khảo, không dùng khi tải lên.'],
  ]);
  guide['!cols'] = [{ wch: 120 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'PhanCong_DiaBan');
  XLSX.utils.book_append_sheet(wb, wsStaff, 'DanhSach_DTV');
  XLSX.utils.book_append_sheet(wb, guide, 'HuongDan');
  return wb;
}

export function exportSimpleAssignExcel(communes: CommuneItem[], areas: SurveyAreaItem[], surveyors: SurveyorItem[], households: HouseholdItem[]) {
  const wb = buildSimpleAssignWorkbook(communes, areas, surveyors, households);
  XLSX.writeFile(wb, `PhanQuyen_DiaBan_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/**
 * Xuất file mẫu Excel phân công / phân quyền địa bàn (bản đầy đủ cột)
 */
export function exportPermissionExcelTemplate(
  communes: CommuneItem[],
  areas: SurveyAreaItem[],
  surveyors: SurveyorItem[],
  households: HouseholdItem[]
) {
  const wb = XLSX.utils.book_new();

  // Helper map households to area count
  const areaHhCountMap = new Map<string, number>();
  const areaSurveyorMap = new Map<string, { id: string; name: string }>();
  households.forEach(h => {
    const key = `${h.communeId}_${h.areaCode}`;
    areaHhCountMap.set(key, (areaHhCountMap.get(key) || 0) + 1);
    areaHhCountMap.set(h.areaId, (areaHhCountMap.get(h.areaId) || 0) + 1);
    if (h.assignedSurveyorId) {
      areaSurveyorMap.set(key, { id: h.assignedSurveyorId, name: h.assignedSurveyorName || '' });
      areaSurveyorMap.set(h.areaId, { id: h.assignedSurveyorId, name: h.assignedSurveyorName || '' });
    }
  });

  // 1. Sheet Phân công địa bàn
  const sheetData: any[][] = [
    [
      'STT',
      'Mã TKCS',
      'Tên TKCS',
      'Mã xã',
      'Tên xã / phường',
      'Mã địa bàn',
      'Tên địa bàn',
      'Mã cán bộ / ĐTV',
      'Tên đăng nhập cán bộ',
      'Họ và tên cán bộ',
      'Phòng ban phụ trách',
      'Vai trò hệ thống',
      'Số hộ trong địa bàn',
      'Ghi chú'
    ]
  ];

  let stt = 1;

  // Lặp qua danh sách xã & địa bàn để điền sẵn vào mẫu
  communes.forEach(commune => {
    const commAreas = areas.filter(
      a => a.communeId === commune.id || (Boolean(commune.communeCode) && a.communeCode === commune.communeCode)
    );

    if (commAreas.length === 0) {
      // Nếu xã chưa có địa bàn con, tạo 1 dòng đại diện xã
      sheetData.push([
        stt++,
        commune.tkcsCode || 'TK001',
        commune.tkcsName || 'TKCS',
        commune.communeCode,
        commune.communeName,
        'ALL',
        'Toàn xã ' + commune.communeName,
        '',
        '',
        '',
        '',
        'SURVEYOR',
        0,
        'Điền Mã cán bộ hoặc Tên đăng nhập để gán toàn bộ xã'
      ]);
    } else {
      commAreas.forEach(a => {
        const key = `${a.communeId}_${a.code}`;
        const hhCount = areaHhCountMap.get(a.id) || areaHhCountMap.get(key) || a.householdCount || 0;
        
        // Tìm cán bộ đang được phân công nếu có
        let assignedSurveyor: SurveyorItem | undefined;
        const curAssign = areaSurveyorMap.get(a.id) || areaSurveyorMap.get(key);
        if (curAssign) {
          assignedSurveyor = surveyors.find(s => s.id === curAssign.id);
        }
        if (!assignedSurveyor) {
          assignedSurveyor = surveyors.find(s => 
            s.assignedAreas?.includes(a.id) || 
            s.assignedAreas?.includes(a.code) || 
            s.assignedAreas?.includes(key)
          );
        }

        sheetData.push([
          stt++,
          commune.tkcsCode || 'TK001',
          commune.tkcsName || 'TKCS',
          commune.communeCode,
          commune.communeName,
          a.code,
          a.name || `Địa bàn ${a.code}`,
          assignedSurveyor ? assignedSurveyor.code : '',
          assignedSurveyor ? assignedSurveyor.username : '',
          assignedSurveyor ? assignedSurveyor.name : '',
          assignedSurveyor ? (assignedSurveyor.department || '') : '',
          assignedSurveyor ? assignedSurveyor.role : 'SURVEYOR',
          hhCount,
          assignedSurveyor ? 'Đã có phân công' : 'Chưa phân công'
        ]);
      });
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 6 },  // STT
    { wch: 10 }, // Mã TKCS
    { wch: 20 }, // Tên TKCS
    { wch: 10 }, // Mã xã
    { wch: 22 }, // Tên xã
    { wch: 12 }, // Mã địa bàn
    { wch: 20 }, // Tên địa bàn
    { wch: 16 }, // Mã cán bộ
    { wch: 26 }, // Tên đăng nhập
    { wch: 22 }, // Họ và tên cán bộ
    { wch: 26 }, // Phòng ban
    { wch: 14 }, // Vai trò
    { wch: 18 }, // Số hộ
    { wch: 28 }  // Ghi chú
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'PhanCong_DiaBan');

  // 2. Sheet Danh mục cán bộ để tra cứu
  const staffData: any[][] = [
    [
      'STT',
      'Mã cán bộ (Code)',
      'Tên đăng nhập (Username)',
      'Họ và tên',
      'Chức vụ',
      'Phòng ban phụ trách',
      'Vai trò hệ thống',
      'Số địa bàn đang phụ trách',
      'Ghi chú'
    ]
  ];

  surveyors.forEach((s, idx) => {
    staffData.push([
      idx + 1,
      s.code,
      s.username,
      s.name,
      s.position || '',
      s.department || '',
      s.role,
      (s.assignedAreas || []).length,
      s.role === 'SUPERVISOR' ? 'Giám sát viên (có quyền duyệt và quản lý xã)' : 'Điều tra viên'
    ]);
  });

  const wsStaff = XLSX.utils.aoa_to_sheet(staffData);
  wsStaff['!cols'] = [
    { wch: 6 },
    { wch: 18 },
    { wch: 26 },
    { wch: 22 },
    { wch: 16 },
    { wch: 26 },
    { wch: 16 },
    { wch: 24 },
    { wch: 35 }
  ];
  XLSX.utils.book_append_sheet(wb, wsStaff, 'DanhMuc_CanBo');

  const fileName = `Mau_Phan_Cong_Phan_Quyen_Dia_Ban_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

/**
 * Đọc và phân tích file Excel phân quyền do người dùng tải lên
 */
export async function parsePermissionExcelFile(
  file: File,
  communes: CommuneItem[],
  areas: SurveyAreaItem[],
  surveyors: SurveyorItem[]
): Promise<ParsedPermissionResult> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });

  // Đọc sheet đầu tiên hoặc sheet tên 'PhanCong_DiaBan'
  const sheetName = wb.SheetNames.includes('PhanCong_DiaBan') 
    ? 'PhanCong_DiaBan' 
    : wb.SheetNames[0];

  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error('Không tìm thấy bảng tính dữ liệu trong file Excel.');
  }

  const rawRows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (rawRows.length === 0) {
    throw new Error('File Excel rỗng, không có dữ liệu phân công.');
  }

  const warnings: string[] = [];
  let validRows = 0;
  let blankRows = 0;
  const areaClaim = new Map<string, { surveyorId: string; rowNum: number }>();   // địa bàn -> dòng gán gần nhất

  // Map theo surveyorId -> ParsedSurveyorAssignment
  const assignmentMap = new Map<string, ParsedSurveyorAssignment>();

  rawRows.forEach((row, rowIndex) => {
    const rowNum = rowIndex + 2; // Dòng 1 là tiêu đề

    // Lấy thông tin cán bộ
    const rawCode = String(row['Mã cán bộ / ĐTV'] || row['Mã cán bộ'] || row['Mã ĐTV'] || row['Code'] || '').trim();
    const rawUsername = String(row['Tên đăng nhập cán bộ'] || row['Tên đăng nhập'] || row['Username'] || row['Email'] || '').trim();
    const rawName = String(row['Tên Người nhập / ĐTV'] || row['Tên người nhập / ĐTV'] || row['Tên Người nhập'] || row['Người nhập'] || row['Tên ĐTV'] || row['ĐTV'] || row['Điều tra viên'] || row['Họ và tên cán bộ'] || row['Họ và tên'] || row['Tên cán bộ'] || row['Name'] || '').trim();

    if (!rawCode && !rawUsername && !rawName) {
      // Dòng trống không gán cán bộ -> giữ nguyên phân công hiện tại
      if (String(row['Mã địa bàn'] || row['Mã xã'] || '').trim()) blankRows++;
      return;
    }

    // Tìm cán bộ trong hệ thống (không phân biệt dấu; trùng tên thì báo chứ không đoán)
    const found = findSurveyor(surveyors, rawCode, rawUsername, rawName);
    if (!found.surveyor) {
      warnings.push(`Dòng ${rowNum}: ${found.problem}.`);
      return;
    }
    const matchedSurveyor = found.surveyor;

    // Lấy thông tin xã
    const rawCommuneCode = String(row['Mã xã'] || row['Mã xã / phường'] || row['CommuneCode'] || '').trim();
    const rawCommuneName = String(row['Tên xã / phường'] || row['Tên xã'] || row['CommuneName'] || '').trim();

    const matchedCommune = communes.find(c => {
      if (rawCommuneCode && (c.communeCode === rawCommuneCode || c.id === rawCommuneCode)) return true;
      if (rawCommuneName && c.communeName && c.communeName.trim().toLowerCase() === rawCommuneName.trim().toLowerCase()) return true;
      return false;
    });

    // Lấy thông tin địa bàn
    const rawAreaCode = String(row['Mã địa bàn'] || row['Mã ĐB'] || row['AreaCode'] || '').trim();
    const rawAreaName = String(row['Tên địa bàn'] || row['AreaName'] || '').trim();

    let matchedAreas: SurveyAreaItem[] = [];

    if (matchedCommune) {
      if (!rawAreaCode || rawAreaCode.toUpperCase() === 'ALL' || rawAreaCode.toLowerCase() === 'toàn xã' || rawAreaCode.toLowerCase() === 'tất cả') {
        // Gán toàn bộ địa bàn của xã này
        matchedAreas = areas.filter(a => a.communeId === matchedCommune.id || a.communeCode === matchedCommune.communeCode);
      } else {
        // Chuẩn hóa mã địa bàn (vd "1" -> "001")
        const normCode = rawAreaCode.padStart(3, '0');
        matchedAreas = areas.filter(a => 
          (a.communeId === matchedCommune.id || a.communeCode === matchedCommune.communeCode) &&
          (a.code === rawAreaCode || a.code === normCode || a.id === rawAreaCode || `${matchedCommune.communeCode}${a.code}` === rawAreaCode.replace(/[\s-]/g, ''))
        );
      }
    } else if (rawAreaCode) {
      // Không xác định được xã: CHỈ chấp nhận ID địa bàn đầy đủ (mã xã + mã địa bàn, VD 11953001) hoặc id nội bộ.
      // Tuyệt đối không khớp theo mã trần "001" vì xã nào cũng có địa bàn 001.
      const full = rawAreaCode.replace(/[\s-]/g, '');
      matchedAreas = areas.filter(a => {
        const cc = (a as any).communeCode || communes.find(c => c.id === a.communeId)?.communeCode;
        return a.id === rawAreaCode || (!!cc && `${cc}${a.code}` === full);
      });
    }

    // Khởi tạo hoặc lấy assignment của cán bộ
    let assignObj = assignmentMap.get(matchedSurveyor.id);
    if (!assignObj) {
      assignObj = {
        surveyor: matchedSurveyor,
        areaIds: [],
        areaLabels: [],
        communeIds: [],
        communeNames: [],
        rowCount: 0
      };
      assignmentMap.set(matchedSurveyor.id, assignObj);
    }

    const wantsWholeCommune = !rawAreaCode || ['all', 'toàn xã', 'tất cả'].includes(rawAreaCode.toLowerCase());
    if (matchedAreas.length > 0 || (matchedCommune && wantsWholeCommune)) {
      if (matchedCommune) {
        if (!assignObj.communeIds.includes(matchedCommune.id)) {
          assignObj.communeIds.push(matchedCommune.id);
          assignObj.communeNames.push(matchedCommune.communeName);
        }
        if (matchedCommune.communeCode && !assignObj.communeIds.includes(matchedCommune.communeCode)) {
          assignObj.communeIds.push(matchedCommune.communeCode);
        }
      }
      matchedAreas.forEach(a => {
        const prev = areaClaim.get(a.id);
        if (prev && prev.surveyorId !== matchedSurveyor.id) {
          warnings.push(`Dòng ${rowNum}: địa bàn ${matchedCommune?.communeCode || ''}${a.code} đã gán cho người khác ở dòng ${prev.rowNum}; lấy dòng ${rowNum} (mỗi địa bàn chỉ một người).`);
          // rút địa bàn khỏi người ở dòng trước để kết quả đúng "dòng sau thắng" bất kể thứ tự xử lý
          const loser = assignmentMap.get(prev.surveyorId);
          if (loser) { const k = loser.areaIds.indexOf(a.id); if (k >= 0) { loser.areaIds.splice(k, 1); loser.areaLabels.splice(k, 1); } }
        }
        areaClaim.set(a.id, { surveyorId: matchedSurveyor.id, rowNum });
        if (!assignObj!.areaIds.includes(a.id)) {
          assignObj!.areaIds.push(a.id);
          assignObj!.areaLabels.push(`ĐB ${a.code} (${matchedCommune ? matchedCommune.communeName : a.communeId})`);
        }
      });
      validRows++;
      assignObj.rowCount++;
    } else {
      warnings.push(`Dòng ${rowNum}: không nhận được địa bàn (Mã xã "${rawCommuneCode || rawCommuneName}", Mã địa bàn "${rawAreaCode}") để gán cho "${matchedSurveyor.name}". Kiểm tra lại mã xã và mã địa bàn.`);
    }
  });

  return {
    totalRows: rawRows.length,
    validRows,
    assignments: Array.from(assignmentMap.values()).filter(a => a.areaIds.length > 0 || a.communeIds.length > 0),
    warnings,
    blankRows,
  };
}
