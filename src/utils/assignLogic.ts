/**
 * assignLogic — logic phân công địa bàn cho điều tra viên (thuần, không phụ thuộc React để kiểm thử được).
 *
 * Quy tắc:
 *  - 1 địa bàn chỉ thuộc 1 ĐTV; 1 ĐTV được làm nhiều địa bàn.
 *  - So khớp CHÍNH XÁC địa bàn: id | communeId_code | communeCode_code.
 *  - Mã trần ("001") KHÔNG dùng để so khớp (xã nào cũng có 001) trừ khi mã đó duy nhất toàn hệ thống.
 *  - Không mở rộng theo xã. Chỉ trả về những hộ thực sự đổi người phụ trách.
 */
import type { Household, SurveyArea, Commune } from '../App';
import type { Surveyor } from '../types/user';

export interface AssignCtx { households: Household[]; areas: SurveyArea[]; communes: Commune[] }

export function makeAreaResolver(areas: SurveyArea[], communes: Commune[]) {
  const byId = new Map(areas.map(a => [a.id, a] as const));
  const byKey = new Map<string, SurveyArea>();
  const codeOf = new Map(communes.map(c => [c.id, c.communeCode] as const));
  areas.forEach(a => {
    byKey.set(`${a.communeId}_${a.code}`, a);
    const cc = (a as any).communeCode || codeOf.get(a.communeId);
    if (cc) byKey.set(`${cc}_${a.code}`, a);
  });
  return {
    byId, byKey,
    ofHousehold: (h: Household): SurveyArea | undefined =>
      byId.get(h.areaId) || byKey.get(`${h.communeId}_${h.areaCode}`) || (h.communeCode ? byKey.get(`${h.communeCode}_${h.areaCode}`) : undefined),
  };
}

export function resolveAreaKeys(areas: SurveyArea[], keys: string[], communes: Commune[] = []): SurveyArea[] {
  const set = new Set(keys);
  const codeCount = new Map<string, number>();
  areas.forEach(a => codeCount.set(a.code, (codeCount.get(a.code) || 0) + 1));
  const codeOf = new Map(communes.map(c => [c.id, c.communeCode] as const));
  return areas.filter(a => {
    if (set.has(a.id) || set.has(`${a.communeId}_${a.code}`)) return true;
    const cc = (a as any).communeCode || codeOf.get(a.communeId);
    if (cc && set.has(`${cc}_${a.code}`)) return true;
    return set.has(a.code) && codeCount.get(a.code) === 1;     // mã trần chỉ khi duy nhất
  });
}

/** Gỡ các địa bàn vừa gán khỏi danh sách phân quyền của mọi ĐTV khác. Trả về các tài khoản có thay đổi. */
export function stripAreasFromOthers(list: Surveyor[], targetId: string, targetAreas: SurveyArea[]): Surveyor[] {
  if (targetAreas.length === 0) return [];
  const keys = new Set<string>();
  targetAreas.forEach(ar => { keys.add(ar.id); keys.add(`${ar.communeId}_${ar.code}`); });
  const changed: Surveyor[] = [];
  list.forEach(sv => {
    if (sv.id === targetId || !sv.assignedAreas || sv.assignedAreas.includes('ALL')) return;
    const kept = sv.assignedAreas.filter(k => !keys.has(k));
    if (kept.length !== sv.assignedAreas.length) changed.push({ ...sv, assignedAreas: kept, updatedAt: new Date().toISOString() });
  });
  return changed;
}

export interface AssignPlan {
  next: Household[]; changed: Household[];
  targetAreas: SurveyArea[]; scopeAreas: SurveyArea[];
  updatedSurveyor: Surveyor; others: Surveyor[];
}

/** Gán danh sách địa bàn `selected` cho `target`; địa bàn trong `scopeKeys` mà bị bỏ tích thì trả về chưa giao. */
export function planAssign(
  ctx: AssignCtx, surveyors: Surveyor[], target: Surveyor, selected: string[], scopeKeys?: string[], communeHints?: string[],
): AssignPlan {
  const { households, areas, communes } = ctx;
  const targetAreas = resolveAreaKeys(areas, selected, communes);
  const scopeAreas = scopeKeys ? resolveAreaKeys(areas, scopeKeys, communes) : areas;
  const targetIds = new Set(targetAreas.map(a => a.id));
  const scopeIds = new Set(scopeAreas.map(a => a.id));
  const area = makeAreaResolver(areas, communes);

  const changed: Household[] = [];
  const next = households.map(h => {
    const ar = area.ofHousehold(h);
    if (!ar) return h;
    let owner: string | null = null;
    if (targetIds.has(ar.id)) owner = target.id;
    else if (h.assignedSurveyorId === target.id && scopeIds.has(ar.id)) owner = '';
    if (owner === null || (h.assignedSurveyorId || '') === owner) return h;
    const nh = { ...h, assignedSurveyorId: owner, assignedSurveyorName: owner ? target.name : '' };
    changed.push(nh);
    return nh;
  });

  const communeSet = new Set<string>(communeHints || []);
  targetAreas.forEach(a => {
    if (a.communeId) communeSet.add(a.communeId);
    const cc = (a as any).communeCode || communes.find(c => c.id === a.communeId)?.communeCode;
    if (cc) communeSet.add(cc);
  });

  let current = (target.assignedAreas || []).filter(item => item !== '001');
  if (current.includes('ALL')) current = areas.map(a => a.id);
  const set = new Set(current);
  scopeAreas.forEach(a => { set.delete(a.id); set.delete(`${a.communeId}_${a.code}`); });
  targetAreas.forEach(a => set.add(a.id));

  const updatedSurveyor: Surveyor = {
    ...target,
    assignedAreas: Array.from(set),
    assignedCommunes: communeSet.size > 0 ? Array.from(communeSet) : target.assignedCommunes,
    updatedAt: new Date().toISOString(),
  };
  return { next, changed, targetAreas, scopeAreas, updatedSurveyor, others: stripAreasFromOthers(surveyors, target.id, targetAreas) };
}

