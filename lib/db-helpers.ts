import { supabase } from "./supabase";

export async function getPropertyBudgets(propertyId: string) {
  const { data } = await supabase.from("property_budgets").select("*").eq("property_id", propertyId).order("year", { ascending: false });
  return data ?? [];
}
export async function upsertPropertyBudget(budget: any) {
  const { data, error } = await supabase.from("property_budgets").upsert(budget, { onConflict: "property_id,year" }).select().single();
  if (error) throw error;
  return data;
}
export async function deletePropertyBudget(id: string) {
  await supabase.from("property_budgets").delete().eq("id", id);
}
export async function getAlerts(resolved?: boolean) {
  let q = supabase.from("alerts").select("*").order("created_at", { ascending: false });
  if (resolved !== undefined) q = q.eq("is_resolved", resolved);
  const { data } = await q;
  return data ?? [];
}
export async function resolveAlert(id: string) {
  await supabase.from("alerts").update({ is_resolved: true }).eq("id", id);
}
export async function deleteAlert(id: string) {
  await supabase.from("alerts").delete().eq("id", id);
}
export async function generateSystemAlerts() {
  const today = new Date();
  const { data: contracts } = await supabase
    .from("contracts")
    .select("id, end_date, status, guarantee_expiry, guarantee_initial_expiry, tenants(name), properties(name)")
    .in("status", ["active", "expiring", "upcoming"]);
  for (const c of contracts ?? []) {
    const tenant = (c.tenants as any)?.name ?? "שוכר";
    const prop = (c.properties as any)?.name ?? "נכס";
    if (c.end_date) {
      const days = Math.ceil((new Date(c.end_date).getTime() - today.getTime()) / 86400000);
      if (days > 0 && days <= 90) {
        await insertAlertIfNew(c.id, "lease_ending", {
          title: "חוזה מסתיים בקרוב",
          message: `חוזה של ${tenant} ב${prop} מסתיים ב-${days} ימים`,
          priority: days <= 30 ? "critical" : days <= 60 ? "high" : "medium",
          related_entity_type: "lease",
          due_date: c.end_date,
        });
      }
    }
    if (c.guarantee_expiry) {
      const days = Math.ceil((new Date(c.guarantee_expiry).getTime() - today.getTime()) / 86400000);
      if (days > 0 && days <= 60) {
        await insertAlertIfNew(c.id + "_g", "deposit_renewal", {
          title: "ערבות דורשת חידוש",
          message: `ערבות של ${tenant} פגה ב-${days} ימים`,
          priority: days <= 14 ? "critical" : "high",
          related_entity_type: "lease",
          due_date: c.guarantee_expiry,
        });
      }
    }
  }
  const { data: props } = await supabase.from("properties").select("id, name, insurance_renewal_date").not("insurance_renewal_date", "is", null);
  for (const p of props ?? []) {
    if (!p.insurance_renewal_date) continue;
    const days = Math.ceil((new Date(p.insurance_renewal_date).getTime() - today.getTime()) / 86400000);
    if (days > 0 && days <= 60) {
      await insertAlertIfNew(p.id, "insurance_renewal", {
        title: "חידוש ביטוח מבנה",
        message: `ביטוח "${p.name}" מסתיים ב-${days} ימים`,
        priority: days <= 14 ? "critical" : "medium",
        related_entity_type: "property",
        due_date: p.insurance_renewal_date,
      });
    }
  }
}
async function insertAlertIfNew(entityId: string, alertType: string, data: any) {
  const { data: ex } = await supabase.from("alerts").select("id").eq("related_entity_id", entityId).eq("alert_type", alertType).eq("is_resolved", false).limit(1);
  if (!ex || ex.length === 0) await supabase.from("alerts").insert({ ...data, alert_type: alertType, related_entity_id: entityId });
}

// בדיקת מדדים חסרים לחוזה
export async function checkMissingCpiForContract(
  baseMonth: string, // "2023-01"
  baseYear: number   // 2020
): Promise<{ missing: string[]; ok: boolean }> {
  if (!baseMonth) return { missing: [], ok: true };
  const [by, bm] = baseMonth.split("-").map(Number);
  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth() + 1;

  const { data: records } = await supabase
    .from("cpi_records")
    .select("year, month")
    .eq("base_year", baseYear)
    .gte("year", by)
    .lte("year", endYear);

  const existing = new Set((records ?? []).map((r: any) => `${r.year}-${String(r.month).padStart(2,"0")}`));
  const missing: string[] = [];

  let y = by, m = bm;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    const key = `${y}-${String(m).padStart(2,"0")}`;
    if (!existing.has(key)) missing.push(key);
    m++; if (m > 12) { m = 1; y++; }
  }
  return { missing, ok: missing.length === 0 };
}

// משיכת מדדים חסרים אוטומטית
export async function fetchMissingCpi(missing: string[]): Promise<number> {
  const years = [...new Set(missing.map(m => Number(m.split("-")[0])))];
  let fetched = 0;
  for (const year of years) {
    try {
      const res = await fetch(`/api/cpi?year=${year}&refresh=true`);
      const data = await res.json();
      fetched += data.records?.length ?? 0;
    } catch {}
  }
  return fetched;
}
