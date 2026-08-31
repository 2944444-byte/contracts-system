// Israeli business-day math. The Israeli work week is Sunday–Thursday;
// Friday and Saturday are the weekend. Major Jewish holidays (full-day office
// closures) are also skipped.
//
// החגים מחושבים אלגוריתמית לכל שנה — אין רשימה ידנית ואין תלות ברשת.
// הלוח העברי דטרמיניסטי: ראש השנה נקבע מחישוב המולד + כללי הדחייה
// (האלגוריתם הקנוני מ-Calendrical Calculations), וכל שאר החגים במרחק
// ימים קבוע ממנו: יום כיפור = ר"ה+9, סוכות = ר"ה+14, שמחת תורה = ר"ה+21,
// פסח = ר"ה הבא −163 (חודשי ניסן–אלול קבועים באורכם), פורים = פסח−30,
// שביעי של פסח = פסח+6, שבועות = פסח+50, יום העצמאות = ה' אייר (פסח+20)
// עם הזזות החוק (שישי/שבת → חמישי, שני → שלישי).
// אומת מול לוח 2026–2027 (20 תאריכים) — התאמה מלאה.

// ── הלוח העברי: ימים שחלפו עד ר"ה של שנה עברית y (ימי-מולד + דחיית אד"ו) ──
function hebCalendarElapsedDays(y: number): number {
  const monthsElapsed = Math.floor((235 * y - 234) / 19);
  const partsElapsed = 12084 + 13753 * monthsElapsed;
  let days = monthsElapsed * 29 + Math.floor(partsElapsed / 25920);
  if ((3 * (days + 1)) % 7 < 3) days += 1;
  return days;
}
// דחיות גטר"ד ובטו"תקפט — מתוקנות דרך אורך השנה (356 → יומיים, 382 → יום)
function hebYearLengthCorrection(y: number): number {
  const ny0 = hebCalendarElapsedDays(y - 1);
  const ny1 = hebCalendarElapsedDays(y);
  const ny2 = hebCalendarElapsedDays(y + 1);
  if (ny2 - ny1 === 356) return 2;
  if (ny1 - ny0 === 382) return 1;
  return 0;
}
// ראש השנה של שנה עברית y כמספר-יום רץ (Rata Die; 1970-01-01 = 719163)
function hebNewYearRd(y: number): number {
  return -1373427 + hebCalendarElapsedDays(y) + hebYearLengthCorrection(y);
}
const RD_EPOCH_1970 = 719163;
function isoFromRd(rd: number): string {
  return new Date((rd - RD_EPOCH_1970) * 86400000).toISOString().slice(0, 10);
}

// חגי ישראל (סגירת משרדים מלאה) לשנה לועזית נתונה, מחושבים ונשמרים במטמון.
const holidayCache: Record<number, Record<string, string>> = {};
export function israeliHolidays(gregorianYear: number): Record<string, string> {
  if (holidayCache[gregorianYear]) return holidayCache[gregorianYear];
  const map: Record<string, string> = {};
  const rh = hebNewYearRd(gregorianYear + 3761);   // ר"ה שחל בסתיו של השנה הזו
  const pesach = rh - 163;                          // ט"ו בניסן, באביב של אותה שנה
  map[isoFromRd(pesach - 30)] = "פורים";
  map[isoFromRd(pesach)] = "פסח א'";
  map[isoFromRd(pesach + 6)] = "שביעי של פסח";
  // יום העצמאות: ה' אייר, מוזז — שישי/שבת מוקדם לחמישי, שני נדחה לשלישי
  let atz = pesach + 20;
  const w = ((atz % 7) + 7) % 7; // 0=ראשון ... 6=שבת
  if (w === 5) atz -= 1;
  else if (w === 6) atz -= 2;
  else if (w === 1) atz += 1;
  map[isoFromRd(atz)] = "יום העצמאות";
  map[isoFromRd(pesach + 50)] = "שבועות";
  map[isoFromRd(rh)] = "ראש השנה א'";
  map[isoFromRd(rh + 1)] = "ראש השנה ב'";
  map[isoFromRd(rh + 9)] = "יום כיפור";
  map[isoFromRd(rh + 14)] = "סוכות א'";
  map[isoFromRd(rh + 21)] = "שמחת תורה";
  holidayCache[gregorianYear] = map;
  return map;
}

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
  if (israeliHolidays(d.getFullYear())[isoOf(d)]) return false;
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

// Subtract N business days from a date (skipping weekends + holidays). N >= 0.
export function subtractBusinessDays(from: Date | string, n: number): Date {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0); // avoid DST edge cases
  let removed = 0;
  while (removed < n) {
    d.setDate(d.getDate() - 1);
    if (isIsraeliBusinessDay(d)) removed++;
  }
  return d;
}

// Convenience: deadline = `n` business days after a guarantee's end date,
// returned as a he-IL formatted string (e.g. "5.7.2026").
export function businessDeadline(from: Date | string, n: number): { date: Date; label: string } {
  const date = addBusinessDays(from, n);
  return { date: date, label: date.toLocaleDateString("he-IL") };
}
