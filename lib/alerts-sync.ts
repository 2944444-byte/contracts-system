// Shared alert-sync logic. Scans the data for upcoming/overdue items and
// inserts alert rows (deduped against existing open alerts). Used by the
// manual POST /api/alerts/sync and the daily cron /api/cron/sync-contracts.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface NewAlert {
  title: string;
  severity: string;
  entity_type: string;
  due_date?: string | null;
}

// Human labels for safety catalog keys (kept in sync with the safety page).
const SAFETY_LABELS: Record<string, string> = {
  electrical_inspection: "בדיקת חשמל ע\"י בודק מוסמך",
  thermographic: "סריקה תרמוגרפית ללוחות",
  extinguishers: "בדיקת מטפים",
  fire_detection: "בדיקת מערכת גילוי אש ועשן",
  sprinklers: "תחזוקת ספרינקלרים",
  pa_system: "בדיקת מערכת כריזה",
  emergency_lighting: "בדיקת תאורת חירום",
  alarm: "בדיקת מערכת אזעקה",
  elevators: "בדיקת מעליות",
  solar_pv: "תחזוקת מערכת סולארית",
  fire_site_file: "עדכון תיק שטח",
  tenant_fire_license: "אישור כיבוי אש לעסק השוכר",
};
const TYPE_LABELS: Record<string, string> = {
  fire: "כיבוי אש", elevator: "מעלית", electrical: "חשמל", gas: "גז",
  hvac: "מיזוג", accessibility: "נגישות", structure: "קונסטרוקציה", other: "בטיחות",
};
function safetyLabel(row: any): string {
  return (row.check_key && SAFETY_LABELS[row.check_key])
    || TYPE_LABELS[row.inspection_type] || "בדיקת בטיחות";
}

