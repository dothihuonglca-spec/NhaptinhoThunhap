/**
 * assignIndex — chỉ mục tra cứu phân công địa bàn, dựng MỘT LẦN từ toàn bộ hộ (O(H)); mọi tra cứu sau đó O(1).
 */
import type { Surveyor } from '../types/user';

export interface SurveyArea { id: string; communeId: string; communeCode?: string; code: string; name: string; householdCount?: number }
export interface CommuneItem { id: string; communeCode: string; communeName: string; tkcsCode?: string; tkcsName?: string }
export interface Household { id: string; areaCode: string; areaName: string; assignedSurveyorId?: string; assignedSurveyorName?: string; surveyStatus?: string; [key: string]: any }

/** Chỉ mục dựng MỘT LẦN từ toàn bộ hộ (O(H)); mọi tra cứu sau đó là O(1). */
export interface AssignIndex {
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

export const isGenericName = (n: string | undefined, code: string) => {
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

