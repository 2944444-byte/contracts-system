"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

const MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

export default function CpiPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [fetchYear, setFetchYear] = useState(new Date().getFullYear());
  const [filterYear, setFilterYear] = useState<number | "all">("all");
  const [form, setForm] = useState({ year: "", month: "", value: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{text: string; type: "ok"|"err"|"warn"} | null>(null);

  const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400";

  async function load() {
    const { data } = await supabase.from("cpi_records").select("*").order("year", { ascending: false }).order("month", { ascending: false });
    setRecords(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function fetchFromCBS() {
    setFetching(true); setMsg(null);
    const res = await fetch(`/api/cpi?year=${fetchYear}&refresh=true`);
    const data = await res.json();
    if (data.error) {
      setMsg({ text: `שגיאה מהלמ"ס: ${data.error} — הזן ידנית`, type: "warn" });
    } else if (data.source === "cbs_empty") {
      setMsg({ text: `הלמ"ס החזיר תשובה אך לא זוהו נתונים — ניתן להזין ידנית`, type: "warn" });
    } else {
      setMsg({ text: `✅ עודכנו ${data.count} מדדים לשנת ${fetchYear}`, type: "ok" });
      load();
    }
    setFetching(false);
  }

  async function handleSave() {
    if (!form.year || !form.month || !form.value) { setMsg({ text: "מלא שנה, חודש וערך", type: "err" }); return; }
    setSaving(true);
    const res = await fetch("/api/cpi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: +form.year, month: +form.month, value: +form.value }) });
    const data = await res.json();
    if (data.error) setMsg({ text: data.error, type: "err" });
    else { setMsg({ text: "✅ נשמר!", type: "ok" }); setForm({ year: "", month: "", value: "" }); load(); }
    setSaving(false);
  }

  async function deleteRecord(id: string) {
    if (!confirm("למחוק?")) return;
    await supabase.from("cpi_records").delete().eq("id", id);
    load();
  }

  const years = [...new Set(records.map(r => r.year))].sort((a,b) => b-a);
  const displayed = filterYear === "all" ? records : records.filter(r => r.year === filterYear);

  const stats = {
    count: records.length,
    latest: records[0],
    earliestYear: years[years.length-1],
    latestYear: years[0],
  };

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">מדד המחירים לצרכן</h1>
        <p className="text-sm text-slate-500 mt-1">מאגר מדדים לחישוב הצמדות — בסיס 2020=100 • סדרה 120010</p>
      </div>

      {/* סטטיסטיקות */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-slate-800">{stats.count}</div>
          <div className="text-xs text-slate-500 mt-1">סה"כ רשומות</div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-blue-700">{stats.latest?.value ?? "—"}</div>
          <div className="text-xs text-blue-600 mt-1">מדד אחרון</div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-slate-600">{stats.earliestYear ?? "—"}–{stats.latestYear ?? "—"}</div>
          <div className="text-xs text-slate-500 mt-1">טווח שנים</div>
        </div>
      </div>

      {/* שליפה מהלמ"ס */}
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-5 mb-5 shadow-sm">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="text-2xl">🏛️</div>
          <div className="flex-1">
            <div className="font-bold text-blue-800">שליפה אוטומטית מהלמ"ס</div>
            <div className="text-xs text-blue-600 mt-0.5">מדד מחירים לצרכן כללי • בסיס 2020=100 • api.cbs.gov.il</div>
          </div>
          <select value={fetchYear} onChange={e => setFetchYear(+e.target.value)} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none">
            {Array.from({length: 15}, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={fetchFromCBS} disabled={fetching} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {fetching ? "⏳ מושך..." : "משוך מדדים"}
          </button>
        </div>
        {msg && (
          <div className={`mt-3 text-sm font-medium rounded-lg px-3 py-2 ${msg.type === "ok" ? "bg-green-100 text-green-700" : msg.type === "err" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
            {msg.text}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* הזנה ידנית */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-700 mb-4">✏️ הזנה ידנית</h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
              <input type="number" value={form.year} onChange={e => setForm(f => ({...f, year: e.target.value}))} placeholder={String(new Date().getFullYear())} className={ic} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">חודש</label>
              <select value={form.month} onChange={e => setForm(f => ({...f, month: e.target.value}))} className={ic}>
                <option value="">— בחר חודש —</option>
                {MONTHS.map((m,i) => <option key={i+1} value={i+1}>{m} ({i+1})</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">ערך המדד</label>
              <input type="number" step="0.01" value={form.value} onChange={e => setForm(f => ({...f, value: e.target.value}))} placeholder="112.50" className={ic} />
            </div>
            <button onClick={handleSave} disabled={saving} className="w-full rounded-lg bg-slate-700 py-2.5 font-bold text-white hover:bg-slate-800 disabled:opacity-50">
              {saving ? "שומר..." : "שמור מדד"}
            </button>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-400">
            <div className="font-medium text-slate-500 mb-1">מדדים עדכניים לדוגמה</div>
            <div>ינואר 2025: 115.5</div>
            <div>ינואר 2024: 112.8</div>
            <div>ינואר 2023: 108.2</div>
          </div>
        </div>

        {/* טבלה */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-700">📊 מאגר מדדים</h2>
            <select value={filterYear} onChange={e => setFilterYear(e.target.value === "all" ? "all" : +e.target.value)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 bg-white focus:outline-none">
              <option value="all">כל השנים ({records.length})</option>
              {years.map(y => <option key={y} value={y}>{y} ({records.filter(r => r.year === y).length})</option>)}
            </select>
          </div>
          <div className="overflow-auto max-h-[500px]">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-100 sticky top-0">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">שנה</th>
                  <th className="px-4 py-2.5 font-semibold">חודש</th>
                  <th className="px-4 py-2.5 font-semibold">ערך</th>
                  <th className="px-4 py-2.5 font-semibold">שינוי שנתי</th>
                  <th className="px-4 py-2.5 font-semibold">שינוי חודשי</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="py-8 text-center text-slate-400">טוען...</td></tr>
                ) : displayed.length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center text-slate-400">
                    <div className="text-4xl mb-2">📭</div>
                    <div>אין מדדים — משוך מהלמ"ס או הזן ידנית</div>
                  </td></tr>
                ) : displayed.map(r => {
                  const prevYear = records.find(x => x.year === r.year-1 && x.month === r.month);
                  const prevMonth = records.find(x => (x.year === r.year && x.month === r.month-1) || (x.year === r.year-1 && x.month === 12 && r.month === 1));
                  const yoy = prevYear ? ((r.value - prevYear.value) / prevYear.value * 100).toFixed(1) : null;
                  const mom = prevMonth ? ((r.value - prevMonth.value) / prevMonth.value * 100).toFixed(2) : null;
                  return (
                    <tr key={r.id} className="border-t border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-semibold text-slate-800">{r.year}</td>
                      <td className="px-4 py-2.5 text-slate-600">{MONTHS[r.month-1]}</td>
                      <td className="px-4 py-2.5 font-bold text-slate-800">{r.value}</td>
                      <td className="px-4 py-2.5">
                        {yoy && <span className={`text-xs font-bold ${+yoy > 0 ? "text-red-500" : "text-green-600"}`}>{+yoy > 0 ? "▲" : "▼"}{Math.abs(+yoy)}%</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {mom && <span className={`text-xs ${+mom > 0 ? "text-orange-500" : "text-slate-400"}`}>{+mom > 0 ? "+" : ""}{mom}%</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => deleteRecord(r.id)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
