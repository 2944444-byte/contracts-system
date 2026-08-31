// Monthly/quarterly billing for tenants who pay by BANK TRANSFER or STANDING
// ORDER.
//
// A cheque tenant hands over a year of post-dated cheques, so the advances
// screen generates the year up front. A transfer tenant has no cheques — each
// period, once the governing index is known, they must be TOLD what to pay
// (transfer) or what will be collected (direct debit).
//
// The engine is PERIOD-based (2026-08-18 rework):
//   * The contract's payment_frequency decides the period: monthly (default)
//     or quarterly (calendar quarters: 1.1 / 1.4 / 1.7 / 1.10).
//   * FIRST charge convention: a contract starting mid-period pays the stub
//     days TOGETHER WITH the first full period, in one charge.
//   * CATCH-UP: a contract entered retroactively gets its missing periods
//     from the start of the year it was ENTERED in the system (never before
//     its own start date) — so the payments screen shows a correct annual
//     picture. Dedup makes this idempotent; existing periods are skipped.
//   * Each period is indexed by the index that was KNOWN at its own billing
//     time (the 16th of the month before the period starts) — a backfilled
//     Q1 charge uses Q1's governing index, not today's.
//
// A revenue lease is charged its MINIMUM here (the advance); the turnover gap
// is settled by the revenue screen per the contract's settlement schedule.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSpaceRentSchedule, rentAtDate } from "@/lib/contract-utils";
import { graceFactorsFor, graceWindow } from "@/lib/store-opening";
import { minimumApplies } from "@/lib/project-occupancy";
import { minRentPerSqmAtDate } from "@/lib/min-rent";
import { fetchCpiAdjustedWithRetry, fetchHighestChainedCpiWithRetry } from "@/lib/cpi-server";
import { getVatRates, vatPctAt } from "@/lib/vat";
import { isParkingOnly, parkingMonthlyTotal, parkingSpotCount, parkingRentSchedule } from "@/lib/parking-rent";
import { spaceMonthlyBase, billableAreaFor } from "@/lib/space-billing";

// CBS wants MM-DD-YYYY. The 15th is the publication day itself and is
// ambiguous — bumped to the 16th, matching the cheque path, so both paths
// resolve the same known index for the same contract.
function cbsDate(dateStr: string): string | null {
  const d0 = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!d0) return null;
  const d = new Date(Number(d0[1]), Number(d0[2]) - 1, Number(d0[3]));
  if (d.getDate() === 15) d.setDate(16);
  return String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + "-" + d.getFullYear();
}

export const TRANSFER_METHODS = ["bank_transfer", "standing_order"];

export type TransferChargeResult = {
  created: number;
  skippedExisting: number;
  skippedZero: number;
  errors: string[];
  lines: string[];             // one human-readable line per charge/contract processed
};

function ymd(x: Date): string {
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
}
function r2(n: number): number { return Math.round(n * 100) / 100; }
function monthStartOf(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function quarterStartOf(d: Date): Date { return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1); }

const HEB_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

// The month being billed FORWARD: the calendar month AFTER `today`. Kept for
// the cron's gate and the payments-screen button label.
export function nextBillingMonth(today: Date): { start: Date; end: Date; label: string } {
  const start = addMonths(monthStartOf(today), 1);
  const end = addMonths(start, 1);
  return { start: start, end: end, label: HEB_MONTHS[start.getMonth()] + " " + start.getFullYear() };
}

export type BillingPeriod = {
  start: Date;          // charged from (may include a stub before the aligned part)
  end: Date;            // exclusive
  fullPartStart: Date;  // start of the aligned (non-stub) part — drives due date + governing index
  label: string;
  merged: boolean;      // true when stub days were folded into this charge
};

