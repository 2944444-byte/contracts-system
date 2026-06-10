"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui';
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

export default function AlertsPage() {
  const [alerts,    setAlerts]    = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
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
    const { data } = await supabase.from("alerts").select("*, contracts(property_id, tenants(name), properties(id,name))").order("due_date", {ascending: true, nullsFirst: false}).order("created_at",{ascending:false});
    setAlerts(data??[]); setLoading(false);
  }

  async function closeAlert(id: string) {
    await supabase.from("alerts").update({is_resolved:true, handled_at: new Date().toISOString()}).eq("id",id);
    setAlerts(function(prev){return prev.map(function(a){return a.id===id?{...a,is_resolved:true}:a;});});
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

  return (
    <div dir="rtl">
      <PageHero title="התראות" icon="🔔" tone="amber"
        subtitle={<>
          {open.length} פתוחות
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
        ) : undefined} />

      {syncNote && <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700">{syncNote}</div>}

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
            const tenant = a.contracts?.tenants?.name || "";
            return (
              <div key={a.id} className={"rounded-xl border p-4 flex items-start gap-3 transition-all "+(isOpen?si.bg+" "+si.border:"bg-white border-slate-200 opacity-60")+(isSel?" ring-2 ring-blue-400":"")}>
                {isOpen&&<input type="checkbox" checked={isSel} onChange={function(){toggleSel(a.id);}} className="mt-1 w-4 h-4 shrink-0"/>}
                <span className="text-xl shrink-0" title={cat.label}>{cat.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 mb-0.5 flex-wrap">
                    <span className={"text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 "+si.color+" "+si.bg}>{si.label}</span>
                    <span className={"font-semibold text-sm "+(isOpen?"text-slate-800":"text-slate-500")}>{a.title}</span>
                  </div>
                  {a.message && isOpen && <div className="text-xs text-slate-500 mb-0.5">{a.message}</div>}
                  <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                    {tenant&&<span>👤 {tenant}</span>}
                    {a.contracts?.properties?.name&&<span>🏢 {a.contracts.properties.name}</span>}
                    {a.due_date&&<span>📅 {fmtDate(a.due_date)}</span>}
                    {d!==null&&isOpen&&<span className={"font-semibold "+(d<=0?"text-red-600":d<=30?"text-red-500":"text-yellow-600")}>{d<=0?"באיחור "+Math.abs(d)+" ימים!":d+" יום"}</span>}
                  </div>
                </div>
                <div className="shrink-0 flex gap-1">
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
