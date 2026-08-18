import type { SupabaseClient } from "@supabase/supabase-js";
import { addBusinessDays } from "./business-days";

function fmtMoney(n: number) { return "₪" + (n || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }

// Monthly rent from a contract's contract_spaces (fixed / per-sqm / revenue floor).
export function monthlyRentFromSpaces(spaces: any[]): number {
  if (!spaces || !spaces.length) return 0;
  let total = 0, counted = 0;
  spaces.forEach(function (cs: any) {
    const area = cs?.spaces?.area ?? 0;
    if (cs.charge_method === "included") { }
    else if (cs.charge_method === "fixed" || (cs.fixed_rent && cs.fixed_rent > 0)) { total += Number(cs.fixed_rent || 0); counted++; }
    else if (cs.charge_method === "per_sqm" || (cs.price_per_sqm && cs.price_per_sqm > 0)) { total += Number(cs.price_per_sqm || 0) * Number(area); counted++; }
    else if (cs.min_rent && cs.min_rent > 0) { total += Number(cs.min_rent); counted++; }
  });
  return counted > 0 ? total : 0;
}

export interface GuaranteeRenewalCalc {
  currentAmount: number;
  requiredNow: number;
  changePct: number;
  needsUpdate: boolean;
  monthly: number;
  months: number;
  deadlineLabel: string;
}

// Compute the renewal figures: current guarantee amount, the amount the contract
// now requires (guarantee_months × monthly rent), and whether the gap exceeds 5%.
export function computeGuaranteeRenewal(g: any, contract: any): GuaranteeRenewalCalc {
  const monthly = monthlyRentFromSpaces(contract?.contract_spaces) || monthlyRentFromSpaces(g?.contracts?.contract_spaces) || 0;
  const months = Number(contract?.guarantee_months) || 0;
  const currentAmount = Number(g.amount_actual) || Number(g.amount_required) || Number(contract?.guarantee_amount) || 0;
  const requiredNow = (months > 0 && monthly > 0) ? Math.round(months * monthly) : (Number(g.amount_required) || Number(contract?.guarantee_amount) || 0);
  const changePct = currentAmount > 0 ? ((requiredNow - currentAmount) / currentAmount) * 100 : 0;
  const needsUpdate = requiredNow > 0 && currentAmount > 0 && changePct > 5;
  const deadlineLabel = g.end_date ? addBusinessDays(g.end_date, 5).toLocaleDateString("he-IL") : "";
  return { currentAmount: currentAmount, requiredNow: requiredNow, changePct: changePct, needsUpdate: needsUpdate, monthly: monthly, months: months, deadlineLabel: deadlineLabel };
}

// Build the formal renewal-letter body. `s` carries the calc + tenant/guarantee.
export function buildGuaranteeRenewalBody(s: any, companyName: string): string {
  const g = s.g;
  let body = "לכבוד\n" + (s.tenantName || "") + "\n\nשלום רב,\n\n";
  body += "הנדון: חידוש ערבות" + (g.reference_number ? " מס' " + g.reference_number : "") + "\n\n";
  body += "בהתאם להוראות הסכם השכירות, ולקראת מועד פקיעת הערבות שבידינו, נבקשכם לחדש את הערבות כמפורט להלן:\n\n";
  body += "פרטי הערבות הקיימת:\n";
  body += "מספר ערבות: " + (g.reference_number || "—") + "\n";
  if (g.bank) body += "בנק/מנפיק: " + g.bank + (g.branch ? " סניף " + g.branch : "") + "\n";
  body += "סכום הערבות: " + fmtMoney(s.currentAmount) + "\n";
  body += "בתוקף עד: " + fmtDate(g.end_date) + "\n\n";
  if (s.includeUpdate && s.needsUpdate) {
    body += "עדכון סכום הערבות:\n";
    body += "בהתאם לסעיף הערבות בהסכם, ולאור שינוי מהותי בתנאי ההסכם (הגדלת שטחים / עליית דמי שכירות מעבר למדד) בשיעור של כ-" + Math.round(s.changePct) + "% מעל סכום הערבות הקיים, עודכן סכום הערבות הנדרש:\n";
    if (s.months > 0 && s.monthly > 0) body += "חישוב: " + s.months + " חודשי שכירות × " + fmtMoney(s.monthly) + " = " + fmtMoney(s.requiredNow) + "\n";
    body += "סכום ערבות נדרש מעודכן: " + fmtMoney(s.requiredNow) + " (במקום " + fmtMoney(s.currentAmount) + ")\n\n";
    body += "לפיכך נבקשכם להמציא ערבות חדשה בתוקף ובסכום המעודכן כאמור.\n\n";
  } else {
    body += "נבקשכם להמציא ערבות חדשה בתוקף, באותו סכום ובתנאים זהים.\n\n";
  }
  if (s.deadlineLabel) body += "יש להמציא את הערבות המחודשת עד ולא יאוחר מיום " + s.deadlineLabel + " (5 ימי עסקים ממועד פקיעת הערבות הנוכחית).\n\n";
  body += "אי-המצאת ערבות בתוקף במועד עלולה להוות הפרה של הסכם השכירות.\n\n";
  body += "בכבוד רב ובברכה,\n\n" + (companyName || "הנהלת הנכס");
  return body;
}

// Server-side company letterhead (mirrors lib/letter-format but takes the client).
async function loadCompanyInfoSrv(supabase: SupabaseClient, propId: string) {
  const { data } = await supabase.from("properties")
    .select("name, companies(company_name, address, city, phone, logo_url, bank_name, bank_branch, bank_account)")
    .eq("id", propId).single();
  const c: any = (data?.companies as any) || {};
  const companyName = c.company_name || data?.name || "";
  let bankLine = "";
  if (c.bank_name && c.bank_account) {
    bankLine = "את התשלום ניתן להעביר לפקודת " + companyName + ", חשבון " + c.bank_account + " סניף " + (c.bank_branch || "") + " " + c.bank_name + ".";
  }
  return {
    companyName: companyName,
    companyAddress: [c.address, c.city].filter(Boolean).join(", "),
    companyPhone: c.phone || "",
    logoUrl: c.logo_url || "",
    bankLine: bankLine,
  };
}

// Auto-create "guarantee renewal" letters for active guarantees expiring within
// `daysAhead` days that don't already have one. Returns the created summaries.
export async function autoCreateGuaranteeRenewalLetters(
  supabase: SupabaseClient,
  daysAhead: number = 30,
): Promise<Array<{ tenantName: string; ref: string; deadline: string; needsUpdate: boolean }>> {
  const out: Array<{ tenantName: string; ref: string; deadline: string; needsUpdate: boolean }> = [];
  const { data: guarantees } = await supabase.from("guarantees")
    .select("*, contracts(id, property_id, guarantee_months, guarantee_amount, tenants(name), contract_spaces(charge_method, fixed_rent, price_per_sqm, revenue_pct, min_rent, spaces(area)))")
    .eq("status", "active");

  const compCache: Record<string, any> = {};
  const getCompany = async function (propId: string) {
    if (!propId) return { companyName: "", companyAddress: "", companyPhone: "", logoUrl: "", bankLine: "" };
    if (compCache[propId]) return compCache[propId];
    const ci = await loadCompanyInfoSrv(supabase, propId);
    compCache[propId] = ci;
    return ci;
  };

  for (const g of (guarantees ?? []) as any[]) {
    if (!g.end_date || !g.contract_id) continue;
    const days = Math.ceil((new Date(g.end_date).getTime() - Date.now()) / 86400000);
    if (days < 0 || days > daysAhead) continue;

    // Dedupe: a renewal letter for this guarantee already exists?
    const { data: existing } = await supabase.from("letters")
      .select("id").eq("billing_type", "guarantee").contains("content_json", { guaranteeId: g.id }).limit(1);
    if (existing && existing.length) continue;

    const contract = g.contracts || {};
    const calc = computeGuaranteeRenewal(g, contract);
    const ci = await getCompany(g.contracts?.property_id || "");
    const tenantName = g.contracts?.tenants?.name || "";
    const s = { g: g, tenantName: tenantName, includeUpdate: calc.needsUpdate, ...calc };
    const body = buildGuaranteeRenewalBody(s, ci.companyName);
    const ref = g.reference_number || g.bank || "";
    const title = "חידוש ערבות" + (ref ? " " + ref : "");

    const { error } = await supabase.from("letters").insert({
      contract_id: g.contract_id,
      property_id: g.contracts?.property_id || null,
      letter_type: "demand",
      title: title,
      content_json: {
        body: body, kind: "guarantee_renewal", guaranteeId: g.id, tenant: tenantName, autoCreated: true,
        companyName: ci.companyName, companyAddress: ci.companyAddress, companyPhone: ci.companyPhone, logoUrl: ci.logoUrl, bankLine: ci.bankLine,
      },
      status: "ready",
      billing_type: "guarantee",
    });
    if (!error) out.push({ tenantName: tenantName, ref: ref, deadline: calc.deadlineLabel, needsUpdate: calc.needsUpdate });
  }
  return out;
}

// All letters waiting to be sent (draft + ready), for the manager reminder.
export async function getUnsentLetters(supabase: SupabaseClient): Promise<any[]> {
  const { data } = await supabase.from("letters")
    .select("id, title, billing_type, status, contracts(tenants(name), properties(name))")
    .in("status", ["draft", "ready"])
    .order("created_at", { ascending: false });
  return data ?? [];
}

// HTML reminder section: newly auto-created guarantee letters + all letters
// still waiting to be sent. Returns "" when there is nothing to remind about.
export function buildLettersReminderHtml(
  unsent: any[],
  created: Array<{ tenantName: string; ref: string; deadline: string; needsUpdate: boolean }>,
): string {
  if ((!unsent || unsent.length === 0) && (!created || created.length === 0)) return "";
  let html = `<div dir="rtl" style="font-family:Arial,sans-serif;direction:rtl;padding:28px;max-width:640px">
    <h2 style="color:#b45309;border-bottom:2px solid #f59e0b;padding-bottom:8px">מכתבים הממתינים לשליחה</h2>`;

  if (created && created.length > 0) {
    html += `<h3 style="color:#b45309;margin:16px 0 8px">🏦 נוצרו אוטומטית ${created.length} מכתבי חידוש ערבות</h3>
      <ul style="line-height:1.8;padding-right:18px">` +
      created.map(function (c) {
        return `<li>${c.tenantName || "—"}${c.ref ? " · ערבות " + c.ref : ""}${c.deadline ? ` <span style="color:#94a3b8;font-size:12px">— מועד המצאה ${c.deadline}</span>` : ""}${c.needsUpdate ? ` <span style="color:#dc2626;font-size:12px">(נדרש עדכון סכום)</span>` : ""}</li>`;
      }).join("") + `</ul>`;
  }

  if (unsent && unsent.length > 0) {
    const LIMIT = 40;
    const shown = unsent.slice(0, LIMIT);
    html += `<h3 style="color:#1e3a5f;margin:16px 0 8px">✉️ סה"כ ${unsent.length} מכתבים ממתינים לשליחה</h3>
      <ul style="line-height:1.8;padding-right:18px">` +
      shown.map(function (l: any) {
        const tenant = l.contracts?.tenants?.name || "—";
        const st = l.status === "ready" ? "מוכן לשליחה" : "טיוטה";
        return `<li>${l.title || "מכתב"} — ${tenant} <span style="color:#94a3b8;font-size:12px">(${st})</span></li>`;
      }).join("") + `</ul>`;
    if (unsent.length > LIMIT) html += `<p style="color:#94a3b8;font-size:12px">…ועוד ${unsent.length - LIMIT}</p>`;
  }

  html += `<p style="margin-top:16px;font-size:13px;color:#475569">היכנס למסך <b>מכתבים</b> כדי לבדוק, למזג ולשלוח.</p>
    <hr style="margin-top:20px;border:none;border-top:1px solid #e2e8f0"/>
    <p style="font-size:11px;color:#94a3b8">PropManager v4 — תזכורת מכתבים</p>
  </div>`;
  return html;
}
