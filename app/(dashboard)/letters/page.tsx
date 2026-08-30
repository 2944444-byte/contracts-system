"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { authHeaders } from '@/lib/api-auth-client';
import { logAudit } from '@/lib/audit-log';
import { loadCompanyInfo, letterContent } from '@/lib/letter-format';
import { contactMatchesDomain } from '@/lib/tenant-contacts';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';
import { topicForLetter, orgCcFor } from '@/lib/letter-cc';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const LETTER_TYPES = [
  {v:"demand",    l:"מכתב דרישה",    icon:"⚠️"},
  {v:"notice",    l:"הודעה",          icon:"📢"},
  {v:"indexation",l:"עדכון הצמדה",  icon:"📈"},
  {v:"renewal",   l:"חידוש חוזה",   icon:"🔄"},
  {v:"other",     l:"אחר",           icon:"📄"},
];

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function fmtMoney(n: number) { return "₪" + (n || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Extract the meaningful core of a single charge letter so several can be merged
// into ONE unified letter: the subject (from the "הנדון:" line), the field lines
// (יחידות / שטח / amounts — short "label: value" pairs), and the total amount.
function extractLetterCore(body: string): { subject: string; detail: string[]; total: number } {
  var lines = (body || "").split("\n");
  var subjIdx = -1, stopIdx = -1;
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (subjIdx === -1 && t.indexOf("הנדון:") === 0) subjIdx = i;
    if (stopIdx === -1 && (t.indexOf("נא להסדיר") === 0 || t.indexOf("סכום הזיכוי") === 0 || t.indexOf("יש להמציא") === 0 || t.indexOf("בכבוד רב") === 0)) stopIdx = i;
  }
  var subject = subjIdx >= 0 ? lines[subjIdx].replace(/^.*?הנדון:\s*/, "").trim() : "חיוב";
  var detail: string[] = [];
  var end = stopIdx >= 0 ? stopIdx : lines.length;
  for (var k = (subjIdx >= 0 ? subjIdx + 1 : 0); k < end; k++) {
    var dt = lines[k].trim();
    if (!dt) continue;
    var ci = dt.indexOf(":");
    if (ci > 0 && ci <= 22) detail.push(dt); // "label: value" field lines only
  }
  var total = 0;
  for (var m = detail.length - 1; m >= 0; m--) {
    if (detail[m].indexOf("סה\"כ") === 0) {
      var mm = detail[m].match(/₪\s*([\d,]+(?:\.\d+)?)/);
      if (mm) total = parseFloat(mm[1].replace(/,/g, ""));
      break;
    }
  }
  return { subject: subject, detail: detail, total: total };
}

// ── Unified-letter wording (GENERAL: applies to ANY merge of ANY charge types).
// Each charge type maps to (a) a short noun-phrase for the SUBJECT line and (b) a
// fuller clause for the BODY sentence. Anything unmapped falls back to the
// letter's own "הנדון" subject, so a brand-new charge type still merges sensibly.
const CHARGE_SHORT: Record<string, string> = {
  management: "השלמת דמי ניהול",
  waste: "פינוי אשפה",
  insurance: "ביטוח המבנה",
  cpi: "הפרשי הצמדה",
  cpi_diff: "הפרשי הצמדה",
  advance: 'מקדמות שכ"ד',
};
const CHARGE_CLAUSE: Record<string, string> = {
  management: "השלמת תשלום דמי ניהול בהתאם להוצאות הניהול בפועל",
  waste: "תשלום בגין פינוי אשפה מחדר האשפה המשותף במתחם",
  insurance: "תשלום בגין ביטוח המבנה",
  cpi: "תשלום בגין הפרשי הצמדה למדד",
  cpi_diff: "תשלום בגין הפרשי הצמדה למדד",
  advance: 'תשלום מקדמות שכ"ד',
};
function billingYearOf(l: any, subject: string): string {
  if (l && l.billing_year) return String(l.billing_year);
  var m = (subject || "").match(/20\d{2}/);
  return m ? m[0] : "";
}
function chargeShort(l: any, subject: string): string {
  return (l && CHARGE_SHORT[l.billing_type]) || subject || "חיוב";
}
function chargeClause(l: any, subject: string): string {
  return (l && CHARGE_CLAUSE[l.billing_type]) || ("תשלום בגין " + (subject || "חיוב"));
}
// Hebrew list joins. Plain (subject, no Oxford comma): "A וB" / "A, B וC".
// Comma (body clauses, comma before the final ו): "A, וB" / "A, B, וC".
function heJoinPlain(items: string[]): string {
  if (items.length <= 1) return items[0] || "";
  return items.slice(0, -1).join(", ") + " ו" + items[items.length - 1];
}
function heJoinComma(items: string[]): string {
  if (items.length <= 1) return items[0] || "";
  return items.slice(0, -1).join(", ") + ", ו" + items[items.length - 1];
}
// Detailed subject for a merge: group charges by year, list each year's charges.
// e.g. "תשלום השלמת דמי ניהול ופינוי אשפה לשנת 2025 ותשלום ביטוח המבנה לשנת 2026".
function composeMergedSubject(letters: any[], cores: any[]): string {
  var byYear: Record<string, string[]> = {};
  var order: string[] = [];
  letters.forEach(function(l: any, i: number) {
    var y = billingYearOf(l, cores[i].subject) || "—";
    if (!byYear[y]) { byYear[y] = []; order.push(y); }
    var ph = chargeShort(l, cores[i].subject);
    if (byYear[y].indexOf(ph) === -1) byYear[y].push(ph);
  });
  order.sort();
  return order.map(function(y: string, idx: number) {
    var lead = idx === 0 ? "תשלום " : "ותשלום ";
    return lead + heJoinPlain(byYear[y]) + (y !== "—" ? " לשנת " + y : "");
  }).join(" ");
}
// Split a "label: value" detail line into a [label, value] pair, sanitized so
// the "|"-delimited appendix encoding can't be broken by stray pipes.
function splitKv(s: string): string[] {
  var clean = String(s || "").replace(/\|/g, "/");
  var i = clean.indexOf(":");
  return i >= 0 ? [clean.slice(0, i).trim(), clean.slice(i + 1).trim()] : [clean.trim(), ""];
}

// Purpose-based categories — what the letter is actually about, used for the
// row icon and the "סוג" filter. This is more meaningful than the raw
// letter_type, because e.g. a payment demand and an insurance-certificate
// demand are both letter_type "demand" but mean very different things.
const LETTER_CATEGORIES = [
  { key: "money",       icon: "💰", label: "דרישת תשלום / כספי" },
  { key: "certificate", icon: "🛡️", label: "דרישת אישור (ביטוח/אש)" },
  { key: "guarantee",   icon: "🏦", label: "חידוש ערבות" },
  { key: "renewal",     icon: "🔄", label: "חידוש חוזה" },
  { key: "notice",      icon: "📢", label: "הודעה" },
  { key: "other",       icon: "📄", label: "אחר" },
];

// Recipient domains — a tenant/organization can route each domain to a
// different contact person (finance, certificates, guarantees, general).
const RECIPIENT_DOMAINS = [
  { key: "money",       icon: "💰", label: "כספים / חיובים" },
  { key: "certificate", icon: "🛡️", label: "אישורי ביטוח/אש" },
  { key: "guarantee",   icon: "🏦", label: "ערבויות" },
  { key: "general",     icon: "📄", label: "כללי (ברירת מחדל)" },
];

// Unit/contract label for a letter — the space names on its contract, joined.
// Lets two letters with the SAME title for the SAME tenant be told apart at a
// glance (e.g. יהונתן בכור: "מחסן" vs "משרדים, מסחר") without opening them.
function unitsLabel(l: any): string {
  var cs = l && l.contracts && l.contracts.contract_spaces;
  if (!Array.isArray(cs) || cs.length === 0) return (l && l.contracts && l.contracts.properties && l.contracts.properties.name) || "";
  var names = cs.map(function(x: any){ return x && x.spaces && x.spaces.space_name; }).filter(Boolean);
  return Array.from(new Set(names)).join(", ");
}

function parseCj(l: any): any {
  var cj = l.content_json;
  if (typeof cj === "string") { try { cj = JSON.parse(cj); } catch (e) { cj = {}; } }
  return cj || {};
}

// Classify a letter by purpose. Money = all billing letters (advances, rent
// redemption, CPI diff, insurance/management/waste charges, any debt). Cert =
// insurance / fire-safety certificate renewal requests. Guarantee = guarantee
// renewal requests.
function letterCategory(l: any): string {
  var kind = parseCj(l).kind || "";
  if (kind === "insurance_demand" || kind === "safety_demand" || kind === "certificate_demand") return "certificate";
  if (kind === "guarantee_renewal" || l.billing_type === "guarantee" || l.letter_type === "guarantee") return "guarantee";
  if (l.billing_type) return "money";            // every auto-generated billing letter
  if (l.letter_type === "demand" || l.letter_type === "indexation") return "money";
  if (l.letter_type === "renewal") return "renewal";
  if (l.letter_type === "notice") return "notice";
  return "other";
}
const categoryInfo = function(key: string) { return LETTER_CATEGORIES.find(function(c){ return c.key === key; }) || LETTER_CATEGORIES[5]; };

export default function LettersPage() {
  const [letters,   setLetters]   = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editingId, setEditingId] = useState("");
  const [preview,   setPreview]   = useState<any|null>(null);
  const [saving,    setSaving]    = useState(false);

  const [fContractId,setFContractId]=useState("");
  const [fType,      setFType]      =useState("notice");
  const [fSubject,   setFSubject]   =useState("");
  const [fBody,      setFBody]      =useState("");
  const [fTemplateId,setFTemplateId]=useState("");

  // Listing filters + grouping
  const [search,       setSearch]       = useState("");
  const [filterYear,   setFilterYear]   = useState<string>("");
  const [filterType,   setFilterType]   = useState<string>("");
  const [filterProp,   setFilterProp]   = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Multi-select for merge-send: which letter ids are checked.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // When set, shows the merged-letter preview modal (one entry per recipient).
  const [mergeView, setMergeView] = useState<any[] | null>(null);
  // Recipients editor modal state ({tenantId, tenantName, rows}).
  const [recip, setRecip] = useState<any | null>(null);
  const [recipSaving, setRecipSaving] = useState(false);
  const [sending, setSending] = useState("");
  // Test mode (default ON): send via the LOCAL mail client (mailto), no PDF
  // attachment and NO CC to owners/authorized users — safe while still testing.
  // Turn OFF once Resend is configured to send real emails (PDF + CC).
  // ברירת המחדל: שליחה אמיתית — PDF מצורף + מעטפת קצרה + עותקים. מצב
  // הבדיקה (mailto מקומי: כל טקסט המכתב בגוף ההודעה, בלי קובץ ובלי עותקים)
  // היה ברירת המחדל בכל כניסה למסך, והמשתמשים שלחו מכתבים בלי ה-PDF
  // בלי לדעת שקיים מצב אחר. בחירה מפורשת במצב בדיקה נשמרת בדפדפן.
  const [testMode, setTestMode] = useState(false);
  // CC directory: who gets a tracking copy of each send. A user qualifies ONLY
  // when BOTH conditions hold — a billing-capable role AND assignment to that
  // property. accessByProp already encodes the intersection.
  const [ccDir, setCcDir] = useState<{ accessByProp: Record<string, string[]>; companyByProp: Record<string, string>; companyIdByProp?: Record<string, string>; orgContacts?: any[] }>({ accessByProp: {}, companyByProp: {} });

  function toggleGroup(key: string) {
    setCollapsedGroups(function(prev) { return { ...prev, [key]: !prev[key] }; });
  }

  function toggleSelect(id: string) {
    setSelected(function(prev) { var n = { ...prev }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  }
  function setGroupSelected(items: any[], on: boolean) {
    setSelected(function(prev) {
      var n = { ...prev };
      items.forEach(function(l) { if (on) n[l.id] = true; else delete n[l.id]; });
      return n;
    });
  }
  function clearSelection() { setSelected({}); }
  const selectedIds = function() { return Object.keys(selected).filter(function(k){ return selected[k]; }); };

  useEffect(function() { loadAll(); }, []);
  useEffect(function() { try { var v = localStorage.getItem("letters_test_mode_v2"); if (v !== null) setTestMode(v === "1"); } catch (e) {} }, []);
  // null = טרם נבדק; false = שירות הדואר (Resend) לא מוגדר בסביבה — אז אין
  // ערוץ שליחה עם PDF, והמסך נשאר במייל המקומי ומסביר מה חסר במקום להיכשל.
  const [emailReady, setEmailReady] = useState<boolean | null>(null);
  useEffect(function() {
    (async function() {
      try {
        var res = await fetch("/api/send-letter", { headers: await authHeaders() });
        var d = res.ok ? await res.json() : { configured: false };
        setEmailReady(!!d.configured);
        if (!d.configured) setTestMode(true);
      } catch (e) { setEmailReady(false); setTestMode(true); }
    })();
  }, []);
  function toggleTestMode() {
    if (emailReady === false) return;
    setTestMode(function(prev){ var n = !prev; try { localStorage.setItem("letters_test_mode_v2", n ? "1" : "0"); } catch (e) {} return n; });
  }

  async function loadAll() {
    const [{ data: l }, { data: c }, { data: t }] = await Promise.all([
      supabase.from("letters").select("*, contracts(tenant_id, property_id, tenants(id,name,primary_email,contact_email,email,contact_name,contacts),properties(id,name),contract_spaces(spaces(space_name)))").order("created_at",{ascending:false}),
      supabase.from("contracts").select("id,property_id,tenants(name,contact_name),properties(name,address)").in("status",["active","expiring","extended"]),
      supabase.from("document_templates").select("*").eq("is_active",true).order("name"),
    ]);
    var scope = await getScopeIds();
    setLetters(scopeRows(l??[], scope, function(x: any){ return x.property_id || x.contracts?.property_id; }));
    setContracts(scopeRows(c??[], scope, function(x: any){ return x.property_id; }));
    setTemplates(t??[]); setLoading(false);
    loadCcDirectory();
  }

  // Build the CC directory once: which authorized users get a tracking copy of
  // letters per property, plus the owning company email. Best-effort — if the
  // users/access tables are empty, CC falls back to the company email only.
  async function loadCcDirectory() {
    try {
      var BILLING_ROLES = ["admin", "owner", "manager", "accountant", "billing"];
      const [{ data: profs }, { data: access }, { data: props }, { data: orgC }] = await Promise.all([
        supabase.from("user_profiles").select("id,email,role,is_active").eq("is_active", true),
        supabase.from("user_property_access").select("user_id,property_id"),
        supabase.from("properties").select("id,company_id,companies(email)"),
        // מכותבים פנימיים לפי נושא — אנשי הקשר של הארגון (RLS תוחם לנכסים שלנו)
        supabase.from("org_contacts").select("id,company_id,property_id,email,topics,is_active").eq("is_active", true),
      ]);
      // Only billing-capable users are eligible at all — so accessByProp is the
      // intersection (assigned-to-property AND can-bill).
      var emailById: Record<string, string> = {};
      (profs ?? []).forEach(function(u: any) {
        if (u.email && BILLING_ROLES.indexOf((u.role || "").toLowerCase()) !== -1) emailById[u.id] = u.email;
      });
      var accessByProp: Record<string, string[]> = {};
      (access ?? []).forEach(function(a: any) {
        var em = emailById[a.user_id];
        if (!em) return; // user isn't billing-capable → not a CC recipient
        if (!accessByProp[a.property_id]) accessByProp[a.property_id] = [];
        if (accessByProp[a.property_id].indexOf(em) === -1) accessByProp[a.property_id].push(em);
      });
      var companyByProp: Record<string, string> = {};
      var companyIdByProp: Record<string, string> = {};
      (props ?? []).forEach(function(p: any) {
        var ce = p.companies?.email;
        if (ce) companyByProp[p.id] = ce;
        if (p.company_id) companyIdByProp[p.id] = p.company_id;
      });
      setCcDir({ accessByProp: accessByProp, companyByProp: companyByProp, companyIdByProp: companyIdByProp, orgContacts: orgC ?? [] });
    } catch (e) { /* best-effort */ }
  }

  // CC list for a set of property ids: ONLY users who both can bill AND are
  // assigned to one of those properties, plus the owning company email. No
  // fallback — an unassigned billing user is never CC'd.
  // גרסה חיה לרגע השליחה: שולפת את אנשי הקשר מה-DB עכשיו — כך שינוי
  // שנעשה בטופס הנכס תופס מיד, גם אם מסך המכתבים היה פתוח קודם.
  async function ccForPropsLive(propIds: string[], excludeEmail?: string, letterForTopic?: any): Promise<string[]> {
    var out = ccForProps(propIds, excludeEmail, letterForTopic);
    try {
      const { data: fresh } = await supabase.from("org_contacts")
        .select("id,company_id,property_id,email,topics,is_active").eq("is_active", true);
      var companyIds: string[] = [];
      (propIds || []).forEach(function(pid) {
        var cid = (ccDir.companyIdByProp || {})[pid];
        if (cid && companyIds.indexOf(cid) === -1) companyIds.push(cid);
      });
      orgCcFor({
        contacts: fresh ?? [], propertyIds: propIds || [], companyIds: companyIds,
        topic: letterForTopic ? topicForLetter(letterForTopic) : "general",
      }).forEach(function(e) { if (e !== excludeEmail && out.indexOf(e) === -1) out.push(e); });
    } catch (e) { /* הרשימה מה-mount עדיין בתוקף */ }
    return out;
  }

  function ccForProps(propIds: string[], excludeEmail?: string, letterForTopic?: any): string[] {
    var out: string[] = [];
    (propIds || []).forEach(function(pid) {
      (ccDir.accessByProp[pid] || []).forEach(function(e) { if (out.indexOf(e) === -1) out.push(e); });
      var ce = ccDir.companyByProp[pid];
      if (ce && out.indexOf(ce) === -1) out.push(ce);
    });
    // מכותבים פנימיים לפי נושא: אנשי קשר שהוגדרו בנכס/בחברה ומנויים על
    // נושא המכתב (או על "כל ההתכתבויות") מקבלים עותק.
    var companyIds: string[] = [];
    (propIds || []).forEach(function(pid) {
      var cid = (ccDir.companyIdByProp || {})[pid];
      if (cid && companyIds.indexOf(cid) === -1) companyIds.push(cid);
    });
    orgCcFor({
      contacts: ccDir.orgContacts || [],
      propertyIds: propIds || [],
      companyIds: companyIds,
      topic: letterForTopic ? topicForLetter(letterForTopic) : "general",
    }).forEach(function(e) { if (out.indexOf(e) === -1) out.push(e); });
    return out.filter(function(e) { return e && e !== excludeEmail; });
  }

  function openNew() { setEditingId("new"); setFContractId(""); setFType("notice"); setFSubject(""); setFBody(""); setFTemplateId(""); }

  function fillTemplate(tid: string, cid: string) {
    const tpl=templates.find(function(t){return t.id===tid;});
    const con=contracts.find(function(c){return c.id===cid;});
    if (!tpl||!con) return;
    let body=tpl.body_template??"";
    body=body.replace(/\{\{tenant_name\}\}/g,con.tenants?.name??"").replace(/\{\{property_name\}\}/g,con.properties?.name??"").replace(/\{\{date\}\}/g,new Date().toLocaleDateString("he-IL"));
    setFBody(body);
  }

  async function handleSave() {
    if (!fContractId||!fSubject.trim()) { alert("חובה: חוזה + נושא"); return; }
    setSaving(true);
    try {
      // גם מכתב ידני מקבל את כותרת החברה המשכירה (לוגו, שם, כתובת).
      var { data: cRow0 } = await supabase.from("contracts").select("property_id").eq("id", fContractId).single();
      var ci0 = await loadCompanyInfo((cRow0 as any)?.property_id);
      const { data } = await supabase.from("letters").insert({contract_id:fContractId,letter_type:fType,title:fSubject.trim(),content_json:letterContent(fBody, ci0, {}),template_id:fTemplateId||null,status:"draft"}).select().single();
      await logAudit({entity_type:"letter",entity_id:data.id,action:"create"});
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  function buildLetterHtmlDoc(l: any, withPrintScript: boolean): string {
    var title = l.title || l.subject || "מכתב";
    var cj = l.content_json ? (typeof l.content_json === "string" ? JSON.parse(l.content_json) : l.content_json) : {};
    var bodyText = cj.body || l.body || "";
    var companyName = cj.companyName || "";
    var companyAddress = cj.companyAddress || "";
    var companyPhone = cj.companyPhone || "";
    var logoUrl = cj.logoUrl || "";
    var appendixRaw = cj.appendix || "";
    var tenant = l.contracts?.tenants?.name || cj.tenant || "";

    // Build header: logo + company name (both shown), then address small below
    var headerHtml = '<div class="header">';
    if (logoUrl) {
      headerHtml += '<img src="' + logoUrl + '" class="logo" id="company-logo">';
    }
    headerHtml += '<div class="company-name">' + companyName + '</div>';
    headerHtml += '</div>';
    var detailParts = [];
    if (companyAddress) detailParts.push(companyAddress);
    if (companyPhone) detailParts.push('טל: ' + companyPhone);
    if (detailParts.length > 0) {
      headerHtml += '<div class="company-details">' + detailParts.join(' | ') + '</div>';
    }

    // Parse body: convert checks table to HTML
    var bodyHtml = bodyText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    var lines = bodyHtml.split("\n");
    var htmlParts: string[] = [];
    var inTable = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) { if (!inTable) htmlParts.push("<br>"); continue; }
      if (line.startsWith("הנדון:")) { htmlParts.push('<div class="subject">' + line + '</div>'); continue; }
      if (line.includes("המחאה") && line.includes("לתאריך")) {
        inTable = true;
        htmlParts.push('<table class="checks"><thead><tr><th>המחאה</th><th>לתאריך</th><th>בסכום בש"ח</th></tr></thead><tbody>');
        continue;
      }
      if (inTable && /^\d+\t/.test(line)) {
        var p = line.split("\t");
        htmlParts.push('<tr><td>' + p[0] + '</td><td>' + (p[1]||"") + '</td><td class="amount">' + (p[2]||"") + '</td></tr>');
        continue;
      }
      if (inTable && line.includes("סה\"כ")) {
        var totalVal = line.replace(/.*סה"כ:?\s*/, "");
        htmlParts.push('</tbody><tfoot><tr><td colspan="2"><strong>סה"כ</strong></td><td class="amount total">' + totalVal + '</td></tr></tfoot></table>');
        inTable = false;
        continue;
      }
      if (inTable && !/^\d+\t/.test(line)) { htmlParts.push("</tbody></table>"); inTable = false; }
      // Signature lines → align left
      if (line.includes("בכבוד רב") || line.includes("בברכה") || line === companyName.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")) {
        htmlParts.push('<p class="signature-line">' + line + '</p>');
      } else {
        htmlParts.push('<p>' + line + '</p>');
      }
    }
    if (inTable) htmlParts.push("</tbody></table>");

    // Parse appendix — two formats supported:
    //   1) NEW structured: SECTION / KV / TABLE_HEADER / TABLE_ROW / TABLE_FOOTER
    //      Used by combined letters (advances + CPI diff). Renders compact tables.
    //   2) LEGACY: UNIT_START / UNIT_END blocks. Renders per-unit/per-period cards.
    //      Still produced by AdvancesTab and older letters — kept for backward compat.
    var appendixHtml = "";
    function esc(s: string) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
    if (appendixRaw) {
      var hasStructured = /^\s*SECTIONP?\|/m.test(appendixRaw);
      if (hasStructured) {
        // ─── NEW format ───
        // Portrait-only appendices (merged summary: SECTIONP, no landscape
        // SECTION) render on a normal portrait page; otherwise keep landscape.
        var portraitOnly = /^\s*SECTIONP\|/m.test(appendixRaw) && !/^\s*SECTION\|/m.test(appendixRaw);
        appendixHtml = '<div class="' + (portraitOnly ? "appendix appendix-p" : "appendix") + '">';
        var lines = appendixRaw.split("\n");
        var inSection = false;
        var inTable = false;
        var inKvBlock = false;
        var pendingHeader = "";
        var closeTable = function() {
          if (inTable) { appendixHtml += '</tbody></table>'; inTable = false; }
        };
        var closeKv = function() {
          if (inKvBlock) { appendixHtml += '</div>'; inKvBlock = false; }
        };
        for (var li = 0; li < lines.length; li++) {
          var raw = lines[li];
          if (!raw.trim()) continue;
          var parts = raw.split("|");
          var tag = parts[0];
          if (tag === "SECTION" || tag === "SECTIONP") {
            closeTable(); closeKv();
            if (inSection) appendixHtml += '</div>'; // close prior section
            inSection = true;
            var sectionTitle = esc(parts[2] || "נספח");
            var secClass = tag === "SECTIONP" ? "apx-section-p" : "apx-section";
            appendixHtml += '<div class="' + secClass + '"><h3 class="apx-title">' + sectionTitle + '</h3>';
            continue;
          }
          if (tag === "SUBHEAD") {
            closeTable(); closeKv();
            appendixHtml += '<div class="apx-subhead">' + esc(parts[1]) + '</div>';
            continue;
          }
          if (tag === "KV") {
            closeTable();
            if (!inKvBlock) { appendixHtml += '<div class="apx-kv">'; inKvBlock = true; }
            appendixHtml += '<div class="apx-kv-row"><span class="apx-kv-label">' + esc(parts[1]) + '</span><span class="apx-kv-value">' + esc(parts[2]) + '</span></div>';
            continue;
          }
          if (tag === "TABLE_HEADER") {
            closeKv(); closeTable();
            appendixHtml += '<table class="apx-table"><thead><tr>';
            for (var hi = 1; hi < parts.length; hi++) appendixHtml += '<th>' + esc(parts[hi]) + '</th>';
            appendixHtml += '</tr></thead><tbody>';
            inTable = true;
            continue;
          }
          if (tag === "TABLE_ROW" && inTable) {
            appendixHtml += '<tr>';
            for (var ri = 1; ri < parts.length; ri++) appendixHtml += '<td>' + esc(parts[ri]) + '</td>';
            appendixHtml += '</tr>';
            continue;
          }
          if (tag === "TABLE_FOOTER" && inTable) {
            appendixHtml += '</tbody><tfoot><tr>';
            // Find the first non-empty cell as label (will span empties), last as value
            var label = "";
            var labelSpan = 1;
            var fi = 1;
            for (; fi < parts.length; fi++) {
              if (parts[fi]) { label = parts[fi]; break; }
            }
            // count empty cells after the label until last value
            var lastIdx = parts.length - 1;
            for (var ei = fi + 1; ei < lastIdx; ei++) {
              if (parts[ei] === "") labelSpan++;
              else break;
            }
            // Build: [label colspan=labelSpan+1] [remaining values...]
            var totalCols = parts.length - 1;
            var spanForLabel = totalCols - 1; // label takes all but last
            appendixHtml += '<td colspan="' + spanForLabel + '" class="apx-foot-label">' + esc(label) + '</td>';
            appendixHtml += '<td class="apx-foot-value">' + esc(parts[lastIdx]) + '</td>';
            appendixHtml += '</tr></tfoot></table>';
            inTable = false;
            continue;
          }
        }
        closeTable(); closeKv();
        if (inSection) appendixHtml += '</div>';
        appendixHtml += '</div>';
      } else {
        // ─── LEGACY UNIT_START format (advances-only letters from AdvancesTab) ───
        var isCpiDiff = (cj.body || "").includes("הפרשי הצמדה") || cj.body?.includes("נספח א'");
        var blocks = appendixRaw.split("UNIT_END").filter(Boolean);
        var appendixTitle = isCpiDiff ? "נספח א' — פירוט חישוב הפרשי הצמדה" : "נספח א' — פירוט חישוב מקדמות";
        appendixHtml = '<div class="appendix"><h3 class="apx-title">' + appendixTitle + '</h3>';
        blocks.forEach(function(block: string) {
          var match = block.match(/UNIT_START\|(.+?)\|(.+)/);
          if (!match) return;
          var header1 = match[1];
          var header2 = match[2].trim();
          var details = block.split("\n").filter(function(l) { return l && !l.includes("UNIT_START"); });
          var icon = isCpiDiff ? "📅" : "📐";
          var headerExtra = isCpiDiff ? "תשלום: " + header2 : header2 + ' מ"ר';
          appendixHtml += '<div class="unit-card"><div class="unit-header">' + icon + ' ' + header1 + ' | ' + headerExtra + '</div>';
          appendixHtml += '<div class="unit-details">';
          details.forEach(function(d: string) {
            d = d.trim();
            if (!d) return;
            appendixHtml += '<div class="detail-row">' + esc(d) + '</div>';
          });
          appendixHtml += '</div></div>';
        });
        appendixHtml += '</div>';
      }
    }

    // <title> = שם הקובץ שהדפדפן מציע ב"שמור כ-PDF" מחלון ההדפסה.
    var docTitle = safeFilename(title + " - " + tenant);
    var doc = '<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>' + docTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;") + '</title><style>' +
      // Cover page stays portrait; each appendix section automatically prints
      // landscape via a named @page rule. The recipient sees a portrait cover
      // letter then a landscape page per appendix — no manual rotation needed
      // when they hit Print, and the wide calc tables fit without truncation.
      '@page{size:A4 portrait;margin:12mm 18mm}' +
      '@page apxLandscape{size:A4 landscape;margin:10mm 12mm}' +
      '@page apxPortrait{size:A4 portrait;margin:12mm 18mm}' +
      'body{font-family:"David","Arial";padding:0;direction:rtl;font-size:11.5px;line-height:1.4;color:#1e293b;margin:0}' +
      '.page{padding:0 30px}' +
      '.header{text-align:center;margin-bottom:3px;display:flex;align-items:center;justify-content:center;gap:12px}' +
      '.logo{max-height:55px;max-width:120px}' +
      '.company-name{font-size:20px;font-weight:bold;color:#1e3a5f}' +
      '.company-details{text-align:center;font-size:10px;color:#64748b;margin-bottom:10px;border-bottom:2px solid #1e3a5f;padding-bottom:6px}' +
      '.date{text-align:left;font-size:10px;color:#64748b;margin-bottom:8px}' +
      'p{margin:2px 0;font-size:12px}' +
      '.subject{text-align:center;font-weight:bold;font-size:14px;margin:10px 0;text-decoration:underline}' +
      '.checks{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px}' +
      '.checks th{background:#1e3a5f;color:white;padding:5px 10px;text-align:right}' +
      '.checks td{padding:3px 10px;border-bottom:1px solid #e2e8f0}' +
      '.checks tr:nth-child(even){background:#f8fafc}' +
      '.checks .amount{font-weight:bold;color:#1e3a5f;direction:ltr;text-align:left}' +
      '.checks .total{font-size:12px;color:#059669;border-top:2px solid #059669}' +
      '.checks tfoot td{background:#f0fdf4;padding:5px 10px}' +
      '.appendix{page:apxLandscape;page-break-before:always;padding:10px 20px 0}' +
      // Merged-summary appendix: portrait page, flowing (not one page per charge).
      '.appendix-p{page:apxPortrait}' +
      '.apx-section-p{margin-bottom:14px}' +
      '.apx-subhead{font-weight:bold;color:#1e3a5f;font-size:12.5px;margin:12px 0 4px;border-right:3px solid #1e3a5f;padding-right:8px}' +
      '.apx-section-p .apx-kv{flex-direction:column;gap:3px 14px}' +
      '.appendix h3,.apx-title{color:#1e3a5f;font-size:15px;border-bottom:2px solid #1e3a5f;padding-bottom:5px;margin:0 0 10px 0}' +
      // Each appendix section starts on its own landscape page so wide tables
      // (10–12 columns) never get cut off.
      '.apx-section{page:apxLandscape;margin-bottom:18px;page-break-inside:avoid}' +
      '.apx-section+.apx-section{page-break-before:always;margin-top:0}' +
      '.apx-kv{display:flex;flex-wrap:wrap;gap:4px 14px;margin:6px 0 10px 0;font-size:11px;background:#f8fafc;border-radius:6px;padding:8px 12px}' +
      '.apx-kv-row{display:flex;gap:6px}' +
      '.apx-kv-label{color:#64748b}' +
      '.apx-kv-value{font-weight:bold;color:#1e3a5f}' +
      '.apx-table{width:100%;border-collapse:collapse;margin:6px 0;font-size:10px;table-layout:auto}' +
      '.apx-table th{background:#1e3a5f;color:white;padding:5px 6px;text-align:right;font-weight:bold;white-space:nowrap}' +
      // nowrap on cells so values don't break into multi-line stacks (which
      // happened in portrait mode and ruined the layout in the previous build).
      '.apx-table td{padding:4px 6px;border-bottom:1px solid #e2e8f0;color:#334155;white-space:nowrap}' +
      // Allow only the first column (typically unit name) to wrap, since names
      // like "חנות 5 ממערב למזרח" are long and unique.
      '.apx-table td:first-child{white-space:normal}' +
      '.apx-table tbody tr:nth-child(even){background:#f8fafc}' +
      '.apx-table tfoot td{background:#f0fdf4;padding:6px;border-top:2px solid #059669;font-weight:bold;color:#059669}' +
      '.apx-foot-label{text-align:right}' +
      '.apx-foot-value{text-align:left;direction:ltr}' +
      '.unit-card{border:1px solid #e2e8f0;border-radius:8px;margin:10px 0;overflow:hidden}' +
      '.unit-header{background:#eff6ff;border-right:4px solid #3b82f6;padding:8px 12px;font-weight:bold;font-size:13px;color:#1e3a5f}' +
      '.unit-details{padding:8px 15px;font-size:11px;line-height:1.8}' +
      '.detail-row{color:#334155}' +
      '.signature-line{text-align:left;margin:2px 0}' +
      '.footer-bar{margin-top:30px;border-top:1px solid #cbd5e1;padding-top:6px;text-align:center;font-size:9px;color:#94a3b8}' +
      '@media print{.checks th,.apx-table th{background:#1e3a5f !important;color:white !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.unit-header{background:#eff6ff !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.checks tr:nth-child(even),.apx-table tbody tr:nth-child(even){background:#f8fafc !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.checks tfoot td,.apx-table tfoot td{background:#f0fdf4 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.apx-kv{background:#f8fafc !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}' +
      '</style></head><body><div class="page">' +
      headerHtml +
      '<div class="date">' + fmtDate(l.created_at) + '</div>' +
      '<div class="content">' + htmlParts.join("\n") + '</div>' +
      // הפוטר שייך לעמוד המכתב (לא אחרי הנספח — שם הוא יצר עמוד ריק נוסף),
      // ורק כשיש לו תוכן.
      ((companyAddress || companyPhone) ? '<div class="footer-bar">' + (companyAddress ? companyAddress + ' | ' : '') + (companyPhone ? 'טל: ' + companyPhone : '') + '</div>' : '') +
      '</div>' +
      appendixHtml +
      (withPrintScript ?
        ('<script>function doPrint(){window.print();}var img=document.getElementById("company-logo");if(img){if(img.complete)doPrint();else{img.onload=doPrint;img.onerror=doPrint;setTimeout(doPrint,3000);}}else{setTimeout(doPrint,200);}<\/script>')
        : '') +
      '</body></html>';
    return doc;
  }

  function handlePrint(l: any) {
    var w = window.open("", "_blank", "width=800,height=1000");
    if (!w) return;
    w.document.write(buildLetterHtmlDoc(l, true));
    w.document.close();
  }

  // Render a letter to PDF in the browser (correct Hebrew/RTL) and return base64.
  // יצירת ה-PDF בשרת (Chromium — אותו מנוע של כפתור ההדפסה): עיצוב מלא,
  // נספח לרוחב, רווחים תקינים בעברית. מחליף את צילום ה-HTML (html2canvas)
  // שאיבד סגנונות ובלע רווחים. הקריאה הראשונה אחרי זמן שקט אורכת כמה שניות.
  async function fetchLetterPdf(l: any, fileBase: string): Promise<Blob> {
    var res = await fetch("/api/letter-pdf", {
      method: "POST", headers: { ...(await authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ html: buildLetterHtmlDoc(l, false), filename: safeFilename(fileBase) }),
    });
    if (!res.ok) {
      var msg = "יצירת ה-PDF נכשלה";
      try { var d = await res.json(); msg = d.error || msg; } catch (e) { /* לא JSON */ }
      throw new Error(msg);
    }
    return await res.blob();
  }
  async function letterToPdfBase64(l: any): Promise<string> {
    var blob = await fetchLetterPdf(l, (l.title || l.subject || "מכתב") + " - " + (l.contracts?.tenants?.name || ""));
    var buf = new Uint8Array(await blob.arrayBuffer());
    var bin = "";
    for (var i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.prototype.slice.call(buf, i, i + 0x8000));
    return btoa(bin);
  }
  // הורדת ה-PDF למחשב (לצירוף ידני למייל שנפתח בתוכנה המקומית). מחזיר את שם הקובץ.
  async function downloadLetterPdf(l: any, fileBase: string): Promise<string> {
    var blob = await fetchLetterPdf(l, fileBase);
    var name = safeFilename(fileBase) + ".pdf";
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
    return name;
  }

  async function deleteLetter(id: string) {
    if (!confirm("למחוק?")) return;
    await supabase.from("letters").delete().eq("id",id); await loadAll();
  }


  // Which recipient-domain a letter routes to. Money/cert/guarantee each get
  // their own contact; everything else falls back to "general".
  function routeDomain(l: any): string {
    var cat = letterCategory(l);
    return (cat === "money" || cat === "certificate" || cat === "guarantee") ? cat : "general";
  }
  // Resolve the best recipient for a letter, honoring per-domain contacts stored
  // on tenants.contacts (each contact may carry a `domains` array). Falls back:
  // domain contact → general contact → any contact with email → tenant emails.
  function resolveRecipient(l: any): { email: string; name: string; source: string } {
    var t = l.contracts?.tenants || {};
    var contacts = Array.isArray(t.contacts) ? t.contacts : [];
    var dom = routeDomain(l);
    var byDomain = contacts.find(function(c: any){ return c && c.email && contactMatchesDomain(c, dom); });
    if (byDomain) return { email: byDomain.email, name: byDomain.name || "", source: dom };
    var general = contacts.find(function(c: any){ return c && c.email && (contactMatchesDomain(c, "general") || (Array.isArray(c.domains) && c.domains.indexOf("general") !== -1)); });
    if (general) return { email: general.email, name: general.name || "", source: "general" };
    var any = contacts.find(function(c: any){ return c && c.email; });
    if (any) return { email: any.email, name: any.name || "", source: "contact" };
    return { email: t.primary_email || t.contact_email || t.email || "", name: t.name || "", source: "tenant" };
  }
  function recipientEmail(l: any): string {
    return resolveRecipient(l).email;
  }
  // ALL recipient emails for a letter's routed domain (not just the first), so a
  // tenant with several finance/money contacts has each one addressed. Same
  // fallback chain as resolveRecipient: domain contacts → general → any → tenant.
  function resolveRecipientEmails(l: any): string[] {
    var t = l.contracts?.tenants || {};
    var contacts = Array.isArray(t.contacts) ? t.contacts : [];
    var dom = routeDomain(l);
    function emailsFor(d: string): string[] {
      return contacts.filter(function(c: any){ return c && c.email && contactMatchesDomain(c, d); }).map(function(c: any){ return c.email; });
    }
    var list = emailsFor(dom);
    if (!list.length) list = emailsFor("general");
    if (!list.length) list = contacts.filter(function(c: any){ return c && c.email; }).map(function(c: any){ return c.email; });
    if (!list.length) { var te = t.primary_email || t.contact_email || t.email || ""; if (te) list = [te]; }
    return Array.from(new Set(list));
  }

  // ─── Recipients editor (per-tenant, per-domain contacts) ───
  function openRecipients(l: any) {
    var t = l.contracts?.tenants || {};
    var tid = t.id || l.contracts?.tenant_id || "";
    if (!tid) { alert("לא נמצא שוכר משויך למכתב"); return; }
    var existing = Array.isArray(t.contacts) ? t.contacts : [];
    // Seed an empty row if the tenant has no contacts yet, pre-filling any
    // legacy tenant-level email so nothing is lost.
    var seed = existing.length ? existing.map(function(c: any){ return { name: c.name || "", email: c.email || "", phone: c.phone || "", role: c.role || "", domains: Array.isArray(c.domains) ? c.domains : [] }; })
      : [{ name: t.contact_name || "", email: t.primary_email || t.contact_email || t.email || "", phone: t.phone || "", role: "", domains: ["general"] }];
    setRecip({ tenantId: tid, tenantName: t.name || "", rows: seed });
  }
  function recipUpdate(i: number, patch: any) {
    setRecip(function(prev: any){ if (!prev) return prev; var rows = prev.rows.slice(); rows[i] = { ...rows[i], ...patch }; return { ...prev, rows: rows }; });
  }
  function recipToggleDomain(i: number, dom: string) {
    setRecip(function(prev: any){
      if (!prev) return prev;
      var rows = prev.rows.slice();
      var ds = Array.isArray(rows[i].domains) ? rows[i].domains.slice() : [];
      var at = ds.indexOf(dom);
      if (at === -1) ds.push(dom); else ds.splice(at, 1);
      rows[i] = { ...rows[i], domains: ds };
      return { ...prev, rows: rows };
    });
  }
  function recipAddRow() { setRecip(function(prev: any){ if (!prev) return prev; return { ...prev, rows: prev.rows.concat([{ name: "", email: "", phone: "", role: "", domains: [] }]) }; }); }
  function recipRemoveRow(i: number) { setRecip(function(prev: any){ if (!prev) return prev; var rows = prev.rows.slice(); rows.splice(i, 1); return { ...prev, rows: rows }; }); }
  async function recipSave() {
    if (!recip) return;
    var clean = recip.rows.filter(function(r: any){ return (r.name || "").trim() || (r.email || "").trim(); });
    setRecipSaving(true);
    try {
      var { error } = await supabase.from("tenants").update({ contacts: clean }).eq("id", recip.tenantId);
      if (error) throw error;
      await logAudit({ entity_type: "tenant", entity_id: recip.tenantId, action: "update_recipients", notes: clean.length + " אנשי קשר" });
      setRecip(null); await loadAll();
    } catch (e: any) { alert("שגיאה בשמירת נמענים: " + (e?.message || e)); }
    finally { setRecipSaving(false); }
  }

  // Record that a letter was sent — to whom and when (visible in the list).
  async function markSent(l: any, to: string) {
    try {
      await supabase.from("letters").update({ status: "sent", sent_at: new Date().toISOString(), sent_to: to || null }).eq("id", l.id);
      await logAudit({ entity_type: "letter", entity_id: l.id, action: "sent", notes: to || "" });
      await loadAll();
    } catch (e: any) { /* non-fatal */ }
  }
  async function markSentManual(l: any) {
    var to = recipientEmail(l) || (l.contracts?.tenants?.name || "");
    if (!confirm("לסמן את המכתב כנשלח אל " + (to || "השוכר") + "?")) return;
    await markSent(l, recipientEmail(l));
  }
  async function unmarkSent(l: any) {
    await supabase.from("letters").update({ status: "ready", sent_at: null, sent_to: null }).eq("id", l.id);
    await loadAll();
  }
  // Move a letter between draft ⇄ ready-to-send (without touching sent state).
  async function setLetterStatus(l: any, status: string) {
    await supabase.from("letters").update({ status: status }).eq("id", l.id);
    await loadAll();
  }

  // ─── Bulk / merge actions over the current multi-selection ───
  function recipientKeyOf(l: any): string {
    return recipientEmail(l) || (l.contracts?.tenants?.name || "ללא נמען");
  }
  // Group the selected letters by CONTRACT (one unified letter per contract).
  // A tenant with two contracts therefore gets two separate merged letters —
  // never combined across contracts — each sent on its own.
  function buildMergedGroups(ids: string[]): any[] {
    var byRecip: Record<string, any> = {};
    ids.forEach(function(id) {
      var l = letters.find(function(x){ return x.id === id; });
      if (!l) return;
      var key = l.contract_id || recipientKeyOf(l);
      if (!byRecip[key]) {
        byRecip[key] = {
          key: key,
          contractId: l.contract_id,
          email: recipientEmail(l),
          tenant: l.contracts?.tenants?.name || "",
          letters: [],
        };
      }
      byRecip[key].letters.push(l);
    });
    return Object.values(byRecip).map(function(g: any) {
      var first = g.letters[0];
      var cj0 = parseCj(first);
      var cores = g.letters.map(function(l: any){ return extractLetterCore(letterBodyText(l)); });
      var grand = cores.reduce(function(s: number, c: any){ return s + (c.total || 0); }, 0);
      var multi = g.letters.length > 1;
      var detailedSubject = composeMergedSubject(g.letters, cores);
      var subject = multi ? detailedSubject : (first.title || "מכתב");

      // Payee line — reuse the company's bank details but phrased for a cheque
      // ("את ההמחאה יש לרשום לפקודת ...") to match the standard demand wording.
      var payeeLine = cj0.bankLine
        ? String(cj0.bankLine).replace("את התשלום ניתן להעביר", "את ההמחאה יש לרשום")
        : "";

      // ── ONE unified letter. The BODY is a single flowing request paragraph
      //    (one cheque, one total, the charge clauses inline) + "רצ"ב פירוט
      //    תחשיב" → the numbers live in the APPENDIX, not the body. This is the
      //    general principle for EVERY merge, regardless of which charges. ──
      var grandStr = (grand || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      var clauses = g.letters.map(function(l: any, i: number) {
        var y = billingYearOf(l, cores[i].subject);
        return chargeClause(l, cores[i].subject) + (y ? " בשנת " + y : "");
      });
      var p: string[] = [];
      p.push("לכבוד");
      p.push(g.tenant);
      p.push("");
      p.push("שלום רב,");
      p.push("");
      p.push("הנדון: " + (multi ? detailedSubject : cores[0].subject));
      p.push("");
      if (multi) {
        p.push('בהתאם להסכם השכירות ביננו נבקשך להעביר אלינו המחאה בסך ' + grandStr + ' ש"ח, בגין ' + heJoinComma(clauses) + '. רצ"ב פירוט תחשיב.');
      } else {
        p.push('בהתאם להסכם השכירות ביננו נבקשך להעביר אלינו המחאה בסך ' + grandStr + ' ש"ח, בגין ' + clauses[0] + '. רצ"ב פירוט תחשיב.');
      }
      p.push("");
      if (payeeLine) { p.push(payeeLine); p.push(""); }
      p.push("בכבוד רב ובברכה,");
      p.push("");
      p.push(cj0.companyName || "הנהלת הנכס");
      var body = p.join("\n");

      // ── APPENDIX (נספח – פירוט תחשיב): identifiers that repeat in EVERY charge
      //    are factored to a shared block at the top; each charge then lists only
      //    its own (non-shared) lines + its total, then one grand total. Portrait
      //    & compact (SECTIONP); big single-charge calcs can still be attached as
      //    landscape pages in the future. ──
      var detailsPer = cores.map(function(c: any) {
        return (c.detail || []).filter(function(d: string){ return d.indexOf('סה"כ') !== 0; });
      });
      var shared = detailsPer.length
        ? detailsPer[0].filter(function(d: string){ return detailsPer.every(function(arr: string[]){ return arr.indexOf(d) !== -1; }); })
        : [];
      var sharedSet: Record<string, boolean> = {};
      shared.forEach(function(d: string){ sharedSet[d] = true; });
      var apx: string[] = ["SECTIONP||נספח – פירוט תחשיב"];
      if (shared.length) {
        apx.push("SUBHEAD|פרטים משותפים לכל החיובים");
        shared.forEach(function(d: string){ var kv = splitKv(d); apx.push("KV|" + kv[0] + "|" + kv[1]); });
      }
      g.letters.forEach(function(l: any, i: number) {
        var y = billingYearOf(l, cores[i].subject);
        apx.push("SUBHEAD|" + (i + 1) + ". " + cores[i].subject + (y ? " — " + y : ""));
        detailsPer[i].forEach(function(d: string){
          if (sharedSet[d]) return;
          var kv = splitKv(d);
          apx.push("KV|" + kv[0] + "|" + kv[1]);
        });
        apx.push('KV|סה"כ (כולל מע"מ)|' + fmtMoney(cores[i].total));
      });
      if (multi) {
        apx.push('SUBHEAD|סה"כ כללי לתשלום');
        apx.push('KV|סה"כ כולל מע"מ|' + fmtMoney(grand));
      }
      var appendix = apx.join("\n");

      var propIds = Array.from(new Set(g.letters.map(function(l: any){ return l.property_id || l.contracts?.properties?.id; }).filter(Boolean)));
      // Synthetic letter object so handlePrint renders the full letterhead → PDF.
      var printLetter = {
        title: subject, created_at: first.created_at, contracts: first.contracts,
        content_json: { body: body, appendix: appendix, companyName: cj0.companyName, companyAddress: cj0.companyAddress, companyPhone: cj0.companyPhone, logoUrl: cj0.logoUrl },
      };
      // Address EVERY recipient of the routed domain across the group's letters
      // (deduped), not just the first — bug fix for multi-contact tenants.
      var emails: string[] = [];
      var emailSeen: Record<string, boolean> = {};
      g.letters.forEach(function(l: any){
        resolveRecipientEmails(l).forEach(function(e: string){ if (e && !emailSeen[e]) { emailSeen[e] = true; emails.push(e); } });
      });
      var primaryEmail = emails[0] || g.email;
      var cc = ccForProps(propIds as string[], primaryEmail, first);
      var units = unitsLabel(first);
      return { key: g.key, email: primaryEmail, emails: emails, tenant: g.tenant, units: units, subject: subject, body: body, grand: grand, multi: multi, letters: g.letters, printLetter: printLetter, propIds: propIds, cc: cc };
    });
  }
  function openMergePreview() {
    var ids = selectedIds();
    if (ids.length === 0) { alert("יש לבחור מכתבים"); return; }
    setMergeView(buildMergedGroups(ids));
  }
  // Send each recipient group as a single email (local mail client) and mark
  // every letter in it as sent.
  // Short covering email body — the letter itself rides as a PDF attachment.
  function shortEmailHtml(tenant: string, subjectText: string, company: string): string {
    return '<div dir="rtl" style="font-family:Arial,sans-serif;direction:rtl;font-size:14px;color:#1e293b">'
      + 'שלום ' + (tenant || '') + ',<br><br>'
      + 'רצ"ב מכתב בנושא <b>' + subjectText + '</b>.<br>'
      + 'נא לעיין במסמך המצורף ולפעול בהתאם.<br><br>'
      + 'בברכה,<br>' + (company || 'הנהלת הנכס') + '</div>';
  }
  function safeFilename(s: string): string {
    return (s || "letter").replace(/[^\w֐-׿ .-]/g, "_").slice(0, 80);
  }

  // Send ONE merged letter per recipient as a PDF attachment via Resend (mailto
  // can't attach files), CC'ing the property's authorized users.
  async function sendMergeGroup(g: any): Promise<boolean> {
    // All domain recipients (deduped); first is "to", the rest go to Cc.
    var toList: string[] = (g.emails && g.emails.length) ? g.emails : (g.email ? [g.email] : []);
    if (!toList.length) { return false; }
    // רענון עותקים חי לרגע השליחה (המכותבים הפנימיים לפי נושא המכתב הראשון בקבוצה).
    try {
      var liveCc = await ccForPropsLive(g.propIds || [], toList[0], (g.letters && g.letters[0]) || null);
      g = { ...g, cc: Array.from(new Set((g.cc || []).concat(liveCc))) };
    } catch (e) { /* keep precomputed cc */ }
    // PDF filename = subject + tenant, so each attachment is self-identifying.
    var fileBase = g.subject + " - " + (g.tenant || "");
    // Test mode: open the local mail client with the unified text, addressing
    // ALL domain recipients (mailto can't attach the PDF — use the 🖨 button).
    if (testMode) {
      var pureTestM = emailReady !== false;
      var ccM = pureTestM ? [] : (g.cc || []);
      var bodyM = pureTestM ? g.body
        : "שלום " + (g.tenant || "") + ",\n\nרצ\"ב מכתב בנושא " + g.subject + ".\nנא לעיין במסמך המצורף ולפעול בהתאם.\n\nבברכה,\n" + (parseCj(g.letters[0]).companyName || "הנהלת הנכס");
      var mt = "mailto:" + encodeURIComponent(toList.join(",")) + "?" +
        (ccM.length ? "cc=" + encodeURIComponent(ccM.join(",")) + "&" : "") +
        "subject=" + encodeURIComponent(g.subject) + "&body=" + encodeURIComponent(bodyM);
      if (!pureTestM) {
        try {
          var fnameM = await downloadLetterPdf(g.printLetter, fileBase);
          alert("📎 " + (g.tenant || "") + ": קובץ המכתב המאוחד ירד למחשב:\n" + fnameM + "\n\nתוכנת המייל נפתחת עכשיו — צרף את הקובץ להודעה לפני השליחה.");
        } catch (e: any) {
          alert("📄 לא הצלחתי ליצור את ה-PDF בשרת (" + (e?.message || e) + ").\nייפתח חלון ההדפסה — בחר \"שמור כ-PDF\" וצרף למייל.");
          handlePrint(g.printLetter);
        }
      }
      window.open(mt, "_blank");
      for (var k = 0; k < g.letters.length; k++) {
        await supabase.from("letters").update({ status: "sent", sent_at: new Date().toISOString(), sent_to: toList.join(", ") }).eq("id", g.letters[k].id);
      }
      await logAudit({ entity_type: "letter", entity_id: g.letters[0].id, action: "merge_sent_local", notes: g.letters.length + " חיובים → " + toList.join(", ") });
      return true;
    }
    var company = parseCj(g.letters[0]).companyName || "";
    var pdf = await letterToPdfBase64(g.printLetter);
    // Cc = the remaining domain recipients + the property's authorized users.
    var ccList = Array.from(new Set((toList.slice(1)).concat(g.cc || [])));
    var res = await fetch("/api/send-letter", {
      method: "POST", headers: await authHeaders(),
      body: JSON.stringify({
        to: toList[0], cc: ccList, subject: g.subject,
        shortHtml: shortEmailHtml(g.tenant, g.subject, company),
        pdfBase64: pdf, filename: safeFilename(fileBase),
      }),
    });
    var d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || "שליחה נכשלה");
    var sentTo = toList.join(", ") + (ccList.length ? " (עותק: " + ccList.join(", ") + ")" : "");
    for (var i = 0; i < g.letters.length; i++) {
      await supabase.from("letters").update({ status: "sent", sent_at: new Date().toISOString(), sent_to: sentTo }).eq("id", g.letters[i].id);
    }
    await logAudit({ entity_type: "letter", entity_id: g.letters[0].id, action: "merge_sent_pdf", notes: g.letters.length + " חיובים → " + toList.join(", ") });
    return true;
  }
  async function sendAllMergeGroups() {
    if (!mergeView) return;
    setSending("merge");
    try {
      var sent = 0, skipped = 0;
      for (var i = 0; i < mergeView.length; i++) {
        try { if (await sendMergeGroup(mergeView[i])) sent++; else skipped++; }
        catch (e: any) { alert("שגיאה בשליחה ל" + (mergeView[i].tenant || "") + ": " + (e?.message || e)); }
      }
      setMergeView(null); clearSelection(); await loadAll();
      alert("✅ נשלחו " + sent + " מיילים עם PDF מצורף" + (skipped ? " · דולגו " + skipped + " (ללא כתובת מייל)" : ""));
    } finally { setSending(""); }
  }

  // Single-letter send with the PDF attached (primary send path).
  async function sendLetterPdf(l: any) {
    // Address EVERY recipient of the letter's domain, not just the first.
    var toList = resolveRecipientEmails(l);
    if (!toList.length) { alert("אין כתובת מייל לנמען — הוסף נמען דרך '✎ נמענים'."); return; }
    var tenant = l.contracts?.tenants?.name || "";
    var subject = l.title || l.subject || "מכתב";
    var company = parseCj(l).companyName || "";
    var propIds = [l.property_id || l.contracts?.properties?.id].filter(Boolean) as string[];
    // Filename = subject + tenant; Cc = remaining domain emails + authorized users.
    var fileBase = subject + " - " + tenant;
    var cc = Array.from(new Set(toList.slice(1).concat(await ccForPropsLive(propIds, toList[0], l))));
    // שקיפות לפני שליחה: מי הנמען ומי מקבל עותק — כך ברור מיד אם מכותב חסר.
    if (!confirm("שליחה אל: " + toList[0] +
      (cc.length ? "\nעותקים (CC): " + cc.join(", ") : "\nללא עותקים") +
      "\n\nלשלוח?")) return;
    setSending(l.id);
    try {
      var pdf = await letterToPdfBase64(l);
      var res = await fetch("/api/send-letter", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ to: toList[0], cc: cc, subject: subject, shortHtml: shortEmailHtml(tenant, subject, company), pdfBase64: pdf, filename: safeFilename(fileBase) }),
      });
      var d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "שליחה נכשלה");
      await markSent(l, toList.join(", ") + (cc.length ? " (עותק: " + cc.join(",") + ")" : ""));
      alert("✅ נשלח עם קובץ PDF מצורף" + (cc.length ? " (+" + cc.length + " עותקים)" : ""));
    } catch (e: any) { alert("שגיאת שליחה: " + (e?.message || e)); }
    finally { setSending(""); }
  }
  async function bulkMarkSent() {
    var ids = selectedIds();
    if (ids.length === 0) return;
    if (!confirm("לסמן " + ids.length + " מכתבים כנשלחו (ידנית)?")) return;
    for (var i = 0; i < ids.length; i++) {
      var l = letters.find(function(x){ return x.id === ids[i]; });
      await supabase.from("letters").update({ status: "sent", sent_at: new Date().toISOString(), sent_to: l ? recipientEmail(l) : null }).eq("id", ids[i]);
    }
    clearSelection(); await loadAll();
  }
  async function bulkSetReady() {
    var ids = selectedIds();
    for (var i = 0; i < ids.length; i++) { await supabase.from("letters").update({ status: "ready" }).eq("id", ids[i]); }
    clearSelection(); await loadAll();
  }
  async function bulkDelete() {
    var ids = selectedIds();
    if (ids.length === 0) return;
    if (!confirm("למחוק " + ids.length + " מכתבים?")) return;
    await supabase.from("letters").delete().in("id", ids);
    clearSelection(); await loadAll();
  }

  // Extract the actual letter text from content_json (string or object).
  function letterBodyText(l: any): string {
    var cj = l.content_json;
    if (typeof cj === "string") { try { cj = JSON.parse(cj); } catch (e) { return cj; } }
    return (cj && cj.body) || l.body || "";
  }

  // Open the user's LOCAL mail program (mailto) pre-filled with the real
  // letter content, then mark the letter as sent for traceability.
  async function handleEmail(l: any) {
    var title = l.title || l.subject || "מכתב";
    var tenant = l.contracts?.tenants?.name || "";
    // Every address marked for this letter's domain, not just the first.
    var toList = resolveRecipientEmails(l);
    var toStr = toList.join(",");
    var body = letterBodyText(l).trim() ||
      ("שלום " + tenant + ",\n\nמצורף בזאת " + title + ".\nנא לעיין ולפעול בהתאם.\n\nבברכה,\nהנהלת הנכס");
    // כששירות הדואר לא מופעל, תוכנת המייל המקומית היא ערוץ השליחה האמיתי —
    // ולכן העותקים (מורשים + מכותבים פנימיים) כן ממולאים. "מצב בדיקה" בלי
    // עותקים קיים רק כשיש ערוץ אמיתי אחר להשוות אליו.
    var pureTest = testMode && emailReady !== false;
    // כשה-PDF מצורף (ידנית) גוף המייל הוא מעטפת קצרה לפי נושא המכתב —
    // לא כל טקסט המכתב עם הסכומים. הטקסט המלא נשאר רק במצב בדיקה טהור.
    if (!pureTest) {
      var companyL = parseCj(l).companyName || "הנהלת הנכס";
      body = "שלום " + tenant + ",\n\nרצ\"ב מכתב בנושא " + title + ".\nנא לעיין במסמך המצורף ולפעול בהתאם.\n\nבברכה,\n" + companyL;
    }
    // דפדפן אינו יכול לצרף קובץ למייל שנפתח בתוכנה המקומית: ה-PDF נוצר
    // בשרת (זהה להדפסה) ויורד למחשב, ואז תוכנת המייל נפתחת עם תזכורת לצרף.
    // אם השרת נכשל — נופלים לחלון ההדפסה (שמור כ-PDF).
    if (!pureTest) {
      setSending(l.id);
      try {
        var fname = await downloadLetterPdf(l, title + " - " + tenant);
        alert("📎 קובץ המכתב ירד למחשב:\n" + fname + "\n\nתוכנת המייל נפתחת עכשיו — אל תשכח לצרף את הקובץ להודעה לפני השליחה.");
      } catch (e: any) {
        alert("📄 לא הצלחתי ליצור את ה-PDF בשרת (" + (e?.message || e) + ").\nייפתח חלון ההדפסה של המכתב — בחר בו \"שמור כ-PDF\", ואז צרף את הקובץ למייל.");
        handlePrint(l);
      } finally { setSending(""); }
    }
    var propIds = [l.property_id || l.contracts?.properties?.id].filter(Boolean);
    var cc = pureTest ? "" : (await ccForPropsLive(propIds as string[], toList[0] || "", l)).join(",");
    if (pureTest && propIds.length) {
      // שלא ייראה כתקלה: במצב בדיקה עותקים מנוטרלים בכוונה.
      console.info("מצב בדיקה — עותקים (CC) לא צורפו בכוונה");
    }
    var mailto = "mailto:" + encodeURIComponent(toStr) + "?" +
      (cc ? "cc=" + encodeURIComponent(cc) + "&" : "") +
      "subject=" + encodeURIComponent(title) +
      "&body=" + encodeURIComponent(body);
    // window.location triggers the OS mail handler reliably without leaving the app.
    window.location.href = mailto;
    // Record the send (recipient + timestamp) so it's traceable in the list.
    markSent(l, toStr + (cc ? " (עותק: " + cc + ")" : ""));
  }

  // Primary single-letter send: local mail client in test mode, else PDF+CC.
  function sendPrimary(l: any) {
    if (testMode) handleEmail(l); else sendLetterPdf(l);
  }

  var statusCounts = letters.reduce(function(a: any, l: any) {
    var s = l.status || "draft"; a[s] = (a[s] || 0) + 1; return a;
  }, {} as Record<string, number>);

  return (
    <div dir="rtl" className={selectedIds().length > 0 ? "pb-24" : ""}>
      <PageHero title="מכתבים" icon="✉️" tone="blue"
        subtitle={<span className="flex items-center gap-2 flex-wrap">
          <span>{letters.length} מכתבים</span>
          {statusCounts.draft ? <span className="text-white/70">· ✎ {statusCounts.draft} טיוטה</span> : null}
          {statusCounts.ready ? <span className="text-white">· 📤 {statusCounts.ready} מוכן לשליחה</span> : null}
          {statusCounts.sent ? <span className="text-emerald-200">· ✓ {statusCounts.sent} נשלח</span> : null}
        </span>}
        actions={
          <>
            {emailReady !== false && <button onClick={toggleTestMode}
              className={"rounded-xl px-3 py-2 text-xs font-bold border " + (testMode ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" : "bg-white text-green-700 border-white hover:bg-green-50")}
              title={testMode ? "מצב בדיקה: שליחה דרך תוכנת המייל המקומית בלבד, ללא PDF וללא עותקים. לחץ למעבר לשליחה אמיתית." : "מצב שליחה אמיתית: PDF מצורף + עותקים למורשים (דורש Resend). לחץ לחזרה למצב בדיקה."}>
              {testMode ? "🧪 מצב בדיקה (מייל מקומי)" : "🚀 שליחה אמיתית (PDF + עותקים)"}
            </button>}
            <button onClick={openNew} className="rounded-xl bg-white text-blue-700 px-4 py-2 text-sm font-bold hover:bg-blue-50 shadow-sm">+ מכתב חדש</button>
          </>
        } />

      {emailReady === false && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-900" dir="rtl">
          📎 השליחה מתבצעת דרך תוכנת המייל שלך. בכל לחיצה על &quot;שלח&quot; קובץ ה-PDF של המכתב יורד למחשב (הפעם הראשונה אורכת כמה שניות) — צרף אותו להודעה לפני השליחה.
        </div>
      )}

      {loading ? <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div> : letters.length===0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">✉️</div><div>אין מכתבים</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ מכתב חדש</button>
        </div>
      ) : (() => {
        // ─── Build filter options + apply filters ───
        var allYears: number[] = [];
        var allProps: Record<string, string> = {};
        letters.forEach(function(l: any) {
          var y = l.billing_year || (l.created_at ? new Date(l.created_at).getFullYear() : 0);
          if (y && allYears.indexOf(y) === -1) allYears.push(y);
          var pid = l.property_id || l.contracts?.properties?.id || "";
          var pname = l.contracts?.properties?.name || "ללא נכס";
          if (pid || pname) allProps[pid || pname] = pname;
        });
        allYears.sort(function(a, b) { return b - a; });

        var filtered = letters.filter(function(l: any) {
          if (filterType && letterCategory(l) !== filterType) return false;
          var ly = l.billing_year || (l.created_at ? new Date(l.created_at).getFullYear() : 0);
          if (filterYear && String(ly) !== filterYear) return false;
          var pid = l.property_id || l.contracts?.properties?.id || "";
          var pname = l.contracts?.properties?.name || "ללא נכס";
          if (filterProp && (pid || pname) !== filterProp) return false;
          if (filterStatus) {
            var st = l.status || "draft";
            if (st !== filterStatus) return false;
          }
          if (search) {
            var q = search.toLowerCase();
            var hay = ((l.title || "") + " " + (l.contracts?.tenants?.name || "") + " " + (l.contracts?.properties?.name || "")).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
          }
          return true;
        });

        // Group a subset of letters by property. `prefix` keeps the collapse
        // keys unique across the two send-state sections (same property can
        // appear in both "ממתינים" and "נשלחו").
        var buildGroups = function(items: any[], prefix: string) {
          var groups: Record<string, { name: string; key: string; items: any[] }> = {};
          items.forEach(function(l: any) {
            var pid = l.property_id || l.contracts?.properties?.id || "";
            var pname = l.contracts?.properties?.name || "ללא נכס";
            var key = prefix + ":" + (pid || pname);
            if (!groups[key]) groups[key] = { name: pname, key: key, items: [] };
            groups[key].items.push(l);
          });
          return Object.values(groups).sort(function(a, b) { return a.name.localeCompare(b.name, "he"); });
        };

        // Split: not-yet-sent (draft + ready) vs already sent.
        var unsentLetters = filtered.filter(function(l: any){ return (l.status || "draft") !== "sent"; });
        var sentLetters   = filtered.filter(function(l: any){ return (l.status || "draft") === "sent"; });
        var unsentGroups = buildGroups(unsentLetters, "unsent");
        var sentGroups   = buildGroups(sentLetters, "sent");

        return (
          <>
            {/* Filter bar */}
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <input
                  type="text"
                  value={search}
                  onChange={function(e){setSearch(e.target.value);}}
                  placeholder="🔍 חיפוש לפי נושא / שוכר / נכס"
                  className={ic}
                />
              </div>
              <select value={filterYear} onChange={function(e){setFilterYear(e.target.value);}} className={ic + " w-full sm:w-32"}>
                <option value="">📅 שנה: הכל</option>
                {allYears.map(function(y){ return <option key={y} value={String(y)}>{y}</option>; })}
              </select>
              <select value={filterType} onChange={function(e){setFilterType(e.target.value);}} className={ic + " w-full sm:w-48"}>
                <option value="">📋 סוג: הכל</option>
                {LETTER_CATEGORIES.map(function(c){ return <option key={c.key} value={c.key}>{c.icon} {c.label}</option>; })}
              </select>
              <select value={filterProp} onChange={function(e){setFilterProp(e.target.value);}} className={ic + " w-full sm:w-44"}>
                <option value="">🏢 נכס: הכל</option>
                {Object.keys(allProps).map(function(k){ return <option key={k} value={k}>{allProps[k]}</option>; })}
              </select>
              <select value={filterStatus} onChange={function(e){setFilterStatus(e.target.value);}} className={ic + " w-full sm:w-36"}>
                <option value="">✉️ סטטוס: הכל</option>
                <option value="draft">טיוטה</option>
                <option value="ready">מוכן לשליחה</option>
                <option value="sent">נשלח</option>
              </select>
              {(search||filterYear||filterType||filterProp||filterStatus) && (
                <button onClick={function(){setSearch("");setFilterYear("");setFilterType("");setFilterProp("");setFilterStatus("");}} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 border border-slate-200 rounded">✕ נקה</button>
              )}
              <div className="text-xs text-slate-500 mr-auto">
                {filtered.length} מתוך {letters.length}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-8 text-center text-slate-400 text-sm">
                לא נמצאו מכתבים התואמים את הסינון
              </div>
            ) : (
              <div className="space-y-5">
                {(function(){
                  var renderGroup = function(g: any) {
                  var collapsed = !!collapsedGroups[g.key];
                  var allSel = g.items.length > 0 && g.items.every(function(l: any){ return selected[l.id]; });
                  return (
                    <div key={g.key} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                      <div className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-right">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={allSel}
                            onChange={function(e){ setGroupSelected(g.items, e.target.checked); }}
                            className="w-4 h-4 cursor-pointer accent-blue-600"
                            title="בחר את כל המכתבים בנכס"
                          />
                          <button onClick={function(){toggleGroup(g.key);}} className="flex items-center gap-2">
                            <span className="text-lg">🏢</span>
                            <span className="font-bold text-slate-800">{g.name}</span>
                            <span className="text-xs text-slate-500">— {g.items.length} מכתבים</span>
                          </button>
                        </div>
                        <button onClick={function(){toggleGroup(g.key);}} className="text-slate-400 text-sm">{collapsed ? "▶" : "▼"}</button>
                      </div>
                      {!collapsed && (
                        <table className="w-full text-right text-sm">
                          <tbody>
                            {g.items.map(function(l: any) {
                              const cat = categoryInfo(letterCategory(l));
                              const st = l.status || "draft";
                              const isSent = st === "sent";
                              const isReady = st === "ready";
                              const recEmail = recipientEmail(l);
                              const checked = !!selected[l.id];
                              return (
                                <tr key={l.id} className={"border-t border-slate-100 hover:bg-slate-50" + (checked ? " bg-blue-50/40" : "")}>
                                  <td className="pr-4 pl-1 py-2.5 w-8">
                                    <input type="checkbox" checked={checked} onChange={function(){toggleSelect(l.id);}} className="w-4 h-4 cursor-pointer accent-blue-600" />
                                  </td>
                                  <td className="px-1 py-2.5 w-8 text-base" title={cat.label}>{cat.icon}</td>
                                  <td className="px-2 py-2.5">
                                    <div className="font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">
                                      {l.title || "—"}
                                      {unitsLabel(l) && <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-1.5 py-0.5 font-semibold" title="הסכם / יחידות">🏠 {unitsLabel(l)}</span>}
                                      {(function(){
                                        var cj = l.content_json; if (typeof cj === "string") { try { cj = JSON.parse(cj); } catch(e){ cj = null; } }
                                        var corrected = (cj && cj.corrected) || (l.title || "").indexOf("מתוקן") !== -1;
                                        return corrected ? <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5 font-semibold">🔧 מתוקן</span> : null;
                                      })()}
                                    </div>
                                    <div className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">
                                      <span>אל: {l.contracts?.tenants?.name || "—"}</span>
                                      {(function(){
                                        var emails = resolveRecipientEmails(l);
                                        var dom = RECIPIENT_DOMAINS.find(function(d){ return d.key === routeDomain(l); });
                                        return (
                                          <>
                                            {emails.length
                                              ? <span className="text-slate-600" title={emails.join(", ")}>· {dom ? dom.icon : ""} {emails.join(", ")}</span>
                                              : <span className="text-amber-600">· ⚠ אין נמען לנושא {dom ? dom.label : ""}</span>}
                                            <button onClick={function(){openRecipients(l);}} className="text-blue-500 hover:text-blue-700 border border-slate-200 rounded px-1 leading-none" title="עריכת נמענים לפי תחום">✎ נמענים</button>
                                          </>
                                        );
                                      })()}
                                    </div>
                                  </td>
                                  <td className="px-2 py-2.5 w-32">
                                    {isSent ? (
                                      <div className="text-[11px]">
                                        <span className="bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-semibold">✓ נשלח</span>
                                        <div className="text-slate-400 mt-0.5">{fmtDate(l.sent_at)}{l.sent_to ? " · " + l.sent_to : ""}</div>
                                      </div>
                                    ) : isReady ? (
                                      <span className="text-[11px] bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-semibold">📤 מוכן לשליחה</span>
                                    ) : (
                                      <span className="text-[11px] bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">✎ טיוטה</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-2.5 text-xs text-slate-400 whitespace-nowrap w-20">{fmtDate(l.created_at)}</td>
                                  <td className="px-4 py-2.5 w-56">
                                    <div className="flex gap-1 justify-end flex-wrap">
                                      <button onClick={function(){setPreview(l);}} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50" title="תצוגה מקדימה">👁</button>
                                      <button onClick={function(){handlePrint(l);}} className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50" title="הדפסה / PDF">🖨</button>
                                      {!isSent && (isReady
                                        ? <button onClick={function(){setLetterStatus(l, "draft");}} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-500 hover:bg-slate-50" title="החזר לטיוטה">✎</button>
                                        : <button onClick={function(){setLetterStatus(l, "ready");}} className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50" title="סמן כמוכן לשליחה">📤</button>)}
                                      <button onClick={function(){sendPrimary(l);}} disabled={sending===l.id} className="text-xs border border-green-300 bg-green-50 rounded px-2 py-1 text-green-700 hover:bg-green-100 disabled:opacity-50 font-semibold" title={testMode ? "שלח דרך תוכנת המייל המקומית" : "שלח במייל עם PDF מצורף + עותקים (דרך המערכת)"}>{sending===l.id ? (testMode ? "מכין קובץ…" : "שולח…") : (testMode ? "📧 שלח" : "📎 שלח")}</button>
                                      {!testMode && <button onClick={function(){handleEmail(l);}} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-500 hover:bg-slate-50" title="פתח בתוכנת המייל המקומית (ללא קובץ מצורף)">✉️</button>}
                                      {isSent
                                        ? <button onClick={function(){unmarkSent(l);}} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-500 hover:bg-slate-50" title="החזר ל'מוכן לשליחה'">↩</button>
                                        : <button onClick={function(){markSentManual(l);}} className="text-xs border border-emerald-200 rounded px-2 py-1 text-emerald-600 hover:bg-emerald-50" title="סמן כנשלח (אם נשלח בדואר/ידנית)">✓</button>}
                                      <button onClick={function(){deleteLetter(l.id);}} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50" title="מחק">🗑</button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                  };
                  return (
                    <>
                      {unsentGroups.length > 0 && (
                        <div className="mb-5">
                          <div className="flex items-center gap-2 mb-2 px-1">
                            <span className="text-sm font-bold text-slate-700">📤 ממתינים לשליחה</span>
                            <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-semibold">{unsentLetters.length}</span>
                          </div>
                          <div className="space-y-3">{unsentGroups.map(renderGroup)}</div>
                        </div>
                      )}
                      {sentGroups.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-2 px-1 pt-3 border-t border-slate-200">
                            <span className="text-sm font-bold text-slate-700">✓ נשלחו</span>
                            <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-semibold">{sentLetters.length}</span>
                          </div>
                          <div className="space-y-3">{sentGroups.map(renderGroup)}</div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </>
        );
      })()}

      {/* ─── Sticky multi-select action bar ─── */}
      {selectedIds().length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] px-4 py-3" dir="rtl">
          <div className="max-w-5xl mx-auto flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-800 text-sm">{selectedIds().length} מכתבים נבחרו</span>
            <span className="text-xs text-slate-400">{buildMergedGroups(selectedIds()).length} מכתבים מאוחדים (לפי הסכם)</span>
            <div className="flex gap-2 mr-auto flex-wrap">
              <button onClick={openMergePreview} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">📧 מזג ושלח במייל</button>
              <button onClick={bulkSetReady} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">📤 סמן מוכן לשליחה</button>
              <button onClick={bulkMarkSent} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">✓ סמן כנשלח</button>
              <button onClick={bulkDelete} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-100">🗑 מחק</button>
              <button onClick={clearSelection} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">נקה בחירה</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Merged-letter preview before sending ─── */}
      {mergeView && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setMergeView(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-800 text-lg">תצוגה מקדימה לפני שליחה</h2>
                <p className="text-xs text-slate-500 mt-0.5">{mergeView.length} מכתבים מאוחדים · מכתב נפרד לכל הסכם</p>
              </div>
              <button onClick={function(){setMergeView(null);}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              {mergeView.map(function(g: any, gi: number) {
                return (
                  <div key={gi} className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-bold text-slate-800">{g.tenant || "נמען"}</span>
                        {g.units && <span className="text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-1.5 py-0.5 font-semibold mr-2" title="הסכם / יחידות">🏠 {g.units}</span>}
                        <span className="text-slate-400 text-xs mr-2">{(g.emails && g.emails.length) ? "אל: " + g.emails.join(", ") : "אין כתובת מייל"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {g.multi && <span className="text-[11px] bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-semibold">סה"כ {fmtMoney(g.grand)}</span>}
                        <span className="text-[11px] bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-semibold">{g.letters.length} חיובים → מכתב אחד</span>
                        <button onClick={function(){handlePrint(g.printLetter);}} className="text-[11px] border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50 font-semibold" title="הורד / הדפס PDF של המכתב המאוחד">🖨 PDF</button>
                      </div>
                    </div>
                    <div className="p-3">
                      <div className="text-xs font-semibold text-slate-600 mb-1">נושא: {g.subject}</div>
                      <div className="text-xs text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3 border max-h-52 overflow-y-auto">{g.body}</div>
                      {!testMode && g.cc && g.cc.length > 0 && <div className="text-[11px] text-slate-500 mt-1">📋 עותק (CC) ל: {g.cc.join(", ")}</div>}
                      {!g.email && <div className="text-[11px] text-amber-600 mt-1">⚠️ אין כתובת מייל לנמען — המייל ייפתח ריק ותצטרך להזין כתובת ידנית.</div>}
                    </div>
                  </div>
                );
              })}
              <div className="flex gap-3 pt-1">
                <button onClick={function(){setMergeView(null);}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={sendAllMergeGroups} disabled={sending==="merge"} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">{sending==="merge" ? "שולח…" : (testMode ? "📧 פתח " + mergeView.length + " במייל מקומי" : "📎 שלח " + mergeView.length + " מיילים עם PDF מצורף")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Recipients editor: per-domain contacts for a tenant ─── */}
      {recip && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setRecip(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-800 text-lg">נמענים — {recip.tenantName}</h2>
                <p className="text-xs text-slate-500 mt-0.5">לכל איש קשר ניתן לשייך תחומים. מכתב מנותב אוטומטית לאיש הקשר של התחום שלו (כספים / אישורים / ערבויות), אחרת ל"כללי".</p>
              </div>
              <button onClick={function(){setRecip(null);}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              {recip.rows.map(function(r: any, i: number) {
                return (
                  <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <input value={r.name} onChange={function(e){recipUpdate(i,{name:e.target.value});}} placeholder="שם איש קשר" className={ic}/>
                      <input value={r.email} onChange={function(e){recipUpdate(i,{email:e.target.value});}} placeholder="אימייל" className={ic} type="email" dir="ltr"/>
                      <input value={r.phone} onChange={function(e){recipUpdate(i,{phone:e.target.value});}} placeholder="טלפון" className={ic} dir="ltr"/>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-slate-500">תחומים:</span>
                      {RECIPIENT_DOMAINS.map(function(d){
                        var on = Array.isArray(r.domains) && r.domains.indexOf(d.key) !== -1;
                        return (
                          <button key={d.key} type="button" onClick={function(){recipToggleDomain(i,d.key);}}
                            className={"rounded-full border px-2.5 py-1 text-xs font-semibold " + (on ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                            {d.icon} {d.label}
                          </button>
                        );
                      })}
                      <button onClick={function(){recipRemoveRow(i);}} className="mr-auto text-xs text-red-400 hover:text-red-600 border border-red-100 rounded px-2 py-1">🗑 הסר</button>
                    </div>
                  </div>
                );
              })}
              <button onClick={recipAddRow} className="text-sm text-blue-600 hover:underline">+ הוסף איש קשר</button>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setRecip(null);}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={recipSave} disabled={recipSaving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{recipSaving ? "שומר..." : "שמור נמענים"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">מכתב חדש</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                  <select value={fContractId} onChange={function(e){setFContractId(e.target.value);if(fTemplateId)fillTemplate(fTemplateId,e.target.value);}} className={ic}>
                    <option value="">-- בחר --</option>
                    {contracts.map(function(c){return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>;})}
                  </select>
                </div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">תבנית</label>
                  <select value={fTemplateId} onChange={function(e){setFTemplateId(e.target.value);if(fContractId)fillTemplate(e.target.value,fContractId);}} className={ic}>
                    <option value="">-- ללא --</option>
                    {templates.map(function(t){return <option key={t.id} value={t.id}>{t.name}</option>;})}
                  </select>
                </div>
              </div>
              <div><div className="flex gap-2 flex-wrap">
                {LETTER_TYPES.map(function(t){return <button key={t.v} type="button" onClick={function(){setFType(t.v);}} className={"rounded-xl border px-3 py-1.5 text-xs font-semibold "+(fType===t.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>{t.icon} {t.l}</button>;})}
              </div></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">נושא *</label><input type="text" value={fSubject} onChange={function(e){setFSubject(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">תוכן</label><textarea value={fBody} onChange={function(e){setFBody(e.target.value);}} rows={10} className={ic+" font-mono text-xs"}/></div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving?"שומר...":"שמור"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setPreview(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">{preview.title || preview.subject || "מכתב"}</h2>
              <div className="flex gap-2">
                <button onClick={function(){handlePrint(preview);}} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white">🖨 הדפס</button>
                <button onClick={function(){setPreview(null);}} className="text-2xl text-slate-400">×</button>
              </div>
            </div>
            <div className="p-6">
              <div className="text-xs text-slate-400 mb-4">{fmtDate(preview.created_at)} | {preview.contracts?.tenants?.name}</div>
              <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap bg-slate-50 rounded-xl p-4 border">{(typeof preview.content_json === "string" ? JSON.parse(preview.content_json)?.body : preview.content_json?.body) ?? preview.body ?? "אין תוכן"}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
