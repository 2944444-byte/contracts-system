// Monthly billing for tenants who pay by BANK TRANSFER or STANDING ORDER.
//
// A cheque tenant hands over a year of post-dated cheques, so the advances
// screen generates the year up front. A transfer tenant has no cheques — each
// month, once the governing index is known, they must be TOLD what to pay
// (transfer) or what will be collected (direct debit). Without this run such
// contracts produced no rent rows anywhere.
//
// So: after the known index is published, this computes next month's figure —
// steps, CPI, grace (both phases), the occupancy condition on a minimum, and
// the management advance — creates ONE charge per contract per month, and the
// breakdown goes into the notes so the notice letter shows the arithmetic.
//
// A revenue lease is charged its MINIMUM here (the advance); the turnover gap
// is settled by the revenue screen per the contract's settlement schedule,
// exactly as it is for cheque tenants.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSpaceRentSchedule, rentAtDate } from "@/lib/contract-utils";
import { graceFactorsFor, graceWindow } from "@/lib/store-opening";
import { minimumApplies } from "@/lib/project-occupancy";
import { minRentPerSqmAtDate } from "@/lib/min-rent";
import { fetchCpiAdjustedWithRetry, fetchHighestChainedCpiWithRetry } from "@/lib/cpi-server";
import { getVatRates, vatPctAt } from "@/lib/vat";
import { isParkingOnly, parkingMonthlyTotal, parkingSpotCount, parkingRentSchedule } from "@/lib/parking-rent";

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
  lines: string[];             // one human-readable line per contract processed
};

function ymd(x: Date): string {
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
}
function r2(n: number): number { return Math.round(n * 100) / 100; }

// The month being billed: the calendar month AFTER `today`. The run happens
// once the index governing that month is already published, so the figure is
// final — not an estimate to be corrected later.
export function nextBillingMonth(today: Date): { start: Date; end: Date; label: string } {
  const start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 2, 1);
  const HEB = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  return { start, end, label: HEB[start.getMonth()] + " " + start.getFullYear() };
}

