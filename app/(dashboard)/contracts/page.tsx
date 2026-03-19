"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { syncContractStatuses } from '@/lib/contractSync';

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function fmtMoney(n: number) { return "₪"+Math.round(n??0).toLocaleString(); }

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

  useEffect(function() { loadContracts(); }, []);

  async function loadContracts() {
    const { data } = await supabase.from("contracts")
      .select("*, tenants(name,phone,email,company_name), properties(name,city), contract_options(id,option_number,end_date,status), guarantees(id,status,amount_required,amount_actual)")
      .order("end_date");
    setContracts(data??[]);
    setLoading(false);
    if (!selected && (data??[]).filter(function(c){return c.status==="active";}).length>0) {
      setSelected((data??[]).filter(function(c){return c.status==="active";})[0].id);
    }
  }

  async function handleSync() {
    setSyncing(true);
    const n = await syncContractStatuses();
    await loadContracts();
    setSyncing(false);
    if (n>0) alert(`✅ עודכנו ${n} חוזים`);
  }

  const filtered = contracts.filter(function(c) {
    const ms = filterSt==="all" || c.status===filterSt;
    const mq = !search || c.tenants?.name?.includes(search) || c.properties?.name?.includes(search);
    return ms && mq;
  });

  const selContract = contracts.find(function(c){return c.id===selected;});
  const baseRent    = selContract ? (selContract.rent_per_sqm??0)*(selContract.charged_area??0)+(selContract.investment_addition??0) : 0;
  const vat         = selContract?.vat_type==="taxable" ? baseRent*0.18 : 0;
  const days        = selContract?.end_date ? Math.ceil((new Date(selContract.end_date).getTime()-Date.now())/86400000) : null;

  const counts: Record<string,number> = {};
  contracts.forEach(function(c){counts[c.status]=(counts[c.status]??0)+1;});

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

      {/* סטטוס פילטר */}
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
        {/* רשימה */}
        <div className="lg:col-span-2 space-y-2 max-h-[70vh] overflow-y-auto pl-1">
          {loading ? <div className="text-center py-8 text-slate-400">טוען...</div> : filtered.length===0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-400">
              <div className="text-4xl mb-2">📄</div><div>אין חוזים</div>
            </div>
          ) : filtered.map(function(c) {
            const si   = STATUS_MAP[c.status] ?? STATUS_MAP.ended;
            const mon  = (c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0);
            const d    = c.end_date ? Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000) : null;
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
                  {d!==null&&d<=90&&d>0&&<span className={"text-xs font-bold "+(d<=30?"text-red-600":"text-yellow-600")}>{d} יום</span>}
                  {d!==null&&d<=0&&<span className="text-xs font-bold text-red-600">פג!</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* פרטים */}
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
                  </div>
                </div>

                {/* KPI */}
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {[
                    {l:"בסיס",    v:fmtMoney(baseRent),    c:"text-slate-700", bg:"bg-slate-50"},
                    {l:'מע"מ',    v:fmtMoney(vat),          c:"text-slate-500", bg:"bg-white"},
                    {l:"סה\"כ",   v:fmtMoney(baseRent+vat), c:"text-blue-700 font-black", bg:"bg-blue-50"},
                    {l:"ימים",    v:days!==null?(days>0?String(days):"פג!"):"∞", c:days!==null&&days<=30?"text-red-600 font-black":days!==null&&days<=90?"text-yellow-600 font-bold":"text-green-600 font-semibold", bg:"bg-white"},
                  ].map(function(k){return <div key={k.l} className={"rounded-xl p-2.5 text-center border border-slate-100 "+k.bg}><div className={"text-base "+k.c}>{k.v}</div><div className="text-xs text-slate-400">{k.l}</div></div>;})}
                </div>

                {/* פרטים */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600">
                  {[
                    {l:"תחילה",   v:fmtDate(selContract.start_date)},
                    {l:"סיום",    v:fmtDate(selContract.end_date)},
                    {l:"שטח",    v:selContract.charged_area?selContract.charged_area+' מ"ר':"—"},
                    {l:"הצמדה",  v:selContract.indexation_method==="highest_in_period"?"מדד גבוה":"t-2"},
                    {l:"מדד בסיס",v:selContract.base_cpi_value||"—"},
                    {l:"מע\"מ",  v:selContract.vat_type==="taxable"?"18%":"פטור"},
                  ].map(function(r){return <div key={r.l} className="flex justify-between border-b border-slate-50 py-1"><span className="text-slate-400">{r.l}</span><span className="font-medium">{r.v}</span></div>;})}
                </div>
              </div>

              {/* יחידות */}
              {(selContract.contract_spaces??[]).length>0&&(
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
                  <div className="text-xs font-bold text-slate-500 mb-2">יחידות ({selContract.contract_spaces.length})</div>
                  <div className="flex flex-wrap gap-2">
                    {selContract.contract_spaces.map(function(cs:any){return cs.spaces&&<span key={cs.spaces.name} className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full">{cs.spaces.name}{cs.spaces.area?" — "+cs.spaces.area+' מ"ר':""}</span>;})}
                  </div>
                </div>
              )}

              {/* אופציות + ערבויות */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-3">
                  <div className="text-xs font-bold text-slate-500 mb-2">אופציות ({(selContract.contract_options??[]).length})</div>
                  {(selContract.contract_options??[]).length===0 ? <div className="text-xs text-slate-400">אין</div> : (
                    selContract.contract_options.map(function(opt:any,i:number){return (
                      <div key={opt.id} className="text-xs flex justify-between py-0.5">
                        <span className="text-slate-500">אופציה {i+1}</span>
                        <span className={"px-1.5 rounded-full "+(opt.status==="exercised"?"bg-green-100 text-green-700":opt.status==="expired"?"bg-red-100 text-red-600":"bg-blue-100 text-blue-600")}>
                          {opt.status==="exercised"?"מומשה":opt.status==="expired"?"פגה":"ממתינה"}
                        </span>
                      </div>
                    );})
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-3">
                  <div className="text-xs font-bold text-slate-500 mb-2">ערבויות ({(selContract.guarantees??[]).filter(function(g:any){return g.status==="active";}).length})</div>
                  {(selContract.guarantees??[]).filter(function(g:any){return g.status==="active";}).length===0 ? <div className="text-xs text-slate-400">אין</div> : (
                    selContract.guarantees.filter(function(g:any){return g.status==="active";}).map(function(g:any){
                      const diff=(g.amount_actual??0)-(g.amount_required??0);
                      return <div key={g.id} className="text-xs py-0.5 flex justify-between"><span className="text-slate-500">{fmtMoney(g.amount_actual??0)}</span><span className={diff<0?"text-red-600 font-bold":"text-green-600"}>{diff<0?"פער!":"✓"}</span></div>;
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
