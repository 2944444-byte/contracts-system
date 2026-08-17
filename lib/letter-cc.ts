// מכותבים פנימיים לפי נושא: אנשי הקשר של הארגון (org_contacts) מסומנים
// לאילו נושאים הם מנויים — וכשמכתב נשלח לשוכר, מי שמנוי על נושא המכתב
// (או על "כל ההתכתבויות") מקבל עותק ב-CC, בדיוק כמו כתובת המייל של השוכר.

export const CC_TOPICS = [
  { v: "finance",   l: "גבייה וכספים",     icon: "💰", desc: "מקדמות, הצמדה, דמי ניהול, חיובים, ערבויות, אשפה" },
  { v: "insurance", l: "ביטוח",            icon: "🛡️", desc: "מכתבי אישורי ביטוח וחיובי ביטוח" },
  { v: "safety",    l: "בטיחות",           icon: "🔒", desc: "מכתבי בדיקות ואישורי בטיחות" },
  { v: "all",       l: "כל ההתכתבויות",    icon: "📧", desc: "עותק לכל מכתב שנשלח, מכל סוג" },
];

// נושא המכתב — נגזר מהשדות המובנים (billing_type / letter_type) עם רשת
// ביטחון טקסטואלית לכותרת. ברירת מחדל "general": רק מנויי "הכל" מכותבים.
export function topicForLetter(l: any): string {
  var bt = String(l?.billing_type || "").toLowerCase();
  var lt = String(l?.letter_type || "").toLowerCase();
  var title = String(l?.title || l?.subject || "");
  if (bt === "insurance" || lt.indexOf("insurance") !== -1 || title.indexOf("ביטוח") !== -1) return "insurance";
  if (bt === "safety" || lt.indexOf("safety") !== -1 || title.indexOf("בטיחות") !== -1) return "safety";
  if (bt) return "finance"; // advances / cpi_diff / management / waste — כספים
  if (title.indexOf("ערבות") !== -1 || title.indexOf("חוב") !== -1 || title.indexOf("תשלום") !== -1 || title.indexOf("גביי") !== -1) return "finance";
  return "general";
}

// כתובות ה-CC מתוך אנשי הקשר: איש קשר ברמת נכס תופס לנכס שלו; ברמת חברה —
// לכל נכסי החברה. מנוי "all" מכותב תמיד; אחרת רק בהתאמת נושא.
export function orgCcFor(params: {
  contacts: any[];
  propertyIds: string[];
  companyIds: string[];
  topic: string;
}): string[] {
  var out: string[] = [];
  (params.contacts || []).forEach(function (c) {
    if (!c || c.is_active === false || !c.email) return;
    var inScope = (c.property_id && params.propertyIds.indexOf(c.property_id) !== -1)
      || (!c.property_id && c.company_id && params.companyIds.indexOf(c.company_id) !== -1);
    if (!inScope) return;
    var topics: string[] = Array.isArray(c.topics) ? c.topics : [];
    var subscribed = topics.indexOf("all") !== -1
      || (params.topic !== "general" && topics.indexOf(params.topic) !== -1);
    if (!subscribed) return;
    var em = String(c.email).trim();
    if (em && out.indexOf(em) === -1) out.push(em);
  });
  return out;
}