// תנאי תחילת החיוב של חוזה. חוזה רגיל — מתאריך התחילה שהוזן; חוזה שהוגדר
// "תחילת תקופה במסירת החזקה / בפתיחת המושכר" — מהמועד בפועל בלבד:
// מסירה מתוכננת שנדחתה אינה עילה לחיוב. כל עוד המועד בפועל לא נרשם,
// החוזה אינו מחויב (מדווח בשורת דילוג); כשהמועד יוזן, מנגנון ההשלמה
// הרטרואקטיבית ייצר את התקופות החסרות בריצה הבאה מאליו.
export function billingStartFor(c: any): { iso: string | null; wait: string | null } {
  const sd = c?.start_date ? String(c.start_date).slice(0, 10) : null;
  if (c?.term_starts_at === "handover") {
    if (c.actual_handover_date) return { iso: String(c.actual_handover_date).slice(0, 10), wait: null };
    return { iso: null, wait: "תחילת התקופה במסירת החזקה — טרם נרשמה מסירה בפועל" };
  }
  if (c?.term_starts_at === "opening") {
    if (c.actual_opening_date) return { iso: String(c.actual_opening_date).slice(0, 10), wait: null };
    // פתיחה רעיונית ("X ימים מהמסירה") נגזרת רק ממסירה בפועל — לא ממתוכננת
    const days = Number(c.opening_max_days_from_handover) || 0;
    if (c.opening_rule === "actual_or_days_from_handover" && c.actual_handover_date && days > 0) {
      const h = new Date(String(c.actual_handover_date).slice(0, 10) + "T00:00:00");
      h.setDate(h.getDate() + days);
      const iso = h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0") + "-" + String(h.getDate()).padStart(2, "0");
      return { iso: iso, wait: null };
    }
    return { iso: null, wait: "תחילת התקופה בפתיחת המושכר — טרם נרשמו פתיחה או מסירה בפועל" };
  }
  return { iso: sd, wait: null };
}

// All billable periods for a contract, oldest first:
// from max(contract start, Jan 1 of the year the row was CREATED) up to and
// including the forward period (the one containing the 1st of next month).
export function billingPeriodsFor(c: any, today: Date): BillingPeriod[] {
  const freqQuarterly = c.payment_frequency === "quarterly";
  const step = freqQuarterly ? 3 : 1;
  if (!c.start_date) return [];
  const cStart = new Date(String(c.start_date).slice(0, 10) + "T00:00:00");
  const created = c.created_at ? new Date(c.created_at) : today;
  const floorDate = new Date(Math.max(cStart.getTime(), new Date(created.getFullYear(), 0, 1).getTime()));
  const alignedFloor = freqQuarterly ? quarterStartOf(floorDate) : monthStartOf(floorDate);
  const horizon = addMonths(monthStartOf(today), 1); // include periods starting up to next month

  const raw: BillingPeriod[] = [];
  let ps = alignedFloor;
  while (ps.getTime() <= horizon.getTime()) {
    const pe = addMonths(ps, step);
    const label = freqQuarterly
      ? "רבעון " + (Math.floor(ps.getMonth() / 3) + 1) + "/" + ps.getFullYear()
      : HEB_MONTHS[ps.getMonth()] + " " + ps.getFullYear();
    raw.push({ start: ps, end: pe, fullPartStart: ps, label: label, merged: false });
    ps = pe;
  }
  if (raw.length === 0) return raw;

  // First-charge convention — the CONTRACT decides (first_charge_mode):
  //   stub_plus_period (default): mid-period start → stub days ride together
  //     with the first FULL period, one charge.
  //   stub_only: the stub is its own (prorated) charge, then full periods.
  // A retro contract whose start precedes the floor year has no stub either way.
  const stubOnly = c.first_charge_mode === "stub_only";
  if (!stubOnly && cStart > raw[0].start && raw.length >= 2) {
    raw[0] = {
      start: raw[0].start, end: raw[1].end, fullPartStart: raw[1].start,
      label: raw[1].label + " + ימי " + (raw[0].label), merged: true,
    };
    raw.splice(1, 1);
  }
  return raw;
}

