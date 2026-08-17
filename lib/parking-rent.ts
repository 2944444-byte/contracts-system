// הסכם חניות — חישוב שכ"ד מבסיס החניות, על אותו מנוע בדיוק.
//
// חוזה חניות טהור (contract_type='parking') אינו קשור ליחידה עם שטח: הבסיס
// החודשי שלו הוא סכום דמי החניה של המנויים המקושרים. במקום לכתוב מנוע
// מקביל, אנחנו מסנתזים "יחידה מדומה" עם שכ"ד קבוע בגובה בסיס החניות
// ומריצים את buildSpaceRentSchedule הקיים — כך מדרגות מחיר, עליות שנתיות
// ואופציות ממומשות חלות על חניות בדיוק כמו על יחידות, ללא כפילות קוד.
//
// חוזה יחידות שיש לו גם חניות (התוספת הקיימת) ממשיך בכללים הישנים —
// החניות מתווספות שטוח מעל שכ"ד היחידות (כמו במסך המקדמות מאז ומעולם).

import { buildSpaceRentSchedule, rentAtDate, type RentScheduleEntry } from "@/lib/contract-utils";

export function isParkingOnly(c: any): boolean {
  return c?.contract_type === "parking";
}

// Billable parking rows: active, not visitor codes, not folded into the rent.
export function billableParkingRows(rows: any[]): any[] {
  return (rows || []).filter(function (p) {
    if (!p || p.status !== "active") return false;
    if (p.subscription_type === "visitor") return false;
    if (p.is_included_in_rent) return false;
    return true;
  });
}

export function parkingMonthlyTotal(rows: any[]): number {
  return billableParkingRows(rows).reduce(function (s, p) {
    return s + (Number(p.monthly_fee) || 0) * (Number(p.quantity) || 1);
  }, 0);
}

export function parkingSpotCount(rows: any[]): number {
  return billableParkingRows(rows).reduce(function (s, p) {
    return s + (Number(p.quantity) || 1);
  }, 0);
}

// Rent schedule for a parking-only contract: the parking base run through the
// standard tier/option engine (steps fire by contract year, options by their
// mechanisms — identical semantics to a fixed-rent unit).
export function parkingRentSchedule(params: {
  contract: any;
  parkingRows: any[];
  contractTiers: any[];
  exercisedOptions: any[];
}): RentScheduleEntry[] {
  return buildSpaceRentSchedule({
    contractStartDate: params.contract?.start_date,
    spaceArea: 0,
    isFixed: true,
    spaceBaseRent: parkingMonthlyTotal(params.parkingRows),
    spaceTiers: [],
    contractTiers: params.contractTiers || [],
    exercisedOptions: params.exercisedOptions || [],
  });
}

export function parkingRentAtDate(params: {
  contract: any;
  parkingRows: any[];
  contractTiers: any[];
  exercisedOptions: any[];
  date: Date;
}): number {
  return rentAtDate(parkingRentSchedule(params), params.date);
}

// Monthly parking-management fee (own rate, distinct from the per-sqm rate).
export function parkingMgmtMonthly(contract: any, rows: any[]): number {
  const rate = Number(contract?.mgmt_parking_fee_per_spot) || 0;
  if (rate <= 0) return 0;
  return rate * parkingSpotCount(rows);
}
