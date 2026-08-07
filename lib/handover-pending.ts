// A future-handover lease does nothing until the handover is confirmed.
//
// Until `actual_handover_date` is recorded the contract stays `upcoming`, and
// every calculation screen filters on active/expiring/extended — so no rent is
// billed, no CPI difference is computed, no management or insurance share is
// allocated, and a derived base index stays unresolved. That is the correct
// behaviour: the lease genuinely hasn't started.
//
// The risk is the silent one: the premises are handed over, nobody records it,
// and the contract keeps sitting outside every calculation. This rule surfaces
// exactly that — a lease whose planned handover has arrived (or is about to)
// with no confirmation on file.

export const HANDOVER_LEAD_DAYS = 30;   // start reminding this long before the planned date

export function daysUntilDay(dateStr: string, today?: Date): number {
  const d = new Date(dateStr);
  const t = today ? new Date(today) : new Date();
  t.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

export type HandoverVerdict = {
  applies: boolean;
  days: number;            // >0 = still ahead, <=0 = the planned date has passed
  overdue: boolean;
  severity: "info" | "warning" | "urgent";
};

export function handoverPendingVerdict(params: { contract: any; today?: Date }): HandoverVerdict {
  const c = params.contract;
  const none: HandoverVerdict = { applies: false, days: 0, overdue: false, severity: "info" };
  if (!c) return none;
  if (c.actual_handover_date) return none;                    // confirmed — nothing to chase
  const planned = c.planned_handover_date;
  if (!planned) return none;                                  // not a handover contract
  // A cancelled or ended contract is not waiting for anything.
  if (["upcoming", "future", "active", "expiring", "extended", "pending"].indexOf(String(c.status)) === -1) return none;

  const days = daysUntilDay(String(planned).slice(0, 10), params.today);
  if (days > HANDOVER_LEAD_DAYS) return none;

  // Past the planned date the contract is invisible to every calculation, so it
  // escalates rather than sitting as a gentle reminder.
  const overdue = days <= 0;
  return {
    applies: true,
    days,
    overdue,
    severity: overdue ? "urgent" : "warning",
  };
}

export function handoverPendingTitle(v: HandoverVerdict, label: string): string {
  return v.overdue
    ? `לא אושר מועד מסירה (${Math.abs(v.days)} ימים אחרי היעד): ${label}`
    : `מסירה מתוכננת בעוד ${v.days} ימים — יש לאשר מועד מסירה: ${label}`;
}

export function handoverPendingMessage(v: HandoverVerdict, plannedHe: string): string {
  return v.overdue
    ? `יעד המסירה (${plannedHe}) חלף ולא הוזן מועד מסירה בפועל. עד לאישור, החוזה אינו נכלל בחישובים — שכ"ד, הצמדה, דמי ניהול, ביטוח ואשפה. הזן "📦 מסירה בפועל" במסך החוזים.`
    : `יעד המסירה ${plannedHe}. ביום המסירה יש להזין "📦 מסירה בפועל" במסך החוזים — ממנה מתחילה תקופת השכירות, נקבע מדד הבסיס והחוזה נכנס לחישובים.`;
}
