"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import TenantContactsEditor from '@/components/TenantContactsEditor';
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import { fetchCpiAdjusted, fetchHighestChainedCpi } from '@/lib/cpi-server';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';
import { getKnownIndexMonth } from '@/lib/cpi-utils';
import CalcProgress, { CalcProgressState } from '@/components/CalcProgress';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function fmtMoney(n: number) { return n ? "₪"+n.toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—"; }

export default function TenantsPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string|null>(null);
  const [editingId, setEditingId] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  // הפרדה בין שוכרים פעילים לשוכרי עבר: פעיל = יש לו לפחות הסכם חי אחד
  // (כולל חתום שטרם החל); עבר = כל הסכמיו הסתיימו או שאין לו הסכם כלל.
  const [filterLife, setFilterLife] = useState<"active" | "past" | "all">("active");
  const [fName, setFName] = useState("");
  const [fCompany, setFCompany] = useState("");
  const [fIdNumber, setFIdNumber] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fAddress, setFAddress] = useState("");
  const [fCity, setFCity] = useState("");
  const [fContactName, setFContactName] = useState("");
  const [fContactPhone, setFContactPhone] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fContacts, setFContacts] = useState<{name:string;role:string;email:string;phone:string;topics?:string[]}[]>([]);
  const [cpiRatios, setCpiRatios] = useState<Record<string, number>>({});
  const [cpiProgress, setCpiProgress] = useState<CalcProgressState | null>(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [{ data: t }, { data: c }] = await Promise.all([
      supabase.from("tenants").select("*").order("name"),
      supabase.from("contracts")
        .select("id, property_id, status, start_date, end_date, rent_per_sqm, charged_area, investment_addition, tenant_id, is_amendment, parent_contract_id, amendment_date, amendment_number, index_base_date, indexation_method, index_mechanism, properties(name), contract_spaces(area_override,spaces(space_name))")
        // "ended" נטען גם הוא: מסווג שוכרי עבר, מציג את ההיסטוריה שלהם,
        // ומאפשר למשתמש מוגבל לראות שוכרי עבר של הנכסים שבהיקפו.
        .in("status", ["active","expiring","extended","upcoming","future","ended"]).order("end_date"),
    ]);
    // Data-level scoping: a scoped user sees only tenants that hold at least
    // one contract in an allowed property.
    var scope = await getScopeIds();
    var scC = scopeRows(c ?? [], scope, function(x: any){ return x.property_id; });
    var tidOk: Record<string, boolean> = {};
    scC.forEach(function(x: any){ if (x.tenant_id) tidOk[x.tenant_id] = true; });
    var scT = scope === null ? (t ?? []) : (t ?? []).filter(function(x: any){ return !!tidOk[x.id]; });
    setTenants(scT);
    setContracts(scC);
    setLoading(false);
    if (!selected && scT.length > 0) {
      // ברירת המחדל היא לשונית "פעילים" — נבחר שוכר שנראה בה
      var liveT: Record<string, boolean> = {};
      scC.forEach(function(x: any){ if (!x.is_amendment && x.tenant_id && ["active","expiring","extended","upcoming","future"].indexOf(x.status) !== -1) liveT[x.tenant_id] = true; });
      var first = scT.find(function(x: any){ return !!liveT[x.id]; }) || scT[0];
      setSelected(first.id);
    }
    // Per-contract CPI ratios. Group by (base date + mechanism) to dedupe
    // CBS calls; each contract still gets its own ratio.
    try {
      var toCbsDate = function(d: string): string {
        var dt = new Date(d); if (dt.getDate() === 15) dt.setDate(16);
        var mm = String(dt.getMonth()+1).padStart(2,"0");
        var dd = String(dt.getDate()).padStart(2,"0");
        return mm + "-" + dd + "-" + dt.getFullYear();
      };
      var now = new Date();
      var todayCbs = String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0")+"-"+now.getFullYear();
      var nowKnown = getKnownIndexMonth(now);

      var validContracts = (c ?? []).filter(function(x: any) {
        return x.index_base_date && x.indexation_method && x.indexation_method !== "none";
      });

      var groupMap: Record<string, { contractIds: string[]; fromDate: string; rawBase: string; isHighest: boolean }> = {};
      validContracts.forEach(function(x: any) {
        var fromDate = toCbsDate(x.index_base_date);
        var isHighest = x.indexation_method === "highest_in_period" || x.indexation_method === "no_drop"
          || x.index_mechanism === "highest_in_period" || x.index_mechanism === "no_drop";
        var key = fromDate + "|" + (isHighest ? "H" : "S");
        if (!groupMap[key]) groupMap[key] = { contractIds: [], fromDate: fromDate, rawBase: x.index_base_date, isHighest: isHighest };
        groupMap[key].contractIds.push(x.id);
      });

      var groupKeysT = Object.keys(groupMap);
      var calcStartT = Date.now();
      setCpiProgress({ current: 0, total: groupKeysT.length, label: "מחשב יחס מדד לחוזי השוכרים...", startedAt: calcStartT });
      var groupResults: any[] = [];
      for (var gi = 0; gi < groupKeysT.length; gi++) {
        var k = groupKeysT[gi];
        var g = groupMap[k];
        setCpiProgress({
          current: gi + 1,
          total: groupKeysT.length,
          label: g.isHighest ? "סורק שיא מדד..." : "מביא יחס מדד...",
          startedAt: calcStartT,
        });
        try {
          if (g.isHighest) {
            var baseDateObj = new Date(g.rawBase);
            var peak = await fetchHighestChainedCpi({
              baseFromDate: g.fromDate,
              scanFromYear: baseDateObj.getFullYear(),
              scanFromMonth: baseDateObj.getMonth() + 1,
              scanToYear: nowKnown.year,
              scanToMonth: nowKnown.month,
            });
            if (peak.success && peak.peakRatio) {
              groupResults.push({ key: k, ratio: peak.peakRatio });
              continue;
            }
          }
          var data: any = await fetchCpiAdjusted({ value: 10000, fromDate: g.fromDate, toDate: todayCbs });
          groupResults.push({ key: k, ratio: (data && data.success) ? (Number(data.adjustedRentPerSqm) || 10000) / 10000 : 1 });
        } catch { groupResults.push({ key: k, ratio: 1 }); }
      }

      var ratioMap: Record<string, number> = {};
      groupResults.forEach(function(r: any) {
        var g = groupMap[r.key];
        if (!g) return;
        g.contractIds.forEach(function(cid: string) { ratioMap[cid] = r.ratio; });
      });
      setCpiRatios(ratioMap);
    } catch(e) {}
    setCpiProgress(null);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFName(""); setFCompany(""); setFIdNumber(""); setFPhone("");
    setFEmail(""); setFAddress(""); setFCity(""); setFContactName("");
    setFContactPhone(""); setFNotes(""); setFContacts([]);
  }

  function openEdit(t: any) {
    setIsNew(false); setEditingId(t.id);
    setFName(t.name ?? ""); setFCompany(t.company_name ?? "");
    setFIdNumber(t.id_number ?? ""); setFPhone(t.phone ?? "");
    setFEmail(t.email ?? ""); setFAddress(t.address ?? "");
    setFCity(t.city ?? ""); setFContactName(t.contact_name ?? "");
    setFContactPhone(t.contact_phone ?? ""); setFNotes(t.notes ?? "");
    setFContacts(Array.isArray(t.contacts) ? t.contacts : []);
  }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם שוכר"); return; }
    setSaving(true);
    try {
      const payload = {
        name: fName.trim(), company_name: fCompany||null,
        id_number: fIdNumber||null, phone: fPhone||null,
        email: fEmail||null, address: fAddress||null,
        city: fCity||null, contact_name: fContactName||null,
        contact_phone: fContactPhone||null, notes: fNotes||null,
        // איש קשר עם מייל בלבד (בלי שם) הוא לגיטימי — הסינון הישן לפי שם
        // מחק בשקט את אנשי הקשר של גולף. נשמר כל מי שיש לו שם או אימייל.
        contacts: fContacts.filter(c => (c.name || "").trim() || (c.email || "").trim()),
      };
      if (isNew) {
        const { data, error: _ie } = await supabase.from("tenants").insert(payload).select().single();
      if (_ie) throw new Error(_ie.message);
      if (!data?.id) throw new Error("שגיאה בשמירה");
        await logAudit({ entity_type: "tenant", entity_id: data.id, action: "create" });
        setSelected(data.id);
      } else {
        await supabase.from("tenants").update(payload).eq("id", editingId);
        await logAudit({ entity_type: "tenant", entity_id: editingId, action: "update" });
      }
      setEditingId(""); await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק שוכר? פעולה זו תמחק גם את כל חוזי השוכר וכל הנתונים הקשורים אליהם.")) return;
    const { data: tContracts } = await supabase.from("contracts").select("id").eq("tenant_id", id);
    const tcIds = (tContracts || []).map((c: any) => c.id);
    if (tcIds.length > 0) {
      await supabase.from("charges").delete().in("contract_id", tcIds);
      await supabase.from("contract_spaces").delete().in("contract_id", tcIds);
      await supabase.from("contract_options").delete().in("contract_id", tcIds);
      await supabase.from("contract_price_tiers").delete().in("contract_id", tcIds);
      await supabase.from("guarantees").delete().in("contract_id", tcIds);
      await supabase.from("insurances_tenant").delete().in("contract_id", tcIds);
      await supabase.from("letters").delete().in("contract_id", tcIds);
      await supabase.from("contracts").delete().in("id", tcIds);
    }
    await supabase.from("tenants").delete().eq("id", id);
    setSelected(null); await loadAll();
  }

  // מכתבים אחרונים והתראות פתוחות של השוכר הנבחר. נטען לפי מזהי החוזים
  // שכבר עברו את סינון ההרשאות — משתמש שמורשה לנכס אחד יראה רק את
  // המכתבים וההתראות של אותו נכס (וה-RLS אוכף שכבה שנייה ב-DB).
  const [selLetters, setSelLetters] = useState<any[]>([]);
  const [selAlerts, setSelAlerts] = useState<any[]>([]);
  useEffect(function() {
    if (!selected) { setSelLetters([]); setSelAlerts([]); return; }
    var cids = contracts.filter(function(c: any){ return c.tenant_id === selected; }).map(function(c: any){ return c.id; });
    if (cids.length === 0) { setSelLetters([]); setSelAlerts([]); return; }
    (async function() {
      var [{ data: ls }, { data: as_ }] = await Promise.all([
        supabase.from("letters").select("id, title, status, letter_type, sent_at, created_at").in("contract_id", cids).order("created_at", { ascending: false }).limit(5),
        supabase.from("alerts").select("id, title, severity, due_date, created_at").in("contract_id", cids).eq("is_resolved", false).order("created_at", { ascending: false }).limit(6),
      ]);
      setSelLetters(ls ?? []); setSelAlerts(as_ ?? []);
    })();
  }, [selected, contracts]);

  // מיקוד לשוכר בקישור עמוק (ממסך החוזים): /tenants?tenant=<id> —
  // מציב את שם השוכר בחיפוש כך שהרשימה מתמקדת בו מיד.
  useEffect(function() {
    var tid = "";
    try { tid = new URLSearchParams(window.location.search).get("tenant") || ""; } catch (e) { /* noop */ }
    if (!tid || tenants.length === 0) return;
    var tRow = tenants.find(function(x: any){ return x.id === tid; });
    if (tRow?.name) { setSearch(tRow.name); setFilterLife("all"); setSelected(tid); }
  }, [tenants]);

  // סינון לפי חברה בקישור עמוק ממסך החברות: /tenants?companyId=<id> —
  // שוכרי החברה = מי שמחזיק חוזה על אחד מנכסיה.
  const [companyFilter, setCompanyFilter] = useState<{ id: string; name: string; propIds: string[] } | null>(null);
  useEffect(function() {
    var cid = "";
    try { cid = new URLSearchParams(window.location.search).get("companyId") || ""; } catch (e) { /* noop */ }
    if (!cid) return;
    (async function() {
      var { data: prs } = await supabase.from("properties").select("id, companies(company_name)").eq("company_id", cid);
      setCompanyFilter({ id: cid, name: ((prs || [])[0] as any)?.companies?.company_name || "", propIds: (prs || []).map(function(x: any){ return x.id; }) });
    })();
  }, []);
  const companyTenantIds = (function() {
    if (!companyFilter) return null;
    var s: Record<string, boolean> = {};
    contracts.forEach(function(c: any) { if (companyFilter.propIds.indexOf(c.property_id) !== -1 && c.tenant_id) s[c.tenant_id] = true; });
    return s;
  })();

  // סטטוסים "חיים" — קובעים אם שוכר נחשב פעיל או שוכר עבר
  const LIVE_ST = ["active", "expiring", "extended", "upcoming", "future"];
  const liveTenantIds = (function() {
    var s: Record<string, boolean> = {};
    contracts.forEach(function(c: any) { if (!c.is_amendment && c.tenant_id && LIVE_ST.indexOf(c.status) !== -1) s[c.tenant_id] = true; });
    return s;
  })();
  const activeCount = tenants.filter(t => !!liveTenantIds[t.id] && (!companyTenantIds || companyTenantIds[t.id])).length;
  const pastCount   = tenants.filter(t =>  !liveTenantIds[t.id] && (!companyTenantIds || companyTenantIds[t.id])).length;
  const filtered = tenants.filter(t =>
    (filterLife === "all" || (filterLife === "active" ? !!liveTenantIds[t.id] : !liveTenantIds[t.id])) &&
    (!companyTenantIds || companyTenantIds[t.id]) &&
    (!search || t.name?.includes(search) || t.company_name?.includes(search) || t.id_number?.includes(search))
  );
  const selTenant = tenants.find(t => t.id === selected);
  // חוזה = משפחה אחת (בסיס + תוספותיו): התוספות אינן נספרות כחוזים
  // נפרדים, והיחידות המוצגות הן של צילום-המצב האחרון (אחרי החלפות).
  const selContracts = (function() {
    var mine = contracts.filter(c => c.tenant_id === selected);
    var groups: Record<string, any[]> = {};
    mine.forEach(function(c: any) { var fid = c.parent_contract_id || c.id; (groups[fid] = groups[fid] || []).push(c); });
    var out: any[] = [];
    Object.keys(groups).forEach(function(fid) {
      var snaps = groups[fid];
      var base = snaps.find(function(s: any){ return !s.is_amendment; });
      if (!base) return; // תוספת יתומה — הבסיס אינו חי
      var rank = function(x: any){ return (x.is_amendment ? (new Date(x.amendment_date || x.start_date).getTime() || 0) : 0) * 1000 + (Number(x.amendment_number) || 0); };
      var eff = base.contract_spaces || [];
      var effEnd = base.end_date;
      snaps.slice().sort(function(a: any, b: any){ return rank(a) - rank(b); }).forEach(function(s: any) {
        if ((s.contract_spaces || []).length > 0) eff = s.contract_spaces;
        if (s.end_date && (!effEnd || s.end_date > effEnd)) effEnd = s.end_date;
      });
      out.push({ ...base, contract_spaces: eff, end_date: effEnd });
    });
    return out;
  })();
  // הכנסה — רק מהסכמים חיים; הסכמי עבר מוצגים בהיסטוריה אך אינם נסכמים
  const selLiveContracts = selContracts.filter(c => LIVE_ST.indexOf(c.status) !== -1);
  const selRevenueBase = selLiveContracts.reduce((s, c) => s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0), 0);
  // Indexed revenue: each contract uses its own ratio (highest contracts get
  // the chained peak; standard contracts get the base→today ratio).
  const selRevenue = selLiveContracts.reduce((s, c) => {
    var r = cpiRatios[c.id] || 1;
    return s + ((c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0)) * r;
  }, 0);

  const STATUS_MAP: Record<string, {label: string; color: string}> = {
    active:   { label: "פעיל",    color: "bg-green-100 text-green-700"   },
    expiring: { label: "פוגע",    color: "bg-yellow-100 text-yellow-700" },
    extended: { label: "מוארך",   color: "bg-blue-100 text-blue-700"     },
    upcoming: { label: "עתידי",   color: "bg-purple-100 text-purple-700" },
    future:   { label: "עתידי",   color: "bg-purple-100 text-purple-700" },
    ended:    { label: "הסתיים",  color: "bg-slate-100 text-slate-500"   },
  };

  return (
    <div dir="rtl">
      <PageHero title="שוכרים" subtitle={activeCount + " פעילים · " + pastCount + " שוכרי עבר"} icon="👤" tone="violet" actionLabel="+ שוכר חדש" onAction={openNew} />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* רשימה */}
        <div className={(selected ? "hidden lg:block " : "") + "space-y-2"}>
          {companyFilter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold px-3 py-1.5">
              🏛️ {companyFilter.name || "חברה"}
              <button onClick={() => setCompanyFilter(null)} className="text-blue-400 hover:text-blue-700 font-bold" title="הצג את כל השוכרים">✕</button>
            </span>
          )}
          <div className="flex gap-1.5 mb-2">
            {[
              { v: "active", l: "פעילים (" + activeCount + ")" },
              { v: "past",   l: "שוכרי עבר (" + pastCount + ")" },
              { v: "all",    l: "הכל" },
            ].map(s => (
              <button key={s.v}
                onClick={() => { setFilterLife(s.v as any); if (selected && ((s.v === "active" && !liveTenantIds[selected]) || (s.v === "past" && liveTenantIds[selected]))) setSelected(null); }}
                className={"rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors " +
                  (filterLife === s.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")}>
                {s.l}
              </button>
            ))}
          </div>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש שם / חברה / ח.פ..."
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm mb-2" />
          {loading ? <div className="text-center py-4 text-slate-400">טוען...</div> : (
            filtered.map(t => {
              const tenRows = contracts.filter(c => c.tenant_id === t.id);
              // משפחות בלבד — תוספת אינה חוזה נוסף
              const tenContracts = tenRows.filter((c: any) => !c.is_amendment);
              const hasActive = tenContracts.some(c => c.status === "active");
              const isPast = !liveTenantIds[t.id];
              return (
                <div key={t.id} onClick={() => setSelected(selected === t.id ? null : t.id)}
                  className={"rounded-xl border p-3 cursor-pointer transition-all " +
                    (selected === t.id ? "border-blue-500 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:shadow-sm") +
                    (isPast ? " opacity-75" : "")}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-slate-800 text-sm">
                        {t.name}
                        {isPast && <span className="mr-1.5 align-middle text-[10px] font-semibold rounded-full bg-slate-100 border border-slate-200 text-slate-500 px-1.5 py-0.5">עבר</span>}
                      </div>
                      {t.company_name && <div className="text-xs text-slate-400">{t.company_name}</div>}
                    </div>
                    <div className="flex items-center gap-1">
                      {hasActive && <span title="לשוכר יש הסכם פעיל" className="w-2 h-2 rounded-full bg-green-400 cursor-help" />}
                      {tenContracts.length > 0 && <span title={tenContracts.length + " הסכמים לשוכר (בסיס + תוספותיו נספרים כהסכם אחד)"} className="text-xs text-slate-400 cursor-help">{tenContracts.length}</span>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          {filtered.length === 0 && !loading && <div className="text-center py-4 text-slate-400 text-sm">אין שוכרים</div>}
        </div>

        {/* פרטים */}
        <div className={(selected ? "" : "hidden lg:block ") + "lg:col-span-3"}>
          {selected && <button onClick={function(){setSelected(null);}} className="lg:hidden flex items-center gap-1 text-sm font-semibold text-blue-600 mb-2">→ חזרה לרשימה</button>}
          {!selTenant ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
              <div className="text-5xl mb-3">👤</div>
              <div>בחר שוכר לצפייה</div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* כרטיס ראשי */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 mb-0.5">{selTenant.name}</h2>
                    {selTenant.company_name && <div className="text-sm text-slate-500">🏢 {selTenant.company_name}</div>}
                    {selTenant.id_number && <div className="text-xs text-slate-400 font-mono">ח.פ/ת.ז: {selTenant.id_number}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(selTenant)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
                    <button onClick={() => handleDelete(selTenant.id)}
                      className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">🗑</button>
                  </div>
                </div>
                {cpiProgress && (
                  <div className="mb-3">
                    <CalcProgress {...cpiProgress} />
                  </div>
                )}
                {/* KPI */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                  {[
                    { label: "חוזים פעילים",    value: String(selLiveContracts.length),  color: "text-slate-800", bg: "bg-slate-50"  },
                    { label: "הכנסה חודשית צמודה", value: fmtMoney(selRevenue),          color: "text-green-700", bg: "bg-green-50"  },
                    { label: "נכסים",            value: String(new Set(selContracts.map(c => c.properties?.name)).size), color: "text-blue-700", bg: "bg-blue-50" },
                  ].map(k => (
                    <div key={k.label} className={"rounded-xl p-3 text-center " + k.bg}>
                      <div className={"text-lg font-black " + k.color}>{k.value}</div>
                      <div className="text-xs text-slate-400">{k.label}</div>
                    </div>
                  ))}
                </div>
                {/* פרטי קשר */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { l: "טלפון",    v: selTenant.phone,   dir: "ltr" },
                    { l: "אימייל",   v: selTenant.email,   dir: "ltr" },
                    { l: "כתובת",    v: selTenant.address ? selTenant.address + (selTenant.city ? ", " + selTenant.city : "") : selTenant.city, dir: "rtl" },
                    { l: "איש קשר", v: selTenant.contact_name ? selTenant.contact_name + (selTenant.contact_phone ? " | " + selTenant.contact_phone : "") : null, dir: "rtl" },
                  ].filter(f => f.v).map(f => (
                    <div key={f.l} className="flex gap-2 border-b border-slate-100 pb-1.5">
                      <span className="text-slate-400 shrink-0">{f.l}:</span>
                      <span className="font-medium text-slate-700" dir={f.dir as any}>{f.v}</span>
                    </div>
                  ))}
                </div>
                {selTenant.notes && <div className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg p-2">{selTenant.notes}</div>}
                {/* אנשי קשר עם מינויי נושאים — צפייה, הוספה ועריכה ישירות כאן */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="text-xs font-bold text-slate-700 mb-0.5">👥 אנשי קשר למכתבים</div>
                  <div className="text-[10px] text-slate-400 mb-2">כל מכתב נשלח לאנשי הקשר שהנושא שלו סומן אצלם (או "כל ההתכתבויות")</div>
                  <TenantContactsEditor tenantId={selTenant.id} onChanged={loadAll} />
                </div>
              </div>

              {/* חוזים */}
              {selContracts.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="font-semibold text-slate-700 text-sm">חוזים ({selContracts.length})</span>
                    <button onClick={() => router.push("/contracts/new")}
                      className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg font-semibold hover:bg-blue-700">+ חוזה חדש</button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {selContracts.map(c => {
                      const mon = ((c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0)) * (cpiRatios[c.id] || 1);
                      const days = c.end_date ? Math.ceil((new Date(c.end_date).getTime() - Date.now()) / 86400000) : null;
                      const si = STATUS_MAP[c.status] ?? { label: c.status, color: "bg-slate-100 text-slate-600" };
                      return (
                        <div key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer"
                          title="פתח את ההסכם במסך החוזים"
                          onClick={() => router.push("/contracts?select=" + c.id)}>
                          <div>
                            <div className="font-medium text-slate-800 text-sm">{c.properties?.name}</div>
                            {(c.contract_spaces || []).length > 0 && (
                              <div className="flex gap-1 flex-wrap mt-0.5">
                                {(c.contract_spaces || []).map(function(cs: any, ui: number){
                                  return (
                                    <span key={ui} onClick={function(e: any){ e.stopPropagation(); router.push("/units?propertyId=" + c.property_id); }}
                                      title="פתח במסך היחידות" className="text-[10px] rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 px-1.5 py-0.5 hover:bg-indigo-100">
                                      🚪 {cs?.spaces?.space_name}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={"text-xs px-1.5 py-0.5 rounded-full " + si.color}>{si.label}</span>
                              <span className="text-xs text-slate-400">{fmtDate(c.start_date)} — {fmtDate(c.end_date)}</span>
                              {days !== null && days <= 90 && days > 0 && (
                                <span className={"text-xs font-semibold " + (days <= 30 ? "text-red-600" : "text-yellow-600")}>{days} ימים</span>
                              )}
                            </div>
                          </div>
                          <div className="font-bold text-green-700 text-sm">{fmtMoney(mon)}/חודש</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* התראות פתוחות של השוכר (בהיקף ההרשאות של המשתמש) */}
              {selAlerts.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-amber-100 bg-amber-50/50 flex items-center justify-between">
                    <span className="font-semibold text-amber-800 text-sm">🔔 התראות פתוחות ({selAlerts.length})</span>
                    <button onClick={() => router.push("/alerts")} className="text-xs text-amber-700 hover:underline font-semibold">למסך ההתראות ↗</button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {selAlerts.map(a => (
                      <div key={a.id} onClick={() => router.push("/alerts")} title="פתח במסך ההתראות"
                        className="px-5 py-2.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer">
                        <span className={"w-2 h-2 rounded-full shrink-0 " + (a.severity === "urgent" ? "bg-red-500" : a.severity === "warning" ? "bg-amber-400" : "bg-blue-300")} />
                        <span className="text-xs text-slate-700 truncate">{a.title}</span>
                        {a.due_date && <span className="text-[10px] text-slate-400 shrink-0 mr-auto">{fmtDate(a.due_date)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* מכתבים אחרונים + קישור למסך המכתבים בחתך השוכר */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="font-semibold text-slate-700 text-sm">📨 מכתבים אחרונים</span>
                  <button onClick={() => router.push("/letters?tenant=" + selTenant.id)}
                    className="text-xs text-blue-600 hover:underline font-semibold">כל מכתבי השוכר ↗</button>
                </div>
                {selLetters.length === 0 ? (
                  <div className="px-5 py-3 text-xs text-slate-400">לא נשלחו מכתבים לשוכר זה</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {selLetters.map(l => (
                      <div key={l.id} onClick={() => router.push("/letters?tenant=" + selTenant.id)} title="פתח במסך המכתבים בחתך השוכר"
                        className="px-5 py-2.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer">
                        <span className={"text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 " + (l.status === "sent" ? "bg-emerald-50 text-emerald-700" : l.status === "ready" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500")}>
                          {l.status === "sent" ? "נשלח" : l.status === "ready" ? "מוכן" : "טיוטה"}
                        </span>
                        <span className="text-xs text-slate-700 truncate">{l.title}</span>
                        <span className="text-[10px] text-slate-400 shrink-0 mr-auto">{fmtDate(l.sent_at || l.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "שוכר חדש" : "עריכת שוכר"}</h2>
              <button onClick={() => setEditingId("")} className="text-2xl text-slate-400">✕</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם *</label>
                <input type="text" value={fName} onChange={e => setFName(e.target.value)} className={ic} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שם חברה</label>
                  <input type="text" value={fCompany} onChange={e => setFCompany(e.target.value)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">ח.פ / ת.ז</label>
                  <input type="text" value={fIdNumber} onChange={e => setFIdNumber(e.target.value)} className={ic} dir="ltr" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">טלפון</label>
                  <input type="tel" value={fPhone} onChange={e => setFPhone(e.target.value)} className={ic} dir="ltr" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">אימייל</label>
                  <input type="email" value={fEmail} onChange={e => setFEmail(e.target.value)} className={ic} dir="ltr" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label>
                  <input type="text" value={fAddress} onChange={e => setFAddress(e.target.value)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">עיר</label>
                  <input type="text" value={fCity} onChange={e => setFCity(e.target.value)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">איש קשר</label>
                  <input type="text" value={fContactName} onChange={e => setFContactName(e.target.value)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">טלפון איש קשר</label>
                  <input type="tel" value={fContactPhone} onChange={e => setFContactPhone(e.target.value)} className={ic} dir="ltr" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <textarea value={fNotes} onChange={e => setFNotes(e.target.value)} rows={2} className={ic} />
              </div>

              {/* אנשי קשר */}
              <div className="rounded-lg border border-slate-200 p-3 mt-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700">אנשי קשר נוספים</span>
                  <button type="button" onClick={() => setFContacts(prev => [...prev, {name:"",role:"",email:"",phone:"", topics: ["all"]}])}
                    className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg font-semibold hover:bg-blue-700">+ הוסף</button>
                </div>
                {fContacts.length === 0 ? (
                  <div className="text-xs text-slate-400 text-center py-2">אין אנשי קשר נוספים</div>
                ) : fContacts.map((c, i) => (
                  <div key={i} className="rounded-lg bg-slate-50 p-2 mb-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600">איש קשר {i+1}</span>
                      <button type="button" onClick={() => setFContacts(prev => prev.filter((_,j)=>j!==i))}
                        className="text-xs text-red-500 hover:text-red-700">הסר</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={c.name} placeholder="שם" className={ic+" text-xs"}
                        onChange={e => setFContacts(prev => prev.map((x,j)=>j===i?{...x,name:e.target.value}:x))} />
                      <input type="text" value={c.role} placeholder="תפקיד" className={ic+" text-xs"}
                        onChange={e => setFContacts(prev => prev.map((x,j)=>j===i?{...x,role:e.target.value}:x))} />
                      <input type="email" value={c.email} placeholder="אימייל" className={ic+" text-xs"} dir="ltr"
                        onChange={e => setFContacts(prev => prev.map((x,j)=>j===i?{...x,email:e.target.value}:x))} />
                      <input type="tel" value={c.phone} placeholder="טלפון" className={ic+" text-xs"} dir="ltr"
                        onChange={e => setFContacts(prev => prev.map((x,j)=>j===i?{...x,phone:e.target.value}:x))} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingId("")}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "שומר..." : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
