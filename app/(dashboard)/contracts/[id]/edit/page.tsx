"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { logAudit } from "../../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
const TABS = [{id:"general",l:"כללי",icon:"📋"},{id:"financials",l:"פיננסי",icon:"💰"},{id:"options",l:"אופציות",icon:"🔄"},{id:"tiers",l:"מדרגות",icon:"📊"}];
const INDEX_METHODS = [{v:"standard",l:"t-2 רגיל"},{v:"highest_in_period",l:"מדד גבוה ביותר"}];
const VAT_TYPES = [{v:"taxable",l:'חייב (18%)'},{v:"exempt",l:"פטור"},{v:"partial",l:"חלקי"}];

function fmtMoney(n: number) { return "₪"+Math.round(n??0).toLocaleString(); }

export default function ContractEditPage() {
  const router = useRouter();
  const params = useParams();
  const contractId = params?.id as string;
  const [tab,     setTab]     = useState("general");
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [contract,setContract]= useState<any>(null);
  const [options, setOptions] = useState<any[]>([]);
  const [tiers,   setTiers]   = useState<any[]>([]);

  // general
  const [startDate, setStartDate] = useState("");
  const [endDate,   setEndDate]   = useState("");
  const [status,    setStatus]    = useState("active");
  const [notes,     setNotes]     = useState("");
  // financials
  const [rentPerSqm,   setRentPerSqm]   = useState("");
  const [chargedArea,  setChargedArea]  = useState("");
  const [investAdd,    setInvestAdd]    = useState("");
  const [vatType,      setVatType]      = useState("taxable");
  const [indexMethod,  setIndexMethod]  = useState("standard");
  const [baseCPI,      setBaseCPI]      = useState("");
  const [baseCPIDate,  setBaseCPIDate]  = useState("");
  const [mgmtFeePct,   setMgmtFeePct]   = useState("");
  const [mgmtFeeFixed, setMgmtFeeFixed] = useState("");

  useEffect(function() { if(contractId)loadContract(); }, [contractId]);

  async function loadContract() {
    const [{ data: c }, { data: opts }, { data: tr }] = await Promise.all([
      supabase.from("contracts").select("*, tenants(name), properties(name)").eq("id",contractId).single(),
      supabase.from("contract_options").select("*").eq("contract_id",contractId).order("start_date"),
      supabase.from("contract_price_tiers").select("*").eq("contract_id",contractId).order("start_date"),
    ]);
    if (!c) { alert("חוזה לא נמצא"); router.push("/contracts"); return; }
    setContract(c);
    setStartDate(c.start_date?.split("T")[0]??"");
    setEndDate(c.end_date?.split("T")[0]??"");
    setStatus(c.status??"active");
    setNotes(c.notes??"");
    setRentPerSqm(c.rent_per_sqm?.toString()??"");
    setChargedArea(c.charged_area?.toString()??"");
    setInvestAdd(c.investment_addition?.toString()??"");
    setVatType(c.vat_type??"taxable");
    setIndexMethod(c.indexation_method??"standard");
    setBaseCPI(c.base_cpi_value?.toString()??"");
    setBaseCPIDate(c.base_cpi_date?.split("T")[0]??"");
    setMgmtFeePct(c.management_fee_pct?.toString()??"");
    setMgmtFeeFixed(c.management_fee_fixed?.toString()??"");
    setOptions(opts??[]);
    setTiers(tr??[]);
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload={
        start_date:startDate||null, end_date:endDate||null, status,
        notes:notes||null, rent_per_sqm:rentPerSqm?Number(rentPerSqm):null,
        charged_area:chargedArea?Number(chargedArea):null,
        investment_addition:investAdd?Number(investAdd):null,
        vat_type:vatType, indexation_method:indexMethod,
        base_cpi_value:baseCPI?Number(baseCPI):null, base_cpi_date:baseCPIDate||null,
        management_fee_pct:mgmtFeePct?Number(mgmtFeePct):null,
        management_fee_fixed:mgmtFeeFixed?Number(mgmtFeeFixed):null,
      };
      await supabase.from("contracts").update(payload).eq("id",contractId);
      await logAudit({entity_type:"contract",entity_id:contractId,action:"update"});
      router.push("/contracts");
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function addOption() {
    if (!endDate) { alert("נא הזן תאריך סיום חוזה קודם"); return; }
    const lastEnd = options.length>0 ? options[options.length-1].end_date : endDate;
    const newStart = lastEnd;
    const newEnd = new Date(new Date(lastEnd).getTime()+365*24*3600*1000).toISOString().split("T")[0];
    const { data } = await supabase.from("contract_options").insert({contract_id:contractId,start_date:newStart,end_date:newEnd,status:"pending"}).select().single();
    setOptions(function(prev){return [...prev,data];});
  }

  async function deleteOption(id: string) {
    if (!confirm("למחוק אופציה?")) return;
    await supabase.from("contract_options").delete().eq("id",id);
    setOptions(function(prev){return prev.filter(function(o){return o.id!==id;});});
  }

  async function addTier() {
    const { data } = await supabase.from("contract_price_tiers").insert({contract_id:contractId,start_date:startDate||new Date().toISOString().split("T")[0],rent_per_sqm:Number(rentPerSqm)||0,notes:""}).select().single();
    setTiers(function(prev){return [...prev,data];});
  }

  const baseRent = (Number(rentPerSqm)||0)*(Number(chargedArea)||0)+(Number(investAdd)||0);
  const vat = vatType==="taxable" ? baseRent*0.18 : 0;

  if (loading) return <div className="text-center py-20 text-slate-400">טוען...</div>;

  return (
    <div dir="rtl" className="max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">עריכת חוזה</h1>
          <p className="text-sm text-slate-500 mt-1">{contract?.tenants?.name} — {contract?.properties?.name}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={function(){router.push("/contracts/"+contractId+"/print");}} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">🖨 הדפס</button>
          <button onClick={function(){router.push("/contracts");}} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">ביטול</button>
          <button onClick={handleSave} disabled={saving} className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">{saving?"שומר...":"💾 שמור"}</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-5">
        {TABS.map(function(t){return (
          <button key={t.id} onClick={function(){setTab(t.id);}}
            className={"px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors "+(tab===t.id?"border-blue-600 text-blue-700":"border-transparent text-slate-500 hover:text-slate-700")}>
            {t.icon} {t.l}
          </button>
        );
        })}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        {tab==="general" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">תחילה</label><input type="date" value={startDate} onChange={function(e){setStartDate(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">סיום</label><input type="date" value={endDate} onChange={function(e){setEndDate(e.target.value);}} className={ic}/></div>
            </div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
              <div className="flex gap-2 flex-wrap">
                {["active","expiring","extended","upcoming","ended"].map(function(s){return (
                  <button key={s} type="button" onClick={function(){setStatus(s);}}
                    className={"rounded-xl border px-3 py-1.5 text-xs font-semibold "+(status===s?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
                    {s==="active"?"פעיל":s==="expiring"?"פוגה":s==="extended"?"מורחב":s==="upcoming"?"עתידי":"הסתיים"}
                  </button>
                );})}
              </div>
            </div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label><textarea value={notes} onChange={function(e){setNotes(e.target.value);}} rows={3} className={ic}/></div>
          </div>
        )}

        {tab==="financials" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">שכ"ד למ"ר (₪)</label><input type="number" value={rentPerSqm} onChange={function(e){setRentPerSqm(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">שטח מחויב (מ"ר)</label><input type="number" value={chargedArea} onChange={function(e){setChargedArea(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">תוספת השקעות (₪)</label><input type="number" value={investAdd} onChange={function(e){setInvestAdd(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">מע"מ</label><select value={vatType} onChange={function(e){setVatType(e.target.value);}} className={ic}>{VAT_TYPES.map(function(v){return <option key={v.v} value={v.v}>{v.l}</option>;})}</select></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">שיטת הצמדה</label><select value={indexMethod} onChange={function(e){setIndexMethod(e.target.value);}} className={ic}>{INDEX_METHODS.map(function(m){return <option key={m.v} value={m.v}>{m.l}</option>;})}</select></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">מדד בסיס</label><input type="number" value={baseCPI} onChange={function(e){setBaseCPI(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">תאריך מדד</label><input type="date" value={baseCPIDate} onChange={function(e){setBaseCPIDate(e.target.value);}} className={ic}/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול (%)</label><input type="number" value={mgmtFeePct} onChange={function(e){setMgmtFeePct(e.target.value);}} className={ic} placeholder="5"/></div>
            </div>
            {baseRent>0&&(
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 grid grid-cols-3 gap-2 text-center">
                {[{l:"בסיס",v:fmtMoney(baseRent)},{l:"מע\"מ",v:fmtMoney(vat)},{l:"סה\"כ",v:fmtMoney(baseRent+vat)}].map(function(k){return <div key={k.l}><div className="text-lg font-black text-blue-800">{k.v}</div><div className="text-xs text-blue-500">{k.l}</div></div>;})}
              </div>
            )}
          </div>
        )}

        {tab==="options" && (
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-slate-700">אופציות חידוש ({options.length})</h3>
              <button onClick={addOption} className="rounded-lg bg-blue-600 text-white text-xs px-3 py-1.5 font-semibold hover:bg-blue-700">+ הוסף אופציה</button>
            </div>
            {options.length===0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-400"><div className="text-4xl mb-2">🔄</div><div>אין אופציות</div></div>
            ) : (
              options.map(function(opt,i) {
                return (
                  <div key={opt.id} className="rounded-xl border border-slate-200 p-4 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-slate-800 text-sm">אופציה {i+1}</div>
                      <div className="text-xs text-slate-400">{opt.start_date?.split("T")[0]} — {opt.end_date?.split("T")[0]}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold "+(opt.status==="exercised"?"bg-green-100 text-green-700":opt.status==="expired"?"bg-red-100 text-red-700":"bg-blue-100 text-blue-700")}>
                        {opt.status==="exercised"?"מומשה":opt.status==="expired"?"פגה":"ממתינה"}
                      </span>
                      <button onClick={function(){deleteOption(opt.id);}} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab==="tiers" && (
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-slate-700">מדרגות שכ"ד ({tiers.length})</h3>
              <button onClick={addTier} className="rounded-lg bg-blue-600 text-white text-xs px-3 py-1.5 font-semibold hover:bg-blue-700">+ הוסף מדרגה</button>
            </div>
            {tiers.length===0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-400"><div className="text-4xl mb-2">📊</div><div>אין מדרגות מחיר</div></div>
            ) : (
              tiers.map(function(tier,i) {
                return (
                  <div key={tier.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-slate-700 text-sm">מדרגה {i+1}</span>
                      <button onClick={function(){void supabase.from("contract_price_tiers").delete().eq("id",tier.id);setTiers(function(prev){return prev.filter(function(t){return t.id!==tier.id;});}); }} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400">🗑</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-xs text-slate-500">תאריך תחילה</label><input type="date" defaultValue={tier.start_date?.split("T")[0]} onBlur={function(e){void supabase.from("contract_price_tiers").update({start_date:e.target.value}).eq("id",tier.id);}} className={ic+" mt-0.5"}/></div>
                      <div><label className="text-xs text-slate-500">שכ"ד למ"ר</label><input type="number" defaultValue={tier.rent_per_sqm} onBlur={function(e){void supabase.from("contract_price_tiers").update({rent_per_sqm:Number(e.target.value)}).eq("id",tier.id);}} className={ic+" mt-0.5"}/></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
