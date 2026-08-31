// אנשי הקשר של השוכר — מאוחסנים כמערך JSONB על tenants.contacts, עם מינויי
// נושאים כמו אצל המכותבים הפנימיים של החברה: כל איש קשר מסומן לאילו נושאי
// התכתבות הוא שייך, ומכתב מנותב לאנשי הקשר שנושאם תואם (או "כל ההתכתבויות").
export const TENANT_TOPICS = [
  { key: "finance",    label: "כספים",             icon: "💰" },
  { key: "insurance",  label: "ביטוחים",           icon: "🛡️" },
  { key: "safety",     label: "אישור אש / בטיחות", icon: "🔥" },
  { key: "guarantees", label: "ערבויות",           icon: "🏦" },
  { key: "management", label: "חברת ניהול",        icon: "🏢" },
  { key: "all",        label: "כל ההתכתבויות",     icon: "📨" },
];

export function topicLabel(key: string): string {
  const t = TENANT_TOPICS.find(function (x) { return x.key === key; });
  return t ? t.icon + " " + t.label : key;
}

// האם איש קשר מנוי על תחום מכתב. התחומים שמסך המכתבים מנתב אליהם:
// money / insurance / safety / certificate (ביטוח+אש יחד) / guarantee /
// general. כשמוגדרים לאיש הקשר נושאים (topics) — הם מקור האמת היחיד;
// מערך domains הישן נבחן רק אצל איש קשר legacy שאין לו נושאים כלל,
// אחרת שיוך ישן ("certificate") היה גובר על נושאים שסומנו ידנית.
export function contactMatchesDomain(c: any, dom: string): boolean {
  const topics: string[] = Array.isArray(c?.topics) ? c.topics : [];
  const domains: string[] = Array.isArray(c?.domains) ? c.domains : [];
  if (topics.length > 0) {
    if (topics.indexOf("all") !== -1) return true;
    if (dom === "money") return topics.indexOf("finance") !== -1;
    // ניתוב עדין: מכתב ביטוח → מנויי "ביטוחים"; מכתב אש/בטיחות → "אישור אש"
    if (dom === "insurance") return topics.indexOf("insurance") !== -1;
    if (dom === "safety") return topics.indexOf("safety") !== -1;
    if (dom === "certificate") return topics.indexOf("insurance") !== -1 || topics.indexOf("safety") !== -1;
    if (dom === "guarantee") return topics.indexOf("guarantees") !== -1;
    return false; // כולל general — נושא ספציפי אינו "כל ההתכתבויות"
  }
  // legacy: איש קשר ישן עם domains בלבד
  if (dom === "insurance" || dom === "safety") return domains.indexOf("certificate") !== -1;
  return domains.indexOf(dom) !== -1;
}
