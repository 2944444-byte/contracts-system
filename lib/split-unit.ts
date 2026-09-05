// פיצול יחידה לחלקים — עם או בלי שוכר מחזיק.
//
// המודל: הרשומה המקורית של היחידה נשארת ומייצגת את החלק שנותר (שם ושטח
// מעודכנים), והחלקים האחרים נוצרים כרשומות חדשות שמצביעות אליה
// (split_from_space_id). כך כל מה שכבר תלוי במזהה היחידה — מקדמות שמורות,
// חיובים, תוספות קודמות — ממשיך להצביע על החלק שנשאר אצל השוכר, ואין
// ספירה כפולה של שטח בנכס.
//
// אם שוכר מחזיק ביחידה, נוצרת לו תוספת להסכם (כמו "הורדת יחידות") שצילום
// היחידות שלה כולל רק את החלקים שנשארו אצלו; חלק שעובר לשוכר אחר יוצר
// לשוכר המקבל תוספת "הוספת יחידות" — אותן קונבנציות בדיוק כמו במסך החוזים,
// כך שמנועי החיוב, המקדמות וההצמדה קוראים את זה בלי לדעת שהיה פיצול.
//
// היסטוריה: לפני שהיחידה משתנה, כל שורת contract_spaces שמצביעה עליה (הבסיס
// של השוכר המחזיק, תוספות קודמות שלו, וחוזים שהסתיימו) מקבלת
// area_override = השטח המקורי. csArea() מעדיף אותו על השטח החי, ולכן הפרשי
// הצמדה, שכ"ד, דמי ניהול וכל חישוב לפי מ"ר לתקופות שלפני הפיצול ממשיכים
// להשתמש בשטח שהיה נכון אז. הצילומים החדשים (אחרי הפיצול) בלי override.

import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit-log";

export type SplitDisposition = "keep" | "vacant" | "transfer";

export type SplitPriceMode = "holder" | "receiver" | "custom";
export type SplitCpiMode = "receiver" | "holder" | "custom";

export type SplitPart = {
  name: string;
  area: string;                 // as typed
  disposition: SplitDisposition;
  targetContractId?: string;    // for "transfer"
  // "transfer": where the price per m² comes from — the holder's price for this
  // unit before the split, the receiving contract's rent, or a new figure.
  priceMode?: SplitPriceMode;
  pricePerSqm?: string;         // for priceMode "custom"
  // "transfer": which CPI base the new part is indexed to — the receiving
  // contract's own base (use_original_index), the holder's base for this unit,
  // or another index (value + date).
  cpiMode?: SplitCpiMode;
  cpiBaseValue?: string;        // for cpiMode "custom"
  cpiBaseDate?: string;         // for cpiMode "custom"
  fixedRent?: string;           // for "keep" when the original is charged as a fixed amount
};

// What the holder pays for this unit today — the "holder" price/CPI options.
export type HolderTerms = {
  pricePerSqm: number | null;   // null when charged as a fixed amount
  fixedRent: number | null;
  chargeMethod: string;
  indexBaseValue: number | null;
  indexBaseDate: string | null;
};

export type SplitCandidateContract = {
  id: string;
  tenantName: string;
  status: string;
  rent_per_sqm: number | null;
};

export type SplitInput = {
  space: any;                          // the spaces row being split
  parts: SplitPart[];
  effectiveDate: string;               // YYYY-MM-DD
  holderContractId: string | null;     // base contract currently holding the unit, if any
  allowDifferentTotal: boolean;        // parts may not add up to the original area (re-measurement)
  notes: string;
  documentUrl: string;
};

export type SplitResult = {
  retainedSpaceId: string;
  newSpaceIds: string[];
  amendments: Array<{ contractId: string; amendmentId: string; kind: "holder" | "transfer" }>;
};

const CS_SELECT = "space_id,charge_method,fixed_rent,price_per_sqm,index_base_value,index_base_date,use_original_index,area_override";

