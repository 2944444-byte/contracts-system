// A contract's end date means two very different things.
//
// While an option is still live, the end date is provisional — the tenant may
// yet exercise and the term simply continues. The thing that needs watching is
// the NOTICE deadline, which the option rules own; the contract end itself only
// needs a short heads-up.
//
// Once no option remains — none was written, or the last one was declined or
// has expired — the end date IS the vacating date. That needs a long runway:
// re-letting, fit-out, handover inspection and the deposit/guarantee release all
// have to happen around it, and none of them can be arranged in a month.
//
// Both the rule that raises these alerts and the pass that closes them read this
// one function, so the two can't drift apart.

export const VACATING_WINDOW_DAYS = 365;   // no option left → the tenant is heading out
export const EXPIRY_WINDOW_DAYS = 90;      // an option is still live → short heads-up

export function daysUntilDate(dateStr: string, today?: Date): number {
  const d = new Date(dateStr);
  const t = today ? new Date(today) : new Date();
  t.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

// An option that could still extend the term: not exercised, not declined,
// not expired.
export function hasLiveOption(options: any[] | null | undefined): boolean {
  for (const o of (options || [])) {
    if (!o || o.is_exercised) continue;
    if (["exercised", "declined", "expired"].indexOf(o.status) !== -1) continue;
    return true;
  }
  return false;
}

export type ExpiryVerdict = {
  applies: boolean;
  days: number;
  vacating: boolean;
  severity: "info" | "warning" | "urgent";
};

export function contractExpiryVerdict(params: {
  contract: any;
  options?: any[];
  today?: Date;
}): ExpiryVerdict {
  const end = params.contract?.end_date;
  const none: ExpiryVerdict = { applies: false, days: 0, vacating: false, severity: "info" };
  if (!end) return none;

  const days = daysUntilDate(String(end).slice(0, 10), params.today);
  if (days < 0) return none;                       // already ended — other rules own it

  const vacating = !hasLiveOption(params.options);
  const window = vacating ? VACATING_WINDOW_DAYS : EXPIRY_WINDOW_DAYS;
  if (days > window) return none;

  // A year out is a planning item, not an emergency; the last quarter is.
  const severity: "info" | "warning" | "urgent" = vacating
    ? (days <= 90 ? "urgent" : days <= 180 ? "warning" : "info")
    : (days <= 30 ? "urgent" : days <= 60 ? "warning" : "info");

  return { applies: true, days, vacating, severity };
}

export function contractExpiryTitle(v: ExpiryVerdict, label: string): string {
  return v.vacating
    ? `צפוי פינוי בעוד ${v.days} ימים (אין אופציה נוספת): ${label}`
    : `חוזה פוגה ב-${v.days} ימים: ${label}`;
}
