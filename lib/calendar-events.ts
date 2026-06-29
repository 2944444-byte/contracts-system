// ─────────────────────────────────────────────────────────────────────────────
// Shared calendar-event derivation. Used by BOTH the /calendar screen (client,
// browser supabase + session scope) and the ICS subscription feed (server,
// admin client + per-user scope). The screen and the route each fetch their own
// (already-scoped) rows and call deriveEvents() — so the event logic lives once.
// ─────────────────────────────────────────────────────────────────────────────

export type CalEvent = {
  date: string;          // YYYY-MM-DD (all-day)
  label: string;
  type: keyof typeof EVENT_TYPES;
  refId?: string;        // source record id (for dedup + deep links)
  contractId?: string;
  targetDate?: string;   // for "pre" reminders: the actual end/expiry date
};

// Single source of truth for every event kind: Hebrew label, calendar dot
// colour, chip classes, icon. Keeping this here means the legend, filters and
// ICS feed all stay in sync automatically.
export const EVENT_TYPES = {
  contract_end:    { label: "סיום חוזה",          dot: "bg-red-500",    chip: "bg-red-100 text-red-700 border-red-200",       icon: "📄" },
  contract_start:  { label: "תחילת חוזה",         dot: "bg-green-500",  chip: "bg-green-100 text-green-700 border-green-200", icon: "📄" },
  contract_pre6:   { label: "חוזה מסתיים בקרוב",  dot: "bg-amber-500",  chip: "bg-amber-100 text-amber-700 border-amber-200", icon: "⏳" },
  guarantee_end:   { label: "פקיעת ערבות",        dot: "bg-orange-500", chip: "bg-orange-100 text-orange-700 border-orange-200", icon: "🏦" },
  guarantee_pre30: { label: "ערבות פגה בקרוב",    dot: "bg-amber-500",  chip: "bg-amber-100 text-amber-700 border-amber-200", icon: "🏦" },
  insurance_end:   { label: "פקיעת ביטוח",        dot: "bg-purple-500", chip: "bg-purple-100 text-purple-700 border-purple-200", icon: "🛡️" },
  insurance_pre30: { label: "ביטוח פג בקרוב",     dot: "bg-amber-500",  chip: "bg-amber-100 text-amber-700 border-amber-200", icon: "🛡️" },
  safety_due:      { label: "בדיקת בטיחות",       dot: "bg-teal-500",   chip: "bg-teal-100 text-teal-700 border-teal-200",   icon: "🔒" },
  option_notice:   { label: "מועד הודעת אופציה",  dot: "bg-blue-500",   chip: "bg-blue-100 text-blue-700 border-blue-200",   icon: "🔁" },
  alert:           { label: "התראה",              dot: "bg-yellow-500", chip: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: "🔔" },
} as const;

export type CalEventType = keyof typeof EVENT_TYPES;

function dOnly(s: any): string { return s ? String(s).split("T")[0] : ""; }
function pad(n: number) { return String(n).padStart(2, "0"); }
function iso(d: Date) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
// Shift a YYYY-MM-DD string by days/months, returning YYYY-MM-DD.
function shift(s: string, days: number, months: number): string {
  var p = dOnly(s).split("-");
  if (p.length < 3) return "";
  return iso(new Date(Number(p[0]), Number(p[1]) - 1 + months, Number(p[2]) + days));
}
function inRange(d: string, from: string, to: string) { return !!d && d >= from && d <= to; }

export type RawCalData = {
  contracts?: any[];   // id, end_date, start_date, status, property_id, tenants(name)
  guarantees?: any[];  // id, end_date, contract_id, contracts(tenants(name))
  insT?: any[];        // id, end_date, contract_id, contracts(tenants(name))
  insB?: any[];        // id, end_date, property_id, properties(name)
  safety?: any[];      // id, next_inspection_date, inspection_type, property_id, properties(name)
  options?: any[];     // id, notice_deadline, status, contract_id, contracts(tenants(name))
  alerts?: any[];      // id, title, due_date, severity
};

