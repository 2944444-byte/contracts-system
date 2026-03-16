import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// API לסנכרון התראות אוטומטיות מחוזים
export async function POST() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let created = 0;

  // חוזים שפגים בקרוב
  const { data: contracts } = await supabase.from("contracts")
    .select("id, end_date, tenants(name), properties(name), contract_options(id,status,end_date,notice_days_before_end)")
    .in("status", ["active","expiring"]);

  for (const c of contracts ?? []) {
    if (!c.end_date) continue;
    const days = Math.ceil((new Date(c.end_date).getTime() - Date.now()) / 86400000);
    const label = `${c.tenants?.name} — ${c.properties?.name}`;

    // בדוק אם כבר קיימת התראה
    const { data: existing } = await supabase.from("alerts")
      .select("id").eq("entity_id", c.id).eq("entity_type", "contract").eq("status", "open").limit(1);
    if (existing?.length) continue;

    if (days <= 90 && days >= 0) {
      await supabase.from("alerts").insert({
        title:       `חוזה פוגה ב-${days} ימים: ${label}`,
        severity:    days <= 30 ? "urgent" : days <= 60 ? "warning" : "info",
        entity_type: "contract",
        entity_id:   c.id,
        due_date:    c.end_date,
        status:      "open",
      });
      created++;
    }

    // אופציות
    for (const opt of c.contract_options ?? []) {
      if (opt.status !== "pending" || !opt.end_date) continue;
      const noticeDays = opt.notice_days_before_end ?? 90;
      const optDays = Math.ceil((new Date(opt.end_date).getTime() - Date.now()) / 86400000);
      if (optDays <= noticeDays && optDays >= 0) {
        const { data: optEx } = await supabase.from("alerts")
          .select("id").eq("entity_id", opt.id).eq("entity_type", "option").eq("status", "open").limit(1);
        if (!optEx?.length) {
          await supabase.from("alerts").insert({
            title:       `מועד הודעת אופציה: ${label}`,
            severity:    optDays <= 30 ? "urgent" : "warning",
            entity_type: "option",
            entity_id:   opt.id,
            due_date:    opt.end_date,
            status:      "open",
          });
          created++;
        }
      }
    }
  }

  // ערבויות שפגות
  const { data: guarantees } = await supabase.from("guarantees")
    .select("id, end_date, contracts(tenants(name), properties(name))")
    .eq("status", "active");

  for (const g of guarantees ?? []) {
    if (!g.end_date) continue;
    const days = Math.ceil((new Date(g.end_date).getTime() - Date.now()) / 86400000);
    if (days <= 60 && days >= 0) {
      const { data: ex } = await supabase.from("alerts")
        .select("id").eq("entity_id", g.id).eq("entity_type", "guarantee").eq("status", "open").limit(1);
      if (!ex?.length) {
        await supabase.from("alerts").insert({
          title:       `ערבות פגה ב-${days} ימים: ${g.contracts?.tenants?.name}`,
          severity:    days <= 30 ? "urgent" : "warning",
          entity_type: "guarantee",
          entity_id:   g.id,
          due_date:    g.end_date,
          status:      "open",
        });
        created++;
      }
    }
  }

  return NextResponse.json({ ok: true, created });
}
