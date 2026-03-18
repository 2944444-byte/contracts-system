import { supabase } from "./supabase";
import { logAudit } from "./audit-log";

export async function syncContractStatuses(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  let updated = 0;
  const { data: contracts } = await supabase.from("contracts")
    .select("id,status,start_date,end_date")
    .in("status",["upcoming","active","expiring","extended"]);
  for (const c of contracts??[]) {
    const days = c.end_date ? Math.ceil((new Date(c.end_date).getTime()-Date.now())/86400000) : 999;
    let newStatus = c.status;
    if (c.status==="upcoming" && c.start_date<=today) newStatus="active";
    else if (c.status==="active" && days<=90 && days>0) newStatus="expiring";
    else if (c.status==="expiring" && days>90) newStatus="active";
    else if (days<=0 && !["ended","extended"].includes(c.status)) newStatus="ended";
    if (newStatus!==c.status) {
      await supabase.from("contracts").update({status:newStatus}).eq("id",c.id);
      await logAudit({entity_type:"contract",entity_id:c.id,action:"status_change",notes:`${c.status} → ${newStatus}`});
      updated++;
    }
  }
  return updated;
}