export function partsTotal(parts: SplitPart[]): number {
  return Math.round(parts.reduce(function (s, p) { return s + (Number(p.area) || 0); }, 0) * 100) / 100;
}

// Returns an error message, or null when the split is valid.
export function validateSplit(input: SplitInput): string | null {
  const parts = input.parts;
  if (parts.length < 2) return "פיצול דורש לפחות שני חלקים";
  const names = parts.map(function (p) { return p.name.trim(); });
  if (names.some(function (n) { return !n; })) return "לכל חלק צריך שם";
  if (new Set(names).size !== names.length) return "שמות החלקים חייבים להיות שונים זה מזה";
  if (parts.some(function (p) { return !(Number(p.area) > 0); })) return "לכל חלק צריך שטח גדול מאפס";
  if (!input.effectiveDate) return "חסר תאריך תחולה";
  const origArea = Number(input.space?.area) || 0;
  if (origArea > 0 && !input.allowDifferentTotal && Math.abs(partsTotal(parts) - origArea) > 0.5) {
    return "סכום השטחים (" + partsTotal(parts) + ' מ"ר) שונה משטח היחידה (' + origArea + ' מ"ר). תקן, או סמן "השטח הכולל נמדד מחדש"';
  }
  if (input.holderContractId) {
    if (!parts.some(function (p) { return p.disposition === "keep"; })) return "כשיש שוכר מחזיק, לפחות חלק אחד חייב להישאר אצלו. אם השוכר מחזיר את היחידה כולה — השתמש בתוספת \"הורדת יחידות\" במסך החוזים";
  } else if (parts.some(function (p) { return p.disposition === "keep"; })) {
    return 'ליחידה אין שוכר מחזיק, לכן אין "נשאר אצל השוכר"';
  }
  for (const p of parts) {
    if (p.disposition === "transfer") {
      if (!p.targetContractId) return 'לחלק "' + p.name + '" נבחר "עובר לשוכר אחר" בלי לבחור חוזה';
      if (p.targetContractId === input.holderContractId) return 'החלק "' + p.name + '" לא יכול לעבור לשוכר שכבר מחזיק בו';
      const pm = p.priceMode || "receiver";
      if (pm === "holder" && !input.holderContractId) return 'לחלק "' + p.name + '" נבחר מחיר המחזיק, אבל ליחידה אין שוכר מחזיק';
      if (pm === "custom" && !(Number(p.pricePerSqm) >= 0 && p.pricePerSqm !== undefined && p.pricePerSqm !== "")) return 'לחלק "' + p.name + '" נבחר מחיר חדש — יש להזין ₪ למ"ר';
      const cm = p.cpiMode || "receiver";
      if (cm === "holder" && !input.holderContractId) return 'לחלק "' + p.name + '" נבחר מדד המחזיק, אבל ליחידה אין שוכר מחזיק';
      if (cm === "custom" && !(Number(p.cpiBaseValue) > 0 && p.cpiBaseDate)) return 'לחלק "' + p.name + '" נבחר מדד אחר — יש להזין ערך מדד ותאריך';
    }
  }
  return null;
}

async function loadEffectiveSpaces(contractId: string): Promise<{ base: any; effective: any[]; amendCount: number }> {
  const { data: base, error } = await supabase.from("contracts").select("*, tenants(name)").eq("id", contractId).single();
  if (error || !base) throw new Error("החוזה לא נטען: " + (error?.message || contractId));
  const { data: baseCs } = await supabase.from("contract_spaces").select(CS_SELECT).eq("contract_id", contractId);
  const { data: amends, count } = await supabase.from("contracts")
    .select("id, contract_spaces(area_override," + CS_SELECT + ")", { count: "exact" })
    .eq("parent_contract_id", contractId).eq("is_amendment", true)
    .order("amendment_number", { ascending: false });
  const latestWithSpaces: any = ((amends || []) as any[]).find(function (a: any) { return (a.contract_spaces || []).length > 0; });
  const effective: any[] = latestWithSpaces ? latestWithSpaces.contract_spaces : (baseCs || []);
  return { base: base, effective: effective, amendCount: count || (amends || []).length };
}

