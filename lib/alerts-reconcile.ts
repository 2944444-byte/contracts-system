import type { SupabaseClient } from "@supabase/supabase-js";
import { representativeGuaranteeIds } from "@/lib/guarantee-dedupe";
import { contractExpiryVerdict } from "@/lib/contract-expiry";
import { handoverPendingVerdict } from "@/lib/handover-pending";
import { guaranteeGaps } from "@/lib/guarantee-status";
import { lateOpeningPenalty } from "@/lib/store-opening";
import { guaranteedMonthlyRent } from "@/lib/guarantee-base";
import { chargeBalance } from "@/lib/concessions";

// The alert sync only ever CREATED alerts. Nothing closed one whose condition
// had since been fixed, so a paid debt, a renewed guarantee or a certificate
// that finally arrived kept its alert open forever — the screen filled with
// items the data no longer supports.
//
// This pass walks every open alert and asks the same question the creator asks:
// does the condition still hold? If not, the alert is resolved. It is the exact
// mirror of the creation rules, so the two can't drift apart.

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export async function reconcileAlerts(supabase: SupabaseClient): Promise<{ resolved: number }> {
  const todayStr = new Date().toISOString().split("T")[0];

  const { data: open } = await supabase.from("alerts")
    .select("id, entity_type, entity_id, contract_id, alert_type")
    .eq("is_resolved", false);
  if (!open || open.length === 0) return { resolved: 0 };

  const idsFor = function (type: string): string[] {
    const out: string[] = [];
    for (const a of open as any[]) if (a.entity_type === type && a.entity_id) out.push(a.entity_id);
    return Array.from(new Set(out));
  };

  // Every alert that still legitimately holds, keyed by TYPE + id.
  //
  // The key must carry the type. Several rules are keyed by the same contract
  // id — arrears, "no insurance certificate", contract expiry, management-fee
  // protection — so a bare id set let one rule vouch for another: a contract
  // with an open "no certificate" alert also looked like it still had arrears,
  // and its arrears alert could never close even after every charge was paid.
  const stillOpen = new Set<string>();
  const keep = function (type: string, id: string) { stillOpen.add(type + ":" + id); };

  // ── Arrears: resolved once the contract has no overdue unpaid charge ──
  const arrearsIds = idsFor("arrears");
  if (arrearsIds.length > 0) {
    const { data: overdue } = await supabase.from("charges")
      .select("id,contract_id,total_amount,status")
      .in("contract_id", arrearsIds)
      .neq("status", "paid")
      .not("due_date", "is", null)
      .lt("due_date", todayStr);
    // Same rule the creator uses: a charge settled by a concession is no longer
    // a debt, so an arrears alert covering only such charges must close.
    const odIds = ((overdue ?? []) as any[]).map(function (x: any) { return x.id; });
    const concBy: Record<string, any[]> = {};
    if (odIds.length > 0) {
      const { data: concs } = await supabase.from("concessions")
        .select("charge_id,total_amount,status").in("charge_id", odIds).eq("status", "active");
      for (const x of ((concs ?? []) as any[])) {
        if (x.charge_id) (concBy[x.charge_id] = concBy[x.charge_id] || []).push(x);
      }
    }
    for (const ch of (overdue ?? []) as any[]) {
      if (chargeBalance(ch, concBy[ch.id]) <= 0.005) continue;
      keep("arrears", ch.contract_id);
    }
  }

  // ── Guarantees: resolved when renewed (or no longer active) ──
  const guaranteeIds = idsFor("guarantee");
  if (guaranteeIds.length > 0) {
    const { data: gs } = await supabase.from("guarantees")
      .select("id,end_date,status,contract_id,guarantee_type,amount_actual,amount_required,bank,document_url,documents,created_at,delivery_trigger,delivery_offset_days,delivery_due_date,delivered_at,contracts(parent_contract_id,signing_date,start_date,planned_handover_date,actual_handover_date,planned_opening_date,actual_opening_date,works_start_date,works_end_date,grace_months,grace_days,grace_type,grace_ends_on_opening)")
      .in("id", guaranteeIds);
    // Mirrors the creation rule: one alert per physical guarantee, so a second
    // row recording the same instrument on an amendment closes as redundant.
    const gReps = representativeGuaranteeIds((gs ?? []) as any[]);
    for (const g of (gs ?? []) as any[]) {
      if (g.status !== "active") continue;                  // returned/forfeited → nothing to chase
      if (!gReps.has(g.id)) continue;                       // duplicate of another row
      // "Not actually in place" is its own condition on the same entity_type —
      // tested separately so clearing one can't close the other.
      if (guaranteeGaps(g, undefined, g.contracts).length > 0) keep("guarantee:guarantee_missing", g.id);
      if (g.end_date && daysUntil(g.end_date) <= 60) keep("guarantee", g.id);
    }
  }

  // ── Safety inspections: resolved once the next date moves out of the window ──
  const safetyIds = idsFor("safety");
  if (safetyIds.length > 0) {
    const { data: insp } = await supabase.from("safety_inspections")
      .select("id,next_inspection_date").in("id", safetyIds);
    for (const s of (insp ?? []) as any[]) {
      if (!s.next_inspection_date) continue;
      if (daysUntil(s.next_inspection_date) <= 60) keep("safety", s.id);
    }
  }

  // ── Contracts expiring: resolved when extended past the window or ended ──
  const contractIds = idsFor("contract");
  if (contractIds.length > 0) {
    const { data: cs } = await supabase.from("contracts")
      .select("id,end_date,status,planned_handover_date,actual_handover_date,planned_opening_date,actual_opening_date,works_start_date,works_end_date,grace_months,grace_days,grace_type,grace_ends_on_opening,late_opening_penalty_type,late_opening_penalty_value,late_opening_grace_days,rent_type,rent_per_sqm,min_rent_per_sqm,minimum_rent,charged_area,investment_addition,start_date,contract_options(id,status,is_exercised)").in("id", contractIds);
    // Which of these already have the penalty billed — a raised charge closes
    // the alert, since the money is now tracked as a debt like any other.
    const { data: penCharges } = await supabase.from("charges")
      .select("contract_id").eq("charge_type", "late_opening_penalty").in("contract_id", contractIds);
    const billedSet = new Set<string>();
    for (const x of ((penCharges ?? []) as any[])) if (x.contract_id) billedSet.add(x.contract_id);
    // The alert sits on the base contract but the tenancy is base + amendments:
    // read the family's latest end date and pooled options, exactly as the
    // creator does, so the two never disagree about whether it still holds.
    const { data: kids } = await supabase.from("contracts")
      .select("id,parent_contract_id,end_date,contract_options(id,status,is_exercised)")
      .in("parent_contract_id", contractIds).eq("is_amendment", true);
    for (const c of (cs ?? []) as any[]) {
      // Handover confirmation is its own condition, on the same entity_type —
      // tested separately so one rule can't vouch for the other.
      if (handoverPendingVerdict({ contract: c }).applies) keep("contract:handover_pending", c.id);
      // Late-opening penalty: still outstanding only while unbilled.
      if (c.late_opening_penalty_type && c.late_opening_penalty_type !== "none" && !billedSet.has(c.id)) {
        const mRent = guaranteedMonthlyRent({
          rentType: c.rent_type, rentPerSqm: c.rent_per_sqm, area: c.charged_area,
          investmentAddition: c.investment_addition,
          minimumRent: c.min_rent_per_sqm || c.minimum_rent,
          minRentBasis: c.min_rent_per_sqm ? "per_sqm" : "monthly",
        });
        if (lateOpeningPenalty({ contract: c, monthlyRent: mRent }).applies) keep("contract:late_opening_penalty", c.id);
      }
      if (["active", "expiring", "extended"].indexOf(c.status) === -1) continue;  // ended → stop chasing
      var famEnd = c.end_date ? String(c.end_date).slice(0, 10) : "";
      var famOpts = (c.contract_options ?? []).slice();
      for (const k of ((kids ?? []) as any[])) {
        if (k.parent_contract_id !== c.id) continue;
        if (k.end_date && String(k.end_date).slice(0, 10) > famEnd) famEnd = String(k.end_date).slice(0, 10);
        famOpts = famOpts.concat(k.contract_options ?? []);
      }
      if (!famEnd) continue;
      // Same verdict the creator used — including the year-long vacating window,
      // otherwise this pass would close a vacating alert the moment it appeared.
      if (contractExpiryVerdict({ contract: { end_date: famEnd }, options: famOpts }).applies) keep("contract", c.id);
    }
  }

  // ── Options: resolved the moment the outcome is recorded. Two entity_type
  //    spellings exist in the data ("option" and "contract_option"); both point
  //    at a contract_options row, and the bulk of open alerts use the latter.
  const optionIds = Array.from(new Set(idsFor("option").concat(idsFor("contract_option"))));
  if (optionIds.length > 0) {
    const { data: opts } = await supabase.from("contract_options")
      .select("id,status,is_exercised").in("id", optionIds);
    for (const o of (opts ?? []) as any[]) {
      if (o.is_exercised) continue;
      if (["exercised", "declined", "expired"].indexOf(o.status) !== -1) continue;
      // Both spellings live in the data and point at the same row.
      keep("option", o.id); keep("contract_option", o.id);
    }
  }

  // ── Management-fee protection: resolved once the closing reconciliation is recorded ──
  const protIds = idsFor("mgmt_protection");
  if (protIds.length > 0) {
    const { data: cs } = await supabase.from("contracts")
      .select("id,mgmt_protection_reconciled_at,mgmt_protection_type").in("id", protIds);
    for (const c of (cs ?? []) as any[]) {
      if (c.mgmt_protection_reconciled_at) continue;
      if (!c.mgmt_protection_type || c.mgmt_protection_type === "none") continue;
      keep("mgmt_protection", c.id);
    }
  }

  // ── Insurance: the same entity_type covers two different things —
  //    a specific policy row (expiring), and a contract with NO certificate.
  const insuranceIds = idsFor("insurance");
  if (insuranceIds.length > 0) {
    // (a) policy rows still inside the expiry window
    for (const table of ["insurances_building", "insurances_tenant"]) {
      const { data: rows } = await supabase.from(table)
        .select("id,end_date,status").in("id", insuranceIds);
      for (const x of (rows ?? []) as any[]) {
        if (x.status !== "active" || !x.end_date) continue;
        if (daysUntil(x.end_date) <= 60) keep("insurance", x.id);
      }
    }
    // (b) "no certificate at all" alerts, keyed by the contract. Mirrors the
    //     creation rule: cover is per tenant+property, so a certificate on any
    //     contract of that group clears the whole group.
    const { data: cs } = await supabase.from("contracts")
      .select("id,tenant_id,property_id,status").in("id", insuranceIds);
    if (cs && cs.length > 0) {
      const { data: tenantIns } = await supabase.from("insurances_tenant")
        .select("contract_id,end_date,status");
      const { data: allContracts } = await supabase.from("contracts")
        .select("id,tenant_id,property_id").in("status", ["active", "expiring", "extended"]);
      const byId: Record<string, any> = {};
      (allContracts ?? []).forEach(function (c: any) { byId[c.id] = c; });
      const key = function (c: any) { return (c?.tenant_id || "?") + "|" + (c?.property_id || "?"); };
      const covered = new Set<string>();
      for (const x of (tenantIns ?? []) as any[]) {
        if (x.status !== "active" || !x.end_date || x.end_date < todayStr) continue;
        const c = byId[x.contract_id];
        if (c) covered.add(key(c));
      }
      for (const c of cs as any[]) {
        // Contract no longer active → nothing to chase.
        if (["active", "expiring", "extended"].indexOf(c.status) === -1) continue;
        if (covered.has(key(c))) continue;
        keep("insurance", c.id);
      }
    }
  }

  // Anything whose condition no longer holds gets closed. Alert types this pass
  // doesn't own (charge-backed ones like a penalty or a clawback, which are
  // settled through the charge itself) are left alone.
  const OWNED = ["arrears", "guarantee", "safety", "contract", "option", "contract_option", "insurance", "mgmt_protection"];
  // Informational notices report that something HAPPENED — there is no condition
  // to re-test, so they stay until the user closes them. Auto-closing would make
  // an event they may not have seen disappear on its own.
  const NOTICES = ["option_auto_exercised"];
  const toResolve: string[] = [];
  for (const a of open as any[]) {
    if (OWNED.indexOf(a.entity_type) === -1) continue;
    if (a.alert_type && NOTICES.indexOf(a.alert_type) !== -1) continue;
    if (!a.entity_id) continue;
    // Several distinct conditions share entity_type 'contract' (expiry/vacating,
    // handover confirmation). Those carry their own alert_type, so the key
    // includes it — otherwise one condition falling away would close the other.
    const key = a.entity_type === "contract" && a.alert_type === "handover_pending"
      ? "contract:handover_pending:" + a.entity_id
      : a.entity_type === "contract" && a.alert_type === "late_opening_penalty"
        ? "contract:late_opening_penalty:" + a.entity_id
      : a.entity_type === "guarantee" && a.alert_type === "guarantee_missing"
        ? "guarantee:guarantee_missing:" + a.entity_id
        : a.entity_type + ":" + a.entity_id;
    if (stillOpen.has(key)) continue;
    toResolve.push(a.id);
  }

  if (toResolve.length === 0) return { resolved: 0 };
  await supabase.from("alerts")
    .update({ is_resolved: true, handled_at: new Date().toISOString() })
    .in("id", toResolve);
  return { resolved: toResolve.length };
}