export interface ImportAssignPlan { next: Household[]; changed: Household[]; dirtySurveyors: Surveyor[] }

/** Nhập phân công hàng loạt (từ Excel). Dòng sau ghi đè dòng trước nếu trùng địa bàn. */
export function planImportAssignments(
  ctx: AssignCtx, surveyors: Surveyor[], assignments: { surveyorId: string; areaIds: string[]; communeIds: string[] }[],
): ImportAssignPlan {
  const { households, areas, communes } = ctx;
  const area = makeAreaResolver(areas, communes);
  const svMap = new Map<string, Surveyor>(surveyors.map(s => [s.id, { ...s }] as const));
  const areaOwner = new Map<string, string>();
  const communesOf = new Map<string, Set<string>>();

  for (const { surveyorId, areaIds, communeIds } of assignments) {
    if (!svMap.has(surveyorId)) continue;
    const tAreas = resolveAreaKeys(areas, areaIds, communes);
    tAreas.forEach(a => areaOwner.set(a.id, surveyorId));
    const cs = communesOf.get(surveyorId) || new Set<string>();
    communeIds.forEach(c => cs.add(c));
    tAreas.forEach(a => { cs.add(a.communeId); const cc = (a as any).communeCode; if (cc) cs.add(cc); });
    communesOf.set(surveyorId, cs);
  }
  if (areaOwner.size === 0) return { next: households, changed: [], dirtySurveyors: [] };

  const changed: Household[] = [];
  const next = households.map(h => {
    const ar = area.ofHousehold(h);
    const o = ar ? areaOwner.get(ar.id) : undefined;
    if (!o || h.assignedSurveyorId === o) return h;
    const nh = { ...h, assignedSurveyorId: o, assignedSurveyorName: svMap.get(o)!.name };
    changed.push(nh);
    return nh;
  });

  const dirty: Surveyor[] = [];
  svMap.forEach(sv => {
    if ((sv.assignedAreas || []).includes('ALL')) return;
    const before = JSON.stringify([sv.assignedAreas, sv.assignedCommunes]);
    let list = (sv.assignedAreas || []).filter(k => k !== '001');
    list = list.filter(k => {
      const a = area.byId.get(k) || area.byKey.get(k);
      return !(a && areaOwner.has(a.id) && areaOwner.get(a.id) !== sv.id);
    });
    const mine = Array.from(areaOwner.entries()).filter(([, o]) => o === sv.id).map(([id]) => id);
    sv.assignedAreas = Array.from(new Set([...list, ...mine]));
    const cs = communesOf.get(sv.id);
    if (cs) sv.assignedCommunes = Array.from(new Set([...(sv.assignedCommunes || []), ...cs]));
    if (JSON.stringify([sv.assignedAreas, sv.assignedCommunes]) !== before) { sv.updatedAt = new Date().toISOString(); dirty.push(sv); }
  });
  return { next, changed, dirtySurveyors: dirty };
}

/** Gỡ một địa bàn khỏi một ĐTV (chỉ các hộ đang thuộc đúng ĐTV đó). */
export function planUnassign(ctx: AssignCtx, target: Surveyor, areaIdOrCode: string) {
  const { households, areas, communes } = ctx;
  const targetArea = resolveAreaKeys(areas, [areaIdOrCode], communes)[0];
  const area = makeAreaResolver(areas, communes);
  const changed: Household[] = [];
  const next = households.map(h => {
    if (!targetArea || h.assignedSurveyorId !== target.id || area.ofHousehold(h)?.id !== targetArea.id) return h;
    const nh = { ...h, assignedSurveyorId: '', assignedSurveyorName: '' };
    changed.push(nh);
    return nh;
  });
  const remaining = (target.assignedAreas || []).filter(k =>
    k !== areaIdOrCode && k !== targetArea?.id && k !== `${targetArea?.communeId}_${targetArea?.code}`);
  return { next, changed, updatedSurveyor: { ...target, assignedAreas: remaining, updatedAt: new Date().toISOString() } as Surveyor };
}


/**
 * Hộ có thuộc phạm vi địa bàn của tài khoản không? So khớp CHÍNH XÁC theo địa bàn
 * (id | communeId_code | communeCode_code); 'ALL' = tất cả. Dựng một lần, tra cứu O(1) cho từng hộ.
 * (Không còn so theo mã trần "001" nên ĐTV của xã A không thấy hộ chưa giao của địa bàn 001 ở xã khác.)
 */
export function makeAreaAccess(assignedAreas: string[] | undefined, areas: SurveyArea[], communes: Commune[]): (h: Household) => boolean {
  const list = assignedAreas || [];
  if (list.includes('ALL')) return () => true;
  const raw = new Set(list);
  const ids = new Set(resolveAreaKeys(areas, list, communes).map(a => a.id));
  const resolver = makeAreaResolver(areas, communes);
  return (h: Household) => {
    if (raw.has(h.areaId)) return true;
    if (ids.size === 0) return false;
    const a = resolver.ofHousehold(h);
    return !!a && ids.has(a.id);
  };
}
