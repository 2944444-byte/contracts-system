import { supabase } from "./supabase";
import { logAudit } from "./audit-log";

export async function syncContractStatuses(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  const todayMs = Date.now();
  let updated = 0;

  // ── Auto-exercise options ──
  // Options of type "auto" or "non_renewal" should auto-exercise when notice deadline passes
  // (tenant didn't notify of non-renewal, so option is automatically extended)
  const { data: pendingOpts } = await supabase.from("contract_options")
    .select("id,contract_id,option_number,duration_months,duration_years,end_date,notice_days_before_end,notice_type,status,is_exercised,start_date")
    .eq("is_exercised", false)
    .neq("status", "expired")
    .in("notice_type", ["auto", "non_renewal"]);

  for (const opt of pendingOpts ?? []) {
    if (!opt.end_date || !opt.notice_days_before_end) continue;
    // Notice deadline = option end_date - notice_days_before_end (this is when tenant must notify)
    // Actually it's based on the CONTRACT end date, not the option end date
    const { data: parentContract } = await supabase.from("contracts")
      .select("end_date").eq("id", opt.contract_id).single();
    if (!parentContract?.end_date) continue;

    const contractEndMs = new Date(parentContract.end_date).getTime();
    const noticeDeadlineMs = contractEndMs - (opt.notice_days_before_end * 86400000);

    // If notice deadline has passed → auto-exercise
    if (todayMs > noticeDeadlineMs) {
      // Calculate new end date: contract end + option duration
      const newEnd = new Date(contractEndMs);
      const months = opt.duration_months || (opt.duration_years ? Math.round(opt.duration_years * 12) : 12);
      newEnd.setMonth(newEnd.getMonth() + months);
      const newEndStr = newEnd.toISOString().split("T")[0];

      // Mark option as exercised
      await supabase.from("contract_options").update({
        is_exercised: true,
        status: "exercised",
      }).eq("id", opt.id);

      // Extend contract end date
      await supabase.from("contracts").update({
        end_date: newEndStr,
        status: "extended",
      }).eq("id", opt.contract_id);

      // Create alert
      await supabase.from("alerts").insert({
        title: `אופציה ${opt.option_number} מומשה אוטומטית`,
        message: `לא התקבלה הודעת אי-מימוש עד ${new Date(noticeDeadlineMs).toLocaleDateString("he-IL")}. החוזה הוארך אוטומטית עד ${new Date(newEndStr).toLocaleDateString("he-IL")}.`,
        alert_type: "option_auto_exercised",
        severity: "info",
        entity_type: "contract",
        entity_id: opt.contract_id,
        contract_id: opt.contract_id,
        due_date: newEndStr,
      });

      await logAudit({
        entity_type: "contract_option", entity_id: opt.id, action: "auto_exercise",
        notes: `אופציה ${opt.option_number} מומשה אוטומטית — חוזה הוארך עד ${newEndStr}`,
      });
      updated++;
    } else {
      // Notice deadline approaching (within 30 days) → create reminder alert
      const daysToDeadline = Math.ceil((noticeDeadlineMs - todayMs) / 86400000);
      if (daysToDeadline <= 30 && daysToDeadline > 0) {
        // Check if alert already exists
        const { data: existing } = await supabase.from("alerts")
          .select("id")
          .eq("contract_id", opt.contract_id)
          .eq("alert_type", "option_notice_deadline")
          .eq("entity_id", opt.id)
          .limit(1);
        if (!existing || existing.length === 0) {
          await supabase.from("alerts").insert({
            title: `תאריך הודעה אחרון לאופציה ${opt.option_number}`,
            message: `יש ${daysToDeadline} ימים עד תאריך אחרון לקבלת הודעת אי-מימוש (${new Date(noticeDeadlineMs).toLocaleDateString("he-IL")}). אם לא תתקבל הודעה — האופציה תמומש אוטומטית.`,
            alert_type: "option_notice_deadline",
            severity: daysToDeadline <= 7 ? "high" : "medium",
            entity_type: "contract_option",
            entity_id: opt.id,
            contract_id: opt.contract_id,
            due_date: new Date(noticeDeadlineMs).toISOString().split("T")[0],
          });
        }
      }
    }
  }

  // ── Visitor parking billing alerts ──
  // For visitor parking subs that reached their next_billing_date, create an alert
  // (or one approaching within 14 days) and advance next_billing_date
  const { data: visitorSubs } = await supabase.from("parking_subscriptions")
    .select("id,contract_id,billing_frequency,next_billing_date,visitor_discount_pct,tenant_id,tenants(name)")
    .eq("subscription_type", "visitor")
    .eq("status", "active");

  for (const ps of visitorSubs ?? []) {
    if (!ps.next_billing_date) continue;
    const dueMs = new Date(ps.next_billing_date).getTime();
    const daysToDue = Math.ceil((dueMs - Date.now()) / 86400000);

    // Reminder alert 14 days before
    if (daysToDue <= 14 && daysToDue >= 0) {
      const { data: existing } = await supabase.from("alerts")
        .select("id")
        .eq("entity_id", ps.id)
        .eq("alert_type", "visitor_parking_billing")
        .gte("due_date", ps.next_billing_date)
        .limit(1);
      if (!existing || existing.length === 0) {
        await supabase.from("alerts").insert({
          title: `חיוב חניות אורחים — ${(ps as any).tenants?.name || ""}`,
          message: `הגיע מועד הוצאת חיוב על שימוש בחניות אורחים מזדמנים (${ps.visitor_discount_pct || 0}% הנחה). יש לאסוף נתוני שימוש בפועל ולהוציא חיוב.${ps.billing_frequency === "with_cpi" ? " ניתן להוציא יחד עם הפרשי ההצמדה." : ""}`,
          alert_type: "visitor_parking_billing",
          severity: daysToDue <= 3 ? "high" : "medium",
          entity_type: "parking_subscription",
          entity_id: ps.id,
          contract_id: ps.contract_id,
          due_date: ps.next_billing_date,
        });
        updated++;
      }
    }

    // After due date passed → advance next_billing_date
    if (daysToDue < 0) {
      const next = new Date(ps.next_billing_date);
      if (ps.billing_frequency === "monthly") next.setMonth(next.getMonth() + 1);
      else if (ps.billing_frequency === "quarterly") next.setMonth(next.getMonth() + 3);
      else if (ps.billing_frequency === "semi_annual") next.setMonth(next.getMonth() + 6);
      else next.setFullYear(next.getFullYear() + 1);
      await supabase.from("parking_subscriptions").update({
        last_billed_date: ps.next_billing_date,
        next_billing_date: next.toISOString().split("T")[0],
      }).eq("id", ps.id);
    }
  }

  // ── Update contract statuses ──
  // Categories:
  // - upcoming: start_date in future
  // - active: today is between start and end (no "expiring" sub-status)
  // - ended: today after end_date
  // (extended/expiring legacy values are normalized to active or ended)
  const { data: contracts } = await supabase.from("contracts")
    .select("id,status,start_date,end_date")
    .in("status",["upcoming","active","expiring","extended","ended"]);
  for (const c of contracts??[]) {
    const days = c.end_date ? Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000) : 999;
    let newStatus = c.status;
    if (c.start_date && c.start_date > today) newStatus = "upcoming";
    else if (c.end_date && days <= 0) newStatus = "ended";
    else newStatus = "active";

    if (newStatus !== c.status) {
      await supabase.from("contracts").update({status:newStatus}).eq("id",c.id);
      await logAudit({entity_type:"contract",entity_id:c.id,action:"status_change",notes:`${c.status} → ${newStatus}`});
      updated++;
    }
  }
  return updated;
}
