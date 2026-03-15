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

export async function createContract(c: any, options?: any[], spaces?: any[]) {
  const { data, error } = await supabase.from("contracts").insert(c).select().single();
  if (error) throw error;
  return data;
}
