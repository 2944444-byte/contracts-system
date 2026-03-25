"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { syncContractStatuses } from '@/lib/contractSync';
import { logAudit } from '@/lib/audit-log';
// CPI calculated client-side from cpi_records (cumulative % chain)

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function fmtMoney(n: number) { return "₪"+Math.round(n??0).toLocaleString(); }

function yearsMonthsLeft(endDate: string) {
  const now = new Date();
  const end = new Date(endDate);
  if (isNaN(end.getTime())) return null;
  const diffMs = end.getTime() - now.getTime();
  if (diffMs <= 0) return { years: 0, months: 0, text: "פג!", isExpired: true };
  const totalMonths = Math.floor(diffMs / (1000*60*60*24*30.44));
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  let text = "";
  if (years > 0) text += years + " שנים";
  if (years > 0 && months > 0) text += " ו-";
  if (months > 0) text += months + " חודשים";
  if (!text) text = "פחות מחודש";
  return { years, months, text, isExpired: false };
}

// t-2 rule: current billing month minus 2 → that's the known index month
function getT2Date(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${mm}-${yyyy}`;
}

function getBaseIndexDate(indexBaseDate: string|null, startDate: string|null): string|null {
  // t-2 rule: base index = 2 months before the index_base_date (or start_date)
  // Example: index_base_date=2020-06-15 → t-2 = April 2020 → "04-2020"
  const refDate = indexBaseDate || startDate;
  if (!refDate) return null;
  const d = new Date(refDate);
  if (isNaN(d.getTime())) return null;
  // Apply t-2: subtract 2 months
  d.setMonth(d.getMonth() - 2);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

const STATUS_MAP: Record<string,{label:string;color:string;dot:string}> = {
  active:   {label:"פעיל",    color:"bg-green-100 text-green-700",  dot:"bg-green-500"},
  expiring: {label:"פוגה",   color:"bg-yellow-100 text-yellow-700",dot:"bg-yellow-500"},
  extended: {label:"מורחב",  color:"bg-blue-100 text-blue-700",    dot:"bg-blue-500"},
  upcoming: {label:"עתידי",  color:"bg-purple-100 text-purple-700",dot:"bg-purple-500"},
  ended:    {label:"הסתיים", color:"bg-slate-100 text-slate-500",  dot:"bg-slate-400"},
};

export default function ContractsPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [syncing,   setSyncing]   = useState(false);
  const [selected,  setSelected]  = useState<string|null>(null);
  const [filterSt,  setFilterSt]  = useState("active");
  const [search,    setSearch]    = useState("");
  const [cpiResult, setCpiResult] = useState<any>(null);
  const [cpiLoading, setCpiLoading] = useState(false);

  useEffect(function() { loadContracts(); }, []);

  async function loadContracts() {
    const { data } = await supabase.from("contracts")
      .select("*, tenants(name,phone,primary_email,company_name), properties(name,city), contract_options(id,option_number,duration_months,duration_years,end_date,notice_days_before_end,notice_type,status,is_exercised,rent_mechanism,rent_increase_pct,new_rent_value), guarantees(id,guarantee_type,status,amount_required,amount_actual,end_date,bank), contract_spaces(space_id,spaces(space_name,area))")
      .order("end_date");
    setContracts(data??[]);
    setLoading(false);
    if (!selected && (data??[]).filter(function(c){return c.status==="active";}).length>0) {
      setSelected((data??[]).filter(function(c){return c.status==="active";})[0].id);
    }
  }

  const selContract = contracts.find(function(c){return c.id===selected;});

  // Load CPI-adjusted price from cpi_records table
  // Uses simple ratio: adjusted = base_rent * (current_index / base_index)
  // All records in our DB share the same base_year so ratio is valid
  useEffect(function() {
    if (!selContract) { setCpiResult(null); return; }
    if (selContract.indexation_method === "none") { setCpiResult(null); return; }
    const rentPerSqm = Number(selContract.rent_per_sqm);
    if (!rentPerSqm) { setCpiResult(null); return; }

    const baseDate = getBaseIndexDate(selContract.index_base_date, selContract.start_date);
    if (!baseDate) { setCpiResult(null); return; }

    // True rent = base + investment per sqm
    const investPerSqm = selContract.charged_area > 0 && selContract.investment_addition
      ? Number(selContract.investment_addition) / Number(selContract.charged_area)
      : 0;
    const totalRentPerSqm = rentPerSqm + investPerSqm;

    // Parse base date MM-YYYY
    const [bMM, bYYYY] = baseDate.split("-");
    const baseMonth = Number(bMM);
    const baseYr = Number(bYYYY);

    // t-2: current index = 2 months before today
    const today = new Date();
    const t2 = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    const toMonth = t2.getMonth() + 1;
    const toYear = t2.getFullYear();

    setCpiLoading(true);
    const cbsFromDate = `${bMM}-01-${bYYYY}`;
    const cbsToDate = `${String(toMonth).padStart(2,'0')}-01-${toYear}`;
    const cbsUrl = `/api/cpi-calc?value=${totalRentPerSqm}&from=${baseDate}&to=${String(toMonth).padStart(2,'0')}-${toYear}`;

    // Primary: CBS Calculator via API route (exact result)
    // Fallback: cumulative % chain from cpi_records (close approximation)
    fetch(cbsUrl)
      .then(function(r) { if (!r.ok) throw new Error("API " + r.status); return r.json(); })
      .then(function(data) {
        if (!data.to_value) throw new Error("No to_value");
        setCpiResult({
          success: true, source: "cbs",
          baseRentPerSqm: Math.round(totalRentPerSqm * 100) / 100,
          adjustedRentPerSqm: Math.round(data.to_value * 100) / 100,
          changePct: data.change_percent ?? null,
          fromDate: data.from_index_date || baseDate,
          toDate: data.to_index_date || `${toMonth}/${toYear}`,
          fromIndexValue: data.from_index_value ?? null,
          toIndexValue: data.to_index_value ?? null,
          baseYear: data.base_year ?? null,
          verificationUrl: data.verification_url ?? null,
        });
        setCpiLoading(false);
      })
      .catch(function() {
        // Fallback: cumulative % from Supabase cpi_records
        supabase.from("cpi_records")
          .select("year,month,value,base_year,percent_change")
          .or(`year.gt.${baseYr},and(year.eq.${baseYr},month.gte.${baseMonth})`)
          .order("year").order("month")
          .then(function({ data: records }) {
            if (!records || records.length < 2) { setCpiResult(null); setCpiLoading(false); return; }
            const baseRec = records.find(function(r) { return r.year === baseYr && r.month === baseMonth; });
            if (!baseRec) { setCpiResult(null); setCpiLoading(false); return; }
            let cumulative = 1.0;
            let lastRec = baseRec;
            for (let i = 0; i < records.length; i++) {
              const r = records[i];
              if ((r.year > toYear) || (r.year === toYear && r.month > toMonth)) break;
              if (((r.year > baseYr) || (r.year === baseYr && r.month > baseMonth)) && r.percent_change != null) {
                cumulative *= (1 + Number(r.percent_change) / 100);
                lastRec = r;
              }
            }
            setCpiResult({
              success: true, source: "local",
              baseRentPerSqm: Math.round(totalRentPerSqm * 100) / 100,
              adjustedRentPerSqm: Math.round(totalRentPerSqm * cumulative * 100) / 100,
              changePct: Math.round((cumulative - 1) * 1000) / 10,
              fromDate: `${baseMonth}/${baseYr}`,
              toDate: `${lastRec.month}/${lastRec.year}`,
              fromIndexValue: Number(baseRec.value),
              toIndexValue: Number(lastRec.value),
              baseYear: baseRec.base_year || null,
              verificationUrl: `https://api.cbs.gov.il/index/data/calculator/120010?value=${totalRentPerSqm}&date=${cbsFromDate}&toDate=${cbsToDate}&format=json`,
            });
            setCpiLoading(false);
          });
      });
  }, [selected]);

  async function handleSync() {
    setSyncing(true);
    const n = await syncContractStatuses();
    await loadContracts();
    setSyncing(false);
    if (n>0) alert(`✅ עודכנו ${n} חוזים`);
  }

  async function handleExerciseOption(optionId: string, exercised: boolean) {
    await supabase.from("contract_options").update({
      is_exercised: exercised,
      status: exercised ? "exercised" : "pending",
    }).eq("id", optionId);
    await loadContracts();
  }

  const filtered = contracts.filter(function(c) {
    const ms = filterSt==="all" || c.status===filterSt;
    const mq = !search || c.tenants?.name?.includes(search) || c.properties?.name?.includes(search);
    return ms && mq;
  });

  // selContract already defined above
  const baseRent    = selContract ? (selContract.rent_per_sqm??0)*(selContract.charged_area??0)+(selContract.investment_addition??0) : 0;
  const investPerSqm = selContract && selContract.charged_area > 0 && selContract.investment_addition
    ? Math.round(selContract.investment_addition / selContract.charged_area * 100) / 100 : 0;
  const trueRentPerSqm = (selContract?.rent_per_sqm ?? 0) + investPerSqm;
  const vat         = selContract?.vat_type==="taxable" ? baseRent*0.18 : 0;
  const remaining   = selContract?.end_date ? yearsMonthsLeft(selContract.end_date) : null;

  const counts: Record<string,number> = {};
  contracts.forEach(function(c){counts[c.status]=(counts[c.status]??0)+1;});

  async function handleDeleteContract(contractId: string) {
    if (!confirm("למחוק חוזה? פעולה זו תמחק גם את כל החיובים, הערבויות, הביטוחים והמכתבים של החוזה!")) return;
    try {
      const { data: linkedSpaces } = await supabase.from("contract_spaces").select("space_id").eq("contract_id", contractId);
      const spaceIds = (linkedSpaces || []).map((r: any) => r.space_id);
      await supabase.from("contracts").update({ parent_contract_id: null }).eq("parent_contract_id", contractId);
      await supabase.from("alerts").delete().eq("contract_id", contractId);
      await supabase.from("charges").delete().eq("contract_id", contractId);
      await supabase.from("contract_spaces").delete().eq("contract_id", contractId);
      await supabase.from("contract_options").delete().eq("contract_id", contractId);
      await supabase.from("contract_price_tiers").delete().eq("contract_id", contractId);
      await supabase.from("contract_ti").delete().eq("contract_id", contractId);
      await supabase.from("documents").delete().eq("contract_id", contractId);
      await supabase.from("guarantees").delete().eq("contract_id", contractId);
      await supabase.from("insurances_tenant").delete().eq("contract_id", contractId);
      await supabase.from("letters").delete().eq("contract_id", contractId);
      await supabase.from("management_fees").delete().eq("contract_id", contractId);
      await supabase.from("revenue_reports").delete().eq("contract_id", contractId);
      const { error } = await supabase.from("contracts").delete().eq("id", contractId);
      if (error) throw error;
      if (spaceIds.length > 0) {
        await supabase.from("spaces").update({ status: "vacant" }).in("id", spaceIds);
      }
      await logAudit({ entity_type: "contract", entity_id: contractId, action: "delete" });
      setSelected(null);
      await loadContracts();
    } catch (e: any) { alert("שגיאה במחיקה: " + e?.message); }
  }

  return (
    <div dir="rtl">
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">חוזים</h1>
          <p className="text-sm text-slate-500 mt-1">{contracts.length} חוזים</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSync} disabled={syncing}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {syncing?"⏳ מסנכרן...":"🔄 סנכרן סטטוסים"}
          </button>
          <button onClick={function(){router.push("/contracts/new");}} className="rounded-lg bg-blue-700 px-5 py-2 font-bold text-white hover:bg-blue-800">
            + חוזה חדש
          </button>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[{v:"all",l:"הכל"},{v:"active",l:"פעיל"},{v:"expiring",l:"פוגה"},{v:"extended",l:"מורחב"},{v:"upcoming",l:"עתידי"},{v:"ended",l:"הסתיים"}].map(function(s) {
          const cnt = s.v==="all" ? contracts.length : (counts[s.v]??0);
          const si  = STATUS_MAP[s.v];
          return (
            <button key={s.v} onClick={function(){setFilterSt(s.v);}}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all " +
                (filterSt===s.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {si && <span className={"w-2 h-2 rounded-full "+si.dot}/>}
              {s.l}
              <span className="bg-slate-100 text-slate-500 rounded-full px-1.5 text-[10px] font-bold">{cnt}</span>
            </button>
          );
        })}
        <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}}
          placeholder="חיפוש שוכר / נכס..."
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs mr-auto"/>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* List */}
        <div className="lg:col-span-2 space-y-2 max-h-[70vh] overflow-y-auto pl-1">
          {loading ? <div className="text-center py-8 text-slate-400">טוען...</div> : filtered.length===0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-400">
              <div className="text-4xl mb-2">📄</div><div>אין חוזים</div>
            </div>
          ) : filtered.map(function(c) {
            const si   = STATUS_MAP[c.status] ?? STATUS_MAP.ended;
            const mon  = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
            const rem  = c.end_date ? yearsMonthsLeft(c.end_date) : null;
            const isSel = selected===c.id;
            return (
              <div key={c.id} onClick={function(){setSelected(isSel?null:c.id);}}
                className={"rounded-xl border p-3 cursor-pointer transition-all " +
                  (isSel?"border-blue-500 bg-blue-50 shadow-sm":"border-slate-200 bg-white hover:shadow-sm")}>
                <div className="flex items-start justify-between mb-1">
                  <div className="font-semibold text-slate-800 text-sm">{c.tenants?.name}</div>
                  <span className={"text-xs px-2 py-0.5 rounded-full font-semibold "+si.color}>{si.label}</span>
                </div>
                <div className="text-xs text-slate-400">{c.properties?.name}</div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs font-semibold text-green-700">{fmtMoney(mon)}/חודש</span>
                  {rem && !rem.isExpired && (
                    <span className={"text-xs font-semibold " + (rem.years < 1 ? "text-red-600" : rem.years < 2 ? "text-yellow-600" : "text-slate-500")}>
                      {rem.text}
                    </span>
                  )}
                  {rem?.isExpired && <span className="text-xs font-bold text-red-600">פג!</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Details */}
        <div className="lg:col-span-3">
          {!selContract ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
              <div className="text-5xl mb-3">📄</div><div>בחר חוזה לצפייה</div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Header */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800">{selContract.tenants?.name}</h2>
                    <div className="text-sm text-slate-500">{selContract.properties?.name}{selContract.properties?.city?" — "+selContract.properties.city:""}</div>
                    {selContract.tenants?.company_name&&<div className="text-xs text-slate-400">{selContract.tenants.company_name}</div>}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={function(){router.push("/contracts/"+selContract.id+"/edit");}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
                    <button onClick={function(){router.push("/contracts/"+selContract.id+"/print");}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">🖨 הדפס</button>
                    <button onClick={()=>selected && handleDeleteContract(selected)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 hover:bg-red-100 font-semibold">🗑 מחק</button>
                  </div>
                </div>

                {/* KPI — redesigned */}
                <div className="grid grid-cols-4 gap-2 mb-3">
                  <div className="rounded-xl p-2.5 text-center border border-slate-100 bg-slate-50">
                    <div className="text-base text-slate-700">{fmtMoney(baseRent)}</div>
                    <div className="text-xs text-slate-400">בסיס</div>
                  </div>
                  <div className="rounded-xl p-2.5 text-center border border-slate-100">
                    <div className="text-base text-slate-500">{fmtMoney(vat)}</div>
                    <div className="text-xs text-slate-400">מע&quot;מ</div>
                  </div>
                  <div className="rounded-xl p-2.5 text-center border border-blue-200 bg-blue-50">
                    <div className="text-base text-blue-700 font-black">{fmtMoney(baseRent+vat)}</div>
                    <div className="text-xs text-blue-500">סה&quot;כ</div>
                  </div>
                  <div className={"rounded-xl p-2.5 text-center border " + (remaining?.isExpired ? "border-red-200 bg-red-50" : remaining && remaining.years < 1 ? "border-orange-200 bg-orange-50" : "border-green-200 bg-green-50")}>
                    <div className={"text-sm font-bold " + (remaining?.isExpired ? "text-red-600" : remaining && remaining.years < 1 ? "text-orange-600" : "text-green-700")}>
                      {remaining?.text ?? "—"}
                    </div>
                    <div className="text-xs text-slate-400">עד {fmtDate(selContract.end_date)}</div>
                  </div>
                </div>

                {/* True rent per sqm (base + investment) */}
                {investPerSqm > 0 && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 mb-2 flex items-center justify-between text-xs">
                    <span className="text-slate-500">שכ&quot;ד אמיתי למ&quot;ר (בסיס {fmtMoney(selContract.rent_per_sqm)} + תוספת {fmtMoney(investPerSqm)})</span>
                    <span className="font-black text-slate-800">{fmtMoney(trueRentPerSqm)}/מ&quot;ר</span>
                  </div>
                )}

                {/* CPI-adjusted price via CBS calculator */}
                {cpiLoading && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-3 text-xs text-amber-600 animate-pulse">
                    📊 מחשב הצמדה למדד (API למ&quot;ס)...
                  </div>
                )}
                {cpiResult && !cpiLoading && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-3 mb-3 space-y-2">
                    <div className="text-xs font-bold text-amber-800 mb-1 flex items-center gap-2">
                      📊 הצמדה למדד (כלל t-2)
                      <span className={"rounded px-1.5 py-0.5 text-[9px] font-bold " + (cpiResult.source === "cbs" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700")}>
                        {cpiResult.source === "cbs" ? "✓ מחשבון למ\"ס" : "≈ חישוב מקומי"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {/* CPI-adjusted rent per sqm */}
                      <div className="rounded-lg bg-white border border-amber-200 p-2.5 text-center">
                        <div className="text-lg font-black text-amber-900">₪{cpiResult.adjustedRentPerSqm.toFixed(2)}/מ&quot;ר</div>
                        <div className="text-[10px] text-amber-600">שכ&quot;ד צמוד למדד היום</div>
                      </div>
                      {/* Total monthly CPI-adjusted */}
                      <div className="rounded-lg bg-white border border-amber-200 p-2.5 text-center">
                        <div className="text-lg font-black text-amber-900">₪{Math.round(cpiResult.adjustedRentPerSqm * (Number(selContract.charged_area) ?? 0)).toLocaleString()}</div>
                        <div className="text-[10px] text-amber-600">סה&quot;כ הכנסה צמודה לחודש</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-amber-600">
                      <div className="flex justify-between"><span>מדד בסיס ({cpiResult.fromDate}):</span><span className="font-semibold">{cpiResult.fromIndexValue}</span></div>
                      <div className="flex justify-between"><span>מדד נוכחי ({cpiResult.toDate}):</span><span className="font-semibold">{cpiResult.toIndexValue}</span></div>
                      <div className="flex justify-between"><span>שכ&quot;ד בסיס:</span><span className="font-semibold">₪{cpiResult.baseRentPerSqm.toFixed(2)}/מ&quot;ר</span></div>
                      <div className="flex justify-between"><span>שינוי מצטבר:</span><span className="font-semibold">{cpiResult.changePct != null ? cpiResult.changePct + "%" : "—"}</span></div>
                      <div className="flex justify-between"><span>שנת בסיס מדד:</span><span className="font-semibold">{cpiResult.baseYear}</span></div>
                      <div className="flex justify-between"><span>שטח מחויב:</span><span className="font-semibold">{selContract.charged_area} מ&quot;ר</span></div>
                    </div>

                    {cpiResult.verificationUrl && (
                      <a href={cpiResult.verificationUrl} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-blue-500 hover:underline block">🔗 אימות מול מחשבון הלמ&quot;ס</a>
                    )}
                  </div>
                )}

                {/* Details */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600">
                  {[
                    {l:"תחילה",   v:fmtDate(selContract.start_date)},
                    {l:"סיום",    v:fmtDate(selContract.end_date)},
                    {l:"שטח",    v:selContract.charged_area?selContract.charged_area+' מ"ר':"—"},
                    {l:"הצמדה",  v:selContract.indexation_method==="highest_in_period"?"מדד גבוה":selContract.indexation_method==="none"?"ללא":"t-2"},
                    {l:"מדד בסיס",v:selContract.index_base_value||"—"},
                    {l:'מע"מ',  v:selContract.vat_type==="taxable"?"18%":"פטור"},
                  ].map(function(r){return <div key={r.l} className="flex justify-between border-b border-slate-50 py-1"><span className="text-slate-400">{r.l}</span><span className="font-medium">{r.v}</span></div>;})}
                </div>
              </div>

              {/* Options — enhanced */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
                <div className="text-xs font-bold text-slate-500 mb-3">🔄 אופציות ({(selContract.contract_options??[]).length})</div>
                {(selContract.contract_options??[]).length===0 ? <div className="text-xs text-slate-400">אין אופציות</div> : (
                  <div className="space-y-2">
                    {(selContract.contract_options??[]).sort((a:any,b:any) => a.option_number - b.option_number).map(function(opt:any) {
                      const optYears = opt.duration_years || (opt.duration_months ? Math.round(opt.duration_months / 12) : 0);
                      const noticeDate = opt.end_date && opt.notice_days_before_end
                        ? new Date(new Date(opt.end_date).getTime() - opt.notice_days_before_end * 86400000)
                        : null;
                      const noticePassed = noticeDate ? new Date() > noticeDate : false;
                      const isExercised = opt.is_exercised || opt.status === "exercised";
                      const needsAttention = noticePassed && !isExercised && opt.status !== "expired";
                      return (
                        <div key={opt.id} className={"rounded-lg border p-3 " + (needsAttention ? "border-red-300 bg-red-50" : isExercised ? "border-green-200 bg-green-50" : "border-slate-100")}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-bold text-slate-700">אופציה {opt.option_number} — {optYears} שנים</span>
                            <div className="flex items-center gap-2">
                              <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                                (isExercised ? "bg-green-100 text-green-700" : opt.status==="expired" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600")}>
                                {isExercised ? "✓ מומשה" : opt.status==="expired" ? "פגה" : "ממתינה"}
                              </span>
                              {!isExercised && opt.status !== "expired" && (
                                <button onClick={async (e) => { e.stopPropagation(); if (confirm("לסמן אופציה כמומשת?")) await handleExerciseOption(opt.id, true); }}
                                  className="text-xs border border-green-300 bg-green-50 text-green-700 rounded px-2 py-0.5 hover:bg-green-100 font-semibold">
                                  סמן מימוש
                                </button>
                              )}
                              {isExercised && (
                                <button onClick={async (e) => { e.stopPropagation(); if (confirm("לבטל מימוש?")) await handleExerciseOption(opt.id, false); }}
                                  className="text-xs border border-slate-200 text-slate-500 rounded px-2 py-0.5 hover:bg-slate-50">
                                  בטל
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-slate-500 space-y-0.5">
                            {opt.rent_mechanism === "increase_pct" && opt.rent_increase_pct && (
                              <div>קפיצת מחיר: +{opt.rent_increase_pct}%</div>
                            )}
                            {opt.rent_mechanism === "new_value" && opt.new_rent_value && (
                              <div>מחיר חדש: {fmtMoney(opt.new_rent_value)}/מ&quot;ר</div>
                            )}
                            {noticeDate && (
                              <div className={"font-semibold " + (noticePassed && !isExercised ? "text-red-600" : "text-slate-600")}>
                                {noticePassed && !isExercised ? "⚠️ " : "📅 "}
                                מועד אחרון להודעה: {fmtDate(noticeDate.toISOString())}
                                {noticePassed && !isExercised && " — עבר!"}
                              </div>
                            )}
                          </div>
                          {needsAttention && (
                            <div className="mt-1.5 rounded bg-red-100 border border-red-200 px-2 py-1.5 text-xs text-red-700 font-semibold">
                              ⚠️ מועד ההודעה עבר ולא סומן מימוש — האם לסמן כמומשה או כפגה?
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Guarantees */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
                <div className="text-xs font-bold text-slate-500 mb-3">🏦 ערבויות ({(selContract.guarantees??[]).length})</div>
                {(selContract.guarantees??[]).length===0 ? <div className="text-xs text-slate-400">אין ערבויות</div> : (
                  <div className="space-y-2">
                    {selContract.guarantees.map(function(g:any){
                      const diff = (g.amount_actual??0) - (g.amount_required??0);
                      const isExpired = g.end_date && new Date(g.end_date) < new Date();
                      const daysToExpiry = g.end_date ? Math.ceil((new Date(g.end_date).getTime() - Date.now()) / 86400000) : null;
                      const GTYPE: Record<string,string> = { bank:"🏦 בנקאית", check:"📝 שיקים", cash:"💵 מזומן", insurance:"🛡️ ביטוח", personal:"👤 אישית" };
                      return (
                        <div key={g.id} className={"rounded-lg border p-2.5 " + (isExpired ? "border-red-300 bg-red-50" : g.status !== "active" ? "border-slate-200 bg-slate-50" : "border-green-200 bg-green-50/30")}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-slate-700">{GTYPE[g.guarantee_type] ?? g.guarantee_type}</span>
                            <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                              (isExpired ? "bg-red-100 text-red-700" : g.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                              {isExpired ? "⚠️ לא בתוקף" : g.status === "active" ? "✓ בתוקף" : "לא פעיל"}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-1 text-xs text-slate-600">
                            <div className="flex justify-between">
                              <span className="text-slate-400">נדרש:</span>
                              <span className="font-semibold">{fmtMoney(g.amount_required??0)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">בפועל:</span>
                              <span className={"font-semibold " + (diff < 0 ? "text-red-600" : "text-green-600")}>{fmtMoney(g.amount_actual??0)}</span>
                            </div>
                            {g.bank && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">בנק:</span>
                                <span>{g.bank}</span>
                              </div>
                            )}
                            {g.end_date && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">פקיעה:</span>
                                <span className={"font-semibold " + (isExpired ? "text-red-600" : daysToExpiry !== null && daysToExpiry <= 60 ? "text-yellow-600" : "")}>
                                  {fmtDate(g.end_date)}
                                  {isExpired && " (פג!)"}
                                  {!isExpired && daysToExpiry !== null && daysToExpiry <= 60 && ` (${daysToExpiry} יום)`}
                                </span>
                              </div>
                            )}
                          </div>
                          {diff < 0 && (
                            <div className="text-xs text-red-600 font-bold mt-1">⚠️ פער: {fmtMoney(Math.abs(diff))}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
