import { supabase as browserClient } from "./supabase";
import { logAudit } from "./audit-log";

// סטטוסים חיים שמחזיקים יחידה: גם חוזה חתום שטרם החל תופס אותה.
const HOLDING_STATUSES = ["active", "extended", "expiring", "upcoming", "future"];

// שחרור היחידות של חוזה שהסתיים — אלא אם חוזה חי ממשפחה אחרת עדיין מחזיק
// בהן. המשפחה של החוזה עצמו (בסיס + תוספות) לעולם אינה חוסמת שחרור:
// התוספות הן צילומי-מצב של אותה שכירות שהסתיימה — למשל תוספת הארכה ישנה
// שסטטוסה עוד "active" אינה שכירות בפני עצמה. מיוצא כדי שתהליך סיום מוקדם
// ישחרר את היחידות מיד, בלי להמתין לסנכרון הלילי.
export async function freeContractSpaces(contractId: string, client?: any): Promise<number> {
  const supabase = client || browserClient;
  const { data: me } = await supabase.from("contracts")
    .select("id,parent_contract_id").eq("id", contractId).single();
  const familyId = (me as any)?.parent_contract_id || contractId;
  const { data: mySpaces } = await supabase.from("contract_spaces")
    .select("space_id").eq("contract_id", contractId);
  const sids = (mySpaces ?? []).map(function (x: any) { return x.space_id; }).filter(Boolean);
  if (sids.length === 0) return 0;
  const { data: holders } = await supabase.from("contract_spaces")
    .select("space_id, contracts!inner(id,status,parent_contract_id)")
    .in("space_id", sids)
    .in("contracts.status", HOLDING_STATUSES);
  const stillHeld = new Set((holders ?? []).filter(function (h: any) {
    const hc = h.contracts;
    return (hc?.parent_contract_id || hc?.id) !== familyId;
  }).map(function (h: any) { return h.space_id; }));
  const toFree = sids.filter(function (sid: string) { return !stillHeld.has(sid); });
  if (toFree.length > 0) {
    await supabase.from("spaces").update({ status: "vacant" })
      .in("id", toFree).eq("status", "occupied");
  }
  return toFree.length;
}

// Runs from two places: the contracts screen's "🔄 סנכרן סטטוסים" button (the
// browser client) and the nightly cron (service-role client). Until the cron
// was wired in, auto-exercising options and status transitions happened ONLY
// when somebody pressed the button.
export async function syncContractStatuses(client?: any): Promise<number> {
  const supabase = client || browserClient;
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
    // "declined" = the tenant DID give a non-exercise notice — must never
    // auto-exercise (set from the alerts screen's ✗ action or manually).
    .neq("status", "declined")
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

      // Close the option's open notice alerts — the question is settled.
      await supabase.from("alerts").update({ is_resolved: true, handled_at: new Date().toISOString() })
        .eq("entity_id", opt.id).eq("is_resolved", false);

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
    }
    // תזכורות מועד-הודעה נוצרות ומוסלמות אך ורק ב-lib/alerts-sync
    // (התראה אחת לאופציה שמתעדכנת במקום: אזהרה → דחוף → עבר המועד).
    // המחולל הישן כאן יצר התראה מקבילה שלא התעדכנה ולא נסגרה — הוסר.
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

      // A contract that just ENDED frees its units — unless another live
      // contract (including an early-terminated-and-replaced tenant's new
      // lease, or a signed future one) holds them. Without this the cached
      // spaces.status stayed "occupied" forever after both a natural end and
      // an agreed early termination, and the unit read as let with no tenant.
      if (newStatus === "ended") {
        await freeContractSpaces(c.id, supabase);
      }
    }
  }

  // ── Repair stale unit flags ──
  // spaces.status הוא דגל מטמון; תהליכים שמסיימים חוזה ישירות (סיום מוקדם)
  // השאירו אותו תקוע לנצח, כי השחרור למעלה רץ רק על מעבר שהסנכרון עצמו ביצע.
  // מתקנים בכל ריצה מול המצב האפקטיבי: לכל משפחת חוזים (בסיס + תוספות)
  // צילום-המצב האחרון שיש לו יחידות קובע מה מוחזק; משפחה בלי בסיס חי אינה
  // מחזיקה דבר (התוספות הן תיעוד של שכירות שהסתיימה). occupied שאיש אינו
  // מחזיק → vacant; vacant שמשפחה שכבר החלה מחזיקה → occupied. יחידה
  // שתוספת remove_units/swap שחררה אינה נתפסת מחדש (הצילום האחרון בלעדיה),
  // ו-maintenance הוא מצב ידני — לא נוגעים בו.
  const [{ data: allSpaces }, { data: liveFam }] = await Promise.all([
    supabase.from("spaces").select("id,status").in("status", ["occupied", "vacant"]),
    supabase.from("contracts")
      .select("id,status,start_date,is_amendment,parent_contract_id,amendment_number,amendment_date,contract_spaces(area_override,follows_contract_options,space_id)")
      .in("status", HOLDING_STATUSES),
  ]);
  const fams: Record<string, any[]> = {};
  for (const c of liveFam ?? []) {
    const fid = (c as any).parent_contract_id || (c as any).id;
    (fams[fid] = fams[fid] || []).push(c);
  }
  const heldAny = new Set<string>();
  const heldStarted = new Set<string>();
  Object.keys(fams).forEach(function (fid) {
    const snaps = fams[fid];
    const base = snaps.find(function (s: any) { return !s.is_amendment; });
    if (!base) return;
    // תוספות ותיקות נשמרו בלי יחידות משלהן — צילום ריק אינו משחרר כלום.
    const withSpaces = snaps.filter(function (s: any) { return (s.contract_spaces ?? []).length > 0; });
    if (withSpaces.length === 0) return;
    const rank = function (c: any): number {
      const dt = c.amendment_date || c.start_date;
      return (dt ? new Date(dt).getTime() : 0) * 1000 + (c.amendment_number || 0);
    };
    const latest = withSpaces.slice().sort(function (a: any, b: any) { return rank(a) - rank(b); })[withSpaces.length - 1];
    const started = base.status !== "upcoming" && base.status !== "future";
    (latest.contract_spaces ?? []).forEach(function (cs: any) {
      if (!cs.space_id) return;
      heldAny.add(cs.space_id);
      if (started) heldStarted.add(cs.space_id);
    });
  });
  const toVacant = (allSpaces ?? []).filter(function (s: any) { return s.status === "occupied" && !heldAny.has(s.id); }).map(function (s: any) { return s.id; });
  const toOccupied = (allSpaces ?? []).filter(function (s: any) { return s.status === "vacant" && heldStarted.has(s.id); }).map(function (s: any) { return s.id; });
  if (toVacant.length > 0) {
    await supabase.from("spaces").update({ status: "vacant" }).in("id", toVacant);
    updated += toVacant.length;
  }
  if (toOccupied.length > 0) {
    await supabase.from("spaces").update({ status: "occupied" }).in("id", toOccupied);
    updated += toOccupied.length;
  }
  return updated;
}
