import { supabase } from '@/lib/supabase';

// Current VAT rate as a fraction (e.g. 0.18). Reads the latest vat_rates row
// (rate_pct, e.g. 18); defaults to 18% when none is configured.
export async function getVatPct(): Promise<number> {
  const { data } = await supabase
    .from("vat_rates")
    .select("rate_pct")
    .order("effective_from", { ascending: false })
    .limit(1);
  return (data && data.length > 0 ? Number(data[0].rate_pct) : 18) / 100;
}

// Map of contract_id → vat_type ("taxable" | "exempt" | null) for the given
// contracts, so auto-charges add VAT only for taxable tenants.
export async function getVatTypeMap(contractIds: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (!contractIds || contractIds.length === 0) return map;
  const { data } = await supabase.from("contracts").select("id, vat_type").in("id", contractIds);
  (data ?? []).forEach(function (c: any) { map[c.id] = c.vat_type; });
  return map;
}

// Given a pre-VAT base amount and whether the contract is taxable, return the
// {base, vat, total, vatType} to store on a charge. VAT is rounded to agorot.
export function applyVat(base: number, taxable: boolean, vatPct: number): { base: number; vat: number; total: number; vatType: string } {
  const vat = taxable ? Math.round(base * vatPct * 100) / 100 : 0;
  return { base: base, vat: vat, total: Math.round((base + vat) * 100) / 100, vatType: taxable ? "taxable" : "exempt" };
}
