"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';
import { loadCompanyInfo, letterContent } from '@/lib/letter-format';
import { logAudit } from '@/lib/audit-log';

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function daysLeft(d: string) { return Math.ceil((new Date(d).getTime()-Date.now())/86400000); }

const SEV_MAP: Record<string,{label:string;color:string;bg:string;border:string}> = {
  urgent:  {label:"דחוף",   color:"text-red-700",   bg:"bg-red-50",    border:"border-red-200"  },
  warning: {label:"אזהרה",  color:"text-yellow-700",bg:"bg-yellow-50", border:"border-yellow-200"},
  info:    {label:"מידע",   color:"text-blue-700",  bg:"bg-blue-50",   border:"border-blue-200" },
};
// Legacy severities (high/medium/critical) map onto the canonical three.
function sevOf(a: any) {
  var s = a.severity;
  if (s === "high" || s === "critical") s = "urgent";
  if (s === "medium") s = "warning";
  return SEV_MAP[s] ?? SEV_MAP.info;
}

// What the alert is ABOUT — drives grouping, filtering and the letter wording.
const CATEGORIES = [
  { key: "arrears",   icon: "💰", label: "חיובים בפיגור",   letterTitle: "דרישת תשלום — חיובים בפיגור" },
  { key: "guarantee", icon: "🏦", label: "ערבויות",          letterTitle: "דרישה לחידוש ערבות" },
  { key: "insurance", icon: "🛡️", label: "ביטוחים",          letterTitle: "דרישה להמצאת אישור ביטוח" },
  { key: "safety",    icon: "🔒", label: "בטיחות ואש",       letterTitle: "דרישה להשלמת בדיקות בטיחות" },
  { key: "contract",  icon: "📄", label: "חוזים ואופציות",   letterTitle: "הודעה בנושא הסכם השכירות" },
  { key: "other",     icon: "🔔", label: "אחר",               letterTitle: "הודעה" },
];
function categoryOf(a: any): string {
  var et = a.entity_type || "", at = a.alert_type || "";
  if (et === "arrears" || at === "rent_arrears") return "arrears";
  if (et === "guarantee") return "guarantee";
  if (et === "insurance") return "insurance";
  if (et === "safety") return "safety";
  if (et === "contract" || et === "option" || et === "contract_option") return "contract";
  return "other";
}
const catInfo = function(key: string) { return CATEGORIES.find(function(c){ return c.key === key; }) || CATEGORIES[5]; };

// Deep link: where clicking the alert takes you — the screen where the thing
// gets handled. Contract/option alerts open the contract itself (?select=).
function alertHref(a: any): string | null {
  var cat = categoryOf(a);
  if (cat === "arrears") return "/payments";
  if (cat === "guarantee") return "/guarantees";
  if (cat === "insurance") return "/insurances";
  if (cat === "safety") return "/safety";
  if (a.contract_id) return "/contracts?select=" + a.contract_id;
  return null;
}

