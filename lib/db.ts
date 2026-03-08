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
  const { data, error } = await supabase.from("contracts").select("*, properties(name), tenants(name)");
  if (error) throw error;
  return data ?? [];
}

export async function createProperty(p: { name: string; address?: string; type?: string; total_rentable_area?: number; }) {
  const { data, error } = await supabase.from("properties").insert(p).select().single();
  if (error) throw error;
  return data;
}

export async function createUnit(u: { property_id: string; name: string; area?: number; use_type?: string; }) {
  const { data, error } = await supabase.from("units").insert(u).select().single();
  if (error) throw error;
  return data;
}

export async function createTenant(t: { name: string; company_name?: string; contact_name?: string; contact_phone?: string; contact_email?: string; contact_role?: string; }) {
  const { data, error } = await supabase.from("tenants").insert(t).select().single();
  if (error) throw error;
  return data;
}

export async function createContract(c: any) {
  const { data, error } = await supabase.from("contracts").insert(c).select().single();
  if (error) throw error;
  return data;
}
