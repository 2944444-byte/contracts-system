import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function syncContractStatuses(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  let updated = 0;

  const { data: contracts } = await supabase.from("contracts")
    .select("id, status, start_date, end_date")
    .in("status", ["upcoming","active","expiring","extended"]);

  for (const c of contracts ?? []) {
    let newStatus = c.status;
    const days = Math.ceil((new Date(c.end_date).getTime() - Date.now()) / 86400000);

    if (c.status === "upcoming" && c.start_date <= today) {
      newStatus = "active";
    } else if (c.status === "active" && days <= 90 && days > 0) {
      newStatus = "expiring";
    } else if (c.status === "expiring" && days > 90) {
      newStatus = "active";
    } else if (days <= 0 && c.status !== "ended") {
      newStatus = "ended";
    }

    if (newStatus !== c.status) {
      await supabase.from("contracts").update({ status: newStatus }).eq("id", c.id);
      updated++;
    }
  }

  return updated;
}
