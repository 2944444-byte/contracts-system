"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { authHeaders } from '@/lib/api-auth-client';
import { syncContractStatuses } from '@/lib/contractSync';
import { PageHero } from '@/components/ui';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
const TABS = [{id:"general",l:"כללי",icon:"⚙️"},{id:"sync",l:"סנכרון",icon:"🔄"},{id:"vat",l:'מע"מ',icon:"📊"},{id:"templates",l:"תבניות",icon:"📝"}];

export default function SettingsPage() {
  const [tab,        setTab]        = useState("general");
  const [syncing,    setSyncing]    = useState<string|null>(null);
  const [msg,        setMsg]        = useState("");
  const [vatRates,   setVatRates]   = useState<any[]>([]);
  const [templates,  setTemplates]  = useState<any[]>([]);
  const [savingTpl,  setSavingTpl]  = useState(false);
  const [cpiResult,  setCpiResult]  = useState<string|null>(null);
  const [cpiLoading, setCpiLoading] = useState(false);

  // general
  const [sysName, setSysName] = useState("PropManager v4");

  // VAT period in effect today (rates are newest-first by effective_from).
  const todayStr = new Date().toISOString().split("T")[0];
  const currentVat = vatRates.find(function(v){ return v.effective_from <= todayStr && (!v.effective_to || v.effective_to >= todayStr); }) || vatRates[0];

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: v }, { data: t }] = await Promise.all([
      supabase.from("vat_rates").select("*").order("effective_from",{ascending:false}),
      supabase.from("document_templates").select("*").order("name"),
    ]);
    setVatRates(v??[]);
    setTemplates(t??[]);
  }

  function showMsg(m: string) { setMsg(m); setTimeout(function(){setMsg("");},4000); }

  async function syncContracts() {
    setSyncing("contracts");
    const n = await syncContractStatuses();
    setSyncing(null);
    showMsg(n>0 ? `✅ עודכנו ${n} חוזים` : "✅ כל הסטטוסים מעודכנים");
  }

  async function syncAlerts() {
    setSyncing("alerts");
    try {
      const res = await fetch("/api/alerts/sync",{method:"POST", headers: await authHeaders()});
      const d = await res.json();
      showMsg(`✅ נוצרו ${d.created??0} התראות`);
    } catch { showMsg("❌ שגיאה בסנכרון התראות"); }
    finally { setSyncing(null); }
  }

  async function testCPI() {
    setCpiLoading(true); setCpiResult(null);
    try {
      const now = new Date();
      const m = now.getMonth()===0?12:now.getMonth();
      const y = now.getMonth()===0?now.getFullYear()-1:now.getFullYear();
      const t2m = m-1===0?12:m-1;
      const t2y = m-1===0?y-1:y;
      const pad = function(n: number){return String(n).padStart(2,"0");};
      const url = `https://api.cbs.gov.il/index/data/price?id=120010&startPeriod=${t2y}/${pad(t2m)}&endPeriod=${t2y}/${pad(t2m)}&format=json&download=false&lang=he`;
      const res = await fetch(url);
      const data = await res.json();
      const rows = data?.DataSet?.Series?.[0]?.obs??[];
      if (rows.length) setCpiResult(`✅ מדד t-2 (${t2m}/${t2y}): ${rows[0].obsValue??rows[0].value}`);
      else setCpiResult("⚠️ לא נמצא מדד");
    } catch { setCpiResult("❌ שגיאת חיבור ל-CBS"); }
    finally { setCpiLoading(false); }
  }

  async function addVatRate() {
    const rate = prompt("שיעור מע\"מ חדש (%):", "18");
    const from = prompt("תאריך תחילת תוקף (YYYY-MM-DD):", new Date().toISOString().split("T")[0]);
    if (!rate||!from) return;
    if (isNaN(Number(rate)) || !/^\d{4}-\d{2}-\d{2}$/.test(from)) { showMsg("❌ שיעור או תאריך לא תקין"); return; }
    const note = prompt("הערה (אופציונלי):", "עדכון שיעור מע\"מ") || null;
    // Close the previously-open period the day before the new rate takes effect,
    // so history stays non-overlapping and a retroactive calc can pick the rate
    // that applied on any given date. created_at records WHEN the change was made.
    const prevDay = new Date(from + "T00:00:00");
    prevDay.setDate(prevDay.getDate() - 1);
    const prevDayStr = prevDay.toISOString().split("T")[0];
    const openRows = (vatRates || []).filter(function(v){ return !v.effective_to && v.effective_from < from; });
    for (const r of openRows) {
      await supabase.from("vat_rates").update({ effective_to: prevDayStr }).eq("id", r.id);
    }
    await supabase.from("vat_rates").insert({ rate_pct: Number(rate), effective_from: from, effective_to: null, notes: note });
    await loadAll();
    showMsg("✅ שיעור מע\"מ נוסף — התקופה הקודמת נסגרה ל-" + prevDayStr);
  }

  async function addTemplate() {
    const name = prompt("שם תבנית:");
    if (!name) return;
    await supabase.from("document_templates").insert({name,body_template:"",is_active:true});
    await loadAll();
  }

  async function saveTemplate(id: string, body: string) {
    setSavingTpl(true);
    await supabase.from("document_templates").update({body_template:body}).eq("id",id);
    setSavingTpl(false);
    showMsg("✅ תבנית נשמרה");
  }

  return (
    <div dir="rtl">
      <PageHero title="הגדרות" icon="⚙️" tone="slate" />

      {msg&&<div className={"mb-4 rounded-xl border px-4 py-3 text-sm font-semibold "+(msg.startsWith("✅")?"bg-green-50 border-green-200 text-green-700":"bg-red-50 border-red-200 text-red-700")}>{msg}</div>}

      <div className="flex flex-wrap gap-1 border-b border-slate-200 mb-5">
        {TABS.map(function(t){return (
          <button key={t.id} onClick={function(){setTab(t.id);}}
            className={"px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px "+(tab===t.id?"border-blue-600 text-blue-700":"border-transparent text-slate-500 hover:text-slate-700")}>
            {t.icon} {t.l}
          </button>
        );})}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        {tab==="general"&&(
          <div className="space-y-4 max-w-md">
            <h3 className="font-bold text-slate-700 mb-4">הגדרות מערכת</h3>
            <div><label className="mb-1 block text-xs font-semibold text-slate-700">שם המערכת</label><input type="text" value={sysName} onChange={function(e){setSysName(e.target.value);}} className={ic}/></div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שיעור מע"מ נוכחי</label>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="font-bold text-blue-700">{currentVat ? currentVat.rate_pct + "%" : "—"}{currentVat ? " (מ-" + currentVat.effective_from + ")" : ""}</span>
                <button onClick={function(){setTab("vat");}} className="text-xs text-blue-600 hover:underline font-semibold">נהל שיעורי מע"מ →</button>
              </div>
              <p className="text-xs text-slate-400 mt-1">המע"מ מתקבל מההגדרות לפי תאריך התחולה. חישוב רטרואקטיבי משתמש בשיעור שהיה בתוקף באותו מועד.</p>
            </div>
            <div className="pt-2">
              <div className="rounded-xl bg-slate-50 border p-3 text-xs text-slate-500 space-y-1">
                <div>גרסה: PropManager v4</div>
                <div>Supabase: ndvcqgrpsqykhodiyrhx</div>
                <div>Deploy: Vercel — main branch</div>
              </div>
            </div>
          </div>
        )}

        {tab==="sync"&&(
          <div className="space-y-4">
            <h3 className="font-bold text-slate-700 mb-4">סנכרון נתונים</h3>
            {[
              {id:"contracts",l:"סנכרן סטטוסי חוזים",desc:"מעדכן active/expiring/ended לפי תאריכים",icon:"📄",fn:syncContracts},
              {id:"alerts",   l:"סנכרן התראות",       desc:"מייצר התראות לחוזים/ערבויות/ביטוחים פוגים",icon:"🔔",fn:syncAlerts},
            ].map(function(s){return (
              <div key={s.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                <div><div className="font-semibold text-slate-800 flex items-center gap-2"><span>{s.icon}</span>{s.l}</div><div className="text-xs text-slate-400 mt-0.5">{s.desc}</div></div>
                <button onClick={s.fn} disabled={!!syncing} className="rounded-lg bg-blue-700 text-white text-sm px-4 py-2 font-semibold hover:bg-blue-800 disabled:opacity-50">
                  {syncing===s.id?"⏳...":"הפעל"}
                </button>
              </div>
            );})}

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <div><div className="font-semibold text-slate-800 flex items-center gap-2">📈 בדיקת CBS API</div><div className="text-xs text-slate-400">שליפת מדד t-2 מה-CBS</div></div>
                <button onClick={testCPI} disabled={cpiLoading} className="rounded-lg border border-slate-200 text-sm px-4 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">{cpiLoading?"⏳...":"בדוק"}</button>
              </div>
              {cpiResult&&<div className={"text-sm font-semibold px-3 py-2 rounded-lg "+(cpiResult.startsWith("✅")?"bg-green-50 text-green-700":"bg-red-50 text-red-600")}>{cpiResult}</div>}
            </div>
          </div>
        )}

        {tab==="vat"&&(
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-700">שיעורי מע"מ ({vatRates.length})</h3>
              <button onClick={addVatRate} className="rounded-lg bg-blue-600 text-white text-xs px-3 py-1.5 font-semibold hover:bg-blue-700">+ הוסף</button>
            </div>
            {vatRates.length===0 ? <div className="text-center py-8 text-slate-400">אין שיעורי מע"מ</div> : (
              <div className="rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-right text-sm min-w-[640px]">
                  <thead className="bg-slate-50 border-b"><tr><th className="px-4 py-2.5 font-semibold text-slate-600">שיעור</th><th className="px-4 py-2.5 font-semibold text-slate-600">תחילה</th><th className="px-4 py-2.5 font-semibold text-slate-600">סיום</th><th className="px-4 py-2.5 font-semibold text-slate-600">הערה</th><th className="px-4 py-2.5 font-semibold text-slate-600">עודכן</th></tr></thead>
                  <tbody>
                    {vatRates.map(function(v){return (
                      <tr key={v.id} className="border-t border-slate-100">
                        <td className="px-4 py-2.5 font-bold text-blue-700">{v.rate_pct}%</td>
                        <td className="px-4 py-2.5 text-slate-600">{v.effective_from}</td>
                        <td className="px-4 py-2.5 text-slate-400">{v.effective_to??<span className="bg-green-100 text-green-700 px-1.5 rounded-full text-xs font-semibold">פעיל</span>}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{v.notes||"—"}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">{v.created_at ? new Date(v.created_at).toLocaleDateString("he-IL") : "—"}</td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab==="templates"&&(
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-700">תבניות מכתבים ({templates.length})</h3>
              <button onClick={addTemplate} className="rounded-lg bg-blue-600 text-white text-xs px-3 py-1.5 font-semibold hover:bg-blue-700">+ הוסף</button>
            </div>
            {templates.length===0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-400"><div className="text-4xl mb-2">📝</div><div>אין תבניות</div></div>
            ) : templates.map(function(t) {
              return (
                <div key={t.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-slate-800">{t.name}</span>
                    <div className="flex gap-2">
                      <span className={"text-xs px-2 py-0.5 rounded-full "+(t.is_active?"bg-green-100 text-green-700":"bg-slate-100 text-slate-500")}>{t.is_active?"פעילה":"לא פעילה"}</span>
                      <button onClick={function(){supabase.from("document_templates").update({is_active:!t.is_active}).eq("id",t.id).then(loadAll);}} className="text-xs border border-slate-200 rounded px-2 py-0.5 text-slate-500 hover:bg-slate-50">{t.is_active?"השבת":"הפעל"}</button>
                    </div>
                  </div>
                  <textarea defaultValue={t.body_template??""} rows={4}
                    onBlur={function(e){saveTemplate(t.id,e.target.value);}}
                    className={ic+" font-mono text-xs"}
                    placeholder="{{tenant_name}}, {{property_name}}, {{date}}"/>
                  <div className="text-xs text-slate-400 mt-1">משתנים: {"{{tenant_name}}"} {"{{property_name}}"} {"{{date}}"}</div>
                </div>
              );
            })}
            {savingTpl&&<div className="text-center text-xs text-slate-400">שומר...</div>}
          </div>
        )}
      </div>
    </div>
  );
}
