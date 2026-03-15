import { supabase } from "./supabase";
export async function syncContractStatuses() {
  const { data: contracts, error } = await supabase.from("contracts").select("id, start_date, end_date, status, contract_options(status, end_date)");
  if (error || !contracts) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const updates: {id:string;status:string}[]=[];
  for (const c of contracts) {
    const opts=(c.contract_options??[]) as any[];
    const exOpts=opts.filter(o=>o.status==="exercised"||o.status==="auto_extended").sort((a,b)=>new Date(b.end_date).getTime()-new Date(a.end_date).getTime());
    const effEnd=exOpts.length>0?new Date(exOpts[0].end_date):new Date(c.end_date);
    effEnd.setHours(0,0,0,0);
    const dl=Math.ceil((effEnd.getTime()-today.getTime())/86400000);
    const s = today<new Date(c.start_date)?"upcoming":today>effEnd?"ended":exOpts.length>0?(dl<=90?"expiring":"extended"):dl<=90?"expiring":"active";
    if(s!==c.status)updates.push({id:c.id,status:s});
  }
  await Promise.all(updates.map(({ id, status })=>supabase.from("contracts").update({status}).eq("id",id)));
  return updates.length;
}
export async function getContractAlerts(){
  const{data}=await supabase.from("contracts").select("id,end_date,status,tenants(name),properties(name)").in("status",["active","expiring","extended"]);
  const today=new Date();
  return(data??[]).map((c:any)=>({...c,daysLeft:Math.ceil((new Date(c.end_date).getTime()-today.getTime())/86400000)})).filter((c:any)=>c.daysLeft<=90&&c.daysLeft>=0).sort((a:any,b:any)=>a.daysLeft-b.daysLeft);
}
export async function calcIndexedRent(baseRentPerSqm:number,area:number,contractIndexValue:number,billingIndexValue:number,vatType="taxable",vatPct=18,mgmtFeePerSqm=0){const r=billingIndexValue/contractIndexValue;return{indexRatio:r,indexedRentPerSqm:baseRentPerSqm*r,indexedRentTotal:baseRentPerSqm*r*area,mgmtTotal:mgmtFeePerSqm*area,totalWithVat:(baseRentPerSqm*r*area+mgmtFeePerSqm*area)*(vatType==="taxable"?(1+vatPct/100):1),increase:r-1};}