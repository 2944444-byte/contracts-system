// Shared alert-sync logic. Scans the data for upcoming/overdue items and
// inserts alert rows (deduped against existing open alerts). Used by the
// manual POST /api/alerts/sync and the daily cron /api/cron/sync-contracts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mgmtProtectionFromRow, protectionEndDate, describeMgmtProtection } from "@/lib/mgmt-protection";
import { reconcileAlerts } from "@/lib/alerts-reconcile";
import { representativeGuaranteeIds } from "@/lib/guarantee-dedupe";
import { contractExpiryVerdict, contractExpiryTitle } from "@/lib/contract-expiry";

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

export async function runAlertSync(supabase: SupabaseClient): Promise<{ created: number; resolved: number; newAlerts: NewAlert[] }> {
  let created = 0;
  const newAlerts: NewAlert[] = [];

  // Close first, then create. A sync that only ever added rows left every
  // fixed item on the screen — a paid debt, a renewed guarantee, a certificate
  // that finally arrived. Closing first also frees the dedupe key, so an item
  // that lapsed again gets a fresh, correctly-worded alert.
  const { resolved } = await reconcileAlerts(supabase);

  // Dedupe against UNRESOLVED alerts via is_resolved — the column that actually
  // exists (there is no `status` column on alerts; the old check silently
  // errored → always false → every sync re-created everything = duplicates).
  async function hasOpen(entityId: string, entityType: string): Promise<boolean> {
    const { data } = await supabase.from("alerts").select("id").eq("entity_id", entityId).eq("entity_type", entityType).eq("is_resolved", false).limit(1);
    return !!(data && data.length);
  }
  async function add(a: any) {
    const { error } = await supabase.from("alerts").insert({ ...a, status: undefined, is_resolved: false });
    if (error) return; // don't count failed inserts
    created++;
    newAlerts.push({ title: a.title, severity: a.severity, entity_type: a.entity_type, due_date: a.due_date });
  }

  // 0. Management-fee protection about to end — the manager has to run the
  //    closing reconciliation against the property's actual cost and refund any
  //    overpayment, so this needs to surface BEFORE the period lapses.
  {
    const { data: protectedContracts } = await supabase.from("contracts")
      .select("id,property_id,tenant_id,start_date,tenants(name),properties(name),mgmt_protection_type,mgmt_protection_value,mgmt_protection_months,mgmt_protection_indexed,mgmt_protection_reconciled_at")
      .in("status", ["active", "expiring", "extended"])
      .neq("mgmt_protection_type", "none");
    for (const c of (protectedContracts ?? []) as any[]) {
      if (c.mgmt_protection_reconciled_at) continue;   // already settled
      const prot = mgmtProtectionFromRow(c);
      const end = protectionEndDate(c, prot);
      if (!end) continue;
      const days = daysUntil(end.toISOString().slice(0, 10));
      if (days > 90 || days < -365) continue;          // window: 3 months before → a year after
      if (await hasOpen(c.id, "mgmt_protection")) continue;
      const label = (c.tenants?.name ?? "") + " — " + (c.properties?.name ?? "");
      await add({
        title: (days >= 0 ? "תום הגנת דמי ניהול בעוד " + days + " ימים: " : "הגנת דמי ניהול הסתיימה: ") + label,
        message: describeMgmtProtection(prot, c) + " · יש לבצע התחשבנות מול העלות בפועל ולהחזיר תשלום עודף לשוכר.",
        severity: days <= 30 ? "warning" : "info",
        alert_type: "mgmt_protection_end",
        entity_type: "mgmt_protection", entity_id: c.id,
        contract_id: c.id, property_id: c.property_id ?? null, tenant_id: c.tenant_id ?? null,
        due_date: end.toISOString().slice(0, 10),
      });
    }
  }

  // 1. Contracts expiring + options
  const { data: contracts } = await supabase.from("contracts")
    .select("id,property_id,end_date,is_amendment,parent_contract_id,tenant_id,tenants(name),properties(name),contract_options(id,status,is_exercised,start_date,end_date,notice_days_before_end,notice_type,option_number)")
    .in("status", ["active", "expiring", "extended"]);
  // A contract and its amendments are ONE tenancy: they share an end date and
  // between them hold the options. Alerting per row put the same expiry on the
  // screen three times for a tenant with two amendments, so the family is
  // resolved first and only the base row carries the alert — with the family's
  // latest end date and the options pooled from every row.
  const famEnd: Record<string, string> = {};
  const famOptions: Record<string, any[]> = {};
  for (const c of (contracts ?? []) as any[]) {
    const fam = c.parent_contract_id || c.id;
    if (c.end_date && (!famEnd[fam] || String(c.end_date) > famEnd[fam])) famEnd[fam] = String(c.end_date).slice(0, 10);
    famOptions[fam] = (famOptions[fam] || []).concat(c.contract_options ?? []);
  }

  for (const c of (contracts ?? []) as any[]) {
    // Contract end. With a live option this is a short heads-up; with no option
    // left the end date IS the vacating date and needs a year's runway. One
    // alert either way, updated in place so the countdown stays true.
    if (!c.is_amendment) {
      const fam = c.id;
      const v = contractExpiryVerdict({ contract: { end_date: famEnd[fam] || c.end_date }, options: famOptions[fam] ?? [] });
      if (v.applies) {
        const label = (c.tenants?.name ?? "") + " — " + (c.properties?.name ?? "");
        const title = contractExpiryTitle(v, label);
        const alertType = v.vacating ? "contract_vacating" : "contract_expiring";
        const { data: exist } = await supabase.from("alerts")
          .select("id,severity").eq("entity_id", c.id).eq("entity_type", "contract")
          .in("alert_type", ["contract_vacating", "contract_expiring"])
          .eq("is_resolved", false).limit(1);
        if (exist && exist.length) {
          const prev = exist[0] as any;
          const patch: any = { title, severity: v.severity, due_date: famEnd[fam] || c.end_date, alert_type: alertType };
          if (prev.severity !== v.severity) patch.read_at = null;   // escalated → unread again
          await supabase.from("alerts").update(patch).eq("id", prev.id);
        } else if (!(await hasOpen(c.id, "contract"))) {
          await add({ title, severity: v.severity, alert_type: alertType, entity_type: "contract", entity_id: c.id, property_id: c.property_id ?? null, due_date: famEnd[fam] || c.end_date, status: "open" });
        }
      }
    }
    // ── Option notice alerts — TWO mechanisms (per the owner's spec) ──
    // Type 1 `exercise`:    the tenant must give an EXERCISE notice; the manager
    //                       marks it when received. No notice by the deadline →
    //                       an alert says so and the manager marks non-exercise.
    //                       Nothing happens automatically.
    // Type 2 `non_renewal`/`auto`: the tenant must give a NON-exercise notice;
    //                       if none is marked by the deadline → the option
    //                       AUTO-exercises (contract extends) and alerts close.
    // One alert per option, UPDATED IN PLACE on each sync (countdown "בעוד XX
    // ימים" refreshes; severity escalates warning→urgent at 30 days) — not a
    // new alert per stage. Deadline = option START (= current contract end)
    // minus notice_days (e.g. מעודה: 1.9.2027 − 365 → 1.9.2026).
    for (const opt of (c.contract_options ?? []) as any[]) {
      if (opt.status !== "pending" || opt.is_exercised) continue;
      const nd = opt.notice_days_before_end ?? 90;
      const baseDate = opt.start_date || c.end_date;
      if (!baseDate) continue;
      const deadline = new Date(baseDate);
      deadline.setDate(deadline.getDate() - nd);
      const deadlineStr = deadline.toISOString().split("T")[0];
      const dd = daysUntil(deadlineStr);
      if (dd > 90) continue; // start alerting ~90 days before the notice deadline
      const label = (c.tenants?.name ?? "") + " — " + (c.properties?.name ?? "");
      const deadlineHe = deadline.toLocaleDateString("he-IL");
      const optNo = opt.option_number ?? "";
      const isType2 = opt.notice_type === "non_renewal" || opt.notice_type === "auto";

      // Deadline PASSED, Type 2 → auto-exercise: extend the contract to the
      // option end, close the option's alerts, leave an info alert. Idempotent
      // (status flips to exercised, so the next run skips it).
      if (dd < 0 && isType2) {
        if (opt.end_date) {
          await supabase.from("contract_options").update({ is_exercised: true, status: "exercised" }).eq("id", opt.id);
          await supabase.from("contracts").update({ end_date: opt.end_date, status: "extended" }).eq("id", c.id);
          await supabase.from("alerts").update({ is_resolved: true, handled_at: new Date().toISOString() }).eq("entity_id", opt.id).eq("is_resolved", false);
          await add({
            title: `אופציה ${optNo} מומשה אוטומטית: ${label}`,
            message: `לא סומנה הודעת אי-מימוש עד ${deadlineHe} — האופציה מומשה אוטומטית והחוזה הוארך עד ${new Date(opt.end_date).toLocaleDateString("he-IL")}.`,
            alert_type: "option_auto_exercised", severity: "info",
            entity_type: "option", entity_id: opt.id, contract_id: c.id,
            property_id: c.property_id ?? null, due_date: opt.end_date,
          });
        }
        continue;
      }

      let title: string, message: string, severity: string;
      if (dd < 0) {
        // Deadline passed, Type 1 → no exercise notice received; the manager
        // must mark non-exercise (or a late exercise) from the alert.
        severity = "urgent";
        title = `לא התקבלה הודעת מימוש — אופציה ${optNo}: ${label}`;
        message = `המועד האחרון להודעת מימוש (${deadlineHe}) חלף ללא הודעה מהדייר. יש לסמן אי-מימוש (✗), או מימוש (✓) אם התקבלה הודעה באיחור.`;
      } else if (isType2) {
        severity = dd <= 30 ? "urgent" : "warning";
        title = `בעוד ${dd} ימים — מועד אחרון להודעת אי-מימוש אופציה ${optNo}: ${label}`;
        message = `הדייר רשאי למסור הודעת אי-מימוש עד ${deadlineHe}. אם לא תסומן הודעת אי-מימוש — האופציה תמומש אוטומטית והחוזה יוארך עד ${opt.end_date ? new Date(opt.end_date).toLocaleDateString("he-IL") : ""}.`;
      } else {
        severity = dd <= 30 ? "urgent" : "warning";
        title = `בעוד ${dd} ימים — מועד אחרון להודעת מימוש אופציה ${optNo}: ${label}`;
        message = `על הדייר למסור הודעת מימוש עד ${deadlineHe}. ניתן לסמן מימוש (✓) בכל עת — וההתראות ייפסקו.`;
      }
      const alertType = isType2 ? "option_nonexercise_notice" : "option_exercise_notice";

      // Update-in-place when an open alert exists for this option (refreshes
      // the countdown + severity); insert only the first time. When the STAGE
      // escalates (warning→urgent at 30 days, or →overdue), read_at resets to
      // NULL so the alert pops as UNREAD again — instead of a duplicate alert.
      const newStage = dd < 0 ? "overdue" : dd <= 30 ? "urgent" : "warning";
      const { data: existing } = await supabase.from("alerts").select("id,severity,title").eq("entity_id", opt.id).eq("entity_type", "option").eq("is_resolved", false).limit(1);
      if (existing && existing.length) {
        const prev = existing[0] as any;
        const prevStage = (prev.title || "").indexOf("לא התקבלה") === 0 ? "overdue" : (prev.severity === "urgent" ? "urgent" : "warning");
        const patch: any = { title, message, severity, due_date: deadlineStr, alert_type: alertType };
        if (prevStage !== newStage) patch.read_at = null; // escalated → unread again
        await supabase.from("alerts").update(patch).eq("id", prev.id);
      } else {
        await add({ title, message, severity, alert_type: alertType, entity_type: "option", entity_id: opt.id, contract_id: c.id, property_id: c.property_id ?? null, due_date: deadlineStr });
      }
    }
  }

  // 2. Guarantees — expiring soon AND already expired-but-not-renewed (the
  //    old `days < 0 → skip` silently dropped exactly the case that matters
  //    most: a guarantee that lapsed and was never renewed).
  const { data: guarantees } = await supabase.from("guarantees").select("id,end_date,contract_id,guarantee_type,amount_actual,amount_required,created_at,contracts(property_id,parent_contract_id,tenants(name))").eq("status", "active");
  // The same guarantee is usually recorded on the contract AND on its amendment;
  // alert once for the instrument, not once per row.
  const gReps = representativeGuaranteeIds((guarantees ?? []) as any[]);
  for (const g of (guarantees ?? []) as any[]) {
    if (!g.end_date) continue;
    if (!gReps.has(g.id)) continue;
    const days = daysUntil(g.end_date);
    if (days > 60) continue;
    if (await hasOpen(g.id, "guarantee")) continue;
    const gName = g.contracts?.tenants?.name ?? "";
    const title = days < 0
      ? `ערבות פגה ולא חודשה (${Math.abs(days)} ימים): ${gName}`
      : `ערבות פגה בעוד ${days} ימים: ${gName}`;
    await add({ title, severity: days <= 30 ? "urgent" : "warning", entity_type: "guarantee", entity_id: g.id, contract_id: g.contract_id ?? null, property_id: g.contracts?.property_id ?? null, due_date: g.end_date });
  }

  // 3. Insurances — expiring soon AND already expired-but-not-renewed.
  for (const table of ["insurances_building", "insurances_tenant"]) {
    const { data: ins } = await supabase.from(table).select("id,property_id,end_date" + (table === "insurances_tenant" ? ",contract_id" : "")).eq("status", "active");
    for (const x of (ins ?? []) as any[]) {
      if (!x.end_date) continue;
      const days = daysUntil(x.end_date);
      if (days > 60) continue;
      if (await hasOpen(x.id, "insurance")) continue;
      const kind = table === "insurances_tenant" ? "אישור ביטוח שוכר" : "ביטוח מבנה";
      const title = days < 0
        ? `${kind} פג ולא חודש (${Math.abs(days)} ימים)`
        : `${kind} פג בעוד ${days} ימים`;
      await add({ title, severity: days <= 30 ? "urgent" : "warning", entity_type: "insurance", entity_id: x.id, contract_id: x.contract_id ?? null, property_id: x.property_id ?? null, due_date: x.end_date });
    }
  }

  // 3b. Active contracts with NO in-force tenant-insurance certificate AT ALL —
  //     different from an expiring one: the tenant never delivered (or it lapsed
  //     long ago). One alert per contract; contracts that are amendments are in
  //     `contracts` too and get covered via their own insurances if linked.
  const todayStr = new Date().toISOString().split("T")[0];
  {
    const { data: tenantIns } = await supabase.from("insurances_tenant").select("contract_id,end_date,status");
    // Insurance coverage is evaluated per (TENANT + PROPERTY). A base contract and
    // its amendments (תוספות) are the same tenant on the same property and share
    // ONE certificate — but parent_contract_id is unreliable in the data (some
    // amendments have it NULL), so we group by tenant+property instead. A group is
    // covered if ANY of its contracts has active insurance; we emit ONE alert per
    // uncovered group. This stops amendments being falsely flagged and stops the
    // duplicate alerts per tenant.
    const groupKey = function (c: any) { return (c.tenant_id || "?") + "|" + (c.property_id || "?"); };
    const contractById: Record<string, any> = {};
    (contracts ?? []).forEach(function (c: any) { contractById[c.id] = c; });
    const coveredGroups = new Set(
      (tenantIns ?? [])
        .filter(function (x: any) { return x.contract_id && x.status === "active" && x.end_date && x.end_date >= todayStr; })
        .map(function (x: any) { const c = contractById[x.contract_id]; return c ? groupKey(c) : null; })
        .filter(Boolean) as string[]
    );
    const groups: Record<string, any[]> = {};
    (contracts ?? []).forEach(function (c: any) { const k = groupKey(c); (groups[k] = groups[k] || []).push(c); });
    for (const key of Object.keys(groups)) {
      if (coveredGroups.has(key)) continue;
      const g = groups[key];
      const rep = g.find(function (c: any) { return !c.is_amendment; }) || g[0];
      if (await hasOpen(rep.id, "insurance")) continue;
      const cName = (rep.tenants?.name ?? "") + (rep.properties?.name ? " — " + rep.properties.name : "");
      await add({
        title: `אין אישור ביטוח בתוקף: ${cName}`,
        message: "לחוזה פעיל זה לא רשומה אף תעודת ביטוח שוכר בתוקף. יש לדרוש מהשוכר אישור ביטוח (ראה מסך ביטוחים — מנוע התאימות).",
        alert_type: "insurance_missing", severity: "urgent",
        entity_type: "insurance", entity_id: rep.id, contract_id: rep.id,
        property_id: rep.property_id ?? null, due_date: todayStr,
      });
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

  // 5. Charges in arrears — any unpaid charge past its due date (rent, CPI diff,
  //    mgmt, insurance, waste…). ONE alert per contract (count + total), so the
  //    screen shows "שכ\"ד בפיגור" per tenant without flooding a row per charge.
  const { data: overdue } = await supabase.from("charges")
    .select("id,contract_id,total_amount,due_date,charge_type,contracts!charges_contract_id_fkey(property_id,tenants(name))")
    .neq("status", "paid")
    .not("due_date", "is", null)
    .lt("due_date", todayStr);
  const byContractArrears: Record<string, { tenant: string; propertyId: string | null; count: number; sum: number; oldest: string }> = {};
  for (const ch of (overdue ?? []) as any[]) {
    if (!ch.contract_id) continue;
    const cur = byContractArrears[ch.contract_id] || { tenant: ch.contracts?.tenants?.name ?? "", propertyId: ch.contracts?.property_id ?? null, count: 0, sum: 0, oldest: ch.due_date };
    cur.count++;
    cur.sum += Number(ch.total_amount) || 0;
    if (ch.due_date < cur.oldest) cur.oldest = ch.due_date;
    byContractArrears[ch.contract_id] = cur;
  }
  for (const cid of Object.keys(byContractArrears)) {
    const ar = byContractArrears[cid];
    if (await hasOpen(cid, "arrears")) continue;
    await add({
      title: `חיובים בפיגור: ${ar.tenant} — ${ar.count} חיובים בסך ₪${Math.round(ar.sum).toLocaleString("he-IL")}`,
      severity: "urgent", entity_type: "arrears", entity_id: cid,
      contract_id: cid, property_id: ar.propertyId, due_date: ar.oldest,
    });
  }

  return { created, resolved, newAlerts };
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
