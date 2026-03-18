"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { syncContractStatuses } from "../../../lib/contractSync";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const TABS = [
  { id:"general",  label:"כללי",          icon:"⚙️" },
  { id:"sync",     label:"סנכרון",         icon:"🔄" },
  { id:"vat",      label:"מע\"מ",          icon:"💰" },
  { id:"about",    label:"אודות",          icon:"ℹ️" },
];

export default function SettingsPage() {
  const [tab,        setTab]        = useState("general");
  const [vatRates,   setVatRates]   = useState<any[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [alertsStatus, setAlertsStatus] = useState<string | null>(null);
  const [newRate,    setNewRate]    = useState("");
  const [newDate,    setNewDate]    = useState("");
  const [savingVat,  setSavingVat]  = useState(false);

  // general settings
  const [companyName, setCompanyName] = useState("נכסי הדר בע\"מ");
  const [timezone,    setTimezone]    = useState("Asia/Jerusalem");
  const [savedMsg,    setSavedMsg]    = useState("");

  useEffect(function() {
    if (tab === "vat") loadVatRates();
  }, [tab]);

  async function loadVatRates() {
    const { data } = await supabase.from("vat_rates").select("*").order("effective_from", { ascending: false });
    setVatRates(data ?? []);
  }

  async function handleSyncContracts() {
    setLoading(true); setSyncStatus(null);
    try {
      const count = await syncContractStatuses();
      setSyncStatus("✅ עודכנו " + count + " חוזים");
    } catch(e:any) {
      setSyncStatus("❌ שגיאה: " + e?.message);
    } finally { setLoading(false); }
  }

  async function handleSyncAlerts() {
    setLoading(true); setAlertsStatus(null);
    try {
      const res = await fetch("/api/alerts/sync", { method: "POST" });
      const d   = await res.json();
      setAlertsStatus("✅ נוצרו " + (d.created ?? 0) + " התראות");
    } catch(e:any) {
      setAlertsStatus("❌ שגיאה: " + e?.message);
    } finally { setLoading(false); }
  }

  async function handleSaveVat() {
    if (!newRate || !newDate) { alert("חובה: שיעור + תאריך"); return; }
    setSavingVat(true);
    try {
      await supabase.from("vat_rates").insert({
        rate_pct: Number(newRate),
        effective_from: newDate,
        notes: "עדכון ידני",
      });
      setNewRate(""); setNewDate("");
      await loadVatRates();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSavingVat(false); }
  }

  function showSaved() { setSavedMsg("✅ נשמר"); setTimeout(function(){setSavedMsg("");}, 2000); }

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">הגדרות</h1>
        <p className="text-sm text-slate-500 mt-1">הגדרות מערכת PropManager v4</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {TABS.map(function(t) {
          return (
            <button key={t.id} onClick={function(){setTab(t.id);}}
              className={"px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-all " +
                (tab===t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700")}>
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>

      {/* General */}
      {tab === "general" && (
        <div className="max-w-lg space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
            <h2 className="font-bold text-slate-800 text-sm">הגדרות כלליות</h2>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שם החברה</label>
              <input type="text" value={companyName} onChange={function(e){setCompanyName(e.target.value);}} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">אזור זמן</label>
              <select value={timezone} onChange={function(e){setTimezone(e.target.value);}} className={ic}>
                <option value="Asia/Jerusalem">ישראל (UTC+2/3)</option>
                <option value="UTC">UTC</option>
                <option value="Europe/London">לונדון</option>
              </select>
            </div>
            <button onClick={showSaved} className="w-full rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white hover:bg-blue-800">
              {savedMsg || "💾 שמור הגדרות"}
            </button>
          </div>
        </div>
      )}

      {/* Sync */}
      {tab === "sync" && (
        <div className="max-w-lg space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-5">
            <h2 className="font-bold text-slate-800 text-sm">סנכרון נתונים</h2>

            {/* sync contracts */}
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold text-slate-800 text-sm">סנכרון סטטוס חוזים</div>
                  <div className="text-xs text-slate-500 mt-1">
                    מעדכן חוזים מ-upcoming לactive, מactive לexpiring, ומpqiring לended
                  </div>
                  {syncStatus && <div className={"text-xs font-semibold mt-2 " + (syncStatus.startsWith("✅")?"text-green-600":"text-red-600")}>{syncStatus}</div>}
                </div>
                <button onClick={handleSyncContracts} disabled={loading}
                  className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                  {loading ? "⏳" : "🔄 סנכרן"}
                </button>
              </div>
            </div>

            {/* sync alerts */}
            <div className="rounded-xl bg-orange-50 border border-orange-200 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold text-slate-800 text-sm">יצירת התראות אוטומטיות</div>
                  <div className="text-xs text-slate-500 mt-1">
                    סורק חוזים פוגים, ערבויות לפגיה, ואופציות הדורשות הודעה
                  </div>
                  {alertsStatus && <div className={"text-xs font-semibold mt-2 " + (alertsStatus.startsWith("✅")?"text-green-600":"text-red-600")}>{alertsStatus}</div>}
                </div>
                <button onClick={handleSyncAlerts} disabled={loading}
                  className="shrink-0 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50">
                  {loading ? "⏳" : "🔔 צור התראות"}
                </button>
              </div>
            </div>

            {/* sync both */}
            <button onClick={async function(){await handleSyncContracts();await handleSyncAlerts();}}
              disabled={loading}
              className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              {loading ? "⏳ מסנכרן..." : "⚡ סנכרן הכל"}
            </button>
          </div>
        </div>
      )}

      {/* VAT */}
      {tab === "vat" && (
        <div className="max-w-lg space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
            <h2 className="font-bold text-slate-800 text-sm">שיעורי מע"מ</h2>
            <div className="space-y-2">
              {vatRates.map(function(v) {
                return (
                  <div key={v.id} className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-2.5">
                    <div>
                      <span className="font-bold text-slate-800 text-lg">{v.rate_pct}%</span>
                      <span className="text-xs text-slate-400 mr-2">מ-{new Date(v.effective_from).toLocaleDateString("he-IL")}</span>
                    </div>
                    {v.effective_to && <span className="text-xs text-slate-400">עד {new Date(v.effective_to).toLocaleDateString("he-IL")}</span>}
                    {!v.effective_to && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">נוכחי</span>}
                  </div>
                );
              })}
              {vatRates.length === 0 && <div className="text-sm text-slate-400 text-center py-4">אין רשומות</div>}
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="text-xs font-bold text-slate-600">הוסף שיעור חדש</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שיעור %</label>
                  <input type="number" value={newRate} onChange={function(e){setNewRate(e.target.value);}} className={ic} placeholder="18" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">בתוקף מ-</label>
                  <input type="date" value={newDate} onChange={function(e){setNewDate(e.target.value);}} className={ic} />
                </div>
              </div>
              <button onClick={handleSaveVat} disabled={savingVat}
                className="w-full rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                {savingVat ? "שומר..." : "+ הוסף שיעור"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* About */}
      {tab === "about" && (
        <div className="max-w-lg">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6 text-center">
            <div className="text-6xl mb-4">🏙️</div>
            <h2 className="text-2xl font-black text-slate-800 mb-1">PropManager</h2>
            <div className="text-blue-600 font-bold mb-4">גרסה 4.0</div>
            <div className="text-sm text-slate-500 space-y-1 text-right">
              {[
                "✅ ניהול נכסים מסחריים",
                "✅ חוזים + wizard 4 שלבים",
                "✅ הצמדה למדד CBS חי",
                "✅ שכ\"ד פידיון עם חישוב אוטומטי",
                "✅ ערבויות + ביטוחים + בטיחות",
                "✅ דמי ניהול אוטומטיים",
                "✅ דוחות + CSV",
                "✅ Timeline Gantt",
                "✅ התראות אוטומטיות",
                "✅ 29 מסכים",
              ].map(function(f) {
                return <div key={f} className="rounded-lg bg-slate-50 px-3 py-1.5">{f}</div>;
              })}
            </div>
            <div className="mt-5 text-xs text-slate-400">
              Next.js 15 + Supabase + Vercel<br />
              Built with PropManager Builder
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
