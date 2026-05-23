import { supabase } from "@/lib/supabase";

/**
 * Resolves the configured payment-grace-days for a property's owning company.
 * Falls back to 30 if the company is missing or the column isn't set.
 *
 * Used by auto-charge creators (billing tabs, CpiDiffTab) so the default
 * "due_date" — and therefore when a charge becomes "באיחור" — matches what
 * the user configured on the company.
 */
export async function getGraceDaysForProperty(propertyId: string): Promise<number> {
  if (!propertyId) return 30;
  try {
    var { data } = await supabase
      .from("properties")
      .select("companies(payment_grace_days)")
      .eq("id", propertyId)
      .single();
    var co = (data as any)?.companies;
    var company = Array.isArray(co) ? co[0] : co;
    var days = Number(company?.payment_grace_days);
    if (!days || days <= 0) return 30;
    return days;
  } catch {
    return 30;
  }
}

/**
 * Returns an ISO yyyy-mm-dd string for (today + graceDays).
 */
export function dueDateFromGrace(graceDays: number): string {
  var d = new Date();
  d.setDate(d.getDate() + Math.max(1, graceDays | 0));
  return d.toISOString().slice(0, 10);
}
