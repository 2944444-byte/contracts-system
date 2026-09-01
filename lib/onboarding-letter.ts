// מכתב דרישות לשוכר בסיום הקמת הסכם ("מכתב פתיחה"): מה על השוכר להמציא
// מיד לאחר החתימה — שיקים מראש עד סוף השנה (למשלמים בשיקים), תשלום
// החודש הראשון במעמד החתימה, ערבות/פיקדון, אישור ביטוח, ופרטי העברה
// למשלמים בהעברה/הוראת קבע. אותו חישוב משמש גם ליצירת שורות המקדמות
// בפועל (advance_payments) — כך שהמכתב והמערכת לעולם לא סותרים זה את זה.

export interface OnboardingParams {
  tenantName: string;
  unitsLabel: string;            // "חנות 4" / "מחסן Z, nextcom"
  startDate: string;             // תחילת שכירות ISO
  paymentMethod: string;         // checks_advance / bank_transfer / standing_order / ...
  baseRent: number;              // שכ"ד חודשי לפני מע"מ (בסיס, ללא הצמדה)
  mgmtMonthly: number;           // מקדמת דמי ניהול חודשית לפני מע"מ
  vatPct: number;                // 0 לחוזה פטור
  prepaidFirstMonth: boolean;    // שולם חודש ראשון בחתימה
  prepaidRent: number;
  prepaidMgmt: number;
  guaranteeType?: string | null; // bank / cash / promissory_note...
  guaranteeAmount?: number;
  bankLine?: string | null;      // פרטי חשבון החברה (להעברה/ה"ק)
  companyName?: string;
  // תחילת השכירות תלויה באבן דרך (מסירה/פתיחה) שטרם קרתה בפועל:
  // לוח השיקים לא נקבע מראש — יומצא עם קביעת המועד בפועל.
  milestonePending?: boolean;
  milestoneLabel?: string;       // "מסירת החזקה" / "פתיחת המושכר"
}

export interface ChequeRow { year: number; month: number; label: string; amount: number; vat: number; total: number; prepaid: boolean; }

