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

// האם איש קשר מנוי על תחום מכתב (money/certificate/guarantee/general —
// התחומים שמסך המכתבים מנתב אליהם). תאימות לאחור למנגנון domains הישן.
export function contactMatchesDomain(c: any, dom: string): boolean {
  const topics: string[] = Array.isArray(c?.topics) ? c.topics : [];
  if (topics.indexOf("all") !== -1) return true;
  if (dom === "money" && topics.indexOf("finance") !== -1) return true;
  if (dom === "certificate" && (topics.indexOf("insurance") !== -1 || topics.indexOf("safety") !== -1)) return true;
  if (dom === "guarantee" && topics.indexOf("guarantees") !== -1) return true;
  const domains: string[] = Array.isArray(c?.domains) ? c.domains : [];
  return domains.indexOf(dom) !== -1;
}