function amendmentPayloadFrom(base: any, effectiveDate: string, amendNumber: number, chargedArea: number, notes: string, prev: any, docUrl: string | null) {
  return {
    tenant_id: base.tenant_id,
    property_id: base.property_id,
    contract_type: base.contract_type,
    start_date: effectiveDate,
    end_date: base.end_date,
    lease_period_value: base.lease_period_value,
    lease_period_unit: base.lease_period_unit,
    rent_per_sqm: base.rent_per_sqm || null,
    charged_area: chargedArea || base.charged_area,
    vat_type: base.vat_type,
    payment_frequency: base.payment_frequency,
    payment_method: base.payment_method,
    payment_day: base.payment_day,
    indexation_method: base.indexation_method,
    index_base_value: base.index_base_value,
    index_base_date: base.index_base_date,
    status: "active",
    parent_contract_id: base.id,
    is_amendment: true,
    amendment_number: amendNumber,
    amendment_date: effectiveDate,
    document_url: docUrl,
    amendment_prev: prev,
    amendment_notes: notes,
  };
}

async function areasFor(spaceIds: string[], known: Record<string, number>): Promise<Record<string, number>> {
  const missing = spaceIds.filter(function (id) { return known[id] == null; });
  if (missing.length > 0) {
    const { data } = await supabase.from("spaces").select("id,area").in("id", missing);
    (data || []).forEach(function (s: any) { known[s.id] = Number(s.area) || 0; });
  }
  return known;
}

function fmtArea(n: number): string { return (Math.round(n * 100) / 100).toLocaleString("he-IL"); }
function fmtDate(d: string): string { return d ? new Date(d).toLocaleDateString("he-IL") : ""; }

