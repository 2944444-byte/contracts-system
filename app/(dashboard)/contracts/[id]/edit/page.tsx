"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400";

export default function ContractEditPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [contract, setContract] = useState<any>(null);
  const [tab,      setTab]      = useState("general");

  const [startDate,   setStartDate]   = useState("");
  const [endDate,     setEndDate]     = useState("");
  const [status,      setStatus]      = useState("active");
  const [notes,       setNotes]       = useState("");
  const [rentPerSqm,  setRentPerSqm]  = useState("");
  const [chargedArea, setChargedArea] = useState("");
  const [investAdd,   setInvestAdd]   = useState("");
  const [vatType,     setVatType]     = useState("taxable");
  const [indexMethod, setIndexMethod] = useState("standard");
  const [baseCPI,     setBaseCPI]     = useState("");
  const [baseCPIDate, setBaseCPIDate] = useState("");
  const [mgmtFeePct,  setMgmtFeePct]  = useState("");

  useEffect(function() { if (id) load(); }, [id]);

  async function load() {
    const { data } = await supabase.from("contracts")
      .select("*, tenants(name), properties(name)")
      .eq("id", id).single();
    if (!data) { router.push("/contracts"); return; }
    setContract(data);
    setStartDate(data.start_date?.split("T")[0] ?? "");
    setEndDate(data.end_date?.split("T")[0] ?? "");
    setStatus(data.status ?? "active");
    setNotes(data.notes ?? "");
    setRentPerSqm(data.rent_per_sqm?.toString() ?? "");
    setChargedArea(data.charged_area?.toString() ?? "");
    setInvestAdd(data.investment_addition?.toString() ?? "");
    setVatType(data.vat_type ?? "taxable");
    setIndexMethod(data.indexation_method ?? "standard");
    setBaseCPI(data.base_cpi_value?.toString() ?? "");
    setBaseCPIDate(data.base_cpi_date?.split("T")[0] ?? "");
    setMgmtFeePct(data.management_fee_pct?.toString() ?? "");
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    try {
      await supabase.from("contracts").update({
        start_date: startDate || null,
        end_date:   endDate   || null,
        status, notes: notes || null,
        rent_per_sqm:       rentPerSqm  ? Number(rentPerSqm)  : null,
        charged_area:       chargedArea ? Number(chargedArea) : null,
        investment_addition: investAdd  ? Number(investAdd)   : null,
        vat_type: vatType, indexation_method: indexMethod,
        base_cpi_value: baseCPI     ? Number(baseCPI)  : null,
        base_cpi_date:  baseCPIDate || null,
        management_fee_pct: mgmtFeePct ? Number(mgmtFeePct) : null,
      }).eq("id", id);
      await logAudit({ entity_type: "contract", entity_id: id, action: "update" });
      router.push("/contracts");
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  const baseRent = (Number(rentPerSqm)||0)*(Number(chargedArea)||0)+(Number(investAdd)||0);
  const vat = vatType === "taxable" ? baseRent * 0.18 : 0;
  const fmtMoney = function(n: number) { return "₪" + Math.round(n).toLocaleString(); };

  if (loading) return <div className="flex items-center justify-center min-h-64 text-slate-400" dir="rtl">טוען...</div>;

  return (
    <div dir="rtl" className="max-w-2xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">עריכת חוזה</h1>
          <p className="text-sm text-slate-500 mt-1">{contract?.tenants?.name} — {contract?.properties?.name}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={function(){router.push("/contracts");}} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">ביטול</button>
          <button onClick={function(){router.push("/contracts/"+id+"/print");}} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">🖨 הדפס</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "שומר..." : "💾 שמור"}</button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-5">
        {[{id:"general",l:"📋 כללי"},{id:"financials",l:"💰 פיננסי"}].map(function(t){return (
          <button key={t.id} onClick={function(){setTab(t.id);}}
            className={"px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px " + (tab===t.id?"border-blue-600 text-blue-700":"border-transparent text-slate-500 hover:text-slate-700")}>
            {t.l}
          </button>
        );})}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        {tab === "general" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תחילה</label>
                <input type="date" value={startDate} onChange={function(e){setStartDate(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סיום</label>
                <input type="date" value={endDate} onChange={function(e){setEndDate(e.target.value);}} className={ic} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
              <div className="flex gap-2 flex-wrap">
                {[{v:"active",l:"פעיל"},{v:"expiring",l:"פוגה"},{v:"extended",l:"מורחב"},{v:"upcoming",l:"עתידי"},{v:"ended",l:"הסתיים"}].map(function(s){return (
                  <button key={s.v} type="button" onClick={function(){setStatus(s.v);}}
                    className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " + (status===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
                    {s.l}
                  </button>
                );})}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
              <textarea value={notes} onChange={function(e){setNotes(e.target.value);}} rows={3} className={ic} />
            </div>
          </div>
        )}

        {tab === "financials" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שכ"ד למ"ר (₪)</label>
                <input type="number" value={rentPerSqm} onChange={function(e){setRentPerSqm(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שטח (מ"ר)</label>
                <input type="number" value={chargedArea} onChange={function(e){setChargedArea(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תוספת (₪)</label>
                <input type="number" value={investAdd} onChange={function(e){setInvestAdd(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מע"מ</label>
                <select value={vatType} onChange={function(e){setVatType(e.target.value);}} className={ic}>
                  <option value="taxable">חייב 18%</option>
                  <option value="exempt">פטור</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הצמדה</label>
                <select value={indexMethod} onChange={function(e){setIndexMethod(e.target.value);}} className={ic}>
                  <option value="standard">t-2 רגיל</option>
                  <option value="highest_in_period">מדד גבוה</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מדד בסיס</label>
                <input type="number" value={baseCPI} onChange={function(e){setBaseCPI(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך מדד</label>
                <input type="date" value={baseCPIDate} onChange={function(e){setBaseCPIDate(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול %</label>
                <input type="number" value={mgmtFeePct} onChange={function(e){setMgmtFeePct(e.target.value);}} className={ic} />
              </div>
            </div>
            {baseRent > 0 && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 grid grid-cols-3 gap-2 text-center">
                {[{l:"בסיס",v:fmtMoney(baseRent)},{l:'מע"מ',v:fmtMoney(vat)},{l:"סה\"כ",v:fmtMoney(baseRent+vat)}].map(function(k){return (
                  <div key={k.l}><div className="text-lg font-black text-blue-800">{k.v}</div><div className="text-xs text-blue-500">{k.l}</div></div>
                );})}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
