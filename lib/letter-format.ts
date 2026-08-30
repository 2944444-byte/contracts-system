import { supabase } from '@/lib/supabase';

// Company / property letterhead details, used to render the same professional
// header (logo + name + address/phone) and signature that the advances and
// CPI-diff letters already use. Keeps all auto-generated letters visually
// consistent.
export interface CompanyInfo {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  logoUrl: string;
  bankLine: string;
}

export async function loadCompanyInfo(propId: string): Promise<CompanyInfo> {
  const { data: propData } = await supabase
    .from("properties")
    .select("name, company_id, companies(company_name, address, city, phone, email, logo_url, bank_name, bank_branch, bank_account)")
    .eq("id", propId)
    .single();
  const company: any = (propData?.companies as any) || {};
  const companyName = company.company_name || propData?.name || "";
  const companyAddress = [company.address, company.city].filter(Boolean).join(", ");
  const companyPhone = company.phone || "";
  let bankLine = "";
  if (company.bank_name && company.bank_account) {
    bankLine =
      "את התשלום ניתן להעביר לפקודת " + companyName +
      ", חשבון " + company.bank_account +
      " סניף " + (company.bank_branch || "") + " " + company.bank_name + ".";
  }
  const logoUrl = company.logo_url || "";
  return { companyName, companyAddress, companyPhone, logoUrl, bankLine };
}

// Build the content_json object stored on a letter, wrapping the body with the
// company letterhead fields so /letters → handlePrint renders the full header,
// the "הנדון:" subject styling, the signature, and (optionally) the appendix.
export function letterContent(body: string, ci: CompanyInfo, extra?: Record<string, any>) {
  return {
    body: body,
    companyName: ci.companyName,
    companyAddress: ci.companyAddress,
    companyPhone: ci.companyPhone,
    logoUrl: ci.logoUrl,
    bankLine: ci.bankLine,
    ...(extra || {}),
  };
}

// ── ניסוח תזכורת ─────────────────────────────────────────────────────────
// כשכבר נשלח לשוכר מכתב מאותו סוג (אותו kind, אותו חוזה) — המכתב הבא
// נפתח כ"תזכורת — בהמשך למכתבנו מיום X" במקום להיראות כפנייה ראשונה.
export async function priorSentOfKind(contractId: string, kind: string, matchKey?: string, matchValue?: any): Promise<{ count: number; lastSentAt: string | null }> {
  const { data } = await supabase.from("letters")
    .select("id, sent_at, status, content_json")
    .eq("contract_id", contractId).eq("status", "sent");
  let count = 0; let last: string | null = null;
  (data || []).forEach(function (l: any) {
    let cj: any = l.content_json;
    if (typeof cj === "string") { try { cj = JSON.parse(cj); } catch (e) { cj = {}; } }
    if (!cj || cj.kind !== kind) return;
    if (matchKey && cj[matchKey] !== matchValue) return;
    count++;
    if (l.sent_at && (!last || l.sent_at > last)) last = l.sent_at;
  });
  return { count: count, lastSentAt: last };
}

export function reminderIntro(prior: { count: number; lastSentAt: string | null }): string {
  if (!prior.count) return "";
  const dateTxt = prior.lastSentAt ? new Date(prior.lastSentAt).toLocaleDateString("he-IL") : "";
  return "בהמשך למכתבנו" + (prior.count >= 2 ? " החוזר" : "") + (dateTxt ? " מיום " + dateTxt : "") + " בנושא שבנדון, אשר טרם נענה, הרינו לפנות אליכם בשנית.\n\n";
}

export function reminderTitle(prior: { count: number }, title: string): string {
  if (!prior.count) return title;
  return (prior.count >= 2 ? "תזכורת נוספת — " : "תזכורת — ") + title;
}