export async function generateTransferCharges(params: {
  supabase: SupabaseClient;
  contractIds?: string[];       // restrict to these (scope); omit = all
  today?: Date;
}): Promise<TransferChargeResult> {
  const { supabase } = params;
  const today = params.today || new Date();
  const period = nextBillingMonth(today);
  const res: TransferChargeResult = { created: 0, skippedExisting: 0, skippedZero: 0, errors: [], lines: [] };

  var q = supabase.from("contracts")
    .select("id, property_id, rent_type, revenue_pct, rent_per_sqm, charged_area, investment_addition, " +
      "min_rent_per_sqm, minimum_rent, min_rent_condition_type, min_rent_condition_pct, min_rent_condition_met_at, " +
      "payment_method, payment_day, vat_type, indexation_method, index_base_date, index_base_value, index_mechanism, " +
      "start_date, end_date, signing_date, mgmt_fee_per_sqm, mgmt_included_in_revenue, " +
      "contract_type, mgmt_parking_fee_per_spot, properties(parking_mgmt_fee_per_spot), " +
      "grace_months, grace_days, grace_phase2_days, grace_type, grace_discount_pct, grace_mgmt_discount_pct, grace_ends_on_opening, " +
      "mgmt_charge_starts, mgmt_free_max_days, works_start_date, works_end_date, " +
      "planned_handover_date, actual_handover_date, planned_opening_date, actual_opening_date, " +
      "opening_rule, opening_max_days_from_handover, term_starts_at, " +
      "tenants(name), contract_spaces(space_id, charge_method, fixed_rent, price_per_sqm, spaces(space_name, area)), " +
      "contract_options(id, is_exercised, status, start_date, end_date, rent_mechanism, rent_increase_pct, new_rent_value, price_tiers, option_group)")
    .in("payment_method", TRANSFER_METHODS)
    .in("status", ["active", "extended", "expiring"])
    .eq("is_amendment", false);
  const { data: contracts, error } = await q;
  if (error) { res.errors.push(error.message); return res; }

  var list = (contracts || []) as any[];
  if (params.contractIds) {
    list = list.filter(function (c) { return params.contractIds!.indexOf(c.id) !== -1; });
  }
  if (list.length === 0) return res;

  const vatRates = await getVatRates();
  const periodStartStr = ymd(period.start);

  // One query answers "already billed?" for everyone.
  const { data: existing } = await supabase.from("charges")
    .select("contract_id").eq("charge_type", "rent_transfer")
    .eq("billing_period_start", periodStartStr)
    .in("contract_id", list.map(function (c) { return c.id; }));
  const billed: Record<string, boolean> = {};
  (existing || []).forEach(function (x: any) { billed[x.contract_id] = true; });

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
      if (billed[c.id]) { res.skippedExisting++; res.lines.push(name + " — כבר קיים חיוב ל" + period.label); continue; }

      // Not in force during the billed month → nothing to bill.
      const cStart = c.start_date ? new Date(c.start_date) : null;
      const cEnd = c.end_date ? new Date(c.end_date) : null;
      if ((cStart && cStart >= period.end) || (cEnd && cEnd < period.start)) {
        res.skippedZero++; res.lines.push(name + " — החוזה אינו בתוקף ב" + period.label); continue;
      }

      const noteLines: string[] = [];
      const parkRows = parkingByBase[c.id] || [];
      const parkFee = parkingMonthlyTotal(parkRows);
      const parkSpots = parkingSpotCount(parkRows);
      const parkingOnly = isParkingOnly(c);
      const isRev = !parkingOnly && (c.rent_type === "revenue_pct" || c.rent_type === "revenue_based" || Number(c.revenue_pct) > 0);
      var baseMonthly = 0;

      if (parkingOnly) {
        // Parking-only agreement: the parking base runs through the SAME
        // tier/option engine as a fixed-rent unit; CPI applies below like any
        // other contract.
        if (parkFee <= 0) {
          res.skippedZero++;
          res.lines.push(name + " — הסכם חניות ללא מנויי חניה מקושרים · אין מה לחייב");
          continue;
        }
        const pExercised = (c.contract_options || []).filter(function (o: any) { return o && (o.is_exercised || o.status === "exercised"); });
        baseMonthly = rentAtDate(parkingRentSchedule({
          contract: c, parkingRows: parkRows,
          contractTiers: tiersByContract[c.id] || [], exercisedOptions: pExercised,
        }), period.start);
        noteLines.push("דמי חניה (" + parkSpots + " מקומות, כולל מדרגות): ₪" + r2(baseMonthly).toLocaleString("he-IL"));
      } else if (isRev) {
        // The advance on a turnover lease is the MINIMUM — when it applies.
        const cond = minimumApplies({ contract: c, date: period.start });
        if (!cond.applies) {
          res.skippedZero++;
          res.lines.push(name + " — " + cond.reason + " · אין מקדמת מינימום; החיוב ייווצר מדיווח הפדיון");
          continue;
        }
        const area = (c.contract_spaces || []).reduce(function (s: number, cs: any) {
          return s + (Number(cs?.spaces?.area) || 0);
        }, 0) || Number(c.charged_area) || 0;
        // The floor follows its own rent steps — the same tier rows that
        // drive fixed rent drive the minimum, so year 2's stepped floor is
        // billed as stepped, not at the signing figure.
        const minSqmNow = Number(c.min_rent_per_sqm) > 0
          ? minRentPerSqmAtDate({
              baseMinPerSqm: Number(c.min_rent_per_sqm),
              tiers: tiersByContract[c.id] || [],
              contractStart: c.start_date, date: period.start,
            })
          : 0;
        baseMonthly = minSqmNow > 0 ? minSqmNow * area : (Number(c.minimum_rent) || 0);
        noteLines.push('שכ"ד מינימום: ' +
          (minSqmNow > 0
            ? "₪" + r2(minSqmNow).toLocaleString("he-IL") + '/מ"ר × ' + area.toLocaleString("he-IL") + ' מ"ר' +
              (minSqmNow !== Number(c.min_rent_per_sqm) ? " (כולל מדרגות)" : "")
            : "סכום חודשי קבוע") + " = ₪" + r2(baseMonthly).toLocaleString("he-IL"));
        if (cond.reason) noteLines.push(cond.reason);
      } else {
        // Fixed rent: each space's own schedule (steps and exercised options
        // included), read at the billed month.
        const exercised = (c.contract_options || []).filter(function (o: any) { return o && (o.is_exercised || o.status === "exercised"); });
        const tiers = tiersByContract[c.id] || [];
        var spaces = (c.contract_spaces || []) as any[];
        if (spaces.length > 0) {
          for (const cs of spaces) {
            const area = Number(cs?.spaces?.area) || 0;
            const isFixed = cs.charge_method === "fixed" && Number(cs.fixed_rent) > 0;
            const spaceBase = isFixed ? Number(cs.fixed_rent) : (Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0) * area;
            const sched = buildSpaceRentSchedule({
              contractStartDate: c.start_date, spaceArea: area, isFixed: isFixed,
              spaceBaseRent: spaceBase, spaceTiers: [], contractTiers: tiers, exercisedOptions: exercised,
            });
            baseMonthly += rentAtDate(sched, period.start);
          }
        } else {
          baseMonthly = (Number(c.rent_per_sqm) || 0) * (Number(c.charged_area) || 0);
        }
        baseMonthly += Number(c.investment_addition) || 0;
        noteLines.push('שכ"ד בסיס (כולל מדרגות): ₪' + r2(baseMonthly).toLocaleString("he-IL"));
      }

      // CPI — from the contract's base index to the index KNOWN at billing,
      // through the same CBS API the cheque advances use (MM-DD-YYYY, ratio on
      // a round number). Linkage only raises — a ratio below 1 leaves the base.
      if (baseMonthly > 0 && c.indexation_method && c.indexation_method !== "none" && c.index_base_date) {
        const fromCbs = cbsDate(String(c.index_base_date).slice(0, 10));
        const toCbs = cbsDate(ymd(today));
        if (fromCbs && toCbs) {
          const adj = await fetchCpiAdjustedWithRetry({ value: 10000, fromDate: fromCbs, toDate: toCbs });
          if (!adj || !adj.success) {
            // No silent ratio=1 on a FAILURE — an unindexed figure presented as
            // final would understate the rent. The contract is skipped aloud.
            throw new Error("שליפת מדד נכשלה: " + (adj?.error || "—"));
          }
          var ratio = Number(adj.adjustedRentPerSqm) / 10000;
          // no_drop / highest_in_period: the governing index is the PEAK since
          // the base, not the current — the same scan the cheque path runs.
          const isPeakMech = c.indexation_method === "highest_in_period" || c.index_mechanism === "highest_in_period"
            || c.indexation_method === "no_drop" || c.index_mechanism === "no_drop";
          if (isPeakMech) {
            const bD0 = /^(\d{4})-(\d{2})/.exec(String(c.index_base_date));
            const pD = new Date(today);
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
            if (Number(peak.peakRatio) > ratio) {
              ratio = Number(peak.peakRatio);
              noteLines.push("מנגנון שיא: המדד הקובע הוא שיא התקופה (" + peak.peakYear + "-" + String(peak.peakMonth).padStart(2, "0") + ")");
            }
          }
          if (ratio > 1) {
            const adjusted = r2(baseMonthly * ratio);
            noteLines.push("הצמדה למדד: ₪" + r2(baseMonthly).toLocaleString("he-IL") + " → ₪" +
              adjusted.toLocaleString("he-IL") + " (יחס " + ratio.toFixed(4) +
              (adj.toIndexValue ? ", מדד ידוע " + adj.toIndexValue : "") + ")");
            baseMonthly = adjusted;
          } else {
            noteLines.push("הצמדה למדד: ללא שינוי (המדד אינו מעל הבסיס)");
          }
        }
      }

      // Mid-month start or end: only the days in force are billed. The cheque
      // path prorates this way; a transfer tenant leaving on the 10th must not
      // be billed the whole month.
      const daysInMonth = Math.round((period.end.getTime() - period.start.getTime()) / 86400000);
      var inForceFrom = cStart && cStart > period.start ? cStart : period.start;
      var inForceTo = cEnd && cEnd < period.end ? new Date(cEnd.getFullYear(), cEnd.getMonth(), cEnd.getDate() + 1) : period.end;
      const inForceDays = Math.max(0, Math.round((inForceTo.getTime() - inForceFrom.getTime()) / 86400000));
      if (inForceDays < daysInMonth) {
        const part = r2(baseMonthly * inForceDays / daysInMonth);
        noteLines.push("חלקיות חודש: " + inForceDays + "/" + daysInMonth + " ימים → ₪" + part.toLocaleString("he-IL"));
        baseMonthly = part;
      }

      // Grace — both phases, and the management rules.
      const gf = graceFactorsFor({ contract: c, periodStart: period.start, periodEnd: period.end, today: today });
      var rentDue = r2(baseMonthly * gf.rentFactor);
      if (gf.rentFactor < 1) {
        const g = graceWindow({ contract: c, today: today });
        const fe = g.rentFreeEnd || g.end;
        noteLines.push("גרייס: " + Math.round((1 - gf.rentFactor) * 100) + "% מהחודש פטור" +
          (fe ? " (עד " + fe.toLocaleDateString("he-IL") + ")" : "") +
          ' → שכ"ד ₪' + rentDue.toLocaleString("he-IL"));
      }

      // Parking riding on a UNIT lease: added FLAT on top — outside CPI, tiers
      // and grace — exactly the cheque path's long-standing rule. (A parking-
      // ONLY contract took the parking as its BASE above instead.)
      if (!parkingOnly && parkFee > 0) {
        var parkPart = parkFee;
        if (inForceDays < daysInMonth) parkPart = r2(parkFee * inForceDays / daysInMonth);
        rentDue = r2(rentDue + parkPart);
        noteLines.push("חניות (" + parkSpots + " מקומות): ₪" + r2(parkPart).toLocaleString("he-IL"));
      }

      // Management advance. Rate: the contract's own figure (the first-year
      // advance until a budget takes over — the budget/group path runs through
      // the yearly reconciliation). Skipped when management is inside the
      // turnover percentage.
      var mgmtDue = 0;
      if (!c.mgmt_included_in_revenue && !parkingOnly && Number(c.mgmt_fee_per_sqm) > 0) {
        const area = (c.contract_spaces || []).reduce(function (s: number, cs: any) {
          return s + (Number(cs?.spaces?.area) || 0);
        }, 0) || Number(c.charged_area) || 0;
        const mgmtBase = Number(c.mgmt_fee_per_sqm) * area;
        mgmtDue = r2(mgmtBase * gf.mgmtFactor);
        noteLines.push("דמי ניהול (מקדמה): ₪" + Number(c.mgmt_fee_per_sqm).toLocaleString("he-IL") +
          '/מ"ר × ' + area.toLocaleString("he-IL") + ' מ"ר' +
          (gf.mgmtFactor < 1 ? " × " + Math.round(gf.mgmtFactor * 100) + "% (גרייס/פטור)" : "") +
          " = ₪" + mgmtDue.toLocaleString("he-IL"));
      }

      // Parking management fee — its OWN rate: contract override, else the
      // property's rate set at property setup. Null on both (every property
      // today) = no charge; the plumbing is ready for a future property that
      // does charge management on parking.
      if (!c.mgmt_included_in_revenue && parkSpots > 0) {
        const propParkRate = Number((c.properties as any)?.parking_mgmt_fee_per_spot) || 0;
        const parkMgmtRate = Number(c.mgmt_parking_fee_per_spot) > 0 ? Number(c.mgmt_parking_fee_per_spot) : propParkRate;
        if (parkMgmtRate > 0) {
          const pm = r2(parkMgmtRate * parkSpots * gf.mgmtFactor);
          mgmtDue = r2(mgmtDue + pm);
          noteLines.push("דמי ניהול חניות: ₪" + parkMgmtRate.toLocaleString("he-IL") + " × " + parkSpots +
            " מקומות = ₪" + pm.toLocaleString("he-IL"));
        }
      }

      const baseTotal = r2(rentDue + mgmtDue);
      if (baseTotal <= 0) {
        res.skippedZero++;
        res.lines.push(name + " — ₪0 ל" + period.label + " (גרייס מלא)");
        continue;
      }

      // Due on the tenant's own payment day.
      const payDay = Math.min(Math.max(Number(c.payment_day) || 1, 1), 28);
      const due = new Date(period.start.getFullYear(), period.start.getMonth(), payDay);
      const vatPct = c.vat_type === "taxable" ? vatPctAt(vatRates, due) : 0;
      const vatAmount = r2(baseTotal * vatPct);
      const methodHe = c.payment_method === "standing_order" ? 'הוראת קבע' : "העברה בנקאית";
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
        billing_period_start: periodStartStr,
        billing_period_end: ymd(new Date(period.end.getFullYear(), period.end.getMonth(), 0)),
        due_date: ymd(due),
        status: "pending",
        notes: noteLines.join("\n"),
      });
      if (iErr) {
        // 23505 = the DB's unique backstop caught a concurrent run that billed
        // this contract between our SELECT and this INSERT. Not an error — the
        // month is billed, exactly once.
        if ((iErr as any).code === "23505") { res.skippedExisting++; res.lines.push(name + " — כבר קיים חיוב ל" + period.label); continue; }
        res.errors.push(name + ": " + iErr.message); continue;
      }
      res.created++;
      res.lines.push(name + " — ₪" + r2(baseTotal + vatAmount).toLocaleString("he-IL") + " לתשלום עד " + due.toLocaleDateString("he-IL"));
    } catch (e: any) {
      res.errors.push(name + ": " + (e?.message || String(e)));
    }
  }
  return res;
}
