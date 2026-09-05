// דוח ריכוז הסכמי שכירות לשמאי — קובץ Excel שנבנה ישירות מנתוני המערכת
// (לא מצילומי מסך): גיליון ריכוז הסכמים ברמת יחידה, צפי 12 חודשים קדימה,
// ריכוז יחידות והנחות. נחתך לפי נכס בודד או חברה (כל נכסיה).
//
// עקרונות חישוב (עקביים עם שאר המערכת):
// - שכ"ד בסיס למ"ר = התעריף החוזי הנוכחי לפי לוח המדרגות והאופציות
//   הממומשות (buildSpaceRentSchedule) — לא התעריף של שנה 1.
// - הצמדה: יחס המדד הידוע האחרון מול מדד הבסיס של החוזה (no_drop ⇒ לא
//   יורד מתחת ל-1). הצפי מניח מדד יציב — ההצמדה בפועל רק תגדיל.
// - צפי 12 חודשים: הליכה חודש-בחודש מה-1 בחודש הבא — מדרגות במועדן,
//   קיצוץ בתאריך סיום (כולל הארכות תוספת ואופציות ממומשות), חוזים
//   עתידיים מתחילת תקופתם, גרייס, חלקיות ימים, חניות בתשלום ומינימום פדיון.
import { supabase } from "@/lib/supabase";
import { buildSpaceRentSchedule, rentAtDate } from "@/lib/contract-utils";
import { graceFactorsFor } from "@/lib/store-opening";
import { minRentPerSqmAtDate } from "@/lib/min-rent";
import { isParkingOnly, billableParkingRows, parkingMonthlyTotal, parkingSpotCount, parkingRentAtDate } from "@/lib/parking-rent";
import { getVatPct } from "@/lib/vat";
import { csArea } from "@/lib/contract-area";

const LIVE = ["active", "extended", "expiring", "upcoming", "future"];
const TYPE_LABELS: Record<string, string> = { office: "משרדים", retail: "מסחר", store: "חנות", warehouse: "מחסן", industrial: "תעשיה", shed: "סככה", yard: "חצר צמודה", other: "אחר" };

