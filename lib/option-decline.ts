import { supabase } from "@/lib/supabase";
import { getVatPct } from "@/lib/vat";
import { logAudit } from "@/lib/audit-log";
import {
  penaltyTermsFromRow, hasPenalty, computeOptionPenalty,
  type PenaltyTerms, type PenaltyCalc,
} from "@/lib/option-penalty";

// Marking an option as NOT exercised happens from two screens (contract detail
// and alerts). Both must behave identically — including raising the
// compensation charge — so the flow lives here, not in either page.

export type DeclinePreview = {
  option: any;
  contract: any;
  terms: PenaltyTerms;
  calc: PenaltyCalc | null;   // null when the contract has no penalty clause
  error?: string;             // set when a penalty is owed but couldn't be computed
};

// Load the option + its contract and compute what the tenant would owe.
// Nothing is written — call applyOptionDecline() after the user confirms.
export async function previewOptionDecline(optionId: string, noticeDate?: Date): Promise<DeclinePreview | null> {
  const { data: option } = await supabase.from("contract_options").select("*").eq("id", optionId).single();
  if (!option) return null;

  const { data: contract } = await supabase.from("contracts")
    .select("id, tenant_id, property_id, vat_type, start_date, end_date, index_base_date, lease_period_value, lease_period_unit, tenants(name), contract_spaces(space_id, spaces(area))")
    .eq("id", option.contract_id).single();

  const terms = penaltyTermsFromRow(option);
  if (!hasPenalty(terms)) return { option, contract, terms, calc: null };

  // Tax point for a penalty is the notice date — linkage runs up to it and the
  // VAT rate in effect then is the one charged.
  const when = noticeDate ?? new Date();
  const vatPct = contract?.vat_type === "exempt" ? 0 : await getVatPct();
  const calc = await computeOptionPenalty({ terms, contract, option, vatPct, noticeDate: when });
  return { option, contract, terms, calc, error: calc.ok ? undefined : calc.error };
}

export type DeclineResult = { ok: boolean; chargeId?: string; error?: string };

// Record the decline. When a penalty was computed, raise the charge and open an
// alert for it so it gets chased rather than sitting silently in billing.
export async function applyOptionDecline(p: {
  preview: DeclinePreview;
  noticeDate?: Date;
}): Promise<DeclineResult> {
  const { option, contract, terms, calc } = p.preview;
  const noticeDate = p.noticeDate ?? new Date();
  var chargeId: string | undefined;

  if (calc && calc.ok) {
    const desc = "פיצוי בגין אי מימוש אופציה " + option.option_number
      + (terms.type === "per_sqm_month"
        ? " (" + terms.value + " ₪/מ\"ר × " + calc.area + " מ\"ר × " + calc.months + " ח')"
        : "");
    const noteParts = [
      terms.indexed
        ? "הצמדה למדד ×" + calc.cpiRatio.toFixed(4) + (calc.indexFrom ? " (" + calc.indexFrom + " → " + calc.indexTo + ")" : "")
        : "ללא הצמדה",
      "סכום לפני הצמדה: " + calc.rawBase,
      terms.notes || "",
    ].filter(Boolean);

    const { data: charge, error: chErr } = await supabase.from("charges").insert({
      contract_id: contract?.id ?? option.contract_id,
      charge_type: "option_penalty",
      description: desc,
      base_amount: calc.base,
      vat_amount: calc.vatAmount,
      total_amount: calc.total,
      vat_type: terms.vat && calc.vatPct > 0 ? "taxable" : "exempt",
      due_date: calc.dueDate,
      status: "pending",
      notes: noteParts.join(" · "),
    }).select("id").single();

    if (chErr) return { ok: false, error: "שגיאה ביצירת החיוב: " + chErr.message };
    chargeId = charge?.id;

    await supabase.from("alerts").insert({
      title: "פיצוי אי מימוש אופציה — " + ((contract as any)?.tenants?.name || ""),
      message: desc + " · סה\"כ " + Math.round(calc.total).toLocaleString("he-IL") + " ₪ · לתשלום עד " + calc.dueDate,
      alert_type: "option_penalty",
      severity: "warning",
      priority: "high",
      entity_type: "charge",
      entity_id: chargeId ?? null,
      related_entity_type: "contract_option",
      related_entity_id: option.id,
      contract_id: contract?.id ?? option.contract_id,
      property_id: contract?.property_id ?? null,
      tenant_id: contract?.tenant_id ?? null,
      due_date: calc.dueDate,
    });
  }

  const { error: upErr } = await supabase.from("contract_options").update({
    status: "declined",
    is_exercised: false,
    declined_at: noticeDate.toISOString(),
    non_exercise_charge_id: chargeId ?? null,
  }).eq("id", option.id);
  if (upErr) return { ok: false, error: upErr.message };

  // The outcome is settled — stop the option's notice reminders.
  await supabase.from("alerts").update({ is_resolved: true, handled_at: new Date().toISOString() })
    .eq("entity_id", option.id).eq("is_resolved", false);

  await logAudit({
    entity_type: "contract_option", entity_id: option.id, action: "decline_option",
    notes: calc?.ok ? "פיצוי אי מימוש " + calc.total + " ₪ · חיוב " + (chargeId || "—") : "אי מימוש ללא פיצוי",
  });

  return { ok: true, chargeId };
}
