import { supabase } from "./supabase";

export async function syncContractStatuses() {
  const { data: contracts, error } = await supabase
    .from("contracts")
    .select("id, start_date, end_date, status, contract_options(status, end_date)");
  if (error || !contracts) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const updates: { id: string; status: string }[] = [];

  for (const c of contracts) {
    const start = new Date(c.start_date);
    const opts  = (c.contract_options ?? []) as any[];

    // בדוק אם יש אופציה ממומשת — מצא סיום אפקטיבי
    const exercisedOpts = opts
      .filter(function(o) { return o.status === "exercised" || o.status === "auto_extended"; })
      .sort(function(a, b) { return new Date(b.end_date).getTime() - new Date(a.end_date).getTime(); });

    const effectiveEnd = exercisedOpts.length > 0
      ? new Date(exercisedOpts[0].end_date)
      : new Date(c.end_date);
    effectiveEnd.setHours(0, 0, 0, 0);

    const daysLeft = Math.ceil((effectiveEnd.getTime() - today.getTime()) / 86400000);

    let newStatus: string;
    if (today < start) {
      newStatus = "upcoming";
    } else if (today > effectiveEnd) {
      newStatus = "ended";
    } else if (exercisedOpts.length > 0) {
      newStatus = daysLeft <= 90 ? "expiring" : "extended";
    } else if (daysLeft <= 90) {
      newStatus = "expiring";
    } else {
      newStatus = "active";
    }

    if (newStatus !== c.status) {
      updates.push({ id: c.id, status: newStatus });
    }
  }

  await Promise.all(
    updates.map(function({ id, status }) {
      return supabase.from("contracts").update({ status }).eq("id", id);
    })
  );

  // צור התראות אוטומטיות לאופציות שמגיעות למועד הודעה
  await createOptionAlerts();

  return updates.length;
}

async function createOptionAlerts() {
  const { data: options } = await supabase
    .from("contract_options")
    .select("*, contracts(tenants(name), properties(name))")
    .eq("status", "pending");

  const today = new Date();
  for (const opt of options ?? []) {
    if (!opt.notice_deadline) continue;
    const deadline = new Date(opt.notice_deadline);
    const d = Math.ceil((deadline.getTime() - today.getTime()) / 86400000);

    if (d === 90 || d === 60 || d === 30 || d === 0) {
      const tenantName  = (opt.contracts as any)?.tenants?.name ?? "";
      const propName    = (opt.contracts as any)?.properties?.name ?? "";
      const priority    = d <= 0 ? "critical" : d <= 30 ? "high" : "medium";

      // בדוק שאין כבר התראה
      const { data: existing } = await supabase.from("alerts")
        .select("id").eq("related_entity_type", "contract")
        .eq("related_entity_id", opt.contract_id)
        .ilike("title", "%" + d + " יום%")
        .limit(1);

      if (!existing?.length) {
        await supabase.from("alerts").insert({
          title:               "מועד הודעת אופציה — " + tenantName,
          message:             propName + " | אופציה " + opt.option_number + " | " + (d <= 0 ? "עבר המועד" : d + " ימים לפני סיום"),
          alert_type:          "option_deadline",
          priority,
          related_entity_type: "contract",
          related_entity_id:   opt.contract_id,
          is_handled:          false,
        });
      }
    }
  }
}

export async function getContractAlerts() {
  const { data } = await supabase
    .from("contracts")
    .select("id, end_date, status, tenants(name), properties(name)")
    .in("status", ["active", "expiring", "extended"]);

  const today = new Date();
  return (data ?? [])
    .map(function(c: any) {
      const daysLeft = Math.ceil((new Date(c.end_date).getTime() - today.getTime()) / 86400000);
      return { ...c, daysLeft };
    })
    .filter(function(c: any) { return c.daysLeft <= 90 && c.daysLeft >= 0; })
    .sort(function(a: any, b: any) { return a.daysLeft - b.daysLeft; });
}

export async function calcIndexedRent(
  baseRentPerSqm: number,
  area: number,
  contractIndexValue: number,
  billingIndexValue: number,
  vatType: "taxable" | "exempt" = "taxable",
  vatPct: number = 18,
  mgmtFeePerSqm: number = 0
) {
  const indexRatio       = billingIndexValue / contractIndexValue;
  const indexedRentPerSqm = baseRentPerSqm * indexRatio;
  const indexedRentTotal  = indexedRentPerSqm * area;
  const mgmtTotal        = mgmtFeePerSqm * area;
  const vatMultiplier    = vatType === "taxable" ? (1 + vatPct / 100) : 1;
  const totalWithVat     = (indexedRentTotal + mgmtTotal) * vatMultiplier;
  return { indexRatio, indexedRentPerSqm, indexedRentTotal, mgmtTotal, totalWithVat, increase: indexRatio - 1 };
}
