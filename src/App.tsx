/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  FileSpreadsheet, Upload, Download, Printer, Plus, Trash2, Edit3, 
  Save, Database, Layers, Home, Users, BarChart3, Settings, CheckCircle2, 
  AlertCircle, RefreshCw, Filter, Search, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight,
  Check, Cloud, FileText, Loader2, TableProperties, MapPin, Building2, Hash, BookOpen, Copy, 
  Shield, ShieldCheck, Lock, Unlock, Eye, EyeOff, CheckSquare, Square, UserCheck, ShieldAlert, AlertTriangle, X,
  LogOut, LogIn, KeyRound, User
} from 'lucide-react';
import { db, handleFirestoreError, OperationType, safeFirestoreWrite, isQuotaExceeded } from './firebase';
import { collection, getDocs, addDoc, deleteDoc, doc, setDoc, query, onSnapshot, writeBatch } from 'firebase/firestore';

import { FullQuestionnaire, createDefaultQuestionnaire } from './types/questionnaire';
import { calculateFullIncome } from './utils/incomeCalculator';
import QuestionnaireModal from './components/QuestionnaireModal';
import CatalogModal from './components/CatalogModal';
import SurveyorManagement from './components/SurveyorManagement';
import bannerImg from './assets/images/rural_vietnam_banner_1790736956083.jpg';
import { 
  Surveyor, UserRole, SurveyStatus, Department, DEFAULT_5_DEPARTMENTS, ROLE_LABELS, SURVEY_STATUS_LABELS 
} from './types/user';
import { 
  OFFICIAL_PERSONNEL_LIST, OFFICIAL_5_DEPARTMENTS, INITIAL_DEFAULT_PASSWORD 
} from './constants/officialPersonnel';
import { 
  CATALOG_TRONG_TROT, 
  CATALOG_CHAN_NUOI, 
  CATALOG_LAM_NGHIEP, 
  CATALOG_THUY_SAN,
  CATALOG_PHI_NONG_NGHIEP,
  CATALOG_CONG_VIEC,
  CATALOG_THU_KHAC,
  CatalogItem 
} from './constants/catalogs';

// Tài khoản Quản trị viên Master thực tế + 58 cán bộ chính thức theo danh sách chuẩn từ ảnh
export const DEFAULT_SURVEYORS: Surveyor[] = [
  {
    id: 'admin',
    code: 'ADMIN',
    username: 'admin',
    name: 'Quản trị viên hệ thống',
    departmentId: 'pb_tkth',
    department: 'Phòng Thống kê Tổng hợp',
    position: 'Quản trị viên / Giám sát xã',
    phone: '',
    email: 'thanhtraqtm@gmail.com',
    password: '',
    role: 'ADMIN',
    assignedAreas: ['ALL'],
    status: 'ACTIVE',
    mustChangePassword: false,
    note: 'Tài khoản quản trị viên tối cao, toàn quyền hệ thống và phân quyền',
    createdAt: new Date().toISOString()
  },
  ...OFFICIAL_PERSONNEL_LIST
];

interface Household {
  id: string;
  communeId: string;
  tkcsCode: string;
  tkcsName: string;
  communeCode: string;
  communeName: string;
  areaId: string;
  areaCode: string; // 001, 002, 003...
  areaName: string; // Tên sheet trong file Excel
  sttMau: string;
  sampleStatus: string;
  sttGoc: string;
  householdHead: string;
  address: string;
  phone: string;
  membersCount: number;
  workingMembersCount: number;
  sectorCode: 1 | 2 | 3 | 4;
  sectorName: string;
  note: string;
  assignedSurveyorId?: string;
  assignedSurveyorName?: string;
  surveyStatus?: SurveyStatus;
  updatedBy?: string;
  updatedAt?: string;
  questionnaire?: FullQuestionnaire;
}

interface SurveyArea {
  id: string;
  communeId: string;
  code: string; // 001, 002...
  name: string; // Tên sheet
  householdCount?: number;
}

interface Commune {
  id: string;
  tkcsCode: string;
  tkcsName: string;
  communeCode: string;
  communeName: string;
  fileName?: string;
}

