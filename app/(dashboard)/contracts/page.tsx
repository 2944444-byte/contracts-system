"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { syncContractStatuses } from '@/lib/contractSync';
import { logAudit } from '@/lib/audit-log';
import { fetchCpiAdjusted } from '@/lib/cpi-server';
import { calcChainingCoefficient } from '@/lib/cpi-utils';
import { buildPriceTimeline, calculateTierPreviews, type PriceTier } from '@/lib/contract-utils';
// CPI + price timeline

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function fmtMoney(n: number) { return "₪"+(n??0).toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}); }

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

// "מדד ידוע" — the CPI index KNOWN at a given date.
// CPI for month X is published around the 15th of month X+1.
// On 15th+ of month Y → known index = month Y-1
// Before 15th of month Y → known index = month Y-2
function getKnownIndexMonth(date: Date): { year: number; month: number } {
  const d = new Date(date);
  const monthsBack = d.getDate() >= 15 ? 1 : 2;
  d.setMonth(d.getMonth() - monthsBack);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// Format date as MM-DD-YYYY for CBS calculator.
// CBS publishes CPI on the 15th but considers it "known" from the 16th.
// Users always enter 15 as the day for index dates, so we bump to 16 automatically.
function formatDateForCbs(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  if (d.getDate() === 15) d.setDate(16);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
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
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [priceTimeline, setPriceTimeline] = useState<any[]>([]);
  const [amendments, setAmendments] = useState<any[]>([]);

  // Amendment modal state
  const [showAmendModal, setShowAmendModal] = useState(false);
  const [amendType, setAmendType] = useState<string|null>(null);
  const [amendDate, setAmendDate] = useState(new Date().toISOString().split("T")[0]);
  const [amendNotes, setAmendNotes] = useState("");
  const [amendSaving, setAmendSaving] = useState(false);
  // For unit swap/add
  const [amendRemoveSpaces, setAmendRemoveSpaces] = useState<string[]>([]);
  const [amendAddSpaces, setAmendAddSpaces] = useState<string[]>([]);
  const [amendAddRents, setAmendAddRents] = useState<Record<string, string>>({});
  const [allPropertySpaces, setAllPropertySpaces] = useState<any[]>([]);
  // For extend period
  const [amendNewEndDate, setAmendNewEndDate] = useState("");
  // For price change
  const [amendPriceChanges, setAmendPriceChanges] = useState<Record<string, string>>({});

  useEffect(function() { loadContracts(); }, []);

  async function loadContracts() {
    const { data } = await supabase.from("contracts")
      .select("*, tenants(name,phone,primary_email,company_name), properties(name,city), contract_options(id,option_number,duration_months,duration_years,end_date,notice_days_before_end,notice_type,status,is_exercised,rent_mechanism,rent_increase_pct,new_rent_value,option_group,exit_points), guarantees(id,guarantee_type,status,amount_required,amount_actual,end_date,bank,document_url), contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area))")
      .order("end_date");
    setContracts(data??[]);
    setLoading(false);
    if (!selected && (data??[]).filter(function(c){return c.status==="active";}).length>0) {
      setSelected((data??[]).filter(function(c){return c.status==="active";})[0].id);
    }
  }

  const selContract = contracts.find(function(c){return c.id===selected;});

  // Load amendments for selected contract
  useEffect(function() {
    if (!selContract) { setAmendments([]); return; }
    supabase.from("contracts")
      .select("id,amendment_number,amendment_date,amendment_notes,start_date,end_date,rent_per_sqm,charged_area,contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area))")
      .eq("parent_contract_id", selContract.id)
      .eq("is_amendment", true)
      .order("amendment_number")
      .then(function({ data }) { setAmendments(data ?? []); });
  }, [selected]);

  // Load price tiers and build timeline when contract selected
  useEffect(function() {
    if (!selContract) { setPriceTiers([]); setPriceTimeline([]); return; }
    supabase.from("contract_price_tiers").select("*")
      .eq("contract_id", selContract.id).order("tier_number")
      .then(function({ data: tiers }) {
        var loadedTiers: PriceTier[] = (tiers ?? []).map(function(t: any) {
          return {
            increase_type: t.increase_type ?? "pct",
            increase_value: Number(t.increase_value) || 0,
            from_year: t.from_year ?? 1,
            to_year: t.to_year ?? 3,
            is_recurring: t.is_recurring ?? false,
            recurring_every_years: t.recurring_every_years ?? (t.is_recurring ? 1 : null),
            calculated_rent_per_sqm: null,
            notes: t.notes ?? "",
          };
        });
        setPriceTiers(loadedTiers);
        if (selContract.start_date && selContract.end_date) {
          var tl = buildPriceTimeline({
            contractStart: selContract.start_date,
            contractEnd: selContract.end_date,
            baseRentPerSqm: Number(selContract.rent_per_sqm) || 0,
            mainTiers: loadedTiers,
            options: (selContract.contract_options ?? []).map(function(o: any) {
              return { ...o, price_schedule_type: o.price_schedule_type || "inherit", price_tiers: o.price_tiers || [] };
            }),
          });
          setPriceTimeline(tl);
        }
      });
  }, [selected]);

  // Load CPI-adjusted price via CBS calculator (server action — no CORS/auth issues).
  // Uses CURRENT rent per sqm (after step-rent) as the base for CPI.
  // Depends on priceTimeline to determine current-year rent.
  useEffect(function() {
    if (!selContract) { setCpiResult(null); return; }
    if (selContract.indexation_method === "none") { setCpiResult(null); return; }
    const origRent = Number(selContract.rent_per_sqm);
    if (!origRent) { setCpiResult(null); return; }

    // Determine current rent from step-rent timeline
    var currentRent = origRent;
    if (priceTimeline.length > 0) {
      var now = new Date();
      for (var i = 0; i < priceTimeline.length; i++) {
        if (new Date(priceTimeline[i].startDate) <= now && new Date(priceTimeline[i].endDate) > now) {
          currentRent = priceTimeline[i].rentPerSqm ?? origRent;
          break;
        }
      }
    }

    const refDateStr = selContract.index_base_date || selContract.start_date;
    const baseDate = formatDateForCbs(refDateStr);
    if (!baseDate) { setCpiResult(null); return; }

    // True rent = current step-rent + investment per sqm
    const cpiInvestPerSqm = selContract.charged_area > 0 && selContract.investment_addition
      ? Number(selContract.investment_addition) / Number(selContract.charged_area)
      : 0;
    const totalRentPerSqm = currentRent + cpiInvestPerSqm;

    // Today's full date for CBS calculator (day matters for known-index)
    const todayForCbs = formatDateForCbs(new Date().toISOString());
    if (!todayForCbs) { setCpiResult(null); return; }

    setCpiLoading(true);

    // Known index months for fallback
    const knownFrom = getKnownIndexMonth(new Date(refDateStr));
    const knownTo = getKnownIndexMonth(new Date());

    // Primary: CBS calculator via Server Action (server-side, bypasses Vercel auth)
    // Fallback: cumulative % chain from Supabase cpi_records
    fetchCpiAdjusted({ value: totalRentPerSqm, fromDate: baseDate, toDate: todayForCbs })
      .then(function(data) {
        if (!data.success) throw new Error(data.error || "CBS failed");
        setCpiResult({
          success: true, source: "cbs",
          baseRentPerSqm: data.baseRentPerSqm,
          adjustedRentPerSqm: data.adjustedRentPerSqm,
          changePct: data.changePct,
          fromDate: data.fromDate,
          toDate: data.toDate,
          fromIndexValue: data.fromIndexValue,
          toIndexValue: data.toIndexValue,
          baseYear: data.baseYear,
          verificationUrl: data.verificationUrl,
        });
        setCpiLoading(false);
      })
      .catch(function() {
        // Fallback: index ratio with chaining coefficient (same formula as CBS calculator)
        // Formula: adjusted = baseRent × (currentIndex × chainingCoeff) / baseIndex
        Promise.all([
          supabase.from("cpi_records").select("year,month,value,base_year")
            .eq("year", knownFrom.year).eq("month", knownFrom.month).single(),
          supabase.from("cpi_records").select("year,month,value,base_year")
            .eq("year", knownTo.year).eq("month", knownTo.month).single(),
          supabase.from("cpi_link_coefficients").select("from_base_year,to_base_year,coefficient")
        ]).then(function(results) {
          var baseRec = results[0].data;
          var currentRec = results[1].data;
          var coefficients = results[2].data;
          if (!baseRec || !currentRec || !coefficients) { setCpiResult(null); setCpiLoading(false); return; }
          var baseIdx = Number(baseRec.value);
          var currentIdx = Number(currentRec.value);
          // Calculate chaining coefficient between base years
          var fromBaseYear = parseInt(String(currentRec.base_year));
          var toBaseYear = parseInt(String(baseRec.base_year));
          var chainingCoeff = calcChainingCoefficient(fromBaseYear, toBaseYear, coefficients);
          // CBS formula: adjusted = baseRent × (currentIndex × chainingCoeff) / baseIndex
          var adjustedRent = totalRentPerSqm * (currentIdx * chainingCoeff) / baseIdx;
          var changePct = ((currentIdx * chainingCoeff) / baseIdx - 1) * 100;
          setCpiResult({
            success: true, source: "local",
            baseRentPerSqm: Math.round(totalRentPerSqm * 100) / 100,
            adjustedRentPerSqm: Math.round(adjustedRent * 100) / 100,
            changePct: Math.round(changePct * 100) / 100,
            fromDate: `${knownFrom.month}/${knownFrom.year}`,
            toDate: `${knownTo.month}/${knownTo.year}`,
            fromIndexValue: baseIdx,
            toIndexValue: currentIdx,
            baseYear: baseRec.base_year || null,
            verificationUrl: null,
          });
          setCpiLoading(false);
        }).catch(function() { setCpiResult(null); setCpiLoading(false); });
      });
  }, [selected, priceTimeline.length]);

  async function handleSync() {
    setSyncing(true);
    const n = await syncContractStatuses();
    await loadContracts();
    setSyncing(false);
    if (n>0) alert(`✅ עודכנו ${n} חוזים`);
  }

  async function handleExerciseOption(optionId: string, exercised: boolean) {
    // Update option status
    await supabase.from("contract_options").update({
      is_exercised: exercised,
      status: exercised ? "exercised" : "pending",
    }).eq("id", optionId);

    // Update contract end_date and status based on exercised options
    if (selContract) {
      const { data: opts } = await supabase.from("contract_options")
        .select("id,end_date,is_exercised,option_number")
        .eq("contract_id", selContract.id)
        .order("option_number");

      // Find the latest exercised option's end_date
      var lastExercised = (opts ?? []).filter(function(o: any) { return o.is_exercised; })
        .sort(function(a: any, b: any) { return b.option_number - a.option_number; })[0];

      if (lastExercised?.end_date) {
        // Extend contract to end of exercised option
        var newEnd = lastExercised.end_date;
        var today = new Date();
        var endDate = new Date(newEnd);
        var newStatus = today > endDate ? "ended" : today >= new Date(selContract.start_date) ? "active" : "upcoming";

        await supabase.from("contracts").update({
          end_date: newEnd,
          status: newStatus,
        }).eq("id", selContract.id);
      } else if (!exercised) {
        // All options cancelled — revert to original end date
        // Recalculate from start_date + lease_period
        // For now just sync statuses
      }
    }

    await loadContracts();
  }

  const filtered = contracts.filter(function(c) {
    if (c.is_amendment) return false; // Hide amendments from sidebar
    const ms = filterSt==="all" || c.status===filterSt;
    const mq = !search || c.tenants?.name?.includes(search) || c.properties?.name?.includes(search);
    return ms && mq;
  });

  // selContract already defined above
  const investPerSqm = selContract && selContract.charged_area > 0 && selContract.investment_addition
    ? Math.round(selContract.investment_addition / selContract.charged_area * 100) / 100 : 0;
  const originalRentPerSqm = (selContract?.rent_per_sqm ?? 0);

  // Current rent per sqm based on contract year (step-rent mechanism)
  var currentRentPerSqm = originalRentPerSqm;
  var currentContractYear = 0;
  if (selContract?.start_date && priceTimeline.length > 0) {
    var now = new Date();
    for (var i = 0; i < priceTimeline.length; i++) {
      var entry = priceTimeline[i];
      if (new Date(entry.startDate) <= now && new Date(entry.endDate) > now) {
        currentRentPerSqm = entry.rentPerSqm ?? originalRentPerSqm;
        currentContractYear = i + 1;
        break;
      }
    }
  }
  const trueRentPerSqm = currentRentPerSqm + investPerSqm;
  // Calculate baseRent: prefer per-unit breakdown when available
  var baseRent = 0;
  if (selContract) {
    var hasPerUnitPricing = selContract.contract_spaces?.some(function(cs: any) { return cs.charge_method === "fixed" || cs.price_per_sqm; });
    if (hasPerUnitPricing && (selContract.rent_per_sqm ?? 0) === 0) {
      // Per-unit fixed pricing: sum each space
      selContract.contract_spaces.forEach(function(cs: any) {
        if (cs.charge_method === "fixed" && cs.fixed_rent) baseRent += Number(cs.fixed_rent);
        else baseRent += (Number(cs.price_per_sqm) || 0) * (cs.spaces?.area || 0);
      });
    } else {
      baseRent = trueRentPerSqm * (selContract.charged_area ?? 0);
    }
  }
  const vat         = selContract?.vat_type==="taxable" ? baseRent*0.18 : 0;
  const remaining   = selContract?.end_date ? yearsMonthsLeft(selContract.end_date) : null;

  const counts: Record<string,number> = {};
  contracts.filter(function(c) { return !c.is_amendment; }).forEach(function(c){counts[c.status]=(counts[c.status]??0)+1;});

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
            var mon = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
            // If rent_per_sqm is 0 but has per-unit pricing, calculate from contract_spaces
            if (mon === (c.investment_addition??0) && c.contract_spaces?.length > 0) {
              var spTotal = 0;
              c.contract_spaces.forEach(function(cs: any) {
                if (cs.charge_method === "fixed" && cs.fixed_rent) spTotal += Number(cs.fixed_rent);
                else spTotal += (Number(cs.price_per_sqm) || Number(c.rent_per_sqm) || 0) * (cs.spaces?.area || 0);
              });
              if (spTotal > 0) mon = spTotal + (c.investment_addition??0);
            }
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
                <div className="text-xs text-slate-400">
                  {c.properties?.name}
                  {c.contract_spaces?.length > 0 && (
                    <span className="text-slate-300"> — {c.contract_spaces.map(function(cs: any) { return cs.spaces?.space_name; }).filter(Boolean).join(", ")}</span>
                  )}
                </div>
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
                    <h2 className="text-xl font-bold text-slate-800 cursor-pointer hover:underline hover:text-blue-700" onClick={function(){router.push("/tenants");}}>{selContract.tenants?.name} <span className="text-sm font-normal text-blue-500">→</span></h2>
                    <div className="text-sm text-slate-500 cursor-pointer hover:underline hover:text-blue-600" onClick={function(){router.push("/properties");}}>{selContract.properties?.name}{selContract.properties?.city?" — "+selContract.properties.city:""} <span className="text-blue-400">→</span></div>
                    {selContract.tenants?.company_name&&<div className="text-xs text-slate-400">{selContract.tenants.company_name}</div>}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={function(){router.push("/contracts/"+selContract.id+"/edit");}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
                    <button onClick={function(){router.push("/contracts/"+selContract.id+"/print");}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">🖨 הדפס</button>
                    {selContract.document_url && (
                      <a href={selContract.document_url} target="_blank" rel="noopener noreferrer"
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-100">📄 צפה בחוזה</a>
                    )}
                    {!selContract.is_amendment && (
                      <button onClick={function(){
                        setShowAmendModal(true);
                        setAmendType(null);
                        setAmendDate(new Date().toISOString().split("T")[0]);
                        setAmendNotes("");
                        setAmendRemoveSpaces([]);
                        setAmendAddSpaces([]);
                        setAmendAddRents({});
                        setAmendNewEndDate(selContract.end_date || "");
                        // Init price changes from current contract spaces
                        var pc: Record<string,string> = {};
                        (selContract.contract_spaces||[]).forEach(function(cs: any) {
                          pc[cs.space_id] = String(cs.charge_method === "fixed" ? (cs.fixed_rent||0) : (cs.price_per_sqm || selContract.rent_per_sqm || 0));
                        });
                        setAmendPriceChanges(pc);
                        // Load all property spaces
                        supabase.from("spaces").select("id,space_name,area,status")
                          .eq("property_id", selContract.property_id).order("space_name")
                          .then(function({data}) { setAllPropertySpaces(data??[]); });
                      }}
                        className="rounded-lg border border-yellow-400 bg-yellow-50 px-3 py-1.5 text-xs font-semibold text-yellow-700 hover:bg-yellow-100">📝 תוספת להסכם</button>
                    )}
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

                {/* Current rent per sqm (with step-rent + investment) */}
                {trueRentPerSqm > 0 ? (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 mb-2 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">
                        שכ&quot;ד נוכחי למ&quot;ר
                        {currentContractYear > 0 && <span className="text-blue-500"> (שנה {currentContractYear})</span>}
                        {investPerSqm > 0 && <span> + תוספת {fmtMoney(investPerSqm)}</span>}
                      </span>
                      <span className="font-black text-slate-800">{fmtMoney(trueRentPerSqm)}/מ&quot;ר</span>
                    </div>
                    {currentRentPerSqm !== originalRentPerSqm && (
                      <div className="flex items-center justify-between text-slate-400">
                        <span>שכ&quot;ד מקורי (שנה 1)</span>
                        <span>₪{originalRentPerSqm.toFixed(2)}/מ&quot;ר</span>
                      </div>
                    )}
                  </div>
                ) : selContract.contract_spaces?.length > 0 ? (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 mb-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">שכ&quot;ד חודשי (מחיר לפי יחידה)</span>
                      <span className="font-black text-slate-800">{fmtMoney(baseRent)}/חודש</span>
                    </div>
                  </div>
                ) : null}

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
                        <div className="text-[10px] text-amber-600">סה&quot;כ שכ&quot;ד צמוד לחודש (לפני מע&quot;מ)</div>
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

                {/* Price Timeline Table */}
                {priceTimeline.length > 1 && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 mb-3">
                    <div className="text-xs font-bold text-blue-800 mb-2">📊 ציר זמן מחירים</div>
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="text-blue-600 border-b border-blue-200">
                          <th className="py-1 text-right font-semibold">תקופה</th>
                          <th className="py-1 text-right font-semibold">שכ&quot;ד בסיס</th>
                          {cpiResult && <th className="py-1 text-right font-semibold">צמוד למדד</th>}
                          <th className="py-1 text-center font-semibold w-6"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {priceTimeline.map(function(entry: any, idx: number) {
                          var now = new Date();
                          var isCurrent = new Date(entry.startDate) <= now && new Date(entry.endDate) > now;
                          var startD = new Date(entry.startDate);
                          var isNotCalendar = startD.getMonth() !== 0 || startD.getDate() !== 1;
                          var changeMonth = isNotCalendar ? startD.toLocaleDateString("he-IL", { month: "short" }) : "";
                          var rentSqm = entry.rentPerSqm ?? 0;
                          var rentWithInvest = rentSqm + investPerSqm;
                          // CPI adjustment ratio applied to each year
                          var cpiRatio = cpiResult ? (cpiResult.adjustedRentPerSqm / cpiResult.baseRentPerSqm) : 1;
                          var cpiRent = rentWithInvest * cpiRatio;
                          return (
                            <tr key={idx} className={"border-b border-blue-100 " + (isCurrent ? "bg-blue-100 font-bold" : "")}>
                              <td className="py-1 text-right">
                                <span>{entry.label}</span>
                                {changeMonth && <span className="text-blue-400 mr-1">({changeMonth})</span>}
                              </td>
                              <td className="py-1 text-right">₪{rentWithInvest.toFixed(2)}/מ&quot;ר</td>
                              {cpiResult && <td className="py-1 text-right text-amber-700">₪{cpiRent.toFixed(2)}/מ&quot;ר</td>}
                              <td className="py-1 text-center">{isCurrent ? "◀" : ""}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Details */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-slate-700">
                  {[
                    {l:"תחילה",   v:fmtDate(selContract.start_date)},
                    {l:"סיום",    v:fmtDate(selContract.end_date)},
                    {l:"שטח",    v:selContract.charged_area?selContract.charged_area+' מ"ר':"—"},
                    {l:"הצמדה",  v:selContract.indexation_method==="highest_in_period"?"מדד גבוה":selContract.indexation_method==="none"?"ללא":"t-2"},
                    {l:"מדד בסיס",v:selContract.index_base_value||"—"},
                    {l:'מע"מ',  v:selContract.vat_type==="taxable"?"18%":"פטור"},
                    {l:"שיטת תשלום", v: selContract.payment_method==="checks_advance"?"שיקים מראש":selContract.payment_method==="bank_transfer"?"העברה בנקאית":selContract.payment_method==="cash"?"מזומן":selContract.payment_method==="credit_card"?"כרטיס אשראי":"הוראת קבע"},
                  ].map(function(r){return <div key={r.l} className="flex justify-between border-b border-slate-50 py-1"><span className="text-slate-400">{r.l}</span><span className="font-medium">{r.v}</span></div>;})}
                </div>

                {/* Per-unit breakdown when multiple spaces */}
                {selContract.contract_spaces?.length > 1 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mt-3">
                    <div className="text-xs font-bold text-slate-600 mb-2">📐 פירוט לפי יחידה</div>
                    <div className="space-y-1">
                      {selContract.contract_spaces.map(function(cs: any) {
                        var spName = cs.spaces?.space_name || "—";
                        var spArea = cs.spaces?.area || 0;
                        var isFixed = cs.charge_method === "fixed";
                        var monthlyRent = isFixed
                          ? Number(cs.fixed_rent) || 0
                          : (Number(cs.price_per_sqm) || Number(selContract.rent_per_sqm) || 0) * spArea;
                        var rentLabel = isFixed
                          ? fmtMoney(Number(cs.fixed_rent) || 0) + "/חודש (קבוע)"
                          : fmtMoney(Number(cs.price_per_sqm) || Number(selContract.rent_per_sqm) || 0) + '/מ"ר';
                        return (
                          <div key={cs.space_id} className="rounded-lg border border-slate-100 bg-white px-3 py-2 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-700">{spName}</span>
                              <span className="text-slate-400">{spArea} מ&quot;ר</span>
                              <span className="text-slate-400">{rentLabel}</span>
                            </div>
                            <span className="font-bold text-green-700">{fmtMoney(monthlyRent)}/חודש</span>
                          </div>
                        );
                      })}
                      <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-center">
                        <span className="text-sm font-black text-green-800">{fmtMoney(baseRent)}/חודש</span>
                        <span className="text-xs text-green-600 mr-2">סה&quot;כ כל היחידות</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Amendments History — clear before/after */}
              {amendments.length > 0 && (
                <div className="rounded-xl border-2 border-yellow-300 bg-yellow-50/50 shadow-sm p-5">
                  <div className="text-base font-bold text-yellow-800 mb-4 flex items-center gap-2">📝 תוספות להסכם ({amendments.length})</div>
                  <div className="space-y-4">
                    {amendments.map(function(am: any, amIdx: number) {
                      // Calculate amendment rent
                      var amSpaces = am.contract_spaces || [];
                      var amRent = 0;
                      amSpaces.forEach(function(cs: any) {
                        if (cs.charge_method === "fixed" && cs.fixed_rent) amRent += Number(cs.fixed_rent);
                        else amRent += (Number(cs.price_per_sqm) || Number(am.rent_per_sqm) || 0) * (cs.spaces?.area || 0);
                      });
                      if (amRent === 0) amRent = (Number(am.rent_per_sqm) || 0) * (Number(am.charged_area) || 0);

                      // Compare with original contract spaces
                      var origSpaceIds = (selContract.contract_spaces||[]).map(function(cs: any){return cs.space_id;});
                      var amSpaceIds = amSpaces.map(function(cs: any){return cs.space_id;});
                      var addedSpaces = amSpaces.filter(function(cs: any){ return !origSpaceIds.includes(cs.space_id); });
                      var removedSpaces = (selContract.contract_spaces||[]).filter(function(cs: any){ return !amSpaceIds.includes(cs.space_id); });

                      return (
                        <div key={am.id} className="rounded-xl border border-yellow-300 bg-white p-4">
                          {/* Header */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-yellow-400 text-white flex items-center justify-center text-sm font-bold">{am.amendment_number || amIdx+1}</div>
                              <div>
                                <div className="text-base font-bold text-slate-800">תוספת {am.amendment_number || amIdx+1}</div>
                                <div className="text-sm text-slate-500">{am.amendment_notes || "—"}</div>
                              </div>
                            </div>
                            <div className="text-left">
                              <div className="text-base font-bold text-yellow-700">{am.amendment_date ? fmtDate(am.amendment_date) : fmtDate(am.start_date)}</div>
                              <div className="text-xs text-slate-400">תאריך תוקף</div>
                            </div>
                          </div>

                          {/* New rent — big and clear */}
                          <div className="rounded-xl bg-green-50 border border-green-200 p-3 mb-3 text-center">
                            <div className="text-2xl font-black text-green-800">{fmtMoney(amRent)}/חודש</div>
                            <div className="text-sm text-green-600">שכ&quot;ד חודשי אחרי התוספת</div>
                            {amRent !== baseRent && baseRent > 0 && (
                              <div className="text-sm text-slate-500 mt-1">
                                לפני: {fmtMoney(baseRent)} | הפרש: <span className={amRent > baseRent ? "text-red-600 font-bold" : "text-green-600 font-bold"}>{amRent > baseRent ? "+" : ""}{fmtMoney(amRent - baseRent)}</span>
                              </div>
                            )}
                          </div>

                          {/* Changes summary */}
                          <div className="space-y-2">
                            {/* Added spaces */}
                            {addedSpaces.length > 0 && (
                              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2">
                                <div className="text-sm font-bold text-green-700 mb-1">➕ יחידות שנוספו</div>
                                {addedSpaces.map(function(cs: any) {
                                  var rent = cs.charge_method === "fixed" ? Number(cs.fixed_rent) : (Number(cs.price_per_sqm)||0) * (cs.spaces?.area||0);
                                  return (
                                    <div key={cs.space_id} className="flex justify-between text-sm">
                                      <span className="text-slate-700">{cs.spaces?.space_name} ({cs.spaces?.area} מ&quot;ר)</span>
                                      <span className="font-bold text-green-700">{fmtMoney(rent)}/חודש</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Removed spaces */}
                            {removedSpaces.length > 0 && (
                              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                                <div className="text-sm font-bold text-red-700 mb-1">➖ יחידות שהוסרו</div>
                                {removedSpaces.map(function(cs: any) {
                                  return (
                                    <div key={cs.space_id} className="text-sm text-red-600 line-through">
                                      {cs.spaces?.space_name} ({cs.spaces?.area} מ&quot;ר)
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* End date change */}
                            {am.end_date && am.end_date !== selContract.end_date && (
                              <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 flex justify-between text-sm">
                                <span className="text-blue-700 font-bold">📅 הארכת תקופה</span>
                                <span className="text-blue-800">עד {fmtDate(am.end_date)}</span>
                              </div>
                            )}

                            {/* Current spaces list */}
                            <div className="text-xs text-slate-500 mt-1">
                              יחידות בתוספת: {amSpaces.map(function(cs: any){return cs.spaces?.space_name;}).filter(Boolean).join(", ")}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
                        <div key={opt.id} className={"rounded-lg border p-3 " + (needsAttention ? "border-red-300 bg-red-50" : isExercised ? "border-green-200 bg-green-50" : opt.option_group ? "border-purple-200 bg-purple-50/30" : "border-slate-100")}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-slate-700">אופציה {opt.option_number} — {optYears} שנים</span>
                              {opt.option_group && <span className="rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-[9px] font-bold">חלופה {opt.option_group}</span>}
                            </div>
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
                          {g.document_url && (
                            <a href={g.document_url} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-blue-500 hover:underline mt-1 block">📄 צפה במסמך ערבות</a>
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
      {/* ═══ Amendment Modal ═══ */}
      {showAmendModal && selContract && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={function(){setShowAmendModal(false);}}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}}>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-800">📝 תוספת להסכם</h2>
                <button onClick={function(){setShowAmendModal(false);}} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
              </div>
              <div className="text-xs text-slate-500 mb-4">
                {selContract.tenants?.name} | {selContract.properties?.name} | {fmtDate(selContract.start_date)} — {fmtDate(selContract.end_date)}
              </div>

              {/* Step 1: Choose amendment type */}
              {!amendType && (
                <div className="space-y-2">
                  <div className="text-sm font-bold text-slate-700 mb-3">מה מטרת התוספת?</div>
                  {[
                    { v: "swap_units", l: "החלפת יחידות", desc: "הורדת יחידה/ות והוספת אחרות במקום", icon: "🔄" },
                    { v: "add_units", l: "הוספת יחידות", desc: "הוספת יחידות חדשות להסכם הקיים", icon: "➕" },
                    { v: "remove_units", l: "הורדת יחידות", desc: "הסרת יחידות מההסכם", icon: "➖" },
                    { v: "extend", l: "הארכת תקופה", desc: "שינוי תאריך סיום להסכם", icon: "📅" },
                    { v: "price_change", l: "שינוי מחירים", desc: "עדכון מחירים ליחידות קיימות", icon: "💰" },
                    { v: "other", l: "שינוי אחר", desc: "פתיחת כל האפשרויות (אשף מלא)", icon: "📋" },
                  ].map(function(opt) {
                    return (
                      <button key={opt.v} onClick={function(){ if (opt.v==="other") { router.push("/contracts/new?amendment_of="+selContract.id); setShowAmendModal(false); return; } setAmendType(opt.v); }}
                        className="w-full rounded-xl border border-slate-200 p-3 flex items-center gap-3 hover:bg-slate-50 hover:border-blue-300 transition-all text-right">
                        <span className="text-2xl">{opt.icon}</span>
                        <div className="flex-1">
                          <div className="text-sm font-bold text-slate-700">{opt.l}</div>
                          <div className="text-xs text-slate-400">{opt.desc}</div>
                        </div>
                        <span className="text-slate-300">←</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Step 2: Amendment details based on type */}
              {amendType && (
                <div className="space-y-4">
                  <button onClick={function(){setAmendType(null);}} className="text-xs text-blue-600 hover:underline">← חזור לבחירת סוג</button>

                  {/* Amendment date — shared by all types */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">תאריך תוקף התוספת *</label>
                    <input type="date" value={amendDate} onChange={function(e){setAmendDate(e.target.value);}}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </div>

                  {/* ── SWAP UNITS ── */}
                  {(amendType === "swap_units" || amendType === "remove_units") && (
                    <div>
                      <label className="block text-xs font-bold text-red-600 mb-2">יחידות להסרה</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(selContract.contract_spaces||[]).map(function(cs: any) {
                          var sp = cs.spaces;
                          var isRem = amendRemoveSpaces.includes(cs.space_id);
                          return (
                            <button key={cs.space_id} type="button"
                              onClick={function(){ setAmendRemoveSpaces(function(p){ return isRem ? p.filter(function(x){return x!==cs.space_id;}) : [...p, cs.space_id]; }); }}
                              className={"rounded-lg border p-2 text-center text-xs transition-all " +
                                (isRem ? "border-red-500 bg-red-50 text-red-700 font-bold" : "border-slate-200 hover:bg-slate-50")}>
                              <div className="font-semibold">{sp?.space_name}</div>
                              <div className="text-slate-400">{sp?.area} מ&quot;ר</div>
                              {isRem && <div className="text-red-500 text-[10px] mt-0.5">✕ מסומנת להסרה</div>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {(amendType === "swap_units" || amendType === "add_units") && (
                    <div>
                      <label className="block text-xs font-bold text-green-600 mb-2">יחידות להוספה</label>
                      <div className="grid grid-cols-2 gap-2">
                        {allPropertySpaces.filter(function(s) {
                          // Show spaces NOT in current contract (or removed)
                          var inContract = (selContract.contract_spaces||[]).some(function(cs: any){return cs.space_id===s.id;});
                          var wasRemoved = amendRemoveSpaces.includes(s.id);
                          return !inContract || wasRemoved;
                        }).map(function(s) {
                          var isAdd = amendAddSpaces.includes(s.id);
                          return (
                            <button key={s.id} type="button"
                              onClick={function(){ setAmendAddSpaces(function(p){ return isAdd ? p.filter(function(x){return x!==s.id;}) : [...p, s.id]; }); }}
                              className={"rounded-lg border p-2 text-center text-xs transition-all " +
                                (isAdd ? "border-green-500 bg-green-50 text-green-700 font-bold" : "border-slate-200 hover:bg-slate-50")}>
                              <div className="font-semibold">{s.space_name}</div>
                              <div className="text-slate-400">{s.area} מ&quot;ר</div>
                              {isAdd && <div className="text-green-500 text-[10px] mt-0.5">✓ נוספת</div>}
                            </button>
                          );
                        })}
                      </div>
                      {/* Rents for added spaces */}
                      {amendAddSpaces.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <div className="text-xs font-bold text-slate-600">מחיר ליחידות שנוספו</div>
                          {amendAddSpaces.map(function(sid) {
                            var sp = allPropertySpaces.find(function(s){return s.id===sid;});
                            return (
                              <div key={sid} className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-slate-600 w-32 truncate">{sp?.space_name}</span>
                                <span className="text-xs text-slate-400">{sp?.area} מ&quot;ר</span>
                                <input type="number" value={amendAddRents[sid]||""} placeholder={selContract.rent_per_sqm?"₪/מ\"ר":"₪/חודש"}
                                  onChange={function(e){setAmendAddRents(function(p){return {...p,[sid]:e.target.value};});}}
                                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs" />
                                <span className="text-[10px] text-slate-400">₪/מ&quot;ר</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── EXTEND PERIOD ── */}
                  {amendType === "extend" && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">תאריך סיום חדש</label>
                      <div className="text-xs text-slate-400 mb-2">סיום נוכחי: {fmtDate(selContract.end_date)}</div>
                      <input type="date" value={amendNewEndDate} onChange={function(e){setAmendNewEndDate(e.target.value);}}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </div>
                  )}

                  {/* ── PRICE CHANGE ── */}
                  {amendType === "price_change" && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-2">עדכון מחירים</label>
                      <div className="space-y-2">
                        {(selContract.contract_spaces||[]).map(function(cs: any) {
                          var sp = cs.spaces;
                          var isFixed = cs.charge_method === "fixed";
                          var curVal = isFixed ? (cs.fixed_rent||0) : (cs.price_per_sqm || selContract.rent_per_sqm || 0);
                          return (
                            <div key={cs.space_id} className="rounded-lg border border-slate-100 p-2 flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-600 w-32 truncate">{sp?.space_name}</span>
                              <span className="text-xs text-slate-400">{sp?.area} מ&quot;ר</span>
                              <span className="text-xs text-slate-400">נוכחי: {fmtMoney(curVal)}</span>
                              <span className="text-xs text-slate-400">→</span>
                              <input type="number" value={amendPriceChanges[cs.space_id]||""}
                                onChange={function(e){setAmendPriceChanges(function(p){return {...p,[cs.space_id]:e.target.value};});}}
                                className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs" />
                              <span className="text-[10px] text-slate-400">{isFixed?"₪/חודש":"₪/מ\"ר"}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">הערות</label>
                    <textarea value={amendNotes} onChange={function(e){setAmendNotes(e.target.value);}}
                      placeholder="תיאור השינוי..." rows={2}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-right" />
                  </div>

                  {/* Save */}
                  <button disabled={amendSaving} onClick={async function() {
                    if (!amendDate) { alert("נא להזין תאריך תוקף"); return; }
                    setAmendSaving(true);
                    try {
                      // Count existing amendments
                      var { count } = await supabase.from("contracts")
                        .select("id", { count: "exact", head: true })
                        .eq("parent_contract_id", selContract.id).eq("is_amendment", true);

                      // Build new spaces list
                      var currentSpaces = (selContract.contract_spaces||[]).map(function(cs: any){return cs;});
                      var newSpaces = currentSpaces.filter(function(cs: any){ return !amendRemoveSpaces.includes(cs.space_id); });

                      // Calculate new end date
                      var newEnd = amendType === "extend" ? amendNewEndDate : selContract.end_date;

                      // Calculate totals for the amendment record
                      var totalArea = 0;
                      newSpaces.forEach(function(cs: any) { totalArea += cs.spaces?.area || 0; });
                      amendAddSpaces.forEach(function(sid) {
                        var sp = allPropertySpaces.find(function(s){return s.id===sid;});
                        if (sp) totalArea += sp.area || 0;
                      });

                      // Build amendment contract record
                      var amendPayload: any = {
                        tenant_id: selContract.tenant_id,
                        property_id: selContract.property_id,
                        contract_type: selContract.contract_type,
                        start_date: amendDate,
                        end_date: newEnd,
                        lease_period_value: selContract.lease_period_value,
                        lease_period_unit: selContract.lease_period_unit,
                        rent_per_sqm: selContract.rent_per_sqm || null,
                        charged_area: totalArea || selContract.charged_area,
                        vat_type: selContract.vat_type,
                        payment_frequency: selContract.payment_frequency,
                        payment_method: selContract.payment_method,
                        payment_day: selContract.payment_day,
                        indexation_method: selContract.indexation_method,
                        index_base_value: selContract.index_base_value,
                        index_base_date: selContract.index_base_date,
                        status: "active",
                        parent_contract_id: selContract.id,
                        is_amendment: true,
                        amendment_number: (count ?? 0) + 1,
                        amendment_date: amendDate,
                        amendment_notes: amendNotes || (amendType === "swap_units" ? "החלפת יחידות" : amendType === "add_units" ? "הוספת יחידות" : amendType === "remove_units" ? "הורדת יחידות" : amendType === "extend" ? "הארכת תקופה" : amendType === "price_change" ? "שינוי מחירים" : "שינוי אחר"),
                      };

                      var { data: newContract, error } = await supabase.from("contracts").insert(amendPayload).select().single();
                      if (error) throw error;

                      // Insert spaces for the amendment
                      var spacesToInsert: any[] = [];
                      // Keep existing (not removed) with potential price changes
                      newSpaces.forEach(function(cs: any) {
                        var priceChanged = amendPriceChanges[cs.space_id] && Number(amendPriceChanges[cs.space_id]) !== (cs.charge_method === "fixed" ? Number(cs.fixed_rent) : Number(cs.price_per_sqm || selContract.rent_per_sqm));
                        spacesToInsert.push({
                          contract_id: newContract.id,
                          space_id: cs.space_id,
                          charge_method: cs.charge_method || "per_sqm",
                          price_per_sqm: cs.charge_method === "fixed" ? null : (priceChanged ? Number(amendPriceChanges[cs.space_id]) : cs.price_per_sqm),
                          fixed_rent: cs.charge_method === "fixed" ? (priceChanged ? Number(amendPriceChanges[cs.space_id]) : cs.fixed_rent) : null,
                        });
                      });
                      // Add new spaces
                      amendAddSpaces.forEach(function(sid) {
                        var rent = Number(amendAddRents[sid]) || Number(selContract.rent_per_sqm) || 0;
                        spacesToInsert.push({
                          contract_id: newContract.id,
                          space_id: sid,
                          charge_method: "per_sqm",
                          price_per_sqm: rent,
                          fixed_rent: null,
                        });
                      });
                      if (spacesToInsert.length > 0) {
                        await supabase.from("contract_spaces").insert(spacesToInsert);
                      }

                      // Update parent end date if extended
                      if (amendType === "extend" && amendNewEndDate > selContract.end_date) {
                        await supabase.from("contracts").update({ end_date: amendNewEndDate }).eq("id", selContract.id);
                      }

                      // Mark new spaces as occupied, removed as vacant
                      if (amendAddSpaces.length > 0) {
                        await supabase.from("spaces").update({ status: "occupied" }).in("id", amendAddSpaces);
                      }
                      if (amendRemoveSpaces.length > 0) {
                        await supabase.from("spaces").update({ status: "vacant" }).in("id", amendRemoveSpaces);
                      }

                      await logAudit({ entity_type: "contract", entity_id: newContract.id, action: "create", notes: "תוספת להסכם: " + (amendNotes || amendType) });
                      setShowAmendModal(false);
                      loadContracts();
                    } catch (e: any) {
                      alert("שגיאה: " + (e.message || e));
                    } finally {
                      setAmendSaving(false);
                    }
                  }}
                    className="w-full rounded-xl bg-yellow-600 px-4 py-3 text-sm font-bold text-white hover:bg-yellow-700 disabled:opacity-50 transition-all">
                    {amendSaving ? "שומר..." : "💾 שמור תוספת"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
