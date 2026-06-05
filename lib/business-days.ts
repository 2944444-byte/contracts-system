// Israeli business-day math. The Israeli work week is Sunday–Thursday;
// Friday and Saturday are the weekend. Major Jewish holidays (where offices are
// closed) are also skipped — maintained as a Gregorian-date list below.
//
// The holiday list is best-effort for the years we currently bill against and
// is easy to extend. Weekend handling (Fri/Sat) is always correct regardless of
// the holiday list, so a missing holiday only shifts a deadline by at most a day.

// ISO yyyy-mm-dd strings for Israeli public holidays (full-day office closures).
// Extend as needed for future years.
const ISRAELI_HOLIDAYS: Record<string, string> = {
  // ---- 2026 ----
  "2026-03-03": "פורים",
  "2026-04-02": "פסח א'",
  "2026-04-08": "שביעי של פסח",
  "2026-04-22": "יום העצמאות",
  "2026-05-22": "שבועות",
  "2026-09-12": "ראש השנה א'",
  "2026-09-13": "ראש השנה ב'",
  "2026-09-21": "יום כיפור",
  "2026-09-26": "סוכות א'",
  "2026-10-03": "שמחת תורה",
  // ---- 2027 ----
  "2027-03-23": "פורים",
  "2027-04-22": "פסח א'",
  "2027-04-28": "שביעי של פסח",
  "2027-05-12": "יום העצמאות",
  "2027-06-11": "שבועות",
  "2027-10-02": "ראש השנה א'",
  "2027-10-03": "ראש השנה ב'",
  "2027-10-11": "יום כיפור",
  "2027-10-16": "סוכות א'",
  "2027-10-23": "שמחת תורה",
};

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

// Sunday=0 … Saturday=6. Friday(5) and Saturday(6) are weekend in Israel.
export function isIsraeliBusinessDay(d: Date): boolean {
  const dow = d.getDay();
  if (dow === 5 || dow === 6) return false;
  if (ISRAELI_HOLIDAYS[isoOf(d)]) return false;
  return true;
}

// Add N business days to a date (skipping weekends + holidays). N must be >= 0.
export function addBusinessDays(from: Date | string, n: number): Date {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0); // avoid DST edge cases
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (isIsraeliBusinessDay(d)) added++;
  }
  return d;
}

// Convenience: deadline = `n` business days after a guarantee's end date,
// returned as a he-IL formatted string (e.g. "5.7.2026").
export function businessDeadline(from: Date | string, n: number): { date: Date; label: string } {
  const date = addBusinessDays(from, n);
  return { date: date, label: date.toLocaleDateString("he-IL") };
}
