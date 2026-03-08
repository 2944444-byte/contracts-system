import { supabase } from "./supabase";

/**
 * מעדכן סטטוס חוזים אוטומטית לפי תאריכים:
 * - upcoming  → לפני תאריך התחלה
 * - active    → בתוך התקופה, יותר מ-90 יום לסיום
 * - expiring  → בתוך התקופה, פחות מ-90 יום לסיום
 * - ended     → אחרי תאריך הסיום
 */
export async function syncContractStatuses() {
  const { data: contracts, error } = await supabase
    .from("contracts")
    .select("id, start_date, end_date, status");

  if (error || !contracts) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const updates: { id: string; status: string }[] = [];

  for (const c of contracts) {
    const start = new Date(c.start_date);
    const end = new Date(c.end_date);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const daysLeft = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    let newStatus: string;
    if (today < start) {
      newStatus = "upcoming";
    } else if (today > end) {
      newStatus = "ended";
    } else if (daysLeft <= 90) {
      newStatus = "expiring";
    } else {
      newStatus = "active";
    }

    if (newStatus !== c.status) {
      updates.push({ id: c.id, status: newStatus });
    }
  }

  // עדכון batch
  await Promise.all(
    updates.map(({ id, status }) =>
      supabase.from("contracts").update({ status }).eq("id", id)
    )
  );

  return updates.length;
}

/**
 * מחזיר התראות על חוזים שפגים בקרוב (90 יום)
 */
export async function getContractAlerts() {
  const { data } = await supabase
    .from("contracts")
    .select("id, end_date, status, tenants(name), properties(name)")
    .in("status", ["active", "expiring"]);

  const today = new Date();
  const alerts = (data ?? [])
    .map((c: any) => {
      const daysLeft = Math.ceil(
        (new Date(c.end_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      return { ...c, daysLeft };
    })
    .filter((c: any) => c.daysLeft <= 90 && c.daysLeft >= 0)
    .sort((a: any, b: any) => a.daysLeft - b.daysLeft);

  return alerts;
}

/**
 * מחשב שכ"ד מוצמד למדד
 * נוסחה: שכ"ד_מוצמד = שכ"ד_בסיס × (מדד_חיוב / מדד_חוזה)
 */
export async function calcIndexedRent(
  baseRentPerSqm: number,
  area: number,
  contractIndexValue: number,   // מדד בחתימת חוזה
  billingIndexValue: number,    // מדד בחיוב
  vatType: "taxable" | "exempt" = "taxable",
  vatPct: number = 18,
  mgmtFeePerSqm: number = 0
) {
  const indexRatio = billingIndexValue / contractIndexValue;
  const indexedRentPerSqm = baseRentPerSqm * indexRatio;
  const indexedRentTotal = indexedRentPerSqm * area;
  const mgmtTotal = mgmtFeePerSqm * area;
  const vatMultiplier = vatType === "taxable" ? (1 + vatPct / 100) : 1;
  const totalWithVat = (indexedRentTotal + mgmtTotal) * vatMultiplier;

  return {
    indexRatio,
    indexedRentPerSqm,
    indexedRentTotal,
    mgmtTotal,
    totalWithVat,
    increase: indexRatio - 1
  };
}
