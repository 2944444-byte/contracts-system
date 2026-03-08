"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

const MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

export default function SettingsPage() {
  const [tab, setTab] = useState<"vat"|"cpi">("vat");
  const [vatPct, setVatPct] = useState("18");
  const [vatSaving, setVatSaving] = useState(false);
  const [vatMsg, setVatMsg] = useState("");
  const [cpiRecords, setCpiRecords] = useState<any[]>([]);
  const [cpiForm, setCpiForm] = useState({ year: "", month: "", value: "" });
  const [cpiMsg, setCpiMsg] = useState("");
  const [cpiLoading, setCpiLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchYear, setFetchYear] = useState(new Date().getFullYear().toString());

  useEffect(() => { loadCpi(); }, []);

  async function loadCpi() {
    const { data } = await supabase.from("cpi_records").select("*")
      .order("year", { ascending: false }).order("month", { ascending: false }).limit(120);
    setCpiRecords(data ?? []);
  }

  async function saveVat() {
    if (!vatPct || Number(vatPct) < 0 || Number(vatPct) > 30) { setVatMsg("ערך לא תקין"); return; }
    setVatSaving(true);
    await supabase.from("system_settings").upsert({ setting_name: "vat", vat_pct: Number(vatPct) }, { onConflict: "setting_name" });
    setVatMsg("✅ נשמר בהצלחה");
    setVatSaving(false);
    setTimeout(() => setVatMsg(""), 3000);
  }

  async function addCpi() {
    const { year, month, value } = cpiForm;
    if (!year || !month || !value) { setCpiMsg("מלא שנה, חודש וערך"); return; }
    setCpiLoading(true);
    const { error } = await supabase.from("cpi_records").upsert(
      { year: Number(year), month: Number(month), value: Number(value), base_year: 2020 },
      { onConflict: "year,month,base_year" }
    );
    setCpiMsg(error ? "שגיאה: " + error.message : "✅ נוסף");
    setCpiForm({ year: "", month: "", value: "" });
    await loadCpi();
    setCpiLoading(false);
    setTimeout(() => setCpiMsg(""), 3000);
  }

  async function fetchFromCbs() {
    setFetching(true);
    setCpiMsg("🔄 מושך ממשרד הסטטיסטיקה...");
    try {
      const res = await fetch(`/api/cpi?from_year=${Math.min(Number(fetchYear), new Date().getFullYear())}&to_year=${new Date().getFullYear()}&refresh=true`);
      const json = await res.json();
      setCpiMsg(json.added > 0 ? `✅ נוספו ${json.added} מדדים` : json.error ?? "לא נמצאו מדדים חדשים");
      await loadCpi();
    } catch { setCpiMsg("שגיאה בחיבור"); }
    setFetching(false);
    setTimeout(() => setCpiMsg(""), 5000);
  }

  const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400";
  const currentYear = new Date().getFullYear();
  const missingInfo = [currentYear-2, currentYear-1, currentYear].map(y => ({
    year: y, count: cpiRecords.filter(r => r.year === y).length
  }));

  return (
    <div dir="rtl" className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">⚙️ הגדרות מערכת</h1>
        <p className="text-sm text-slate-500 mt-1">מע&quot;מ, מדדי מחירים ותצורת המערכת</p>
      </div>

      <div className="flex gap-1 mb-6 rounded-lg bg-slate-100 p-1 w-fit">
        {[["vat","הגדרות מע\"מ 💸"],["cpi","מדד המחירים 📊"]].map(([t,l]) => (
          <button key={t} onClick={() => setTab(t as any)}
            className={`rounded-md px-5 py-2 text-sm font-bold transition-colors ${tab === t ? "bg-white shadow text-slate-800" : "text-slate-500"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "vat" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="font-bold text-slate-700 text-lg">הגדרות מע&quot;מ</h2>
          <p className="text-sm text-slate-500">אחוז המע&quot;מ הנוכחי. שינוי ישפיע על חישובי ערבויות ודמי ניהול בחוזים חדשים.</p>
          <div className="flex items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">אחוז מע&quot;מ</label>
              <div className="flex items-center gap-2">
                <input type="number" value={vatPct} onChange={e => setVatPct(e.target.value)}
                  min="0" max="30" step="0.5" className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <span className="font-bold text-slate-600">%</span>
              </div>
            </div>
            <button onClick={saveVat} disabled={vatSaving}
              className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
              {vatSaving ? "שומר..." : "💾 שמור"}
            </button>
          </div>
          {vatMsg && <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">{vatMsg}</div>}
        </div>
      )}

      {tab === "cpi" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-700 mb-3">סטטוס מדדים</h2>
            <div className="grid grid-cols-3 gap-3">
              {missingInfo.map(({ year, count }) => (
                <div key={year} className={`rounded-lg border p-3 text-center ${count < 12 ? "bg-orange-50 border-orange-200" : "bg-green-50 border-green-200"}`}>
                  <div className="font-bold text-slate-800 text-lg">{year}</div>
                  <div className="text-sm text-slate-600">{count} מדדים</div>
                  {count < 12 ? <div className="text-xs text-orange-600 font-semibold">{12-count} חסרים</div>
                               : <div className="text-xs text-green-600 font-semibold">✓ מלא</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-700 mb-3">🏛️ משיכה ממשרד הסטטיסטיקה</h2>
            <div className="flex gap-3 items-end">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
                <input type="number" value={fetchYear} onChange={e => setFetchYear(e.target.value)}
                  className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none" min="2010" max="2030" />
              </div>
              <button onClick={fetchFromCbs} disabled={fetching}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                {fetching ? "מושך..." : "⬇️ משוך מ-CBS"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-700 mb-3">✏️ הזנה ידנית</h2>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
                <input type="number" value={cpiForm.year} onChange={e => setCpiForm(p => ({...p, year: e.target.value}))} placeholder="2024" className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חודש</label>
                <select value={cpiForm.month} onChange={e => setCpiForm(p => ({...p, month: e.target.value}))} className={ic}>
                  <option value="">בחר</option>
                  {MONTHS.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">ערך מדד</label>
                <input type="number" value={cpiForm.value} onChange={e => setCpiForm(p => ({...p, value: e.target.value}))} placeholder="108.50" step="0.01" className={ic} />
              </div>
            </div>
            {cpiMsg && <div className={`mt-2 rounded px-3 py-1.5 text-sm ${cpiMsg.includes("שגיאה") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{cpiMsg}</div>}
            <button onClick={addCpi} disabled={cpiLoading}
              className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
              {cpiLoading ? "מוסיף..." : "➕ הוסף מדד"}
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b bg-slate-50">
              <h2 className="font-bold text-slate-700">מדדים קיימים ({cpiRecords.length})</h2>
            </div>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b sticky top-0">
                  <tr><th className="px-4 py-2">שנה</th><th className="px-4 py-2">חודש</th><th className="px-4 py-2">ערך</th><th className="px-4 py-2">שנת בסיס</th><th className="px-4 py-2 w-10"></th></tr>
                </thead>
                <tbody>
                  {cpiRecords.map(r => (
                    <tr key={r.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-2 font-bold text-slate-900">{r.year}</td>
                      <td className="px-4 py-2 font-medium text-slate-800">{MONTHS[r.month-1]}</td>
                      <td className="px-4 py-2 font-bold text-slate-900">{r.value}</td>
                      <td className="px-4 py-2"><span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">{r.base_year}=100</span></td>
                      <td className="px-4 py-2">
                        <button onClick={async () => { await supabase.from("cpi_records").delete().eq("id", r.id); setCpiRecords(p => p.filter(x => x.id !== r.id)); }}
                          className="text-red-400 hover:text-red-600 text-xs">🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
