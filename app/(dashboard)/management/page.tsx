"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

export default function ManagementFeePage() {
  const [contracts, setContracts] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [contract, setContract] = useState<any>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState("advance");

  // דמי ניהול Cost Plus
  const [actualCost,    setActualCost]    = useState("");
  const [plusPct,       setPlusPct]       = useState("15");
  const [plusFixed,     setPlusFixed]     = useState("");
  const [capPerSqm,     setCapPerSqm]     = useState("");
  const [capMonthly,    setCapMonthly]    = useState("");
  const [advancePerSqm, setAdvancePerSqm] = useState("");

  // חישוב
  const [result, setResult] = useState<any>(null);
  const [saving, setSaving]  = useState(false);

  useEffect(function() {
    supabase.from("contracts")
      .select("*, tenants(name), properties(name, total_rentable_area)")
      .in("status", ["active","expiring","extended"])
      .then(function({ data }) { setContracts(data ?? []); });
  }, []);

  useEffect(function() {
    if (!selectedId) { setContract(null); return; }
    const c = contracts.find(function(x) { return x.id === selectedId; });
    setContract(c ?? null);
    if (c?.mgmt_fee_per_sqm) setAdvancePerSqm(c.mgmt_fee_per_sqm.toString());
  }, [selectedId, contracts]);

  function calculate() {
    if (!contract || !actualCost) return;
    const area     = contract.charged_area ?? contract.properties?.total_rentable_area ?? 0;
    const cost     = Number(actualCost);
    const plus     = plusFixed ? Number(plusFixed) : cost * Number(plusPct) / 100;
    const subtotal = cost + plus;
    const capM     = capMonthly ? Number(capMonthly) : null;
    const capS     = capPerSqm  ? Number(capPerSqm) * area : null;
    const cap      = capM ?? capS ?? null;
    const actual   = cap ? Math.min(subtotal, cap) : subtotal;
    const advance  = advancePerSqm ? Number(advancePerSqm) * area : 0;
    const diff     = actual - advance;

    setResult({
      area, cost, plus, subtotal, cap, actual,
      advance, diff,
      isPlusPct: !plusFixed,
      plusRate: plusFixed ? null : Number(plusPct),
    });
  }

  async function handleCreateCharge() {
    if (!result || !contract) return;
    setSaving(true);
    try {
      const vat = Math.round(result.diff * 0.18 * 100) / 100;
      const total = result.diff + vat;
      const { error } = await supabase.from("charges").insert({
        contract_id:  contract.id,
        charge_type:  "management",
        period_start: year + "-01-01",
        period_end:   year + "-12-31",
        base_amount:  result.diff,
        vat_amount:   vat,
        total_amount: total,
        status:       "draft",
        notes:        "השלמת דמי ניהול " + year + " — Cost Plus " +
          (result.isPlusPct ? result.plusRate + "%" : "₪" + result.plus.toLocaleString()),
      });
      if (error) throw error;
      alert("חיוב נוצר — עבור לדף חיובים לאישור");
    } catch(e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setSaving(false); }
  }

  const currentYear = new Date().getFullYear();

  return (
    <div dir="rtl" className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">דמי ניהול — Cost Plus</h1>
        <p className="text-sm text-slate-500 mt-1">חישוב השלמת דמי ניהול שנתית לפי הוצאות בפועל</p>
      </div>

      {/* בחירה */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm mb-5">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה</label>
            <select value={selectedId} onChange={function(e) { setSelectedId(e.target.value); setResult(null); }} className={ic}>
              <option value="">-- בחר חוזה --</option>
              {contracts.map(function(c) {
                return <option key={c.id} value={c.id}>{c.tenants?.name} — {c.properties?.name}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
            <select value={year} onChange={function(e) { setYear(Number(e.target.value)); setResult(null); }} className={ic}>
              {[currentYear-1, currentYear, currentYear+1].map(function(y) {
                return <option key={y} value={y}>{y}</option>;
              })}
            </select>
          </div>
        </div>

        {contract && (
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs text-slate-700 grid grid-cols-3 gap-2">
            <div><span className="text-blue-600">שוכר</span><div className="font-bold">{contract.tenants?.name}</div></div>
            <div><span className="text-blue-600">שטח מחויב</span><div className="font-bold">{contract.charged_area ?? "—"} מ"ר</div></div>
            <div><span className="text-blue-600">מקדמה למ"ר</span><div className="font-bold">₪{contract.mgmt_fee_per_sqm ?? "—"}</div></div>
          </div>
        )}
      </div>

      {/* טאבים */}
      {contract && (
        <>
          <div className="flex gap-1 mb-5 border-b border-slate-200">
            {[
              { key: "advance",  label: "מקדמות חודשיות" },
              { key: "annual",   label: "חישוב שנתי" },
              { key: "grace",    label: "גרייס" },
            ].map(function(t) {
              return (
                <button key={t.key} onClick={function() { setTab(t.key); }}
                  className={"px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors " +
                    (tab === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700")}>
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* מקדמות */}
          {tab === "advance" && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <h2 className="font-bold text-slate-700">מקדמת דמי ניהול חודשית</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מקדמה למ"ר לחודש (₪)</label>
                  <input type="number" step="0.01" value={advancePerSqm}
                    onChange={function(e) { setAdvancePerSqm(e.target.value); }} className={ic} placeholder="5" />
                </div>
                {advancePerSqm && contract.charged_area && (
                  <div className="flex items-end pb-2">
                    <div>
                      <div className="text-xs text-slate-500">מקדמה חודשית</div>
                      <div className="text-xl font-bold text-slate-800">
                        ₪{Math.round(Number(advancePerSqm) * contract.charged_area).toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-400">שנתי: ₪{Math.round(Number(advancePerSqm) * contract.charged_area * 12).toLocaleString()}</div>
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800">
                💡 המקדמה נגבית מדי חודש. בסוף השנה מחושב ההפרש בין המקדמות לבין הוצאות בפועל.
              </div>
            </div>
          )}

          {/* חישוב שנתי */}
          {tab === "annual" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <h2 className="font-bold text-slate-700">הוצאות בפועל + Plus</h2>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">הוצאות ניהול בפועל לשנת {year} (₪)</label>
                  <input type="number" value={actualCost}
                    onChange={function(e) { setActualCost(e.target.value); setResult(null); }} className={ic} placeholder="0" />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold text-slate-700">רכיב Plus</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">אחוז Plus (%)</label>
                      <input type="number" value={plusPct}
                        onChange={function(e) { setPlusPct(e.target.value); setPlusFixed(""); setResult(null); }}
                        className={ic} placeholder="15" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">או: Plus קבוע (₪)</label>
                      <input type="number" value={plusFixed}
                        onChange={function(e) { setPlusFixed(e.target.value); setPlusPct(""); setResult(null); }}
                        className={ic} placeholder="0" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">תקרה חודשית (₪) — אופציונלי</label>
                    <input type="number" value={capMonthly}
                      onChange={function(e) { setCapMonthly(e.target.value); setResult(null); }} className={ic} placeholder="לא מוגבל" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">או: תקרה למ"ר (₪)</label>
                    <input type="number" value={capPerSqm}
                      onChange={function(e) { setCapPerSqm(e.target.value); setResult(null); }} className={ic} placeholder="לא מוגבל" />
                  </div>
                </div>

                <button onClick={calculate} disabled={!actualCost}
                  className="w-full rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                  חשב השלמה
                </button>
              </div>

              {/* תוצאה */}
              {result && (
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="font-bold text-slate-700 mb-4">📊 תוצאת חישוב שנת {year}</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-1.5 border-b border-slate-100">
                      <span className="text-slate-500">הוצאות בפועל</span>
                      <span className="font-medium">₪{result.cost.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-slate-100">
                      <span className="text-slate-500">
                        רכיב Plus {result.isPlusPct ? "(" + result.plusRate + "%)" : "(קבוע)"}
                      </span>
                      <span className="font-medium">₪{Math.round(result.plus).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-slate-100">
                      <span className="text-slate-500">סה"כ לפני תקרה</span>
                      <span className="font-medium">₪{Math.round(result.subtotal).toLocaleString()}</span>
                    </div>
                    {result.cap && (
                      <div className="flex justify-between py-1.5 border-b border-slate-100">
                        <span className="text-slate-500">תקרה מוסכמת</span>
                        <span className="font-medium text-orange-600">₪{Math.round(result.cap).toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-1.5 border-b border-slate-100">
                      <span className="text-slate-500">דמי ניהול בפועל</span>
                      <span className="font-bold">₪{Math.round(result.actual).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-slate-100">
                      <span className="text-slate-500">מקדמות ששולמו ({year})</span>
                      <span className="font-medium text-blue-600">₪{Math.round(result.advance).toLocaleString()}</span>
                    </div>
                    <div className={"flex justify-between py-2 rounded-lg px-3 mt-2 " +
                      (result.diff >= 0 ? "bg-orange-50" : "bg-green-50")}>
                      <span className={"font-bold " + (result.diff >= 0 ? "text-orange-700" : "text-green-700")}>
                        {result.diff >= 0 ? "השלמה לחיוב" : "זיכוי לשוכר"}
                      </span>
                      <span className={"text-xl font-black " + (result.diff >= 0 ? "text-orange-700" : "text-green-700")}>
                        ₪{Math.abs(Math.round(result.diff)).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {result.diff !== 0 && (
                    <button onClick={handleCreateCharge} disabled={saving}
                      className={"w-full mt-4 rounded-lg py-2.5 font-bold text-white disabled:opacity-50 " +
                        (result.diff >= 0 ? "bg-orange-600 hover:bg-orange-700" : "bg-green-600 hover:bg-green-700")}>
                      {saving ? "יוצר..." : result.diff >= 0 ? "צור חיוב השלמה" : "צור זיכוי"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* גרייס */}
          {tab === "grace" && (
            <GraceCalculator contract={contract} />
          )}
        </>
      )}
    </div>
  );
}

function GraceCalculator({ contract }: { contract: any }) {
  const ic2 = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400";
  const [graceType,    setGraceType]    = useState("full");
  const [graceMonths,  setGraceMonths]  = useState("2");
  const [gracePct,     setGracePct]     = useState("50");
  const [graceStart,   setGraceStart]   = useState(contract?.start_date?.split("T")[0] ?? "");
  const [saving,       setSaving]       = useState(false);

  const monthly = (contract?.rent_per_sqm ?? 0) * (contract?.charged_area ?? 0) + (contract?.investment_addition ?? 0);
  const discountPct  = graceType === "full" ? 100 : Number(gracePct);
  const discountMonthly = Math.round(monthly * discountPct / 100);
  const totalDiscount   = discountMonthly * Number(graceMonths);

  async function handleCreateGrace() {
    if (!graceStart || !graceMonths) { alert("חובה: תאריך התחלה ומספר חודשים"); return; }
    setSaving(true);
    try {
      const d = new Date(graceStart);
      d.setMonth(d.getMonth() + Number(graceMonths));
      const graceEnd = d.toISOString().split("T")[0];

      // חיוב גרייס = סכום שלילי (הנחה)
      const { error } = await supabase.from("charges").insert({
        contract_id:  contract.id,
        charge_type:  "rent",
        period_start: graceStart,
        period_end:   graceEnd,
        base_amount:  -discountMonthly * Number(graceMonths),
        vat_amount:   0,
        total_amount: -discountMonthly * Number(graceMonths),
        status:       "draft",
        notes:        "גרייס " + (graceType === "full" ? "מלא" : gracePct + "%") + " — " + graceMonths + " חודשים",
      });
      if (error) throw error;
      alert("חיוב גרייס נוצר — עבור לדף חיובים");
    } catch(e: any) { alert("שגיאה: " + (e as any)?.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <h2 className="font-bold text-slate-700">הגדרת תקופת גרייס</h2>

      <div>
        <label className="mb-2 block text-xs font-semibold text-slate-700">סוג גרייס</label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: "full",    label: "גרייס מלא",   desc: "שכ\"ד = 0" },
            { value: "partial", label: "גרייס חלקי",  desc: "% הנחה" },
            { value: "days",    label: "ימי רבעון",   desc: "שיק ראשון לפי ימים" },
          ].map(function(t) {
            return (
              <button key={t.value} type="button"
                onClick={function() { setGraceType(t.value); }}
                className={"rounded-xl border p-3 text-center transition-all " +
                  (graceType === t.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                <div className={"text-sm font-bold " + (graceType === t.value ? "text-blue-700" : "text-slate-700")}>
                  {t.label}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{t.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך תחילת גרייס</label>
          <input type="date" value={graceStart}
            onChange={function(e) { setGraceStart(e.target.value); }} className={ic2} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">מספר חודשי גרייס</label>
          <input type="number" value={graceMonths}
            onChange={function(e) { setGraceMonths(e.target.value); }} className={ic2} placeholder="2" />
        </div>
      </div>

      {graceType === "partial" && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">אחוז הנחה (%)</label>
          <input type="number" value={gracePct}
            onChange={function(e) { setGracePct(e.target.value); }} className={ic2} placeholder="50" />
        </div>
      )}

      {graceType === "days" && (
        <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800">
          💡 שיק ראשון = לפי ימי הרבעון הנותרים מתאריך הכניסה, בניכוי גרייס. לדוגמה: כניסה ב-10 בינואר = 21 ימים מתוך 90, פחות גרייס.
        </div>
      )}

      {monthly > 0 && graceMonths && (
        <div className="rounded-lg bg-orange-50 border border-orange-200 p-4">
          <div className="text-sm text-slate-600 mb-1">סיכום גרייס:</div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">שכ"ד חודשי</span>
            <span className="font-medium">₪{monthly.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">הנחה ({discountPct}%)</span>
            <span className="font-medium text-orange-600">-₪{discountMonthly.toLocaleString()}/חודש</span>
          </div>
          <div className="flex justify-between font-bold text-base mt-2 pt-2 border-t border-orange-200">
            <span className="text-slate-700">סה"כ הנחת גרייס ({graceMonths} חודשים)</span>
            <span className="text-orange-700">-₪{totalDiscount.toLocaleString()}</span>
          </div>
        </div>
      )}

      <button onClick={handleCreateGrace} disabled={saving}
        className="w-full rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
        {saving ? "יוצר..." : "צור חיוב גרייס"}
      </button>
    </div>
  );
}
