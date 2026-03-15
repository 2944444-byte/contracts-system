"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function fmtDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>({contracts:[],alerts:[],properties:[],charges:[],guarantees:[],safety:[],insurances:[]});
  const [loading, setLoading] = useState(true);
  useEffect(function() { loadAll(); }, []);
  async function loadAll() {
    const [{data:c},{data:a},{data:p},{data:ch},{data:g},{data:s},{data:ins}] = await Promise.all([
      supabase.from("contracts").select("id,status,end_date,tenants(name),properties(name),charged_area,rent_per_sqm,investment_addition,contract_options(status)").in("status",["active","expiring","extended"]),
      supabase.from("alerts").select("*").eq("is_handled",false).order("created_at",{ascending:false}).limit(8),
      supabase.from("properties").select("id,name,total_rentable_area,units(id,status),spaces(id,status)"),
      supabase.from("charges").select("id,status,total_amount,contracts(tenants(name),properties(name))").in("status",["pending","approved"]).limit(10),
      supabase.from("guarantees").select("id,end_date,guarantee_type,amount_actual,contracts(tenants(name))").eq("status","active"),
      supabase.from("safety_inspections").select("id,inspection_type,next_inspection_date,properties(name)"),
      supabase.from("insurances_tenant").select("id,end_date,contracts(tenants(name))"),
    ]);
    setData({contracts:c??[],alerts:a??[],properties:p??[],charges:ch?>[],guarantees:g??[],safety:s??[],insurances:ins??[]});
    setLoading(false);
  }
  const totalRevenue=data.contracts.reduce((s:number,c:any)=>s+(c.rent_per_sqm??0)*(c.charged_area??0)+(c.investment_addition??0),0);
  const expiringContracts=data.contracts.filter((c:any)=>{const d=daysLeft(c.end_date);return d>=0&&d<=90;});
  const pendingCharges=data.charges.filter((c:any)=>c.status==="pending");
  const expiringGuarantees=data.guarantees.filter((g:any)=>{const d=daysLeft(g.end_date);return d>=0&&d<=60;});
  const urgentSafety=data.safety.filter((s:any)=>daysLeft(s.next_inspection_date)<=30);
  const expiringInsurances=data.insurances.filter((i:any)=>{const d=daysLeft(i.end_date);return d>=0&&d<=60;});
  const totalUnits=data.properties.reduce((s:number,p:any)=>s+(p.spaces?.length||p.units?.length||0),0);
  const occupiedUnits=data.properties.reduce((s:number,p:any)=>s+(p.spaces?.length?p.spaces:p.units??[]).filter((u:any)=>u.status==="rented").length,0);
  const occupancyPct=totalUnits>0?Math.round(occupiedUnits/totalUnits*100):0;
  if(loading)return(<div dir="rtl" className="flex items-center justify-center py-24"><div className="text-slate-400">יפול דשבות…</div></div>);
  return(<div dir="rtl"><h1 className="text-3xl font-bold mb-6">דשבורד</h1><div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6"><div className="rounded-xl border border-green-100 bg-green-50 p-4"><div className="text-xs text-green-600 font-semibold">הכנס�Ԓ,חודשתם</div><div className="text-2xl font-black text-green-800">₪{Math.round(totalRevenue).toLocaleString()}</div></div><div className="rounded-xl border border-blue-100 bg-blue-50 p-4 cursor-pointer" onClick={function(){router.push("/contracts");}}><div className="text-xs text-blue-600 font-semibold">תפוום</div><div className="text-2xl font-black text-blue-800">{occupancyPct}%</div></div><div className="rounded-xl border p-4 cursor-pointer" onClick={function(){router.push("/payments");}}><div className="text-xs font-semibold">ממ��י לאישור</div><div className="text-2xl font-black">{pendingCharges.length}</div></div><div className="rounded-xl border p-4 cursor-pointer" onClick={function(){router.push("/alerts");}}><div className="text-xs font-semibold">התראות פתוחות</div><div className="text-2xl font-black">{data.alerts.length}</div></div></div></div>);
}
