import { supabase } from '@/lib/supabase';

// A single configured VAT period: rate_pct (e.g. 18) effective for the
// [effective_from, effective_to] date range (effective_to null = still active).
export interface VatRate { rate_pct: number; effective_from: string; effective_to: string | null; }

function toDayStr(date: Date | string): string {
  if (typeof date === "string") return date.slice(0, 10);
  // Local Y-M-D (avoid a UTC shift moving a 1st-of-month across a boundary).
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

// Full VAT-rate history, newest period first. Source of truth for every VAT
// computation; load once and resolve per-date with vatPctAt().
export async function getVatRates(): Promise<VatRate[]> {
  const { data } = await supabase
    .from("vat_rates")
    .select("rate_pct, effective_from, effective_to")
    .order("effective_from", { ascending: false });
  return (data ?? []).map(function (r: any) {
    return { rate_pct: Number(r.rate_pct), effective_from: r.effective_from, effective_to: r.effective_to };
  });
}

// Resolve the VAT fraction (e.g. 0.18) that was in effect on a given date —
// SYNC, so render/loop code can pick the historically-correct rate without an
// await per item. `rates` must be newest-first (as getVatRates returns).
// This is what makes a retroactive recalculation of past payments use the rate
// that applied THEN, not today's rate. Defaults to 18% if nothing matches.
export function vatPctAt(rates: VatRate[], date: Date | string): number {
  if (!rates || rates.length === 0) return 0.18;
  const d = toDayStr(date);
  // Period that actually covers the date.
  const covering = rates.find(function (r) { return r.effective_from <= d && (!r.effective_to || r.effective_to >= d); });
  if (covering) return covering.rate_pct / 100;
  // No covering period (a gap, or a date before the first record): use the most
  // recent period that had already started by then, else the earliest known.
  const started = rates.find(function (r) { return r.effective_from <= d; });
  if (started) return started.rate_pct / 100;
  return rates[rates.length - 1].rate_pct / 100;
}

// VAT fraction in effect on a specific date (one-shot async convenience).
export async function getVatPctForDate(date: Date | string): Promise<number> {
  return vatPctAt(await getVatRates(), date);
}

// Current VAT rate as a fraction (e.g. 0.18) — the rate in effect today.
// Equivalent to getVatPctForDate(today). Use for live/new entries; use
// getVatPctForDate / vatPctAt when the charge relates to a PAST period.
export async function getVatPct(): Promise<number> {
  return getVatPctForDate(new Date());
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