function d(v: any): Date | null { if (!v) return null; const x = new Date(v); return isNaN(x.getTime()) ? null : x; }
function fmtD(v: any): string { const x = d(v); return x ? x.toLocaleDateString("he-IL") : "—"; }
function monthName(m: number): string { return ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"][m - 1] || String(m); }
function r2(n: number): number { return Math.round(n * 100) / 100; }

export async function buildAppraiserWorkbook(params: { propertyIds: string[]; title: string }): Promise<{ blob: Blob; contracts: number }> {
  const pids = params.propertyIds;
  const today = new Date();

  const [{ data: props }, { data: contracts }, { data: allSpaces }, cpiRes, vatPct] = await Promise.all([
    supabase.from("properties").select("id,name,city,total_area").in("id", pids),
    supabase.from("contracts")
      .select("id, property_id, tenant_id, contract_type, status, start_date, end_date, rent_per_sqm, charged_area, investment_addition, rent_type, revenue_pct, min_rent_per_sqm, minimum_rent, payment_method, payment_frequency, payment_day, indexation_method, index_mechanism, index_base_value, index_base_date, early_termination_allowed, termination_notice_days, termination_by, grace_months, grace_days, grace_phase2_days, grace_type, grace_discount_pct, grace_mgmt_discount_pct, grace_ends_on_opening, mgmt_charge_starts, mgmt_free_max_days, works_start_date, planned_handover_date, actual_handover_date, planned_opening_date, actual_opening_date, opening_rule, opening_max_days_from_handover, lease_period_value, lease_period_unit, tenants(name), contract_spaces(area_override,follows_contract_options,space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area,space_type))")
      .in("property_id", pids).in("status", LIVE).eq("is_amendment", false).order("start_date"),
    supabase.from("spaces").select("id,property_id,space_name,space_type,area,floor,status").in("property_id", pids).order("space_name"),
    supabase.from("cpi_records").select("year,month,value").eq("base_year", 2022).order("year", { ascending: false }).order("month", { ascending: false }).limit(1),
    getVatPct(),
  ]);
  const cs0 = contracts ?? [];
  const cids = cs0.map(function (c: any) { return c.id; });
  const knownIdx = (cpiRes.data && cpiRes.data[0]) ? { y: Number(cpiRes.data[0].year), m: Number(cpiRes.data[0].month), v: Number(cpiRes.data[0].value) } : null;

  const [{ data: amends }, { data: tiers }, { data: options }, { data: parking }] = await Promise.all([
    cids.length ? supabase.from("contracts").select("id,parent_contract_id,end_date,amendment_date,amendment_number,start_date,rent_per_sqm,contract_spaces(area_override,follows_contract_options,space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area,space_type))").eq("is_amendment", true).in("parent_contract_id", cids) : Promise.resolve({ data: [] } as any),
    cids.length ? supabase.from("contract_price_tiers").select("*").in("contract_id", cids).is("option_id", null) : Promise.resolve({ data: [] } as any),
    cids.length ? supabase.from("contract_options").select("id,contract_id,option_number,is_exercised,status,start_date,end_date,duration_months,duration_years").in("contract_id", cids) : Promise.resolve({ data: [] } as any),
    cids.length ? supabase.from("parking_subscriptions").select("contract_id,monthly_fee,quantity,is_included_in_rent,subscription_type,status").eq("status", "active") : Promise.resolve({ data: [] } as any),
  ]);
  const byC = function (rows: any[], key: string) {
    const m: Record<string, any[]> = {};
    (rows || []).forEach(function (x: any) { (m[x[key]] = m[x[key]] || []).push(x); });
    return m;
  };
  const amendsBy = byC(amends ?? [], "parent_contract_id");
  const tiersBy = byC(tiers ?? [], "contract_id");
  const optsBy = byC(options ?? [], "contract_id");
  // חניות שנוספו בתוספת רשומות תחת מזהה התוספת — מקופלות לחוזה הבסיס.
  const amendParent: Record<string, string> = {};
  (amends ?? []).forEach(function (a: any) { amendParent[a.id] = a.parent_contract_id; });
  const parkBy: Record<string, any[]> = {};
  (parking ?? []).forEach(function (x: any) {
    const base = amendParent[x.contract_id] || x.contract_id;
    if (cids.indexOf(base) === -1) return;
    (parkBy[base] = parkBy[base] || []).push(x);
  });

  // ── חישובים לכל חוזה ──
  type UnitRow = { unit: string; area: number | null; basePsm: number | null; idxPsm: number | null; monthly: number; note: string };
  type CRow = {
    c: any; num: number; tenant: string; effEnd: Date | null; ratio: number; ratioNote: string;
    units: UnitRow[]; unitsSummary: string; monthlyNow: number; forecast12: number; notes: string[];
  };
  const perProp: Record<string, CRow[]> = {};

  cs0.forEach(function (c: any) {
    const cTiers = tiersBy[c.id] || [];
    const cOpts = optsBy[c.id] || [];
    const exercised = cOpts.filter(function (o: any) { return o.is_exercised || o.status === "exercised"; });
    const parkRows = billableParkingRows(parkBy[c.id] || []);

    // המצב האפקטיבי של ההסכם: תוספת שמצרפת/מחליפה יחידות יוצרת צילום-מצב
    // חדש, והאחרון קובע (כמו במסך היחידות). צילום ללא יחידות אינו מחליף.
    const fam = (amendsBy[c.id] || []).slice();
    const rank = function (x: any): number {
      const dt = d(x.amendment_date || x.start_date);
      return (dt ? dt.getTime() : 0) * 1000 + (Number(x.amendment_number) || 0);
    };
    fam.sort(function (a: any, b: any) { return rank(a) - rank(b); });
    let effSpaces: any[] = c.contract_spaces || [];
    let effRps: number = Number(c.rent_per_sqm) || 0;
    fam.forEach(function (a: any) {
      if ((a.contract_spaces || []).length > 0) {
        effSpaces = a.contract_spaces;
        if (Number(a.rent_per_sqm) > 0) effRps = Number(a.rent_per_sqm);
      }
    });
    // מתי כל יחידה הצטרפה (להערת "נוסף בתוספת" ולקיטום בצפי)
    const unitEntry: Record<string, Date | null> = {};
    (c.contract_spaces || []).forEach(function (cs: any) { if (cs.space_id && unitEntry[cs.space_id] === undefined) unitEntry[cs.space_id] = d(c.start_date); });
    fam.forEach(function (a: any) {
      (a.contract_spaces || []).forEach(function (cs: any) {
        if (cs.space_id && unitEntry[cs.space_id] === undefined) unitEntry[cs.space_id] = d(a.amendment_date || a.start_date);
      });
    });

    // תום תקופה אפקטיבי
    let effEnd = d(c.end_date);
    fam.forEach(function (a: any) { const e = d(a.end_date); if (e && (!effEnd || e > effEnd)) effEnd = e; });
    exercised.forEach(function (o: any) { const e = d(o.end_date); if (e && (!effEnd || e > effEnd)) effEnd = e; });

    // יחס הצמדה נוכחי
    let ratio = 1; let ratioNote = "";
    const base = Number(c.index_base_value) || 0;
    if (base > 0 && knownIdx) {
      ratio = knownIdx.v / base;
      if ((c.index_mechanism === "no_drop" || c.index_mechanism === "highest") && ratio < 1) ratio = 1;
    } else { ratioNote = "ללא מדד בסיס במערכת — מוצג ללא הצמדה"; }

    // שורות יחידות (בסיס לפי לוח המדרגות נכון להיום)
    const units: UnitRow[] = [];
    const schedByCs: Record<string, any> = {};
    const baseStart = d(c.start_date);
    effSpaces.forEach(function (cs: any, i: number) {
      const area = csArea(cs);
      const name = cs.spaces?.space_name || "יחידה";
      const ent = unitEntry[cs.space_id];
      const addedNote = ent && baseStart && ent.getTime() > baseStart.getTime() ? "נוסף בתוספת מ-" + fmtD(ent) : "";
      if (cs.charge_method === "included") {
        units.push({ unit: name, area: area || null, basePsm: null, idxPsm: null, monthly: 0, note: ["כלול במחיר יחידה אחרת בהסכם", addedNote].filter(Boolean).join(" · ") });
        return;
      }
      const isFixed = cs.charge_method === "fixed" && Number(cs.fixed_rent) > 0;
      const baseRent = isFixed ? Number(cs.fixed_rent) : (Number(cs.price_per_sqm) || effRps || 0) * area;
      const sched = buildSpaceRentSchedule({ space: cs, contractStartDate: c.start_date, spaceArea: area, isFixed: isFixed, spaceBaseRent: baseRent, spaceTiers: [], contractTiers: cTiers, exercisedOptions: exercised });
      schedByCs["u" + i] = sched;
      const mNow = rentAtDate(sched, today);
      units.push({
        unit: name, area: area || null,
        basePsm: area > 0 && !isFixed ? r2(mNow / area) : null,
        idxPsm: area > 0 && !isFixed ? r2((mNow * ratio) / area) : null,
        monthly: r2(mNow * ratio),
        note: [isFixed ? "שכ\"ד קבוע (לא למ\"ר)" : "", addedNote].filter(Boolean).join(" · "),
      });
    });
    // מינימום פדיון (חוזה אחוז ממחזור ללא שכ"ד יחידות)
    const unitsMonthly = units.reduce(function (a, u) { return a + u.monthly; }, 0);
    if (unitsMonthly === 0 && (c.rent_type === "revenue_pct" || Number(c.revenue_pct) > 0)) {
      const mArea = effSpaces.reduce(function (a: number, x: any) { return a + csArea(x); }, 0) || Number(c.charged_area) || 0;
      const minPsm = Number(c.min_rent_per_sqm) > 0 ? minRentPerSqmAtDate({ baseMinPerSqm: Number(c.min_rent_per_sqm), tiers: cTiers, contractStart: c.start_date, date: today }) : 0;
      const minMonthly = minPsm > 0 ? minPsm * mArea : (Number(c.minimum_rent) || 0);
      if (minMonthly > 0) units.push({ unit: "מינימום פדיון (" + (Number(c.revenue_pct) || 0) + "% ממחזור)", area: mArea || null, basePsm: minPsm > 0 ? r2(minPsm) : null, idxPsm: minPsm > 0 ? r2(minPsm * ratio) : null, monthly: r2(minMonthly * ratio), note: "שכ\"ד פדיון — מוצג המינימום החוזי" });
    }
    // חניות בתשלום
    if (parkRows.length > 0) {
      const spots = parkingSpotCount(parkRows);
      const pm = isParkingOnly(c)
        ? parkingRentAtDate({ contract: c, parkingRows: parkRows, contractTiers: cTiers, exercisedOptions: exercised, date: today })
        : parkingMonthlyTotal(parkRows);
      if (pm > 0) units.push({ unit: "חניות (" + spots + " מקומות)", area: null, basePsm: null, idxPsm: null, monthly: r2(pm * ratio), note: "דמי חניה צמודים למדד" });
    }
    // תוספת השקעות
    if (Number(c.investment_addition) > 0) units.push({ unit: "תוספת שכ\"ד בגין השקעות", area: null, basePsm: null, idxPsm: null, monthly: r2(Number(c.investment_addition) * ratio), note: "" });

    const monthlyNow = r2(units.reduce(function (a, u) { return a + u.monthly; }, 0));

    // צפי 12 חודשים: מה-1 בחודש הבא
    let forecast = 0;
    const f0 = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const cStart = d(c.start_date);
    for (let m = 0; m < 12; m++) {
      const mS = new Date(f0.getFullYear(), f0.getMonth() + m, 1);
      const mE = new Date(f0.getFullYear(), f0.getMonth() + m + 1, 1);
      if (cStart && cStart >= mE) continue;
      if (effEnd && effEnd < mS) continue;
      let baseM = 0;
      effSpaces.forEach(function (cs: any, i: number) {
        const sched = schedByCs["u" + i];
        const ent = unitEntry[cs.space_id];
        if (ent && ent >= mE) return; // היחידה טרם הצטרפה בחודש זה
        if (sched) baseM += rentAtDate(sched, mS);
      });
      if (baseM === 0 && (c.rent_type === "revenue_pct" || Number(c.revenue_pct) > 0)) {
        const mArea2 = effSpaces.reduce(function (a: number, x: any) { return a + csArea(x); }, 0) || Number(c.charged_area) || 0;
        const minPsm2 = Number(c.min_rent_per_sqm) > 0 ? minRentPerSqmAtDate({ baseMinPerSqm: Number(c.min_rent_per_sqm), tiers: cTiers, contractStart: c.start_date, date: mS }) : 0;
        baseM = minPsm2 > 0 ? minPsm2 * mArea2 : (Number(c.minimum_rent) || 0);
      }
      if (parkRows.length > 0) {
        baseM += isParkingOnly(c)
          ? parkingRentAtDate({ contract: c, parkingRows: parkRows, contractTiers: cTiers, exercisedOptions: exercised, date: mS })
          : parkingMonthlyTotal(parkRows);
      }
      baseM += Number(c.investment_addition) || 0;
      const from = cStart && cStart > mS ? cStart : mS;
      const to = effEnd && effEnd < mE ? new Date(effEnd.getFullYear(), effEnd.getMonth(), effEnd.getDate() + 1) : mE;
      const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
      const dim = Math.round((mE.getTime() - mS.getTime()) / 86400000);
      const gf = graceFactorsFor({ contract: c, periodStart: mS, periodEnd: mE });
      forecast += baseM * ratio * gf.rentFactor * Math.min(1, days / dim);
    }

    // הערות אוטומטיות
    const notes: string[] = [];
    if (c.status === "upcoming" || c.status === "future") notes.push("הסכם חתום המתחיל " + fmtD(c.start_date));
    if (effEnd) {
      const monthsLeft = (effEnd.getTime() - today.getTime()) / (86400000 * 30.44);
      if (monthsLeft <= 12) notes.push("מסתיים " + fmtD(effEnd) + " (בתוך 12 חודשים)");
    }
    const futureOpts = cOpts.filter(function (o: any) { return !o.is_exercised && o.status !== "declined" && o.status !== "expired"; });
    if (futureOpts.length > 0) notes.push(futureOpts.length + " אופציות הארכה שטרם מומשו");
    const stepTiers = (cTiers || []).filter(function (t: any) { return t.increase_type && t.increase_type !== "none"; });
    if (stepTiers.length > 0) {
      const pct = stepTiers[0].increase_type === "pct" ? (Number(stepTiers[0].increase_value) + "%") : "לפי לוח מדרגות";
      notes.push("מדרגות עלייה חוזיות (" + pct + (stepTiers[0].is_recurring ? " חוזר" : "") + ")");
    }
    if (c.early_termination_allowed) notes.push("סיום מוקדם בהודעה של " + (c.termination_notice_days || 30) + " ימים (" + (c.termination_by === "landlord" ? "משכיר" : c.termination_by === "tenant" ? "שוכר" : "שני הצדדים") + ")");
    if (isParkingOnly(c)) notes.push("הסכם חניות בלבד");
    if (ratioNote) notes.push(ratioNote);

    const unitsSummary = units.map(function (u) { return u.unit + (u.area ? " (" + u.area + ' מ"ר)' : ""); }).join(" · ");
    (perProp[c.property_id] = perProp[c.property_id] || []).push({
      c: c, num: 0, tenant: c.tenants?.name || "—", effEnd: effEnd, ratio: ratio, ratioNote: ratioNote,
      units: units, unitsSummary: unitsSummary, monthlyNow: monthlyNow, forecast12: r2(forecast), notes: notes,
    });
  });
  Object.keys(perProp).forEach(function (pid) {
    perProp[pid].forEach(function (row, i) { row.num = i + 1; });
  });

  // ── בניית החוברת ──
  const ExcelJS: any = (await import("exceljs")).default || (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  wb.creator = "PropManager";
  const NAVY = "FF1E3A5F"; const GREEN = "FF059669"; const LIGHT = "FFF8FAFC"; const YELLOW = "FFFFF7DB";
  const font = function (o: any) { return { name: "Arial", size: 10, ...o }; };
  const money = "#,##0.00";
  const headerRow = function (ws: any, cells: string[]) {
    const r = ws.addRow(cells);
    r.eachCell(function (cell: any) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      cell.font = font({ color: { argb: "FFFFFFFF" }, bold: true });
      cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
    });
    return r;
  };
  const titleRow = function (ws: any, text: string, cols: number) {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, cols);
    r.getCell(1).font = font({ size: 14, bold: true, color: { argb: NAVY } });
    r.getCell(1).alignment = { horizontal: "right" };
    return r;
  };
  const asOf = "נכון ליום " + today.toLocaleDateString("he-IL");
  const idxTxt = knownIdx ? ("מדד ידוע אחרון: " + monthName(knownIdx.m) + " " + knownIdx.y + " = " + knownIdx.v) : "אין מדד במערכת";

  // גיליון 1 — ריכוז הסכמים
  const ws1 = wb.addWorksheet("ריכוז הסכמים", { views: [{ rightToLeft: true }] });
  ws1.columns = [{ width: 7 }, { width: 26 }, { width: 22 }, { width: 9 }, { width: 11 }, { width: 11 }, { width: 14 }, { width: 14 }, { width: 11 }, { width: 11 }, { width: 16 }, { width: 10 }, { width: 30 }];
  titleRow(ws1, params.title + " — ריכוז הסכמי שכירות", 13);
  const sub1 = ws1.addRow([asOf + ' · כל הסכומים בש"ח ללא מע"מ (מע"מ ' + vatPct + '%) · ' + idxTxt]);
  ws1.mergeCells(sub1.number, 1, sub1.number, 13);
  sub1.getCell(1).font = font({ size: 9, color: { argb: "FF64748B" } });
  ws1.addRow([]);
  let grandMonthly = 0; let grandArea = 0; let grandContracts = 0; let grandUnits = 0;
  (props ?? []).forEach(function (p: any) {
    const rows = perProp[p.id] || [];
    if ((props ?? []).length > 1) {
      const pr = ws1.addRow(["🏢 " + p.name + (p.city ? " — " + p.city : "")]);
      ws1.mergeCells(pr.number, 1, pr.number, 13);
      pr.getCell(1).font = font({ size: 12, bold: true, color: { argb: NAVY } });
    }
    headerRow(ws1, ["מס'", "שוכר", "יחידה / רכיב", 'שטח (מ"ר)', 'שכ"ד בסיס למ"ר', 'שכ"ד צמוד למ"ר', 'שכ"ד חודשי צמוד', 'שכ"ד שנתי', "תחילה", "סיום", "מדד בסיס", "הצמדה", "הערות"]);
    let pMonthly = 0; let pArea = 0;
    rows.forEach(function (cr) {
      cr.units.forEach(function (u, ui) {
        const noteParts = [u.note].concat(ui === 0 ? cr.notes : []).filter(Boolean);
        const r = ws1.addRow([
          cr.num, ui === 0 ? cr.tenant : "", u.unit, u.area ?? "—",
          u.basePsm ?? "—", u.idxPsm ?? "—", u.monthly, r2(u.monthly * 12),
          fmtD(cr.c.start_date), cr.effEnd ? fmtD(cr.effEnd) : "—",
          cr.c.index_base_value ? (String(cr.c.index_base_value) + (cr.c.index_base_date ? " (" + fmtD(cr.c.index_base_date) + ")" : "")) : "—",
          cr.c.index_base_value ? "t-2" : "—",
          noteParts.join(" · "),
        ]);
        r.eachCell(function (cell: any, col: number) {
          cell.font = font({});
          cell.alignment = { horizontal: col === 13 ? "right" : (col <= 3 ? "right" : "center"), vertical: "middle", wrapText: col === 13 || col === 3 };
          if (col === 7 || col === 8 || col === 5 || col === 6) cell.numFmt = money;
          if (cr.num % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
        });
        pMonthly += u.monthly; pArea += u.area || 0; grandUnits++;
      });
    });
    const tr = ws1.addRow(['סה"כ', rows.length + " הסכמים", "", r2(pArea), "", "", r2(pMonthly), r2(pMonthly * 12), "", "", "", "", ""]);
    tr.eachCell(function (cell: any, col: number) {
      cell.font = font({ bold: true, color: { argb: GREEN } });
      if (col === 7 || col === 8) cell.numFmt = money;
      cell.border = { top: { style: "double", color: { argb: GREEN } } };
    });
    const vr = ws1.addRow(["", 'סה"כ כולל מע"מ (' + vatPct + '%)', "", "", "", "", r2(pMonthly * (1 + vatPct / 100)), r2(pMonthly * 12 * (1 + vatPct / 100)), "", "", "", "", ""]);
    vr.eachCell(function (cell: any, col: number) { cell.font = font({ bold: true }); if (col === 7 || col === 8) cell.numFmt = money; });
    ws1.addRow([]);
    grandMonthly += pMonthly; grandArea += pArea; grandContracts += rows.length;
  });
  if ((props ?? []).length > 1) {
    const gr = ws1.addRow(['סה"כ כללי', grandContracts + " הסכמים · " + grandUnits + " שורות", "", r2(grandArea), "", "", r2(grandMonthly), r2(grandMonthly * 12), "", "", "", "", ""]);
    gr.eachCell(function (cell: any, col: number) { cell.font = font({ bold: true, size: 11, color: { argb: NAVY } }); if (col === 7 || col === 8) cell.numFmt = money; });
  }

  // גיליון 2 — צפי 12 חודשים
  const f0 = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const fEnd = new Date(f0.getFullYear(), f0.getMonth() + 11, 1);
  const ws2 = wb.addWorksheet("צפי 12 חודשים", { views: [{ rightToLeft: true }] });
  ws2.columns = [{ width: 7 }, { width: 26 }, { width: 38 }, { width: 15 }, { width: 15 }, { width: 40 }];
  titleRow(ws2, "צפי הכנסות שכ\"ד — 12 חודשים קדימה (" + String(f0.getMonth() + 1).padStart(2, "0") + "/" + f0.getFullYear() + " – " + String(fEnd.getMonth() + 1).padStart(2, "0") + "/" + fEnd.getFullYear() + ")", 6);
  const sub2 = ws2.addRow(["ללא מע\"מ · לפי רמת המדד הידועה היום (ללא הצמדה עתידית) · מדרגות חוזיות במועדן · קיצוץ בתאריכי סיום · חוזים חתומים עתידיים מתחילתם"]);
  ws2.mergeCells(sub2.number, 1, sub2.number, 6);
  sub2.getCell(1).font = font({ size: 9, color: { argb: "FF64748B" } });
  ws2.addRow([]);
  let grandF = 0; let grandRun = 0;
  (props ?? []).forEach(function (p: any) {
    const rows = perProp[p.id] || [];
    if ((props ?? []).length > 1) {
      const pr = ws2.addRow(["🏢 " + p.name]);
      ws2.mergeCells(pr.number, 1, pr.number, 6);
      pr.getCell(1).font = font({ size: 12, bold: true, color: { argb: NAVY } });
    }
    headerRow(ws2, ["מס'", "שוכר", "יחידות בהסכם", 'שכ"ד חודשי נוכחי', "צפי 12 חודשים", "הערות"]);
    let pF = 0; let pRun = 0;
    rows.forEach(function (cr) {
      const r = ws2.addRow([cr.num, cr.tenant, cr.unitsSummary, cr.monthlyNow, cr.forecast12, cr.notes.join(" · ")]);
      r.eachCell(function (cell: any, col: number) {
        cell.font = font({});
        cell.alignment = { horizontal: col === 6 ? "right" : (col <= 3 ? "right" : "center"), wrapText: col === 6 || col === 3 };
        if (col === 4 || col === 5) cell.numFmt = money;
        if (cr.num % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
      });
      pF += cr.forecast12; pRun += cr.monthlyNow * 12;
    });
    const tr = ws2.addRow(['סה"כ', "", "", "", r2(pF), ""]);
    tr.eachCell(function (cell: any, col: number) { cell.font = font({ bold: true, color: { argb: GREEN } }); if (col === 5) cell.numFmt = money; cell.border = { top: { style: "double", color: { argb: GREEN } } }; });
    const vr = ws2.addRow(["", 'כולל מע"מ (' + vatPct + '%)', "", "", r2(pF * (1 + vatPct / 100)), ""]);
    vr.eachCell(function (cell: any, col: number) { cell.font = font({ bold: true }); if (col === 5) cell.numFmt = money; });
    const rr = ws2.addRow(["", "להשוואה: run-rate שנתי (חודשי נוכחי × 12)", "", "", r2(pRun), "ההפרש נובע מהסכמים שמתחילים/מסתיימים בתוך התקופה וממדרגות"]);
    rr.eachCell(function (cell: any, col: number) { cell.font = font({ size: 9, color: { argb: "FF64748B" } }); if (col === 5) cell.numFmt = money; });
    ws2.addRow([]);
    grandF += pF; grandRun += pRun;
  });
  if ((props ?? []).length > 1) {
    const gr = ws2.addRow(['סה"כ כללי', "", "", "", r2(grandF), 'כולל מע"מ: ' + r2(grandF * (1 + vatPct / 100)).toLocaleString("he-IL")]);
    gr.eachCell(function (cell: any, col: number) { cell.font = font({ bold: true, size: 11, color: { argb: NAVY } }); if (col === 5) cell.numFmt = money; });
  }

  // גיליון 3 — ריכוז יחידות
  const ws3 = wb.addWorksheet("ריכוז יחידות", { views: [{ rightToLeft: true }] });
  ws3.columns = [{ width: 24 }, { width: 12 }, { width: 10 }, { width: 8 }, { width: 12 }, { width: 26 }];
  titleRow(ws3, "ריכוז יחידות — " + params.title, 6);
  ws3.addRow([]);
  // מי מחזיק כל יחידה (חוזים חיים שהחלו)
  const holder: Record<string, string> = {};
  const holderFuture: Record<string, string> = {};
  cs0.forEach(function (c: any) {
    const started = c.status !== "upcoming" && c.status !== "future";
    // המצב האפקטיבי — הצילום האחרון עם יחידות (בסיס או תוספת)
    let eff: any[] = c.contract_spaces || [];
    ((amendsBy[c.id] || []).slice().sort(function (a: any, b: any) {
      const ra = (d(a.amendment_date || a.start_date)?.getTime() || 0) * 1000 + (Number(a.amendment_number) || 0);
      const rb = (d(b.amendment_date || b.start_date)?.getTime() || 0) * 1000 + (Number(b.amendment_number) || 0);
      return ra - rb;
    })).forEach(function (a: any) { if ((a.contract_spaces || []).length > 0) eff = a.contract_spaces; });
    eff.forEach(function (cs: any) {
      if (!cs.space_id) return;
      if (started) holder[cs.space_id] = c.tenants?.name || "";
      else if (!holder[cs.space_id]) holderFuture[cs.space_id] = c.tenants?.name || "";
    });
  });
  (props ?? []).forEach(function (p: any) {
    const sps = (allSpaces ?? []).filter(function (s: any) { return s.property_id === p.id; });
    if ((props ?? []).length > 1) {
      const pr = ws3.addRow(["🏢 " + p.name]);
      ws3.mergeCells(pr.number, 1, pr.number, 6);
      pr.getCell(1).font = font({ size: 12, bold: true, color: { argb: NAVY } });
    }
    headerRow(ws3, ["יחידה", "סוג", 'שטח (מ"ר)', "קומה", "מצב", "שוכר"]);
    let occArea = 0; let totArea = 0;
    sps.forEach(function (s: any, i: number) {
      const t = holder[s.id] || "";
      const tf = holderFuture[s.id] || "";
      const occ = !!t || s.status === "occupied";
      const state = occ ? "מושכר" : (tf ? "תפוס — הסכם עתידי" : "פנוי");
      const r = ws3.addRow([s.space_name, TYPE_LABELS[s.space_type] || s.space_type || "—", Number(s.area) || 0, s.floor ?? "—", state, t || tf || "—"]);
      r.eachCell(function (cell: any, col: number) {
        cell.font = font({});
        cell.alignment = { horizontal: col === 1 || col === 6 ? "right" : "center" };
        if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
        if (!occ && !tf) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
      });
      totArea += Number(s.area) || 0;
      if (occ || tf) occArea += Number(s.area) || 0;
    });
    const occPct = totArea > 0 ? Math.round((occArea / totArea) * 100) : 0;
    const tr = ws3.addRow(['סה"כ ' + sps.length + " יחידות", "", r2(totArea), "", "תפוסה " + occPct + "%", 'שטח מושכר: ' + r2(occArea) + ' מ"ר']);
    tr.eachCell(function (cell: any) { cell.font = font({ bold: true, color: { argb: GREEN } }); cell.border = { top: { style: "double", color: { argb: GREEN } } }; });
    ws3.addRow([]);
  });

  // גיליון 4 — הנחות
  const ws4 = wb.addWorksheet("הנחות", { views: [{ rightToLeft: true }] });
  ws4.columns = [{ width: 22 }, { width: 100 }];
  titleRow(ws4, "הנחות ומקורות נתונים", 2);
  ws4.addRow([]);
  const assumptions: [string, string][] = [
    ["מקור הנתונים", "הופק אוטומטית ממערכת ניהול הנכסים PropManager בתאריך " + today.toLocaleDateString("he-IL") + ", ישירות ממסד הנתונים (הסכמים, יחידות, מדדים) — ללא הקלדה ידנית."],
    ['מע"מ', 'שיעור מע"מ ' + vatPct + '%. כל הסכומים מוצגים ללא מע"מ אלא אם צוין אחרת.'],
    ["הצמדה למדד", idxTxt + '. עמודת "שכ"ד צמוד" משקפת את יחס המדד הידוע מול מדד הבסיס של כל הסכם (מנגנון t-2 — המדד הידוע). הסכמים במנגנון ללא-ירידה אינם יורדים מתחת לבסיס.'],
    ['שכ"ד בסיס למ"ר', "התעריף החוזי הנוכחי לפי לוח המדרגות והאופציות הממומשות של כל הסכם (לא תעריף שנה 1)."],
    ["צפי 12 חודשים", "הליכה חודש-בחודש מה-1 בחודש הבא: מדרגות חוזיות במועדן, קיצוץ בתאריך סיום (כולל הארכות ואופציות ממומשות), הסכמים חתומים עתידיים מתחילת תקופתם, גרייס וחלקיות ימים. הונח מדד יציב — הצמדה עתידית תגדיל את הסכומים."],
    ["אופציות", "אופציות הארכה שטרם מומשו אינן נכללות בצפי; קיומן מסומן בהערות ההסכם."],
    ['שכ"ד פדיון', "בהסכמי אחוז-ממחזור מוצג המינימום החוזי בלבד; פדיון בפועל עשוי להגדיל את ההכנסה."],
    ["דמי ניהול", "הדוח מרכז דמי שכירות בלבד ואינו כולל דמי ניהול, ביטוח או חיובי אחזקה."],
  ];
  assumptions.forEach(function (a, i) {
    const r = ws4.addRow([a[0], a[1]]);
    r.getCell(1).font = font({ bold: true, color: { argb: NAVY } });
    r.getCell(2).font = font({});
    r.getCell(2).alignment = { wrapText: true, horizontal: "right" };
    if (i % 2 === 1) r.eachCell(function (cell: any) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } }; });
  });

  const buf = await wb.xlsx.writeBuffer();
  return { blob: new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), contracts: cs0.length };
}