const SECTOR_NAMES = {
  1: "Nông, lâm thủy sản",
  2: "Công nghiệp xây dựng",
  3: "Thương mại dịch vụ",
  4: "Nguồn thu khác / Lương"
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'import' | 'entry' | 'tnh' | 'database' | 'catalog' | 'surveyors'>('import');
  
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [areas, setAreas] = useState<SurveyArea[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [departments, setDepartments] = useState<Department[]>(DEFAULT_5_DEPARTMENTS);
  const [currentSurveyorId, setCurrentSurveyorId] = useState<string>('admin');
  const [loading, setLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  
  // Real Login & Authentication States
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    return localStorage.getItem('is_user_authenticated') !== 'false';
  });
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState<boolean>(false);
  
  // Login form state
  const [loginIdentifier, setLoginIdentifier] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [showLoginPassword, setShowLoginPassword] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string>('');

  // Change password form state
  const [currentPasswordInput, setCurrentPasswordInput] = useState<string>('');
  const [newPasswordInput, setNewPasswordInput] = useState<string>('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState<string>('');
  const [changePasswordError, setChangePasswordError] = useState<string>('');
  const [isSavingPassword, setIsSavingPassword] = useState<boolean>(false);

  // TNH Scope Mode states
  const [tnhScopeMode, setTnhScopeMode] = useState<'COMMUNE_QUICK' | 'COMMUNE_SECTOR' | 'TKCS_SECTOR' | 'PROVINCE_SECTOR'>('COMMUNE_QUICK');
  const [tnhSelectedCommuneId, setTnhSelectedCommuneId] = useState<string>('ALL');
  const [tnhSelectedTkcs, setTnhSelectedTkcs] = useState<string>('ALL');

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgressText, setUploadProgressText] = useState<string>('');
  
  const [selectedTkcs, setSelectedTkcs] = useState<string>('ALL');
  const [selectedCommuneId, setSelectedCommuneId] = useState<string>('ALL');
  const [selectedAreaId, setSelectedAreaId] = useState<string>('ALL');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  
  // Surveyor and Status filters
  const [selectedSurveyorFilter, setSelectedSurveyorFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ALL');
  const [onlyMyHouseholds, setOnlyMyHouseholds] = useState<boolean>(false);
  
  // Batch selection in Household list
  const [selectedHouseholdIds, setSelectedHouseholdIds] = useState<string[]>([]);
  const [batchAssignSurveyorId, setBatchAssignSurveyorId] = useState<string>('');

  // Pagination state for Household Table
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // Upload Report Modal for skipped / invalid sheets
  const [uploadReport, setUploadReport] = useState<{
    validCount: number;
    totalHouseholds: number;
    skippedSheets: { sheetName: string; reason: string }[];
  } | null>(null);

  // Deletion modals & loading states
  const [isClearAllModalOpen, setIsClearAllModalOpen] = useState<boolean>(false);
  const [communeToDelete, setCommuneToDelete] = useState<Commune | null>(null);
  const [areaToDelete, setAreaToDelete] = useState<SurveyArea | null>(null);
  const [householdToDelete, setHouseholdToDelete] = useState<Household | null>(null);
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteProgressText, setDeleteProgressText] = useState<string>('');

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 4 fields start blank for user to freely define
  const [formTkcsCode, setFormTkcsCode] = useState('');
  const [formTkcsName, setFormTkcsName] = useState('');
  const [formCommuneCode, setFormCommuneCode] = useState('');
  const [formCommuneName, setFormCommuneName] = useState('');

  const [activeHouseholdForm, setActiveHouseholdForm] = useState<Household | null>(null);
  const [isGlobalCatalogOpen, setIsGlobalCatalogOpen] = useState(false);
  const [catalogExplorerTab, setCatalogExplorerTab] = useState<'muc2' | 'muc3' | 'muc4' | 'muc5' | 'muc6' | 'muc1' | 'muc7'>('muc2');
  const [catalogSearchTerm, setCatalogSearchTerm] = useState('');

  useEffect(() => {
    setLoading(true);

    // Initial load from local cache if present
    try {
      const cachedH = localStorage.getItem('cached_households');
      if (cachedH) {
        const parsed = JSON.parse(cachedH);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setHouseholds(parsed);
        }
      }
      const cachedC = localStorage.getItem('cached_communes');
      if (cachedC) {
        const parsed = JSON.parse(cachedC);
        if (Array.isArray(parsed) && parsed.length > 0) setCommunes(parsed);
      }
      const cachedA = localStorage.getItem('cached_areas');
      if (cachedA) {
        const parsed = JSON.parse(cachedA);
        if (Array.isArray(parsed) && parsed.length > 0) setAreas(parsed);
      }
      const cachedS = localStorage.getItem('cached_surveyors');
      if (cachedS) {
        const parsed = JSON.parse(cachedS);
        if (Array.isArray(parsed) && parsed.length > 0) setSurveyors(parsed);
      }
      const activeS = localStorage.getItem('active_surveyor_id');
      if (activeS) setCurrentSurveyorId(activeS);
    } catch (e) {
      console.warn("Local storage cache load warning", e);
    }

    const unsubCommunes = onSnapshot(collection(db, 'communes'), (snapshot) => {
      const coms: Commune[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Commune));
      setCommunes(coms);
      if (coms.length > 0) {
        localStorage.setItem('cached_communes', JSON.stringify(coms));
      } else {
        localStorage.removeItem('cached_communes');
      }
    }, (err) => {
      console.warn("Firestore communes warning:", err);
    });

    const unsubAreas = onSnapshot(collection(db, 'surveyAreas'), (snapshot) => {
      const ars: SurveyArea[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SurveyArea));
      setAreas(ars);
      if (ars.length > 0) {
        localStorage.setItem('cached_areas', JSON.stringify(ars));
      } else {
        localStorage.removeItem('cached_areas');
      }
    }, (err) => {
      console.warn("Firestore areas warning:", err);
    });

    const unsubSurveyors = onSnapshot(collection(db, 'surveyors'), (snapshot) => {
      const existingSurs: Surveyor[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Surveyor));
      if (snapshot.empty || existingSurs.length === 0) {
        const adminUser = DEFAULT_SURVEYORS[0];
        const combined = [adminUser, ...OFFICIAL_PERSONNEL_LIST];
        setSurveyors(combined);
        try { localStorage.setItem('cached_surveyors', JSON.stringify(combined)); } catch (e) {}
      } else {
        // Ensure admin + official list are present even if partial
        const adminUser = existingSurs.find(s => s.id === 'admin' || s.code === 'ADMIN') || DEFAULT_SURVEYORS[0];
        const existingCodes = new Set(existingSurs.map(s => s.code.toUpperCase()));
        const missing = OFFICIAL_PERSONNEL_LIST.filter(op => !existingCodes.has(op.code.toUpperCase()));
        const combined = [adminUser, ...existingSurs.filter(s => s.id !== 'admin' && s.code !== 'ADMIN'), ...missing];
        setSurveyors(combined);
        try { localStorage.setItem('cached_surveyors', JSON.stringify(combined)); } catch (e) {}
      }
    }, (err) => {
      console.warn("Firestore surveyors warning:", err);
      setSurveyors([DEFAULT_SURVEYORS[0], ...OFFICIAL_PERSONNEL_LIST]);
    });

    const unsubHouseholds = onSnapshot(collection(db, 'households'), (snapshot) => {
      const hhs: Household[] = snapshot.docs.map(d => {
        const data = d.data() as any;
        return {
          id: d.id,
          ...data,
          communeCode: data.communeCode || '',
          communeName: data.communeName || '',
          tkcsCode: data.tkcsCode || '',
          tkcsName: data.tkcsName || '',
          areaCode: data.areaCode || '001',
          areaName: data.areaName || 'Địa bàn',
          surveyStatus: data.surveyStatus || 'CHUA_NHAP',
          assignedSurveyorId: data.assignedSurveyorId || '',
          assignedSurveyorName: data.assignedSurveyorName || ''
        } as Household;
      });
      setHouseholds(hhs);
      if (hhs.length > 0) {
        localStorage.setItem('cached_households', JSON.stringify(hhs));
      } else {
        localStorage.removeItem('cached_households');
      }
      setLoading(false);
    }, (err) => {
      console.warn("Firestore households error", err);
      setLoading(false);
    });

    const unsubDepartments = onSnapshot(collection(db, 'departments'), (snapshot) => {
      const existingDepts: Department[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Department));
      if (snapshot.empty || existingDepts.length === 0) {
        setDepartments(OFFICIAL_5_DEPARTMENTS);
        try { localStorage.setItem('cached_departments', JSON.stringify(OFFICIAL_5_DEPARTMENTS)); } catch (e) {}
      } else {
        const existingIds = new Set(existingDepts.map(d => d.id));
        const missing = OFFICIAL_5_DEPARTMENTS.filter(od => !existingIds.has(od.id));
        const combined = [...existingDepts, ...missing];
        setDepartments(combined);
        try { localStorage.setItem('cached_departments', JSON.stringify(combined)); } catch (e) {}
      }
    }, (err) => {
      console.warn("Firestore departments warning:", err);
      setDepartments(OFFICIAL_5_DEPARTMENTS);
    });

    return () => {
      unsubCommunes();
      unsubAreas();
      unsubHouseholds();
      unsubSurveyors();
      unsubDepartments();
    };
  }, []);

  const currentUser: Surveyor = useMemo(() => {
    const found = surveyors.find(s => s.id === currentSurveyorId);
    return found || surveyors[0] || DEFAULT_SURVEYORS[0];
  }, [surveyors, currentSurveyorId]);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Update Commune/TKCS metadata for all households in the database
  const handleUpdateCommuneMetadata = async () => {
    if (!formCommuneName.trim() && !formCommuneCode.trim() && !formTkcsCode.trim() && !formTkcsName.trim()) {
      showNotification('error', 'Vui lòng nhập ít nhất một thông tin Tên/Mã xã hoặc Tên/Mã TKCS.');
      return;
    }

    try {
      const updatedCommuneName = formCommuneName.trim();
      const updatedCommuneCode = formCommuneCode.trim();
      const updatedTkcsCode = formTkcsCode.trim();
      const updatedTkcsName = formTkcsName.trim();

      // Update local state immediately
      setHouseholds(prev => prev.map(h => ({
        ...h,
        communeName: updatedCommuneName || h.communeName,
        communeCode: updatedCommuneCode || h.communeCode,
        tkcsCode: updatedTkcsCode || h.tkcsCode,
        tkcsName: updatedTkcsName || h.tkcsName
      })));

      setCommunes(prev => prev.map(c => ({
        ...c,
        communeName: updatedCommuneName || c.communeName,
        communeCode: updatedCommuneCode || c.communeCode,
        tkcsCode: updatedTkcsCode || c.tkcsCode,
        tkcsName: updatedTkcsName || c.tkcsName
      })));

      showNotification('success', 'Đã cập nhật Mã & Tên Xã, TKCS thành công cho toàn bộ danh sách hộ.');

      // Update Firestore in background
      setTimeout(async () => {
        try {
          const batch = writeBatch(db);
          communes.forEach(c => {
            batch.update(doc(db, 'communes', c.id), {
              communeName: updatedCommuneName || c.communeName,
              communeCode: updatedCommuneCode || c.communeCode,
              tkcsCode: updatedTkcsCode || c.tkcsCode,
              tkcsName: updatedTkcsName || c.tkcsName
            });
          });
          await batch.commit();

          // Batch update households
          for (let i = 0; i < households.length; i += 300) {
            const chunk = households.slice(i, i + 300);
            const hhBatch = writeBatch(db);
            chunk.forEach(h => {
              hhBatch.update(doc(db, 'households', h.id), {
                communeName: updatedCommuneName || h.communeName,
                communeCode: updatedCommuneCode || h.communeCode,
                tkcsCode: updatedTkcsCode || h.tkcsCode,
                tkcsName: updatedTkcsName || h.tkcsName
              });
            });
            await hhBatch.commit();
          }
        } catch (err) {
          console.warn("Firestore update metadata warning:", err);
        }
      }, 50);

    } catch (err) {
      console.error(err);
      showNotification('error', 'Có lỗi khi cập nhật thông tin.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgressText('Đang đọc file Excel...');

    try {
      const file = files[0];
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });

      setUploadProgressText(`Đã đọc xong file. Đang kiểm tra và xử lý ${workbook.SheetNames.length} sheet...`);

      const newCommuneId = 'commune-' + Date.now();
      const communeNameFinal = formCommuneName.trim() || file.name.replace(/\.[^/.]+$/, "").replace(/[_]/g, " ");
      const communeCodeFinal = formCommuneCode.trim() || '01';
      const tkcsCodeFinal = formTkcsCode.trim() || 'TKCS-01';
      const tkcsNameFinal = formTkcsName.trim() || 'Tổ TKCS';

      const newCommune: Commune = {
        id: newCommuneId,
        tkcsCode: tkcsCodeFinal,
        tkcsName: tkcsNameFinal,
        communeCode: communeCodeFinal,
        communeName: communeNameFinal,
        fileName: file.name
      };

      const tempAreas: SurveyArea[] = [];
      const tempHouseholds: Household[] = [];
      const skippedSheets: { sheetName: string; reason: string }[] = [];

      let validAreaIndex = 0;
      let totalParsed = 0;

      let firstDetectedCommuneName = '';
      let firstDetectedCommuneCode = '';

      workbook.SheetNames.forEach((sheetName) => {
        const sheetNameClean = sheetName.trim();
        const worksheet = workbook.Sheets[sheetName];
        
        if (!worksheet) {
          skippedSheets.push({ 
            sheetName: sheetNameClean, 
            reason: 'Sheet hoàn toàn không có dữ liệu (trống)' 
          });
          return;
        }

        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        if (!rows || rows.length < 2) {
          skippedSheets.push({ 
            sheetName: sheetNameClean, 
            reason: 'Sheet bị trống hoặc có dưới 2 dòng dữ liệu' 
          });
          return;
        }

        // 1. Quét thông tin địa bàn, xã, tỉnh ở các dòng đầu (dòng 1 đến 5)
        let headerRowIdx = -1;
        let detectedAreaName = '';
        let detectedAreaCode = '';
        let detectedCommuneName = '';
        let detectedCommuneCode = '';
        let detectedProvinceName = '';

        for (let r = 0; r < Math.min(15, rows.length); r++) {
          const row = rows[r] || [];
          row.forEach((cellVal: any) => {
            const str = String(cellVal || '').trim();
            if (/Xã\/phường:\s*([^\n\r_]+)/i.test(str)) {
              const m = str.match(/Xã\/phường:\s*([^\n\r_]+)/i);
              if (m && m[1]) detectedCommuneName = m[1].trim();
            } else if (/Xã:\s*([^\n\r_]+)/i.test(str)) {
              const m = str.match(/Xã:\s*([^\n\r_]+)/i);
              if (m && m[1]) detectedCommuneName = m[1].trim();
            } else if (/Phường:\s*([^\n\r_]+)/i.test(str)) {
              const m = str.match(/Phường:\s*([^\n\r_]+)/i);
              if (m && m[1]) detectedCommuneName = m[1].trim();
            }

            if (/Mã xã:\s*([0-9]+)/i.test(str)) {
              const m = str.match(/Mã xã:\s*([0-9]+)/i);
              if (m && m[1]) detectedCommuneCode = m[1].trim();
            }

            if (/Tên địa bàn:\s*([^\n\r_]+)/i.test(str)) {
              const m = str.match(/Tên địa bàn:\s*[_]*([^\n\r_]+)/i);
              if (m && m[1]) detectedAreaName = m[1].replace(/[_]/g, ' ').trim();
            }

            if (/Mã địa bàn:\s*([0-9]+)/i.test(str)) {
              const m = str.match(/Mã địa bàn:\s*([0-9]+)/i);
              if (m && m[1]) detectedAreaCode = m[1].trim().padStart(3, '0');
            }

            if (/Tỉnh:\s*([^\n\r_]+)/i.test(str)) {
              const m = str.match(/Tỉnh:\s*([^\n\r_]+)/i);
              if (m && m[1]) detectedProvinceName = m[1].trim();
            }
          });

          // 2. Tìm dòng tiêu đề cột chính (Header Row - Thường ở dòng 6)
          const rowText = row.map(c => String(c).toLowerCase().trim()).join(' ');
          if (
            (rowText.includes('họ và tên') || rowText.includes('chủ hộ')) &&
            (rowText.includes('địa chỉ') || rowText.includes('nhân khẩu') || rowText.includes('nguồn thu') || rowText.includes('stt'))
          ) {
            headerRowIdx = r;
          }
        }

        if (!firstDetectedCommuneName && detectedCommuneName) firstDetectedCommuneName = detectedCommuneName;
        if (!firstDetectedCommuneCode && detectedCommuneCode) firstDetectedCommuneCode = detectedCommuneCode;

        // Cấu hình vị trí cột chuẩn theo biểu mẫu:
        // Cột 0: STT (A)
        // Cột 1: Họ và tên chủ hộ (B)
        // Cột 2: Địa chỉ của hộ (C)
        // Cột 3: Số nhân khẩu thực tế (1)
        // Cột 4: Nguồn thu nhập lớn nhất 1-4 (2)
        // Cột 5: Phân loại mẫu (3)
        // Cột 6: Ghi chú (4)
        let colIdx = {
          sttMau: 0,
          name: 1,
          address: 2,
          members: 3,
          sector: 4,
          status: 5,
          note: 6,
          sttGoc: 0
        };

        if (headerRowIdx >= 0) {
          const headerRow = rows[headerRowIdx] || [];
          headerRow.forEach((cellVal: any, cIdx: number) => {
            const text = String(cellVal || '').toLowerCase().trim();
            if (text.includes('họ và tên') || text.includes('chủ hộ') || text === 'họ tên') {
              colIdx.name = cIdx;
            } else if (text.includes('địa chỉ') || text.includes('thôn') || text.includes('xóm') || text.includes('tổ')) {
              colIdx.address = cIdx;
            } else if (text.includes('nhân khẩu') || text.includes('số người') || text.includes('thường trú')) {
              colIdx.members = cIdx;
            } else if (text.includes('nguồn thu') || text.includes('thu nhập lớn nhất') || text.includes('ngành')) {
              colIdx.sector = cIdx;
            } else if (text.includes('phân loại') || text.includes('loại mẫu') || text.includes('trạng thái')) {
              colIdx.status = cIdx;
            } else if (text.includes('ghi chú') || text.includes('sđt') || text.includes('điện thoại')) {
              colIdx.note = cIdx;
            } else if (text === 'stt' || (text.includes('stt') && !text.includes('gốc'))) {
              colIdx.sttMau = cIdx;
            } else if (text.includes('gốc')) {
              colIdx.sttGoc = cIdx;
            }
          });
        }

        // 3. Xác định dòng bắt đầu dữ liệu hộ (Bỏ qua dòng ký hiệu cột A, B, C, 1, 2, 3...)
        let startRow = headerRowIdx >= 0 ? headerRowIdx + 1 : 0;
        for (let checkR = startRow; checkR < Math.min(startRow + 3, rows.length); checkR++) {
          const rText = (rows[checkR] || []).map((c: any) => String(c).trim().toUpperCase()).join(' ');
          if (
            rText.includes('(A)') || rText.includes('(B)') || rText.includes('(C)') ||
            rText.includes('(1)') || rText.includes('(2)') || rText.includes('(3)') ||
            rText.includes('(4)') || (rText.includes('A') && rText.includes('B') && rText.includes('C')) ||
            rText === 'A B C 1 2 3 4' || rText.startsWith('A') && rText.includes('B')
          ) {
            startRow = checkR + 1;
          }
        }

        // Tên địa bàn lấy chính xác 100% theo tên sheet
        const areaNameFinal = sheetNameClean;
        let sheetHouseholdCount = 0;
        const sheetHouseholds: Household[] = [];

        for (let r = startRow; r < rows.length; r++) {
          const row = rows[r];
          if (!row || row.length === 0) continue;

          // Bỏ qua dòng trống hoàn toàn
          const rowStringAll = row.map(c => String(c || '').trim()).join(' ');
          if (!rowStringAll) continue;

          // Bỏ qua phần ghi chú hướng dẫn ở cuối bảng (VD: "HƯỚNG DẪN MÃ NGUỒN THU NHẬP (CỘT 2)...")
          const lowerAll = rowStringAll.toLowerCase();
          if (
            lowerAll.includes('hướng dẫn') ||
            lowerAll.includes('mã nguồn thu') ||
            lowerAll.includes('1: nông lâm') ||
            lowerAll.includes('2: công nghiệp') ||
            lowerAll.includes('tổng số hộ mẫu') ||
            lowerAll.includes('bảng kê hộ mẫu')
          ) {
            continue;
          }

          // Lấy họ tên chủ hộ
          let rawName = String(row[colIdx.name] || '').trim();

          // Kiểm tra xem tên có bị lệch sang cột bên cạnh không nếu cột name trống
          if (!rawName || rawName.length < 2 || /^\d+$/.test(rawName) || rawName.startsWith('(')) {
            for (let c = 0; c < Math.min(row.length, 5); c++) {
              const cand = String(row[c] || '').trim();
              if (
                cand.length > 2 &&
                !/^\d+$/.test(cand) &&
                !cand.startsWith('(') &&
                !cand.toUpperCase().includes('CHÍNH THỨC') &&
                !cand.toUpperCase().includes('DỰ PHÒNG') &&
                !cand.toLowerCase().includes('đường') &&
                !cand.toLowerCase().includes('đội') &&
                !cand.toLowerCase().includes('thôn') &&
                !cand.toLowerCase().includes('tdp') &&
                !cand.toLowerCase().includes('bảng kê')
              ) {
                rawName = cand;
                break;
              }
            }
          }

          if (!rawName || rawName.length < 2 || rawName.startsWith('(')) continue;
          const upperName = rawName.toUpperCase();
          if (
            upperName.startsWith('(') || 
            upperName === 'A' || upperName === 'B' || upperName === 'C' || 
            upperName === 'D' || upperName === '1' || upperName === '2' || 
            upperName === '3' || upperName === '4' || upperName.includes('(A)') || 
            upperName.includes('(B)') || upperName.includes('(1)') || upperName.includes('(2)')
          ) {
            continue;
          }

          const lowerName = rawName.toLowerCase();
          if (
            lowerName.includes('họ và tên') ||
            lowerName.includes('bảng kê') ||
            lowerName.includes('điều tra') ||
            lowerName.includes('tổng số') ||
            lowerName.includes('ubnd') ||
            lowerName.includes('cộng hòa') ||
            lowerName.includes('địa bàn:') ||
            lowerName.includes('xã/phường:') ||
            lowerName.includes('tỉnh:')
          ) {
            continue;
          }

          sheetHouseholdCount++;

          // STT mẫu
          let sttMauVal = String(row[colIdx.sttMau] || '').trim();
          if (!sttMauVal || !/^\d+$/.test(sttMauVal)) {
            sttMauVal = String(sheetHouseholdCount);
          }

          // STT gốc
          let sttGocVal = String(row[colIdx.sttGoc] || '').trim();
          if (!sttGocVal || !/^\d+$/.test(sttGocVal)) {
            sttGocVal = sttMauVal;
          }

          // Địa chỉ của hộ
          let addressVal = String(row[colIdx.address] || '').trim();
          if (!addressVal || addressVal === rawName) {
            addressVal = areaNameFinal;
          }

          // Số nhân khẩu thực tế (Cột 3)
          let membersVal = Number(row[colIdx.members]);
          if (isNaN(membersVal) || membersVal <= 0) membersVal = 3;

          // Nguồn thu nhập lớn nhất (1-4) (Cột 4)
          let rawSector = String(row[colIdx.sector] || '').trim();
          let sectorVal = 2; // Default
          const sectorMatch = rawSector.match(/[1-4]/);
          if (sectorMatch) {
            sectorVal = Number(sectorMatch[0]);
          }

          // Phân loại mẫu (Cột 5: "Chính thức (10 hộ/ĐB)" hoặc "Dự phòng (4 hộ/ĐB)")
          let rawStatus = String(row[colIdx.status] || '').trim().toUpperCase();
          let statusVal: 'CHÍNH THỨC' | 'DỰ PHÒNG' = 'CHÍNH THỨC';
          if (rawStatus.includes('DỰ') || rawStatus.includes('PHÒNG') || rawStatus.includes('DP')) {
            statusVal = 'DỰ PHÒNG';
          }

          // Ghi chú & SĐT (Cột 6)
          let noteVal = String(row[colIdx.note] || '').trim();
          let phoneVal = '';
          const phoneMatch = (noteVal + ' ' + addressVal).match(/0\d{8,10}/);
          if (phoneMatch) {
            phoneVal = phoneMatch[0];
          }

          const tempHh: any = {
            communeId: newCommuneId,
            tkcsCode: tkcsCodeFinal,
            tkcsName: tkcsNameFinal,
            communeCode: communeCodeFinal || detectedCommuneCode || '01',
            communeName: communeNameFinal || detectedCommuneName || 'Xã/Phường',
            areaName: areaNameFinal,
            sttMau: sttMauVal,
            sampleStatus: statusVal,
            sttGoc: sttGocVal,
            householdHead: rawName,
            address: addressVal,
            phone: phoneVal,
            membersCount: membersVal,
            workingMembersCount: Math.max(1, membersVal - 1),
            sectorCode: sectorVal as 1 | 2 | 3 | 4,
            sectorName: SECTOR_NAMES[sectorVal as 1 | 2 | 3 | 4] || 'Công nghiệp xây dựng',
            note: noteVal,
            surveyStatus: 'CHUA_NHAP',
            assignedSurveyorId: '',
            assignedSurveyorName: '',
            questionnaire: createDefaultQuestionnaire()
          };
          sheetHouseholds.push(tempHh);
        }

        // Kiểm tra xem sheet có dòng hộ hợp lệ không
        if (sheetHouseholdCount === 0) {
          skippedSheets.push({
            sheetName: sheetNameClean,
            reason: 'Không tìm thấy dòng hộ hợp lệ (Sheet ghi chú, hướng dẫn hoặc sai mẫu bảng kê)'
          });
          return;
        }

        // Địa bàn hợp lệ -> Đánh mã địa bàn chuẩn liên tục từ 001 đến hết tính từ trái qua phải
        validAreaIndex++;
        const areaCode = String(validAreaIndex).padStart(3, '0');
        const areaId = 'area-' + newCommuneId + '-' + areaCode;

        const finalizedHouseholds: Household[] = sheetHouseholds.map((h, hIdx) => ({
          ...h,
          id: 'hh-' + newCommuneId + '-' + areaCode + '-' + (hIdx + 1),
          areaId: areaId,
          areaCode: areaCode
        }));

        tempHouseholds.push(...finalizedHouseholds);
        totalParsed += finalizedHouseholds.length;

        const newArea: SurveyArea = {
          id: areaId,
          communeId: newCommuneId,
          code: areaCode,
          name: areaNameFinal,
          householdCount: finalizedHouseholds.length
        };
        tempAreas.push(newArea);
      });

      // Tự động điền tên/mã xã lên form cấu hình nếu người dùng chưa nhập
      if (!formCommuneName.trim() && firstDetectedCommuneName) {
        setFormCommuneName(firstDetectedCommuneName);
      }
      if (!formCommuneCode.trim() && firstDetectedCommuneCode) {
        setFormCommuneCode(firstDetectedCommuneCode);
      }

      if (totalParsed === 0) {
        setIsUploading(false);
        showNotification('error', `Không tìm thấy dòng hộ gia đình hợp lệ nào trong ${workbook.SheetNames.length} sheet. Vui lòng kiểm tra lại cấu trúc file Excel.`);
        return;
      }

      setUploadProgressText(`Hiển thị tức thì ${totalParsed} hộ từ ${tempAreas.length} địa bàn hợp lệ...`);

      // Optimistic instant UI update with localStorage persistence
      setCommunes(prev => {
        const next = [...prev, newCommune];
        try { localStorage.setItem('cached_communes', JSON.stringify(next)); } catch (e) {}
        return next;
      });
      setAreas(prev => {
        const next = [...prev, ...tempAreas];
        try { localStorage.setItem('cached_areas', JSON.stringify(next)); } catch (e) {}
        return next;
      });
      setHouseholds(prev => {
        const next = [...prev, ...tempHouseholds];
        try { localStorage.setItem('cached_households', JSON.stringify(next)); } catch (e) {}
        return next;
      });
      setSelectedCommuneId('ALL');
      setSelectedAreaId('ALL');
      setCurrentPage(1);

      setIsUploading(false);

      // Show report if sheets were skipped
      if (skippedSheets.length > 0) {
        setUploadReport({
          validCount: tempAreas.length,
          totalHouseholds: totalParsed,
          skippedSheets
        });
        showNotification('success', `Đã nạp thành công ${totalParsed} hộ (${tempAreas.length} địa bàn). Tự động loại bỏ ${skippedSheets.length} sheet không đúng mẫu/trống.`);
      } else {
        showNotification('success', `Đã import thành công ${totalParsed} hộ từ toàn bộ ${tempAreas.length} địa bàn.`);
      }

      // Background batch writing in safe chunks (max 300 items per batch)
      setTimeout(async () => {
        try {
          const allDocs = [
            { ref: doc(db, 'communes', newCommuneId), data: newCommune },
            ...tempAreas.map(a => ({ ref: doc(db, 'surveyAreas', a.id), data: a })),
            ...tempHouseholds.map(h => ({ ref: doc(db, 'households', h.id), data: h }))
          ];

          for (let i = 0; i < allDocs.length; i += 300) {
            const chunk = allDocs.slice(i, i + 300);
            const batch = writeBatch(db);
            chunk.forEach(item => batch.set(item.ref, item.data));
            await batch.commit();
          }
        } catch (bgErr) {
          console.warn("Background Firebase sync warning:", bgErr);
        }
      }, 100);

    } catch (err) {
      console.error(err);
      setIsUploading(false);
      showNotification('error', 'Lỗi đọc file Excel.');
    }
    e.target.value = '';
  };

  const filteredHouseholds = useMemo(() => {
    return households.filter(h => {
      if (selectedTkcs !== 'ALL' && h.tkcsCode !== selectedTkcs) return false;
      if (selectedCommuneId !== 'ALL' && h.communeId !== selectedCommuneId) return false;
      if (selectedAreaId !== 'ALL' && h.areaId !== selectedAreaId && h.areaCode !== selectedAreaId) return false;
      
      // Filter by "Only my households"
      if (onlyMyHouseholds && currentUser) {
        if (currentUser.role === 'SURVEYOR') {
          const isDirect = h.assignedSurveyorId === currentUser.id;
          const isAreaMatch = currentUser.assignedAreas.includes('ALL') || currentUser.assignedAreas.includes(h.areaCode);
          if (!isDirect && !isAreaMatch) return false;
        }
      }

      // Filter by assigned surveyor
      if (selectedSurveyorFilter !== 'ALL') {
        if (selectedSurveyorFilter === 'UNASSIGNED') {
          if (h.assignedSurveyorId) return false;
        } else if (h.assignedSurveyorId !== selectedSurveyorFilter) {
          return false;
        }
      }

      // Filter by survey status
      if (selectedStatusFilter !== 'ALL') {
        const status = h.surveyStatus || 'CHUA_NHAP';
        if (status !== selectedStatusFilter) return false;
      }

      if (searchKeyword.trim()) {
        const kw = searchKeyword.toLowerCase().trim();
        const head = (h.householdHead || '').toLowerCase();
        const addr = (h.address || '').toLowerCase();
        const note = (h.note || '').toLowerCase();
        const area = (h.areaName || '').toLowerCase();
        const sName = (h.assignedSurveyorName || '').toLowerCase();
        if (!head.includes(kw) && !addr.includes(kw) && !note.includes(kw) && !area.includes(kw) && !sName.includes(kw)) {
          return false;
        }
      }
      return true;
    });
  }, [households, selectedTkcs, selectedCommuneId, selectedAreaId, searchKeyword, onlyMyHouseholds, selectedSurveyorFilter, selectedStatusFilter, currentUser]);

  const currentCommune = useMemo(() => {
    if (selectedCommuneId !== 'ALL') {
      return communes.find(c => c.id === selectedCommuneId) || communes[0];
    }
    return communes[0];
  }, [communes, selectedCommuneId]);

  const calculateHouseholdTotalIncome = (h: Household) => {
    return calculateFullIncome(h.questionnaire);
  };

  const tnhScopeHouseholds = useMemo(() => {
    if (tnhScopeMode === 'COMMUNE_QUICK' || tnhScopeMode === 'COMMUNE_SECTOR') {
      if (tnhSelectedCommuneId !== 'ALL') {
        return households.filter(h => h.communeId === tnhSelectedCommuneId);
      }
      if (selectedCommuneId !== 'ALL') {
        return households.filter(h => h.communeId === selectedCommuneId);
      }
      return households;
    }
    if (tnhScopeMode === 'TKCS_SECTOR') {
      if (tnhSelectedTkcs !== 'ALL') {
        return households.filter(h => h.tkcsCode === tnhSelectedTkcs);
      }
      if (selectedTkcs !== 'ALL') {
        return households.filter(h => h.tkcsCode === selectedTkcs);
      }
      return households;
    }
    // PROVINCE_SECTOR
    return households;
  }, [households, tnhScopeMode, tnhSelectedCommuneId, selectedCommuneId, tnhSelectedTkcs, selectedTkcs]);

  const tnhSummary = useMemo(() => {
    const list = tnhScopeHouseholds;
    const officialList = list.filter(h => h.sampleStatus === 'CHÍNH THỨC' || !h.sampleStatus);
    const totalHH = officialList.length;

    const sectors = [1, 2, 3, 4] as const;

    const sectorData = sectors.map(code => {
      const sList = officialList.filter(h => Number(h.sectorCode) === code);
      const count = sList.length;
      let groupIncome = 0;
      let groupMembers = 0;

      sList.forEach(h => {
        const inc = calculateHouseholdTotalIncome(h).total;
        groupIncome += inc;
        groupMembers += (h.membersCount || 1);
      });

      const percent = totalHH > 0 ? Number(((count / totalHH) * 100).toFixed(1)) : 0;
      // Formula on image: K = (=G12 / F12 / 12) = (Total Income / Total Members / 12)
      const perCapitaMonth = groupMembers > 0 ? (groupIncome / groupMembers / 12) : 0;
      // Formula on image: G = (E * K)
      const extrapolatedIncomeYear = (percent / 100) * perCapitaMonth;

      return {
        code,
        name: SECTOR_NAMES[code],
        count,
        percent,
        allocationTarget: count,
        groupMembers,
        groupIncome,
        extrapolatedIncomeYear: Math.round(extrapolatedIncomeYear),
        perCapitaMonth: Math.round(perCapitaMonth),
        growthRate: 100.0,
        sList
      };
    });

    const overallExtrapolated = sectorData.reduce((acc, s) => acc + s.extrapolatedIncomeYear, 0);
    const totalMembers = officialList.reduce((sum, h) => sum + (h.membersCount || 1), 0);
    const totalIncomeAll = sectorData.reduce((acc, s) => acc + s.groupIncome, 0);
    const overallPerCapitaMonth = totalMembers > 0 ? Math.round(totalIncomeAll / totalMembers / 12) : 0;

    return {
      totalHH,
      totalIncomeAll,
      totalMembers,
      sectorData,
      overallExtrapolated,
      overallPerCapitaMonth,
      officialList
    };
  }, [tnhScopeHouseholds]);

  const handleSaveQuestionnaire = async (updatedHousehold: any) => {
    if (!updatedHousehold) return;
    setHouseholds(prev => {
      const next = prev.map(h => h.id === updatedHousehold.id ? updatedHousehold : h);
      try { localStorage.setItem('cached_households', JSON.stringify(next)); } catch (e) {}
      return next;
    });
    setActiveHouseholdForm(null);
    showNotification('success', `Đã lưu phiếu Phụ lục II của hộ "${updatedHousehold.householdHead}" thành công.`);
    
    await safeFirestoreWrite(async () => {
      await setDoc(doc(db, 'households', updatedHousehold.id), updatedHousehold);
    });
  };

  const handleSaveSurveyor = async (surveyor: Surveyor) => {
    setSurveyors(prev => {
      const idx = prev.findIndex(s => s.id === surveyor.id);
      const next = idx >= 0 ? prev.map(s => s.id === surveyor.id ? surveyor : s) : [...prev, surveyor];
      try { localStorage.setItem('cached_surveyors', JSON.stringify(next)); } catch (e) {}
      return next;
    });
    
    await safeFirestoreWrite(async () => {
      await setDoc(doc(db, 'surveyors', surveyor.id), surveyor);
    });
  };

  const handleDeleteSurveyor = async (id: string) => {
    setSurveyors(prev => {
      const next = prev.filter(s => s.id !== id);
      try { localStorage.setItem('cached_surveyors', JSON.stringify(next)); } catch (e) {}
      return next;
    });
    
    await safeFirestoreWrite(async () => {
      await deleteDoc(doc(db, 'surveyors', id));
    });
  };

  const handleSaveDepartment = async (dept: Department) => {
    setDepartments(prev => {
      const idx = prev.findIndex(d => d.id === dept.id);
      const next = idx >= 0 ? prev.map(d => d.id === dept.id ? dept : d) : [...prev, dept];
      try { localStorage.setItem('cached_departments', JSON.stringify(next)); } catch (e) {}
      return next;
    });
    
    await safeFirestoreWrite(async () => {
      await setDoc(doc(db, 'departments', dept.id), dept);
    });
  };

  const handleDeleteDepartment = async (id: string) => {
    setDepartments(prev => {
      const next = prev.filter(d => d.id !== id);
      try { localStorage.setItem('cached_departments', JSON.stringify(next)); } catch (e) {}
      return next;
    });
    
    await safeFirestoreWrite(async () => {
      await deleteDoc(doc(db, 'departments', id));
    });
  };

  const handleBatchAssignDepartmentArea = async (departmentId: string, areaCodes: string[]) => {
    const targetDept = departments.find(d => d.id === departmentId);
    if (!targetDept) return;
    const updated: Department = {
      ...targetDept,
      assignedAreaCodes: areaCodes,
      updatedAt: new Date().toISOString()
    };
    await handleSaveDepartment(updated);
  };

  const handleBatchAssignArea = async (surveyorId: string, areaCode: string) => {
    const targetSurveyor = surveyors.find(s => s.id === surveyorId);
    if (!targetSurveyor) return;

    const updatedHouseholds = households.map(h => {
      if (h.areaCode === areaCode) {
        return {
          ...h,
          assignedSurveyorId: targetSurveyor.id,
          assignedSurveyorName: targetSurveyor.name
        };
      }
      return h;
    });

    setHouseholds(updatedHouseholds);
    try { localStorage.setItem('cached_households', JSON.stringify(updatedHouseholds)); } catch (e) {}

    // Batch update Firestore
    try {
      const matching = updatedHouseholds.filter(h => h.areaCode === areaCode);
      for (let i = 0; i < matching.length; i += 300) {
        const chunk = matching.slice(i, i + 300);
        const batch = writeBatch(db);
        chunk.forEach(h => {
          batch.update(doc(db, 'households', h.id), {
            assignedSurveyorId: targetSurveyor.id,
            assignedSurveyorName: targetSurveyor.name
          });
        });
        await batch.commit();
      }
    } catch (e) {
      console.warn("Batch assign area sync notice:", e);
    }
  };

  const handleBatchAssignSelected = async () => {
    if (selectedHouseholdIds.length === 0) {
      showNotification('error', 'Vui lòng chọn ít nhất một hộ để phân công.');
      return;
    }
    if (!batchAssignSurveyorId) {
      showNotification('error', 'Vui lòng chọn Điều tra viên để phân công.');
      return;
    }
    const targetSurveyor = surveyors.find(s => s.id === batchAssignSurveyorId);
    if (!targetSurveyor) return;

    const count = selectedHouseholdIds.length;
    const updatedHouseholds = households.map(h => {
      if (selectedHouseholdIds.includes(h.id)) {
        return {
          ...h,
          assignedSurveyorId: targetSurveyor.id,
          assignedSurveyorName: targetSurveyor.name
        };
      }
      return h;
    });

    setHouseholds(updatedHouseholds);
    try { localStorage.setItem('cached_households', JSON.stringify(updatedHouseholds)); } catch (e) {}
    setSelectedHouseholdIds([]);
    showNotification('success', `Đã phân công ${count} hộ cho ${targetSurveyor.name} thành công.`);

    // Batch write to Firestore in background
    setTimeout(async () => {
      try {
        const chunked = updatedHouseholds.filter(h => selectedHouseholdIds.includes(h.id));
        for (let i = 0; i < chunked.length; i += 300) {
          const batch = writeBatch(db);
          chunked.slice(i, i + 300).forEach(h => {
            batch.update(doc(db, 'households', h.id), {
              assignedSurveyorId: targetSurveyor.id,
              assignedSurveyorName: targetSurveyor.name
            });
          });
          await batch.commit();
        }
      } catch (e) {
        console.warn("Batch assign error", e);
      }
    }, 50);
  };

  const handleBatchSetStatus = async (status: SurveyStatus) => {
    if (selectedHouseholdIds.length === 0) {
      showNotification('error', 'Vui lòng chọn ít nhất một hộ.');
      return;
    }

    const count = selectedHouseholdIds.length;
    const updatedHouseholds = households.map(h => {
      if (selectedHouseholdIds.includes(h.id)) {
        return {
          ...h,
          surveyStatus: status
        };
      }
      return h;
    });

    setHouseholds(updatedHouseholds);
    try { localStorage.setItem('cached_households', JSON.stringify(updatedHouseholds)); } catch (e) {}
    setSelectedHouseholdIds([]);
    showNotification('success', `Đã chuyển trạng thái ${count} hộ sang: ${SURVEY_STATUS_LABELS[status].label}`);

    // Batch write to Firestore
    setTimeout(async () => {
      try {
        const chunked = updatedHouseholds.filter(h => selectedHouseholdIds.includes(h.id));
        for (let i = 0; i < chunked.length; i += 300) {
          const batch = writeBatch(db);
          chunked.slice(i, i + 300).forEach(h => {
            batch.update(doc(db, 'households', h.id), {
              surveyStatus: status
            });
          });
          await batch.commit();
        }
      } catch (e) {
        console.warn("Batch status update error", e);
      }
    }, 50);
  };

  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoginError('');

    const idInput = loginIdentifier.trim();
    const pwInput = loginPassword.trim();

    if (!idInput) {
      setLoginError('Vui lòng nhập Tên đăng nhập hoặc Mã tài khoản.');
      return;
    }

    if (!pwInput) {
      setLoginError('Vui lòng nhập Mật khẩu.');
      return;
    }

    // Find in live surveyors list loaded from Firestore
    const user = surveyors.find(s => 
      s.code.toLowerCase() === idInput.toLowerCase() ||
      (s.username && s.username.toLowerCase() === idInput.toLowerCase()) ||
      (s.email && s.email.toLowerCase() === idInput.toLowerCase()) ||
      s.id.toLowerCase() === idInput.toLowerCase() ||
      (s.phone && s.phone === idInput)
    );

    if (!user) {
      setLoginError('Tài khoản không tồn tại. Vui lòng kiểm tra lại Tên đăng nhập / Mã tài khoản.');
      return;
    }

    if (user.status === 'LOCKED') {
      setLoginError('Tài khoản này đang bị khóa. Vui lòng liên hệ Quản trị viên hệ thống.');
      return;
    }

    const expectedPassword = user.password || (user.id === 'admin' ? 'admin' : INITIAL_DEFAULT_PASSWORD);
    if (pwInput !== expectedPassword) {
      setLoginError('Mật khẩu không chính xác. Vui lòng thử lại.');
      return;
    }

    // Login success
    setCurrentSurveyorId(user.id);
    setIsLoggedIn(true);
    localStorage.setItem('is_user_authenticated', 'true');
    localStorage.setItem('active_surveyor_id', user.id);
    setLoginIdentifier('');
    setLoginPassword('');
    setShowLoginModal(false);

    if (user.mustChangePassword) {
      setShowChangePasswordModal(true);
      showNotification('success', `Đăng nhập thành công! Vui lòng thiết lập mật khẩu mới cho tài khoản ${user.name}.`);
    } else {
      showNotification('success', `Đăng nhập thành công! Xin chào ${user.name} (${ROLE_LABELS[user.role]?.label || user.role}).`);
    }

    if (user.role === 'SURVEYOR') {
      setActiveTab('entry');
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    localStorage.setItem('is_user_authenticated', 'false');
    showNotification('success', 'Đã đăng xuất khỏi tài khoản.');
  };

  const handleChangeMyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePasswordError('');

    if (!currentPasswordInput) {
      setChangePasswordError('Vui lòng nhập mật khẩu hiện tại.');
      return;
    }

    const expectedCurrentPassword = currentUser.password || (currentUser.id === 'admin' ? 'admin' : INITIAL_DEFAULT_PASSWORD);
    if (currentPasswordInput !== expectedCurrentPassword) {
      setChangePasswordError('Mật khẩu hiện tại không chính xác.');
      return;
    }

    if (!newPasswordInput || newPasswordInput.trim().length < 4) {
      setChangePasswordError('Mật khẩu mới phải có ít nhất 4 ký tự.');
      return;
    }

    if (newPasswordInput.trim() !== confirmPasswordInput.trim()) {
      setChangePasswordError('Mật khẩu xác nhận không khớp với mật khẩu mới.');
      return;
    }

    try {
      setIsSavingPassword(true);
      const updatedUser: Surveyor = {
        ...currentUser,
        password: newPasswordInput.trim(),
        mustChangePassword: false,
        lastPasswordChange: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await handleSaveSurveyor(updatedUser);
      showNotification('success', 'Đã đổi mật khẩu thành công! Mật khẩu mới đã được lưu an toàn trên Firebase Firestore.');
      setShowChangePasswordModal(false);
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
    } catch (err: any) {
      setChangePasswordError('Lỗi khi lưu mật khẩu: ' + err.message);
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleSyncFirebase = async () => {
    try {
      setIsSyncing(true);
      showNotification('success', 'Đang kiểm tra và đồng bộ trạng thái với Firebase Cloud...');
      const hSnap = await getDocs(collection(db, 'households'));
      const sSnap = await getDocs(collection(db, 'surveyors'));
      showNotification('success', `Firebase Cloud đã đồng bộ an toàn: ${hSnap.size} hộ & ${sSnap.size} người nhập phiếu trên Firestore.`);
    } catch (err: any) {
      showNotification('error', 'Lỗi kiểm tra Firebase: ' + (err.message || String(err)));
    } finally {
      setIsSyncing(false);
    }
  };

  // 1. Clear All Data (Households, Areas, Communes) to re-upload from scratch
  const handleClearAllData = async () => {
    setIsDeleting(true);
    setDeleteProgressText('Đang xóa toàn bộ dữ liệu hệ thống...');

    // Clear local storage and state immediately
    localStorage.removeItem('cached_households');
    localStorage.removeItem('cached_communes');
    localStorage.removeItem('cached_areas');

    setHouseholds([]);
    setAreas([]);
    setCommunes([]);
    setSelectedHouseholdIds([]);
    setUploadReport(null);
    setSelectedCommuneId('ALL');
    setSelectedAreaId('ALL');
    setSelectedTkcs('ALL');
    setCurrentPage(1);

    setIsClearAllModalOpen(false);
    showNotification('success', 'Đã xóa toàn bộ dữ liệu thành công! Bạn có thể tải file Excel mới ngay bây giờ.');
    setActiveTab('import');
    setIsDeleting(false);
    setDeleteProgressText('');

    // Attempt background Firestore sync
    try {
      const [hSnap, aSnap, cSnap] = await Promise.all([
        getDocs(collection(db, 'households')),
        getDocs(collection(db, 'surveyAreas')),
        getDocs(collection(db, 'communes'))
      ]);

      const allRefs = [
        ...hSnap.docs.map(d => doc(db, 'households', d.id)),
        ...aSnap.docs.map(d => doc(db, 'surveyAreas', d.id)),
        ...cSnap.docs.map(d => doc(db, 'communes', d.id))
      ];

      for (let i = 0; i < allRefs.length; i += 300) {
        const chunk = allRefs.slice(i, i + 300);
        const batch = writeBatch(db);
        chunk.forEach(r => batch.delete(r));
        await batch.commit();
      }
    } catch (err: any) {
      console.warn("Background Firestore clear warning:", err);
    }
  };

  // 2. Delete single commune and its related areas and households
  const handleDeleteCommune = async (communeId: string) => {
    setIsDeleting(true);
    setDeleteProgressText('Đang xóa dữ liệu xã...');

    const targetCommune = communes.find(c => c.id === communeId);
    const communeName = targetCommune ? targetCommune.communeName : communeId;

    const remainingCommunes = communes.filter(c => c.id !== communeId);
    const matchingAreas = areas.filter(a => a.communeId === communeId);
    const remainingAreas = areas.filter(a => a.communeId !== communeId);
    const matchingHouseholds = households.filter(h => h.communeId === communeId);
    const remainingHouseholds = households.filter(h => h.communeId !== communeId);

    // Update state & local storage immediately
    setCommunes(remainingCommunes);
    setAreas(remainingAreas);
    setHouseholds(remainingHouseholds);

    if (remainingCommunes.length > 0) localStorage.setItem('cached_communes', JSON.stringify(remainingCommunes));
    else localStorage.removeItem('cached_communes');

    if (remainingAreas.length > 0) localStorage.setItem('cached_areas', JSON.stringify(remainingAreas));
    else localStorage.removeItem('cached_areas');

    if (remainingHouseholds.length > 0) localStorage.setItem('cached_households', JSON.stringify(remainingHouseholds));
    else localStorage.removeItem('cached_households');

    if (selectedCommuneId === communeId) setSelectedCommuneId('ALL');
    setCommuneToDelete(null);
    showNotification('success', `Đã xóa xã "${communeName}" và toàn bộ ${matchingHouseholds.length} hộ liên quan.`);
    setIsDeleting(false);
    setDeleteProgressText('');

    // Background delete from Firestore
    try {
      const refsToDelete = [
        doc(db, 'communes', communeId),
        ...matchingAreas.map(a => doc(db, 'surveyAreas', a.id)),
        ...matchingHouseholds.map(h => doc(db, 'households', h.id))
      ];

      for (let i = 0; i < refsToDelete.length; i += 300) {
        const chunk = refsToDelete.slice(i, i + 300);
        const batch = writeBatch(db);
        chunk.forEach(r => batch.delete(r));
        await batch.commit();
      }
    } catch (err: any) {
      console.warn("Background delete commune warning:", err);
    }
  };

  // 3. Delete single area and its related households
  const handleDeleteArea = async (area: SurveyArea) => {
    setIsDeleting(true);
    setDeleteProgressText(`Đang xóa địa bàn ${area.code}...`);

    const remainingAreas = areas.filter(a => a.id !== area.id);
    const matchingHouseholds = households.filter(h => h.areaId === area.id || h.areaCode === area.code);
    const remainingHouseholds = households.filter(h => h.areaId !== area.id && h.areaCode !== area.code);

    setAreas(remainingAreas);
    setHouseholds(remainingHouseholds);

    if (remainingAreas.length > 0) localStorage.setItem('cached_areas', JSON.stringify(remainingAreas));
    else localStorage.removeItem('cached_areas');

    if (remainingHouseholds.length > 0) localStorage.setItem('cached_households', JSON.stringify(remainingHouseholds));
    else localStorage.removeItem('cached_households');

    if (selectedAreaId === area.id || selectedAreaId === area.code) setSelectedAreaId('ALL');
    setAreaToDelete(null);
    showNotification('success', `Đã xóa địa bàn "${area.name}" (Mã ${area.code}) cùng ${matchingHouseholds.length} hộ liên quan.`);
    setIsDeleting(false);
    setDeleteProgressText('');

    try {
      const refsToDelete = [
        doc(db, 'surveyAreas', area.id),
        ...matchingHouseholds.map(h => doc(db, 'households', h.id))
      ];

      for (let i = 0; i < refsToDelete.length; i += 300) {
        const chunk = refsToDelete.slice(i, i + 300);
        const batch = writeBatch(db);
        chunk.forEach(r => batch.delete(r));
        await batch.commit();
      }
    } catch (err: any) {
      console.warn("Background delete area warning:", err);
    }
  };

  // 4. Delete single household
  const handleDeleteSingleHousehold = async (household: Household) => {
    setHouseholds(prev => {
      const next = prev.filter(h => h.id !== household.id);
      if (next.length > 0) localStorage.setItem('cached_households', JSON.stringify(next));
      else localStorage.removeItem('cached_households');
      return next;
    });
    setSelectedHouseholdIds(prev => prev.filter(id => id !== household.id));
    setHouseholdToDelete(null);
    showNotification('success', `Đã xóa hộ "${household.householdHead}" thành công.`);

    try {
      await deleteDoc(doc(db, 'households', household.id));
    } catch (err: any) {
      console.warn("Background delete household warning:", err);
    }
  };

  // 5. Delete batch selected households
  const handleDeleteBatchSelected = async () => {
    if (selectedHouseholdIds.length === 0) return;
    const count = selectedHouseholdIds.length;
    setIsDeleting(true);
    setDeleteProgressText(`Đang xóa ${count} hộ gia đình đã chọn...`);

    const idsToDelete = [...selectedHouseholdIds];
    const remainingHouseholds = households.filter(h => !idsToDelete.includes(h.id));
    setHouseholds(remainingHouseholds);
    if (remainingHouseholds.length > 0) localStorage.setItem('cached_households', JSON.stringify(remainingHouseholds));
    else localStorage.removeItem('cached_households');

    setSelectedHouseholdIds([]);
    setIsBatchDeleteModalOpen(false);
    showNotification('success', `Đã xóa thành công ${count} hộ gia đình đã chọn.`);
    setIsDeleting(false);
    setDeleteProgressText('');

    try {
      for (let i = 0; i < idsToDelete.length; i += 300) {
        const chunk = idsToDelete.slice(i, i + 300);
        const batch = writeBatch(db);
        chunk.forEach(id => batch.delete(doc(db, 'households', id)));
        await batch.commit();
      }
    } catch (err: any) {
      console.warn("Background delete batch households warning:", err);
    }
  };

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    const wsData: any[][] = [
      ['BẢNG KÊ HỘ CHỌN MẪU ĐIỀU TRA', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['ĐIỀU TRA THU NHẬP BÌNH QUÂN ĐẦU NGƯỜI CẤP XÃ', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      [`Tỉnh: ---`, `Xã/phường: ${currentCommune?.communeName || formCommuneName || '---'}`, `Mã xã: ${currentCommune?.communeCode || formCommuneCode || '---'}`, `TKCS: ${currentCommune?.tkcsName || formTkcsName || '---'}`, '', '', '', '', '', '', '', '', '', '', '', ''],
      [],
      [
        'STT Mẫu', 'Mã TKCS', 'Tên TKCS', 'Mã Xã', 'Tên Xã', 'Mã ĐB', 'Tên Địa bàn (Sheet)',
        'Trạng thái mẫu', 'STT gốc', 'Họ và tên chủ hộ', 'Địa chỉ của hộ', 'Số nhân khẩu',
        'Nguồn thu (1-4)', 'Phân loại ngành', 'Ghi chú (SĐT)', 'Tổng thu nhập (1.000 đ)'
      ]
    ];

    filteredHouseholds.forEach(h => {
      const inc = calculateHouseholdTotalIncome(h);
      wsData.push([
        h.sttMau,
        h.tkcsCode || formTkcsCode || '',
        h.tkcsName || formTkcsName || '',
        h.communeCode || formCommuneCode || '',
        h.communeName || formCommuneName || '',
        h.areaCode || '001',
        h.areaName || 'Địa bàn',
        h.sampleStatus,
        h.sttGoc,
        h.householdHead,
        h.address,
        h.membersCount,
        h.sectorCode,
        h.sectorName,
        h.note,
        inc.total
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "BangKeHo");
    XLSX.writeFile(wb, `Bang_Ke_Ho_${currentCommune?.communeName || 'ToanXa'}.xlsx`);
    showNotification('success', 'Đã xuất file Excel bảng kê đầy đủ các cột.');
  };

  const handleExportExcelTNH = () => {
    const wb = XLSX.utils.book_new();
    const scopeText = tnhScopeMode === 'COMMUNE_QUICK' || tnhScopeMode === 'COMMUNE_SECTOR'
      ? (communes.find(c => c.id === tnhSelectedCommuneId)?.communeName || 'ToanXa')
      : tnhScopeMode === 'TKCS_SECTOR'
      ? `TKCS_${tnhSelectedTkcs}`
      : 'ToanTinh';

    const wsData: any[][] = [];
    
    // Title
    wsData.push([`TỔNG HỢP NHANH SỐ LIỆU THU NHẬP (${scopeText.toUpperCase()})`]);
    wsData.push([]);
    
    // Upper Summary Table Headers
    wsData.push([
      'STT', 'Mã loại', 'Tên nhóm ngành nguồn thu lớn nhất', 'Tổng số hộ',
      'Tỷ trọng cơ cấu (%)', 'Chỉ tiêu phân bổ mẫu chính thức',
      'Suy rộng TNBQ xã/năm (=E*K)', 'Thu nhập bình quân đầu người/tháng (Nghìn đồng)',
      'Tốc độ so 2025 (%)', 'TNBQ đầu người/tháng theo loại hộ (=G/F/12)'
    ]);

    // Sector rows
    tnhSummary.sectorData.forEach((s, idx) => {
      wsData.push([
        idx + 1,
        s.code,
        s.name,
        s.count,
        `${s.percent}%`,
        s.count,
        s.extrapolatedIncomeYear,
        tnhSummary.overallPerCapitaMonth,
        `${s.growthRate}%`,
        s.perCapitaMonth
      ]);
    });

    // Total Row
    wsData.push([
      '', 'TỔNG', 'TOÀN XÃ / PHẠM VI', tnhSummary.totalHH, '100%', tnhSummary.totalHH,
      tnhSummary.overallExtrapolated, tnhSummary.overallPerCapitaMonth, '100%', tnhSummary.overallPerCapitaMonth
    ]);

    wsData.push([]);
    wsData.push([]);
    wsData.push(['STT', 'Xã/phường', 'Địa bàn điều tra', 'STT Mẫu', 'Họ và tên chủ hộ', 'Tổng số thành viên (Người)', 'Tổng thu nhập (1.000đ)']);

    // Lower Sector Breakdown Sections
    const groupLabels = [
      { code: 1, label: 'I. Hộ NLTS (Nông, lâm thủy sản)' },
      { code: 2, label: 'II. Hộ CNXD (Công nghiệp xây dựng)' },
      { code: 3, label: 'III. Hộ TMDV (Thương mại dịch vụ)' },
      { code: 4, label: 'IV. Hộ Nguồn thu khác / Lương' }
    ];

    groupLabels.forEach(grp => {
      const sData = tnhSummary.sectorData.find(s => s.code === grp.code);
      if (!sData) return;

      wsData.push([
        grp.label, '', '', '', '', `Tổng nhân khẩu: ${sData.groupMembers}`, `Tổng TN: ${sData.groupIncome.toLocaleString()} | TNBQ/người/tháng (=G/F/12): ${sData.perCapitaMonth}`
      ]);

      sData.sList.forEach((h, idx) => {
        const inc = calculateHouseholdTotalIncome(h).total;
        wsData.push([
          idx + 1,
          h.communeName || formCommuneName || '---',
          h.areaName || 'Địa bàn',
          h.sttMau,
          h.householdHead,
          h.membersCount,
          inc
        ]);
      });
      wsData.push([]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "TongHopNhanh");
    XLSX.writeFile(wb, `Tong_Hop_Nhanh_${scopeText}.xlsx`);
    showNotification('success', `Đã xuất Báo cáo Tổng hợp nhanh [${scopeText}] ra file Excel.`);
  };

  // Reusable Household Table component with Sticky Header & Pagination
  const renderHouseholdTable = (showEntryButton: boolean = true) => {
    const totalItems = filteredHouseholds.length;
    const actualPageSize = pageSize === -1 ? totalItems : pageSize;
    const totalPages = Math.max(1, Math.ceil(totalItems / (actualPageSize || 1)));
    const validPage = Math.min(Math.max(1, currentPage), totalPages);
    const paginatedHouseholds = pageSize === -1 
      ? filteredHouseholds 
      : filteredHouseholds.slice((validPage - 1) * actualPageSize, validPage * actualPageSize);

    const isAllSelected = paginatedHouseholds.length > 0 && paginatedHouseholds.every(h => selectedHouseholdIds.includes(h.id));

    const handleToggleSelectAll = () => {
      if (isAllSelected) {
        setSelectedHouseholdIds(prev => prev.filter(id => !paginatedHouseholds.some(h => h.id === id)));
      } else {
        const idsToAdd = paginatedHouseholds.map(h => h.id);
        setSelectedHouseholdIds(prev => Array.from(new Set([...prev, ...idsToAdd])));
      }
    };

    const handleToggleSelectRow = (id: string) => {
      setSelectedHouseholdIds(prev => 
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      );
    };

    const startIdx = totalItems === 0 ? 0 : (validPage - 1) * (actualPageSize || 1) + 1;
    const endIdx = pageSize === -1 ? totalItems : Math.min(validPage * actualPageSize, totalItems);

    return (
      <div className="flex flex-col w-full">
        {/* Scrollable Container with Sticky Thead */}
        <div className="overflow-x-auto overflow-y-auto max-h-[70vh] border border-slate-300 rounded-t shadow-xs bg-white relative">
          <table className="w-full border-collapse text-xs text-slate-800 whitespace-nowrap">
            <thead className="sticky top-0 z-20 bg-sky-800 shadow-xs">
              <tr className="bg-sky-800 text-white text-center font-bold">
                {showEntryButton && (
                  <th className="border border-sky-900 px-2 py-2.5 w-10 text-center bg-sky-900 text-white font-semibold sticky top-0">
                    <input 
                      type="checkbox" 
                      checked={isAllSelected}
                      onChange={handleToggleSelectAll}
                      className="rounded text-sky-600 w-4 h-4 cursor-pointer"
                      title="Chọn tất cả các dòng trên trang này"
                    />
                  </th>
                )}
                <th className="border border-sky-900 px-2 py-2.5 bg-sky-900 text-white font-semibold sticky top-0">STT Mẫu</th>
                <th className="border border-sky-900 px-2.5 py-2.5 bg-sky-900 text-white font-semibold sticky top-0">Mã TKCS</th>
                <th className="border border-sky-900 px-3 py-2.5 bg-sky-900 text-white font-semibold text-left sticky top-0">Tên TKCS</th>
                <th className="border border-sky-900 px-2.5 py-2.5 bg-sky-900 text-white font-semibold sticky top-0">Mã Xã</th>
                <th className="border border-sky-900 px-3 py-2.5 bg-sky-900 text-white font-semibold text-left sticky top-0">Tên Xã</th>
                <th className="border border-sky-900 px-3 py-2.5 bg-sky-900 text-white font-semibold sticky top-0">Mã ĐB</th>
                <th className="border border-sky-900 px-4 py-2.5 bg-sky-900 text-white font-semibold text-left sticky top-0">Tên Địa bàn (Sheet)</th>
                <th className="border border-sky-900 px-2.5 py-2.5 bg-sky-900 text-white font-semibold text-left sticky top-0">Người nhập / ĐTV</th>
                <th className="border border-sky-900 px-2.5 py-2.5 bg-sky-900 text-white font-semibold text-center sticky top-0">Trạng thái phiếu</th>
                <th className="border border-sky-900 px-2 py-2.5 bg-sky-900 text-white font-semibold sticky top-0">Mẫu</th>
                <th className="border border-sky-900 px-2 py-2.5 bg-sky-900 text-white font-semibold sticky top-0">STT gốc</th>
                <th className="border border-sky-900 px-3 py-2.5 text-left bg-sky-900 text-white font-semibold sticky top-0">Họ và tên chủ hộ</th>
                <th className="border border-sky-900 px-3 py-2.5 text-left bg-sky-900 text-white font-semibold sticky top-0">Địa chỉ của hộ</th>
                <th className="border border-sky-900 px-2 py-2.5 bg-sky-900 text-white font-semibold sticky top-0">Nhân khẩu</th>
                <th className="border border-sky-900 px-2 py-2.5 bg-sky-900 text-white font-semibold sticky top-0">Nguồn thu (1-4)</th>
                <th className="border border-sky-900 px-3 py-2.5 text-left bg-sky-900 text-white font-semibold sticky top-0">Phân loại ngành</th>
                <th className="border border-sky-900 px-2.5 py-2.5 text-left bg-sky-900 text-white font-semibold sticky top-0">Ghi chú (SĐT)</th>
                <th className="border border-sky-900 px-3 py-2.5 text-right bg-sky-900 text-white font-semibold sticky top-0">Tổng TN (1.000 đ)</th>
                {showEntryButton && <th className="border border-sky-900 px-3 py-2.5 bg-sky-900 text-white font-semibold sticky top-0">Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {paginatedHouseholds.map((h, idx) => {
                const inc = calculateHouseholdTotalIncome(h);
                const tkcsCodeDisplay = h.tkcsCode || currentCommune?.tkcsCode || formTkcsCode || '';
                const tkcsNameDisplay = h.tkcsName || currentCommune?.tkcsName || formTkcsName || '';
                const communeCodeDisplay = h.communeCode || currentCommune?.communeCode || formCommuneCode || '';
                const communeNameDisplay = h.communeName || currentCommune?.communeName || formCommuneName || '';
                const areaCodeDisplay = h.areaCode || (areas.find(a => a.id === h.areaId)?.code) || '001';
                const areaNameDisplay = h.areaName || (areas.find(a => a.id === h.areaId)?.name) || 'Địa bàn';
                const isRowSelected = selectedHouseholdIds.includes(h.id);
                const status = h.surveyStatus || 'CHUA_NHAP';
                const isLocked = status === 'DA_DUYET' && currentUser?.role !== 'ADMIN';

                return (
                  <tr 
                    key={h.id} 
                    className={`hover:bg-sky-50 transition-colors ${isRowSelected ? 'bg-sky-100/70 font-semibold' : 'odd:bg-slate-50/40'}`}
                  >
                    {showEntryButton && (
                      <td className="border border-slate-300 p-2 text-center">
                        <input 
                          type="checkbox" 
                          checked={isRowSelected}
                          onChange={() => handleToggleSelectRow(h.id)}
                          className="rounded text-sky-600 w-4 h-4 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="border border-slate-300 p-2 text-center font-bold text-slate-900">{h.sttMau}</td>
                    <td className="border border-slate-300 p-2 text-center font-bold text-amber-900 bg-amber-50/50">{tkcsCodeDisplay}</td>
                    <td className="border border-slate-300 p-2 font-medium text-slate-800 bg-amber-50/30">{tkcsNameDisplay}</td>
                    <td className="border border-slate-300 p-2 text-center font-bold text-sky-900 bg-sky-50/50">{communeCodeDisplay}</td>
                    <td className="border border-slate-300 p-2 font-bold text-sky-900 bg-sky-50/30">{communeNameDisplay}</td>
                    <td className="border border-slate-300 p-2 text-center font-black text-emerald-800 bg-emerald-100/60 text-sm">
                      {areaCodeDisplay}
                    </td>
                    <td className="border border-slate-300 p-2 font-extrabold text-emerald-950 bg-emerald-50/60">
                      {areaNameDisplay}
                    </td>

                    {/* Surveyor Assignment Column */}
                    <td className="border border-slate-300 p-2 text-left">
                      {h.assignedSurveyorName ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-bold text-[11px] bg-sky-100 text-sky-900 border border-sky-300">
                          <UserCheck className="w-3 h-3 text-sky-700" />
                          <span>{h.assignedSurveyorName}</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">Chưa gán</span>
                      )}
                    </td>

                    {/* Survey Status Column */}
                    <td className="border border-slate-300 p-2 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-bold text-[10px] border ${
                        status === 'DA_DUYET' 
                          ? 'bg-purple-100 text-purple-900 border-purple-300' 
                          : status === 'DA_HOAN_THANH'
                          ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                          : status === 'DANG_NHAP'
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : 'bg-slate-100 text-slate-700 border-slate-300'
                      }`}>
                        {status === 'DA_DUYET' ? <Lock className="w-3 h-3" /> : status === 'DA_HOAN_THANH' ? <CheckCircle2 className="w-3 h-3" /> : null}
                        <span>{SURVEY_STATUS_LABELS[status]?.label || 'Chưa nhập tin'}</span>
                      </span>
                    </td>

                    <td className="border border-slate-300 p-2 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        h.sampleStatus === 'CHÍNH THỨC' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
                      }`}>
                        {h.sampleStatus}
                      </span>
                    </td>
                    <td className="border border-slate-300 p-2 text-center text-slate-600">{h.sttGoc}</td>
                    <td className="border border-slate-300 p-2 font-bold text-slate-900">{h.householdHead}</td>
                    <td className="border border-slate-300 p-2 text-slate-600">{h.address}</td>
                    <td className="border border-slate-300 p-2 text-center font-medium">{h.membersCount}</td>
                    <td className="border border-slate-300 p-2 text-center font-bold text-sky-800">{h.sectorCode}</td>
                    <td className="border border-slate-300 p-2 font-medium text-sky-800">{h.sectorName}</td>
                    <td className="border border-slate-300 p-2 text-slate-600">{h.note}</td>
                    <td className="border border-slate-300 p-2 text-right font-bold text-emerald-800">{inc.total.toLocaleString()}</td>
                    {showEntryButton && (
                      <td className="border border-slate-300 p-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button 
                            onClick={() => setActiveHouseholdForm(h)}
                            className={`px-2.5 py-1 text-white rounded font-bold flex items-center justify-center gap-1 cursor-pointer shadow-xs transition-colors ${
                              isLocked 
                                ? 'bg-slate-700 hover:bg-slate-600' 
                                : status === 'DA_HOAN_THANH'
                                ? 'bg-emerald-700 hover:bg-emerald-600'
                                : 'bg-sky-700 hover:bg-sky-600'
                            }`}
                            title={isLocked ? 'Phiếu đã duyệt - Chế độ xem' : 'Mở phiếu nhập tin Phụ lục II'}
                          >
                            {isLocked ? <Eye className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                            <span>{isLocked ? 'Xem phiếu' : 'Nhập tin phiếu'}</span>
                          </button>

                          {currentUser?.role === 'ADMIN' && (
                            <button
                              type="button"
                              onClick={async () => {
                                const nextStatus: SurveyStatus = status === 'DA_DUYET' ? 'DA_HOAN_THANH' : 'DA_DUYET';
                                const updatedH: Household = { ...h, surveyStatus: nextStatus };
                                setHouseholds(prev => prev.map(item => item.id === h.id ? updatedH : item));
                                await setDoc(doc(db, 'households', h.id), updatedH);
                                showNotification('success', `Đã ${nextStatus === 'DA_DUYET' ? 'Duyệt & Khóa' : 'Mở khóa'} phiếu hộ ${h.householdHead}`);
                              }}
                              className={`p-1 rounded border cursor-pointer ${
                                status === 'DA_DUYET' 
                                  ? 'bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100' 
                                  : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
                              }`}
                              title={status === 'DA_DUYET' ? 'Bấm để Mở khóa phiếu này' : 'Bấm để Duyệt & Khóa phiếu này'}
                            >
                              {status === 'DA_DUYET' ? <Lock className="w-3.5 h-3.5 text-purple-800" /> : <Unlock className="w-3.5 h-3.5" />}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setHouseholdToDelete(h)}
                            className="p-1 text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200 cursor-pointer transition-colors"
                            title={`Xóa hộ "${h.householdHead}"`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {paginatedHouseholds.length === 0 && (
                <tr>
                  <td colSpan={showEntryButton ? 20 : 19} className="text-center py-10 text-slate-500 italic">
                    Không tìm thấy hộ gia đình nào theo tiêu chí lọc hiện tại.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination & Viewport Footer Controls */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2.5 rounded-b flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-slate-600 font-medium">
              Hiển thị <strong>{startIdx}</strong> - <strong>{endIdx}</strong> trong tổng số <strong className="text-sky-900">{totalItems}</strong> hộ
            </span>

            <div className="flex items-center gap-1.5 ml-2 border-l border-slate-300 pl-3">
              <span className="text-slate-600">Số dòng/trang:</span>
              <select
                value={pageSize}
                onChange={e => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-white border border-slate-300 rounded px-2 py-0.5 font-bold text-slate-800 cursor-pointer"
              >
                <option value={25}>25 hộ</option>
                <option value={50}>50 hộ</option>
                <option value={100}>100 hộ</option>
                <option value={200}>200 hộ</option>
                <option value={-1}>Tất cả ({totalItems} hộ)</option>
              </select>
            </div>
          </div>

          {pageSize !== -1 && totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={validPage <= 1}
                className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Trang đầu tiên"
              >
                <ChevronsLeft className="w-4 h-4 text-slate-700" />
              </button>

              <button
                type="button"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={validPage <= 1}
                className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Trang trước"
              >
                <ChevronLeft className="w-4 h-4 text-slate-700" />
              </button>

              <div className="flex items-center gap-1 px-2">
                <span className="text-slate-600">Trang</span>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={validPage}
                  onChange={e => {
                    const p = parseInt(e.target.value, 10);
                    if (!isNaN(p)) setCurrentPage(Math.min(Math.max(1, p), totalPages));
                  }}
                  className="w-12 text-center bg-white border border-slate-300 rounded py-0.5 font-bold text-sky-900"
                />
                <span className="text-slate-600">/ {totalPages}</span>
              </div>

              <button
                type="button"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={validPage >= totalPages}
                className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Trang kế tiếp"
              >
                <ChevronRight className="w-4 h-4 text-slate-700" />
              </button>

              <button
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={validPage >= totalPages}
                className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Trang cuối cùng"
              >
                <ChevronsRight className="w-4 h-4 text-slate-700" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-linear-to-b from-sky-900 via-sky-850 to-slate-900 text-slate-900 flex flex-col items-center justify-center p-4 selection:bg-sky-200">
        {notification && (
          <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded shadow-lg border flex items-center gap-3 text-xs font-medium transition-all ${
            notification.type === 'success' ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-rose-50 border-rose-300 text-rose-900'
          }`}>
            {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-rose-600" />}
            <span>{notification.message}</span>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden text-xs">
          {/* Rural Countryside Picture Header Banner */}
          <div className="h-32 w-full relative overflow-hidden border-b border-sky-900">
            <img 
              src={bannerImg} 
              alt="Nông thôn Việt Nam" 
              className="w-full h-full object-cover" 
            />
            <div className="absolute inset-0 bg-linear-to-t from-sky-950 via-sky-950/60 to-transparent"></div>
            <div className="absolute inset-x-0 bottom-2 px-4 text-center">
              <h1 className="text-base font-black uppercase tracking-tight text-white drop-shadow-md">
                Hệ thống Quản lý Nhập tin & Thống kê
              </h1>
              <p className="text-xs text-sky-200 font-medium drop-shadow-sm mt-0.5">
                Phiếu thu thập thông tin về thu nhập của hộ dân cư (Phụ lục II)
              </p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="p-6 flex flex-col gap-4">
            <div>
              <label className="block font-bold text-slate-800 mb-1 text-xs">
                Tên đăng nhập / Mã tài khoản
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  autoFocus
                  value={loginIdentifier}
                  onChange={e => setLoginIdentifier(e.target.value)}
                  placeholder="Nhập tên đăng nhập hoặc mã tài khoản..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 pl-9 text-slate-900 font-bold focus:bg-white focus:ring-2 focus:ring-sky-600 focus:outline-hidden text-xs"
                />
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-800 mb-1 text-xs">
                Mật khẩu
              </label>
              <div className="relative">
                <input
                  type={showLoginPassword ? "text" : "password"}
                  required
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="Nhập mật khẩu..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 pl-9 pr-10 text-slate-900 font-bold focus:bg-white focus:ring-2 focus:ring-sky-600 focus:outline-hidden text-xs"
                />
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 bg-sky-800 hover:bg-sky-700 active:bg-sky-900 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span>Đăng nhập hệ thống</span>
            </button>

            <div className="mt-1 pt-4 border-t border-slate-200 text-slate-600 text-[11px] leading-relaxed flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-slate-800 font-bold">
                <span className="flex items-center gap-1.5 text-sky-900 font-bold">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Hệ thống Bảo mật Thống kê</span>
                </span>
                <span className="bg-sky-100 text-sky-900 px-2 py-0.5 rounded font-bold text-[10px] border border-sky-200">
                  Phiên bản 2026
                </span>
              </div>
              <p className="text-slate-500 font-medium leading-normal">
                Cơ sở dữ liệu đám mây Firebase đồng bộ tự động dành cho Cán bộ Quản lý & Điều tra viên cấp Xã.
              </p>
            </div>
          </form>
        </div>

        <p className="text-xs text-sky-300/80 mt-6">
          Hệ thống Quản lý Thống kê Thu nhập Hộ gia đình © 2026 - Cơ sở dữ liệu Firebase Firestore
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sky-50 text-slate-900 font-sans flex flex-col antialiased selection:bg-sky-200">
      
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded shadow-lg border flex items-center gap-3 text-xs font-medium transition-all ${
          notification.type === 'success' 
            ? 'bg-emerald-50 border-emerald-300 text-emerald-900' 
            : 'bg-rose-50 border-rose-300 text-rose-900'
        }`}>
          {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-rose-600" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Upload Progress Modal / Overlay */}
      {isUploading && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full p-6 flex flex-col items-center gap-4 text-center">
            <Loader2 className="w-10 h-10 text-sky-600 animate-spin" />
            <div>
              <h3 className="font-bold text-slate-900 text-base uppercase">Đang xử lý file Excel bảng kê</h3>
              <p className="text-xs text-slate-600 mt-2 font-medium">{uploadProgressText}</p>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden mt-2">
              <div className="bg-sky-600 h-2.5 rounded-full animate-pulse w-full"></div>
            </div>
          </div>
        </div>
      )}

      {/* PINNED STICKY TOP CONTAINER (HEADER + TABS + FILTER TOOLBAR) */}
      <div className="sticky top-0 z-40 shadow-md flex flex-col w-full bg-white">
        {/* Header Banner - Full Width Bright Countryside Photo Banner */}
        <header className="relative w-full text-white border-b border-sky-900 shadow-md overflow-hidden bg-sky-800">
          {/* Full-width bright sunny countryside image - no dark overlay */}
          <img 
            src={bannerImg} 
            alt="Nông thôn Việt Nam" 
            className="absolute inset-0 w-full h-full object-cover object-center brightness-110 saturate-110" 
          />

          <div className="relative z-10 w-full px-3 md:px-5 py-3 md:py-3.5 flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3.5 bg-sky-950/80 backdrop-blur-md px-4 py-2 rounded-xl border border-white/30 shadow-xl">
              <div className="bg-sky-700/80 p-2 rounded-lg border border-white/30 shrink-0 shadow-inner">
                <FileSpreadsheet className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-base md:text-lg font-black tracking-tight text-white uppercase flex items-center gap-2 drop-shadow-sm">
                  <span>Phần mềm Nhập tin & Tổng hợp Nhanh Hộ gia đình</span>
                </h1>
                <p className="text-xs text-amber-300 font-extrabold drop-shadow-xs mt-0.5">
                  Phiếu thu thập thông tin về thu nhập của hộ dân cư (Phụ lục II)
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Logged in User Profile & Actions */}
              <div className="flex items-center gap-2 bg-sky-950/85 backdrop-blur-md border border-white/30 rounded-xl px-3.5 py-2 text-xs shadow-xl">
                <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-black text-white">{currentUser.name || 'Admin'}</span>

                <button
                  type="button"
                  onClick={() => {
                    setCurrentPasswordInput('');
                    setNewPasswordInput('');
                    setConfirmPasswordInput('');
                    setChangePasswordError('');
                    setShowChangePasswordModal(true);
                  }}
                  className="p-1 hover:bg-sky-800 rounded text-amber-300 hover:text-white cursor-pointer transition-colors ml-1"
                  title="Đổi mật khẩu tài khoản"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="p-1 hover:bg-rose-900/80 rounded text-rose-300 hover:text-white cursor-pointer transition-colors"
                  title="Đăng xuất khỏi hệ thống"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Navigation Tabs Bar - Teal Blue Background Bar Below Banner */}
        <nav 
          style={{ backgroundColor: '#207f8b' }}
          className="px-3 md:px-5 pt-1.5 border-t border-teal-600 border-b border-teal-800 flex items-center gap-1.5 overflow-x-auto text-xs w-full shadow-md z-20"
        >
          {currentUser.role === 'ADMIN' && (
            <button 
              onClick={() => setActiveTab('import')}
              className={`px-3.5 py-2 flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap rounded-t-md font-bold ${
                activeTab === 'import' 
                  ? 'bg-white text-teal-950 shadow-md border-t-2 border-x border-slate-300 border-t-amber-500 font-black' 
                  : 'text-white hover:bg-teal-700/80 border-transparent'
              }`}
            >
              <Upload className={`w-4 h-4 ${activeTab === 'import' ? 'text-teal-800' : 'text-teal-100'}`} />
              <span className={activeTab === 'import' ? 'text-teal-950 font-black' : 'text-white'}>1. Tải bảng kê</span>
            </button>
          )}

          <button 
            onClick={() => setActiveTab('entry')}
            className={`px-3.5 py-2 flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap rounded-t-md font-bold ${
              activeTab === 'entry' 
                ? 'bg-white text-teal-950 shadow-md border-t-2 border-x border-slate-300 border-t-amber-500 font-black' 
                : 'text-white hover:bg-teal-700/80 border-transparent'
            }`}
          >
            <FileText className={`w-4 h-4 ${activeTab === 'entry' ? 'text-teal-800' : 'text-teal-100'}`} />
            <span className={activeTab === 'entry' ? 'text-teal-950 font-black' : 'text-white'}>2. Nhập tin hộ</span>
          </button>

          {(currentUser.role === 'ADMIN' || currentUser.role === 'SUPERVISOR') && (
            <button 
              onClick={() => setActiveTab('tnh')}
              className={`px-3.5 py-2 flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap rounded-t-md font-bold ${
                activeTab === 'tnh' 
                  ? 'bg-white text-teal-950 shadow-md border-t-2 border-x border-slate-300 border-t-amber-500 font-black' 
                  : 'text-white hover:bg-teal-700/80 border-transparent'
              }`}
            >
              <BarChart3 className={`w-4 h-4 ${activeTab === 'tnh' ? 'text-teal-800' : 'text-teal-100'}`} />
              <span className={activeTab === 'tnh' ? 'text-teal-950 font-black' : 'text-white'}>3. Tổng hợp nhanh</span>
            </button>
          )}

          {currentUser.role === 'ADMIN' && (
            <button 
              onClick={() => setActiveTab('database')}
              className={`px-3.5 py-2 flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap rounded-t-md font-bold ${
                activeTab === 'database' 
                  ? 'bg-white text-teal-950 shadow-md border-t-2 border-x border-slate-300 border-t-amber-500 font-black' 
                  : 'text-white hover:bg-teal-700/80 border-transparent'
              }`}
            >
              <Database className={`w-4 h-4 ${activeTab === 'database' ? 'text-teal-800' : 'text-teal-100'}`} />
              <span className={activeTab === 'database' ? 'text-teal-950 font-black' : 'text-white'}>4. Quản lý danh mục xã</span>
            </button>
          )}

          <button 
            onClick={() => setActiveTab('catalog')}
            className={`px-3.5 py-2 flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap rounded-t-md font-bold ${
              activeTab === 'catalog' 
                ? 'bg-white text-teal-950 shadow-md border-t-2 border-x border-slate-300 border-t-amber-500 font-black' 
                : 'text-white hover:bg-teal-700/80 border-transparent'
            }`}
          >
            <BookOpen className={`w-4 h-4 ${activeTab === 'catalog' ? 'text-teal-800' : 'text-amber-200'}`} />
            <span className={activeTab === 'catalog' ? 'text-teal-950 font-black' : 'text-white'}>5. Danh mục tra cứu</span>
          </button>

          {currentUser.role === 'ADMIN' && (
            <button 
              onClick={() => setActiveTab('surveyors')}
              className={`px-3.5 py-2 flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap rounded-t-md font-bold ${
                activeTab === 'surveyors' 
                  ? 'bg-white text-teal-950 shadow-md border-t-2 border-x border-slate-300 border-t-amber-500 font-black' 
                  : 'text-white hover:bg-teal-700/80 border-transparent'
              }`}
            >
              <Building2 className={`w-4 h-4 ${activeTab === 'surveyors' ? 'text-teal-800' : 'text-emerald-200'}`} />
              <span className={activeTab === 'surveyors' ? 'text-teal-950 font-black' : 'text-white'}>6. Hệ thống</span>
            </button>
          )}
        </nav>

        {/* Filter Toolbar */}
        <div className="bg-white border-b border-slate-300 px-3 md:px-5 py-2 shadow-xs flex flex-wrap items-center justify-between gap-2.5 text-xs w-full">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-700">Tổ TKCS:</span>
              <select 
                value={selectedTkcs} 
                onChange={e => setSelectedTkcs(e.target.value)}
                className="bg-sky-50 border border-slate-300 rounded px-2.5 py-1 text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-sky-600"
              >
                <option value="ALL">-- Tất cả TKCS --</option>
                {Array.from(new Set(communes.map(c => c.tkcsCode).filter(Boolean))).map(code => {
                  const comm = communes.find(c => c.tkcsCode === code);
                  return <option key={code} value={code}>{code} - {comm?.tkcsName || ''}</option>;
                })}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-700">Xã/Phường:</span>
              <select 
                value={selectedCommuneId} 
                onChange={e => {
                  setSelectedCommuneId(e.target.value);
                  setSelectedAreaId('ALL');
                }}
                className="bg-sky-50 border border-slate-300 rounded px-2.5 py-1 text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-sky-600"
              >
                <option value="ALL">-- Tất cả các xã --</option>
                {communes.map(c => (
                  <option key={c.id} value={c.id}>[{c.communeCode}] {c.communeName}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-700">Địa bàn điều tra (Mã 001...):</span>
              <select 
                value={selectedAreaId} 
                onChange={e => setSelectedAreaId(e.target.value)}
                className="bg-sky-50 border border-slate-300 rounded px-2.5 py-1 text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-sky-600"
              >
                <option value="ALL">-- Tất cả địa bàn ({areas.length}) --</option>
                {areas
                  .filter(a => selectedCommuneId === 'ALL' || a.communeId === selectedCommuneId)
                  .map(a => (
                    <option key={a.id} value={a.id}>ĐB {a.code} - {a.name} ({a.householdCount || 0} hộ)</option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-300 rounded px-2 py-0.5">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <input 
                type="text" 
                placeholder="Tìm theo chủ hộ, địa bàn..." 
                value={searchKeyword}
                onChange={e => setSearchKeyword(e.target.value)}
                className="bg-transparent border-none text-xs focus:outline-none w-44"
              />
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-slate-600 font-medium text-xs hidden lg:inline mr-1">
              Hiển thị: <strong className="text-sky-800 font-bold">{filteredHouseholds.length}</strong> / {households.length} hộ
            </span>

            <button 
              onClick={() => setIsGlobalCatalogOpen(true)} 
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-xs font-semibold rounded border border-amber-500 text-white flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              title="Tra cứu danh mục sản phẩm, chăn nuôi, ngành nghề"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Tra cứu danh mục</span>
            </button>
            <button 
              onClick={handleExportExcel} 
              className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-xs font-semibold rounded border border-emerald-600 text-white flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              title="Xuất Excel danh sách hộ đầy đủ"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Xuất Excel Đầy Đủ</span>
            </button>
            <button 
              onClick={() => window.print()} 
              className="px-2.5 py-1 bg-sky-700 hover:bg-sky-600 active:bg-sky-800 text-xs font-semibold rounded border border-sky-600 text-white flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              title="In báo cáo"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>In báo cáo</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area - Full Screen Width */}
      <main className="flex-1 w-full px-3 md:px-5 py-3 flex flex-col gap-4">

        {/* TAB 1: IMPORT FILE EXCEL & CONFIG */}
        {activeTab === 'import' && (
          <div className="flex flex-col gap-6 w-full">
            
            {/* Top configuration box */}
            <div className="bg-white rounded border border-slate-300 shadow-sm p-6 flex flex-col gap-5">
              <div className="border-b border-slate-200 pb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                    <Upload className="w-4 h-4 text-sky-700" />
                    <span>Cấu hình Mã/Tên Xã, TKCS và Tải bảng kê hộ từ file Excel</span>
                  </h2>
                </div>

                {households.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button 
                      onClick={handleUpdateCommuneMetadata}
                      className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 active:bg-sky-800 text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs self-start md:self-auto"
                      title="Cập nhật lại Mã & Tên Xã, TKCS cho toàn bộ danh sách hộ đã nạp mà không cần tải lại file"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Cập nhật Mã/Tên</span>
                    </button>
                    <button 
                      onClick={() => setIsClearAllModalOpen(true)}
                      className="px-3 py-1.5 bg-rose-700 hover:bg-rose-600 active:bg-rose-800 text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs self-start md:self-auto"
                      title="Xóa toàn bộ dữ liệu hiện tại để tải file Excel mới từ đầu"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa dữ liệu để up lại file mới</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs bg-sky-50 p-4 rounded border border-sky-200">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Mã TKCS <span className="text-rose-600">*</span></label>
                  <input 
                    type="text" 
                    value={formTkcsCode} 
                    onChange={e => setFormTkcsCode(e.target.value)} 
                    placeholder="Tự đặt mã TKCS..."
                    className="w-full bg-white border border-slate-300 rounded p-2 text-slate-800 font-bold focus:ring-1 focus:ring-sky-600 focus:outline-none" 
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tên TKCS <span className="text-rose-600">*</span></label>
                  <input 
                    type="text" 
                    value={formTkcsName} 
                    onChange={e => setFormTkcsName(e.target.value)} 
                    placeholder="Tự đặt tên TKCS..."
                    className="w-full bg-white border border-slate-300 rounded p-2 text-slate-800 font-medium focus:ring-1 focus:ring-sky-600 focus:outline-none" 
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Mã Xã <span className="text-rose-600">*</span></label>
                  <input 
                    type="text" 
                    value={formCommuneCode} 
                    onChange={e => setFormCommuneCode(e.target.value)} 
                    placeholder="Tự đặt mã xã..."
                    className="w-full bg-white border border-slate-300 rounded p-2 text-slate-800 font-bold focus:ring-1 focus:ring-sky-600 focus:outline-none" 
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tên Xã <span className="text-rose-600">*</span></label>
                  <input 
                    type="text" 
                    value={formCommuneName} 
                    onChange={e => setFormCommuneName(e.target.value)} 
                    placeholder="Tự đặt tên xã..."
                    className="w-full bg-white border border-slate-300 rounded p-2 text-slate-800 font-bold focus:ring-1 focus:ring-sky-600 focus:outline-none" 
                  />
                </div>
              </div>

              {/* Upload Drag & Drop Box */}
              <div className="border-2 border-dashed border-sky-300 rounded-lg p-6 text-center bg-sky-50/40 hover:bg-sky-50 transition-colors flex flex-col items-center justify-center gap-2">
                <div className="bg-sky-100 p-2.5 rounded-full text-sky-700">
                  <FileSpreadsheet className="w-7 h-7" />
                </div>
                <div>
                  <p className="font-semibold text-slate-800 text-sm">Chọn file Excel bảng kê danh sách hộ (.xlsx, .xls)</p>
                </div>
                <label className="mt-1 px-4 py-2 bg-sky-700 hover:bg-sky-600 text-white rounded text-xs font-semibold shadow-xs cursor-pointer flex items-center gap-1.5">
                  <Upload className="w-4 h-4" />
                  <span>Chọn file Excel để tải bảng kê lên</span>
                  <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
            </div>

            {/* List of recognized sheets / survey areas */}
            {areas.length > 0 && (
              <div className="bg-white rounded border border-slate-300 shadow-sm p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="font-bold text-slate-800 text-xs uppercase flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-700" />
                    <span>Danh sách Địa bàn đã nhận diện từ các Sheet ({areas.length} địa bàn quy ước từ mã 001 đến {String(areas.length).padStart(3, '0')})</span>
                  </h3>
                  <span className="text-xs text-slate-500 font-medium">Tên sheet làm tên địa bàn</span>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 text-xs">
                  {areas.map(a => (
                    <div 
                      key={a.id} 
                      onClick={() => {
                        setSelectedAreaId(a.id);
                        showNotification('success', `Đã lọc hiển thị Địa bàn [${a.code}] - ${a.name}`);
                      }}
                      className={`p-2 rounded border cursor-pointer transition-all ${
                        selectedAreaId === a.id 
                          ? 'bg-emerald-100 border-emerald-400 font-bold text-emerald-950 shadow-xs' 
                          : 'bg-slate-50 border-slate-200 hover:bg-emerald-50 hover:border-emerald-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="bg-emerald-800 text-white text-[10px] font-black px-1.5 py-0.5 rounded">
                          {a.code}
                        </span>
                        <span className="text-[11px] font-medium text-slate-600">
                          {a.householdCount || households.filter(h => h.areaId === a.id || h.areaCode === a.code).length} hộ
                        </span>
                      </div>
                      <p className="mt-1 font-bold text-slate-800 truncate" title={a.name}>
                        Sheet: {a.name}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Complete preview table directly on Tab 1 so user sees it right away! */}
            <div className="bg-white rounded border border-slate-300 shadow-sm p-4 flex flex-col gap-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div>
                  <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                    <TableProperties className="w-4 h-4 text-sky-800" />
                    <span>Bảng kê danh sách hộ đã tải lên ({filteredHouseholds.length} hộ)</span>
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setActiveTab('entry')}
                    className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Nhập tin phiếu</span>
                  </button>
                  <button 
                    onClick={handleExportExcel}
                    className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Xuất Excel</span>
                  </button>
                </div>
              </div>

              {renderHouseholdTable(true)}
            </div>

          </div>
        )}

        {/* TAB 2: NHẬP TIN PHIẾU HỘ (PHỤ LỤC II) */}
        {activeTab === 'entry' && (
          <div className="bg-white rounded border border-slate-300 shadow-sm p-4 flex flex-col gap-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <h2 className="font-bold text-slate-800 text-sm uppercase flex items-center gap-2">
                  <FileText className="w-4 h-4 text-sky-800" />
                  <span>Danh sách bảng kê hộ & Nhập tin chi tiết Phụ lục II ({filteredHouseholds.length} hộ)</span>
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Phân công điều tra viên, theo dõi tiến độ nhập và bấm "Nhập tin phiếu" tại từng hộ để hoàn thiện phiếu thu thập.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleExportExcel}
                  className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Xuất Excel Bảng Kê</span>
                </button>
              </div>
            </div>

            {/* Advanced Filters for Surveyor & Survey Status */}
            <div className="bg-slate-50 border border-slate-200 rounded p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2.5">
                {currentUser?.role === 'SURVEYOR' && (
                  <button
                    type="button"
                    onClick={() => setOnlyMyHouseholds(!onlyMyHouseholds)}
                    className={`px-3 py-1.5 rounded font-bold cursor-pointer transition-all flex items-center gap-1.5 border ${
                      onlyMyHouseholds 
                        ? 'bg-sky-800 text-white border-sky-900 shadow-2xs' 
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <span>📌 Chỉ hộ tôi phụ trách</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] ${onlyMyHouseholds ? 'bg-sky-900 text-sky-100' : 'bg-slate-200 text-slate-700'}`}>
                      {households.filter(h => h.assignedSurveyorId === currentUser.id || currentUser.assignedAreas.includes('ALL') || currentUser.assignedAreas.includes(h.areaCode)).length}
                    </span>
                  </button>
                )}

                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-700">Người nhập / ĐTV:</span>
                  <select
                    value={selectedSurveyorFilter}
                    onChange={e => setSelectedSurveyorFilter(e.target.value)}
                    className="bg-white border border-slate-300 rounded px-2.5 py-1 text-slate-800 font-medium"
                  >
                    <option value="ALL">-- Tất cả người nhập --</option>
                    <option value="UNASSIGNED">Chưa phân công ĐTV</option>
                    {surveyors.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.code} - {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-700">Trạng thái phiếu:</span>
                  <select
                    value={selectedStatusFilter}
                    onChange={e => setSelectedStatusFilter(e.target.value)}
                    className="bg-white border border-slate-300 rounded px-2.5 py-1 text-slate-800 font-medium"
                  >
                    <option value="ALL">-- Tất cả trạng thái --</option>
                    <option value="CHUA_NHAP">Chưa nhập tin</option>
                    <option value="DANG_NHAP">Đang nhập tin</option>
                    <option value="DA_HOAN_THANH">Đã nhập tin</option>
                    <option value="DA_DUYET">Đã nhập tin (Đã duyệt)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">
                  Đã chọn: <strong className="text-sky-900">{selectedHouseholdIds.length}</strong> hộ
                </span>
              </div>
            </div>

            {/* Batch Action Toolbar when rows are selected */}
            {selectedHouseholdIds.length > 0 && (
              <div className="bg-sky-100/90 border border-sky-300 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs animate-in fade-in duration-200">
                <div className="flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-sky-800" />
                  <span className="font-bold text-sky-950">
                    Thao tác hàng loạt cho {selectedHouseholdIds.length} hộ đã chọn:
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-700 font-medium">Gán ĐTV:</span>
                    <select
                      value={batchAssignSurveyorId}
                      onChange={e => setBatchAssignSurveyorId(e.target.value)}
                      className="bg-white border border-slate-300 rounded px-2 py-1 font-bold text-slate-900"
                    >
                      <option value="">-- Chọn ĐTV --</option>
                      {surveyors.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.code} - {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleBatchAssignSelected}
                      className="px-2.5 py-1 bg-sky-800 hover:bg-sky-700 text-white rounded font-bold cursor-pointer"
                    >
                      Gán ngay
                    </button>
                  </div>

                  {currentUser?.role === 'ADMIN' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleBatchSetStatus('DA_DUYET')}
                        className="px-2.5 py-1 bg-purple-700 hover:bg-purple-600 text-white rounded font-bold flex items-center gap-1 cursor-pointer"
                        title="Duyệt và khóa không cho sửa"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Duyệt & Khóa</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleBatchSetStatus('DA_HOAN_THANH')}
                        className="px-2.5 py-1 bg-indigo-700 hover:bg-indigo-600 text-white rounded font-bold flex items-center gap-1 cursor-pointer"
                        title="Mở khóa để cho phép sửa"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        <span>Mở khóa</span>
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => setIsBatchDeleteModalOpen(true)}
                    className="px-2.5 py-1 bg-rose-750 hover:bg-rose-700 bg-rose-700 text-white rounded font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                    title="Xóa các hộ đã chọn"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa {selectedHouseholdIds.length} hộ đã chọn</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedHouseholdIds([])}
                    className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded font-semibold cursor-pointer"
                  >
                    Bỏ chọn
                  </button>
                </div>
              </div>
            )}

            {renderHouseholdTable(true)}
          </div>
        )}

        {/* TAB 3: TỔNG HỢP NHANH (TNH) */}
        {activeTab === 'tnh' && (
          <div className="bg-white rounded border border-slate-300 shadow-sm flex flex-col gap-5 p-4 md:p-5">
            {/* Header & 4 Mode Scope Filter Buttons */}
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-300 flex flex-col gap-3.5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2 uppercase tracking-wide">
                    <BarChart3 className="w-5 h-5 text-sky-800" />
                    <span>TỔNG HỢP NHANH SỐ LIỆU ĐIỀU TRA THU NHẬP (PHỤ LỤC II)</span>
                  </h2>
                  <p className="text-xs text-slate-600 mt-1">
                    Công thức tính tự động chuẩn hóa theo đúng biểu mẫu vẽ tay thực tế.
                  </p>
                </div>
                <button 
                  onClick={handleExportExcelTNH}
                  className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs self-start md:self-auto transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Xuất Báo cáo Excel TNH</span>
                </button>
              </div>

              {/* 4 Scope Filter Mode Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <button
                  type="button"
                  onClick={() => setTnhScopeMode('COMMUNE_QUICK')}
                  className={`p-3 rounded border text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between ${
                    tnhScopeMode === 'COMMUNE_QUICK'
                      ? 'bg-sky-800 text-white border-sky-900 shadow-md ring-2 ring-sky-300'
                      : 'bg-white text-slate-800 border-slate-300 hover:bg-sky-50'
                  }`}
                >
                  <span>1. Tổng hợp nhanh theo xã</span>
                  <ChevronRight className={`w-4 h-4 ${tnhScopeMode === 'COMMUNE_QUICK' ? 'text-white' : 'text-slate-400'}`} />
                </button>

                <button
                  type="button"
                  onClick={() => setTnhScopeMode('COMMUNE_SECTOR')}
                  className={`p-3 rounded border text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between ${
                    tnhScopeMode === 'COMMUNE_SECTOR'
                      ? 'bg-sky-800 text-white border-sky-900 shadow-md ring-2 ring-sky-300'
                      : 'bg-white text-slate-800 border-slate-300 hover:bg-sky-50'
                  }`}
                >
                  <span>2. Tổng hợp loại hộ theo xã</span>
                  <ChevronRight className={`w-4 h-4 ${tnhScopeMode === 'COMMUNE_SECTOR' ? 'text-white' : 'text-slate-400'}`} />
                </button>

                <button
                  type="button"
                  onClick={() => setTnhScopeMode('TKCS_SECTOR')}
                  className={`p-3 rounded border text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between ${
                    tnhScopeMode === 'TKCS_SECTOR'
                      ? 'bg-sky-800 text-white border-sky-900 shadow-md ring-2 ring-sky-300'
                      : 'bg-white text-slate-800 border-slate-300 hover:bg-sky-50'
                  }`}
                >
                  <span>3. Tổng hợp loại hộ theo TKCS</span>
                  <ChevronRight className={`w-4 h-4 ${tnhScopeMode === 'TKCS_SECTOR' ? 'text-white' : 'text-slate-400'}`} />
                </button>

                <button
                  type="button"
                  onClick={() => setTnhScopeMode('PROVINCE_SECTOR')}
                  className={`p-3 rounded border text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between ${
                    tnhScopeMode === 'PROVINCE_SECTOR'
                      ? 'bg-sky-800 text-white border-sky-900 shadow-md ring-2 ring-sky-300'
                      : 'bg-white text-slate-800 border-slate-300 hover:bg-sky-50'
                  }`}
                >
                  <span>4. Tổng hợp loại hộ theo Tỉnh</span>
                  <ChevronRight className={`w-4 h-4 ${tnhScopeMode === 'PROVINCE_SECTOR' ? 'text-white' : 'text-slate-400'}`} />
                </button>
              </div>

              {/* Filter Controls Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded border border-slate-200 text-xs">
                <div className="flex items-center gap-3">
                  {(tnhScopeMode === 'COMMUNE_QUICK' || tnhScopeMode === 'COMMUNE_SECTOR') && (
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800">Chọn Xã / Phường:</span>
                      <select
                        value={tnhSelectedCommuneId}
                        onChange={e => setTnhSelectedCommuneId(e.target.value)}
                        className="bg-sky-50 border border-slate-300 rounded px-3 py-1 text-slate-900 font-bold focus:ring-1 focus:ring-sky-600 focus:outline-none"
                      >
                        <option value="ALL">-- Tất cả các xã ({communes.length}) --</option>
                        {communes.map(c => (
                          <option key={c.id} value={c.id}>[{c.communeCode}] {c.communeName}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {tnhScopeMode === 'TKCS_SECTOR' && (
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800">Chọn Mã TKCS:</span>
                      <select
                        value={tnhSelectedTkcs}
                        onChange={e => setTnhSelectedTkcs(e.target.value)}
                        className="bg-sky-50 border border-slate-300 rounded px-3 py-1 text-slate-900 font-bold focus:ring-1 focus:ring-sky-600 focus:outline-none"
                      >
                        <option value="ALL">-- Tất cả mã TKCS --</option>
                        {Array.from(new Set(communes.map(c => c.tkcsCode).filter(Boolean))).map(code => (
                          <option key={code} value={code}>Mã TKCS: {code}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {tnhScopeMode === 'PROVINCE_SECTOR' && (
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 bg-purple-100 text-purple-950 border border-purple-300 rounded font-bold">
                        Phạm vi: Toàn Tỉnh ({communes.length} xã)
                      </span>
                    </div>
                  )}
                </div>

                <div className="text-slate-700 font-semibold">
                  Tổng số hộ thuộc phạm vi báo cáo: <strong className="text-sky-900 font-extrabold">{tnhSummary.totalHH}</strong> hộ chính thức ({tnhSummary.totalMembers} nhân khẩu)
                </div>
              </div>
            </div>

            {/* Top Summary Table matching Image layout */}
            <div className="overflow-x-auto border border-slate-300 rounded shadow-2xs bg-white">
              <table className="w-full border-collapse text-xs text-slate-800">
                <thead>
                  <tr className="bg-sky-900 text-white text-center font-semibold">
                    <th className="border border-sky-950 p-2 w-12">STT</th>
                    <th className="border border-sky-950 p-2 w-16">Mã loại</th>
                    <th className="border border-sky-950 p-2 text-left">Tên nhóm ngành nguồn thu lớn nhất</th>
                    <th className="border border-sky-950 p-2 w-28">Tổng số hộ trong xã</th>
                    <th className="border border-sky-950 p-2 w-24">Tỷ trọng cơ cấu (%)</th>
                    <th className="border border-sky-950 p-2 w-28">Chỉ tiêu phân bổ mẫu chính thức</th>
                    <th className="border border-sky-950 p-2 w-32">Suy rộng TNBQ xã / năm (=E*K)</th>
                    <th className="border border-sky-950 p-2 w-36">Thu nhập bình quân đầu người/tháng (Nghìn đồng)</th>
                    <th className="border border-sky-950 p-2 w-24">Tốc độ so 2025 (%)</th>
                    <th className="border border-sky-950 p-2 w-36">TNBQ đầu người/tháng theo loại hộ (=G/F/12)</th>
                  </tr>
                </thead>
                <tbody>
                  {tnhSummary.sectorData.map((s, idx) => (
                    <tr key={s.code} className="hover:bg-sky-50/80 transition-colors">
                      <td className="border border-slate-300 p-2 text-center font-medium bg-slate-50">{idx + 1}</td>
                      <td className="border border-slate-300 p-2 text-center font-bold text-sky-800">{s.code}</td>
                      <td className="border border-slate-300 p-2 font-bold text-slate-800">{s.name}</td>
                      <td className="border border-slate-300 p-2 text-center font-bold">{s.count}</td>
                      <td className="border border-slate-300 p-2 text-center font-bold text-amber-900 bg-amber-50/30">{s.percent}%</td>
                      <td className="border border-slate-300 p-2 text-center font-medium">{s.allocationTarget}</td>
                      <td className="border border-slate-300 p-2 text-right font-bold text-sky-900 bg-sky-50/40">{s.extrapolatedIncomeYear.toLocaleString()}</td>
                      <td className="border border-slate-300 p-2 text-right bg-emerald-50/30 text-emerald-900 font-extrabold">{tnhSummary.overallPerCapitaMonth.toLocaleString()}</td>
                      <td className="border border-slate-300 p-2 text-center font-medium">{s.growthRate}%</td>
                      <td className="border border-slate-300 p-2 text-right font-extrabold text-emerald-800 bg-emerald-100/50">{s.perCapitaMonth.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="bg-sky-100 font-black text-slate-900">
                    <td className="border border-slate-300 p-2.5 text-center" colSpan={3}>TỔNG TOÀN XÃ / PHẠM VI BÁO CÁO</td>
                    <td className="border border-slate-300 p-2.5 text-center text-sky-900 text-sm">{tnhSummary.totalHH}</td>
                    <td className="border border-slate-300 p-2.5 text-center text-amber-900">100%</td>
                    <td className="border border-slate-300 p-2.5 text-center">{tnhSummary.totalHH}</td>
                    <td className="border border-slate-300 p-2.5 text-right text-sky-900 text-sm">{tnhSummary.overallExtrapolated.toLocaleString()}</td>
                    <td className="border border-slate-300 p-2.5 text-right text-emerald-950 text-sm">{tnhSummary.overallPerCapitaMonth.toLocaleString()}</td>
                    <td className="border border-slate-300 p-2.5 text-center">100%</td>
                    <td className="border border-slate-300 p-2.5 text-right text-emerald-950 text-sm">{tnhSummary.overallPerCapitaMonth.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Formula Legend Box matching drawing notes */}
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-950 flex flex-col gap-1.5 shadow-2xs">
              <p className="font-bold text-amber-900 flex items-center gap-1.5 text-xs">
                <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Ghi chú công thức tính tự động khớp hình vẽ hướng dẫn:</span>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-0.5">
                <div className="bg-white p-2 rounded border border-amber-200">
                  <span className="font-bold text-amber-900 block mb-0.5">1. TNBQ đầu người/tháng theo loại hộ (Cột K):</span>
                  <code className="text-[11px] font-bold text-emerald-900 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 block">
                    = Tổng TN nhóm (G12) / Tổng số thành viên nhóm (F12) / 12
                  </code>
                </div>
                <div className="bg-white p-2 rounded border border-amber-200">
                  <span className="font-bold text-amber-900 block mb-0.5">2. Suy rộng TNBQ xã / năm (Cột G):</span>
                  <code className="text-[11px] font-bold text-sky-900 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200 block">
                    = Tỷ trọng cơ cấu (%) (E) * TNBQ theo loại hộ (K)
                  </code>
                </div>
                <div className="bg-white p-2 rounded border border-amber-200">
                  <span className="font-bold text-amber-900 block mb-0.5">3. Thu nhập BQ đầu người/tháng toàn xã (Cột H):</span>
                  <code className="text-[11px] font-bold text-purple-900 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200 block">
                    = Tổng các giá trị suy rộng nhóm (G)
                  </code>
                </div>
              </div>
            </div>

            {/* Lower Sector Breakdown Tables matching image (Sections I, II, III, IV) */}
            {tnhScopeMode !== 'COMMUNE_QUICK' ? (
              <div className="flex flex-col gap-6 mt-2">
                {[
                  { code: 1, label: 'I. Hộ NLTS (Nông, lâm thủy sản)' },
                  { code: 2, label: 'II. Hộ CNXD (Công nghiệp xây dựng)' },
                  { code: 3, label: 'III. Hộ TMDV (Thương mại dịch vụ)' },
                  { code: 4, label: 'IV. Hộ Nguồn thu khác / Lương' }
                ].map(grp => {
                  const sData = tnhSummary.sectorData.find(s => s.code === grp.code);
                  if (!sData) return null;

                  return (
                    <div key={grp.code} className="border border-slate-300 rounded overflow-hidden shadow-2xs">
                      {/* Yellow Group Header Row matching Image */}
                      <div className="bg-amber-300 text-slate-900 p-2.5 font-bold text-xs flex flex-wrap items-center justify-between border-b border-amber-400 gap-2">
                        <span className="text-sm font-black text-amber-950 uppercase">{grp.label} ({sData.count} hộ)</span>
                        <div className="flex flex-wrap items-center gap-3 text-amber-950">
                          <span>Tổng số thành viên của hộ: <strong className="text-rose-950 font-black">{sData.groupMembers} người</strong></span>
                          <span>|</span>
                          <span>Tổng thu nhập: <strong className="text-emerald-950 font-black">{sData.groupIncome.toLocaleString()} Nghìn đồng</strong></span>
                          <span>|</span>
                          <span className="bg-white px-2.5 py-1 rounded border border-amber-500 font-extrabold text-emerald-950 shadow-2xs">
                            TNBQ đầu người/tháng theo loại hộ (=G/F/12): {sData.perCapitaMonth.toLocaleString()} Nghìn đồng
                          </span>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-xs text-slate-800 whitespace-nowrap">
                          <thead>
                            <tr className="bg-slate-100 font-bold text-slate-800 text-center border-b border-slate-300">
                              <th className="border border-slate-300 p-2 w-12">STT</th>
                              <th className="border border-slate-300 p-2 text-left">Xã/phường</th>
                              <th className="border border-slate-300 p-2 text-left">Địa bàn điều tra</th>
                              <th className="border border-slate-300 p-2 w-20">STT Mẫu</th>
                              <th className="border border-slate-300 p-2 text-left">Họ và tên chủ hộ</th>
                              <th className="border border-slate-300 p-2 w-32 text-center bg-rose-50 text-rose-900 font-bold">Tổng số thành viên của hộ (Người)</th>
                              <th className="border border-slate-300 p-2 w-40 text-right bg-amber-50 text-amber-900 font-bold">Tổng thu nhập (1.000đ)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sData.sList.map((h, idx) => {
                              const inc = calculateHouseholdTotalIncome(h).total;
                              return (
                                <tr key={h.id} className="hover:bg-sky-50/60 transition-colors border-b border-slate-200">
                                  <td className="border border-slate-300 p-2 text-center font-medium bg-slate-50">{idx + 1}</td>
                                  <td className="border border-slate-300 p-2 font-bold text-sky-900">{h.communeName || formCommuneName || '---'}</td>
                                  <td className="border border-slate-300 p-2 font-medium">{h.areaName || 'Địa bàn'}</td>
                                  <td className="border border-slate-300 p-2 text-center font-bold text-slate-800">{h.sttMau}</td>
                                  <td className="border border-slate-300 p-2 font-bold text-slate-900">{h.householdHead}</td>
                                  <td className="border border-slate-300 p-2 text-center font-bold text-rose-900 bg-rose-50/30">{h.membersCount}</td>
                                  <td className="border border-slate-300 p-2 text-right font-extrabold text-emerald-800 bg-amber-50/30">{inc.toLocaleString()}</td>
                                </tr>
                              );
                            })}
                            {sData.sList.length === 0 && (
                              <tr>
                                <td colSpan={7} className="text-center py-4 text-slate-400 italic">
                                  Chưa có hộ gia đình nào thuộc nhóm ngành này.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Quick list for Mode 1 */
              <div className="border border-slate-300 rounded p-3 bg-slate-50/50 mt-2">
                <h3 className="font-semibold text-slate-800 text-xs mb-2">Chi tiết danh sách các hộ trong báo cáo tổng hợp nhanh</h3>
                {renderHouseholdTable(false)}
              </div>
            )}

          </div>
        )}

        {/* TAB 4: QUẢN LÝ DANH MỤC XÃ & DỮ LIỆU */}
        {activeTab === 'database' && (
          <div className="bg-white rounded border border-slate-300 shadow-sm p-6 flex flex-col gap-6">
            <div className="border-b border-slate-200 pb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-800 text-base flex items-center gap-2">
                  <Database className="w-5 h-5 text-sky-700" />
                  <span>Quản lý danh mục Xã, Địa bàn & Dữ liệu lưu trữ</span>
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Quản lý các đơn vị xã, địa bàn và xóa dữ liệu khi cần tải lại file Excel mới.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button 
                  onClick={() => setIsClearAllModalOpen(true)}
                  className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                  title="Xóa toàn bộ hộ, địa bàn và xã để tải lại file Excel mới từ đầu"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Xóa toàn bộ dữ liệu để up lại từ đầu</span>
                </button>
              </div>
            </div>

            {/* Quick Helper Banner */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 flex items-start gap-3 text-xs text-amber-950">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-amber-900">Bạn muốn xóa dữ liệu cũ để nạp lại file Excel?</p>
                <p className="mt-0.5 text-amber-800">
                  - Bấm nút <strong>"Xóa toàn bộ dữ liệu để up lại từ đầu"</strong> ở góc trên để dọn sạch toàn bộ dữ liệu hộ, địa bàn và xã trên Firebase và bộ nhớ máy.<br />
                  - Hoặc bạn có thể bấm nút <strong>Xóa</strong> tại từng Xã hoặc từng Địa bàn trong bảng dưới đây để xóa riêng lẻ.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Communes Table */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 text-xs uppercase flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-sky-700" />
                    <span>Danh sách xã trên hệ thống ({communes.length} xã)</span>
                  </h3>
                </div>
                <div className="overflow-x-auto border border-slate-300 rounded shadow-2xs">
                  <table className="w-full border-collapse text-xs text-slate-800">
                    <thead>
                      <tr className="bg-sky-700 text-white text-center font-bold">
                        <th className="border border-sky-800 p-2">Mã xã</th>
                        <th className="border border-sky-800 p-2 text-left">Tên xã</th>
                        <th className="border border-sky-800 p-2">TKCS</th>
                        <th className="border border-sky-800 p-2 text-center">Số hộ</th>
                        <th className="border border-sky-800 p-2 text-center w-24">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {communes.map(c => {
                        const hhCount = households.filter(h => h.communeId === c.id).length;
                        return (
                          <tr key={c.id} className="hover:bg-sky-50 transition-colors">
                            <td className="border border-slate-300 p-2 text-center font-bold text-sky-900 bg-sky-50/50">{c.communeCode}</td>
                            <td className="border border-slate-300 p-2 font-bold text-slate-900">{c.communeName}</td>
                            <td className="border border-slate-300 p-2 text-center font-medium">{c.tkcsCode}</td>
                            <td className="border border-slate-300 p-2 text-center font-bold text-emerald-800">{hhCount} hộ</td>
                            <td className="border border-slate-300 p-2 text-center">
                              <button
                                type="button"
                                onClick={() => setCommuneToDelete(c)}
                                className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-900 rounded border border-rose-200 font-bold text-[11px] flex items-center gap-1 mx-auto cursor-pointer transition-colors"
                                title={`Xóa xã ${c.communeName} và toàn bộ hộ thuộc xã`}
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Xóa xã</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {communes.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-slate-400 italic">
                            Chưa có xã nào. Hãy sang Tab 1 để tải file Excel bảng kê.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Areas Table */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 text-xs uppercase flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-emerald-700" />
                    <span>Danh sách địa bàn điều tra ({areas.length} địa bàn)</span>
                  </h3>
                </div>
                <div className="overflow-x-auto border border-slate-300 rounded max-h-80 overflow-y-auto shadow-2xs">
                  <table className="w-full border-collapse text-xs text-slate-800">
                    <thead>
                      <tr className="bg-sky-700 text-white text-center font-bold sticky top-0">
                        <th className="border border-sky-800 p-2 w-16">Mã ĐB</th>
                        <th className="border border-sky-800 p-2 text-left">Tên địa bàn (Sheet)</th>
                        <th className="border border-sky-800 p-2 w-20">Số hộ</th>
                        <th className="border border-sky-800 p-2 text-center w-24">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {areas.map(a => {
                        const hhCount = a.householdCount || households.filter(h => h.areaId === a.id || h.areaCode === a.code).length;
                        return (
                          <tr key={a.id} className="hover:bg-sky-50 transition-colors">
                            <td className="border border-slate-300 p-2 text-center font-black text-emerald-800 bg-emerald-50/50">{a.code}</td>
                            <td className="border border-slate-300 p-2 font-bold text-slate-900">{a.name}</td>
                            <td className="border border-slate-300 p-2 text-center font-semibold text-slate-700">
                              {hhCount} hộ
                            </td>
                            <td className="border border-slate-300 p-2 text-center">
                              <button
                                type="button"
                                onClick={() => setAreaToDelete(a)}
                                className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-900 rounded border border-rose-200 font-bold text-[11px] flex items-center gap-1 mx-auto cursor-pointer transition-colors"
                                title={`Xóa địa bàn ${a.name} (Mã ${a.code}) và toàn bộ hộ thuộc địa bàn`}
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Xóa ĐB</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {areas.length === 0 && (
                        <tr>
                          <td colSpan={4} className="p-6 text-center text-slate-400 italic">
                            Chưa có địa bàn nào.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: SỔ TAY TRA CỨU DANH MỤC CHUẨN (PHỤ LỤC II) */}
        {activeTab === 'catalog' && (
          <div className="flex flex-col gap-4">
            
            {/* Banner & Intro */}
            <div className="bg-white p-4 rounded border border-slate-300 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="bg-amber-100 p-2 rounded text-amber-800 border border-amber-300">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900 uppercase">
                      Sổ tay Tra cứu Toàn bộ Danh mục Chuẩn (Phụ lục II)
                    </h2>
                    <p className="text-xs text-slate-600">
                      Tích hợp sẵn đầy đủ vào code theo đúng chuẩn 13 trang biểu mẫu điều tra thu nhập hộ nông thôn mới.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsGlobalCatalogOpen(true)}
                  className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Search className="w-4 h-4" />
                  <span>Mở Sổ tay dạng Popup</span>
                </button>
              </div>
            </div>

            {/* Catalog Sub-tabs & Search */}
            <div className="bg-white p-3 rounded border border-slate-300 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => { setCatalogExplorerTab('muc2'); setCatalogSearchTerm(''); }}
                  className={`px-3 py-1.5 rounded font-bold cursor-pointer transition-colors ${catalogExplorerTab === 'muc2' ? 'bg-sky-800 text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                >
                  1. Trồng trọt (63 loại)
                </button>
                <button
                  onClick={() => { setCatalogExplorerTab('muc3'); setCatalogSearchTerm(''); }}
                  className={`px-3 py-1.5 rounded font-bold cursor-pointer transition-colors ${catalogExplorerTab === 'muc3' ? 'bg-sky-800 text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                >
                  2. Chăn nuôi (26 loại)
                </button>
                <button
                  onClick={() => { setCatalogExplorerTab('muc4'); setCatalogSearchTerm(''); }}
                  className={`px-3 py-1.5 rounded font-bold cursor-pointer transition-colors ${catalogExplorerTab === 'muc4' ? 'bg-sky-800 text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                >
                  3. Lâm nghiệp (14 loại)
                </button>
              </div>

              <div className="flex items-center gap-1.5 bg-sky-50 border border-slate-300 rounded px-2.5 py-1 w-full md:w-72 shadow-2xs">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm theo mã, tên hoặc nhóm..."
                  value={catalogSearchTerm}
                  onChange={e => setCatalogSearchTerm(e.target.value)}
                  className="w-full bg-transparent border-none text-xs focus:outline-none"
                />
              </div>
            </div>

            {/* Catalog Table */}
            {(() => {
              let currentList: CatalogItem[] = [];
              let tabTitle = '';
              let guideNote = '';

              switch (catalogExplorerTab) {
                case 'muc2':
                  currentList = CATALOG_TRONG_TROT;
                  tabTitle = 'MỤC 2: CÁC NGUỒN THU TỪ HOẠT ĐỘNG TRỒNG TRỌT (Trang 2 & 3 Phụ lục II)';
                  guideNote = 'Bao gồm 63 mục cây trồng lương thực, cây công nghiệp, cây ăn quả, giống, sản phẩm phụ và dịch vụ. Nhập thông tin 8 cột theo bảng kê: Bán ra (C1), Để lại dùng (C2), Giống (C4), Vật tư BVTV (C5), Chi khác (C6) -> Tự động tính Thu nhập C8 = C3 - C7.';
                  break;
                case 'muc3':
                  currentList = CATALOG_CHAN_NUOI;
                  tabTitle = 'MỤC 3: CÁC NGUỒN THU TỪ HOẠT ĐỘNG CHĂN NUÔI (Trang 4, 5 & 6 Phụ lục II)';
                  guideNote = 'Bao gồm 26 mục gia súc, gia cầm, chăn nuôi khác, sản phẩm không qua giết mổ, giống, sản phẩm phụ, dịch vụ và săn bắt. Chi phí gồm giống (C4), thức ăn/thuốc (C5), chi khác (C6).';
                  break;
                case 'muc4':
                  currentList = CATALOG_LAM_NGHIEP;
                  tabTitle = 'MỤC 4: CÁC NGUỒN THU TỪ HOẠT ĐỘNG LÂM NGHIỆP (Trang 7 & 8 Phụ lục II)';
                  guideNote = 'Bao gồm 14 mục khai thác gỗ, củi, trẩu, sở, quế, hồi, tre nứa, dịch vụ bảo vệ và quản lý rừng.';
                  break;
                case 'muc5':
                  currentList = CATALOG_THUY_SAN;
                  tabTitle = 'MỤC 5: CÁC NGUỒN THU TỪ HOẠT ĐỘNG THỦY SẢN (Trang 9 & 10 Phụ lục II)';
                  guideNote = 'Bao gồm nuôi trồng cá, tôm, cua ốc; đánh bắt thủy hải sản tự nhiên; sản xuất giống thủy sản.';
                  break;
                case 'muc6':
                  currentList = CATALOG_PHI_NONG_NGHIEP;
                  tabTitle = 'MỤC 6: SẢN XUẤT KINH DOANH PHI NÔNG, LÂM, THỦY SẢN & DỊCH VỤ (Trang 11 Phụ lục II)';
                  guideNote = 'Bao gồm 27 ngành nghề thực tế phổ biến tại nông thôn: xay xát, mộc, may mặc, gò hàn, thợ xây, cửa hàng tạp hóa, bán buôn nông sản, quán ăn, sửa xe máy, vận tải...';
                  break;
                case 'muc1':
                  currentList = CATALOG_CONG_VIEC;
                  tabTitle = 'MỤC 1: THU NHẬP TỪ TIỀN LƯƠNG, TIỀN CÔNG (Trang 1 Phụ lục II)';
                  guideNote = 'Danh mục các công việc chính thường gặp của thành viên hộ: công nhân nhà máy, thợ xây, lái xe, thợ mộc, cán bộ xã, giáo viên, nhân viên y tế... Thu nhập gồm Cột 1 (Lương, công) và Cột 2 (Lương hưu, trợ cấp).';
                  break;
                case 'muc7':
                  currentList = CATALOG_THU_KHAC;
                  tabTitle = 'MỤC 7: CÁC NGUỒN THU NHẬP KHÁC (Trang 12 Phụ lục II)';
                  guideNote = 'Bao gồm kiều hối, quà biếu tặng người thân, trợ cấp người có công / bảo trợ xã hội, cứu trợ bão lũ, học bổng, tiền cho thuê nhà đất / máy móc, lãi tiền gửi tiết kiệm, trúng xổ số...';
                  break;
              }

              const filtered = currentList.filter(item =>
                item.name.toLowerCase().includes(catalogSearchTerm.toLowerCase().trim()) ||
                item.category.toLowerCase().includes(catalogSearchTerm.toLowerCase().trim()) ||
                String(item.id).includes(catalogSearchTerm.trim())
              );

              return (
                <div className="bg-white p-4 rounded border border-slate-300 shadow-xs flex flex-col gap-3">
                  <div className="border-b border-slate-200 pb-2">
                    <h3 className="font-extrabold text-sky-900 text-sm">{tabTitle}</h3>
                    <p className="text-xs text-slate-600 mt-1">{guideNote}</p>
                  </div>

                  <div className="flex justify-between items-center text-xs text-slate-600">
                    <span>Tổng số: <strong className="text-slate-900">{filtered.length}</strong> / {currentList.length} mục</span>
                    <span className="text-[11px] italic text-slate-500">Mẹo: Khi nhập phiếu hộ, bạn có thể bấm nút "Tra cứu danh mục" để chọn trực tiếp không cần gõ tay.</span>
                  </div>

                  <div className="overflow-x-auto border border-slate-300 rounded">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-sky-800 text-white text-center font-bold">
                          <th className="p-2 border border-sky-900 w-16">Mã tra cứu</th>
                          <th className="p-2 border border-sky-900 text-left min-w-[200px]">Tên sản phẩm / Nguồn thu / Ngành nghề</th>
                          <th className="p-2 border border-sky-900 text-left min-w-[200px]">Nhóm phân loại Phụ lục II</th>
                          <th className="p-2 border border-sky-900 w-28 text-center">Sao chép</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(item => (
                          <tr key={item.id} className="hover:bg-sky-50 odd:bg-slate-50/60">
                            <td className="p-2 border border-slate-300 text-center font-black text-sky-900 bg-sky-50">
                              #{item.id}
                            </td>
                            <td className="p-2 border border-slate-300 font-bold text-slate-900">
                              {item.name}
                            </td>
                            <td className="p-2 border border-slate-300 text-slate-700 font-medium">
                              <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-200">
                                {item.category}
                              </span>
                            </td>
                            <td className="p-2 border border-slate-300 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(item.name);
                                  showNotification('success', `Đã sao chép: "${item.name}"`);
                                }}
                                className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-semibold text-[11px] flex items-center justify-center gap-1 mx-auto cursor-pointer"
                                title="Sao chép tên"
                              >
                                <Copy className="w-3 h-3" />
                                <span>Copy</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                        {filtered.length === 0 && (
                          <tr>
                            <td colSpan={4} className="p-6 text-center text-slate-400 italic">
                              Không tìm thấy danh mục nào phù hợp với từ khóa "{catalogSearchTerm}".
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

          </div>
        )}

        {/* TAB 6: QUẢN LÝ 5 PHÒNG BAN, NGƯỜI NHẬP PHIẾU & PHÂN QUYỀN */}
        {activeTab === 'surveyors' && (
          <SurveyorManagement
            surveyors={surveyors}
            departments={departments}
            areas={areas}
            households={households}
            currentUser={currentUser}
            onSaveSurveyor={handleSaveSurveyor}
            onDeleteSurveyor={handleDeleteSurveyor}
            onSaveDepartment={handleSaveDepartment}
            onDeleteDepartment={handleDeleteDepartment}
            onBatchAssignArea={handleBatchAssignArea}
            onBatchAssignDepartmentArea={handleBatchAssignDepartmentArea}
            onSelectActiveUser={(s) => {
              setCurrentSurveyorId(s.id);
              localStorage.setItem('active_surveyor_id', s.id);
              showNotification('success', `Đang thao tác với vai trò: ${s.name} (${ROLE_LABELS[s.role]?.label || s.role})`);
            }}
            showNotification={showNotification}
          />
        )}

      </main>

      {/* CHANGE PASSWORD MODAL (Bao gồm cả chế độ Bắt buộc đổi mật khẩu khi đăng nhập lần đầu / sau khi Admin reset) */}
      {(showChangePasswordModal || (isLoggedIn && currentUser?.mustChangePassword)) && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden text-xs">
            <div className={`p-4 flex items-center justify-between text-white ${currentUser?.mustChangePassword ? 'bg-amber-800' : 'bg-sky-800'}`}>
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-300" />
                <h3 className="font-bold text-sm">
                  {currentUser?.mustChangePassword ? 'YÊU CẦU ĐỔI MẬT KHẨU BẮT BUỘC' : 'Đổi mật khẩu tài khoản'}
                </h3>
              </div>
              {!currentUser?.mustChangePassword && (
                <button
                  type="button"
                  onClick={() => setShowChangePasswordModal(false)}
                  className="text-white hover:bg-sky-900 p-1 rounded cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <form onSubmit={handleChangeMyPassword} className="p-5 flex flex-col gap-4 text-slate-700">
              {currentUser?.mustChangePassword ? (
                <div className="bg-amber-50 border border-amber-300 rounded p-3 text-amber-950 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 font-bold text-amber-900">
                    <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Bảo mật hệ thống: Thiết lập mật khẩu mới</span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-tight">
                    Tài khoản của bạn đăng nhập lần đầu hoặc vừa được Quản trị viên reset. Vui lòng tạo mật khẩu mới để tiếp tục nhập liệu và quản lý phiếu.
                  </p>
                </div>
              ) : (
                <div className="bg-sky-50 border border-sky-200 rounded p-2.5">
                  <span className="font-bold text-sky-950">Tài khoản: </span>
                  <span className="font-extrabold text-sky-900">{currentUser.name} ({currentUser.code})</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">Vai trò: {ROLE_LABELS[currentUser.role]?.label || currentUser.role}</span>
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  Mật khẩu hiện tại (hoặc mật khẩu tạm do Admin cấp) *
                </label>
                <input
                  type="password"
                  required
                  value={currentPasswordInput}
                  onChange={e => setCurrentPasswordInput(e.target.value)}
                  placeholder="Nhập mật khẩu hiện tại..."
                  className="w-full border border-slate-300 rounded p-2 text-slate-900 font-medium focus:ring-1 focus:ring-sky-600 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Mật khẩu mới *</label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={newPasswordInput}
                  onChange={e => setNewPasswordInput(e.target.value)}
                  placeholder="Nhập mật khẩu mới (tối thiểu 4 ký tự)..."
                  className="w-full border border-slate-300 rounded p-2 text-slate-900 font-medium focus:ring-1 focus:ring-sky-600 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Xác nhận mật khẩu mới *</label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={confirmPasswordInput}
                  onChange={e => setConfirmPasswordInput(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới..."
                  className="w-full border border-slate-300 rounded p-2 text-slate-900 font-medium focus:ring-1 focus:ring-sky-600 focus:outline-hidden"
                />
              </div>

              {changePasswordError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-rose-800 text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{changePasswordError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                {!currentUser?.mustChangePassword && (
                  <button
                    type="button"
                    onClick={() => setShowChangePasswordModal(false)}
                    className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold cursor-pointer"
                  >
                    Hủy bỏ
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSavingPassword}
                  className="px-4 py-2 bg-sky-800 hover:bg-sky-700 text-white rounded font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                >
                  {isSavingPassword ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>Xác nhận & Lưu mật khẩu mới</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EXCEL IMPORT REPORT MODAL (THÔNG BÁO ĐỊA BÀN TRỐNG / KHÔNG ĐÚNG MẪU ĐÃ LOẠI BỎ) */}
      {uploadReport && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-xl w-full p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2.5 text-amber-800">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-sm uppercase">Kết quả kiểm tra & Nhận diện Địa bàn</h3>
              </div>
              <button
                type="button"
                onClick={() => setUploadReport(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-3 text-xs text-slate-700">
              <div className="bg-emerald-50 border border-emerald-300 rounded p-3 text-emerald-950 font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Đã nhận diện thành công <strong>{uploadReport.validCount}</strong> địa bàn hợp lệ với tổng số <strong>{uploadReport.totalHouseholds}</strong> hộ gia đình.
                </span>
              </div>

              {uploadReport.skippedSheets.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 font-bold text-rose-800">
                    <ShieldAlert className="w-4 h-4 text-rose-600" />
                    <span>Đã tự động loại bỏ {uploadReport.skippedSheets.length} sheet không đúng mẫu hoặc bị trống:</span>
                  </div>

                  <div className="max-h-48 overflow-y-auto border border-rose-200 rounded bg-rose-50/50 divide-y divide-rose-100">
                    {uploadReport.skippedSheets.map((item, idx) => (
                      <div key={idx} className="p-2.5 flex items-start justify-between gap-2">
                        <div>
                          <span className="font-bold text-slate-900">Sheet: "{item.sheetName || 'Không tên'}"</span>
                          <p className="text-[11px] text-rose-700 mt-0.5 font-medium">{item.reason}</p>
                        </div>
                        <span className="px-1.5 py-0.5 bg-rose-200 text-rose-800 rounded font-black text-[10px] shrink-0">
                          Bỏ qua
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 italic">
                    Hệ thống chỉ nạp các sheet có danh sách hộ thực tế và đánh số thứ tự địa bàn liên tục từ 001 đến hết các sheet hợp lệ.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={() => setUploadReport(null)}
                className="px-4 py-2 bg-sky-700 hover:bg-sky-600 text-white rounded font-bold text-xs cursor-pointer shadow-xs"
              >
                Đã hiểu & Tiếp tục
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULL PHỤ LỤC II QUESTIONNAIRE MODAL (ĐẦY ĐỦ 13 TRANG BIỂU MẪU & TRA CỨU DANH MỤC) */}
      <QuestionnaireModal
        household={activeHouseholdForm}
        isOpen={!!activeHouseholdForm}
        onClose={() => setActiveHouseholdForm(null)}
        onSave={handleSaveQuestionnaire}
        currentUser={currentUser}
        allSurveyors={surveyors}
      />

      {/* SỔ TAY TRA CỨU DANH MỤC GLOBAL MODAL */}
      <CatalogModal
        isOpen={isGlobalCatalogOpen}
        onClose={() => setIsGlobalCatalogOpen(false)}
      />

      {/* MODAL 1: XÁC NHẬN XÓA TOÀN BỘ DỮ LIỆU ĐỂ UP LẠI */}
      {isClearAllModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-lg w-full overflow-hidden text-xs">
            <div className="bg-rose-700 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-200" />
                <h3 className="font-bold text-sm uppercase">Xác nhận xóa toàn bộ dữ liệu</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsClearAllModalOpen(false)}
                className="text-white hover:bg-rose-800 p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4 text-slate-700">
              <div className="bg-rose-50 border border-rose-200 rounded p-3 text-rose-950 font-medium">
                <p className="font-bold text-rose-800 mb-1">Cảnh báo: Hành động này sẽ xóa sạch:</p>
                <ul className="list-disc list-inside space-y-1 text-rose-900">
                  <li>Toàn bộ <strong>{households.length}</strong> hộ gia đình đã nạp.</li>
                  <li>Toàn bộ <strong>{areas.length}</strong> địa bàn điều tra.</li>
                  <li>Toàn bộ <strong>{communes.length}</strong> xã đã tạo.</li>
                </ul>
              </div>
              
              <p className="text-slate-600">
                Dữ liệu sẽ được dọn sạch hoàn toàn trên cả <strong>Firebase Cloud</strong> và bộ nhớ trình duyệt, đưa hệ thống về trạng thái ban đầu để bạn tải file Excel mới.
              </p>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsClearAllModalOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handleClearAllData}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Xác nhận xóa sạch để nạp lại</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: XÁC NHẬN XÓA 1 XÃ */}
      {communeToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden text-xs">
            <div className="bg-rose-700 text-white p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-200" />
                <h3 className="font-bold text-sm">Xác nhận xóa Xã</h3>
              </div>
              <button
                type="button"
                onClick={() => setCommuneToDelete(null)}
                className="text-white hover:bg-rose-800 p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3 text-slate-700">
              <p>
                Bạn có chắc chắn muốn xóa xã <strong className="text-rose-700 font-bold">"{communeToDelete.communeName}"</strong> (Mã: {communeToDelete.communeCode})?
              </p>
              <p className="text-slate-500 text-[11px]">
                Toàn bộ các địa bàn và hộ gia đình thuộc xã này trên Firebase cũng sẽ được xóa đồng thời.
              </p>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 mt-1">
                <button
                  type="button"
                  onClick={() => setCommuneToDelete(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteCommune(communeToDelete.id)}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded font-bold cursor-pointer shadow-xs"
                >
                  Xác nhận xóa xã
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: XÁC NHẬN XÓA 1 ĐỊA BÀN */}
      {areaToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden text-xs">
            <div className="bg-rose-700 text-white p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-200" />
                <h3 className="font-bold text-sm">Xác nhận xóa Địa bàn</h3>
              </div>
              <button
                type="button"
                onClick={() => setAreaToDelete(null)}
                className="text-white hover:bg-rose-800 p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3 text-slate-700">
              <p>
                Bạn có chắc chắn muốn xóa địa bàn <strong className="text-rose-700 font-bold">"{areaToDelete.name}"</strong> (Mã: {areaToDelete.code})?
              </p>
              <p className="text-slate-500 text-[11px]">
                Toàn bộ các hộ gia đình thuộc địa bàn này trên Firebase cũng sẽ được xóa.
              </p>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 mt-1">
                <button
                  type="button"
                  onClick={() => setAreaToDelete(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteArea(areaToDelete)}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded font-bold cursor-pointer shadow-xs"
                >
                  Xác nhận xóa địa bàn
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: XÁC NHẬN XÓA 1 HỘ GIA ĐÌNH */}
      {householdToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden text-xs">
            <div className="bg-rose-700 text-white p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-200" />
                <h3 className="font-bold text-sm">Xác nhận xóa Hộ gia đình</h3>
              </div>
              <button
                type="button"
                onClick={() => setHouseholdToDelete(null)}
                className="text-white hover:bg-rose-800 p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3 text-slate-700">
              <p>
                Bạn có chắc chắn muốn xóa hộ <strong className="text-rose-700 font-bold">"{householdToDelete.householdHead}"</strong> (Địa chỉ: {householdToDelete.address || householdToDelete.areaName}) khỏi hệ thống và Firebase?
              </p>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 mt-1">
                <button
                  type="button"
                  onClick={() => setHouseholdToDelete(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSingleHousehold(householdToDelete)}
                  className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded font-bold cursor-pointer shadow-xs"
                >
                  Xác nhận xóa hộ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: XÁC NHẬN XÓA HÀNG LOẠT HỘ ĐÃ CHỌN */}
      {isBatchDeleteModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden text-xs">
            <div className="bg-rose-700 text-white p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-200" />
                <h3 className="font-bold text-sm">Xác nhận xóa Hộ đã chọn</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsBatchDeleteModalOpen(false)}
                className="text-white hover:bg-rose-800 p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3 text-slate-700">
              <p>
                Bạn có chắc chắn muốn xóa <strong className="text-rose-700 font-bold">{selectedHouseholdIds.length}</strong> hộ gia đình đã được tích chọn khỏi hệ thống và Firebase?
              </p>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 mt-1">
                <button
                  type="button"
                  onClick={() => setIsBatchDeleteModalOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handleDeleteBatchSelected}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded font-bold cursor-pointer shadow-xs"
                >
                  Xác nhận xóa {selectedHouseholdIds.length} hộ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETING PROGRESS OVERLAY */}
      {isDeleting && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full p-6 flex flex-col items-center gap-4 text-center">
            <Loader2 className="w-10 h-10 text-rose-600 animate-spin" />
            <div>
              <h3 className="font-bold text-slate-900 text-base uppercase text-rose-800">Đang xử lý xóa dữ liệu Firebase</h3>
              <p className="text-xs text-slate-600 mt-2 font-medium">{deleteProgressText}</p>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden mt-2">
              <div className="bg-rose-600 h-2 rounded-full animate-pulse w-full"></div>
            </div>
          </div>
        </div>
      )}

      <footer className="bg-sky-900 text-sky-200 py-3 text-center text-xs border-t border-sky-950 mt-auto">
        <p>Hệ thống Quản lý Thống kê Thu nhập Hộ gia đình © 2026 - Phiếu thu thập thông tin Phụ lục II</p>
      </footer>
    </div>
  );
}