// Build the full event list for a date window. Pre-event reminders (contract
// T-6mo, guarantee/insurance T-30d) are derived here so they exist even when no
// alert row was generated.
export function deriveEvents(data: RawCalData, from: string, to: string): CalEvent[] {
  var ev: CalEvent[] = [];
  var push = function(date: string, label: string, type: CalEventType, refId?: string, contractId?: string, targetDate?: string) {
    if (inRange(date, from, to)) ev.push({ date: date, label: label, type: type, refId: refId, contractId: contractId, targetDate: targetDate });
  };

  (data.contracts || []).forEach(function(c: any) {
    var name = c.tenants?.name || "";
    if (c.end_date) {
      push(dOnly(c.end_date), "סיום: " + name, "contract_end", c.id, c.id);
      push(shift(c.end_date, 0, -6), "מסתיים בעוד ~6 ח': " + name, "contract_pre6", c.id, c.id, dOnly(c.end_date));
    }
    if (c.start_date) push(dOnly(c.start_date), "תחילה: " + name, "contract_start", c.id, c.id);
  });

  (data.guarantees || []).forEach(function(g: any) {
    if (!g.end_date) return;
    var name = g.contracts?.tenants?.name || "";
    push(dOnly(g.end_date), "ערבות פגה: " + name, "guarantee_end", g.id, g.contract_id);
    push(shift(g.end_date, -30, 0), "ערבות פגה בעוד 30 יום: " + name, "guarantee_pre30", g.id, g.contract_id, dOnly(g.end_date));
  });

  (data.insT || []).forEach(function(i: any) {
    if (!i.end_date) return;
    var name = i.contracts?.tenants?.name || "";
    push(dOnly(i.end_date), "ביטוח שוכר פג: " + name, "insurance_end", i.id, i.contract_id);
    push(shift(i.end_date, -30, 0), "ביטוח שוכר פג בעוד 30 יום: " + name, "insurance_pre30", i.id, i.contract_id, dOnly(i.end_date));
  });

  (data.insB || []).forEach(function(i: any) {
    if (!i.end_date) return;
    var name = i.properties?.name || "";
    push(dOnly(i.end_date), "ביטוח מבנה פג: " + name, "insurance_end", i.id);
    push(shift(i.end_date, -30, 0), "ביטוח מבנה פג בעוד 30 יום: " + name, "insurance_pre30", i.id, undefined, dOnly(i.end_date));
  });

  (data.safety || []).forEach(function(s: any) {
    if (!s.next_inspection_date) return;
    var name = s.properties?.name || s.inspection_type || "";
    push(dOnly(s.next_inspection_date), "בדיקת בטיחות: " + name, "safety_due", s.id);
  });

  (data.options || []).forEach(function(o: any) {
    if (!o.notice_deadline) return;
    var name = o.contracts?.tenants?.name || "";
    push(dOnly(o.notice_deadline), "מועד הודעת אופציה: " + name, "option_notice", o.id, o.contract_id);
  });

  (data.alerts || []).forEach(function(a: any) {
    if (!a.due_date) return;
    push(dOnly(a.due_date), a.title || "התראה", "alert", a.id);
  });

  // Dedup identical (date+type+label) — alerts can echo a derived reminder.
  var seen: Record<string, boolean> = {};
  return ev.filter(function(e) {
    var k = e.date + "|" + e.type + "|" + e.label;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

// ── ICS (iCalendar) serialization for the subscription feed ──────────────────
function icsEscape(s: string) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function icsDate(s: string) { return dOnly(s).replace(/-/g, ""); }

// Build a VCALENDAR document. `stamp` is a fixed YYYYMMDDTHHMMSSZ DTSTAMP
// (passed in so the function stays pure / deterministic).
export function toICS(events: CalEvent[], calName: string, stamp: string): string {
  var lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PropManager//Calendar//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + icsEscape(calName),
    "X-WR-TIMEZONE:Asia/Jerusalem",
  ];
  events.forEach(function(e, idx) {
    var t = EVENT_TYPES[e.type];
    var d = icsDate(e.date);
    if (!d) return;
    // All-day event: DTEND is exclusive → next day.
    var endD = icsDate(shift(e.date, 1, 0));
    var uid = (e.type + "-" + (e.refId || idx) + "-" + d) + "@propmanager";
    lines.push(
      "BEGIN:VEVENT",
      "UID:" + uid,
      "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + d,
      "DTEND;VALUE=DATE:" + endD,
      "SUMMARY:" + icsEscape((t.icon ? t.icon + " " : "") + e.label),
      "DESCRIPTION:" + icsEscape(t.label + (e.targetDate ? " — בפועל: " + e.targetDate : "")),
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