export default function AlertsPage() {
  const router = useRouter();
  const [alerts,    setAlerts]    = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  // Aging summary: total unpaid money past due (from charges, not alert text).
  const [arrears,   setArrears]   = useState<{sum:number;count:number}|null>(null);
  const [filterSev, setFilterSev] = useState("all");
  const [filterSt,  setFilterSt]  = useState("open");
  const [filterCat, setFilterCat] = useState("all");
  const [selected,  setSelected]  = useState<Set<string>>(new Set());
  const [syncNote,  setSyncNote]  = useState("");
  const [working,   setWorking]   = useState("");

  // Auto-sync on entry: the sync is idempotent (dedupes against open alerts),
  // so the screen always reflects reality without a manual button.
  useEffect(function() {
    var cancelled = false;
    (async function() {
      await loadAlerts();
      try {
        const res = await fetch("/api/alerts/sync", { method: "POST" });
        const d = await res.json();
        if (cancelled) return;
        if ((d.created ?? 0) > 0) {
          setSyncNote("🔄 נוספו " + d.created + " התראות חדשות");
          await loadAlerts();
          setTimeout(function(){ if (!cancelled) setSyncNote(""); }, 6000);
        }
      } catch (e) { /* sync is best-effort */ }
    })();
    return function(){ cancelled = true; };
  }, []);

  async function loadAlerts() {
    // due_date ascending = AGING order: most-overdue first, then nearest deadlines.
    const { data } = await supabase.from("alerts").select("*, contracts(property_id, tenants(name), properties(id,name))").order("due_date", {ascending: true, nullsFirst: false}).order("created_at",{ascending:false});
    var scope = await getScopeIds();
    setAlerts(scopeRows(data??[], scope, function(a: any){ return a.property_id || a.contracts?.property_id; }));
    setLoading(false);
    // Total money in arrears — computed live from charges (the source), not
    // from alert titles.
    var todayStr = new Date().toISOString().split("T")[0];
    const { data: od } = await supabase.from("charges").select("total_amount, contracts(property_id)").neq("status","paid").not("due_date","is",null).lt("due_date", todayStr);
    var rows = scopeRows(od ?? [], scope, function(x: any){ return x.contracts?.property_id; });
    setArrears({ count: rows.length, sum: rows.reduce(function(s: number, r: any){ return s + (Number(r.total_amount) || 0); }, 0) });
  }

  async function closeAlert(id: string) {
    // Closing implies read.
    var now = new Date().toISOString();
    await supabase.from("alerts").update({is_resolved:true, handled_at: now, read_at: now}).eq("id",id);
    setAlerts(function(prev){return prev.map(function(a){return a.id===id?{...a,is_resolved:true,read_at:now}:a;});});
  }
  // "Read" is separate from "closed": the item stays open (still needs handling)
  // but stops shouting. An escalation (e.g. option countdown crossing 30 days)
  // resets read_at in the sync, so the same alert pops as unread again.
  async function markRead(id: string) {
    var now = new Date().toISOString();
    await supabase.from("alerts").update({read_at: now}).eq("id",id);
    setAlerts(function(prev){return prev.map(function(a){return a.id===id?{...a,read_at:now}:a;});});
  }
  async function markAllRead() {
    var ids = filtered.filter(function(a){return !a.is_resolved && !a.read_at;}).map(function(a){return a.id;});
    if (!ids.length) return;
    var now = new Date().toISOString();
    await supabase.from("alerts").update({read_at: now}).in("id", ids);
    setAlerts(function(prev){return prev.map(function(a){return ids.indexOf(a.id)!==-1?{...a,read_at:now}:a;});});
  }
  async function reopen(id: string) {
    await supabase.from("alerts").update({is_resolved:false, handled_at: null}).eq("id",id);
    setAlerts(function(prev){return prev.map(function(a){return a.id===id?{...a,is_resolved:false}:a;});});
  }
  async function deleteAlert(id: string) {
    if (!confirm("למחוק את ההתראה לצמיתות?")) return;
    await supabase.from("alerts").delete().eq("id",id);
    setAlerts(function(prev){return prev.filter(function(a){return a.id!==id;});});
    setSelected(function(prev){const n=new Set(prev); n.delete(id); return n;});
  }
  async function bulkClose() {
    if (!selected.size) return;
    if (!confirm(`לסגור ${selected.size} התראות?`)) return;
    setWorking("close");
    for (const id of Array.from(selected)) await supabase.from("alerts").update({is_resolved:true, handled_at: new Date().toISOString()}).eq("id",id);
    setSelected(new Set()); setWorking("");
    await loadAlerts();
  }
  async function bulkDelete() {
    if (!selected.size) return;
    if (!confirm(`למחוק ${selected.size} התראות לצמיתות?`)) return;
    setWorking("delete");
    await supabase.from("alerts").delete().in("id", Array.from(selected));
    setSelected(new Set()); setWorking("");
    await loadAlerts();
  }

  // ─── Create DRAFT letters from the selected alerts ───
  // Groups by CONTRACT (one letter per contract, like the letters screen merge),
  // lists each alert as a numbered item, and saves as a draft demand letter that
  // shows up in /letters for review and sending. Alerts without a contract are
  // skipped (reported). Generic: works for any category mix.
  async function createLettersFromSelected() {
    var sel = alerts.filter(function(a){ return selected.has(a.id); });
    if (!sel.length) { alert("יש לבחור התראות"); return; }
    var byContract: Record<string, any[]> = {};
    var skipped = 0;
    sel.forEach(function(a){
      var cid = a.contract_id;
      if (!cid) { skipped++; return; }
      if (!byContract[cid]) byContract[cid] = [];
      byContract[cid].push(a);
    });
    var cids = Object.keys(byContract);
    if (!cids.length) { alert("לא נבחרו התראות המשויכות לחוזה — אין למי להפיק מכתב"); return; }
    setWorking("letters");
    try {
      var createdCount = 0;
      for (var ci = 0; ci < cids.length; ci++) {
        var group = byContract[cids[ci]];
        var first = group[0];
        var tenant = first.contracts?.tenants?.name || "";
        var propId = first.contracts?.property_id || first.property_id || first.contracts?.properties?.id || "";
        var info = await loadCompanyInfo(propId);
        // One category → its specific title; mixed → generic demand title.
        var cats = Array.from(new Set(group.map(function(a: any){ return categoryOf(a); })));
        var title = cats.length === 1 ? catInfo(cats[0]).letterTitle : "מכתב דרישה — נושאים פתוחים";
        var p: string[] = [];
        p.push("לכבוד");
        p.push(tenant);
        p.push("");
        p.push("שלום רב,");
        p.push("");
        p.push("הנדון: " + title);
        p.push("");
        p.push("בהתאם להוראות הסכם השכירות, נבקשכם לטפל בנושאים הבאים:");
        p.push("");
        group.forEach(function(a: any, i: number){
          p.push((i + 1) + ". " + a.title + (a.due_date ? " (תאריך יעד: " + fmtDate(a.due_date) + ")" : ""));
        });
        p.push("");
        p.push("נבקשכם להסדיר את האמור בתוך 14 יום ממועד קבלת מכתב זה.");
        p.push("");
        p.push("בכבוד רב ובברכה,");
        p.push("");
        p.push(info.companyName || "הנהלת הנכס");
        var { error } = await supabase.from("letters").insert({
          contract_id: cids[ci],
          letter_type: "demand",
          title: title + (tenant ? " — " + tenant : ""),
          content_json: letterContent(p.join("\n"), info),
          property_id: propId || null,
          status: "draft",
        });
        if (!error) createdCount++;
      }
      await logAudit({ entity_type: "letter", entity_id: cids[0], action: "create_from_alerts", notes: createdCount + " מכתבים מ-" + sel.length + " התראות" });
      alert("✅ נוצרו " + createdCount + " טיוטות מכתבים (מסך מכתבים)" + (skipped ? "\n⚠ דולגו " + skipped + " התראות ללא חוזה משויך" : ""));
      setSelected(new Set());
    } catch (e: any) { alert("שגיאה ביצירת מכתבים: " + (e?.message || e)); }
    finally { setWorking(""); }
  }

  function toggleSel(id: string) {
    setSelected(function(prev){const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n;});
  }

  // ─── Mark an option exercised / not exercised straight from its alert ───
  // Type 1 (exercise notice): ✓ = the tenant's exercise notice was received →
  // exercise + extend; ✗ = no notice / declined → the option lapses, contract
  // keeps its end date. Type 2 (non-exercise notice): ✗ = the tenant's
  // non-exercise notice was received → option will NOT auto-exercise; ✓ = early
  // confirmation of exercise. All paths close the option's open alerts, so the
  // reminders stop the moment the manager marks the outcome.
  async function setOptionExercised(a: any, exercised: boolean) {
    var optId = a.entity_id;
    if (!optId) return;
    var isType2 = a.alert_type === "option_nonexercise_notice";
    var what = exercised
      ? "לסמן שהאופציה ממומשת ולהאריך את החוזה עד סוף תקופת האופציה?"
      : (isType2
        ? "לסמן שהתקבלה הודעת אי-מימוש מהדייר? (האופציה לא תמומש והחוזה יסתיים במועדו)"
        : "לסמן אי-מימוש? (לא התקבלה הודעת מימוש — האופציה פוקעת והחוזה יסתיים במועדו)");
    if (!confirm(what)) return;
    setWorking("option");
    try {
      var { error } = await supabase.from("contract_options").update({
        is_exercised: exercised,
        status: exercised ? "exercised" : "declined",
      }).eq("id", optId);
      if (error) throw error;
      if (exercised && a.contract_id) {
        // Extend the contract to the latest exercised option's end (same rule
        // as the contracts screen).
        var { data: opts } = await supabase.from("contract_options")
          .select("id,end_date,is_exercised,option_number")
          .eq("contract_id", a.contract_id)
          .order("option_number");
        var lastEx = (opts ?? []).filter(function(o: any){ return o.is_exercised; })
          .sort(function(x: any, y: any){ return y.option_number - x.option_number; })[0];
        if (lastEx?.end_date) {
          var newStatus = new Date() > new Date(lastEx.end_date) ? "ended" : "active";
          await supabase.from("contracts").update({ end_date: lastEx.end_date, status: newStatus }).eq("id", a.contract_id);
        }
      }
      // Close ALL of this option's open alerts (not just the clicked one) —
      // the moment the outcome is marked, the reminders stop.
      await supabase.from("alerts").update({ is_resolved: true, handled_at: new Date().toISOString() }).eq("entity_id", optId).eq("is_resolved", false);
      await logAudit({ entity_type: "contract_option", entity_id: optId, action: exercised ? "exercise_from_alert" : "decline_from_alert", notes: a.title });
      await loadAlerts();
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setWorking(""); }
  }

  // Status filter uses is_resolved — the real column (the old `a.status` field
  // doesn't exist, which made פתוחות/סגורות show nothing).
  const filtered = alerts.filter(function(a){
    var stOk = filterSt === "all" || (filterSt === "open" ? !a.is_resolved : a.is_resolved);
    var sevOk = filterSev === "all" || sevOf(a) === (SEV_MAP[filterSev] ?? null);
    var catOk = filterCat === "all" || categoryOf(a) === filterCat;
    return stOk && sevOk && catOk;
  });

  const open = alerts.filter(function(a){return !a.is_resolved;});
  const urgentOpen  = open.filter(function(a){return sevOf(a) === SEV_MAP.urgent;}).length;
  const warningOpen = open.filter(function(a){return sevOf(a) === SEV_MAP.warning;}).length;
  const unreadOpen  = open.filter(function(a){return !a.read_at;}).length;

  return (
    <div dir="rtl">
      <PageHero title="התראות" icon="🔔" tone="amber"
        subtitle={<>
          {open.length} פתוחות
          {unreadOpen>0&&<span className="text-white font-bold"> | {unreadOpen} לא נקראו</span>}
          {urgentOpen>0&&<span className="text-rose-100 font-semibold"> | {urgentOpen} דחופות!</span>}
          {warningOpen>0&&<span className="text-amber-100 font-semibold"> | {warningOpen} אזהרות</span>}
          <span className="text-amber-100/80 text-xs mr-2">· מסונכרן אוטומטית בכניסה</span>
        </>}
        actions={selected.size>0 ? (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={createLettersFromSelected} disabled={!!working} className="rounded-xl bg-white text-amber-700 px-3 py-2 text-sm font-bold hover:bg-amber-50 shadow-sm disabled:opacity-50">
              {working==="letters" ? "⏳ יוצר..." : "📄 צור מכתבים (" + selected.size + ")"}
            </button>
            <button onClick={bulkClose} disabled={!!working} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-50">
              ✓ סגור {selected.size}
            </button>
            <button onClick={bulkDelete} disabled={!!working} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-50">
              🗑 מחק {selected.size}
            </button>
          </div>
        ) : (unreadOpen > 0 ? (
          <button onClick={markAllRead} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-sm font-semibold text-white hover:bg-white/25">
            👁 סמן הכל כנקראו ({unreadOpen})
          </button>
        ) : undefined)} />

      {syncNote && <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700">{syncNote}</div>}

      {/* Aging summary — total money past due, straight from charges */}
      {arrears && arrears.count > 0 && (
        <button onClick={function(){router.push("/payments");}}
          className="w-full mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between hover:bg-red-100 transition-colors text-right">
          <span className="text-sm font-bold text-red-700">💰 סה&quot;כ בפיגור: ₪{Math.round(arrears.sum).toLocaleString("he-IL")} · {arrears.count} חיובים שעברו את מועד התשלום</span>
          <span className="text-xs text-red-500 font-semibold">למסך חייבים ↗</span>
        </button>
      )}

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          {l:"דחופות",   v:urgentOpen,  bg:"bg-red-50",    border:"border-red-200",   c:"text-red-700",    f:"urgent"},
          {l:"אזהרות",   v:warningOpen, bg:"bg-yellow-50", border:"border-yellow-200",c:"text-yellow-700", f:"warning"},
          {l:"כל הפתוחות",v:open.length,bg:"bg-white",     border:"border-slate-200", c:"text-slate-700",  f:"all"},
        ].map(function(k){return (
          <button key={k.l} onClick={function(){setFilterSev(filterSev===k.f?"all":k.f);setFilterSt("open");}}
            className={"rounded-xl border p-3 text-center transition-all "+k.bg+" "+k.border+(filterSev===k.f?" ring-2 ring-blue-300":"")}>
            <div className={"text-2xl font-black "+k.c}>{k.v}</div>
            <div className={"text-xs font-semibold "+k.c}>{k.l}</div>
          </button>
        );})}
      </div>

      {/* Category chips — what's actually open, by topic */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={function(){setFilterCat("all");}}
          className={"rounded-xl border px-3 py-1.5 text-xs font-semibold "+(filterCat==="all"?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
          הכל ({open.length})
        </button>
        {CATEGORIES.map(function(c){
          var n = open.filter(function(a){ return categoryOf(a) === c.key; }).length;
          if (n === 0 && filterCat !== c.key) return null;
          return (
            <button key={c.key} onClick={function(){setFilterCat(filterCat===c.key?"all":c.key);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold "+(filterCat===c.key?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {c.icon} {c.label} ({n})
            </button>
          );
        })}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[{v:"open",l:"פתוחות"},{v:"closed",l:"סגורות"},{v:"all",l:"הכל"}].map(function(s){return (
          <button key={s.v} onClick={function(){setFilterSt(s.v);setSelected(new Set());}}
            className={"rounded-xl border px-3 py-1.5 text-xs font-semibold "+(filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
            {s.l} ({alerts.filter(function(a){return s.v==="all"||(s.v==="open"?!a.is_resolved:a.is_resolved);}).length})
          </button>
        );})}
        <div className="flex-1"/>
        {filtered.some(function(a){return !a.is_resolved;})&&(
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
            <input type="checkbox" checked={filtered.filter(function(a){return !a.is_resolved;}).every(function(a){return selected.has(a.id);}) && filtered.some(function(a){return !a.is_resolved;})}
              onChange={function(e){setSelected(e.target.checked?new Set(filtered.filter(function(a){return !a.is_resolved;}).map(function(a){return a.id;})):new Set());}} className="w-3.5 h-3.5"/>
            בחר הכל
          </label>
        )}
      </div>

      {loading ? <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div> : filtered.length===0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🎉</div>
          <div className="font-semibold text-slate-600">אין התראות {filterSt==="open"?"פתוחות":""}</div>
          <div className="text-sm mt-1">המערכת תקינה</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(function(a) {
            const si     = sevOf(a);
            const cat    = catInfo(categoryOf(a));
            const d      = a.due_date ? daysLeft(a.due_date) : null;
            const isOpen = !a.is_resolved;
            const isSel  = selected.has(a.id);
            const isUnread = isOpen && !a.read_at;
            const tenant = a.contracts?.tenants?.name || "";
            return (
              <div key={a.id} className={"rounded-xl border p-4 flex items-start gap-3 transition-all "+(isOpen?si.bg+" "+si.border:"bg-white border-slate-200 opacity-60")+(isSel?" ring-2 ring-blue-400":"")+(isUnread?" shadow-md":"")}>
                {isOpen&&<input type="checkbox" checked={isSel} onChange={function(){toggleSel(a.id);}} className="mt-1 w-4 h-4 shrink-0"/>}
                <span className="text-xl shrink-0" title={cat.label}>{cat.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 mb-0.5 flex-wrap">
                    {isUnread&&<span className="mt-1.5 w-2 h-2 rounded-full bg-blue-600 shrink-0" title="לא נקראה"></span>}
                    <span className={"text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 "+si.color+" "+si.bg}>{si.label}</span>
                    {isUnread&&<span className="text-[10px] bg-blue-600 text-white rounded-full px-1.5 py-0.5 font-bold shrink-0">חדש</span>}
                    {(function(){
                      var href = alertHref(a);
                      return href ? (
                        <button onClick={function(){router.push(href);}}
                          className={(isUnread?"font-black ":"font-semibold ")+"text-sm text-right hover:underline hover:text-blue-700 "+(isOpen?"text-slate-800":"text-slate-500")}
                          title="פתח את המסך הרלוונטי">
                          {a.title} <span className="text-blue-400 text-xs">↗</span>
                        </button>
                      ) : (
                        <span className={(isUnread?"font-black ":"font-semibold ")+"text-sm "+(isOpen?"text-slate-800":"text-slate-500")}>{a.title}</span>
                      );
                    })()}
                  </div>
                  {a.message && isOpen && <div className="text-xs text-slate-500 mb-0.5">{a.message}</div>}
                  <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                    {tenant&&<span>👤 {tenant}</span>}
                    {a.contracts?.properties?.name&&<span>🏢 {a.contracts.properties.name}</span>}
                    {a.due_date&&<span>📅 {fmtDate(a.due_date)}</span>}
                    {d!==null&&isOpen&&<span className={"font-semibold "+(d<=0?"text-red-600":d<=30?"text-red-500":"text-yellow-600")}>{d<=0?"באיחור "+Math.abs(d)+" ימים!":d+" יום"}</span>}
                  </div>
                </div>
                <div className="shrink-0 flex gap-1 flex-wrap justify-end">
                  {isOpen && (a.entity_type === "option" || a.entity_type === "contract_option") && a.entity_id && a.alert_type !== "option_auto_exercised" && (
                    <>
                      <button onClick={function(){setOptionExercised(a, true);}} disabled={!!working} className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50" title="האופציה ממומשת — החוזה יוארך עד סוף תקופת האופציה וההתראות ייפסקו">
                        {a.alert_type === "option_nonexercise_notice" ? "✓ מומשה" : "✓ התקבלה הודעת מימוש"}
                      </button>
                      <button onClick={function(){setOptionExercised(a, false);}} disabled={!!working} className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50" title="האופציה לא תמומש — החוזה יסתיים במועדו וההתראות ייפסקו">
                        {a.alert_type === "option_nonexercise_notice" ? "✗ התקבלה הודעת אי-מימוש" : "✗ אי-מימוש"}
                      </button>
                    </>
                  )}
                  {isUnread && (
                    <button onClick={function(){markRead(a.id);}} className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100" title="סמן כנקראה — נשארת פתוחה, תקפוץ שוב כ'חדש' אם תסלים (למשל 30 יום לפני מועד)">👁 נקראה</button>
                  )}
                  {isOpen ? (
                    <button onClick={function(){closeAlert(a.id);}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✓ סגור</button>
                  ) : (
                    <button onClick={function(){reopen(a.id);}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-50">↩ פתח</button>
                  )}
                  <button onClick={function(){deleteAlert(a.id);}} className="rounded-lg border border-red-100 px-2 py-1.5 text-xs text-red-400 hover:bg-red-50" title="מחק לצמיתות">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