function daysUntil(d: string): number {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

export async function runAlertSync(supabase: SupabaseClient): Promise<{ created: number; newAlerts: NewAlert[] }> {
  let created = 0;
  const newAlerts: NewAlert[] = [];

  async function hasOpen(entityId: string, entityType: string): Promise<boolean> {
    const { data } = await supabase.from("alerts").select("id").eq("entity_id", entityId).eq("entity_type", entityType).eq("status", "open").limit(1);
    return !!(data && data.length);
  }
  async function add(a: any) {
    await supabase.from("alerts").insert(a);
    created++;
    newAlerts.push({ title: a.title, severity: a.severity, entity_type: a.entity_type, due_date: a.due_date });
  }

  // 1. Contracts expiring + options
  const { data: contracts } = await supabase.from("contracts")
    .select("id,property_id,end_date,tenants(name),properties(name),contract_options(id,status,end_date,notice_days_before_end)")
    .in("status", ["active", "expiring"]);
  for (const c of (contracts ?? []) as any[]) {
    if (c.end_date) {
      const days = daysUntil(c.end_date);
      if (days >= 0 && days <= 90) {
        const label = (c.tenants?.name ?? "") + " — " + (c.properties?.name ?? "");
        if (!(await hasOpen(c.id, "contract"))) {
          await add({ title: `חוזה פוגה ב-${days} ימים: ${label}`, severity: days <= 30 ? "urgent" : days <= 60 ? "warning" : "info", entity_type: "contract", entity_id: c.id, property_id: c.property_id ?? null, due_date: c.end_date, status: "open" });
        }
      }
    }
    for (const opt of (c.contract_options ?? []) as any[]) {
      if (opt.status !== "pending" || !opt.end_date) continue;
      const nd = opt.notice_days_before_end ?? 90;
      const od = daysUntil(opt.end_date);
      if (od > nd || od < 0) continue;
      if (await hasOpen(opt.id, "option")) continue;
      const label = (c.tenants?.name ?? "") + " — " + (c.properties?.name ?? "");
      await add({ title: `מועד הודעת אופציה: ${label}`, severity: od <= 30 ? "urgent" : "warning", entity_type: "option", entity_id: opt.id, property_id: c.property_id ?? null, due_date: opt.end_date, status: "open" });
    }
  }

  // 2. Guarantees
  const { data: guarantees } = await supabase.from("guarantees").select("id,end_date,contracts(tenants(name))").eq("status", "active");
  for (const g of (guarantees ?? []) as any[]) {
    if (!g.end_date) continue;
    const days = daysUntil(g.end_date);
    if (days > 60 || days < 0) continue;
    if (await hasOpen(g.id, "guarantee")) continue;
    await add({ title: `ערבות פגה ב-${days} ימים: ${g.contracts?.tenants?.name ?? ""}`, severity: days <= 30 ? "urgent" : "warning", entity_type: "guarantee", entity_id: g.id, due_date: g.end_date, status: "open" });
  }

  // 3. Insurances
  for (const table of ["insurances_building", "insurances_tenant"]) {
    const { data: ins } = await supabase.from(table).select("id,property_id,end_date").eq("status", "active");
    for (const x of (ins ?? []) as any[]) {
      if (!x.end_date) continue;
      const days = daysUntil(x.end_date);
      if (days > 60 || days < 0) continue;
      if (await hasOpen(x.id, "insurance")) continue;
      await add({ title: `ביטוח פג ב-${days} ימים`, severity: days <= 30 ? "urgent" : "warning", entity_type: "insurance", entity_id: x.id, property_id: x.property_id ?? null, due_date: x.end_date, status: "open" });
    }
  }

  // 4. Safety inspections — due within 60 days OR already overdue (critical).
  const { data: insp } = await supabase.from("safety_inspections")
    .select("id,property_id,check_key,inspection_type,standard,next_inspection_date,status,responsible_party,properties(name)")
    .not("next_inspection_date", "is", null);
  for (const s of (insp ?? []) as any[]) {
    const days = daysUntil(s.next_inspection_date);
    if (days > 60) continue; // not yet in the window
    if (await hasOpen(s.id, "safety")) continue;
    const who = s.responsible_party === "tenant" ? "שוכר" : "חברת ניהול";
    const label = safetyLabel(s) + " — " + (s.properties?.name ?? "");
    const title = days < 0
      ? `בדיקת בטיחות באיחור (${Math.abs(days)} ימים): ${label} [${who}]`
      : `בדיקת בטיחות נדרשת בעוד ${days} ימים: ${label} [${who}]`;
    await add({ title, severity: days <= 30 ? "urgent" : "warning", entity_type: "safety", entity_id: s.id, property_id: s.property_id ?? null, due_date: s.next_inspection_date, status: "open" });
  }

  return { created, newAlerts };
}

// Build an RTL HTML digest email from the alerts created this run.
export function buildAlertsDigestHtml(newAlerts: NewAlert[]): string {
  const urgent = newAlerts.filter(a => a.severity === "urgent");
  const warning = newAlerts.filter(a => a.severity === "warning");
  const info = newAlerts.filter(a => a.severity !== "urgent" && a.severity !== "warning");
  const section = (title: string, color: string, items: NewAlert[]) => items.length === 0 ? "" :
    `<h3 style="color:${color};margin:16px 0 8px">${title} (${items.length})</h3><ul style="line-height:1.8;padding-right:18px">` +
    items.map(a => `<li>${a.title}${a.due_date ? ` <span style="color:#94a3b8;font-size:12px">— ${new Date(a.due_date).toLocaleDateString("he-IL")}</span>` : ""}</li>`).join("") + `</ul>`;
  return `<div dir="rtl" style="font-family:Arial,sans-serif;direction:rtl;padding:28px;max-width:640px">
    <h2 style="color:#1e3a5f;border-bottom:2px solid #3b82f6;padding-bottom:8px">התראות מערכת — סיכום</h2>
    <p style="color:#64748b;font-size:13px">${new Date().toLocaleDateString("he-IL")} · ${newAlerts.length} התראות חדשות</p>
    ${section("🔴 דחוף (עד 30 יום / באיחור)", "#dc2626", urgent)}
    ${section("🟡 אזהרה (עד 60 יום)", "#d97706", warning)}
    ${section("ℹ️ מידע", "#2563eb", info)}
    <hr style="margin-top:28px;border:none;border-top:1px solid #e2e8f0"/>
    <p style="font-size:11px;color:#94a3b8">PropManager v4 — מעקב ערבויות, ביטוחים ובדיקות בטיחות</p>
  </div>`;
}