export async function generateTransferCharges(params: {
  supabase: SupabaseClient;
  contractIds?: string[];       // restrict to these (scope); omit = all
  today?: Date;
}): Promise<TransferChargeResult> {
  const { supabase } = params;
  const today = params.today || new Date();
  const res: TransferChargeResult = { created: 0, skippedExisting: 0, skippedZero: 0, errors: [], lines: [] };

  var q = supabase.from("contracts")
    .select("id, property_id, rent_type, revenue_pct, rent_per_sqm, charged_area, investment_addition, " +
      "min_rent_per_sqm, minimum_rent, min_rent_condition_type, min_rent_condition_pct, min_rent_condition_met_at, " +
      "payment_method, payment_frequency, payment_day, first_charge_mode, vat_type, indexation_method, index_base_date, index_base_value, index_mechanism, " +
      "start_date, end_date, signing_date, created_at, mgmt_fee_per_sqm, mgmt_included_in_revenue, " +
      "contract_type, mgmt_parking_fee_per_spot, properties(parking_mgmt_fee_per_spot, space_type_billing), " +
      "grace_months, grace_days, grace_phase2_days, grace_type, grace_discount_pct, grace_mgmt_discount_pct, grace_ends_on_opening, " +
      "mgmt_charge_starts, mgmt_free_max_days, works_start_date, works_end_date, " +
      "planned_handover_date, actual_handover_date, planned_opening_date, actual_opening_date, " +
      "opening_rule, opening_max_days_from_handover, term_starts_at, " +
      "tenants(name), contract_spaces(space_id, charge_method, fixed_rent, price_per_sqm, spaces(space_name, area, space_type)), " +
      "contract_options(id, is_exercised, status, start_date, end_date, rent_mechanism, rent_increase_pct, new_rent_value, price_tiers, option_group)")
    .in("payment_method", TRANSFER_METHODS)
    // "upcoming"/"future" נכללים בכוונה: חוזה שמתחיל ב-1 בחודש הבא עדיין
    // בסטטוס עתידי בזמן ריצת ה-16–20, והחיוב הראשון שלו חייב להיווצר עכשיו —
    // אחרת השוכר לא יקבל הודעת תשלום לפני ה-1 (סטופמרקט 1.9.2026 פוספס כך).
    // חוזה שטרם הגיע לתקופת חיוב פשוט לא מניב תקופות (cStart >= period.end).
    .in("status", ["active", "extended", "expiring", "upcoming", "future"])
    .eq("is_amendment", false);
  const { data: contracts, error } = await q;
  if (error) { res.errors.push(error.message); return res; }

  var list = (contracts || []) as any[];
  if (params.contractIds) {
    list = list.filter(function (c) { return params.contractIds!.indexOf(c.id) !== -1; });
  }
  if (list.length === 0) return res;

  const vatRates = await getVatRates();

  // One query answers "already billed?" for every contract+period.
  const { data: existing } = await supabase.from("charges")
    .select("contract_id, billing_period_start").eq("charge_type", "rent_transfer")
    .in("contract_id", list.map(function (c) { return c.id; }));
  const billed: Record<string, boolean> = {};
  (existing || []).forEach(function (x: any) {
    billed[x.contract_id + "|" + String(x.billing_period_start).slice(0, 10)] = true;
  });

  // Tiers for the whole batch at once.
  const { data: allTiers } = await supabase.from("contract_price_tiers")
    .select("*").in("contract_id", list.map(function (c) { return c.id; }));
  const tiersByContract: Record<string, any[]> = {};
  (allTiers || []).forEach(function (t: any) {
    (tiersByContract[t.contract_id] = tiersByContract[t.contract_id] || []).push(t);
  });

  // Parking for the whole batch: subscriptions may hang on the base contract
  // OR one of its amendments — map them all back to the base, exactly as the
  // cheque (advances) path does.
  const { data: amendRows } = await supabase.from("contracts")
    .select("id, parent_contract_id").eq("is_amendment", true)
    .in("parent_contract_id", list.map(function (c) { return c.id; }));
  const amendToBase: Record<string, string> = {};
  (amendRows || []).forEach(function (a: any) { amendToBase[a.id] = a.parent_contract_id; });
  const parkScanIds = list.map(function (c) { return c.id; }).concat((amendRows || []).map(function (a: any) { return a.id; }));
  const { data: allParking } = await supabase.from("parking_subscriptions")
    .select("contract_id, subscription_type, monthly_fee, quantity, is_included_in_rent, status")
    .in("contract_id", parkScanIds).eq("status", "active");
  const parkingByBase: Record<string, any[]> = {};
  (allParking || []).forEach(function (p: any) {
    const base = amendToBase[p.contract_id] || p.contract_id;
    (parkingByBase[base] = parkingByBase[base] || []).push(p);
  });

  for (const c of list) {
    const name = (c.tenants as any)?.name || c.id.slice(0, 8);
    try {
      // תנאי תחילת חיוב (מסירה/פתיחה בפועל) — לפני כל חישוב
      const bs = billingStartFor(c);
      if (!bs.iso) { res.lines.push("⏳ " + name + " — " + bs.wait + "; לא חויב"); continue; }
      const cBill = bs.iso === (c.start_date ? String(c.start_date).slice(0, 10) : null) ? c : { ...c, start_date: bs.iso };
      const cStart = cBill.start_date ? new Date(String(cBill.start_date).slice(0, 10) + "T00:00:00") : null;
      const cEnd = c.end_date ? new Date(String(c.end_date).slice(0, 10) + "T00:00:00") : null;
      if (!cStart) { res.lines.push(name + " — אין תאריך תחילה"); continue; }

      const parkRows = parkingByBase[c.id] || [];
      const parkFee = parkingMonthlyTotal(parkRows);
      const parkSpots = parkingSpotCount(parkRows);
      const parkingOnly = isParkingOnly(c);
      const isRev = !parkingOnly && (c.rent_type === "revenue_pct" || c.rent_type === "revenue_based" || Number(c.revenue_pct) > 0);
      const tiers = tiersByContract[c.id] || [];
      const exercised = (c.contract_options || []).filter(function (o: any) { return o && (o.is_exercised || o.status === "exercised"); });
      const methodHe = c.payment_method === "standing_order" ? 'הוראת קבע' : "העברה בנקאית";

      // Per-space schedules built ONCE per contract (steps + exercised options).
      const spaceScheds = (parkingOnly ? [] : ((c.contract_spaces || []) as any[])).map(function (cs: any) {
        const area = Number(cs?.spaces?.area) || 0;
        const isFixed = cs.charge_method === "fixed" && Number(cs.fixed_rent) > 0;
        // spaceMonthlyBase: יחידת "כלול במחיר" (סככה/חצר) תורמת ₪0 —
        // ולא נופלת ל-fallback של מחיר החוזה למ"ר.
        const spaceBase = spaceMonthlyBase(cs, Number(c.rent_per_sqm) || 0);
        return buildSpaceRentSchedule({
          contractStartDate: cBill.start_date, spaceArea: area, isFixed: isFixed,
          spaceBaseRent: spaceBase, spaceTiers: [], contractTiers: tiers, exercisedOptions: exercised,
        });
      });
      const parkSched = parkingOnly
        ? parkingRentSchedule({ contract: c, parkingRows: parkRows, contractTiers: tiers, exercisedOptions: exercised })
        : null;

      // The month's PRE-CPI base at a given month start (rent only, no mgmt).
      const monthBase = function (mS: Date): { amount: number; note: string | null } {
        if (parkingOnly) {
          return { amount: rentAtDate(parkSched!, mS), note: null };
        }
        if (isRev) {
          const cond = minimumApplies({ contract: c, date: mS });
          if (!cond.applies) return { amount: 0, note: cond.reason || "אין מקדמת מינימום בחודש זה" };
          const area = (c.contract_spaces || []).reduce(function (s: number, cs: any) {
            return s + (Number(cs?.spaces?.area) || 0);
          }, 0) || Number(c.charged_area) || 0;
          const minSqmNow = Number(c.min_rent_per_sqm) > 0
            ? minRentPerSqmAtDate({ baseMinPerSqm: Number(c.min_rent_per_sqm), tiers: tiers, contractStart: cBill.start_date, date: mS })
            : 0;
          var v = minSqmNow > 0 ? minSqmNow * area : (Number(c.minimum_rent) || 0);
          return { amount: v + parkFee, note: null };
        }
        var total = 0;
        if (spaceScheds.length > 0) {
          spaceScheds.forEach(function (s) { total += rentAtDate(s, mS); });
        } else {
          total = (Number(c.rent_per_sqm) || 0) * (Number(c.charged_area) || 0);
        }
        total += Number(c.investment_addition) || 0;
        // חניות בחוזה יחידות: בבסיס לפני ההצמדה — צמודות ככל שכ"ד.
        total += parkFee;
        return { amount: total, note: null };
      };

      const periods = billingPeriodsFor(cBill, today);
      var zeroPeriods = 0;

      for (const period of periods) {
        // Entirely out of force → not billable.
        if (cStart >= period.end) continue;
        if (cEnd && cEnd < period.start) continue;
        if (billed[c.id + "|" + ymd(period.start)]) { res.skippedExisting++; continue; }

        const noteLines: string[] = [];
        // ── Month walk: base rent + grace + proration, month by month ──
        var rentBase = 0;         // pre-CPI, post-grace, post-proration
        var mgmtDue = 0;
        var monthsInPeriod = 0;
        for (var mS = new Date(period.start); mS.getTime() < period.end.getTime(); mS = addMonths(mS, 1)) {
          const mE = addMonths(mS, 1);
          const dim = Math.round((mE.getTime() - mS.getTime()) / 86400000);
          var from = cStart > mS ? cStart : mS;
          var to = cEnd && cEnd < mE ? new Date(cEnd.getFullYear(), cEnd.getMonth(), cEnd.getDate() + 1) : mE;
          const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
          if (days <= 0) continue;
          monthsInPeriod++;
          const ratio = Math.min(1, days / dim);
          const mb = monthBase(mS);
          if (mb.note) noteLines.push(HEB_MONTHS[mS.getMonth()] + ": " + mb.note);
          const gf = graceFactorsFor({ contract: c, periodStart: mS, periodEnd: mE, today: today });
          if (gf.rentFactor < 1) {
            noteLines.push(HEB_MONTHS[mS.getMonth()] + ": גרייס " + Math.round((1 - gf.rentFactor) * 100) + "% מהחודש פטור");
          }
          if (ratio < 1) {
            noteLines.push(HEB_MONTHS[mS.getMonth()] + ": חלקיות " + days + "/" + dim + " ימים");
          }
          rentBase += mb.amount * gf.rentFactor * ratio;

          // Management (per-sqm) + parking management, both grace-managed.
          if (!c.mgmt_included_in_revenue) {
            var mgmtMonth = 0;
            if (!parkingOnly && Number(c.mgmt_fee_per_sqm) > 0) {
              // שטח לדמי ניהול: סוגי עזר מוחרגים לפי מטריצת הנכס (סככה/חצר).
              const area = billableAreaFor("mgmt", c.contract_spaces || [], (c.properties as any)?.space_type_billing)
                || Number(c.charged_area) || 0;
              mgmtMonth += Number(c.mgmt_fee_per_sqm) * area;
            }
            if (parkSpots > 0) {
              const propParkRate = Number((c.properties as any)?.parking_mgmt_fee_per_spot) || 0;
              const parkMgmtRate = Number(c.mgmt_parking_fee_per_spot) > 0 ? Number(c.mgmt_parking_fee_per_spot) : propParkRate;
              if (parkMgmtRate > 0) mgmtMonth += parkMgmtRate * parkSpots;
            }
            mgmtDue += mgmtMonth * gf.mgmtFactor * ratio;
          }
        }
        rentBase = r2(rentBase);
        mgmtDue = r2(mgmtDue);
        if (monthsInPeriod === 0) continue;
        noteLines.unshift((parkingOnly ? "דמי חניה" : 'שכ"ד') + " בסיס לתקופה (" + monthsInPeriod + " חודשים, כולל מדרגות): ₪" + rentBase.toLocaleString("he-IL"));
        if (!parkingOnly && parkFee > 0) noteLines.push("כולל חניות (" + parkSpots + " מקומות): ₪" + r2(parkFee).toLocaleString("he-IL") + "/חודש — צמוד ככל שכ\"ד");

        // ── CPI — by the index KNOWN at this period's own billing time ──
        // (the 16th of the month before the FULL part starts; never later
        // than today). A backfilled Q1 gets Q1's governing index.
        if (rentBase > 0 && c.indexation_method && c.indexation_method !== "none" && c.index_base_date) {
          const govRaw = new Date(period.fullPartStart.getFullYear(), period.fullPartStart.getMonth() - 1, 16);
          const gov = govRaw.getTime() > today.getTime() ? today : govRaw;
          const fromCbs = cbsDate(String(c.index_base_date).slice(0, 10));
          const toCbs = cbsDate(ymd(gov));
          if (fromCbs && toCbs) {
            const adj = await fetchCpiAdjustedWithRetry({ value: 10000, fromDate: fromCbs, toDate: toCbs });
            if (!adj || !adj.success) {
              throw new Error("שליפת מדד נכשלה (" + period.label + "): " + (adj?.error || "—"));
            }
            var ratio2 = Number(adj.adjustedRentPerSqm) / 10000;
            const isPeakMech = c.indexation_method === "highest_in_period" || c.index_mechanism === "highest_in_period"
              || c.indexation_method === "no_drop" || c.index_mechanism === "no_drop";
            if (isPeakMech) {
              const bD0 = /^(\d{4})-(\d{2})/.exec(String(c.index_base_date));
              const pD = new Date(gov);
              if (pD.getDate() < 16) pD.setMonth(pD.getMonth() - 2); else pD.setMonth(pD.getMonth() - 1);
              const peak = await fetchHighestChainedCpiWithRetry({
                baseFromDate: fromCbs,
                scanFromYear: bD0 ? Number(bD0[1]) : pD.getFullYear(),
                scanFromMonth: bD0 ? Number(bD0[2]) : 1,
                scanToYear: pD.getFullYear(),
                scanToMonth: pD.getMonth() + 1,
              } as any);
              if (!peak || !peak.success) {
                throw new Error("סריקת שיא מדד נכשלה (מנגנון " + (c.index_mechanism || c.indexation_method) + "): " + (peak?.error || "—"));
              }
              if (Number(peak.peakRatio) > ratio2) {
                ratio2 = Number(peak.peakRatio);
                noteLines.push("מנגנון שיא: המדד הקובע הוא שיא התקופה (" + peak.peakYear + "-" + String(peak.peakMonth).padStart(2, "0") + ")");
              }
            }
            if (ratio2 > 1) {
              const adjusted = r2(rentBase * ratio2);
              noteLines.push("הצמדה למדד (הידוע לתקופה): ₪" + rentBase.toLocaleString("he-IL") + " → ₪" +
                adjusted.toLocaleString("he-IL") + " (יחס " + ratio2.toFixed(4) +
                (adj.toIndexValue ? ", מדד " + adj.toIndexValue : "") + ")");
              rentBase = adjusted;
            } else {
              noteLines.push("הצמדה למדד: ללא שינוי (המדד אינו מעל הבסיס)");
            }
          }
        }

        const baseTotal = r2(rentBase + mgmtDue);
        if (baseTotal <= 0) { zeroPeriods++; continue; }
        if (mgmtDue > 0) noteLines.push("דמי ניהול לתקופה: ₪" + mgmtDue.toLocaleString("he-IL"));

        // Due on the tenant's own payment day, in the FULL part's first month.
        const payDay = Math.min(Math.max(Number(c.payment_day) || 1, 1), 28);
        const due = new Date(period.fullPartStart.getFullYear(), period.fullPartStart.getMonth(), payDay);
        const vatPct = c.vat_type === "taxable" ? vatPctAt(vatRates, due) : 0;
        const vatAmount = r2(baseTotal * vatPct);
        noteLines.push('מע"מ: ' + (vatPct > 0 ? (vatPct * 100).toFixed(0) + "% = ₪" + vatAmount.toLocaleString("he-IL") : "פטור"));
        noteLines.push('סה"כ לתשלום: ₪' + r2(baseTotal + vatAmount).toLocaleString("he-IL") + " · " + methodHe);

        const { error: iErr } = await supabase.from("charges").insert({
          contract_id: c.id,
          charge_type: "rent_transfer",
          description: (parkingOnly ? "דמי חניה" : 'שכ"ד') + (mgmtDue > 0 ? " ודמי ניהול" : "") + " " + period.label + " — " + methodHe,
          base_amount: baseTotal,
          vat_amount: vatAmount,
          total_amount: r2(baseTotal + vatAmount),
          vat_type: vatPct > 0 ? "taxable" : "exempt",
          billing_period_start: ymd(period.start),
          billing_period_end: ymd(new Date(period.end.getFullYear(), period.end.getMonth(), 0)),
          due_date: ymd(due),
          status: "pending",
          notes: noteLines.join("\n"),
        });
        if (iErr) {
          if ((iErr as any).code === "23505") { res.skippedExisting++; continue; }
          res.errors.push(name + " (" + period.label + "): " + iErr.message); continue;
        }
        res.created++;
        res.lines.push(name + " — " + period.label + ": ₪" + r2(baseTotal + vatAmount).toLocaleString("he-IL") + " (לתשלום עד " + due.toLocaleDateString("he-IL") + ")");
      }
      if (zeroPeriods > 0) {
        res.skippedZero += zeroPeriods;
        res.lines.push(name + " — " + zeroPeriods + " תקופות בסכום ₪0 (גרייס/מינימום לא חל) — לא נוצר חיוב");
      }
    } catch (e: any) {
      res.errors.push(name + ": " + (e?.message || String(e)));
    }
  }
  return res;
}
