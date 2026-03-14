export { supabase } from "./supabase";
import { supabase } from "./supabase";

export async function getProperties() {
  const { data, error } = await supabase.from("properties").select("*, units(*)");
  if (error) throw error;
  return data ?? [];
}

export async function getTenants() {
  const { data, error } = await supabase.from("tenants").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function getContracts() {
  const { data, error } = await supabase
    .from("contracts")
    .select("*, properties(name), tenants(name)");
  if (error) throw error;
  return data ?? [];
}

export async function createProperty(p: {
  name: string; address?: string; type?: string; total_rentable_area?: number;
}) {
  const { data, error } = await supabase.from("properties").insert(p).select().single();
  if (error) throw error;
  // 3. שמור שיוך שטחים אם יש
  if (spaces && spaces.length > 0 && data?.id) {
    for (const sp of spaces) {
      const { error: spErr } = await supabase.from("contract_spaces").insert({
        contract_id:   data.id,
        space_id:      sp.space_id,
        charge_method: sp.charge_method,
        price_per_sqm: sp.price_per_sqm ?? null,
        fixed_amount:  sp.fixed_amount ?? null,
        quantity:      sp.quantity ?? null,
        price_per_unit: sp.price_per_unit ?? null,
        revenue_pct:   sp.revenue_pct ?? null,
        min_rent:      sp.min_rent ?? null,
        revenue_type:  sp.revenue_type ?? null,
        included_in_main_rent: sp.included_in_main_rent ?? true,
        notes:         sp.notes ?? null,
      });
      if (spErr) console.error("Space insert error:", spErr);
    }
  }

  return data;
}

export async function createUnit(u: {
  property_id: string; name: string; area?: number; use_type?: string;
}) {
  const { data, error } = await supabase.from("units").insert(u).select().single();
  if (error) throw error;
  // 3. שמור שיוך שטחים אם יש
  if (spaces && spaces.length > 0 && data?.id) {
    for (const sp of spaces) {
      const { error: spErr } = await supabase.from("contract_spaces").insert({
        contract_id:   data.id,
        space_id:      sp.space_id,
        charge_method: sp.charge_method,
        price_per_sqm: sp.price_per_sqm ?? null,
        fixed_amount:  sp.fixed_amount ?? null,
        quantity:      sp.quantity ?? null,
        price_per_unit: sp.price_per_unit ?? null,
        revenue_pct:   sp.revenue_pct ?? null,
        min_rent:      sp.min_rent ?? null,
        revenue_type:  sp.revenue_type ?? null,
        included_in_main_rent: sp.included_in_main_rent ?? true,
        notes:         sp.notes ?? null,
      });
      if (spErr) console.error("Space insert error:", spErr);
    }
  }

  return data;
}

export async function createTenant(t: {
  name: string; company_name?: string; contact_name?: string;
  contact_phone?: string; contact_email?: string; contact_role?: string;
}) {
  const { data, error } = await supabase.from("tenants").insert(t).select().single();
  if (error) throw error;
  // 3. שמור שיוך שטחים אם יש
  if (spaces && spaces.length > 0 && data?.id) {
    for (const sp of spaces) {
      const { error: spErr } = await supabase.from("contract_spaces").insert({
        contract_id:   data.id,
        space_id:      sp.space_id,
        charge_method: sp.charge_method,
        price_per_sqm: sp.price_per_sqm ?? null,
        fixed_amount:  sp.fixed_amount ?? null,
        quantity:      sp.quantity ?? null,
        price_per_unit: sp.price_per_unit ?? null,
        revenue_pct:   sp.revenue_pct ?? null,
        min_rent:      sp.min_rent ?? null,
        revenue_type:  sp.revenue_type ?? null,
        included_in_main_rent: sp.included_in_main_rent ?? true,
        notes:         sp.notes ?? null,
      });
      if (spErr) console.error("Space insert error:", spErr);
    }
  }

  return data;
}

function addMonthsDb(dateStr: string, months: number): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function nextDayDb(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

export interface OptionInput {
  durationMonths: number;
  noticeDaysBefore: number;   // ימים לפני סיום
  noticeType: string;          // non_renewal | exercise | auto_extend
  rentMechanism: string;       // no_change | pct_increase | fixed
  rentIncreasePct?: number;
  newRentValue?: number;
}

// createContract — שומר חוזה + אופציות ב-contract_options
export interface SpaceChargeInput {
  space_id:       string;
  charge_method:  string;
  price_per_sqm?: number;
  fixed_amount?:  number;
  quantity?:      number;
  price_per_unit?: number;
  revenue_pct?:   number;
  min_rent?:      number;
  revenue_type?:  string;
  monthly_reported_revenue?: number;
  included_in_main_rent?: boolean;
  notes?:         string;
}

export async function createContract(c: any, options?: OptionInput[], spaces?: SpaceChargeInput[]) {
  // 1. שמור חוזה
  const { data, error } = await supabase
    .from("contracts")
    .insert(c)
    .select()
    .single();
  if (error) throw error;

  // 2. שמור אופציות אם יש
  if (options && options.length > 0 && data?.id) {
    let prevEnd = c.end_date as string;
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const optStart = nextDayDb(prevEnd);
      const optEnd   = addMonthsDb(optStart, opt.durationMonths);

      const { error: optErr } = await supabase.from("contract_options").insert({
        contract_id:           data.id,
        option_number:         i + 1,
        duration_months:       opt.durationMonths,
        start_date:            optStart,
        end_date:              optEnd,
        notice_type:           opt.noticeType,
        notice_days_before_end: opt.noticeDaysBefore,
        rent_mechanism:        opt.rentMechanism,
        rent_increase_pct:     opt.rentIncreasePct ?? null,
        new_rent_value:        opt.newRentValue ?? null,
        status:                "pending",
      });
      if (optErr) console.error("Option insert error:", optErr);
      prevEnd = optEnd;
    }
  }

  // 3. שמור שיוך שטחים אם יש
  if (spaces && spaces.length > 0 && data?.id) {
    for (const sp of spaces) {
      const { error: spErr } = await supabase.from("contract_spaces").insert({
        contract_id:   data.id,
        space_id:      sp.space_id,
        charge_method: sp.charge_method,
        price_per_sqm: sp.price_per_sqm ?? null,
        fixed_amount:  sp.fixed_amount ?? null,
        quantity:      sp.quantity ?? null,
        price_per_unit: sp.price_per_unit ?? null,
        revenue_pct:   sp.revenue_pct ?? null,
        min_rent:      sp.min_rent ?? null,
        revenue_type:  sp.revenue_type ?? null,
        included_in_main_rent: sp.included_in_main_rent ?? true,
        notes:         sp.notes ?? null,
      });
      if (spErr) console.error("Space insert error:", spErr);
    }
  }

  return data;
}