const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
function fmt(n: number): string { return "₪" + (Math.round(n * 100) / 100).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// לוח השיקים: מהחודש הראשון של השכירות ועד דצמבר של אותה שנה — ובחוזה
// חדש שמתחיל אחרי ספטמבר (אוקטובר ואילך), גם כל השנה העוקבת באותו
// מעמד, כדי לא לחזור אל השוכר אחרי חודשיים בשביל שיקים חדשים.
// החודש הראשון מסומן prepaid כששולם בחתימה — במכתב הוא מוצג כשולם,
// ובשורות המקדמות הוא נשמר בסטטוס paid (לא יידרש שוב).
export function chequeSchedule(p: OnboardingParams): ChequeRow[] {
  const start = new Date(String(p.startDate).slice(0, 10) + "T00:00:00");
  if (isNaN(start.getTime())) return [];
  const startYear = start.getFullYear();
  const months: { y: number; m: number }[] = [];
  for (let m = start.getMonth(); m <= 11; m++) months.push({ y: startYear, m: m });
  if (start.getMonth() >= 9) {
    for (let m = 0; m <= 11; m++) months.push({ y: startYear + 1, m: m });
  }
  return months.map(function (mm, i) {
    const first = i === 0;
    const rent = first && p.prepaidFirstMonth ? (p.prepaidRent || p.baseRent) : p.baseRent;
    const mgmt = first && p.prepaidFirstMonth ? (p.prepaidMgmt || p.mgmtMonthly) : p.mgmtMonthly;
    const beforeVat = rent + mgmt;
    const vat = beforeVat * (p.vatPct / 100);
    return {
      year: mm.y, month: mm.m + 1,
      label: HE_MONTHS[mm.m] + " " + mm.y,
      amount: beforeVat, vat: vat, total: beforeVat + vat,
      prepaid: first && p.prepaidFirstMonth,
    };
  });
}

// גוף מכתב הדרישות — פורמלי אך לא משפטני, נבנה סעיף-סעיף לפי מה שקיים.
export function buildOnboardingBody(p: OnboardingParams): { body: string; items: string[] } {
  const items: string[] = [];
  const isCheques = p.paymentMethod === "checks_advance";
  const isTransfer = p.paymentMethod === "bank_transfer" || p.paymentMethod === "standing_order";
  const sched = chequeSchedule(p);

  let body = "לכבוד\n" + (p.tenantName || "") + "\n\nשלום רב,\n\n";
  body += "הנדון: השלמת מסמכים ותשלומים בהתאם להסכם השכירות" + (p.unitsLabel ? " — " + p.unitsLabel : "") + "\n\n";
  body += "אנו שמחים על ההתקשרות עמכם. להשלמת ההסכם, נבקשכם להמציא לידינו את המפורט להלן:\n\n";
  let n = 1;

  if (p.prepaidFirstMonth) {
    const total = (p.prepaidRent + p.prepaidMgmt) * (1 + p.vatPct / 100);
    const line = "תשלום במעמד החתימה עבור החודש הראשון של תקופת השכירות: שכ\"ד " + fmt(p.prepaidRent) +
      (p.prepaidMgmt > 0 ? " + מקדמת דמי ניהול " + fmt(p.prepaidMgmt) : "") +
      (p.vatPct > 0 ? " בתוספת מע\"מ — סה\"כ " + fmt(total) : " — סה\"כ " + fmt(total)) +
      ". סכום זה קבוע ולא תחול עליו הצמדה.";
    body += n++ + ". " + line + "\n\n";
    items.push("💰 " + line);
  }

  if (isCheques && p.milestonePending) {
    // תחילה תלוית אבן-דרך שטרם קרתה: אין לוח חודשים לקבוע — השיקים
    // יומצאו כשהמועד ייקבע בפועל, והמערכת תרשום אותם אז.
    const line = "שיקים מראש לתשלומי שכ\"ד ודמי הניהול, עד תום שנת השכירות הראשונה, יומצאו עם קביעת מועד תחילת השכירות בפועל (" +
      (p.milestoneLabel || "מסירת החזקה") + ") — נודיעכם על הסכומים והמועדים המדויקים.";
    body += n++ + ". " + line + "\n\n";
    items.push("📝 " + line);
  } else if (isCheques && sched.length > 0) {
    const future = sched.filter(function (r) { return !r.prepaid; });
    if (future.length > 0) {
      const line = future.length + " שיקים מראש לחודשים " + future[0].label + " – " + future[future.length - 1].label +
        ", כל אחד על סך " + fmt(future[0].total) + (p.vatPct > 0 ? " (כולל מע\"מ)" : "") +
        ", לפקודת " + (p.companyName || "המשכירה") + ", זמן פירעון 1 לכל חודש.";
      body += n++ + ". " + line + "\n";
      body += future.map(function (r) { return "   • " + r.label + " — " + fmt(r.total); }).join("\n") + "\n";
      body += "   הסכומים לפי שכר הדירה הבסיסי; הפרשי הצמדה יחויבו בנפרד על פי ההסכם.\n\n";
      items.push("📝 " + line);
    }
  }

  if (isTransfer) {
    const line = "התשלום החודשי יבוצע ב" + (p.paymentMethod === "standing_order" ? "הוראת קבע" : "העברה בנקאית") +
      (p.bankLine ? " לחשבון: " + p.bankLine : "") +
      ". הודעת חיוב מפורטת תישלח מדי חודש לאחר פרסום המדד.";
    body += n++ + ". " + line + "\n\n";
    items.push("🏦 " + line);
  }

  if (p.guaranteeType && (p.guaranteeAmount || 0) > 0) {
    const gt = p.guaranteeType === "bank" ? "ערבות בנקאית אוטונומית"
      : p.guaranteeType === "cash" ? "פיקדון כספי"
      : p.guaranteeType === "promissory_note" ? "שטר חוב"
      : "בטוחה";
    const line = "המצאת " + gt + " על סך " + fmt(p.guaranteeAmount || 0) + " בהתאם להוראות ההסכם.";
    body += n++ + ". " + line + "\n\n";
    items.push("🏛 " + line);
  }

  const insLine = "המצאת אישור עריכת ביטוחים בתוקף, בהתאם לנספח הביטוח של ההסכם.";
  body += n++ + ". " + insLine + "\n\n";
  items.push("🛡 " + insLine);

  body += "נודה להמצאת המפורט לעיל בתוך 7 ימים ממועד החתימה.\n\n";
  body += "בכבוד רב ובברכה,\n\n" + (p.companyName || "הנהלת הנכס");
  return { body: body, items: items };
}