export async function performUnitSplit(input: SplitInput): Promise<SplitResult> {
  const err = validateSplit(input);
  if (err) throw new Error(err);
  const space = input.space;
  const date = input.effectiveDate;
  const origName: string = space.space_name;
  const origArea: number = Number(space.area) || 0;
  const docUrl = input.documentUrl?.trim() || null;

  // 0. Freeze the pre-split area on every snapshot row that points at this unit
  //    (holder base + earlier amendments + ended contracts). Idempotent and
  //    harmless if a later step fails: the frozen value equals today's area.
  if (origArea > 0) {
    const { error: fErr } = await supabase.from("contract_spaces").update({ area_override: origArea }).eq("space_id", space.id).is("area_override", null);
    if (fErr) throw new Error("הקפאת השטח ההיסטורי נכשלה: " + fErr.message);
  }

  // The retained part reuses the original row: the first "keep" part when a
  // tenant holds the unit, otherwise simply the first part.
  const retainedIdx = input.holderContractId
    ? input.parts.findIndex(function (p) { return p.disposition === "keep"; })
    : 0;

  // 1. New rows for every other part (harmless leftovers if a later step fails).
  const newIds: Record<number, string> = {};
  for (let i = 0; i < input.parts.length; i++) {
    if (i === retainedIdx) continue;
    const p = input.parts[i];
    const { data: ins, error: iErr } = await supabase.from("spaces").insert({
      property_id: space.property_id,
      space_name: p.name.trim(),
      space_type: space.space_type,
      area: Number(p.area),
      floor: space.floor ?? null,
      status: p.disposition === "vacant" ? "vacant" : "occupied",
      is_commercial: space.is_commercial ?? null,
      uses_waste_service: space.uses_waste_service ?? null,
      company_id: space.company_id ?? null,
      split_from_space_id: space.id,
      split_at: date,
      notes: ("פוצל מ-" + origName + " (" + fmtArea(origArea) + ' מ"ר) ב-' + fmtDate(date) + (input.notes ? " · " + input.notes : "")).slice(0, 500),
    }).select("id").single();
    if (iErr || !ins) throw new Error("יצירת החלק \"" + p.name + "\" נכשלה: " + (iErr?.message || ""));
    newIds[i] = ins.id;
  }
  const idOf = function (i: number): string { return i === retainedIdx ? space.id : newIds[i]; };

  // 1b. The parts inherit the original unit's billing-group memberships
  //     (management / waste, every year): same physical area, same billing
  //     rule. Without this a new part would fall back to the contract's
  //     management figure instead of the property's advance rate.
  const { data: memberships } = await supabase.from("billing_group_spaces").select("billing_group_id").eq("space_id", space.id);
  const newIdList = Object.keys(newIds).map(function (k) { return newIds[Number(k)]; });
  if ((memberships || []).length > 0 && newIdList.length > 0) {
    const rows: any[] = [];
    (memberships || []).forEach(function (m: any) { newIdList.forEach(function (sid) { rows.push({ billing_group_id: m.billing_group_id, space_id: sid }); }); });
    const { error: bgErr } = await supabase.from("billing_group_spaces").insert(rows);
    if (bgErr) throw new Error("שיוך החלקים לקבוצות החיוב נכשל: " + bgErr.message);
  }
  const areaKnown: Record<string, number> = {};
  input.parts.forEach(function (p, i) { areaKnown[idOf(i)] = Number(p.area) || 0; });

  const amendments: SplitResult["amendments"] = [];
  const partsDesc = input.parts.map(function (p) {
    return p.name.trim() + " (" + fmtArea(Number(p.area)) + ' מ"ר)' +
      (p.disposition === "keep" ? " — נשאר" : p.disposition === "vacant" ? " — פנוי" : " — עובר לשוכר אחר");
  }).join(", ");
  const splitRecord = {
    space_id: space.id, previous_name: origName, previous_area: origArea, effective_date: date,
    parts: input.parts.map(function (p, i) { return { space_id: idOf(i), name: p.name.trim(), area: Number(p.area), disposition: p.disposition, target_contract_id: p.targetContractId || null }; }),
  };

  // 2. Holder amendment: its snapshot keeps only the parts that stay with the tenant.
  let holderTerms: HolderTerms | null = null;
  if (input.holderContractId) {
    const h = await loadEffectiveSpaces(input.holderContractId);
    const origCs = h.effective.find(function (cs: any) { return cs.space_id === space.id; });
    holderTerms = {
      chargeMethod: origCs?.charge_method || "per_sqm",
      pricePerSqm: origCs?.charge_method === "fixed" ? null : (origCs?.price_per_sqm != null ? Number(origCs.price_per_sqm) : (h.base.rent_per_sqm != null ? Number(h.base.rent_per_sqm) : null)),
      fixedRent: origCs?.fixed_rent != null ? Number(origCs.fixed_rent) : null,
      indexBaseValue: (origCs && origCs.use_original_index === false && origCs.index_base_value != null) ? Number(origCs.index_base_value) : (h.base.index_base_value != null ? Number(h.base.index_base_value) : null),
      indexBaseDate: (origCs && origCs.use_original_index === false && origCs.index_base_date) ? String(origCs.index_base_date).slice(0, 10) : (h.base.index_base_date ? String(h.base.index_base_date).slice(0, 10) : null),
    };
    const others = h.effective.filter(function (cs: any) { return cs.space_id !== space.id; });
    const isFixed = origCs?.charge_method === "fixed";
    const keepRows = input.parts.map(function (p, i) { return { p: p, i: i }; })
      .filter(function (x) { return x.p.disposition === "keep"; })
      .map(function (x) {
        const partArea = Number(x.p.area) || 0;
        const fixed = isFixed
          ? (x.p.fixedRent !== undefined && x.p.fixedRent !== "" ? Number(x.p.fixedRent) : (origArea > 0 ? Math.round((Number(origCs?.fixed_rent) || 0) * partArea / origArea * 100) / 100 : null))
          : null;
        return {
          space_id: idOf(x.i),
          charge_method: origCs?.charge_method || "per_sqm",
          price_per_sqm: isFixed ? null : (origCs?.price_per_sqm ?? null),
          fixed_rent: isFixed ? fixed : null,
          use_original_index: origCs?.use_original_index ?? true,
          index_base_value: origCs?.index_base_value ?? null,
          index_base_date: origCs?.index_base_date ?? null,
          area_override: null as number | null,
        };
      });
    const rows = others.map(function (cs: any) {
      return {
        space_id: cs.space_id, charge_method: cs.charge_method || "per_sqm", price_per_sqm: cs.price_per_sqm ?? null, fixed_rent: cs.fixed_rent ?? null,
        use_original_index: cs.use_original_index ?? true, index_base_value: cs.index_base_value ?? null, index_base_date: cs.index_base_date ?? null,
        area_override: cs.area_override ?? null,
      };
    }).concat(keepRows);
    await areasFor(rows.map(function (r) { return r.space_id; }), areaKnown);
    const chargedArea = rows.reduce(function (s, r) { return s + (areaKnown[r.space_id] || 0); }, 0);
    const notes = "פיצול היחידה " + origName + " (" + fmtArea(origArea) + ' מ"ר) מ-' + fmtDate(date) + ": " + partsDesc + (input.notes ? " · " + input.notes : "");
    const { data: am, error: aErr } = await supabase.from("contracts")
      .insert(amendmentPayloadFrom(h.base, date, h.amendCount + 1, chargedArea, notes, { split: splitRecord }, docUrl))
      .select("id").single();
    if (aErr || !am) throw new Error("יצירת התוספת לשוכר המחזיק נכשלה: " + (aErr?.message || ""));
    const { error: csErr } = await supabase.from("contract_spaces").insert(rows.map(function (r) { return { ...r, contract_id: am.id }; }));
    if (csErr) throw new Error("רישום היחידות בתוספת נכשל: " + csErr.message);
    amendments.push({ contractId: input.holderContractId, amendmentId: am.id, kind: "holder" });
    await logAudit({ entity_type: "contract", entity_id: am.id, action: "create", notes: "תוספת אוטומטית מפיצול יחידה: " + origName });
  }

  // 3. Receiving contracts: one "add units" amendment per target contract.
  const byTarget: Record<string, number[]> = {};
  input.parts.forEach(function (p, i) {
    if (p.disposition !== "transfer" || !p.targetContractId) return;
    if (!byTarget[p.targetContractId]) byTarget[p.targetContractId] = [];
    byTarget[p.targetContractId].push(i);
  });
  for (const targetId of Object.keys(byTarget)) {
    const t = await loadEffectiveSpaces(targetId);
    const rows = t.effective.map(function (cs: any) {
      return {
        space_id: cs.space_id, charge_method: cs.charge_method || "per_sqm", price_per_sqm: cs.price_per_sqm ?? null, fixed_rent: cs.fixed_rent ?? null,
        use_original_index: cs.use_original_index ?? true, index_base_value: cs.index_base_value ?? null, index_base_date: cs.index_base_date ?? null,
        area_override: cs.area_override ?? null,
      };
    });
    const added: string[] = [];
    byTarget[targetId].forEach(function (i) {
      const p = input.parts[i];
      const pm: SplitPriceMode = p.priceMode || "receiver";
      const price = pm === "custom" ? Number(p.pricePerSqm)
        : pm === "holder" ? (holderTerms?.pricePerSqm ?? (holderTerms?.fixedRent != null && origArea > 0 ? Math.round(holderTerms.fixedRent / origArea * 100) / 100 : 0))
        : (Number(t.base.rent_per_sqm) || 0);
      const cm: SplitCpiMode = p.cpiMode || "receiver";
      const idx = cm === "custom" ? { value: Number(p.cpiBaseValue), date: p.cpiBaseDate || null }
        : cm === "holder" ? { value: holderTerms?.indexBaseValue ?? null, date: holderTerms?.indexBaseDate ?? null }
        : null;
      const useOriginal = !idx || idx.value == null;
      rows.push({ space_id: idOf(i), charge_method: "per_sqm", price_per_sqm: price, fixed_rent: null,
        use_original_index: useOriginal, index_base_value: useOriginal ? null : idx!.value, index_base_date: useOriginal ? null : idx!.date, area_override: null });
      added.push(p.name.trim() + " (" + fmtArea(Number(p.area)) + ' מ"ר, ₪' + price.toLocaleString("he-IL") + '/מ"ר ' +
        (pm === "holder" ? "לפי מחיר המחזיק לפני הפיצול" : pm === "custom" ? "מחיר חדש" : "לפי מחיר ההסכם המקבל") +
        ", הצמדה " + (cm === "receiver" || useOriginal ? "למדד הבסיס של ההסכם המקבל" : cm === "holder" ? "למדד הבסיס של המחזיק (" + idx!.value + (idx!.date ? " · " + fmtDate(idx!.date) : "") + ")" : "למדד " + idx!.value + (idx!.date ? " · " + fmtDate(idx!.date) : "")) + ")");
    });
    await areasFor(rows.map(function (r) { return r.space_id; }), areaKnown);
    const chargedArea = rows.reduce(function (s, r) { return s + (areaKnown[r.space_id] || 0); }, 0);
    const notes = "הוספת יחידות מפיצול " + origName + " מ-" + fmtDate(date) + ": " + added.join(", ") + (input.notes ? " · " + input.notes : "");
    const { data: am, error: aErr } = await supabase.from("contracts")
      .insert(amendmentPayloadFrom(t.base, date, t.amendCount + 1, chargedArea, notes, { split_in: { from_space_id: space.id, from_name: origName, parts: byTarget[targetId].map(function (i) { return { space_id: idOf(i), name: input.parts[i].name.trim(), area: Number(input.parts[i].area) }; }) } }, docUrl))
      .select("id").single();
    if (aErr || !am) throw new Error("יצירת התוספת לשוכר המקבל נכשלה: " + (aErr?.message || ""));
    const { error: csErr } = await supabase.from("contract_spaces").insert(rows.map(function (r) { return { ...r, contract_id: am.id }; }));
    if (csErr) throw new Error("רישום היחידות בתוספת המקבלת נכשל: " + csErr.message);
    amendments.push({ contractId: targetId, amendmentId: am.id, kind: "transfer" });
    await logAudit({ entity_type: "contract", entity_id: am.id, action: "create", notes: "תוספת אוטומטית מפיצול יחידה: קבלת " + added.join(", ") + " מ-" + origName });
  }

  // 4. Finally the original row becomes the retained part.
  const rp = input.parts[retainedIdx];
  const retainedStatus = input.holderContractId ? (space.status === "occupied" ? "occupied" : space.status) : (rp.disposition === "transfer" ? "occupied" : "vacant");
  const { error: uErr } = await supabase.from("spaces").update({
    space_name: rp.name.trim(),
    area: Number(rp.area),
    status: retainedStatus,
    split_at: date,
    notes: ((space.notes ? space.notes + " · " : "") + "פוצלה ב-" + fmtDate(date) + " (במקור " + origName + ", " + fmtArea(origArea) + ' מ"ר)').slice(0, 500),
  }).eq("id", space.id);
  if (uErr) throw new Error("עדכון היחידה המקורית נכשל: " + uErr.message);

  await logAudit({
    entity_type: "space", entity_id: space.id, action: "split_unit",
    notes: origName + " (" + fmtArea(origArea) + ' מ"ר) → ' + partsDesc + " · מ-" + fmtDate(date) + (amendments.length ? " · " + amendments.length + " תוספות נוצרו" : ""),
  });

  return { retainedSpaceId: space.id, newSpaceIds: Object.keys(newIds).map(function (k) { return newIds[Number(k)]; }), amendments: amendments };
}
