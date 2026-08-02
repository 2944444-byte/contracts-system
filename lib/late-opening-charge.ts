// Raising the late-opening penalty as an actual charge.
//
// The penalty is computed by lib/store-opening.ts; this turns it into money the
// tenant owes. Kept separate from the calculation for the same reason the
// option penalty is: the figure can be looked at without committing to it, and
// the charge is created once, deliberately, with its derivation written into
// the notes so it can be checked later.

import type { SupabaseClient } from "@supabase/supabase-js";
import { lateOpeningPenalty, graceWindow } from "@/lib/store-opening";

export type LateOpeningPreview = {
  ok: boolean;
  reason?: string;
  amount: number;          // before VAT
  vatPct: number;
  vatAmount: number;
  total: number;
  lateDays: number;
  chargeableDays: number;
  basis: string;
  dueDate: string;
  alreadyCharged: boolean;
};

function todayStr(): string { return new Date().toISOString().slice(0, 10); }

export async function previewLateOpeningCharge(params: {
  supabase: SupabaseClient;
  contract: any;
  monthlyRent: number;
  vatPct: number;          // e.g. 18
  dueDays?: number;
}): Promise<LateOpeningPreview> {
  const empty: LateOpeningPreview = {
    ok: false, amount: 0, vatPct: 0, vatAmount: 0, total: 0,
    lateDays: 0, chargeableDays: 0, basis: "", dueDate: "", alreadyCharged: false,
  };

  const c = params.contract;
  if (!c) return { ...empty, reason: "לא נבחר חוזה" };

  const g = graceWindow({ contract: c });
  const pen = lateOpeningPenalty({ contract: c, monthlyRent: params.monthlyRent });
  if (!c.late_opening_penalty_type || c.late_opening_penalty_type === "none") {
    return { ...empty, reason: "בחוזה לא הוגדר קנס על אי-פתיחה" };
  }
  if (!g.openedLate) return { ...empty, reason: "המושכר לא נפתח באיחור — אין קנס" };
  if (!pen.applies) {
    return { ...empty, reason: pen.lateDays > 0 ? "האיחור בתוך ימי החסד — אין קנס" : "אין קנס לחיוב", lateDays: pen.lateDays };
  }

  // Already raised? The charge carries the contract and its type, so a second
  // press can't double-charge.
  const { data: existing } = await params.supabase.from("charges")
    .select("id").eq("contract_id", c.id).eq("charge_type", "late_opening_penalty").limit(1);

  // VAT follows the tax point — the date the demand is issued, i.e. today.
  const vatPct = c.vat_type === "taxable" ? (Number(params.vatPct) || 0) : 0;
  const vatAmount = Math.round(pen.amount * (vatPct / 100) * 100) / 100;
  const due = new Date();
  due.setDate(due.getDate() + (params.dueDays ?? 30));

  return {
    ok: true,
    amount: pen.amount,
    vatPct, vatAmount,
    total: Math.round((pen.amount + vatAmount) * 100) / 100,
    lateDays: pen.lateDays,
    chargeableDays: pen.chargeableDays,
    basis: pen.basis,
    dueDate: due.toISOString().slice(0, 10),
    alreadyCharged: !!(existing && existing.length),
  };
}

export async function applyLateOpeningCharge(params: {
  supabase: SupabaseClient;
  contract: any;
  preview: LateOpeningPreview;
}): Promise<{ ok: boolean; error?: string; chargeId?: string }> {
  const { supabase, contract, preview } = params;
  if (!preview.ok || preview.total <= 0) return { ok: false, error: "אין סכום לחיוב" };

  const g = graceWindow({ contract });
  const notes = "קנס אי-פתיחת המושכר במועד · " + preview.basis +
    (g.end ? " · תום הגרייס " + g.end.toLocaleDateString("he-IL") : "") +
    (contract.actual_opening_date ? " · נפתח " + new Date(contract.actual_opening_date).toLocaleDateString("he-IL") : " · טרם נפתח") +
    (contract.late_opening_penalty_notes ? " · " + contract.late_opening_penalty_notes : "");

  // Column names follow the charges table exactly: base_amount (not "amount"),
  // and vat_type alongside the VAT figure — the same shape the option penalty
  // uses, so both land in the payments screen identically.
  const { data, error } = await supabase.from("charges").insert({
    contract_id: contract.id,
    charge_type: "late_opening_penalty",
    description: "קנס אי-פתיחת המושכר במועד",
    base_amount: preview.amount,
    vat_amount: preview.vatAmount,
    total_amount: preview.total,
    vat_type: preview.vatPct > 0 ? "taxable" : "exempt",
    due_date: preview.dueDate,
    status: "pending",
    notes,
  }).select("id").single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, chargeId: data?.id };
}
