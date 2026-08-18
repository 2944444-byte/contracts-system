// שטחי עזר (סככה, חצר צמודה) — שני מנגנונים גנריים:
//
// 1. שכ"ד "כלול במחיר" (charge_method='included'): יחידת עזר שההסכם קובע
//    שמחירה כלול בשכ"ד של היחידה הראשית — תורמת ₪0 לשכ"ד, ובלי ליפול
//    בטעות ל-fallback של מחיר החוזה למ"ר. spaceMonthlyBase היא נקודת האמת.
//
// 2. הכללה בחישובי עלות ברמת הנכס (properties.space_type_billing):
//    לכל סוג שטח עזר מסמנים האם שטחו נספר בדמי ניהול / ביטוח / אשפה.
//    ברירת המחדל (החלטת 18.08.2026): שטח עזר (סככה/חצר) **אינו נספר**
//    בחלוקות אלא אם סומן במפורש; סוג שטח רגיל נספר תמיד אלא אם הוחרג.
//    הסימון תקף לכל היחידות מאותו סוג באותו נכס.

// סוגי שטח העזר שעליהם חלה מטריצת ההכללה.
export const AUX_SPACE_TYPES = [
  { v: "shed", l: "סככה", icon: "🏚" },
  { v: "yard", l: "חצר צמודה", icon: "🌳" },
];

export type BillingKind = "mgmt" | "insurance" | "waste";

// האם שטח מסוג זה נספר בחישוב מהסוג הנתון, לפי מטריצת הנכס.
// ללא סימון מפורש: סוג עזר (סככה/חצר) מוחרג, סוג רגיל נכלל.
export function spaceCountsFor(kind: BillingKind, spaceType: string | null | undefined, matrix: any): boolean {
  if (!spaceType) return true;
  const isAux = AUX_SPACE_TYPES.some(function (t) { return t.v === spaceType; });
  const m = matrix && typeof matrix === "object" ? matrix[spaceType] : null;
  const v = m && typeof m === "object" ? m[kind] : undefined;
  if (v === true) return true;
  if (v === false) return false;
  return !isAux;
}

// שטח יחידות החוזה הנספר לחישוב נתון (מסנן סוגים מוחרגים לפי מטריצת הנכס).
export function billableAreaFor(kind: BillingKind, contractSpaces: any[], matrix: any): number {
  return (contractSpaces || []).reduce(function (s: number, cs: any) {
    const sp = cs?.spaces || cs;
    if (!spaceCountsFor(kind, sp?.space_type, matrix)) return s;
    return s + (Number(sp?.area) || 0);
  }, 0);
}

// הבסיס החודשי של יחידה בחוזה — נקודת אמת אחת לכלל המסכים והמנועים:
//   included → 0 (כלול במחיר היחידה הראשית; בלי fallback למחיר החוזה)
//   fixed    → הסכום הקבוע
//   אחרת    → מחיר למ"ר של היחידה (או של החוזה) × שטח
export function spaceMonthlyBase(cs: any, contractRentPerSqm: number): number {
  if (!cs) return 0;
  if (cs.charge_method === "included") return 0;
  if (cs.charge_method === "fixed" && Number(cs.fixed_rent) > 0) return Number(cs.fixed_rent);
  const area = Number(cs?.spaces?.area) || Number(cs?.area) || 0;
  return (Number(cs.price_per_sqm) || Number(contractRentPerSqm) || 0) * area;
}
