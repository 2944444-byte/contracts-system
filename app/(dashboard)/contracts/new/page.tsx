"use client";
import { useState, useEffect, Suspense } from "react";
import { graceWindow, describeGrace, lateOpeningPenalty, mgmtFreeWindow, describeMgmtFree } from "@/lib/store-opening";
import { leaseTerm, effectiveOpeningDate, describeLeaseTerm, describeOpening } from "@/lib/lease-term";
import { periodsForYear } from "@/lib/revenue-settlement";
import { guaranteedMonthlyRent } from "@/lib/guarantee-base";
import RevenuePctTiersEditor from "@/components/RevenuePctTiersEditor";
import { RevenuePctTier, pctTiersFromRow, describePctTiers } from "@/lib/revenue-pct-steps";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { authHeaders } from '@/lib/api-auth-client';
import { getScopeIds, getCompanyScopeIds, getTenantScopeIds, scopeRows, scopeGroups } from '@/lib/permissions';
import { logAudit } from "@/lib/audit-log";
import { buildOnboardingBody, chequeSchedule, type OnboardingParams } from "@/lib/onboarding-letter";
import { loadCompanyInfo, letterContent } from "@/lib/letter-format";
import { getVatRates, vatPctAt } from "@/lib/vat";
import {
  calculateEndDate,
  calculateOptionDates,
  calculateDepositAmount,
  emptyOption,
  emptyIncreaseStep,
  emptyPriceTier,
  validatePriceTiers,
  calculateTierPreviews,
  buildPriceTimeline,
  type ExtensionOption,
  type IncreaseStep,
  type PriceTier,
} from "@/lib/contract-utils";
import { penaltyTermsFromRow, penaltyTermsToRow } from "@/lib/option-penalty";
import { baseIndexRuleToRow, baseIndexRuleFromRow, type BaseIndexRule } from "@/lib/base-index-rule";
import { clawbackTermsToRow } from "@/lib/investment-clawback";
import { revenueCategoriesFromRow, type RevenueCategory } from "@/lib/revenue-categories";
import { revenueProtectionFromRow, revenueProtectionToRow, emptyRevenueProtection, type RevenueProtection } from "@/lib/revenue-protection";
import RevenueCategoriesEditor from "@/components/RevenueCategoriesEditor";
import BaseIndexRuleFields from '@/components/BaseIndexRuleFields';
import MgmtProtectionFields from '@/components/MgmtProtectionFields';
import { mgmtProtectionFromRow, mgmtProtectionToRow, emptyMgmtProtection, type MgmtProtection } from '@/lib/mgmt-protection';
import ExtraGuaranteesEditor, { emptyExtraGuarantee, extraGuaranteeFromRow, extraGuaranteeToRow, DELIVERY_LABELS, type ExtraGuarantee } from '@/components/ExtraGuaranteesEditor';
import OptionPenaltyFields from '@/components/OptionPenaltyFields';
import TenantForm from '@/components/TenantForm';
import PropertyForm from '@/components/PropertyForm';

const ic =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const STEPS = [
  { id: 1, label: "שוכר ונכס", icon: "👤" },
  { id: 2, label: "תנאי שכירות", icon: "📋" },
  { id: 3, label: "גרייס ועלייה", icon: "📈" },
  { id: 4, label: "אופציות", icon: "🔄" },
  { id: 5, label: "ביטחונות", icon: "🏦" },
  { id: 6, label: "סיכום", icon: "✅" },
];

const VAT_TYPES = [
  { v: "taxable", l: 'חייב במע"מ' },
  { v: "exempt", l: "פטור" },
  { v: "partial", l: "חלקי" },
];
const INDEX_METHODS = [
  { v: "standard", l: "t-2 רגיל" },
  { v: "highest_in_period", l: "מדד גבוה ביותר" },
  { v: "no_drop", l: "ללא ירידה (floor)" },
  { v: "none", l: "ללא הצמדה" },
];
const PAYMENT_FREQS = [
  { v: "monthly", l: "חודשי" },
  { v: "quarterly", l: "רבעוני" },
  { v: "annual", l: "שנתי" },
  { v: "one_time", l: "חד פעמי" },
];
const PAYMENT_METHODS = [
  { v: "checks_advance", l: "שיקים מראש", icon: "📝" },
  { v: "standing_order", l: "הוראת קבע", icon: "🏦" },
  { v: "bank_transfer", l: "העברה בנקאית", icon: "💳" },
  { v: "cash", l: "מזומן", icon: "💵" },
  { v: "credit_card", l: "כרטיס אשראי", icon: "💳" },
];
const CONTRACT_TYPES = [
  { v: "regular", l: "שכירות רגילה" },
  { v: "complementary", l: "הסכם משלים" },
  { v: "parking", l: "חניה" },
  { v: "special", l: "שימוש מיוחד" },
  { v: "other", l: "אחר" },
];
const GRACE_TYPES = [
  { v: "full", l: "גרייס מלא (100%)" },
  { v: "partial", l: "גרייס חלקי" },
  { v: "rent_only", l: 'גרייס על שכ"ד בלבד' },
];
const GUARANTEE_TYPES = [
  { v: "bank", l: "ערבות בנקאית", icon: "🏦" },
  { v: "promissory_note", l: "שטר חוב", icon: "📜" },
  { v: "check", l: "שיקים", icon: "📝" },
  { v: "cash", l: "פיקדון מזומן", icon: "💵" },
  { v: "insurance", l: "ביטוח", icon: "🛡️" },
  { v: "personal", l: "אישית", icon: "👤" },
];
// Guarantee types that don't require an expiry date
const NO_EXPIRY_GUARANTEES = ["promissory_note", "cash"];
const INCREASE_TYPES = [
  { v: "pct", l: "אחוז (%)", icon: "📈" },
  { v: "fixed_sqm", l: '₪/מ"ר', icon: "📐" },
  { v: "fixed_total", l: "תוספת קבועה (₪)", icon: "💰" },
  { v: "none", l: "הקפאה", icon: "❄️" },
];
const NOTICE_TYPES = [
  { v: "exercise", l: "הודעת מימוש" },
  { v: "non_renewal", l: "הודעת אי-מימוש" },
  { v: "auto", l: "הארכה אוטומטית" },
];
const RENT_MECHANISMS = [
  { v: "no_change", l: "ללא שינוי" },
  { v: "increase_pct", l: "% עלייה" },
  { v: "new_value", l: "מחיר חדש" },
];
const DEPOSIT_METHODS = [
  { v: "months_based", l: "לפי חודשי שכ\"ד" },
  { v: "fixed_amount", l: "סכום קבוע" },
];

function fmtMoney(n: number) {
  return "₪" + (n ?? 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ContractsNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const amendmentOfId = searchParams.get("amendment_of");
  const [amendmentParent, setAmendmentParent] = useState<any>(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [tenants, setTenants] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [spaces, setSpaces] = useState<any[]>([]);
  const [cpiRecords, setCpiRecords] = useState<any[]>([]);
  const [currentVatPct, setCurrentVatPct] = useState(18);
  const [unitRentOverrides, setUnitRentOverrides] = useState<Record<string, string>>({});
  const [unitRentTypes, setUnitRentTypes] = useState<Record<string, "per_sqm" | "fixed" | "included">>({});

  // Step 1 — Tenant & Property
  const [tenantId, setTenantId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [selSpaces, setSelSpaces] = useState<string[]>([]);
  const [contractType, setContractType] = useState("regular");
  // הסכם חניות טהור: אין יחידות ואין מ"ר — הבסיס לחיוב הוא מנויי החניה.
  const isParkingContract = contractType === "parking";
  // דמי ניהול לחניה — עקיפת חוזה; ריק = לפי הגדרת הנכס (parking_mgmt_fee_per_spot).
  const [mgmtParkingFee, setMgmtParkingFee] = useState("");
  const [showNewTenant, setShowNewTenant] = useState(false);
  const [showNewProperty, setShowNewProperty] = useState(false);
  const [showNewUnit, setShowNewUnit] = useState(false);
  const [aiExtracting, setAiExtracting] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [parkingSpots, setParkingSpots] = useState<any[]>([]);
  const [selParking, setSelParking] = useState<string[]>([]);
  const [showNewParking, setShowNewParking] = useState(false);
  const [newParkingSpot, setNewParkingSpot] = useState("");
  const [newParkingQty, setNewParkingQty] = useState("1");
  const [newParkingMarked, setNewParkingMarked] = useState(false);
  const [newParkingFee, setNewParkingFee] = useState("");
  const [newParkingVehicle, setNewParkingVehicle] = useState("");
  const [newParkingIncluded, setNewParkingIncluded] = useState(false);

  // Step 2 — Dates & Terms
  const [signingDate, setSigningDate] = useState("");
  const [plannedHandover, setPlannedHandover] = useState("");
  const [actualHandover, setActualHandover] = useState("");
  const [hasFutureHandover, setHasFutureHandover] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [leasePeriodValue, setLeasePeriodValue] = useState(12);
  // A retail term often runs from the OPENING, and the opening is defined
  // rather than recorded: "לא יאוחר מתום שישים (60) ימים ממועד מסירת החזקה".
  const [termStartsAt, setTermStartsAt] = useState<"start_date"|"handover"|"opening">("start_date");
  const [openingRuleOn, setOpeningRuleOn] = useState(false);
  const [openingMaxDays, setOpeningMaxDays] = useState("");
  const [openingDefinition, setOpeningDefinition] = useState("");
  const [leasePeriodUnit, setLeasePeriodUnit] = useState<"months" | "years">("months");
  const [endDate, setEndDate] = useState("");
  const [rentType, setRentType] = useState<"fixed" | "revenue_pct">("fixed");
  const [revenuePct, setRevenuePct] = useState("");
  const [minimumRent, setMinimumRent] = useState("0");
  // How the minimum is expressed. Leases usually state it per sqm, and only the
  // per-sqm figure feeds the revenue screen's floor (min_rent_per_sqm) — the
  // wizard used to write the monthly column only, so a minimum entered here
  // never reached the calculation.
  const [minRentBasis, setMinRentBasis] = useState<"per_sqm"|"monthly">("per_sqm");
  // "עד לאיכלוס 60% משטחי הפרויקט ישלם השוכר דמי שכירות חליפיים בלבד" — the
  // floor itself is conditional: until the centre fills up there is no minimum,
  // only the turnover percentage.
  const [minCondOn, setMinCondOn] = useState(false);
  const [minCondPct, setMinCondPct] = useState("");
  const [minCondMetAt, setMinCondMetAt] = useState("");
  const [minCondNotes, setMinCondNotes] = useState("");
  const [revenuePctTiers, setRevenuePctTiers] = useState<RevenuePctTier[]>([]);
  const [revenueReportDay, setRevenueReportDay] = useState("5");
  const [mgmtIncludedInRevenue, setMgmtIncludedInRevenue] = useState(false);
  const [rentPerSqm, setRentPerSqm] = useState("");
  const [chargedArea, setChargedArea] = useState("");
  const [investAdd, setInvestAdd] = useState("");
  // Construction-investment (השקעות בינוי) detail + reimbursement terms: the
  // landlord funds fit-out works and pays the tenant back, typically X days
  // after works completion / handover / opening, against a report + invoice.
  const [tiAmount, setTiAmount] = useState("");
  // Early-exit clawback: the investment is given against a minimum stay, and
  // leaving before it ends repays the unearned months.
  const [tiClawbackMonths, setTiClawbackMonths] = useState("");
  const [tiClawbackIndexed, setTiClawbackIndexed] = useState(true);
  const [tiClawbackVat, setTiClawbackVat] = useState(true);
  const [tiClawbackNotes, setTiClawbackNotes] = useState("");
  const [tiDescription, setTiDescription] = useState("");
  const [tiPaymentTrigger, setTiPaymentTrigger] = useState("on_completion");
  const [tiPaymentDays, setTiPaymentDays] = useState("");
  const [tiInstallments, setTiInstallments] = useState("");
  const [tiRequiresReport, setTiRequiresReport] = useState(true);
  const [tiRequiresInvoice, setTiRequiresInvoice] = useState(true);
  const [tiPaymentNotes, setTiPaymentNotes] = useState("");
  // Early termination
  const [earlyTermination, setEarlyTermination] = useState(false);
  const [terminationNoticeDays, setTerminationNoticeDays] = useState("30");
  const [terminationBy, setTerminationBy] = useState("both");
  const [vatType, setVatType] = useState("taxable");
  const [paymentFreq, setPaymentFreq] = useState("monthly");
  // Turnover leases settle on their own cadence — a monthly minimum with a
  // quarterly reconciliation is common, so these are independent of paymentFreq.
  const [revMinAdvance, setRevMinAdvance] = useState(false);
  const [revProtection, setRevProtection] = useState<RevenueProtection>(emptyRevenueProtection());
  const [revCategories, setRevCategories] = useState<RevenueCategory[]>([]);
  const [revSettleFreq, setRevSettleFreq] = useState("monthly");
  const [revSettleDay, setRevSettleDay] = useState("15");
  // מתי משולמת ההתחשבנות — לא רק בחודש שאחרי
  const [revSettleTiming, setRevSettleTiming] = useState("next_month");
  // Recording an investment must not depend on there being a rent addition for
  // it — a landlord often funds fit-out with no monthly addition at all.
  const [hasTI, setHasTI] = useState(false);

  // A <input type="date"> fires onChange on every keystroke, so a user typing
  // 01/07/2026 passes through 0001-07-…, 0022-07-… and so on. Copying those
  // into other fields is what produced contracts dated year 0022.
  function plausibleDate(v: string): boolean {
    if (!v) return false;
    var y = Number(String(v).slice(0, 4));
    return y >= 1900 && y <= 2200;
  }
  const [revReportFreq, setRevReportFreq] = useState("monthly");
  const [revLateHigherIndex, setRevLateHigherIndex] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("checks_advance");
  // תשלום החודש הראשון במעמד החתימה — ביטחון לקיום ההסכם בחוזה עתידי.
  // הסכום קבוע (ללא הצמדה), ומנועי החיוב/המקדמות מדלגים על החודש ששולם.
  const [prepaidOn, setPrepaidOn] = useState(false);
  const [prepaidRent, setPrepaidRent] = useState("");
  const [prepaidMgmt, setPrepaidMgmt] = useState("");
  const [prepaidPaidAt, setPrepaidPaidAt] = useState("");
  // מודל "מכתב דרישות" בסיום ההקמה — נפתח אחרי שמירה מוצלחת
  const [onboard, setOnboard] = useState<{ contractId: string; params: OnboardingParams } | null>(null);
  const [onboardSaving, setOnboardSaving] = useState(false);
  // חיוב ראשון בהעברה/ה"ק: שארית+תקופה יחד (ברירת מחדל) או שארית בנפרד.
  const [firstChargeMode, setFirstChargeMode] = useState("stub_plus_period");
  const [paymentDay, setPaymentDay] = useState("1");
  const [indexMethod, setIndexMethod] = useState("standard");
  const [baseCPI, setBaseCPI] = useState("");
  const [baseCPIDate, setBaseCPIDate] = useState("");
  // The base index auto-fills from the start date as a CONVENIENCE for an
  // untouched field. Once the user has typed a date, pulled an index, or the
  // contract came with one, that is the answer — the default must never write
  // over it. Pressing "משוך מדד" reloads the CPI list, and the auto-fill effect
  // keyed on that list used to re-fire and reset 16.6.2026 to 1.6.2026.
  const [baseCPITouched, setBaseCPITouched] = useState(false);
  const [baseIndexRule, setBaseIndexRule] = useState<BaseIndexRule>({ mode: "fixed", anchor: "actual_handover", offsetMonths: null });
  const [mgmtProtection, setMgmtProtection] = useState<MgmtProtection>(emptyMgmtProtection());
  const [mgmtFeePct, setMgmtFeePct] = useState("");
  // דמי ניהול בשיטת קוסט-פלוס: חלק השוכר בעלות בפועל + אחוז. הסכום למ"ר הוא
  // המקדמה; ההתחשבנות השנתית מוסיפה את המרווח על העלות בפועל.
  const [mgmtCostPlus, setMgmtCostPlus] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");

  // Step 3 — Grace & Increase
  const [hasGrace, setHasGrace] = useState(false);
  const [graceMonths, setGraceMonths] = useState("3");
  // שלב 2: עוד X ימי גרייס הנספרים מפתיחת המושכר (מתום שלב 1).
  const [gracePhase2Days, setGracePhase2Days] = useState("");
  // Fit-out is often agreed in days ("90 ימי התארגנות"), not whole months.
  const [graceUnit, setGraceUnit] = useState<"months"|"days">("months");
  const [graceType, setGraceType] = useState("full");
  const [graceDiscountPct, setGraceDiscountPct] = useState("50");
  // Retail: the fit-out window and the store opening that ends it.
  const [plannedOpening, setPlannedOpening] = useState("");
  // The target opening is normally the end of the fit-out grace: the contract is
  // signed before handover, the grace runs from handover, and the store is due
  // to open when it ends. Derived automatically until the manager sets a
  // different target — from then on it is theirs.
  const [plannedOpeningTouched, setPlannedOpeningTouched] = useState(false);
  const [actualOpening, setActualOpening] = useState("");
  const [graceEndsOnOpening, setGraceEndsOnOpening] = useState(true);
  const [graceMgmtDiscount, setGraceMgmtDiscount] = useState("");
  // "רק לאחר תחילת עבודות השוכר בפועל, או לאחר 90 יום המוקדם מביניהם" — the
  // management discount has its own starting point inside the fit-out window.
  const [mgmtStartsMode, setMgmtStartsMode] = useState<"grace_start"|"works_start_or_days">("grace_start");
  const [mgmtFreeMaxDays, setMgmtFreeMaxDays] = useState("");
  const [worksStartDate, setWorksStartDate] = useState("");
  const [mgmtFreeNotes, setMgmtFreeNotes] = useState("");
  const [latePenType, setLatePenType] = useState("none");
  const [latePenValue, setLatePenValue] = useState("");
  const [latePenGraceDays, setLatePenGraceDays] = useState("0");
  const [latePenNotes, setLatePenNotes] = useState("");
  const [hasIncrease, setHasIncrease] = useState(false);
  const [increaseMode, setIncreaseMode] = useState<"unified" | "per_unit">("unified");
  const [perUnitTiers, setPerUnitTiers] = useState<Record<string, PriceTier[]>>({});
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);

  // CBS fetch state
  const [cbsFetching, setCbsFetching] = useState(false);
  const [cbsFetchedMonth, setCbsFetchedMonth] = useState("");

  // Step 4 — Extension Options
  const [extensionOptions, setExtensionOptions] = useState<ExtensionOption[]>([]);

  // Step 5 — Guarantees
  const [addGuarantee, setAddGuarantee] = useState(false);
  const [guaranteeType, setGuaranteeType] = useState("bank");
  // The primary security is due at a milestone just as often as an additional
  // one is — the editor for the extras had these fields and this did not.
  const [gDelTrigger, setGDelTrigger] = useState("signing");
  const [gDelOffset, setGDelOffset] = useState("");
  const [gDelDate, setGDelDate] = useState("");
  const [gDelCond, setGDelCond] = useState("");
  const [gDelivered, setGDelivered] = useState("");
  const [guaranteeAmt, setGuaranteeAmt] = useState("");
  const [guaranteeActual, setGuaranteeActual] = useState("");
  const [guaranteeBank, setGuaranteeBank] = useState("");
  const [guaranteeEnd, setGuaranteeEnd] = useState("");
  const [guarantors, setGuarantors] = useState<Array<{name: string; id_number: string}>>([]);
  const [guaranteeDocUrl, setGuaranteeDocUrl] = useState("");
  // Additional securities beyond the primary one — most contracts have BOTH a
  // bank guarantee AND a promissory note. Each ticked type is saved as its own
  // guarantee row (open — no amount/expiry).
  const [additionalGuarantees, setAdditionalGuarantees] = useState<ExtraGuarantee[]>([]);
  const [depositCalcMethod, setDepositCalcMethod] = useState<"months_based" | "fixed_amount">("months_based");
  const [depositMonths, setDepositMonths] = useState(3);
  const [depositIncludesMgmt, setDepositIncludesMgmt] = useState(false);
  const [amendmentNotes, setAmendmentNotes] = useState("");

  // The leased area: the selected units' area, falling back to the manually
  // charged area only when no unit is selected yet. Units decide — the header
  // field must never drive a calculation.
  const leasedArea = (function() {
    var sum = 0;
    selSpaces.forEach(function(sid) {
      const sp = spaces.find(function(s) { return s.id === sid; });
      if (sp?.area) sum += Number(sp.area) || 0;
    });
    return sum > 0 ? sum : (Number(chargedArea) || 0);
  })();
  const penaltyPreviewArea = leasedArea;

  // A guaranteed minimum can be agreed either way — ₪65 per m² or a flat
  // ₪26,099 a month — and they are the same fact stated differently. Everything
  // downstream (the step ladder, the option price jumps, the revenue screen's
  // floor) works per m², so a flat sum is converted by dividing by the leased
  // area. Both forms are kept so each screen can show the one that reads best.
  const minRentSqm = (function() {
    const v = Number(minimumRent) || 0;
    if (v <= 0) return 0;
    if (minRentBasis === "per_sqm") return v;
    // Full precision, not 2 decimals: ₪26,099 over 3,728 m² is 7.0008/m², and
    // rounding to 7.00 loses ₪3 a month off a contractual minimum. Screens
    // round for display; the stored figure stays exact.
    return leasedArea > 0 ? Math.round((v / leasedArea) * 1e6) / 1e6 : 0;
  })();
  const minRentMonthly = (function() {
    const v = Number(minimumRent) || 0;
    if (v <= 0) return 0;
    return minRentBasis === "monthly" ? v : Math.round(v * leasedArea * 100) / 100;
  })();

  // When the term runs from a milestone, start_date IS that milestone — it stays
  // the single date every downstream calculation reads, so nothing else has to
  // learn the rule. The end date then follows from the auto-calc below.
  useEffect(() => {
    if (termStartsAt === "start_date") return;
    const t = leaseTerm({
      contract: {
        start_date: startDate || null,
        actual_handover_date: actualHandover || null, planned_handover_date: plannedHandover || null,
        actual_opening_date: actualOpening || null, planned_opening_date: plannedOpening || null,
        opening_rule: openingRuleOn ? "actual_or_days_from_handover" : null,
        opening_max_days_from_handover: Number(openingMaxDays) || null,
        term_starts_at: termStartsAt,
      },
      months: leasePeriodUnit === "years" ? leasePeriodValue * 12 : leasePeriodValue,
    });
    if (!t.start || !t.derived) return;
    const iso = t.start.getFullYear() + "-" + String(t.start.getMonth() + 1).padStart(2, "0") +
      "-" + String(t.start.getDate()).padStart(2, "0");
    if (iso !== startDate) setStartDate(iso);
  }, [termStartsAt, openingRuleOn, openingMaxDays, actualHandover, plannedHandover, actualOpening, plannedOpening, leasePeriodValue, leasePeriodUnit]);

  // === Auto-calculate end date from start + period ===
  useEffect(() => {
    if (startDate && leasePeriodValue > 0) {
      const calc = calculateEndDate(startDate, leasePeriodValue, leasePeriodUnit);
      if (calc) setEndDate(calc);
    }
  }, [startDate, leasePeriodValue, leasePeriodUnit]);

  // === Auto-populate CPI base index from start date (month before start) ===
  // Skipped when the base index is derived from a milestone — there the rule,
  // not the start date, decides the base month.
  useEffect(() => {
    if (baseIndexRule.mode === "derived") return;
    if (baseCPITouched) return;
    if (startDate && cpiRecords.length > 0 && indexMethod !== "none") {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) return;
      // Base index = month before start date
      const baseMonth = start.getMonth(); // 0-indexed, so Jan=0
      const baseYear = baseMonth === 0 ? start.getFullYear() - 1 : start.getFullYear();
      const baseMonthNum = baseMonth === 0 ? 12 : baseMonth;
      const record = cpiRecords.find((r: any) => r.year === baseYear && r.month === baseMonthNum);
      if (record) {
        setBaseCPI(record.value.toString());
        setBaseCPIDate(`${baseYear}-${String(baseMonthNum).padStart(2, "0")}-01`);
      }
    }
  }, [startDate, cpiRecords.length, indexMethod, baseIndexRule.mode, baseCPITouched]);

  // === Auto-calculate option dates ===
  useEffect(() => {
    if (endDate && extensionOptions.length > 0) {
      const updated = calculateOptionDates(endDate, extensionOptions);
      // Only update if dates actually changed to avoid infinite loop
      const needsUpdate = updated.some(
        (u, i) =>
          u.start_date !== extensionOptions[i].start_date ||
          u.end_date !== extensionOptions[i].end_date
      );
      if (needsUpdate) setExtensionOptions(updated);
    }
  }, [endDate, extensionOptions.length, ...extensionOptions.map((o) => o.duration_years || o.duration_months)]);

  // Target opening = handover + grace, unless deliberately overridden.
  useEffect(function () {
    if (plannedOpeningTouched) return;
    if (!hasGrace) {
      // כיבוי הגרייס מנקה יעד פתיחה שנגזר ממנו: בלי זה נשאר יעד-רפאים
      // "מסוף הגרייס" (ברירת המחדל הפנימית — 3 חודשים) שהוצג ואף נשמר
      // בחוזה שאין בו גרייס כלל.
      if (plannedOpening) setPlannedOpening("");
      return;
    }
    var base = actualHandover || plannedHandover || startDate;
    var amount = Number(graceMonths) || 0;
    if (!plausibleDate(base) || amount <= 0) return;
    var d0 = new Date(base);
    var shifted: Date;
    if (graceUnit === "days") {
      shifted = new Date(d0.getTime() + amount * 86400000);
    } else {
      var day = d0.getDate();
      shifted = new Date(d0.getFullYear(), d0.getMonth() + amount, 1);
      var last = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
      shifted.setDate(Math.min(day, last));
    }
    var iso = shifted.getFullYear() + "-" + String(shifted.getMonth() + 1).padStart(2, "0") + "-" + String(shifted.getDate()).padStart(2, "0");
    if (iso !== plannedOpening) setPlannedOpening(iso);
  }, [hasGrace, graceMonths, graceUnit, actualHandover, plannedHandover, startDate, plannedOpeningTouched]);

  // אישור מכתב הדרישות: יוצר את המכתב (עם כותרת החברה, נכנס למסך המכתבים
  // על כל ערוצי השליחה הקיימים) ומבצע את הפעולות בפועל — למשלמי שיקים:
  // רישום שיקי המקדמות עד סוף השנה מאותו חישוב של המכתב; חודש ששולם
  // במעמד החתימה נשמר בסטטוס "שולם" ולא יידרש שוב.
  async function confirmOnboarding() {
    if (!onboard) return;
    setOnboardSaving(true);
    try {
      var ci = await loadCompanyInfo(propertyId);
      var full = { ...onboard.params, companyName: ci.companyName || "", bankLine: ci.bankLine || "" };
      var built = buildOnboardingBody(full);
      var { error: le } = await supabase.from("letters").insert({
        contract_id: onboard.contractId,
        letter_type: "notice",
        title: "השלמת מסמכים ותשלומים — " + (full.tenantName || ""),
        content_json: letterContent(built.body, ci, { kind: "onboarding_requirements", domain: "money" }),
        status: "ready",
      });
      if (le) throw new Error(le.message);
      // בתחילה תלוית אבן-דרך שטרם קרתה אין חודשים לרשום — השורות ייווצרו
      // כשמועד התחילה ייקבע בפועל; התשלום ששולם בחתימה רשום על החוזה
      // והמנוע יצמיד אותו לחודש הראשון האמיתי כשיגיע.
      if (full.paymentMethod === "checks_advance" && !full.milestonePending) {
        var sched = chequeSchedule(full);
        var firstSpace = spaces.find(function (s: any) { return selSpaces.indexOf(s.id) !== -1; });
        if (sched.length > 0 && firstSpace) {
          var rows = sched.map(function (r) {
            var rentPart = r.prepaid ? full.prepaidRent : full.baseRent;
            return {
              contract_id: onboard!.contractId, space_id: firstSpace.id, property_id: propertyId,
              tenant_name: full.tenantName || "—", space_name: full.unitsLabel || firstSpace.space_name || "—",
              year: r.year, period: "חודש " + r.month,
              base_rent: rentPart, indexed_rent: rentPart,
              management_advance: Math.max(0, r.amount - rentPart),
              total_before_vat: r.amount, vat_amount: r.vat, total_with_vat: r.total,
              check_date: r.year + "-" + String(r.month).padStart(2, "0") + "-01",
              status: r.prepaid ? "paid" : "pending",
            };
          });
          var { error: ae } = await supabase.from("advance_payments").insert(rows);
          if (ae) throw new Error("המכתב נוצר, אך רישום המקדמות נכשל: " + ae.message);
        }
      }
      await logAudit({ entity_type: "contract", entity_id: onboard.contractId, action: "onboarding_letter", notes: full.tenantName });
      router.push("/letters?contract=" + onboard.contractId);
    } catch (e: any) {
      alert("שגיאה: " + (e?.message || e));
      setOnboardSaving(false);
    }
  }

  // === Auto-calculate deposit ===
  const baseRent =
    (Number(rentPerSqm) || 0) * (Number(chargedArea) || 0) +
    (Number(investAdd) || 0);
  const mgmtFeeMonthly = (Number(mgmtFeePct) || 0) * (Number(chargedArea) || 0);
  const vat = vatType === "taxable" ? baseRent * (currentVatPct / 100) : 0;
  const totalRent = baseRent + vat;
  const annualRent = baseRent * 12;

  // A guarantee of "N months' rent" needs the rent it is actually measured
  // against. On a turnover lease that is the MINIMUM, not the (empty) per-sqm
  // rent — reading baseRent there left the guarantee holding only the
  // management fee.
  const guaranteeMonthlyRent = guaranteedMonthlyRent({
    rentType, rentPerSqm, area: chargedArea, investmentAddition: investAdd,
    minimumRent, minRentBasis,
  });

  const calculatedDeposit = calculateDepositAmount({
    depositMethod: depositCalcMethod,
    depositMonths,
    fixedAmount: Number(guaranteeAmt) || 0,
    monthlyRent: guaranteeMonthlyRent,
    managementFee: mgmtFeeMonthly,
    includesManagement: depositIncludesMgmt,
    vatPct: vatType === "taxable" ? currentVatPct : 0,
  });

  // Keep guarantee amount in sync when using months_based
  useEffect(() => {
    if (depositCalcMethod === "months_based" && calculatedDeposit > 0) {
      setGuaranteeAmt(calculatedDeposit.toString());
    }
  }, [calculatedDeposit, depositCalcMethod]);

  // === Load reference data ===
  useEffect(() => {
    loadRef();
  }, []);

  // === Load parent contract for amendment pre-fill ===
  useEffect(function() {
    if (!amendmentOfId) return;
    async function loadParent() {
      var { data: c } = await supabase.from("contracts")
        .select("*, tenants(name), properties(name), contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area)), contract_options(id,option_number,duration_months,duration_years,notice_type,notice_days_before_end,rent_mechanism,revenue_pct_tiers,rent_increase_pct,new_rent_value,option_group,exit_points,price_schedule_type,price_tiers,non_exercise_penalty_type,non_exercise_penalty_value,non_exercise_penalty_basis,non_exercise_penalty_months,non_exercise_penalty_indexed,non_exercise_penalty_vat,non_exercise_penalty_days,non_exercise_penalty_notes), guarantees(id,guarantee_type,amount_required,amount_actual,bank,reference_number,end_date,document_url,notes,guarantors,delivery_trigger,delivery_offset_days,delivery_due_date,delivery_condition,delivered_at)")
        .eq("id", amendmentOfId).single();
      if (!c) return;
      setAmendmentParent(c);
      // Count existing amendments to determine next number
      var { count } = await supabase.from("contracts")
        .select("id", { count: "exact", head: true })
        .eq("parent_contract_id", amendmentOfId)
        .eq("is_amendment", true);

      // Pre-fill from parent
      setTenantId(c.tenant_id || "");
      setPropertyId(c.property_id || "");
      setContractType(c.contract_type || "regular");
      // Spaces
      var spIds = (c.contract_spaces || []).map(function(cs: any) { return cs.space_id; });
      setSelSpaces(spIds);
      // Per-unit pricing
      var overrides: Record<string, string> = {};
      var types: Record<string, "per_sqm" | "fixed"> = {};
      (c.contract_spaces || []).forEach(function(cs: any) {
        if (cs.charge_method === "fixed" && cs.fixed_rent) {
          types[cs.space_id] = "fixed";
          overrides[cs.space_id] = String(cs.fixed_rent);
        } else if (cs.price_per_sqm) {
          types[cs.space_id] = "per_sqm";
          overrides[cs.space_id] = String(cs.price_per_sqm);
        }
      });
      setUnitRentOverrides(overrides);
      setUnitRentTypes(types);
      // Dates — amendment starts today, ends same as parent
      setStartDate(new Date().toISOString().split("T")[0]);
      setEndDate(c.end_date || "");
      // Calculate period from today to parent end
      if (c.end_date) {
        var diffMs = new Date(c.end_date).getTime() - new Date().getTime();
        var diffMonths = Math.round(diffMs / (30.44 * 24 * 60 * 60 * 1000));
        if (diffMonths >= 12 && diffMonths % 12 === 0) {
          setLeasePeriodValue(diffMonths / 12);
          setLeasePeriodUnit("years");
        } else {
          setLeasePeriodValue(diffMonths);
          setLeasePeriodUnit("months");
        }
      }
      // Pricing
      setRentPerSqm(c.rent_per_sqm ? String(c.rent_per_sqm) : "");
      setChargedArea(c.charged_area ? String(c.charged_area) : "");
      setInvestAdd(c.investment_addition ? String(c.investment_addition) : "");
      setVatType(c.vat_type || "taxable");
      setPaymentFreq(c.payment_frequency || "monthly");
      // A turnover amendment inherits the parent's terms: type, percentage,
      // its steps and the minimum on the basis it was written in. Without this
      // the amendment came up as a blank fixed-rent contract.
      setRentType(c.rent_type === "revenue_pct" ? "revenue_pct" : "fixed");
      setRevenuePct(c.revenue_pct != null ? String(c.revenue_pct) : "");
      setRevenuePctTiers(pctTiersFromRow(c));
      // minimum_rent is only written when the user chose the flat-sum basis, and
      // min_rent_per_sqm is now derived from it as well — so the flat sum is
      // checked FIRST, or reopening the contract would show the derived per-m²
      // figure instead of the ₪ amount that was actually typed.
      setMinCondOn(c.min_rent_condition_type === "project_occupancy_pct");
      setMinCondPct(c.min_rent_condition_pct != null ? String(c.min_rent_condition_pct) : "");
      setMinCondMetAt(c.min_rent_condition_met_at ? String(c.min_rent_condition_met_at).slice(0, 10) : "");
      setMinCondNotes(c.min_rent_condition_notes || "");
      if (Number(c.minimum_rent) > 0) {
        setMinRentBasis("monthly"); setMinimumRent(String(c.minimum_rent));
      } else if (c.min_rent_per_sqm != null && Number(c.min_rent_per_sqm) > 0) {
        setMinRentBasis("per_sqm"); setMinimumRent(String(c.min_rent_per_sqm));
      }
      setRevMinAdvance(!!c.revenue_minimum_advance);
      setRevProtection(revenueProtectionFromRow(c));
      setRevCategories(revenueCategoriesFromRow(c));
      setRevSettleFreq(c.revenue_settlement_freq || "monthly");
      setRevSettleDay(c.revenue_settlement_day ? String(c.revenue_settlement_day) : "15");
      setRevReportFreq(c.revenue_report_freq || "monthly");
      setRevLateHigherIndex(!!c.revenue_late_report_higher_index);
      setPaymentMethod(c.payment_method || "checks_advance");
      setPaymentDay(c.payment_day ? String(c.payment_day) : "1");
      setIndexMethod(c.indexation_method || "standard");
      setBaseCPI(c.index_base_value ? String(c.index_base_value) : "");
      setTermStartsAt(c.term_starts_at === "opening" || c.term_starts_at === "handover" ? c.term_starts_at : "start_date");
      setOpeningRuleOn(c.opening_rule === "actual_or_days_from_handover");
      setOpeningMaxDays(c.opening_max_days_from_handover != null ? String(c.opening_max_days_from_handover) : "");
      setOpeningDefinition(c.opening_definition || "");
      setBaseCPIDate(c.index_base_date || "");
      if (c.index_base_date) setBaseCPITouched(true);
      setBaseIndexRule(baseIndexRuleFromRow(c));
      setMgmtProtection(mgmtProtectionFromRow(c));
      // Grace — typically no grace for amendment
      setHasGrace(false);
      // Load price tiers
      var { data: tiers } = await supabase.from("contract_price_tiers")
        .select("*").eq("contract_id", amendmentOfId).is("space_id", null).order("tier_number");
      if (tiers && tiers.length > 0) {
        setHasIncrease(true);
        setPriceTiers(tiers.map(function(t: any) {
          return {
            increase_type: t.increase_type ?? "pct",
            increase_value: t.increase_value ?? 0,
            from_year: t.from_year ?? 1,
            to_year: t.to_year ?? 3,
            is_recurring: t.is_recurring ?? false,
            recurring_every_years: t.recurring_every_years ?? null,
            calculated_rent_per_sqm: null,
            notes: t.notes ?? "",
          };
        }));
      }
      // Options
      if (c.contract_options?.length > 0) {
        setExtensionOptions(c.contract_options.map(function(o: any) {
          return {
            duration_years: o.duration_years || (o.duration_months ? o.duration_months / 12 : 0),
            duration_months: o.duration_months || 0,
            notice_type: o.notice_type || "exercise",
            notice_days_before_end: o.notice_days_before_end || 90,
            rent_mechanism: o.rent_mechanism || "no_change",
            revenue_pct_tiers: Array.isArray(o.revenue_pct_tiers) ? o.revenue_pct_tiers : [],
            rent_increase_pct: o.rent_increase_pct || 0,
            new_rent_value: o.new_rent_value || 0,
            auto_extend: false,
            notes: "",
            option_group: o.option_group || null,
            exit_points: o.exit_points || [],
            price_schedule_type: o.price_schedule_type || "inherit",
            price_tiers: o.price_tiers || [],
            non_exercise_penalty: penaltyTermsFromRow(o),
          };
        }));
      }
      // Guarantee
      if (c.guarantees?.length > 0) {
        var g = c.guarantees[0];
        setAddGuarantee(true);
        setGuaranteeType(g.guarantee_type || "bank");
        setGDelTrigger(g.delivery_trigger || "signing");
        setGDelOffset(g.delivery_offset_days != null ? String(g.delivery_offset_days) : "");
        setGDelDate(g.delivery_due_date ? String(g.delivery_due_date).slice(0, 10) : "");
        setGDelCond(g.delivery_condition || "");
        setGDelivered(g.delivered_at ? String(g.delivered_at).slice(0, 10) : "");
        setGuaranteeAmt(g.amount_required ? String(g.amount_required) : "");
        setGuaranteeActual(g.amount_actual ? String(g.amount_actual) : "");
        setGuaranteeBank(g.bank || "");
        setGuaranteeEnd(g.end_date || "");
        setGuaranteeDocUrl(g.document_url || "");
        // Any further guarantee rows → additional securities, with their details.
        setAdditionalGuarantees((c.guarantees as any[]).slice(1).map(extraGuaranteeFromRow));
      }
    }
    loadParent();
  }, [amendmentOfId]);

  useEffect(() => {
    if (propertyId) {
      supabase
        .from("spaces")
        .select("id,space_name,area,status")
        .eq("property_id", propertyId)
        .then(({ data }) => {
          setSpaces(data ?? []);
          setSelSpaces([]);
        });
    }
  }, [propertyId]);

  useEffect(function() {
    if (propertyId) {
      supabase.from("parking_subscriptions").select("id,spot_number,quantity,monthly_fee,vehicle_number,status,tenant_id,contract_id,is_marked,is_included_in_rent,tenants(name)")
        .eq("property_id", propertyId).order("created_at")
        .then(function({ data }) { setParkingSpots(data ?? []); });
    } else {
      setParkingSpots([]);
    }
  }, [propertyId]);

  async function loadRef() {
    const [{ data: t }, { data: p }, { data: cpi }, { data: vat }] = await Promise.all([
      supabase.from("tenants").select("id,name,company_name").order("name"),
      supabase.from("properties").select("id,name,city").order("name"),
      supabase.from("cpi_records").select("year,month,value").order("year", { ascending: false }).order("month", { ascending: false }),
      supabase.from("vat_rates").select("rate_pct,effective_from,effective_to").order("effective_from", { ascending: false }).limit(1),
    ]);
    // SCOPED dropdowns: only tenants/properties within the user's allowed scope.
    var scope = await getScopeIds();
    var tScope = await getTenantScopeIds();
    setTenants(tScope === null ? (t ?? []) : (t ?? []).filter(function(x: any){ return tScope!.indexOf(x.id) !== -1; }));
    setProperties(scopeRows(p ?? [], scope, function(x: any){ return x.id; }));
    setCpiRecords(cpi ?? []);
    if (vat && vat.length > 0) setCurrentVatPct(Number(vat[0].rate_pct));
  }

  async function handleNewTenant(data: any) {
    const { data: inserted, error } = await supabase.from("tenants").insert({
      name: data.legal_name || data.name,
      company_name: data.legal_name || data.name,
      id_number: data.id_number,
      phone: data.phone,
      primary_email: data.primary_email,
      address: data.address,
      notes: data.notes,
    }).select().single();
    if (error) { alert("שגיאה ביצירת שוכר: " + error.message); return; }
    setShowNewTenant(false);
    const { data: list } = await supabase.from("tenants").select("id,name,company_name").order("name");
    // A tenant just created here is intentionally included even for scoped users.
    setTenants(list ?? []);
    if (inserted) setTenantId(inserted.id);
  }

  async function handleNewProperty(data: any) {
    const { data: inserted, error } = await supabase.from("properties").insert({
      name: data.name,
      address: data.address,
      property_type: data.property_type,
      total_rentable_area: data.total_rentable_area || null,
      floors: data.floors || null,
      parking_spaces: data.parking_spaces || null,
      description: data.description || null,
    }).select().single();
    if (error) { alert("שגיאה ביצירת נכס: " + error.message); return; }
    setShowNewProperty(false);
    const { data: list } = await supabase.from("properties").select("id,name,city").order("name");
    setProperties(scopeRows(list ?? [], await getScopeIds(), function(x: any){ return x.id; }).concat(inserted ? [inserted] : []).filter(function(x: any, i: number, arr: any[]){ return arr.findIndex(function(y: any){ return y.id === x.id; }) === i; }));
    if (inserted) setPropertyId(inserted.id);
  }

  async function handleNewUnit() {
    const name = prompt("שם היחידה:");
    if (!name) return;
    const area = prompt("שטח (מ\"ר):");
    const { error } = await supabase.from("spaces").insert({
      property_id: propertyId,
      space_name: name,
      area: area ? Number(area) : null,
      status: "vacant",
    });
    if (error) { alert("שגיאה: " + error.message); return; }
    // Refresh spaces
    const { data: sp } = await supabase.from("spaces").select("id,space_name,area,status").eq("property_id", propertyId);
    setSpaces(sp ?? []);
  }

  const [savingParking, setSavingParking] = useState(false);

  async function handleNewParking() {
    if (savingParking) return; // prevent double-click
    if (!newParkingMarked && !Number(newParkingQty)) { alert("חובה: כמות מקומות"); return; }
    if (newParkingMarked && !newParkingSpot) { alert("חובה: מספרי חניות"); return; }
    setSavingParking(true);
    try {
      const { error } = await supabase.from("parking_subscriptions").insert({
        property_id: propertyId,
        tenant_id: tenantId || null,
        spot_number: newParkingMarked ? newParkingSpot : null,
        quantity: Number(newParkingQty) || 1,
        is_marked: newParkingMarked,
        monthly_fee: Number(newParkingFee) || 0,
        vehicle_number: newParkingVehicle || null,
        is_included_in_rent: newParkingIncluded,
        subscription_type: "monthly",
        status: "active",
      });
      if (error) { alert("שגיאה: " + error.message); return; }
      setShowNewParking(false);
      setNewParkingSpot(""); setNewParkingQty("1"); setNewParkingMarked(false); setNewParkingFee(""); setNewParkingVehicle(""); setNewParkingIncluded(false);
    } finally { setSavingParking(false); }
    await reloadParking();
  }

  async function handleDeleteParking(parkingId: string) {
    if (!confirm("למחוק הקצאת חניה?")) return;
    await supabase.from("parking_subscriptions").delete().eq("id", parkingId);
    await reloadParking();
  }

  async function reloadParking() {
    if (!propertyId) return;
    const { data } = await supabase.from("parking_subscriptions").select("id,spot_number,quantity,monthly_fee,vehicle_number,status,tenant_id,contract_id,is_marked,is_included_in_rent,tenants(name)")
      .eq("property_id", propertyId).order("created_at");
    setParkingSpots(data ?? []);
  }

  async function handleAiExtract(file: File) {
    setAiExtracting(true);
    setAiResult(null);
    let pdfTotalPages = 0;
    try {
      let text = "";
      if (file.name.endsWith(".pdf")) {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pages: string[] = [];
        // Read only the first 40 pages — commercial lease PDFs are often 20-30MB
        // with appended annexes/scans, but the contract TERMS live in the first
        // pages. This keeps extraction fast/cheap without any user action.
        const maxTextPages = Math.min(40, pdf.numPages);
        pdfTotalPages = pdf.numPages;
        for (let i = 1; i <= maxTextPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pages.push(content.items.map((item: any) => item.str).join(" "));
        }
        text = pages.join("\n");
        // Check if text is mostly gibberish (scanned PDF without real text)
        if (text.length < 100 || text.replace(/[^א-תa-zA-Z0-9]/g, "").length < text.length * 0.2) {
          // Scanned PDF — use OCR via Claude Vision
          setAiResult("סורק PDF עם OCR...");
          var imagePages: string[] = [];
          var canvas = document.createElement("canvas");
          var ctx = canvas.getContext("2d");
          // Page scans are sent as JPEG, not PNG: a PNG page is several MB, so
          // 15 of them blew past the serverless request-body limit (HTTP 413).
          // Also stop once the accumulated payload nears the cap, so a heavy
          // scan degrades to fewer pages instead of failing outright.
          var MAX_OCR_BYTES = 3200000; // ~3.2MB of base64, safely under the limit
          var usedBytes = 0;
          var maxOcrPages = Math.min(12, pdf.numPages);
          for (var pi = 1; pi <= maxOcrPages; pi++) {
            var ocrPage = await pdf.getPage(pi);
            var viewport = ocrPage.getViewport({ scale: 1.3 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await ocrPage.render({ canvasContext: ctx!, viewport: viewport }).promise;
            var dataUrl = canvas.toDataURL("image/jpeg", 0.72);
            var b64 = dataUrl.split(",")[1];
            if (usedBytes + b64.length > MAX_OCR_BYTES) break;
            usedBytes += b64.length;
            imagePages.push(b64);
            setAiResult("סורק PDF עם OCR... (" + imagePages.length + " עמודים)");
          }
          if (imagePages.length === 0) throw new Error("לא ניתן להכין עמודים לסריקה");
          var ocrRes = await fetch("/api/extract-contract", {
            method: "POST",
            headers: await authHeaders(),
            body: JSON.stringify({ images: imagePages, mediaType: "image/jpeg" }),
          });
          if (!ocrRes.ok) {
            var oErr: any = null; try { oErr = await ocrRes.json(); } catch (e) {}
            throw new Error(oErr?.error || (ocrRes.status === 413
              ? "המסמך הסרוק כבד מדי לשליחה. נסה קובץ קטן יותר או המר ל-PDF טקסטואלי."
              : "שגיאת OCR (" + ocrRes.status + ")"));
          }
          var ocrData = await ocrRes.json();
          if (ocrData.error) throw new Error(ocrData.error);
          // Store OCR result for the main flow below
          (globalThis as any).__ocrData = ocrData;
        }
      } else if (file.name.match(/\.docx$/i)) {
        const mammoth = await import("mammoth");
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } else if (file.name.match(/\.doc$/i)) {
        alert("קבצי .doc (פורמט ישן) אינם נתמכים.\nנא לשמור את הקובץ כ-.docx ב-Word ולנסות שוב.");
        setAiExtracting(false);
        return;
      } else {
        alert("נתמכים רק קבצי PDF או Word");
        setAiExtracting(false);
        return;
      }

      var data: any;
      var skipApiCall = false;
      // Check if OCR already set the data
      if ((globalThis as any).__ocrData) {
        data = (globalThis as any).__ocrData;
        delete (globalThis as any).__ocrData;
        skipApiCall = true;
      }
      if (!skipApiCall) {
        const res = await fetch("/api/extract-contract", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ text: String(text).substring(0, 200000) }),
        });
        if (!res.ok) {
          var sErr: any = null; try { sErr = await res.json(); } catch (e) {}
          throw new Error(sErr?.error || "שגיאת שרת (" + res.status + ")");
        }
        data = await res.json();
        if (data.error) throw new Error(data.error);
      }
      // Surface page-trim info in the verification summary (client text path).
      if (pdfTotalPages > 40 && data && !data._truncated) data._truncated = { totalPages: pdfTotalPages, keptPages: 40, truncated: true };

      // Auto-fill fields
      let filled = 0;

      // Tenant: match existing or offer to create new with extracted details
      if (data.tenant_name) {
        const match = tenants.find(function(t) {
          return t.name?.includes(data.tenant_name) || t.company_name?.includes(data.tenant_name) ||
                 data.tenant_name.includes(t.name) || data.tenant_name.includes(t.company_name);
        });
        if (match) {
          setTenantId(match.id); filled++;
        } else if (confirm("שוכר \"" + data.tenant_name + "\" לא נמצא במערכת.\nליצור שוכר חדש?")) {
          const { data: inserted } = await supabase.from("tenants").insert({
            name: data.tenant_name,
            company_name: data.tenant_name,
            id_number: data.tenant_id_number || null,
            phone: data.tenant_phone || null,
            primary_email: data.tenant_email || null,
            address: data.tenant_address || null,
          }).select().single();
          if (inserted) {
            const { data: tList } = await supabase.from("tenants").select("id,name,company_name").order("name");
            setTenants(tList ?? []);
            setTenantId(inserted.id);
            filled++;
          }
        }
      }

      // Contract fields
      if (data.start_date) { setStartDate(data.start_date); filled++; }
      if (data.duration_months) { setLeasePeriodValue(data.duration_months); setLeasePeriodUnit("months"); filled++; }
      if (data.rent_per_sqm) { setRentPerSqm(String(data.rent_per_sqm)); filled++; }
      if (data.charged_area) { setChargedArea(String(data.charged_area)); filled++; }
      if (data.investment_addition) { setInvestAdd(String(data.investment_addition)); filled++; }
      if (data.payment_frequency) { setPaymentFreq(data.payment_frequency); filled++; }
      if (data.index_base_date) { setBaseCPIDate(data.index_base_date + "-15"); setBaseCPITouched(true); filled++; }
      if (data.index_base_value) { setBaseCPI(String(data.index_base_value)); filled++; }
      if (data.end_date) { setEndDate(data.end_date); filled++; }
      if (data.investment_amount) { setTiAmount(String(data.investment_amount)); filled++; }
      if (data.investment_description) { setTiDescription(String(data.investment_description)); filled++; }
      if (data.investment_payment_trigger) { setTiPaymentTrigger(String(data.investment_payment_trigger)); filled++; }
      if (data.investment_payment_days) { setTiPaymentDays(String(data.investment_payment_days)); filled++; }
      if (data.investment_requires_invoice === false) setTiRequiresInvoice(false);
      if (data.investment_requires_report === false) setTiRequiresReport(false);
      if (data.rent_type === "revenue") { setRentType("revenue_pct"); filled++; }
      if (data.revenue_pct) { setRevenuePct(String(data.revenue_pct)); filled++; }
      if (data.grace_months != null && data.grace_months !== "") { setGraceMonths(String(data.grace_months)); filled++; }
      if (data.guarantee_type) { setAddGuarantee(true); setGuaranteeType(data.guarantee_type); filled++; }
      if (data.guarantee_amount) { setGuaranteeAmt(String(data.guarantee_amount)); filled++; }
      if (data.guarantee_bank) { setGuaranteeBank(String(data.guarantee_bank)); filled++; }
      if (data.guarantee_expiry) { setGuaranteeEnd(String(data.guarantee_expiry)); filled++; }
      if (data.guarantee_months) { setDepositMonths(Number(data.guarantee_months)); filled++; }
      if (Array.isArray(data.additional_guarantee_types) && data.additional_guarantee_types.length > 0) {
        setAddGuarantee(true);
        setAdditionalGuarantees(
          data.additional_guarantee_types
            .filter(function(x: any) { return x && x !== data.guarantee_type; })
            .map(function(x: any) { return emptyExtraGuarantee(String(x)); })
        );
        filled++;
      }

      // Options: fill only when the user hasn't entered any, so an extraction
      // re-run never overwrites hand-entered terms. Carries the non-exercise
      // compensation clause through when the contract has one.
      if (Array.isArray(data.options) && data.options.length > 0 && extensionOptions.length === 0) {
        setExtensionOptions(data.options.map(function(o: any) {
          const months = Number(o.duration_months) || 0;
          const base = emptyOption(null);
          return {
            ...base,
            duration_months: months || base.duration_months,
            duration_years: months ? Math.round(months / 12 * 100) / 100 : base.duration_years,
            notice_type: o.notice_type === "non_exercise" ? "non_renewal" : "exercise",
            notice_days_before_end: Number(o.notice_days_before_end) || base.notice_days_before_end,
            non_exercise_penalty: penaltyTermsFromRow(o),
          } as ExtensionOption;
        }));
        filled++;
      }

      // Verification summary: list notable extracted values (incl. ones the form
      // doesn't auto-fill) so the user can eyeball what the AI read vs the doc.
      var extra: string[] = [];
      if (data.mgmt_fee_per_sqm) extra.push("דמי ניהול/מ\"ר: " + data.mgmt_fee_per_sqm);
      if (data.vat_type) extra.push("מע\"מ: " + data.vat_type);
      if (data.indexation_method) extra.push("הצמדה: " + data.indexation_method);
      if (data.min_rent_per_sqm) extra.push("שכ\"ד מינ'/מ\"ר: " + data.min_rent_per_sqm);
      if (Array.isArray(data.rent_steps) && data.rent_steps.length) extra.push(data.rent_steps.length + " מדרגות שכ\"ד");
      if (Array.isArray(data.options) && data.options.length) {
        extra.push(data.options.length + " אופציות");
        const withPenalty = data.options.filter(function(o: any) { return o?.non_exercise_penalty_type && o.non_exercise_penalty_type !== "none"; });
        if (withPenalty.length) extra.push("פיצוי אי-מימוש ב-" + withPenalty.length + " אופציות");
      }
      if (Array.isArray(data.guarantors) && data.guarantors.length) extra.push(data.guarantors.length + " ערבים");
      if (data.insurance_requirements && Object.keys(data.insurance_requirements).length) extra.push(Object.keys(data.insurance_requirements).length + " דרישות ביטוח");
      setAiResult(
        "מולאו " + filled + " שדות מהחוזה" + (data.tenant_name ? " | שוכר: " + data.tenant_name : "") +
        (extra.length ? "\nנשלף גם (לבדיקה ידנית): " + extra.join(" · ") : "") +
        (data._truncated ? "\n📄 המסמך נחתך אוטומטית ל-" + data._truncated.keptPages + " עמודים ראשונים (מתוך " + data._truncated.totalPages + ")." : "")
      );
    } catch (e: any) {
      setAiResult("שגיאה: " + (e.message || "לא ניתן לקרוא את הקובץ"));
    } finally {
      setAiExtracting(false);
    }
  }

  function toggleSpace(id: string) {
    setSelSpaces((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    const sp = spaces.find((s) => s.id === id);
    if (sp?.area && !selSpaces.includes(id)) {
      setChargedArea((prev) => (prev ? prev : sp.area.toString()));
    }
  }

  function updateOption(idx: number, field: string, value: any) {
    setExtensionOptions((prev) =>
      prev.map((opt, i) => (i === idx ? { ...opt, [field]: value } : opt))
    );
  }

  function removeOption(idx: number) {
    setExtensionOptions((prev) => prev.filter((_, i) => i !== idx));
  }

  // === Submit ===
  async function handleSubmit() {
    // הסכם חניות: הבסיס לחיוב הוא מנויי החניה — לא נדרש שכ"ד למ"ר/יחידות.
    var tenantParkingRows = parkingSpots.filter(function(p) { return p.tenant_id === tenantId && !p.contract_id; });
    var hasAnyRent = isParkingContract
      ? tenantParkingRows.some(function(p) { return Number(p.monthly_fee) > 0; })
      : (rentType === "revenue_pct" ? !!revenuePct : (rentPerSqm || Object.keys(unitRentOverrides).some(function(k) { return unitRentOverrides[k]; })));
    if (!tenantId || !propertyId || !startDate || !endDate || !hasAnyRent) {
      alert(isParkingContract && !hasAnyRent
        ? "הסכם חניות: הוסף לפחות הקצאת חניה אחת לשוכר (עם דמי חניה) בשלב תנאי השכירות"
        : "נא מלא כל שדות חובה");
      return;
    }
    setSaving(true);
    try {
      // Determine status based on dates
      const today = new Date();
      const start = new Date(startDate);
      const end = new Date(endDate);
      let status = "active";
      if (today < start) status = "future";
      else if (today > end) status = "ended";

      // For future handover: if not yet delivered, status = "upcoming"
      if (hasFutureHandover && !actualHandover) status = "upcoming";

      const insertPayload: any = {
        tenant_id: tenantId,
        property_id: propertyId,
        contract_type: contractType,
        signing_date: signingDate || null,
        planned_handover_date: plannedHandover || null,
        actual_handover_date: actualHandover || null,
        handover_status: hasFutureHandover ? (actualHandover ? "delivered" : "pending") : "not_applicable",
        start_date: startDate || actualHandover || plannedHandover || null,
        end_date: endDate,
        lease_period_value: leasePeriodValue,
        term_starts_at: termStartsAt === "start_date" ? null : termStartsAt,
        opening_rule: openingRuleOn ? "actual_or_days_from_handover" : null,
        opening_max_days_from_handover: openingRuleOn ? (Number(openingMaxDays) || null) : null,
        opening_definition: openingDefinition || null,
        lease_period_unit: leasePeriodUnit,
        rent_type: rentType,
        rent_per_sqm: Number(rentPerSqm) || null,
        revenue_pct: rentType === "revenue_pct" ? Number(revenuePct) || null : null,
        minimum_rent: rentType === "revenue_pct" && minRentBasis === "monthly" ? Number(minimumRent) || 0 : null,
        // The per-sqm floor is what the revenue screen reads; it also rises with
        // the rent steps, so this is the field that makes "המינימום עולה משנה 4" work.
        // Derived from a flat monthly minimum as well (÷ leased area) — the
        // steps, the option price jumps and the revenue floor are all per-m².
        min_rent_per_sqm: rentType === "revenue_pct" && minRentSqm > 0 ? minRentSqm : null,
        min_rent_condition_notes: rentType === "revenue_pct" && Number(revProtection.untilOccupancyPct) > 0 ? (minCondNotes || null) : null,
        revenue_pct_tiers: rentType === "revenue_pct" && revenuePctTiers.length > 0 ? revenuePctTiers : null,
        revenue_report_day: rentType === "revenue_pct" ? Number(revenueReportDay) || 5 : null,
        revenue_minimum_advance: rentType === "revenue_pct" ? revMinAdvance : false,
        ...(rentType === "revenue_pct" ? revenueProtectionToRow(revProtection) : revenueProtectionToRow(null)),
        revenue_categories: rentType === "revenue_pct" ? revCategories.filter(function(c){ return c.name.trim(); }) : [],
        revenue_settlement_freq: rentType === "revenue_pct" ? revSettleFreq : "monthly",
        revenue_settlement_day: rentType === "revenue_pct" ? (Number(revSettleDay) || null) : null,
        revenue_settlement_timing: rentType === "revenue_pct" ? revSettleTiming : null,
        revenue_report_freq: rentType === "revenue_pct" ? revReportFreq : "monthly",
        revenue_late_report_higher_index: rentType === "revenue_pct" ? revLateHigherIndex : false,
        mgmt_included_in_revenue: rentType === "revenue_pct" ? mgmtIncludedInRevenue : false,
        works_start_date: worksStartDate || null,
        charged_area: Number(chargedArea) || null,
        investment_addition: Number(investAdd) || null,
        vat_type: vatType,
        payment_frequency: paymentFreq,
        payment_method: paymentMethod,
        first_charge_mode: (paymentMethod === "bank_transfer" || paymentMethod === "standing_order") ? firstChargeMode : null,
        prepaid_first_month: prepaidOn || null,
        prepaid_first_rent: prepaidOn ? (Number(prepaidRent) || baseRent || null) : null,
        prepaid_first_mgmt: prepaidOn ? (Number(prepaidMgmt) || mgmtFeeMonthly || 0) : null,
        prepaid_first_paid_at: prepaidOn ? (prepaidPaidAt || new Date().toISOString().slice(0, 10)) : null,
        payment_day: Number(paymentDay) || 1,
        early_termination_allowed: earlyTermination,
        termination_notice_days: earlyTermination ? Number(terminationNoticeDays) || 30 : null,
        termination_by: earlyTermination ? terminationBy : null,
        indexation_method: indexMethod,
        index_base_value: baseCPI ? Number(baseCPI) : null,
        index_base_date: baseCPIDate || null,
        ...baseIndexRuleToRow(baseIndexRule),
        ...mgmtProtectionToRow(mgmtProtection),
        index_base_resolved_at: baseIndexRule.mode === "derived" && baseCPIDate ? new Date().toISOString() : null,
        mgmt_fee_per_sqm: isParkingContract ? null : (mgmtFeePct ? Number(mgmtFeePct) : null),
        mgmt_parking_fee_per_spot: mgmtParkingFee ? Number(mgmtParkingFee) : null,
        mgmt_cost_plus_pct: mgmtCostPlus ? Number(mgmtCostPlus) : null,
        document_url: documentUrl || null,
        status,
        // Amendment fields
        ...(amendmentOfId ? {
          parent_contract_id: amendmentOfId,
          is_amendment: true,
          amendment_date: startDate,
          amendment_notes: amendmentNotes || null,
        } : {}),
      };

      // Count amendments to set number
      if (amendmentOfId) {
        var { count: amCount } = await supabase.from("contracts")
          .select("id", { count: "exact", head: true })
          .eq("parent_contract_id", amendmentOfId)
          .eq("is_amendment", true);
        insertPayload.amendment_number = (amCount ?? 0) + 1;
      }

      // Grace
      insertPayload.planned_opening_date = plannedOpening || null;
      insertPayload.actual_opening_date = actualOpening || null;
      insertPayload.late_opening_penalty_type = latePenType === "none" ? null : latePenType;
      insertPayload.late_opening_penalty_value = latePenType === "none" ? null : (Number(latePenValue) || null);
      insertPayload.late_opening_grace_days = latePenType === "none" ? null : (Number(latePenGraceDays) || 0);
      insertPayload.late_opening_penalty_notes = latePenType === "none" ? null : (latePenNotes || null);
      if (hasGrace) {
        insertPayload.grace_months = graceUnit === "months" ? (Number(graceMonths) || null) : null;
        insertPayload.grace_days   = graceUnit === "days"   ? (Number(graceMonths) || null) : null;
        insertPayload.grace_phase2_days = Number(gracePhase2Days) || null;
        insertPayload.grace_type = graceType;
        insertPayload.grace_ends_on_opening = graceEndsOnOpening;
        insertPayload.grace_mgmt_discount_pct = graceMgmtDiscount === "" ? null : (Number(graceMgmtDiscount) || 0);
        insertPayload.mgmt_charge_starts = mgmtStartsMode === "works_start_or_days" ? "works_start_or_days" : null;
        insertPayload.mgmt_free_max_days = mgmtStartsMode === "works_start_or_days" ? (Number(mgmtFreeMaxDays) || null) : null;
        insertPayload.mgmt_free_notes = mgmtStartsMode === "works_start_or_days" ? (mgmtFreeNotes || null) : null;
        insertPayload.grace_discount_pct =
          graceType === "partial" ? Number(graceDiscountPct) || null : null;
      }

      // Annual increase — save legacy fields from first tier for backward compat
      if (hasIncrease && priceTiers.length > 0) {
        const first = priceTiers[0];
        insertPayload.price_increase_type = first.increase_type;
        insertPayload.price_increase_value = first.increase_value || null;
        insertPayload.increase_steps = priceTiers; // full tiers in JSONB for backup
      }

      // Deposit fields
      if (addGuarantee) {
        insertPayload.deposit_calculation_method = depositCalcMethod;
        insertPayload.deposit_includes_mgmt = depositIncludesMgmt;
        // Persist the basis, not just the result — otherwise re-opening the
        // contract defaults back to 3 months and re-saving changes the sum.
        insertPayload.deposit_months = depositCalcMethod === "months_based" ? depositMonths : null;
      }

      // ── Overlap validation: check for active contracts on same spaces ──
      if (selSpaces.length > 0 && !amendmentOfId) {
        var { data: existingCS } = await supabase
          .from("contract_spaces")
          .select("space_id, contracts!inner(id, status, start_date, end_date, is_amendment, tenants(name))")
          .in("space_id", selSpaces)
          .in("contracts.status", ["active", "extended"]);
        var overlapConflicts = (existingCS ?? []).filter(function(o: any) {
          if (o.contracts.is_amendment) return false;
          var oStart = new Date(o.contracts.start_date);
          var oEnd = new Date(o.contracts.end_date);
          return oStart < new Date(endDate) && oEnd > new Date(startDate);
        });
        if (overlapConflicts.length > 0) {
          var conflictNames = overlapConflicts.map(function(o: any) {
            return (o.contracts.tenants?.name || "—") + " (עד " + new Date(o.contracts.end_date).toLocaleDateString("he-IL") + ")";
          });
          var uniqueNames = Array.from(new Set(conflictNames));
          alert("שגיאה: יחידות כבר משויכות לחוזה פעיל חופף:\n" + uniqueNames.join("\n"));
          setSaving(false);
          return;
        }
      }

      const { data: contract, error: ce } = await supabase
        .from("contracts")
        .insert(insertPayload)
        .select()
        .single();
      if (ce) throw new Error(ce.message);
      if (!contract?.id) throw new Error("שגיאה בשמירת חוזה");

      // Contract ↔ Spaces (with per-unit rent overrides — per_sqm or fixed)
      if (selSpaces.length > 0) {
        await supabase.from("contract_spaces").insert(
          selSpaces.map((sid) => {
            var rType = unitRentTypes[sid] || "per_sqm";
            var rVal = unitRentOverrides[sid] ? Number(unitRentOverrides[sid]) : null;
            return {
              contract_id: contract.id,
              space_id: sid,
              price_per_sqm: rType === "per_sqm" ? (rVal ?? Number(rentPerSqm) ?? null) : null,
              fixed_rent: rType === "fixed" ? rVal : null,
              charge_method: rType,
            };
          })
        );
        await supabase.from("spaces").update({ status: "occupied" }).in("id", selSpaces);
      }

      // Link parking spots to this contract (ones created during wizard for this tenant+property)
      if (tenantId && propertyId) {
        await supabase.from("parking_subscriptions")
          .update({ contract_id: contract.id })
          .eq("property_id", propertyId)
          .eq("tenant_id", tenantId)
          .is("contract_id", null);
      }

      // contract_price_tiers is UNIQUE(contract_id, tier_number), and BOTH the
      // options' tiers and the contract's own tiers live in it. Numbering each
      // block from 1 collided, and the second insert (the contract's own rent
      // steps) was rejected — silently, since the error was never read. One
      // running counter for the whole contract.
      var tierSeq = 0;
      var nextTierNumber = function () { tierSeq++; return tierSeq; };

      // Extension Options
      if (extensionOptions.length > 0) {
        const optionsToInsert = extensionOptions.map((opt, i) => ({
          contract_id: contract.id,
          option_number: i + 1,
          duration_months: opt.duration_months,
          duration_years: opt.duration_years || null,
          start_date: opt.start_date,
          end_date: opt.end_date,
          notice_type: opt.notice_type,
          notice_days_before_end: opt.notice_days_before_end,
          rent_mechanism: opt.rent_mechanism,
          revenue_pct_tiers: (opt.revenue_pct_tiers && opt.revenue_pct_tiers.length > 0) ? opt.revenue_pct_tiers : null,
          new_rent_value: opt.new_rent_value,
          rent_increase_pct: opt.rent_increase_pct,
          auto_extend: opt.auto_renewal,
          status: "pending",
          notes: opt.notes || null,
          price_schedule_type: opt.price_schedule_type || "inherit",
          price_tiers: opt.price_schedule_type === "custom" ? opt.price_tiers : [],
          option_group: opt.option_group || null,
          exit_points: opt.exit_points?.length > 0 ? opt.exit_points : [],
          ...penaltyTermsToRow(opt.non_exercise_penalty),
          cancels_revenue_protection: !!(opt as any).cancels_revenue_protection,
        }));
        const { data: insertedOpts } = await supabase.from("contract_options").insert(optionsToInsert).select("id,option_number");

        // Save option-level price tiers to contract_price_tiers
        if (insertedOpts) {
          for (const dbOpt of insertedOpts) {
            const uiOpt = extensionOptions[dbOpt.option_number - 1];
            if (uiOpt?.price_schedule_type === "custom" && uiOpt.price_tiers?.length > 0) {
              const optPreviews = calculateTierPreviews(uiOpt.price_tiers, Number(rentPerSqm) || 0);
              await supabase.from("contract_price_tiers").insert(
                optPreviews.map((tier, i) => ({
                  contract_id: contract.id,
                  option_id: dbOpt.id,
                  tier_number: nextTierNumber(),
                  start_date: uiOpt.start_date,
                  end_date: uiOpt.end_date,
                  increase_type: tier.increase_type,
                  increase_value: tier.increase_value || 0,
                  is_recurring: tier.is_recurring,
                  recurring_every_years: tier.recurring_every_years,
                  from_year: tier.from_year,
                  to_year: tier.to_year,
                  price_per_sqm: tier.calculated_rent_per_sqm,
                  fixed_amount: tier.increase_type === "fixed_total" ? tier.increase_value : null,
                  calculated_rent_per_sqm: tier.calculated_rent_per_sqm,
                  notes: tier.notes || null,
                }))
              );
            }
          }
        }
      }

      // Guarantee
      if (addGuarantee && (guaranteeAmt || guaranteeType === "promissory_note" || guaranteeType === "cash")) {
        var noExpiry = guaranteeType === "promissory_note" || guaranteeType === "cash";
        var validGuarantors = guarantors.filter(function(g){return g.name || g.id_number;});
        await supabase.from("guarantees").insert({
          contract_id: contract.id,
          guarantee_type: guaranteeType,
          delivery_trigger: gDelTrigger || "signing",
          delivery_offset_days: gDelOffset ? Number(gDelOffset) : null,
          delivery_due_date: gDelDate || null,
          delivery_condition: gDelCond || null,
          delivered_at: gDelivered || null,
          amount_required: guaranteeAmt ? Number(guaranteeAmt) : null,
          amount_actual: guaranteeActual ? Number(guaranteeActual) : null,
          bank: guaranteeBank || null,
          end_date: noExpiry ? null : (guaranteeEnd || null),
          document_url: guaranteeDocUrl || null,
          guarantors: guaranteeType === "promissory_note" && validGuarantors.length > 0 ? validGuarantors : null,
          // Keep how the amount was derived, exactly as the additional
          // securities do — otherwise this one reopens without its basis.
          deposit_calc_method: depositCalcMethod,
          deposit_months: depositCalcMethod === "months_based" ? depositMonths : null,
          deposit_includes_mgmt: depositCalcMethod === "months_based" ? depositIncludesMgmt : null,
          status: "active",
        });
      }

      // Construction investment (השקעות בינוי) — store the itemised record +
      // reimbursement terms alongside the contract's monthly rent addition.
      // An investment is worth recording on its own — the monthly addition may
      // legitimately be zero.
      if (Number(tiAmount) > 0 || tiDescription || Number(investAdd) > 0) {
        await supabase.from("contract_ti").insert({
          contract_id: contract.id,
          ti_type: "one_time",
          description: tiDescription || null,
          ti_amount: Number(tiAmount) || 0,
          recovery_method: "monthly_addition",
          recovery_amount_monthly: Number(investAdd) || null,
          recovery_start_date: startDate || actualHandover || plannedHandover || null,
          recovery_end_date: endDate || null,
          payment_trigger: tiPaymentTrigger || null,
          payment_days_after: tiPaymentDays ? Number(tiPaymentDays) : null,
          payment_installments: tiPaymentTrigger === "installments" && tiInstallments ? Number(tiInstallments) : null,
          requires_report: tiRequiresReport,
          requires_invoice: tiRequiresInvoice,
          payment_notes: tiPaymentNotes || null,
          ...clawbackTermsToRow({
            months: Number(tiClawbackMonths) || null,
            indexed: tiClawbackIndexed,
            vat: tiClawbackVat,
            indexFrom: null,
            notes: tiClawbackNotes || null,
          }),
        });
      }

      // Additional securities (e.g. שטר חוב alongside a bank guarantee) — each
      // saved as its own guarantee row with the details entered in the form.
      if (addGuarantee && additionalGuarantees.length > 0) {
        // No type filtering — a contract can hold two securities of the same
        // kind (e.g. two bank guarantees); dropping them would lose data.
        var extraGuar = additionalGuarantees.map(function(e){ return { ...extraGuaranteeToRow(e, contract.id), status: "active" }; });
        if (extraGuar.length > 0) {
          var { error: exErr } = await supabase.from("guarantees").insert(extraGuar);
          if (exErr) alert("שגיאה בשמירת ביטחונות נוספים: " + exErr.message);
        }
      }

      // Price Tiers → save ORIGINAL tiers (with is_recurring intact)
      if (hasIncrease) {
        const contractStart = new Date(startDate);
        var allTiersToInsert: any[] = [];

        if (increaseMode === "per_unit" && Object.keys(perUnitTiers).length > 0) {
          // Per-unit mode: save each unit's tiers with space_id
          var globalTierNum = 0; // running counter (UNIQUE on contract_id + tier_number)
          Object.entries(perUnitTiers).forEach(function([sid, uTiers]) {
            if (!uTiers || uTiers.length === 0) return;
            var rVal = Number(unitRentOverrides[sid]) || Number(rentPerSqm) || 0;
            var uPreviews = calculateTierPreviews(uTiers, rVal);
            uTiers.forEach(function(tier, i) {
              globalTierNum++;
              var preview = uPreviews.find(function(t) { return t.from_year === tier.from_year && t.to_year === tier.to_year; }) || uPreviews[i];
              var tierStart = new Date(contractStart);
              tierStart.setFullYear(tierStart.getFullYear() + tier.from_year - 1);
              var tierEnd = new Date(contractStart);
              tierEnd.setFullYear(tierEnd.getFullYear() + tier.to_year);
              allTiersToInsert.push({
                contract_id: contract.id,
                space_id: sid,
                tier_number: nextTierNumber(),
                start_date: tierStart.toISOString().split("T")[0],
                end_date: tierEnd.toISOString().split("T")[0],
                increase_type: tier.increase_type,
                increase_value: tier.increase_value || 0,
                is_recurring: tier.is_recurring ?? false,
                recurring_every_years: tier.recurring_every_years ?? null,
                from_year: tier.from_year,
                to_year: tier.to_year,
                price_per_sqm: preview?.calculated_rent_per_sqm ?? null,
                fixed_amount: tier.increase_type === "fixed_total" ? tier.increase_value : null,
                calculated_rent_per_sqm: preview?.calculated_rent_per_sqm ?? null,
                notes: tier.notes || null,
              });
            });
          });
        } else if (priceTiers.length > 0) {
          // Unified mode: save without space_id
          var tiersWithPreviews = calculateTierPreviews(priceTiers, Number(rentPerSqm) || 0);
          priceTiers.forEach(function(tier, i) {
            var preview = tiersWithPreviews.find(function(t) { return t.from_year === tier.from_year && t.to_year === tier.to_year; }) || tiersWithPreviews[i];
            var tierStart = new Date(contractStart);
            tierStart.setFullYear(tierStart.getFullYear() + tier.from_year - 1);
            var tierEnd = new Date(contractStart);
            tierEnd.setFullYear(tierEnd.getFullYear() + tier.to_year);
            allTiersToInsert.push({
              contract_id: contract.id,
              tier_number: nextTierNumber(),
              start_date: tierStart.toISOString().split("T")[0],
              end_date: tierEnd.toISOString().split("T")[0],
              increase_type: tier.increase_type,
              increase_value: tier.increase_value || 0,
              is_recurring: tier.is_recurring ?? false,
              recurring_every_years: tier.recurring_every_years ?? null,
              from_year: tier.from_year,
              to_year: tier.to_year,
              price_per_sqm: tier.increase_type === "fixed_total" ? null : (preview?.calculated_rent_per_sqm ?? null),
              fixed_amount: tier.increase_type === "fixed_total" ? tier.increase_value : null,
              calculated_rent_per_sqm: preview?.calculated_rent_per_sqm ?? null,
              notes: tier.notes || null,
            });
          });
        }

        if (allTiersToInsert.length > 0) {
          var { error: tierErr } = await supabase.from("contract_price_tiers").insert(allTiersToInsert);
          if (tierErr) alert("שגיאה בשמירת מדרגות שכ\"ד: " + tierErr.message);
        }
      }

      await logAudit({
        entity_type: "contract",
        entity_id: contract.id,
        action: "create",
        notes: tenants.find((t) => t.id === tenantId)?.name,
      });
      // בסיום ההקמה: הצעת "מכתב דרישות" לשוכר (שיקים / ערבות / חודש ראשון
      // ששולם / פרטי העברה) + ביצוע הפעולות בפועל — במקום ניווט מיידי.
      var obTenant = tenants.find((t) => t.id === tenantId);
      var obUnits = spaces.filter(function (s: any) { return selSpaces.indexOf(s.id) !== -1; })
        .map(function (s: any) { return s.space_name; }).filter(Boolean).join(", ");
      setOnboard({
        contractId: contract.id,
        params: {
          tenantName: obTenant?.name || "",
          unitsLabel: obUnits,
          startDate: startDate,
          paymentMethod: paymentMethod,
          baseRent: baseRent,
          mgmtMonthly: mgmtFeeMonthly,
          vatPct: vatType === "taxable" ? currentVatPct : 0,
          prepaidFirstMonth: prepaidOn,
          prepaidRent: Number(prepaidRent) || baseRent,
          prepaidMgmt: Number(prepaidMgmt) || mgmtFeeMonthly || 0,
          guaranteeType: addGuarantee ? guaranteeType : null,
          guaranteeAmount: Number(guaranteeAmt) || 0,
          companyName: "",
          // תחילה תלוית אבן-דרך שטרם קרתה — לוח השיקים ייקבע במסירה/פתיחה בפועל
          milestonePending: termStartsAt === "handover" ? !actualHandover
            : termStartsAt === "opening" ? !actualOpening : false,
          milestoneLabel: termStartsAt === "opening" ? "פתיחת המושכר" : "מסירת החזקה",
        },
      });
    } catch (e: any) {
      alert("שגיאה: " + e?.message);
    } finally {
      setSaving(false);
    }
  }

  const tenant = tenants.find((t) => t.id === tenantId);
  const property = properties.find((p) => p.id === propertyId);

  return (
    <div dir="rtl" className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">{amendmentOfId ? "תוספת להסכם" : "חוזה חדש"}</h1>
      </div>

      {/* Amendment banner */}
      {amendmentOfId && amendmentParent && (
        <div className="rounded-xl border-2 border-yellow-400 bg-yellow-50 p-4 mb-6">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📝</span>
            <div>
              <div className="text-sm font-bold text-yellow-800">
                תוספת להסכם של {amendmentParent.tenants?.name || tenants.find(function(t) { return t.id === tenantId; })?.name || ""}
              </div>
              <div className="text-xs text-yellow-600">
                נכס: {amendmentParent.properties?.name || properties.find(function(p) { return p.id === propertyId; })?.name || ""}
                {" | "}חוזה מקורי: {amendmentParent.start_date ? new Date(amendmentParent.start_date).toLocaleDateString("he-IL") : ""} — {amendmentParent.end_date ? new Date(amendmentParent.end_date).toLocaleDateString("he-IL") : ""}
              </div>
              <div className="text-xs text-yellow-700 mt-1">שנה את הנתונים הרלוונטיים — יחידות, מחירים, תקופה, אופציות</div>
            </div>
          </div>
        </div>
      )}

      {/* Steps */}
      <div className="flex gap-0 mb-8">
        {STEPS.map((s, i) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <div key={s.id} className="flex-1 flex items-center">
              <div
                className={
                  "flex items-center gap-2 cursor-pointer " +
                  (active ? "" : "opacity-50")
                }
                onClick={() => {
                  if (s.id < step) setStep(s.id);
                }}
              >
                <div
                  className={
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-all " +
                    (done
                      ? "bg-green-500 text-white"
                      : active
                        ? "bg-blue-600 text-white"
                        : "bg-slate-200 text-slate-500")
                  }
                >
                  {done ? "✓" : s.icon}
                </div>
                <span
                  className={
                    "text-xs font-semibold hidden sm:block " +
                    (active ? "text-blue-700" : "text-slate-400")
                  }
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={
                    "flex-1 h-px mx-2 " +
                    (step > s.id ? "bg-green-400" : "bg-slate-200")
                  }
                />
              )}
            </div>
          );
        })}
      </div>

      {/* AI Contract Reader */}
        <div className="rounded-2xl border border-dashed border-blue-300 bg-blue-50/50 p-4 mb-4">
          <div className="flex items-center gap-3">
            <label className="flex-1 cursor-pointer">
              <input type="file" accept=".pdf,.doc,.docx" className="hidden"
                onChange={function(e) { var f = e.target.files?.[0]; if (f) handleAiExtract(f); }}
                disabled={aiExtracting} />
              <div className="flex items-center gap-2 text-blue-700 hover:text-blue-800">
                <span className="text-xl">📄</span>
                <span className="font-bold text-sm">קרא חוזה (PDF / Word)</span>
                <span className="text-xs text-blue-500">— מילוי אוטומטי בעזרת AI</span>
              </div>
            </label>
            {aiExtracting && <span className="text-xs text-blue-600 animate-pulse">קורא...</span>}
            {aiResult && <span className={"text-xs font-semibold " + (aiResult.startsWith("שגיאה") ? "text-red-600" : "text-green-600")}>{aiResult}</span>}
          </div>
        </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        {/* STEP 1 — שוכר ונכס */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 text-lg mb-4">
              👤 שוכר ונכס
            </h2>

            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-700">
                סוג חוזה
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 sm:grid-cols-5 gap-2">
                {CONTRACT_TYPES.map((ct) => (
                  <button
                    key={ct.v}
                    type="button"
                    onClick={() => setContractType(ct.v)}
                    className={
                      "rounded-lg border p-2 text-center text-xs transition-all " +
                      (contractType === ct.v
                        ? "border-blue-500 bg-blue-50 font-bold text-blue-700"
                        : "border-slate-200 hover:bg-slate-50")
                    }
                  >
                    {ct.l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                שוכר *
              </label>
              <div className="flex gap-2">
                <select
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className={ic + " flex-1"}
                >
                  <option value="">-- בחר שוכר --</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.company_name ? " — " + t.company_name : ""}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setShowNewTenant(true)}
                  className="rounded-lg bg-green-600 text-white px-3 py-2 text-xs font-bold hover:bg-green-700 whitespace-nowrap">
                  + שוכר חדש
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                נכס *
              </label>
              <div className="flex gap-2">
                <select
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  className={ic + " flex-1"}
                >
                  <option value="">-- בחר נכס --</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.city ? " — " + p.city : ""}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setShowNewProperty(true)}
                  className="rounded-lg bg-green-600 text-white px-3 py-2 text-xs font-bold hover:bg-green-700 whitespace-nowrap">
                  + נכס חדש
                </button>
              </div>
            </div>

            {propertyId && isParkingContract && (
              <div className="rounded-xl border-2 border-blue-200 bg-blue-50/40 p-3 text-xs text-blue-800">
                🅿️ <b>הסכם להשכרת חניות בלבד</b> — אין בחירת יחידות ואין שטח במ&quot;ר.
                הקצאת החניות ודמי החניה יוזנו בשלב &quot;תנאי שכירות&quot;, והחיוב ייגזר מהן
                (כולל הצמדה, מדרגות ואופציות אם יוגדרו).
              </div>
            )}
            {propertyId && !isParkingContract && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    שטחים משויכים לחוזה
                  </label>
                  <button type="button" onClick={handleNewUnit}
                    className="rounded-lg bg-green-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-green-700">
                    + יחידה חדשה
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {spaces.map((s) => {
                    const sel = selSpaces.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSpace(s.id)}
                        className={
                          "rounded-lg border p-2 text-center text-xs transition-all " +
                          (sel
                            ? "border-blue-500 bg-blue-50 font-bold text-blue-700"
                            : s.status === "occupied" && !amendmentOfId
                              ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                              : "border-slate-200 hover:bg-slate-50")
                        }
                        disabled={s.status === "occupied" && !sel && !amendmentOfId}
                      >
                        <div className="font-semibold">{s.space_name}</div>
                        {s.area && (
                          <div className="text-slate-400">{s.area} מ&quot;ר</div>
                        )}
                        <div
                          className={
                            "text-xs " +
                            (s.status === "occupied"
                              ? "text-red-400"
                              : "text-green-500")
                          }
                        >
                          {s.status === "occupied" ? "מושכרת" : "פנויה"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 2 — תנאי שכירות */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 text-lg mb-4">
              📋 תנאי שכירות
            </h2>

            {/* Future handover toggle */}
            <div className="flex items-center gap-2 mb-2">
              <input type="checkbox" id="futureHandover" checked={hasFutureHandover}
                onChange={(e) => setHasFutureHandover(e.target.checked)} className="w-4 h-4" />
              <label htmlFor="futureHandover" className="text-xs font-semibold text-slate-700">חוזה עם תהליך מסירה (נכס בבניה / מסירה עתידית)</label>
            </div>

            {hasFutureHandover && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 mb-3 space-y-3">
                <div className="text-xs font-bold text-amber-800">📋 פרטי מסירה</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-slate-600">תאריך חתימה</label>
                    <input type="date" value={signingDate} onChange={(e) => setSigningDate(e.target.value)} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-slate-600">יעד מסירה</label>
                    <input type="date" value={plannedHandover}
                      onChange={(e) => { setPlannedHandover(e.target.value); if (plausibleDate(e.target.value) && !startDate && !actualHandover) setStartDate(e.target.value); }}
                      className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-slate-600">מסירה בפועל</label>
                    <input type="date" value={actualHandover}
                      onChange={(e) => { setActualHandover(e.target.value); if (plausibleDate(e.target.value) && !startDate) setStartDate(e.target.value); }}
                      className={ic} />
                  </div>
                </div>
                <div className="text-[10px] text-amber-600">
                  {!actualHandover ? "⏳ טרם נמסר — תקופת השכירות תתחיל ביום המסירה בפועל" :
                    "✅ נמסר — תחילת השכירות: " + new Date(actualHandover).toLocaleDateString("he-IL")}
                </div>
                {!actualHandover && plannedHandover && (
                  <div className="text-[10px] text-amber-700">
                    עד למסירה בפועל, תחילת השכירות מחושבת לפי יעד המסירה ({new Date(plannedHandover).toLocaleDateString("he-IL")}) — עדכן את &quot;מסירה בפועל&quot; ביום המסירה והתאריכים יתעדכנו.
                  </div>
                )}
              </div>
            )}

            {/* Date + Period → auto end date */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  {hasFutureHandover ? "תחילת שכירות (מיום מסירה) *" : "תחילת חוזה *"}
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={ic}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    תקופה *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={leasePeriodValue}
                    onChange={(e) =>
                      setLeasePeriodValue(Number(e.target.value) || 0)
                    }
                    className={ic}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    יחידה
                  </label>
                  <select
                    value={leasePeriodUnit}
                    onChange={(e) =>
                      setLeasePeriodUnit(
                        e.target.value as "months" | "years"
                      )
                    }
                    className={ic}
                  >
                    <option value="months">חודשים</option>
                    <option value="years">שנים</option>
                  </select>
                </div>
              </div>

              {/* From WHAT does the term run? A shop's lease usually starts at
                  the opening, and the end date is then derived, not typed. */}
              <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 space-y-2">
                <div className="text-xs font-bold text-violet-800">🗓 תקופת השכירות מתחילה מ־</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: "start_date", l: "תאריך שהוזן", d: "כמו עד היום" },
                    { v: "handover", l: "מועד המסירה", d: "מיום מסירת החזקה" },
                    { v: "opening", l: "פתיחת המושכר", d: "המועד נגזר" },
                  ].map(function(o) {
                    return (
                      <button key={o.v} type="button" onClick={function(){ setTermStartsAt(o.v as any); if (o.v === "opening") setOpeningRuleOn(true); }}
                        className={"rounded-lg border px-2 py-2 text-[11px] font-bold text-right " + (termStartsAt === o.v ? "border-violet-500 bg-white text-violet-800" : "border-slate-200 text-slate-500")}>
                        {o.l}
                        <div className="font-normal text-[10px] text-slate-500">{o.d}</div>
                      </button>
                    );
                  })}
                </div>

                {termStartsAt === "opening" && (
                  <>
                    <label className="flex items-start gap-2 text-[11px] text-slate-700">
                      <input type="checkbox" checked={openingRuleOn} onChange={(e) => setOpeningRuleOn(e.target.checked)} className="rounded mt-0.5" />
                      <span>
                        <b>מועד הפתיחה מוגדר בהסכם</b> — המוקדם מבין הפתיחה בפועל לקהל הרחב לבין מספר ימים ממועד המסירה.
                        כך שוכר שאינו פותח אינו דוחה את תחילת התקופה.
                      </span>
                    </label>
                    {openingRuleOn && (
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-slate-700">ולא יאוחר מ־ (ימים ממועד המסירה)</label>
                        <input type="number" min="0" max="730" value={openingMaxDays} placeholder="למשל 60"
                          onChange={(e) => setOpeningMaxDays(e.target.value)} className={ic} />
                      </div>
                    )}
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-700">הגדרת &quot;מועד פתיחת המושכר&quot; כלשונה בהסכם</label>
                      <textarea value={openingDefinition} onChange={(e) => setOpeningDefinition(e.target.value)} rows={2}
                        className={ic} placeholder="פתיחת המושכר תהא כשהמושכר מוכן על ציודו ומתקניו … ולא יאוחר מתום שישים (60) ימים ממועד מסירת החזקה במושכר." />
                    </div>
                  </>
                )}

                {/* What the rule actually produces — the same function the
                    billing will use, so the form cannot promise otherwise. */}
                {termStartsAt !== "start_date" && (function(){
                  var draft = {
                    start_date: startDate || null,
                    actual_handover_date: actualHandover || null, planned_handover_date: plannedHandover || null,
                    actual_opening_date: actualOpening || null, planned_opening_date: plannedOpening || null,
                    opening_rule: openingRuleOn ? "actual_or_days_from_handover" : null,
                    opening_max_days_from_handover: Number(openingMaxDays) || null,
                    term_starts_at: termStartsAt, lease_period_unit: leasePeriodUnit,
                  };
                  var t = leaseTerm({ contract: draft, months: leasePeriodUnit === "years" ? leasePeriodValue * 12 : leasePeriodValue });
                  var op = effectiveOpeningDate(draft);
                  return (
                    <div className="rounded-lg bg-white border border-violet-200 p-2.5 text-[11px] text-violet-900 space-y-0.5">
                      {termStartsAt === "opening" && <div>מועד הפתיחה: <b>{describeOpening(op)}</b></div>}
                      <div>{describeLeaseTerm(t)}</div>
                      {t.end && <div className="text-slate-500">תאריך הסיום נגזר מהמועד הזה ויתעדכן כשיוזן מועד הפתיחה בפועל.</div>}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* End date — auto-calculated OR manual override */}
            {endDate && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm text-green-700 font-semibold">תאריך סיום</span>
                  <span className="text-xs text-green-500 mr-2">(מחושב — ניתן לשנות ידנית)</span>
                </div>
                <input type="date" value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded border border-green-300 bg-white px-3 py-1.5 text-sm font-bold text-green-800" />
              </div>
            )}

            {/* Rent type toggle — a parking-only agreement has neither: its
                base is the parking allocations below. */}
            {isParkingContract ? (
              <div className="rounded-xl border-2 border-blue-300 bg-blue-50/50 p-3 mb-3 text-xs text-blue-800">
                🅿️ <b>הסכם חניות</b> — דמי השכירות הם סך דמי החניה של המנויים שבהמשך המסך.
                הצמדה למדד, מדרגות מחיר ואופציות חלות עליהם כרגיל.
              </div>
            ) : (
            <div className="flex gap-2 mb-3">
              <button type="button" onClick={() => setRentType("fixed")}
                className={"rounded-lg border px-4 py-2 text-sm font-bold transition-all " +
                  (rentType === "fixed" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                💰 שכ&quot;ד קבוע (למ&quot;ר / סכום)
              </button>
              <button type="button" onClick={() => setRentType("revenue_pct")}
                className={"rounded-lg border px-4 py-2 text-sm font-bold transition-all " +
                  (rentType === "revenue_pct" ? "border-purple-500 bg-purple-50 text-purple-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                📊 אחוז ממחזור (פדיון)
              </button>
            </div>
            )}

            {/* Revenue-based rent fields */}
            {rentType === "revenue_pct" && (
              <div className="rounded-xl border-2 border-purple-200 bg-purple-50/30 p-4 mb-4 space-y-3">
                <div className="text-sm font-bold text-purple-800">📊 שכ&quot;ד לפי אחוז ממחזור</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-purple-700">אחוז מהפדיון (%) *</label>
                    <input type="number" step="0.1" value={revenuePct} onChange={(e) => setRevenuePct(e.target.value)}
                      placeholder="12" className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-purple-700">
                      שכ&quot;ד מינימום {minRentBasis === "per_sqm" ? '(₪ למ"ר לחודש)' : "(₪ לחודש)"}
                    </label>
                    <div className="flex gap-1 mb-1">
                      <button type="button" onClick={() => setMinRentBasis("per_sqm")}
                        className={"rounded border px-2 py-1 text-xs " + (minRentBasis === "per_sqm" ? "border-purple-500 bg-purple-50 font-bold text-purple-700" : "border-slate-200 text-slate-500")}>
                        📐 למ&quot;ר
                      </button>
                      <button type="button" onClick={() => setMinRentBasis("monthly")}
                        className={"rounded border px-2 py-1 text-xs " + (minRentBasis === "monthly" ? "border-purple-500 bg-purple-50 font-bold text-purple-700" : "border-slate-200 text-slate-500")}>
                        💰 סכום לחודש
                      </button>
                    </div>
                    <input type="number" step="0.01" value={minimumRent} onChange={(e) => setMinimumRent(e.target.value)}
                      placeholder="0 = ללא מינימום" className={ic} />
                    <div className="text-xs text-purple-500 mt-0.5">
                      0 = ללא מינימום, רק אחוז ממחזור
                      {Number(minimumRent) > 0 && leasedArea > 0 && (
                        minRentBasis === "per_sqm"
                          ? <span> · {fmtMoney(minRentMonthly)}/חודש ל-{leasedArea.toLocaleString("he-IL")} מ&quot;ר</span>
                          : <span> · {fmtMoney(minRentSqm)}/מ&quot;ר לחודש ({leasedArea.toLocaleString("he-IL")} מ&quot;ר)</span>
                      )}
                      {Number(minimumRent) > 0 && minRentBasis === "monthly" && leasedArea <= 0 && (
                        <span className="text-red-600"> · בחר יחידות כדי לגזור מינימום למ&quot;ר</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-purple-700">יום הגשת דו&quot;ח פדיון</label>
                    <input type="number" min="1" max="28" value={revenueReportDay}
                      onChange={(e) => setRevenueReportDay(e.target.value)} className={ic} />
                  </div>
                  <div className="col-span-2 rounded-lg border border-purple-200 bg-white/60 p-2.5">
                    <label className="flex items-start gap-2 text-xs text-slate-700">
                      <input type="checkbox" checked={revMinAdvance}
                        onChange={(e) => setRevMinAdvance(e.target.checked)} className="rounded mt-0.5" />
                      <span>
                        <b>השוכר משלם מקדמת מינימום מדי חודש</b> — ובהתחשבנות נגבית רק ההשלמה לאחוז מהפדיון.
                        <span className="block text-[11px] text-purple-600 mt-0.5">
                          {revMinAdvance
                            ? "המינימום ייגבה כמקדמה, וההשלמה תוצג בניכוי מה שכבר חויב באותו חודש."
                            : "ללא מקדמות — כל דיווח מחייב את מלוא שכ\"ד החודש (הגבוה מבין המינימום לפדיון)."}
                        </span>
                      </span>
                    </label>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-purple-700">תדירות דו&quot;ח פדיון</label>
                    <select value={revReportFreq} onChange={(e) => setRevReportFreq(e.target.value)} className={ic}>
                      <option value="monthly">חודשי</option>
                      <option value="quarterly">רבעוני</option>
                      <option value="semiannual">חצי שנתי</option>
                      <option value="annual">שנתי</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-purple-700">תדירות התחשבנות מול המינימום</label>
                    <select value={revSettleFreq} onChange={(e) => setRevSettleFreq(e.target.value)} className={ic}>
                      <option value="monthly">חודשית</option>
                      <option value="quarterly">רבעונית</option>
                      <option value="semiannual">חצי שנתית</option>
                      <option value="annual">שנתית</option>
                    </select>
                    <div className="text-[11px] text-purple-500 mt-0.5">אינה חייבת לחפוף לתדירות תשלום שכ&quot;ד</div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-purple-700">מתי משולמת ההתחשבנות</label>
                    {/* "בחודש הדיווח" and "עם הדיווח" place the settlement inside
                        the period. That is coherent for a MONTHLY settlement, but
                        on a quarterly one it lands in the quarter's last month —
                        before the quarter has even closed and before its final
                        turnover report exists. Offering it would be offering an
                        impossible configuration. */}
                    <select value={revSettleTiming} onChange={(e) => setRevSettleTiming(e.target.value)} className={ic}>
                      <option value="next_month">בחודש שאחרי תום התקופה</option>
                      <option value="same_month" disabled={revSettleFreq !== "monthly"}>
                        בחודש הדיווח עצמו{revSettleFreq !== "monthly" ? " — רק בהתחשבנות חודשית" : ""}
                      </option>
                      <option value="with_report" disabled={revSettleFreq !== "monthly"}>
                        יחד עם הגשת דוח הפדיון{revSettleFreq !== "monthly" ? " — רק בהתחשבנות חודשית" : ""}
                      </option>
                    </select>
                    <div className="text-[11px] text-purple-500 mt-0.5">
                      {revSettleTiming === "with_report"
                        ? 'ההתחשבנות נערכת ביום הגשת הדוח — השוכר מדווח ומשלים באותה פעולה'
                        : revSettleTiming === "same_month"
                          ? "ההתחשבנות נערכת בחודש האחרון של התקופה"
                          : "ההתחשבנות נערכת בחודש שאחרי תום התקופה"}
                    </div>
                    {revSettleFreq !== "monthly" && revSettleTiming !== "next_month" && (
                      <div className="text-[11px] text-rose-700 font-semibold mt-1">
                        ⚠ בהתחשבנות {revSettleFreq === "quarterly" ? "רבעונית" : revSettleFreq === "semiannual" ? "חצי שנתית" : "שנתית"} המועד הזה נופל
                        לפני תום התקופה — לפני שדוח החודש האחרון הוגש. בחר &quot;בחודש שאחרי תום התקופה&quot;.
                      </div>
                    )}
                    {/* What the choice actually produces, for the first period. */}
                    {(function(){
                      var ps = periodsForYear(new Date().getFullYear(), revSettleFreq as any,
                        Number(revSettleDay) || 15, revSettleTiming as any, Number(revenueReportDay) || 5);
                      if (!ps.length) return null;
                      var p = ps[0];
                      return (
                        <div className="text-[11px] text-slate-500 mt-1">
                          דוגמה: תקופה {new Date(p.periodStart).toLocaleDateString("he-IL")}–{new Date(p.periodEnd).toLocaleDateString("he-IL")}
                          {" → "}התחשבנות <b>{new Date(p.settlementDate).toLocaleDateString("he-IL")}</b>
                        </div>
                      );
                    })()}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-purple-700">
                      {revSettleTiming === "with_report" ? "יום עריכת ההתחשבנות (נקבע לפי יום הדיווח)" : "יום עריכת ההתחשבנות"}
                    </label>
                    <input type="number" min="1" max="28" value={revSettleDay}
                      onChange={(e) => setRevSettleDay(e.target.value)} className={ic} />
                  </div>
                  <div className="col-span-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-blue-800">🛡️ הגנה על שכ&quot;ד / דמי שכירות חליפיים</label>
                      <select value={revProtection.type} className="rounded border border-slate-200 px-2 py-1 text-xs"
                        onChange={(e) => setRevProtection({ ...revProtection, type: e.target.value as RevenueProtection["type"] })}>
                        <option value="none">ללא הגנה — המינימום הוא רצפה</option>
                        <option value="refund_gap">עם הגנה — פער שלילי מוחזר לשוכר</option>
                      </select>
                    </div>
                    {revProtection.type === "refund_gap" && (
                      <>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-blue-700">תקופת ההגנה</span>
                          <input type="number" min="0" value={revProtection.months ?? ""}
                            onChange={(e) => setRevProtection({ ...revProtection, months: e.target.value === "" ? null : Number(e.target.value) })}
                            className="w-24 rounded border border-slate-200 px-2 py-1 text-center text-xs" placeholder="חודשים" />
                          <span className="text-blue-700">חודשי שכירות (ריק = כל תקופת ההסכם)</span>
                        </div>
                        <input type="text" value={revProtection.notes ?? ""}
                          onChange={(e) => setRevProtection({ ...revProtection, notes: e.target.value })}
                          placeholder="לשון הסעיף / הערות (לא חובה)" className={ic} />
                        <div className="text-[11px] text-blue-700">
                          בתקופה המוגנת, תקופת התחשבנות שהפדיון בה נפל מהמינימום מייצרת <b>זיכוי לשוכר</b> ולא אפס.
                          אפשר לקבוע באופציה להארכה שמימושה מבטל את ההגנה.
                        </div>
                      </>
                    )}

                    {/* The same clause ended by an EVENT rather than by months:
                        "עד לאיכלוס 60% משטחי הפרויקט ישלם השוכר דמי שכירות
                        חליפיים בלבד". Both routes say the tenant pays the
                        turnover share with no floor, so they live in one block —
                        and whichever closes first wins. */}
                    <div className="border-t border-blue-200 pt-2 space-y-2">
                      <label className="flex items-start gap-2 text-[11px] text-slate-700">
                        <input type="checkbox" checked={(Number(revProtection.untilOccupancyPct) || 0) > 0}
                          onChange={(e) => setRevProtection({ ...revProtection,
                            untilOccupancyPct: e.target.checked ? (Number(minCondPct) || 60) : null })}
                          className="rounded mt-0.5" />
                        <span><b>גם עד לאיכלוס אחוז מסוים מהפרויקט</b> — עד אז אחוז מפדיון בלבד, ללא מינימום</span>
                      </label>
                      {(Number(revProtection.untilOccupancyPct) || 0) > 0 && (
                        <>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-blue-700">עד איכלוס</span>
                            <input type="number" min="0" max="100" value={revProtection.untilOccupancyPct ?? ""}
                              onChange={(e) => { setRevProtection({ ...revProtection, untilOccupancyPct: e.target.value === "" ? null : Number(e.target.value) }); setMinCondPct(e.target.value); }}
                              className="w-20 rounded border border-slate-200 px-2 py-1 text-center text-xs" placeholder="60" />
                            <span className="text-blue-700">% משטחי הפרויקט</span>
                            <span className="text-slate-400">·</span>
                            <span className="text-blue-700">התקיים ב־</span>
                            <input type="date" value={revProtection.occupancyMetAt ?? ""}
                              onChange={(e) => setRevProtection({ ...revProtection, occupancyMetAt: e.target.value || null })}
                              className="rounded border border-slate-200 px-2 py-1 text-xs" />
                          </div>
                          <input type="text" value={minCondNotes} onChange={(e) => setMinCondNotes(e.target.value)}
                            placeholder="לשון הסעיף — למשל: עד לאיכלוס 60% משטחי הפרויקט ישלם השוכר דמי שכירות חליפיים בלבד"
                            className={ic} />
                          <div className="text-[11px] text-blue-700">
                            {revProtection.occupancyMetAt
                              ? <>מאותו מועד המינימום חוזר לחול.</>
                              : <><b>המערכת מזהה בעצמה</b> מתי הפרויקט הגיע לאחוז הזה, פותחת התראה ומבקשת את אישורך —
                                 והמועד יישמר קבוע כדי שחיובי עבר לא יזוזו. עד לאישור, המינימום אינו נגבה.</>}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <RevenueCategoriesEditor value={revCategories} onChange={setRevCategories} basePct={revenuePct} />
                  <div className="flex items-start gap-2 pt-5 col-span-2">
                    <input type="checkbox" id="revLateIdx" checked={revLateHigherIndex}
                      onChange={(e) => setRevLateHigherIndex(e.target.checked)} className="rounded mt-0.5" />
                    <label htmlFor="revLateIdx" className="text-xs text-slate-700">
                      באיחור בדו&quot;ח — המדד הקובע הוא הגבוה מבין המדד במועד ההתחשבנות שהיה אמור להיערך לבין המדד במועד ההתחשבנות בפועל
                    </label>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">שטח מחויב (מ&quot;ר)</label>
                    <input type="number" value={chargedArea} onChange={(e) => setChargedArea(e.target.value)} className={ic} />
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <input type="checkbox" id="mgmtInRevNew" checked={mgmtIncludedInRevenue}
                      onChange={(e) => setMgmtIncludedInRevenue(e.target.checked)} className="rounded" />
                    <label htmlFor="mgmtInRevNew" className="text-xs text-slate-700">דמי ניהול כלולים באחוז מהמחזור</label>
                  </div>
                </div>
                {Number(revenuePct) > 0 && (
                  <RevenuePctTiersEditor basePct={Number(revenuePct) || 0} tiers={revenuePctTiers}
                    onChange={setRevenuePctTiers}
                    contractYears={leasePeriodUnit === "years" ? leasePeriodValue : Math.ceil(leasePeriodValue / 12)} />
                )}

                {Number(revenuePct) > 0 && (
                  <div className="rounded-lg bg-purple-100 border border-purple-300 p-3 text-sm text-purple-800 text-center">
                    שכ&quot;ד = {revenuePctTiers.length > 0 ? describePctTiers(Number(revenuePct) || 0, revenuePctTiers) : revenuePct + "% מהפדיון החודשי"}
                    {Number(minimumRent) > 0 && <span> | מינימום: {fmtMoney(Number(minimumRent))}{minRentBasis === "per_sqm" ? '/מ"ר/חודש' : "/חודש"}</span>}
                    {Number(minimumRent) === 0 && <span> | ללא מינימום</span>}
                    {mgmtIncludedInRevenue && <span> | דמי ניהול כלולים</span>}
                  </div>
                )}
              </div>
            )}

            {/* Rent terms. Only the per-sqm rent is specific to a fixed-rent
                lease — payment method, frequency, payment day, VAT and the
                investment addition apply to a turnover lease just the same.
                They used to sit inside a fixed-rent-only block, so a revenue
                contract had no way to record any of them. */}
            <div className="grid grid-cols-2 gap-4">
              {rentType === "fixed" && !isParkingContract && (
              <>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  שכ&quot;ד למ&quot;ר (₪) *
                </label>
                <input
                  type="number"
                  value={rentPerSqm}
                  onChange={(e) => setRentPerSqm(e.target.value)}
                  className={ic}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  שטח מחויב (מ&quot;ר)
                </label>
                <input
                  type="number"
                  value={chargedArea}
                  onChange={(e) => setChargedArea(e.target.value)}
                  className={ic}
                />
              </div>
              </>
              )}
              {!isParkingContract && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  תוספת שכ&quot;ד בגין השקעות בינוי (₪/חודש)
                </label>
                <input
                  type="number"
                  value={investAdd}
                  onChange={(e) => setInvestAdd(e.target.value)}
                  className={ic}
                  placeholder="0"
                />
                <p className="mt-1 text-[11px] text-slate-400">תוספת חודשית לשכ&quot;ד תמורת השקעות בינוי שביצע המשכיר. מוצמדת למדד ככל שכ&quot;ד.</p>
              </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  מע&quot;מ
                </label>
                <select
                  value={vatType}
                  onChange={(e) => setVatType(e.target.value)}
                  className={ic}
                >
                  {VAT_TYPES.map((v) => (
                    <option key={v.v} value={v.v}>
                      {v.l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  תדירות תשלום
                </label>
                <select
                  value={paymentFreq}
                  onChange={(e) => setPaymentFreq(e.target.value)}
                  className={ic}
                >
                  {PAYMENT_FREQS.map((v) => (
                    <option key={v.v} value={v.v}>
                      {v.l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  שיטת תשלום
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className={ic}
                >
                  {PAYMENT_METHODS.map((v) => (
                    <option key={v.v} value={v.v}>
                      {v.icon} {v.l}
                    </option>
                  ))}
                </select>
              </div>
              {/* תשלום חודש ראשון במעמד החתימה — ביטחון לקיום ההסכם */}
              <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3 space-y-2">
                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={prepaidOn}
                    onChange={(e) => {
                      setPrepaidOn(e.target.checked);
                      if (e.target.checked) {
                        if (!prepaidRent && baseRent > 0) setPrepaidRent(String(Math.round(baseRent * 100) / 100));
                        if (!prepaidMgmt && mgmtFeeMonthly > 0) setPrepaidMgmt(String(Math.round(mgmtFeeMonthly * 100) / 100));
                        if (!prepaidPaidAt) setPrepaidPaidAt(new Date().toISOString().slice(0, 10));
                      }
                    }} className="rounded mt-0.5" />
                  <span><b>💰 שולם במעמד החתימה שכ"ד + מקדמת ד"נ של החודש הראשון</b>
                    <span className="block text-slate-500">ביטחון לקיום ההסכם. הסכום קבוע — לא תחול עליו הצמדה, והחודש הראשון לא יחויב שוב (לא בשיקים ולא בהעברה).</span>
                  </span>
                </label>
                {prepaidOn && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-700">שכ"ד (לפני מע"מ)</label>
                      <input type="number" min="0" value={prepaidRent} onChange={(e) => setPrepaidRent(e.target.value)} className={ic} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-700">מקדמת ד"נ (לפני מע"מ)</label>
                      <input type="number" min="0" value={prepaidMgmt} onChange={(e) => setPrepaidMgmt(e.target.value)} className={ic} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-700">שולם בתאריך</label>
                      <input type="date" value={prepaidPaidAt} onChange={(e) => setPrepaidPaidAt(e.target.value)} className={ic} />
                    </div>
                  </div>
                )}
              </div>
              {(paymentMethod === "bank_transfer" || paymentMethod === "standing_order") && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    חיוב ראשון (תחילה באמצע {paymentFreq === "quarterly" ? "רבעון" : "חודש"})
                  </label>
                  <select value={firstChargeMode} onChange={(e) => setFirstChargeMode(e.target.value)} className={ic}>
                    <option value="stub_plus_period">ימי השארית + התקופה הראשונה יחד (מקובל)</option>
                    <option value="stub_only">ימי השארית בנפרד, ואז תקופות מלאות</option>
                  </select>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    לפי נוסח ההסכם: האם התשלום הראשון מכסה רק את הימים עד תחילת ה{paymentFreq === "quarterly" ? "רבעון" : "חודש"} הקרוב, או גם את התקופה המלאה שאחריו.
                  </div>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  יום תשלום בחודש
                </label>
                <input
                  type="number"
                  min="1"
                  max="28"
                  value={paymentDay}
                  onChange={(e) => setPaymentDay(e.target.value)}
                  className={ic}
                />
              </div>
            </div>

            {/* Construction investment and its reimbursement terms. This used to
                appear only once a rent ADDITION was entered, which had it
                backwards: the landlord funds the fit-out first, and a monthly
                addition is one possible consequence — often there is none. */}
            <div className="flex items-center gap-2 mt-3">
              <input type="checkbox" id="hasTI" className="w-4 h-4"
                checked={hasTI || Number(investAdd) > 0 || Number(tiAmount) > 0 || !!tiDescription}
                onChange={(e) => setHasTI(e.target.checked)} />
              <label htmlFor="hasTI" className="text-sm font-bold text-slate-700">
                השקעות בינוי / התאמות למושכר
                <span className="mr-1 text-[11px] font-normal text-slate-500">
                  (גם ללא תוספת שכ&quot;ד)
                </span>
              </label>
            </div>
            {(hasTI || Number(investAdd) > 0 || Number(tiAmount) > 0 || !!tiDescription) && (
              <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-4 mt-3">
                <div className="text-sm font-bold text-purple-800 mb-1">🏗 פירוט השקעות בינוי ותנאי החזר <span className="text-[11px] font-semibold text-purple-500">(אופציונלי)</span></div>
                <div className="text-[11px] text-purple-600 mb-3 leading-relaxed">
                  ההשקעה שביצע המשכיר עבור השוכר, ומתי מוחזר לשוכר התשלום עבורה (בדרך כלל X ימים לאחר השלמת העבודות ופתיחת העסק, כנגד דו&quot;ח מוסדר וחשבונית).
                  <br/>אפשר להשאיר ריק — התוספת החודשית לבדה מספיקה, והמערכת תחשב איתה את שכ&quot;ד והמקדמות כרגיל.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">סכום ההשקעה הכולל (₪)</label>
                    <input type="number" value={tiAmount} onChange={(e) => setTiAmount(e.target.value)} className={ic} placeholder="0" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">תיאור העבודות</label>
                    <input type="text" value={tiDescription} onChange={(e) => setTiDescription(e.target.value)} className={ic} placeholder="התאמות מבנה, ריצוף, חשמל..." />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">מועד תשלום ההשקעה לשוכר</label>
                    <select value={tiPaymentTrigger} onChange={(e) => setTiPaymentTrigger(e.target.value)} className={ic}>
                      <option value="on_completion">עם השלמת העבודות</option>
                      <option value="on_opening">עם פתיחת העסק</option>
                      <option value="on_handover">במסירת המושכר</option>
                      <option value="fixed_date">בתאריך קבוע</option>
                      <option value="installments">בתשלומים</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">ימים לאחר המועד</label>
                    <input type="number" value={tiPaymentDays} onChange={(e) => setTiPaymentDays(e.target.value)} className={ic} placeholder="למשל 30" />
                  </div>
                  {tiPaymentTrigger === "installments" && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">מספר תשלומים</label>
                      <input type="number" value={tiInstallments} onChange={(e) => setTiInstallments(e.target.value)} className={ic} placeholder="למשל 3" />
                    </div>
                  )}
                  <div className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50/40 p-3 space-y-2">
                    <div className="text-xs font-bold text-rose-800">↩️ החזר השקעה ביציאה מוקדמת</div>
                    <div className="text-[11px] text-rose-600">
                      ההשקעה ניתנת כנגד התחייבות לתקופת שכירות. יוצא השוכר קודם — הוא מחזיר את החלק היחסי:
                      סכום ההשקעה ÷ חודשי ההתחייבות × החודשים שנותרו.
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-rose-700">חודשי התחייבות</span>
                      <input type="number" min="0" value={tiClawbackMonths}
                        onChange={(e) => setTiClawbackMonths(e.target.value)}
                        className="w-24 rounded border border-slate-200 px-2 py-1 text-center text-xs" placeholder="120" />
                      <label className="flex items-center gap-1 text-rose-700">
                        <input type="checkbox" checked={tiClawbackIndexed} onChange={(e) => setTiClawbackIndexed(e.target.checked)} />
                        צמוד למדד ממועד ההעמדה
                      </label>
                      <label className="flex items-center gap-1 text-rose-700">
                        <input type="checkbox" checked={tiClawbackVat} onChange={(e) => setTiClawbackVat(e.target.checked)} />
                        בתוספת מע&quot;מ
                      </label>
                    </div>
                    <input type="text" value={tiClawbackNotes} onChange={(e) => setTiClawbackNotes(e.target.value)}
                      placeholder="לשון הסעיף / הערות (לא חובה)" className={ic} />
                    {Number(tiClawbackMonths) > 0 && Number(tiAmount) > 0 && (
                      <div className="text-[11px] text-rose-700 font-semibold">
                        {Math.round(Number(tiAmount) / Number(tiClawbackMonths) * 100) / 100} ₪ לכל חודש שנותר · לדוגמה: יציאה לאחר{" "}
                        {Math.round(Number(tiClawbackMonths) * 0.75)} חודשים → החזר{" "}
                        {Math.round(Number(tiAmount) / Number(tiClawbackMonths) * (Number(tiClawbackMonths) - Math.round(Number(tiClawbackMonths) * 0.75))).toLocaleString("he-IL")} ₪ לפני הצמדה ומע&quot;מ
                      </div>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-slate-700">הערות לתשלום</label>
                    <input type="text" value={tiPaymentNotes} onChange={(e) => setTiPaymentNotes(e.target.value)} className={ic} placeholder="תנאים מיוחדים להחזר ההשקעה..." />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 mt-3">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={tiRequiresReport} onChange={(e) => setTiRequiresReport(e.target.checked)} className="w-4 h-4" />
                    כנגד דו&quot;ח עבודות מוסדר
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={tiRequiresInvoice} onChange={(e) => setTiRequiresInvoice(e.target.checked)} className="w-4 h-4" />
                    כנגד חשבונית
                  </label>
                </div>
              </div>
            )}

            {/* Early termination clause */}
            <div className="rounded-xl border border-slate-200 p-4 mt-3">
              <div className="flex items-center gap-2 mb-3">
                <input type="checkbox" id="earlyTerm" checked={earlyTermination}
                  onChange={(e) => setEarlyTermination(e.target.checked)} className="w-4 h-4" />
                <label htmlFor="earlyTerm" className="text-sm font-bold text-slate-700">סיום מוקדם בהודעה מראש</label>
              </div>
              {earlyTermination && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">ימי הודעה מראש</label>
                    <input type="number" min="1" value={terminationNoticeDays}
                      onChange={(e) => setTerminationNoticeDays(e.target.value)} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">מי רשאי לסיים</label>
                    <select value={terminationBy} onChange={(e) => setTerminationBy(e.target.value)} className={ic}>
                      <option value="both">שני הצדדים</option>
                      <option value="landlord">משכיר בלבד</option>
                      <option value="tenant">שוכר בלבד</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Rent preview */}
            {/* On a turnover lease baseRent is 0 (there is no per-sqm rent), so
                this box simply never appeared — even when a minimum was agreed
                and IS the figure the landlord can count on. It now shows the
                floor, labelled as such. */}
            {(baseRent > 0 || guaranteeMonthlyRent > 0) && (function(){
              var isRev = rentType === "revenue_pct";
              var shown = baseRent > 0 ? baseRent : guaranteeMonthlyRent;
              var shownVat = vatType === "taxable" ? shown * (currentVatPct / 100) : 0;
              return (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
                <div className="text-xs font-bold text-blue-700 mb-2">
                  {isRev ? 'תצוגת שכ"ד חודשי — מינימום מובטח' : 'תצוגת שכ"ד חודשי'}
                </div>
                {isRev && (
                  <div className="text-[11px] text-blue-600 mb-2">
                    בחוזה אחוז-מפדיון שכ&quot;ד בפועל = הגבוה מבין {revenuePct || 0}% מהפדיון לבין המינימום. הסכומים כאן הם הרצפה.
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
                  {[
                    { l: isRev ? 'מינימום לחודש' : 'שכ"ד בסיס', v: fmtMoney(shown) },
                    { l: 'מע"מ', v: fmtMoney(shownVat) },
                    { l: 'סה"כ לחודש', v: fmtMoney(shown + shownVat) },
                  ].map((k) => (
                    <div key={k.l}>
                      <div className="text-lg font-black text-blue-800">
                        {k.v}
                      </div>
                      <div className="text-xs text-blue-600">{k.l}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-center text-xs text-blue-600">
                  שנתי: <strong>{fmtMoney(shown * 12)}</strong>
                </div>
              </div>
              );
            })()}

            {/* Per-unit rent — shown when multiple spaces selected (fixed rent only) */}
            {rentType === "fixed" && selSpaces.length > 1 && (
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-bold text-slate-700 mb-2">מחיר לפי יחידה</div>
                <div className="text-xs text-slate-400 mb-3">בחר למ&quot;ר או סכום קבוע לכל יחידה. השאר ריק לברירת מחדל.</div>
                <div className="space-y-2">
                  {selSpaces.map((sid) => {
                    const sp = spaces.find((s) => s.id === sid);
                    if (!sp) return null;
                    const rType = unitRentTypes[sid] || "per_sqm";
                    const rVal = unitRentOverrides[sid] || "";
                    const unitTotal = rType === "included" ? 0 : rType === "fixed" ? (Number(rVal) || 0) : (Number(rVal || rentPerSqm) || 0) * (sp.area || 0);
                    return (
                      <div key={sid} className="rounded-lg border border-slate-100 p-2 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-600 flex-1 truncate">{sp.space_name}</span>
                          <span className="text-xs text-slate-400">{sp.area} מ&quot;ר</span>
                          <div className="flex gap-1">
                            <button type="button" onClick={() => setUnitRentTypes(prev => ({...prev, [sid]: "per_sqm"}))}
                              className={"rounded border px-2 py-0.5 text-[10px] " + (rType === "per_sqm" ? "border-blue-500 bg-blue-50 text-blue-700 font-bold" : "border-slate-200 text-slate-500")}>למ&quot;ר</button>
                            <button type="button" onClick={() => setUnitRentTypes(prev => ({...prev, [sid]: "fixed"}))}
                              className={"rounded border px-2 py-0.5 text-[10px] " + (rType === "fixed" ? "border-blue-500 bg-blue-50 text-blue-700 font-bold" : "border-slate-200 text-slate-500")}>סכום קבוע</button>
                            <button type="button" onClick={() => setUnitRentTypes(prev => ({...prev, [sid]: "included"}))}
                              title="שכ&quot;ד היחידה הזו כלול במחיר היחידה הראשית — תורמת ₪0 (מתאים לסככה / חצר צמודה)"
                              className={"rounded border px-2 py-0.5 text-[10px] " + (rType === "included" ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-200 text-slate-500")}>כלול במחיר</button>
                          </div>
                        </div>
                        {rType === "included" ? (
                          <div className="text-[11px] text-emerald-700">✓ כלול בשכ&quot;ד של היחידה הראשית — ללא חיוב נפרד</div>
                        ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={rVal}
                            onChange={(e) => setUnitRentOverrides((prev) => ({ ...prev, [sid]: e.target.value }))}
                            placeholder={rType === "fixed" ? "סכום חודשי" : (rentPerSqm || "₪/מ\"ר")}
                            className={ic + " flex-1 max-w-40"}
                        />
                          <span className="text-xs text-slate-400">{rType === "fixed" ? "₪/חודש" : "₪/מ\"ר"}</span>
                          {unitTotal > 0 && <span className="text-xs font-semibold text-green-700 mr-2">= {fmtMoney(unitTotal)}/חודש</span>}
                        </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Total all units */}
                {(function() {
                  var total = 0;
                  selSpaces.forEach(function(sid) {
                    var sp = spaces.find(function(s) { return s.id === sid; });
                    if (!sp) return;
                    var rType = unitRentTypes[sid] || "per_sqm";
                    var rVal = Number(unitRentOverrides[sid]) || 0;
                    if (rType === "included") { /* כלול במחיר היחידה הראשית */ }
                    else if (rType === "fixed") total += rVal;
                    else total += (rVal || Number(rentPerSqm) || 0) * (sp.area || 0);
                  });
                  if (total > 0) return (
                    <div className="mt-3 rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                      <div className="text-lg font-black text-green-800">{fmtMoney(total)}/חודש</div>
                      <div className="text-xs text-green-600">סה&quot;כ שכ&quot;ד כל היחידות</div>
                    </div>
                  );
                  return null;
                })()}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  שיטת הצמדה
                </label>
                <select
                  value={indexMethod}
                  onChange={(e) => setIndexMethod(e.target.value)}
                  className={ic}
                >
                  {INDEX_METHODS.map((m) => (
                    <option key={m.v} value={m.v}>
                      {m.l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  מדד בסיס {baseCPI && baseCPIDate && (() => {
                    const d = new Date(baseCPIDate);
                    const rec = cpiRecords.find((r: any) => r.year === d.getFullYear() && r.month === (d.getMonth() + 1));
                    if (rec && Math.abs(Number(rec.value) - Number(baseCPI)) > 0.01) {
                      return <span className="text-orange-600 font-normal"> (שונה מהמדד הרשום: {rec.value})</span>;
                    }
                    return null;
                  })()}
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={baseCPI}
                    onChange={(e) => { setBaseCPI(e.target.value); setBaseCPITouched(true); }}
                    placeholder="נטען אוטומטית מהלמ״ס"
                    className={ic + " flex-1"}
                  />
                  <button
                    type="button"
                    disabled={cbsFetching || !baseCPIDate}
                    onClick={async () => {
                      if (!baseCPIDate) {
                        alert("נא לבחור תאריך מדד בסיס קודם");
                        return;
                      }
                      const d = new Date(baseCPIDate);
                      const day = d.getDate();
                      // Don't allow day 15 — ambiguous (publication date)
                      if (day === 15) {
                        alert("ה-15 לחודש הוא תאריך פרסום המדד. יש לבחור עד 14 לחודש (מדד חודש קודם) או מ-16 ואילך (מדד החודש שפורסם).");
                        return;
                      }
                      setCbsFetching(true);
                      try {
                        // Apply t-2 rule: determine which CPI month is "known" at this date
                        // Day >= 16: CPI for month-1 is known (published on 15th)
                        // Day <= 14: CPI for month-2 is known (previous month's publication)
                        const knownDate = new Date(d);
                        if (day >= 16) {
                          knownDate.setMonth(knownDate.getMonth() - 1);
                        } else {
                          knownDate.setMonth(knownDate.getMonth() - 2);
                        }
                        const knownYear = knownDate.getFullYear();
                        const knownMonth = knownDate.getMonth() + 1;

                        const res = await fetch(`/api/cpi?year=${knownYear}`);
                        const data = await res.json();
                        const records = data.records || [];
                        const rec = records.find((r: any) => r.year === knownYear && r.month === knownMonth);
                        var HEB_MONTHS = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
                        if (rec) {
                          // Pulling an index is a deliberate act: the date the
                          // user typed is the publication date they meant, and
                          // it stays exactly as written.
                          setBaseCPITouched(true);
                          setBaseCPI(rec.value.toString());
                          setCbsFetchedMonth(HEB_MONTHS[knownMonth] + " " + knownYear);
                          const allRes = await fetch("/api/cpi");
                          const allData = await allRes.json();
                          if (allData.records) setCpiRecords(allData.records);
                        } else {
                          alert(`מדד ${knownMonth}/${knownYear} לא פורסם עדיין בלמ"ס (מדד ידוע לתאריך ${day}/${d.getMonth()+1}/${d.getFullYear()})`);
                        }
                      } catch (e: any) {
                        alert("שגיאה בשליפת מדד: " + e.message);
                      } finally {
                        setCbsFetching(false);
                      }
                    }}
                    className="rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-40 whitespace-nowrap"
                  >
                    {cbsFetching ? "טוען..." : "משוך מדד"}
                  </button>
                </div>
                {cbsFetchedMonth && baseCPI && (
                  <div className="text-xs text-blue-600 mt-1 font-semibold">📊 מדד {cbsFetchedMonth} = {baseCPI}</div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  תאריך פרסום מדד הבסיס (מדד ידוע)
                </label>
                <input
                  type="date"
                  value={baseCPIDate}
                  onChange={(e) => { setBaseCPIDate(e.target.value); setBaseCPITouched(true); }}
                  className={ic}
                />
              </div>
              <BaseIndexRuleFields
                value={baseIndexRule}
                onChange={setBaseIndexRule}
                contract={{ actual_handover_date: actualHandover, planned_handover_date: plannedHandover, start_date: startDate }}
                inputClass={ic}
                onResolve={async function(baseDate) {
                  setBaseCPIDate(baseDate);
                  setBaseCPITouched(true);
                  // Pull the value for the derived month so the base isn't left
                  // as a date with no index behind it.
                  var d = new Date(baseDate);
                  var rec = cpiRecords.find(function(r: any) { return r.year === d.getFullYear() && r.month === d.getMonth() + 1; });
                  if (!rec) {
                    try {
                      var res = await fetch("/api/cpi?year=" + d.getFullYear());
                      var data = await res.json();
                      rec = (data.records || []).find(function(r: any) { return r.year === d.getFullYear() && r.month === d.getMonth() + 1; });
                    } catch (e) { /* fall through to the manual field */ }
                  }
                  if (rec) setBaseCPI(String(rec.value));
                  else alert("מדד החודש הנגזר טרם פורסם — התאריך נקבע, יש להשלים את הערך כשיפורסם.");
                }}
              />
              {!isParkingContract ? (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  דמי ניהול — מקדמה (₪/מ&quot;ר לחודש)
                </label>
                <input
                  type="number"
                  value={mgmtFeePct}
                  onChange={(e) => setMgmtFeePct(e.target.value)}
                  placeholder="5"
                  className={ic}
                />
                <div className="text-[10px] text-slate-400 mt-0.5">
                  מקדמה לשנה הראשונה / עד הזנת תקציב ניהול לנכס. ההתחשבנות השנתית משווה לעלות בפועל.
                </div>
                <label className="mb-1 mt-2 block text-[11px] font-semibold text-slate-600">
                  קוסט פלוס (%) — לא חובה
                </label>
                <input type="number" min="0" max="100" step="0.5" value={mgmtCostPlus}
                  onChange={(e) => setMgmtCostPlus(e.target.value)} placeholder="למשל 15" className={ic} />
                <div className="text-[10px] text-slate-400 mt-0.5">
                  אם ההסכם קובע עלות בפועל + אחוז — ההתחשבנות השנתית תוסיף את המרווח על חלק השוכר בעלות.
                </div>
              </div>
              ) : (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  דמי ניהול לחניה (₪/מקום לחודש) — לא חובה
                </label>
                <input
                  type="number"
                  value={mgmtParkingFee}
                  onChange={(e) => setMgmtParkingFee(e.target.value)}
                  placeholder="ריק = לפי הגדרת הנכס"
                  className={ic}
                />
                <div className="text-[10px] text-slate-400 mt-0.5">
                  תעריף נפרד מדמי הניהול למ&quot;ר. ריק = לפי מה שהוגדר בנכס (אם לא הוגדר — אין דמי ניהול על חניות).
                </div>
              </div>
              )}
              <MgmtProtectionFields
                value={mgmtProtection}
                onChange={setMgmtProtection}
                contractStart={startDate}
                area={penaltyPreviewArea}
                inputClass={ic}
              />
            </div>

            {/* Document URL */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                קישור לחוזה מקורי (URL)
              </label>
              <input
                type="url"
                value={documentUrl}
                onChange={(e) => setDocumentUrl(e.target.value)}
                placeholder="https://drive.google.com/..."
                className={ic}
                dir="ltr"
              />
            </div>

            {/* Parking */}
            {propertyId && (
              <div className={"mt-6 pt-4 border-t " + (isParkingContract ? "border-blue-300" : "border-slate-200")}>
                {isParkingContract && (
                  <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 mb-3 text-xs text-blue-800 font-semibold">
                    🅿️ זהו לב ההסכם: הוסף את הקצאות החניה של השוכר — החיוב החודשי הוא סכום דמי החניה שכאן. חובה לפחות הקצאה אחת עם דמי חניה.
                  </div>
                )}
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-semibold text-slate-700">{isParkingContract ? "חניות ההסכם *" : "חניות"}</label>
                  <button type="button" onClick={() => setShowNewParking(!showNewParking)}
                    className="rounded-lg bg-green-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-green-700">
                    + חניה חדשה
                  </button>
                </div>
                {showNewParking && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 mb-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-600">כמות מקומות</label>
                        <input type="number" min="1" value={newParkingQty}
                          onChange={(e) => setNewParkingQty(e.target.value)} className={ic} />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-600">דמי חניה (למקום/חודש)</label>
                        <input type="number" value={newParkingFee}
                          onChange={(e) => setNewParkingFee(e.target.value)} className={ic} />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" checked={newParkingMarked}
                          onChange={(e) => setNewParkingMarked(e.target.checked)} className="w-3.5 h-3.5" />
                        מקומות מסומנים
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" checked={newParkingIncluded}
                          onChange={(e) => setNewParkingIncluded(e.target.checked)} className="w-3.5 h-3.5" />
                        כלול בשכ&quot;ד
                      </label>
                    </div>
                    {newParkingMarked && (
                      <input placeholder="מספרי חניות (לדוגמה: 9-15 או 25,30)" value={newParkingSpot}
                        onChange={(e) => setNewParkingSpot(e.target.value)} className={ic} />
                    )}
                    <input placeholder="מספר רכב (אופציונלי)" value={newParkingVehicle}
                      onChange={(e) => setNewParkingVehicle(e.target.value)} className={ic} />
                    <div className="flex gap-2">
                      <button type="button" onClick={handleNewParking} disabled={savingParking}
                        className="rounded-lg bg-green-600 text-white px-4 py-1.5 text-xs font-bold hover:bg-green-700 disabled:opacity-50">
                        שמור
                      </button>
                      <button type="button" onClick={() => setShowNewParking(false)}
                        className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs hover:bg-slate-50">
                        ביטול
                      </button>
                    </div>
                  </div>
                )}
                {parkingSpots.length > 0 ? (
                  <div className="space-y-1">
                    {parkingSpots.map(function(p) {
                      var qty = p.quantity || 1;
                      var occupied = p.tenant_id && p.tenant_id !== tenantId;
                      var ownedByMe = p.tenant_id === tenantId;
                      return (
                        <div key={p.id} className={"rounded-lg border p-2 flex items-center justify-between text-xs " +
                          (ownedByMe ? "border-green-300 bg-green-50" : occupied ? "border-red-200 bg-red-50" : "border-slate-200")}>
                          <div>
                            <span className="font-semibold">
                              {p.is_marked && p.spot_number ? "🔒 חניות " + p.spot_number : qty + " מקומות"}
                            </span>
                            {p.monthly_fee > 0 && <span className="text-slate-400 mr-2">₪{(p.monthly_fee * qty).toFixed(2)}/חודש</span>}
                            {p.is_included_in_rent && <span className="text-orange-500 mr-1">(כלול)</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            {occupied && <span className="text-red-600 font-semibold">🔴 תפוס — {p.tenants?.name}</span>}
                            {ownedByMe && <span className="text-green-600 font-semibold">✓ {p.tenants?.name || "חוזה נוכחי"}</span>}
                            {!occupied && !ownedByMe && <span className="text-blue-500">פנוי</span>}
                            <button type="button" onClick={function() { handleDeleteParking(p.id); }}
                              className="text-red-400 hover:text-red-600 text-xs">🗑</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 text-center py-2">אין חניות לנכס זה</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* STEP 3 — גרייס ועלייה */}
        {step === 3 && (
          <div className="space-y-5">
            <h2 className="font-bold text-slate-800 text-lg mb-4">
              📈 גרייס ועלייה שנתית
            </h2>

            {/* Grace */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="checkbox"
                  id="grace"
                  checked={hasGrace}
                  onChange={(e) => setHasGrace(e.target.checked)}
                  className="w-4 h-4"
                />
                <label
                  htmlFor="grace"
                  className="text-sm font-bold text-slate-700"
                >
                  תקופת גרייס
                </label>
              </div>
              {hasGrace && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        {graceUnit === "months" ? "מספר חודשי גרייס" : "מספר ימי גרייס"}
                      </label>
                      <div className="flex gap-1 mb-1">
                        <button type="button" onClick={() => setGraceUnit("months")}
                          className={"rounded border px-2 py-1 text-[11px] " + (graceUnit === "months" ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 text-slate-500")}>חודשים</button>
                        <button type="button" onClick={() => setGraceUnit("days")}
                          className={"rounded border px-2 py-1 text-[11px] " + (graceUnit === "days" ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 text-slate-500")}>ימים</button>
                      </div>
                      <input
                        type="number"
                        min="1"
                        max={graceUnit === "months" ? 24 : 730}
                        value={graceMonths}
                        onChange={(e) => setGraceMonths(e.target.value)}
                        className={ic}
                      />
                      {/* Phase 2: "גרייס של 60 יום או עד הפתיחה, ואז עוד 60 יום
                          מהפתיחה". Counted from wherever phase 1 ends, so the
                          total can never exceed phase1 + phase2. */}
                      <label className="mb-1 mt-2 block text-[11px] font-semibold text-slate-600">
                        + גרייס נוסף מפתיחת המושכר (ימים) — לא חובה
                      </label>
                      <input type="number" min="0" max="365" value={gracePhase2Days} placeholder="למשל 60"
                        onChange={(e) => setGracePhase2Days(e.target.value)} className={ic} />
                      {Number(gracePhase2Days) > 0 && (
                        <div className="text-[10px] text-blue-700 mt-0.5 leading-relaxed">
                          שלב 1 נגמר בפתיחה או בתום {graceMonths || 0} {graceUnit === "days" ? "ימים" : "חודשים"} (המוקדם),
                          ומשם עוד {gracePhase2Days} ימים. פתיחה מוקדמת מקצרת את הסך; המקסימום נשמר.
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        סוג גרייס
                      </label>
                      <select
                        value={graceType}
                        onChange={(e) => setGraceType(e.target.value)}
                        className={ic}
                      >
                        {GRACE_TYPES.map((g) => (
                          <option key={g.v} value={g.v}>
                            {g.l}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Shown whether or not a grace was agreed: a store has an opening
                  date, and a late-opening penalty, in either case. */}
              <div className="space-y-3">
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
                    <div className="text-xs font-bold text-indigo-800">🏬 פתיחת המושכר (חוזי חנויות)</div>
                    <div className="text-[11px] text-indigo-700 leading-relaxed">
                      החוזה נחתם לפני המסירה. תקופת העבודות מתחילה במסירה, ויעד הפתיחה הוא בדרך כלל
                      סופה — לכן הוא מחושב לבד ממועד המסירה + חודשי הגרייס, וניתן לשנותו אם סוכם יעד אחר.
                      הגרייס נעצר במוקדם מבין השניים: פתיחת המושכר או תום תקופת הגרייס. אם הגרייס נגמר
                      והמושכר טרם נפתח, החיוב ותקופת ההסכם מתחילים לזוז.
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                          יעד פתיחת המושכר
                          {!plannedOpeningTouched && <span className="mr-1 text-[10px] font-normal text-indigo-500">(מחושב מסוף הגרייס)</span>}
                        </label>
                        <input type="date" value={plannedOpening}
                          onChange={(e) => { setPlannedOpeningTouched(true); setPlannedOpening(e.target.value); }} className={ic} />
                        {plannedOpeningTouched && (
                          <button type="button" onClick={() => setPlannedOpeningTouched(false)}
                            className="mt-1 text-[10px] text-indigo-600 hover:underline">↺ חזור לחישוב מסוף הגרייס</button>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-slate-700">פתיחה בפועל</label>
                        <input type="date" value={actualOpening} onChange={(e) => setActualOpening(e.target.value)} className={ic} />
                      </div>
                    </div>
                    <label className="flex items-start gap-2 text-[11px] text-slate-700">
                      <input type="checkbox" checked={graceEndsOnOpening}
                        onChange={(e) => setGraceEndsOnOpening(e.target.checked)} className="w-3.5 h-3.5 mt-0.5" />
                      <span>
                        פתיחת המושכר מקצרת את הגרייס
                        <span className="block text-slate-500">
                          בטל אם סוכם שהגרייס נמשך לתקופתו המלאה גם אחרי הפתיחה. תקופת ההסכם ממשיכה כרגיל בשני המקרים.
                        </span>
                      </span>
                    </label>
                  </div>

                  {/* The two mechanisms overlap, and saying so beats letting the
                      user discover it in a bill. When the term starts at the
                      opening there is no rent before it — the rent grace has
                      nothing to discount, while the MANAGEMENT rule still does
                      real work, because management IS charged during fit-out. */}
                  {termStartsAt === "opening" && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900 leading-relaxed">
                      <div className="font-bold mb-0.5">ℹ️ תקופת השכירות מתחילה במועד הפתיחה</div>
                      לפני מועד הפתיחה <b>אין תקופת שכירות ואין שכ&quot;ד</b>, ולכן גרייס בשכ&quot;ד אינו מוסיף דבר —
                      הפטור כבר מובע בכך שהתקופה מתחילה מאוחר יותר.
                      מה שכן נדרש כאן הוא <b>הכלל של דמי הניהול</b>, שנגבים גם בתקופת העבודות.
                      {" "}לכן מומלץ &quot;גרייס על שכ&quot;ד בלבד&quot; עם הנחת דמי ניהול, ולא גרייס מלא.
                      {(Number(graceMonths) > 0 && openingRuleOn && Number(openingMaxDays) > 0 &&
                        ((graceUnit === "days" ? Number(graceMonths) : Number(graceMonths) * 30) > Number(openingMaxDays))) && (
                        <div className="mt-1 font-bold text-rose-700">
                          ⚠ הגרייס ({graceMonths} {graceUnit === "days" ? "ימים" : "חודשים"}) ארוך מהמועד הקבוע לפתיחה ({openingMaxDays} ימים) —
                          הגרייס ייעצר במועד הפתיחה, כך שההפרש אינו נספר פעמיים.
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      הנחה בדמי ניהול בתקופת הגרייס (%) — ריק = ללא שינוי
                    </label>
                    <input type="number" min="0" max="100" value={graceMgmtDiscount} placeholder="למשל 50"
                      onChange={(e) => setGraceMgmtDiscount(e.target.value)} className={ic} />
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      50 = מחצית מדמי הניהול בתקופת הגרייס · 100 = פטור מלא
                    </div>
                  </div>

                  {/* When does the management charge start at all? The discount
                      itself often kicks in later than the handover. */}
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
                    <div className="text-xs font-bold text-emerald-800">🧾 מתי מתחילים דמי ניהול בתקופת הגרייס</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setMgmtStartsMode("grace_start")}
                        className={"rounded-lg border px-3 py-2 text-[11px] font-bold text-right " + (mgmtStartsMode === "grace_start" ? "border-emerald-500 bg-white text-emerald-800" : "border-slate-200 text-slate-500")}>
                        מהמסירה
                        <div className="font-normal text-[10px] text-slate-500">ההנחה חלה מיד עם תחילת הגרייס</div>
                      </button>
                      <button type="button" onClick={() => setMgmtStartsMode("works_start_or_days")}
                        className={"rounded-lg border px-3 py-2 text-[11px] font-bold text-right " + (mgmtStartsMode === "works_start_or_days" ? "border-emerald-500 bg-white text-emerald-800" : "border-slate-200 text-slate-500")}>
                        מתחילת העבודות בפועל / תקרת ימים
                        <div className="font-normal text-[10px] text-slate-500">עד אז — פטור מלא מדמי ניהול</div>
                      </button>
                    </div>
                    {mgmtStartsMode === "works_start_or_days" && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-slate-700">תקרת ימי פטור מהמסירה</label>
                            <input type="number" min="0" max="730" value={mgmtFreeMaxDays} placeholder="למשל 90"
                              onChange={(e) => setMgmtFreeMaxDays(e.target.value)} className={ic} />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-slate-700">תחילת עבודות בפועל (אם ידוע)</label>
                            <input type="date" value={worksStartDate}
                              onChange={(e) => plausibleDate(e.target.value) || e.target.value === "" ? setWorksStartDate(e.target.value) : null} className={ic} />
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700">הסעיף כלשונו בהסכם</label>
                          <input type="text" value={mgmtFreeNotes} onChange={(e) => setMgmtFreeNotes(e.target.value)}
                            className={ic} placeholder='למשל: וגם זאת, רק לאחר תחילת עבודות השוכר בפועל, או לאחר 90 יום המוקדם מביניהם' />
                        </div>
                        <div className="text-[11px] text-emerald-800 leading-relaxed">
                          דמי הניהול מתחילים ב<b>מוקדם מבין</b> תחילת העבודות בפועל לבין {Number(mgmtFreeMaxDays) || 0} יום מהמסירה.
                          עד אותו מועד — <b>אפס דמי ניהול</b>, גם כשהנכס נמסר והגרייס בשכ&quot;ד כבר רץ.
                          {Number(graceMgmtDiscount) > 0 && <> משם ועד תום הגרייס — {100 - Number(graceMgmtDiscount)}% מדמי הניהול.</>}
                          {" "}לא דווחה תחילת עבודות → התקרה מסיימת את הפטור לבדה.
                        </div>
                      </>
                    )}
                  </div>

                  {/* Optional — most contracts carry no penalty at all. */}
                  <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-3 space-y-2">
                    <div className="text-xs font-bold text-rose-800">⏰ קנס על אי-פתיחה במועד (אופציונלי)</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-slate-700">סוג הקנס</label>
                        <select value={latePenType} onChange={(e) => setLatePenType(e.target.value)} className={ic}>
                          <option value="none">ללא קנס</option>
                          <option value="daily_amount">סכום קבוע לכל יום איחור</option>
                          <option value="daily_pct_rent">אחוז משכ&quot;ד יומי לכל יום איחור</option>
                          <option value="fixed">סכום חד-פעמי</option>
                        </select>
                      </div>
                      {latePenType !== "none" && (
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                            {latePenType === "daily_pct_rent" ? "אחוז (%)" : "סכום (₪)"}
                          </label>
                          <input type="number" step="0.01" value={latePenValue}
                            onChange={(e) => setLatePenValue(e.target.value)} className={ic} />
                        </div>
                      )}
                      {latePenType !== "none" && (
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700">ימי חסד לפני שהקנס מתחיל</label>
                          <input type="number" min="0" value={latePenGraceDays}
                            onChange={(e) => setLatePenGraceDays(e.target.value)} className={ic} />
                        </div>
                      )}
                      {latePenType !== "none" && (
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700">הערות</label>
                          <input type="text" value={latePenNotes}
                            onChange={(e) => setLatePenNotes(e.target.value)} className={ic} />
                        </div>
                      )}
                    </div>
                  </div>

                  {graceType === "partial" && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        אחוז הנחה בשכ&quot;ד בגרייס (%)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={graceDiscountPct}
                        onChange={(e) => setGraceDiscountPct(e.target.value)}
                        className={ic}
                      />
                    </div>
                  )}
                  {/* What the dates actually produce — computed by the same
                      function the billing uses, so the form can't promise
                      something the calculation won't do. */}
                  {(function(){
                    // תצוגת האמת של החיוב — חייבת לשקף את מה שיישמר: שדות
                    // הגרייס נשמרים רק כשהתיבה מסומנת, אז גם כאן הם אפס
                    // בלעדיה. בלי השער הזה ברירת המחדל הפנימית (3 חודשים)
                    // ציירה "גרייס 91 ימים" בחוזה שאין בו גרייס.
                    var draft = {
                      grace_months: hasGrace && graceUnit === "months" ? (Number(graceMonths) || 0) : 0,
                      grace_days:   hasGrace && graceUnit === "days"   ? (Number(graceMonths) || 0) : 0,
                      grace_type: graceType,
                      grace_discount_pct: Number(graceDiscountPct) || 0,
                      grace_mgmt_discount_pct: graceMgmtDiscount === "" ? null : Number(graceMgmtDiscount),
                      grace_ends_on_opening: hasGrace && graceEndsOnOpening,
                      actual_handover_date: actualHandover || null, planned_handover_date: plannedHandover || null,
                      start_date: startDate || null,
                      planned_opening_date: plannedOpening || null, actual_opening_date: actualOpening || null,
                      late_opening_penalty_type: latePenType === "none" ? null : latePenType,
                      late_opening_penalty_value: Number(latePenValue) || 0,
                      late_opening_grace_days: Number(latePenGraceDays) || 0,
                      mgmt_charge_starts: hasGrace && mgmtStartsMode === "works_start_or_days" ? "works_start_or_days" : null,
                      mgmt_free_max_days: Number(mgmtFreeMaxDays) || null,
                      works_start_date: worksStartDate || null,
                    };
                    var g = graceWindow({ contract: draft });
                    if (!g.applies) return null;
                    var pen = lateOpeningPenalty({ contract: draft, monthlyRent: guaranteeMonthlyRent });
                    return (
                      <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-3 text-xs text-indigo-900 space-y-1">
                        <div className="font-bold">📅 {describeGrace(g)}</div>
                        {g.start && <div>תקופת עבודות מ-{g.start.toLocaleDateString("he-IL")}</div>}
                        {g.end && <div>חיוב שכ&quot;ד מתחיל: <b>{(g.rentFreeEnd || g.end).toLocaleDateString("he-IL")}</b>{g.phase2Days > 0 && <span className="text-indigo-500"> (שלב 1 + {g.phase2Days} ימים מהפתיחה)</span>}</div>}
                        {graceMgmtDiscount !== "" && <div>דמי ניהול בגרייס: {100 - (Number(graceMgmtDiscount) || 0)}% מהרגיל</div>}
                        {(function(){
                          var mf = mgmtFreeWindow({ contract: draft });
                          return mf.applies ? <div className="text-emerald-800 font-semibold">🧾 {describeMgmtFree(mf)}</div> : null;
                        })()}
                        {pen.applies && (
                          <div className="text-rose-700 font-semibold">
                            ⏰ קנס אי-פתיחה: ₪{pen.amount.toLocaleString("he-IL")} · {pen.basis}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {hasGrace && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
                    גרייס: {graceMonths} {graceUnit === "months" ? "חודשים" : "ימים"} |{" "}
                    {GRACE_TYPES.find((g) => g.v === graceType)?.l}
                    {graceType === "partial" && ` | ${graceDiscountPct}% הנחה`}
                    {" | "}שכ&quot;ד בגרייס:{" "}
                    {fmtMoney(
                      graceType === "full"
                        ? 0
                        : graceType === "partial"
                          ? baseRent * (1 - Number(graceDiscountPct) / 100)
                          : 0
                    )}
                  </div>
                  )}
              </div>
            </div>

            {/* Dynamic Step-Rent Builder */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="increase" checked={hasIncrease}
                    onChange={(e) => { setHasIncrease(e.target.checked); if (e.target.checked && priceTiers.length === 0) setPriceTiers([emptyPriceTier(1)]); }}
                    className="w-4 h-4" />
                  <label htmlFor="increase" className="text-sm font-bold text-slate-700">
                    {rentType === "revenue_pct" ? 'עלייה מדורגת בשכ"ד המינימום (Step-Rent)' : 'עלייה מדורגת בשכ"ד (Step-Rent)'}
                  </label>
                </div>
                {hasIncrease && increaseMode === "unified" && (
                  <button type="button" onClick={() => {
                    const last = priceTiers[priceTiers.length - 1];
                    setPriceTiers(prev => [...prev, emptyPriceTier(last ? last.to_year + 1 : 1)]);
                  }} className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-800">
                    + הוסף שלב
                  </button>
                )}
              </div>

              {hasIncrease && rentType === "revenue_pct" && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-3 text-xs text-amber-800 leading-relaxed">
                  בחוזה אחוז-מפדיון המדרגות האלה מעלות את <b>שכ&quot;ד המינימום</b> (הרצפה), לא את האחוז.
                  {minRentSqm > 0
                    ? <span> הבסיס: {fmtMoney(minRentSqm)}/מ&quot;ר לחודש{minRentBasis === "monthly"
                        ? " (נגזר מ-" + fmtMoney(minRentMonthly) + " לחודש ÷ " + leasedArea.toLocaleString("he-IL") + ' מ"ר)' : ""}.</span>
                    : <span> טרם הוזן מינימום — המדרגות יחולו עליו לאחר הזנתו.</span>}
                  {" "}להעלאת <b>האחוז</b> עצמו לאורך השנים — השתמש ב&quot;מדרגות אחוז מהפדיון&quot; בשלב תנאי השכירות.
                </div>
              )}

              {/* Unified / Per-unit toggle — only when multiple spaces with different prices */}
              {hasIncrease && selSpaces.length > 1 && Object.keys(unitRentOverrides).some(k => unitRentOverrides[k]) && (
                <div className="flex gap-2 mb-4">
                  <button type="button" onClick={() => setIncreaseMode("unified")}
                    className={"rounded-lg border px-4 py-2 text-xs font-bold transition-all " +
                      (increaseMode === "unified" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                    מנגנון אחיד לכל היחידות
                  </button>
                  <button type="button" onClick={() => {
                    setIncreaseMode("per_unit");
                    // Initialize perUnitTiers for each space if empty
                    setPerUnitTiers(prev => {
                      const next = { ...prev };
                      selSpaces.forEach(sid => {
                        if (!next[sid] || next[sid].length === 0) {
                          next[sid] = [emptyPriceTier(1)];
                        }
                      });
                      return next;
                    });
                  }}
                    className={"rounded-lg border px-4 py-2 text-xs font-bold transition-all " +
                      (increaseMode === "per_unit" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                    מנגנון נפרד לכל יחידה
                  </button>
                </div>
              )}

              {/* === UNIFIED MODE === */}
              {hasIncrease && increaseMode === "unified" && (() => {
                // Calculate years from actual dates (user may override end date manually)
                var contractYears = leasePeriodUnit === "years" ? leasePeriodValue : Math.ceil(leasePeriodValue / 12);
                if (startDate && endDate) {
                  var diffMs = new Date(endDate).getTime() - new Date(startDate).getTime();
                  var diffYears = Math.ceil(diffMs / (365.25 * 24 * 60 * 60 * 1000));
                  if (diffYears > contractYears) contractYears = diffYears;
                }
                const errors = validatePriceTiers(priceTiers, contractYears);
                // On a revenue lease the steps raise the minimum, so THAT is the
                // base the preview must build on — rentPerSqm is empty there.
                const stepBase = rentType === "revenue_pct" && minRentSqm > 0
                  ? minRentSqm : (Number(rentPerSqm) || 0);
                const previews = calculateTierPreviews(priceTiers, stepBase);
                return (
                  <div className="space-y-3">
                    {errors.length > 0 && (
                      <div className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-1">
                        {errors.map((err, i) => (
                          <div key={i} className="text-xs text-red-600 flex items-center gap-1">
                            <span>⚠️</span> {err}
                          </div>
                        ))}
                      </div>
                    )}

                    {priceTiers.length > 0 && (() => {
                      const sorted = [...priceTiers].sort((a, b) => a.from_year - b.from_year);
                      if (sorted[0]?.from_year > 1) {
                        return (
                          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-700 font-semibold">
                            שנים 1–{sorted[0].from_year}: {fmtMoney(stepBase)}/מ&quot;ר ({rentType === "revenue_pct" ? "מינימום בסיס" : "מחיר בסיס"})
                            <span className="block text-[11px] font-normal opacity-80">
                              העלייה חלה בתום {sorted[0].from_year} שנות שכירות — כלומר מתחילת שנת שכירות {sorted[0].from_year + 1}
                            </span>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {priceTiers.map((tier, idx) => {
                      const preview = previews.find(p => p.from_year === tier.from_year);
                      const hasError = errors.some(e => e.includes(`שלב ${idx + 1}`));
                      return (
                        <div key={idx} className={"rounded-lg border p-4 space-y-3 " + (hasError ? "border-red-300 bg-red-50/50" : "border-slate-100 bg-slate-50")}>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-slate-700">שלב {idx + 1}</span>
                            {priceTiers.length > 1 && (
                              <button type="button" onClick={() => setPriceTiers(prev => prev.filter((_, i) => i !== idx))}
                                className="text-xs text-red-500 hover:text-red-700 font-semibold">🗑 הסר</button>
                            )}
                          </div>

                          <div className="flex gap-2 mb-2 flex-wrap">
                            {/* from == to → fires once. from < to → fires in
                                EVERY year of the range. Two different intents,
                                so two explicit modes — "עד שנה" alone read as
                                "the price holds until year X" and produced
                                overlapping stages plus a warning nobody
                                understood. */}
                            <button type="button" onClick={() => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, is_recurring: false, to_year: t.from_year } : t))}
                              className={"rounded-lg border px-3 py-1.5 text-xs transition-all " +
                                (!tier.is_recurring && tier.to_year === tier.from_year ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-white")}>
                              🪜 מדרגה חד-פעמית
                            </button>
                            <button type="button" onClick={() => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, is_recurring: false, to_year: t.to_year > t.from_year ? t.to_year : t.from_year + 1 } : t))}
                              className={"rounded-lg border px-3 py-1.5 text-xs transition-all " +
                                (!tier.is_recurring && tier.to_year > tier.from_year ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-white")}>
                              📅 עלייה בכל שנה בטווח
                            </button>
                            <button type="button" onClick={() => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, is_recurring: true } : t))}
                              className={"rounded-lg border px-3 py-1.5 text-xs transition-all " +
                                (tier.is_recurring ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-white")}>
                              🔁 כל X שנים
                            </button>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {!tier.is_recurring && tier.to_year === tier.from_year ? (
                              <div>
                                <label className="mb-1 block text-xs text-slate-500">בתום שנת שכירות</label>
                                <input type="number" min="1" value={tier.from_year}
                                  onChange={(e) => { var v = Number(e.target.value) || 1; setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, from_year: v, to_year: v } : t)); }}
                                  className={ic} />
                                <div className="text-[10px] text-slate-400 mt-0.5">המחיר החדש חל משנת השכירות הבאה</div>
                              </div>
                            ) : !tier.is_recurring ? (
                              <>
                                <div>
                                  <label className="mb-1 block text-xs text-slate-500">מתום שנת שכירות</label>
                                  <input type="number" min="1" value={tier.from_year}
                                    onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, from_year: Number(e.target.value) || 1 } : t))}
                                    className={ic} />
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs text-slate-500">עד תום שנה</label>
                                  <input type="number" min="1" value={tier.to_year}
                                    onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, to_year: Number(e.target.value) || 1 } : t))}
                                    className={ic} />
                                  <div className="text-[10px] text-amber-600 mt-0.5">העלייה חלה בכל אחת מהשנים בטווח</div>
                                </div>
                              </>
                            ) : (
                              <>
                                <div>
                                  <label className="mb-1 block text-xs text-slate-500">כל X שנים</label>
                                  <input type="number" min="1" max="10" value={tier.recurring_every_years ?? 1}
                                    onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, recurring_every_years: Number(e.target.value) || 1 } : t))}
                                    className={ic} />
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs text-slate-500">עד שנה</label>
                                  <input type="number" min="1" value={tier.to_year}
                                    onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, to_year: Number(e.target.value) || 1 } : t))}
                                    className={ic} />
                                </div>
                              </>
                            )}

                            <div className="col-span-2">
                              <label className="mb-1 block text-xs text-slate-500">סוג עלייה</label>
                              <div className="flex gap-1 flex-wrap">
                                {INCREASE_TYPES.map((it) => (
                                  <button key={it.v} type="button"
                                    onClick={() => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, increase_type: it.v as any } : t))}
                                    className={"rounded border px-2.5 py-1.5 text-xs transition-all " +
                                      (tier.increase_type === it.v ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-white")}>
                                    {it.icon} {it.l}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {tier.increase_type !== "none" && (
                            <div className="max-w-xs">
                              <label className="mb-1 block text-xs text-slate-500">
                                {tier.increase_type === "pct" ? "שיעור עלייה (%)" :
                                 tier.increase_type === "fixed_sqm" ? 'תוספת למ"ר (₪)' :
                                 "תוספת קבועה לחודש (₪)"}
                              </label>
                              <input type="number" step="0.1" value={tier.increase_value || ""}
                                onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, increase_value: Number(e.target.value) || 0 } : t))}
                                className={ic} />
                            </div>
                          )}

                          <div>
                            <input type="text" value={tier.notes} placeholder="הערות (אופציונלי)"
                              onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, notes: e.target.value } : t))}
                              className={ic + " text-xs"} />
                          </div>

                          {stepBase > 0 && (function() {
                            var expanded = calculateTierPreviews([tier], idx === 0 ? stepBase : (previews[idx-1]?.calculated_rent_per_sqm ?? stepBase));
                            if (!expanded.length) return null;
                            return (
                              <div className={"rounded-lg px-3 py-2 text-xs font-semibold space-y-0.5 " + (hasError ? "bg-red-100 text-red-700" : "bg-green-50 border border-green-200 text-green-700")}>
                                {expanded.map(function(exp, ei) {
                                  return (
                                    <div key={ei}>
                                      בתום שנה {exp.from_year} → משנת שכירות {exp.from_year + 1}: {exp.increase_type === "none"
                                        ? `מחיר קפוא — ${fmtMoney(stepBase)}/מ"ר`
                                        : exp.increase_type === "fixed_total"
                                          ? `+${fmtMoney(exp.increase_value)} → ${fmtMoney(exp.calculated_rent_per_sqm)}/מ"ר`
                                          : `${fmtMoney(exp.calculated_rent_per_sqm)}/מ"ר`}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}

                    <button type="button" onClick={() => {
                      const last = priceTiers[priceTiers.length - 1];
                      setPriceTiers(prev => [...prev, emptyPriceTier(last ? last.to_year + 1 : 1)]);
                    }} className="rounded-lg border-2 border-dashed border-blue-300 px-4 py-3 text-xs font-bold text-blue-600 hover:bg-blue-50 w-full transition-all">
                      + הוסף שלב עלייה נוסף
                    </button>
                  </div>
                );
              })()}

              {/* === PER-UNIT MODE === */}
              {hasIncrease && increaseMode === "per_unit" && (() => {
                var contractYears = leasePeriodUnit === "years" ? leasePeriodValue : Math.ceil(leasePeriodValue / 12);
                if (startDate && endDate) {
                  var diffMs = new Date(endDate).getTime() - new Date(startDate).getTime();
                  var diffYears = Math.ceil(diffMs / (365.25 * 24 * 60 * 60 * 1000));
                  if (diffYears > contractYears) contractYears = diffYears;
                }
                return (
                  <div className="space-y-4">
                    {selSpaces.map(function(sid) {
                      var sp = spaces.find(function(s) { return s.id === sid; });
                      if (!sp) return null;
                      var rType = unitRentTypes[sid] || "per_sqm";
                      var rVal = Number(unitRentOverrides[sid]) || Number(rentPerSqm) || 0;
                      var unitTiers = perUnitTiers[sid] || [];
                      var errors = validatePriceTiers(unitTiers, contractYears);
                      var previews = calculateTierPreviews(unitTiers, rVal);
                      return (
                        <div key={sid} className="rounded-xl border border-orange-200 bg-orange-50/30 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-slate-700">{sp.space_name}</span>
                              <span className="text-xs text-slate-400">{sp.area} מ&quot;ר</span>
                              <span className="text-xs font-semibold text-green-700">
                                {rType === "fixed" ? fmtMoney(rVal) + "/חודש" : fmtMoney(rVal) + '/מ"ר'}
                              </span>
                            </div>
                            <button type="button" onClick={function() {
                              setPerUnitTiers(function(prev) {
                                var next = { ...prev };
                                var last = unitTiers[unitTiers.length - 1];
                                next[sid] = [...unitTiers, emptyPriceTier(last ? last.to_year + 1 : 1)];
                                return next;
                              });
                            }} className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-700">
                              + שלב
                            </button>
                          </div>

                          {errors.length > 0 && (
                            <div className="rounded-lg bg-red-50 border border-red-200 p-2 space-y-1">
                              {errors.map(function(err, i) { return (
                                <div key={i} className="text-xs text-red-600">⚠️ {err}</div>
                              ); })}
                            </div>
                          )}

                          {unitTiers.map(function(tier, idx) {
                            var hasError = errors.some(function(e) { return e.includes("שלב " + (idx + 1)); });
                            return (
                              <div key={idx} className={"rounded-lg border p-3 space-y-2 " + (hasError ? "border-red-300 bg-red-50/50" : "border-slate-100 bg-white")}>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-600">שלב {idx + 1}</span>
                                  {unitTiers.length > 1 && (
                                    <button type="button" onClick={function() {
                                      setPerUnitTiers(function(prev) {
                                        var next = { ...prev };
                                        next[sid] = unitTiers.filter(function(_, i) { return i !== idx; });
                                        return next;
                                      });
                                    }} className="text-xs text-red-500 hover:text-red-700 font-semibold">🗑</button>
                                  )}
                                </div>

                                <div className="flex gap-2 mb-1">
                                  <button type="button" onClick={function() {
                                    setPerUnitTiers(function(prev) {
                                      var next = { ...prev };
                                      next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, is_recurring: false } : t; });
                                      return next;
                                    });
                                  }} className={"rounded border px-2 py-1 text-[10px] " + (!tier.is_recurring ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200")}>
                                    📅 טווח
                                  </button>
                                  <button type="button" onClick={function() {
                                    setPerUnitTiers(function(prev) {
                                      var next = { ...prev };
                                      next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, is_recurring: true } : t; });
                                      return next;
                                    });
                                  }} className={"rounded border px-2 py-1 text-[10px] " + (tier.is_recurring ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200")}>
                                    🔁 חוזר
                                  </button>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                  {!tier.is_recurring ? (
                                    <>
                                      <div>
                                        <label className="mb-0.5 block text-[10px] text-slate-400">משנה</label>
                                        <input type="number" min="1" value={tier.from_year}
                                          onChange={function(e) {
                                            setPerUnitTiers(function(prev) {
                                              var next = { ...prev };
                                              next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, from_year: Number(e.target.value) || 1 } : t; });
                                              return next;
                                            });
                                          }} className={ic + " text-xs"} />
                                      </div>
                                      <div>
                                        <label className="mb-0.5 block text-[10px] text-slate-400">עד שנה</label>
                                        <input type="number" min="1" value={tier.to_year}
                                          onChange={function(e) {
                                            setPerUnitTiers(function(prev) {
                                              var next = { ...prev };
                                              next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, to_year: Number(e.target.value) || 1 } : t; });
                                              return next;
                                            });
                                          }} className={ic + " text-xs"} />
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <div>
                                        <label className="mb-0.5 block text-[10px] text-slate-400">כל X שנים</label>
                                        <input type="number" min="1" max="10" value={tier.recurring_every_years ?? 1}
                                          onChange={function(e) {
                                            setPerUnitTiers(function(prev) {
                                              var next = { ...prev };
                                              next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, recurring_every_years: Number(e.target.value) || 1 } : t; });
                                              return next;
                                            });
                                          }} className={ic + " text-xs"} />
                                      </div>
                                      <div>
                                        <label className="mb-0.5 block text-[10px] text-slate-400">עד שנה</label>
                                        <input type="number" min="1" value={tier.to_year}
                                          onChange={function(e) {
                                            setPerUnitTiers(function(prev) {
                                              var next = { ...prev };
                                              next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, to_year: Number(e.target.value) || 1 } : t; });
                                              return next;
                                            });
                                          }} className={ic + " text-xs"} />
                                      </div>
                                    </>
                                  )}

                                  <div className="col-span-2">
                                    <label className="mb-0.5 block text-[10px] text-slate-400">סוג עלייה</label>
                                    <div className="flex gap-1 flex-wrap">
                                      {INCREASE_TYPES.map(function(it) { return (
                                        <button key={it.v} type="button"
                                          onClick={function() {
                                            setPerUnitTiers(function(prev) {
                                              var next = { ...prev };
                                              next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, increase_type: it.v as PriceTier["increase_type"] } : t; });
                                              return next;
                                            });
                                          }}
                                          className={"rounded border px-2 py-1 text-[10px] " +
                                            (tier.increase_type === it.v ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-white")}>
                                          {it.icon} {it.l}
                                        </button>
                                      ); })}
                                    </div>
                                  </div>
                                </div>

                                {tier.increase_type !== "none" && (
                                  <div className="max-w-40">
                                    <input type="number" step="0.1" value={tier.increase_value || ""}
                                      onChange={function(e) {
                                        setPerUnitTiers(function(prev) {
                                          var next = { ...prev };
                                          next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, increase_value: Number(e.target.value) || 0 } : t; });
                                          return next;
                                        });
                                      }}
                                      placeholder={tier.increase_type === "pct" ? "%" : "₪"}
                                      className={ic + " text-xs"} />
                                  </div>
                                )}

                                {/* Per-unit preview */}
                                {rVal > 0 && (function() {
                                  var expanded = calculateTierPreviews([tier], idx === 0 ? rVal : (previews[idx-1]?.calculated_rent_per_sqm ?? rVal));
                                  if (!expanded.length) return null;
                                  return (
                                    <div className="rounded-lg px-2 py-1.5 text-[10px] font-semibold bg-green-50 border border-green-200 text-green-700 space-y-0.5">
                                      {expanded.map(function(exp, ei) {
                                        return (
                                          <div key={ei}>
                                            שנים {exp.from_year}-{exp.to_year}: {exp.increase_type === "none"
                                              ? "הקפאה"
                                              : exp.increase_type === "fixed_total"
                                                ? "+" + fmtMoney(exp.increase_value) + " → " + fmtMoney(exp.calculated_rent_per_sqm) + (rType === "fixed" ? "/חודש" : '/מ"ר')
                                                : fmtMoney(exp.calculated_rent_per_sqm) + (rType === "fixed" ? "/חודש" : '/מ"ר')}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {!hasIncrease && (
                <div className="text-xs text-slate-400 mt-1">ללא עלייה שנתית (מעבר להצמדה)</div>
              )}
            </div>
          </div>
        )}

        {/* STEP 4 — אופציות להארכה */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800 text-lg">🔄 אופציות להארכת חוזה</h2>
              <div className="flex gap-2">
                <button type="button" onClick={() => setExtensionOptions((prev) => [...prev, emptyOption()])}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800">+ אופציה רציפה</button>
                <button type="button" onClick={() => {
                  // Find existing groups to determine next letter
                  var groups = extensionOptions.map(function(o) { return o.option_group; }).filter(Boolean);
                  var nextGroup = "A";
                  if (groups.length > 0) {
                    var lastGroup = groups.sort().pop() || "A";
                    nextGroup = String.fromCharCode(lastGroup.charCodeAt(0) + 1);
                  }
                  // If no group exists yet, mark the last option as group A and add B
                  if (groups.length === 0 && extensionOptions.length > 0) {
                    setExtensionOptions(function(prev) {
                      var updated = [...prev];
                      updated[updated.length - 1] = { ...updated[updated.length - 1], option_group: "A" };
                      return [...updated, emptyOption("B")];
                    });
                  } else {
                    setExtensionOptions(function(prev) { return [...prev, emptyOption(nextGroup)]; });
                  }
                }}
                  className="rounded-lg border border-purple-400 bg-purple-50 px-4 py-2 text-xs font-bold text-purple-700 hover:bg-purple-100">+ אופציה חלופית (A/B)</button>
              </div>
            </div>

            {extensionOptions.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-400">
                <div className="text-4xl mb-2">📋</div>
                <div className="text-sm">אין אופציות — לחץ להוספה (אופציונלי)</div>
              </div>
            ) : (
              extensionOptions.map((opt, idx) => (
                <div key={idx} className={"rounded-xl border p-4 space-y-3 " + (opt.option_group ? "border-purple-300 bg-purple-50/30" : "border-slate-200")}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-700 text-sm">אופציה {idx + 1}</span>
                      {opt.option_group && (
                        <span className="rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-[10px] font-bold">
                          חלופה {opt.option_group}
                        </span>
                      )}
                    </div>
                    <button type="button" onClick={() => removeOption(idx)} className="text-xs text-red-500 hover:text-red-700 font-semibold">🗑 הסר</button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">תקופה *</label>
                      <div className="flex gap-1">
                        <input type="number" min="0" step="any" value={opt.duration_years || ""}
                          onChange={(e) => { const v = Number(e.target.value) || 0; updateOption(idx, "duration_years", v); updateOption(idx, "duration_months", Math.round(v * 12)); }}
                          placeholder="שנים" className={ic + " flex-1"} />
                        <span className="flex items-center text-xs text-slate-400 px-1">או</span>
                        <input type="number" min="0" value={opt.duration_months || ""}
                          onChange={(e) => { const m = Number(e.target.value) || 0; updateOption(idx, "duration_months", m); updateOption(idx, "duration_years", Math.round(m / 12 * 100) / 100); }}
                          placeholder="חודשים" className={ic + " flex-1"} />
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {opt.duration_years ? `${opt.duration_years} שנים` : ""}{opt.duration_years && opt.duration_months ? " = " : ""}{opt.duration_months ? `${opt.duration_months} חודשים` : ""}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">סוג הודעה</label>
                      <select value={opt.notice_type} onChange={(e) => updateOption(idx, "notice_type", e.target.value)} className={ic}>
                        {NOTICE_TYPES.map((nt) => (<option key={nt.v} value={nt.v}>{nt.l}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">ימי הודעה מראש</label>
                      <input type="number" min="0" value={opt.notice_days_before_end}
                        onChange={(e) => updateOption(idx, "notice_days_before_end", Number(e.target.value) || 0)} className={ic} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">קפיצת מחיר בעת מימוש</label>
                      <select value={opt.rent_mechanism} onChange={(e) => updateOption(idx, "rent_mechanism", e.target.value)} className={ic}>
                        {RENT_MECHANISMS.map((rm) => (<option key={rm.v} value={rm.v}>{rm.l}</option>))}
                      </select>
                    </div>
                    {opt.rent_mechanism === "increase_pct" && (
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">אחוז עלייה (%)</label>
                        <input type="number" value={opt.rent_increase_pct ?? ""}
                          onChange={(e) => updateOption(idx, "rent_increase_pct", Number(e.target.value) || null)} className={ic} />
                      </div>
                    )}
                    {opt.rent_mechanism === "new_value" && (
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          {rentType === "revenue_pct" ? 'מינימום חדש למ"ר (₪)' : 'מחיר חדש למ"ר (₪)'}
                        </label>
                        <input type="number" value={opt.new_rent_value ?? ""}
                          onChange={(e) => updateOption(idx, "new_rent_value", Number(e.target.value) || null)} className={ic} />
                      </div>
                    )}
                  </div>

                  {/* On a revenue lease the mechanism above moves the MINIMUM.
                      The percentage is its own schedule, so it gets its own editor. */}
                  {rentType === "revenue_pct" && (
                    <div className="space-y-2">
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 leading-relaxed">
                        בחוזה אחוז-מפדיון &quot;קפיצת המחיר בעת מימוש&quot; ומדרגות המחיר של האופציה מתייחסות ל<b>שכ&quot;ד המינימום</b>.
                        לשינוי <b>האחוז</b> בתקופת האופציה — הזן מדרגות כאן (שנה 1 = השנה הראשונה של האופציה).
                      </div>
                      <RevenuePctTiersEditor
                        basePct={Number(revenuePct) || 0}
                        tiers={(opt.revenue_pct_tiers || []) as RevenuePctTier[]}
                        onChange={(t) => updateOption(idx, "revenue_pct_tiers", t)}
                        contractYears={opt.duration_years || Math.ceil((opt.duration_months || 0) / 12)}
                        title={"מדרגות אחוז מהפדיון — אופציה " + (idx + 1)} />
                    </div>
                  )}

                  {/* Dates */}
                  {opt.start_date && opt.end_date && (
                    <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 flex justify-between text-xs text-green-700">
                      <span>תחילה: {new Date(opt.start_date).toLocaleDateString("he-IL")}</span>
                      <span>סיום: {new Date(opt.end_date).toLocaleDateString("he-IL")}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={opt.auto_renewal}
                      onChange={(e) => updateOption(idx, "auto_renewal", e.target.checked)} className="w-4 h-4" />
                    <label className="text-xs font-semibold text-slate-700">הארכה אוטומטית (אם לא נמסרה הודעה)</label>
                  </div>

                  {/* ── Price Schedule within Option ── */}
                  {opt.duration_years > 1 && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-blue-800">מנגנון עליית מחיר בתקופת אופציה:</label>
                        <div className="flex gap-1">
                          <button type="button" onClick={() => updateOption(idx, "price_schedule_type", "inherit")}
                            className={"rounded border px-2.5 py-1 text-xs transition-all " + (opt.price_schedule_type === "inherit" ? "border-blue-500 bg-blue-100 font-bold text-blue-700" : "border-slate-200 bg-white hover:bg-slate-50")}>
                            המשך מחוזה ראשי
                          </button>
                          <button type="button" onClick={() => {
                            updateOption(idx, "price_schedule_type", "custom");
                            if (!opt.price_tiers || opt.price_tiers.length === 0) updateOption(idx, "price_tiers", [emptyPriceTier(1)]);
                          }}
                            className={"rounded border px-2.5 py-1 text-xs transition-all " + (opt.price_schedule_type === "custom" ? "border-blue-500 bg-blue-100 font-bold text-blue-700" : "border-slate-200 bg-white hover:bg-slate-50")}>
                            לוגיקה מותאמת
                          </button>
                        </div>
                      </div>

                      {opt.price_schedule_type === "custom" && (
                        <div className="space-y-2">
                          {(opt.price_tiers || []).map((tier, tIdx) => {
                            const optYears = opt.duration_years;
                            const hasError = tier.from_year > tier.to_year || tier.to_year > optYears;
                            return (
                              <div key={tIdx} className={"rounded-lg border p-3 space-y-2 " + (hasError ? "border-red-300 bg-red-50/50" : "border-slate-100 bg-white")}>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-600">שלב {tIdx + 1} (אופציה {idx + 1})</span>
                                  {(opt.price_tiers || []).length > 1 && (
                                    <button type="button" onClick={() => {
                                      const newTiers = (opt.price_tiers || []).filter((_: any, i: number) => i !== tIdx);
                                      updateOption(idx, "price_tiers", newTiers);
                                    }} className="text-xs text-red-500">הסר</button>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                  <div>
                                    <label className="mb-1 block text-xs text-slate-500">משנה</label>
                                    <input type="number" min="1" max={optYears} value={tier.from_year}
                                      onChange={(e) => {
                                        const newTiers = [...(opt.price_tiers || [])];
                                        newTiers[tIdx] = { ...newTiers[tIdx], from_year: Number(e.target.value) || 1 };
                                        updateOption(idx, "price_tiers", newTiers);
                                      }} className={ic} />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs text-slate-500">עד שנה</label>
                                    <input type="number" min="1" max={optYears} value={tier.to_year}
                                      onChange={(e) => {
                                        const newTiers = [...(opt.price_tiers || [])];
                                        newTiers[tIdx] = { ...newTiers[tIdx], to_year: Number(e.target.value) || 1 };
                                        updateOption(idx, "price_tiers", newTiers);
                                      }} className={ic} />
                                  </div>
                                  <div className="col-span-2">
                                    <label className="mb-1 block text-xs text-slate-500">סוג</label>
                                    <div className="flex gap-1 flex-wrap">
                                      {INCREASE_TYPES.map((it) => (
                                        <button key={it.v} type="button" onClick={() => {
                                          const newTiers = [...(opt.price_tiers || [])];
                                          newTiers[tIdx] = { ...newTiers[tIdx], increase_type: it.v as any };
                                          updateOption(idx, "price_tiers", newTiers);
                                        }} className={"rounded border px-2 py-1 text-xs " + (tier.increase_type === it.v ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200")}>
                                          {it.icon} {it.l}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                                {tier.increase_type !== "none" && (
                                  <div className="max-w-[200px]">
                                    <label className="mb-1 block text-xs text-slate-500">
                                      {tier.increase_type === "pct" ? "% עלייה" : tier.increase_type === "fixed_sqm" ? '₪/מ"ר' : "סכום קבוע (₪)"}
                                    </label>
                                    <input type="number" step="0.1" value={tier.increase_value || ""}
                                      onChange={(e) => {
                                        const newTiers = [...(opt.price_tiers || [])];
                                        newTiers[tIdx] = { ...newTiers[tIdx], increase_value: Number(e.target.value) || 0 };
                                        updateOption(idx, "price_tiers", newTiers);
                                      }} className={ic} />
                                  </div>
                                )}
                                {hasError && <div className="text-xs text-red-500">⚠️ שנים חורגות מתקופת האופציה ({optYears} שנים)</div>}
                              </div>
                            );
                          })}
                          <button type="button" onClick={() => {
                            const tiers = opt.price_tiers || [];
                            const last = tiers[tiers.length - 1];
                            updateOption(idx, "price_tiers", [...tiers, emptyPriceTier(last ? last.to_year + 1 : 1)]);
                          }} className="rounded border border-dashed border-blue-300 px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 w-full">
                            + שלב עלייה נוסף באופציה
                          </button>

                          {/* Price preview per tier */}
                          {(() => {
                            // Chain from main contract → previous options → this option
                            let optBase = Number(rentPerSqm) || 0;
                            if (priceTiers.length > 0) {
                              const mainPrev = calculateTierPreviews(priceTiers, optBase);
                              optBase = mainPrev[mainPrev.length - 1]?.calculated_rent_per_sqm ?? optBase;
                            }
                            // Apply previous options' increases
                            for (let pi = 0; pi < idx; pi++) {
                              const prevOpt = extensionOptions[pi];
                              if (prevOpt.rent_mechanism === "increase_pct" && prevOpt.rent_increase_pct) {
                                optBase = optBase * (1 + prevOpt.rent_increase_pct / 100);
                              } else if (prevOpt.rent_mechanism === "new_value" && prevOpt.new_rent_value) {
                                optBase = prevOpt.new_rent_value;
                              }
                              // Apply internal option tiers
                              if (prevOpt.price_schedule_type === "custom" && prevOpt.price_tiers?.length > 0) {
                                const prevPreviews = calculateTierPreviews(prevOpt.price_tiers, optBase);
                                optBase = prevPreviews[prevPreviews.length - 1]?.calculated_rent_per_sqm ?? optBase;
                              }
                            }
                            // Apply THIS option's exercise jump
                            if (opt.rent_mechanism === "increase_pct" && opt.rent_increase_pct) optBase = optBase * (1 + opt.rent_increase_pct / 100);
                            else if (opt.rent_mechanism === "new_value" && opt.new_rent_value) optBase = opt.new_rent_value;
                            const optRoundBase = Math.round(optBase * 100) / 100;
                            const tiers = opt.price_tiers || [];
                            const previews = calculateTierPreviews(tiers, optRoundBase);
                            const sorted = [...tiers].sort((a, b) => a.from_year - b.from_year);
                            const firstYear = sorted[0]?.from_year ?? 1;
                            return (
                              <div className="rounded-lg bg-green-50 border border-green-200 p-3 mt-2">
                                <div className="text-xs font-bold text-green-700 mb-1">📊 תצוגת מחירים מחושבת (אופציה)</div>
                                {/* Base period before first tier */}
                                {firstYear > 1 && (
                                  <div className="flex justify-between text-xs text-green-800 py-1 border-b border-green-100">
                                    <span>שנים 1–{firstYear - 1}: מחיר פתיחה (קפיצה {opt.rent_mechanism === "increase_pct" ? `+${opt.rent_increase_pct}%` : ""})</span>
                                    <span className="font-black">{fmtMoney(optRoundBase)}/מ&quot;ר</span>
                                  </div>
                                )}
                                {previews.map((p, pi) => (
                                  <div key={pi} className="flex justify-between text-xs text-green-800 py-1 border-b border-green-100 last:border-0">
                                    <span>שנים {p.from_year}–{p.to_year}: {p.increase_type === "none" ? "ללא שינוי" : p.increase_type === "pct" ? `+${p.increase_value}%` : `+₪${p.increase_value}`}</span>
                                    <span className="font-black">{fmtMoney(p.calculated_rent_per_sqm)}/מ&quot;ר</span>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      {opt.price_schedule_type === "inherit" && (
                        <div className="text-xs text-blue-600">ממשיך את מנגנון העלייה של החוזה הראשי</div>
                      )}
                    </div>
                  )}

                  {/* Exit points */}
                  {opt.duration_years > 1 && (
                    <div className="rounded-lg border border-orange-200 bg-orange-50/30 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-orange-800">🚪 נקודות יציאה</label>
                        <button type="button" onClick={() => {
                          var exits = opt.exit_points || [];
                          updateOption(idx, "exit_points", [...exits, { year: 1, notice_days: 180, penalty_months: 0 }]);
                        }} className="text-[10px] text-orange-600 hover:text-orange-800 font-semibold">+ נקודת יציאה</button>
                      </div>
                      {(opt.exit_points || []).length === 0 ? (
                        <div className="text-[10px] text-orange-500">אין נקודות יציאה</div>
                      ) : (
                        (opt.exit_points || []).map(function(ep: any, epIdx: number) {
                          return (
                            <div key={epIdx} className="rounded border border-orange-200 bg-white p-2 flex items-center gap-2 text-xs">
                              <span className="text-orange-700">שנה</span>
                              <input type="number" min="1" max={opt.duration_years} value={ep.year}
                                onChange={(e) => {
                                  var exits = [...(opt.exit_points || [])];
                                  exits[epIdx] = { ...exits[epIdx], year: Number(e.target.value) };
                                  updateOption(idx, "exit_points", exits);
                                }} className="w-16 rounded border border-slate-200 px-2 py-1 text-center text-xs" />
                              <span className="text-orange-700">הודעה (ימים)</span>
                              <input type="number" min="0" value={ep.notice_days}
                                onChange={(e) => {
                                  var exits = [...(opt.exit_points || [])];
                                  exits[epIdx] = { ...exits[epIdx], notice_days: Number(e.target.value) };
                                  updateOption(idx, "exit_points", exits);
                                }} className="w-16 rounded border border-slate-200 px-2 py-1 text-center text-xs" />
                              <span className="text-orange-700">קנס (חודשים)</span>
                              <input type="number" min="0" value={ep.penalty_months}
                                onChange={(e) => {
                                  var exits = [...(opt.exit_points || [])];
                                  exits[epIdx] = { ...exits[epIdx], penalty_months: Number(e.target.value) };
                                  updateOption(idx, "exit_points", exits);
                                }} className="w-16 rounded border border-slate-200 px-2 py-1 text-center text-xs" />
                              <button type="button" onClick={() => {
                                var exits = [...(opt.exit_points || [])];
                                exits.splice(epIdx, 1);
                                updateOption(idx, "exit_points", exits);
                              }} className="text-red-400 hover:text-red-600">✕</button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {rentType === "revenue_pct" && revProtection.type === "refund_gap" && (
                    <label className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50/40 p-2.5 text-xs text-slate-700">
                      <input type="checkbox" checked={!!(opt as any).cancels_revenue_protection}
                        onChange={(e) => updateOption(idx, "cancels_revenue_protection", e.target.checked)} className="rounded mt-0.5" />
                      <span>
                        <b>מימוש אופציה זו מבטל את ההגנה על שכ&quot;ד</b>
                        <span className="block text-[11px] text-blue-600 mt-0.5">
                          ההגנה תיפסק ביום שתקופת האופציה מתחילה, גם אם נותרו לה חודשים.
                        </span>
                      </span>
                    </label>
                  )}

                  {/* Compensation if this option is not exercised */}
                  <OptionPenaltyFields
                    value={opt.non_exercise_penalty}
                    onChange={(next) => updateOption(idx, "non_exercise_penalty", next)}
                    area={penaltyPreviewArea}
                    baseTermMonths={leasePeriodUnit === "years" ? Number(leasePeriodValue) * 12 : Number(leasePeriodValue)}
                    optionMonths={opt.duration_months || (opt.duration_years || 0) * 12}
                  />

                  {/* Year-by-year price forecast */}
                  {opt.duration_years > 0 && Number(rentPerSqm) > 0 && (function() {
                    var forecastBase = Number(rentPerSqm) || 0;
                    if (priceTiers.length > 0) {
                      var mp = calculateTierPreviews(priceTiers, forecastBase);
                      forecastBase = mp[mp.length - 1]?.calculated_rent_per_sqm ?? forecastBase;
                    }
                    if (!opt.option_group) {
                      for (var pi = 0; pi < idx; pi++) {
                        var prev = extensionOptions[pi];
                        if (prev.rent_mechanism === "increase_pct" && prev.rent_increase_pct) forecastBase = forecastBase * (1 + prev.rent_increase_pct / 100);
                        else if (prev.rent_mechanism === "new_value" && prev.new_rent_value) forecastBase = prev.new_rent_value;
                        if (prev.price_schedule_type === "custom" && prev.price_tiers?.length > 0) {
                          var pp = calculateTierPreviews(prev.price_tiers, forecastBase);
                          forecastBase = pp[pp.length - 1]?.calculated_rent_per_sqm ?? forecastBase;
                        }
                      }
                    }
                    if (opt.rent_mechanism === "increase_pct" && opt.rent_increase_pct) forecastBase = forecastBase * (1 + opt.rent_increase_pct / 100);
                    else if (opt.rent_mechanism === "new_value" && opt.new_rent_value) forecastBase = opt.new_rent_value;
                    forecastBase = Math.round(forecastBase * 100) / 100;

                    var years = Math.ceil(opt.duration_years);
                    var forecast: Array<{year: number; rent: number; label: string}> = [];

                    if (opt.price_schedule_type === "custom" && opt.price_tiers?.length > 0) {
                      var expanded = calculateTierPreviews(opt.price_tiers, forecastBase);
                      forecast.push({ year: 1, rent: forecastBase, label: "בסיס" });
                      expanded.forEach(function(t) { forecast.push({ year: t.to_year, rent: t.calculated_rent_per_sqm ?? forecastBase, label: t.increase_type === "pct" ? "+" + t.increase_value + "%" : t.increase_type === "fixed_sqm" ? "+₪" + t.increase_value : "" }); });
                    } else if (priceTiers.length > 0 && priceTiers.some(function(t) { return t.increase_value > 0; })) {
                      forecast.push({ year: 1, rent: forecastBase, label: "בסיס (מימוש)" });
                      // Apply main contract's recurring tiers to option period
                      var recurringTier = priceTiers.find(function(t) { return t.is_recurring; });
                      if (recurringTier && recurringTier.increase_value > 0) {
                        var curRent = forecastBase;
                        var every = recurringTier.recurring_every_years || 1;
                        for (var yr = 2; yr <= years; yr++) {
                          if ((yr - 1) % every === 0) {
                            if (recurringTier.increase_type === "pct") curRent = curRent * (1 + recurringTier.increase_value / 100);
                            else if (recurringTier.increase_type === "fixed_sqm") curRent = curRent + recurringTier.increase_value;
                            else if (recurringTier.increase_type === "fixed_total") curRent = curRent + recurringTier.increase_value;
                          }
                          forecast.push({ year: yr, rent: Math.round(curRent * 100) / 100, label: yr === years ? "סוף אופציה" : "" });
                        }
                      }
                    } else {
                      // No tiers — show all years at same price
                      for (var yr = 1; yr <= years; yr++) {
                        forecast.push({ year: yr, rent: forecastBase, label: yr === 1 ? "קבוע" : "" });
                      }
                    }

                    if (forecast.length === 0) return null;
                    return (
                      <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3">
                        <div className="text-xs font-bold text-blue-800 mb-2">📊 תחזית שכ&quot;ד באופציה</div>
                        <div className="space-y-1">
                          {forecast.map(function(f, fi) {
                            return (
                              <div key={fi} className="flex justify-between text-xs">
                                <span className="text-blue-700">שנה {f.year}: <span className="text-blue-500">{f.label}</span></span>
                                <span className="font-bold text-blue-900">₪{f.rent.toFixed(2)}/מ&quot;ר</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                    <input type="text" value={opt.notes} onChange={(e) => updateOption(idx, "notes", e.target.value)}
                      placeholder="הערות לאופציה..." className={ic} />
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* STEP 5 — ביטחונות */}
        {step === 5 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 text-lg mb-4">
              🏦 ביטחונות
            </h2>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="guar"
                checked={addGuarantee}
                onChange={(e) => setAddGuarantee(e.target.checked)}
                className="w-4 h-4"
              />
              <label
                htmlFor="guar"
                className="text-sm font-semibold text-slate-700"
              >
                הוסף ערבות לחוזה
              </label>
            </div>
            {addGuarantee && (
              <div className="space-y-3">
                {/* Guarantee type */}
                <div className="grid grid-cols-2 sm:grid-cols-3 sm:grid-cols-5 gap-2">
                  {GUARANTEE_TYPES.map((t) => (
                    <button
                      key={t.v}
                      type="button"
                      onClick={() => {
                        if (guaranteeType === t.v) return;
                        // Anything already entered on the current security means
                        // switching would throw it away — offer to keep it and
                        // add the new one alongside, which is what a contract
                        // with two securities actually needs.
                        var curLabel = GUARANTEE_TYPES.find(g => g.v === guaranteeType)?.l || "הביטחון הנוכחי";
                        var hasData = !!(guaranteeAmt || guaranteeBank || guaranteeEnd || guaranteeDocUrl || guarantors.some(g => g.name));
                        if (hasData) {
                          var addBoth = confirm(
                            'כבר הוזן ' + curLabel + '.\n\n' +
                            'אישור — ' + t.l + ' יתווסף כביטחון נוסף, ו' + curLabel + ' יישמר.\n' +
                            'ביטול — ' + curLabel + ' יוחלף ב' + t.l + ' (הנתונים שהוזנו יימחקו).'
                          );
                          if (addBoth) {
                            setAdditionalGuarantees(prev => prev.concat([emptyExtraGuarantee(t.v)]));
                            return;
                          }
                        }
                        setGuaranteeType(t.v);
                      }}
                      className={
                        "rounded-xl border p-2.5 text-center " +
                        (guaranteeType === t.v
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200")
                      }
                    >
                      <div>{t.icon}</div>
                      <div
                        className={
                          "text-xs font-semibold " +
                          (guaranteeType === t.v
                            ? "text-blue-700"
                            : "text-slate-600")
                        }
                      >
                        {t.l}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Additional securities — most contracts also carry a שטר חוב
                    alongside the bank guarantee. Each is saved as its own
                    guarantee row with its amount, issuer, expiry and guarantors. */}
                <ExtraGuaranteesEditor
                  value={additionalGuarantees}
                  onChange={setAdditionalGuarantees}
                  inputClass={ic}
                  monthlyRent={guaranteeMonthlyRent}
                  mgmtFeeMonthly={mgmtFeeMonthly}
                  vatPct={vatType === "taxable" ? currentVatPct : 0}
                  rentLabel={rentType === "revenue_pct" ? 'שכ"ד מינימום' : 'שכ"ד'}
                />

                {/* Everything the contract will actually be secured by, in one
                    line — a security that was replaced rather than added used to
                    disappear with nothing on screen to show it. */}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-900">
                  <b>ביטחונות שיישמרו בהסכם ({1 + additionalGuarantees.length}):</b>{" "}
                  {(GUARANTEE_TYPES.find(g => g.v === guaranteeType)?.l || guaranteeType)}
                  {Number(guaranteeAmt) > 0 ? " " + fmtMoney(Number(guaranteeAmt)) : ""}
                  {additionalGuarantees.map(function(e, i){
                    var lbl = GUARANTEE_TYPES.find(g => g.v === e.type)?.l || e.type;
                    return " · " + lbl + (Number(e.amount_required) > 0 ? " " + fmtMoney(Number(e.amount_required)) : "");
                  }).join("")}
                </div>

                {/* Deposit calculation method */}
                <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="text-xs font-bold text-slate-700 mb-2">
                    שיטת חישוב סכום ערבות
                  </div>
                  <div className="flex gap-2">
                    {DEPOSIT_METHODS.map((dm) => (
                      <button
                        key={dm.v}
                        type="button"
                        onClick={() =>
                          setDepositCalcMethod(
                            dm.v as "months_based" | "fixed_amount"
                          )
                        }
                        className={
                          "rounded-lg border px-3 py-2 text-xs transition-all " +
                          (depositCalcMethod === dm.v
                            ? "border-blue-500 bg-blue-50 font-bold text-blue-700"
                            : "border-slate-200 hover:bg-slate-50")
                        }
                      >
                        {dm.l}
                      </button>
                    ))}
                  </div>

                  {depositCalcMethod === "months_based" && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">
                            מספר חודשים
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={depositMonths}
                            onChange={(e) =>
                              setDepositMonths(Number(e.target.value) || 1)
                            }
                            className={ic}
                          />
                        </div>
                        <div className="flex items-end pb-2">
                          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                            <input
                              type="checkbox"
                              checked={depositIncludesMgmt}
                              onChange={(e) =>
                                setDepositIncludesMgmt(e.target.checked)
                              }
                              className="w-4 h-4"
                            />
                            כולל דמי ניהול
                          </label>
                        </div>
                      </div>
                      {calculatedDeposit > 0 && (
                        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-center justify-between">
                          <span className="text-sm text-green-700 font-semibold">
                            סכום ערבות מחושב
                          </span>
                          <span className="text-lg font-black text-green-800">
                            {fmtMoney(calculatedDeposit)}
                          </span>
                        </div>
                      )}
                      {/* Spell out the basis — a wrong guarantee is expensive
                          and the numbers behind it were invisible. */}
                      {calculatedDeposit > 0 && (
                        <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                          {depositMonths} × ({fmtMoney(guaranteeMonthlyRent)}
                          {rentType === "revenue_pct" ? " שכ\"ד מינימום" : " שכ\"ד"}
                          {depositIncludesMgmt && Number(mgmtFeePct) > 0 ? " + " + fmtMoney(mgmtFeeMonthly) + " דמי ניהול" : ""})
                          {vatType === "taxable" ? " × מע\"מ " + currentVatPct + "%" : ""}
                          {rentType === "revenue_pct" && guaranteeMonthlyRent === 0 && (
                            <span className="text-red-600 font-semibold"> · לא הוזן שכ&quot;ד מינימום — הערבות מכסה דמי ניהול בלבד</span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Guarantee details */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      סכום נדרש (₪)
                    </label>
                    <input
                      type="number"
                      value={guaranteeAmt}
                      onChange={(e) => setGuaranteeAmt(e.target.value)}
                      className={ic}
                      readOnly={depositCalcMethod === "months_based"}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      סכום בפועל (₪)
                    </label>
                    <input
                      type="number"
                      value={guaranteeActual}
                      onChange={(e) => setGuaranteeActual(e.target.value)}
                      className={ic}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      בנק / מוציא
                    </label>
                    <input
                      type="text"
                      value={guaranteeBank}
                      onChange={(e) => setGuaranteeBank(e.target.value)}
                      className={ic}
                    />
                  </div>
                  {!NO_EXPIRY_GUARANTEES.includes(guaranteeType) && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        תוקף ערבות
                      </label>
                      <input
                        type="date"
                        value={guaranteeEnd}
                        onChange={(e) => setGuaranteeEnd(e.target.value)}
                        className={ic}
                      />
                    </div>
                  )}
                </div>

                {/* When the primary security is due. Identical model to the
                    additional securities — a lease that ties the main bank
                    guarantee to "השלמת עבודות השוכר" must be expressible here. */}
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                  <div className="text-xs font-bold text-amber-800">📅 מועד המצאת הביטחון</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-600">יימסר</label>
                      <select value={gDelTrigger} onChange={(e) => setGDelTrigger(e.target.value)} className={ic}>
                        <option value="signing">במועד החתימה</option>
                        <option value="handover">במועד מסירת המושכר</option>
                        <option value="opening">במועד פתיחת המושכר</option>
                        <option value="works_end">בסיום עבודות השוכר</option>
                        <option value="works_start">בתחילת עבודות ההתאמה</option>
                        <option value="permit">בקבלת היתר בנייה</option>
                        <option value="custom_date">בתאריך מוגדר</option>
                        <option value="other">לפי תנאי בהסכם</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-600">
                        {["custom_date","permit","works_start","other"].indexOf(gDelTrigger) !== -1
                          ? "תאריך משוער / מוסכם" : "תאריך (אם ידוע)"}
                      </label>
                      <input type="date" value={gDelDate} onChange={(e) => setGDelDate(e.target.value)} className={ic} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-end">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-600">+ ימים מהמועד (לא חובה)</label>
                      <input type="number" min={0} max={365} value={gDelOffset}
                        onChange={(e) => setGDelOffset(e.target.value)} className={ic} placeholder="למשל 30" />
                    </div>
                    <div className="text-[10px] text-amber-700 pb-1.5">
                      {Number(gDelOffset) > 0
                        ? "המועד = " + Number(gDelOffset) + " ימים אחרי " + (DELIVERY_LABELS[gDelTrigger] || "").replace(/^ב/, "")
                        : "ריק = במועד עצמו"}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-600">התנאי כלשונו בהסכם</label>
                    <input type="text" value={gDelCond} onChange={(e) => setGDelCond(e.target.value)}
                      className={ic} placeholder="למשל: וכנגד תשלום השתתפות המשכיר" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-600">התקבל בפועל בתאריך</label>
                    <input type="date" value={gDelivered} onChange={(e) => setGDelivered(e.target.value)} className={ic} />
                  </div>
                  <div className="text-[10px] text-amber-700">
                    עד המועד הזה הביטחון אינו נחשב חסר, וההתראה תיפתח רק כשהוא מגיע — עם התנאי שנרשם כאן.
                  </div>
                </div>

                {/* Guarantors for promissory note */}
                {guaranteeType === "promissory_note" && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-amber-800">ערבים לשטר</label>
                      <button type="button" onClick={() => setGuarantors([...guarantors, {name: "", id_number: ""}])}
                        className="rounded-lg bg-amber-600 text-white px-3 py-1 text-xs font-bold hover:bg-amber-700">+ ערב</button>
                    </div>
                    {guarantors.length === 0 ? (
                      <div className="text-xs text-amber-600 text-center py-2">אין ערבים — הוסף ערב לשטר</div>
                    ) : (
                      <div className="space-y-2">
                        {guarantors.map((g, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input type="text" value={g.name}
                              onChange={(e) => setGuarantors(guarantors.map((x,i) => i===idx ? {...x, name: e.target.value} : x))}
                              placeholder="שם הערב"
                              className="flex-1 rounded-lg border border-amber-300 px-2 py-1.5 text-sm" />
                            <input type="text" value={g.id_number}
                              onChange={(e) => setGuarantors(guarantors.map((x,i) => i===idx ? {...x, id_number: e.target.value} : x))}
                              placeholder="ת.ז."
                              className="w-32 rounded-lg border border-amber-300 px-2 py-1.5 text-sm" />
                            <button type="button" onClick={() => setGuarantors(guarantors.filter((_,i) => i !== idx))}
                              className="text-red-500 hover:text-red-700 text-sm">🗑</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    קישור למסמך ערבות (URL)
                  </label>
                  <input
                    type="url"
                    placeholder="https://dropbox.com/... או קישור אחר"
                    value={guaranteeDocUrl}
                    onChange={(e) => setGuaranteeDocUrl(e.target.value)}
                    className={ic}
                    dir="ltr"
                  />
                </div>
              </div>
            )}
            {!addGuarantee && (
              <div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 p-6 text-center text-slate-400 text-sm">
                ניתן להוסיף ערבות מאוחר יותר דרך מסך הערבויות
              </div>
            )}
          </div>
        )}

        {/* STEP 6 — סיכום */}
        {step === 6 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 text-lg mb-4">
              {amendmentOfId ? "✅ סיכום התוספת להסכם" : "✅ סיכום החוזה"}
            </h2>

            {/* Amendment notes */}
            {amendmentOfId && (
              <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4">
                <label className="block text-xs font-bold text-yellow-800 mb-2">תיאור השינויים (תוספת להסכם)</label>
                <textarea
                  value={amendmentNotes}
                  onChange={function(e) { setAmendmentNotes(e.target.value); }}
                  placeholder="לדוגמה: נוספה קומה 3 בשטח 110 מ״ר, מחיר 42₪/מ״ר. שינוי מחיר קומה 1 ל-38₪/מ״ר"
                  className="w-full rounded-lg border border-yellow-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 min-h-[60px]"
                  rows={3}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                {
                  l: "סוג חוזה",
                  v: CONTRACT_TYPES.find((c) => c.v === contractType)?.l,
                },
                { l: "שוכר", v: tenant?.name },
                { l: "נכס", v: property?.name },
                {
                  l: "שטחים",
                  v:
                    selSpaces.length > 0
                      ? `${selSpaces.length} שטחים`
                      : "לא נבחרו",
                },
                { l: "תחילה", v: startDate },
                {
                  l: "תקופה",
                  v: `${leasePeriodValue} ${leasePeriodUnit === "months" ? "חודשים" : "שנים"}`,
                },
                {
                  l: "סיום (מחושב)",
                  v: endDate
                    ? new Date(endDate).toLocaleDateString("he-IL")
                    : "",
                },
                { l: isParkingContract ? "דמי חניה" : 'שכ"ד', v: isParkingContract
                    ? (function(){ var rows = parkingSpots.filter(function(p){ return p.tenant_id === tenantId && !p.contract_id; });
                        var tot = rows.reduce(function(s, p){ return p.is_included_in_rent ? s : s + (Number(p.monthly_fee)||0) * (Number(p.quantity)||1); }, 0);
                        var spots = rows.reduce(function(s, p){ return s + (Number(p.quantity)||1); }, 0);
                        return spots + " מקומות · " + fmtMoney(tot) + "/חודש"; })()
                    : rentType === "revenue_pct"
                    ? `${revenuePct}% ממחזור` + (minRentMonthly > 0
                        ? " | מינימום " + fmtMoney(minRentMonthly) + "/חודש" +
                          (minRentSqm > 0 ? " (" + fmtMoney(minRentSqm) + '/מ"ר)' : "")
                        : " | ללא מינימום")
                    : fmtMoney(totalRent) + "/חודש" },
                ...(rentType === "revenue_pct" && !isParkingContract ? [{ l: "התחשבנות פדיון", v: ({monthly:"חודשית",quarterly:"רבעונית",semiannual:"חצי שנתית",annual:"שנתית"} as any)[revSettleFreq] + " · דו\"ח " + ({monthly:"חודשי",quarterly:"רבעוני",semiannual:"חצי שנתי",annual:"שנתי"} as any)[revReportFreq] }] : []),
                ...(isParkingContract ? [{ l: "דמי ניהול חניות", v: mgmtParkingFee ? fmtMoney(Number(mgmtParkingFee)) + "/מקום לחודש" : "לפי הגדרת הנכס" }] : []),
                { l: "שנתי", v: isParkingContract
                    ? (function(){ var rows = parkingSpots.filter(function(p){ return p.tenant_id === tenantId && !p.contract_id; });
                        var tot = rows.reduce(function(s, p){ return p.is_included_in_rent ? s : s + (Number(p.monthly_fee)||0) * (Number(p.quantity)||1); }, 0);
                        return fmtMoney(tot * 12); })()
                    : fmtMoney(annualRent) },
                {
                  l: "תדירות",
                  v: PAYMENT_FREQS.find((p) => p.v === paymentFreq)?.l,
                },
                {
                  l: "שיטת תשלום",
                  v: PAYMENT_METHODS.find((p) => p.v === paymentMethod)?.l,
                },
                {
                  l: "הצמדה",
                  v: INDEX_METHODS.find((m) => m.v === indexMethod)?.l,
                },
                { l: 'מע"מ', v: vatType === "taxable" ? `${currentVatPct}%` : "פטור" },
                {
                  l: "גרייס",
                  v: hasGrace
                    ? `${graceMonths} חודשים | ${GRACE_TYPES.find((g) => g.v === graceType)?.l}`
                    : "לא",
                },
                {
                  l: "עלייה מדורגת",
                  v: hasIncrease
                    ? increaseMode === "per_unit"
                      ? `לפי יחידה (${Object.keys(perUnitTiers).length} יחידות)`
                      : priceTiers.length > 0 ? `${priceTiers.length} שלבים` : "לא"
                    : "לא",
                },
                {
                  l: "אופציות",
                  v:
                    extensionOptions.length > 0
                      ? `${extensionOptions.length} אופציות`
                      : "לא",
                },
                {
                  l: addGuarantee ? (GUARANTEE_TYPES.find(g => g.v === guaranteeType)?.l || "ערבות") : "ערבות",
                  v: addGuarantee
                    ? fmtMoney(Number(guaranteeAmt) || 0) + (guaranteeType === "promissory_note" && guarantors.filter(g=>g.name).length > 0 ? " | " + guarantors.filter(g=>g.name).length + " ערבים" : "")
                    : "לא",
                },
              ].map((r) =>
                r.v ? (
                  <div
                    key={r.l}
                    className="flex justify-between border-b border-slate-100 py-2"
                  >
                    <span className="text-slate-500">{r.l}</span>
                    <span className="font-semibold text-slate-800">{r.v}</span>
                  </div>
                ) : null
              )}
            </div>

            {/* ── Price Timeline ── */}
            {(() => {
              // Per-unit mode: show timeline per space
              if (increaseMode === "per_unit" && Object.keys(perUnitTiers).length > 0) {
                return (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">📊 ציר זמן מחירים (לפי יחידה)</div>
                    <div className="space-y-4">
                      {selSpaces.map(function(sid) {
                        var sp = spaces.find(function(s) { return s.id === sid; });
                        if (!sp) return null;
                        var rType = unitRentTypes[sid] || "per_sqm";
                        var rVal = Number(unitRentOverrides[sid]) || Number(rentPerSqm) || 0;
                        var uTiers = perUnitTiers[sid] || [];
                        var previews = calculateTierPreviews(uTiers, rVal);
                        var unit = rType === "fixed" ? "/חודש" : '/מ"ר';
                        return (
                          <div key={sid} className="space-y-1">
                            <div className="text-xs font-bold text-orange-700 flex items-center gap-2">
                              {sp.space_name} <span className="text-slate-400 font-normal">{sp.area} מ&quot;ר</span>
                            </div>
                            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700">
                              שנה 1: {fmtMoney(rVal)}{unit} (בסיס)
                            </div>
                            {previews.map(function(p, pi) {
                              return (
                                <div key={pi} className="rounded-lg border border-slate-100 bg-white px-3 py-1.5 text-xs flex justify-between">
                                  <span className="font-bold text-slate-700">שנים {p.from_year}-{p.to_year}</span>
                                  <span className="font-black text-slate-800">{fmtMoney(p.calculated_rent_per_sqm)}{unit}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              // Unified mode: single timeline
              // On a turnover lease the schedule is the MINIMUM — with a base of
              // 0 the summary showed "—" for the opening period and the raw
              // increase (+10) instead of the resulting price (75).
              // A flat monthly minimum used to leave this at rentPerSqm (0 on a
              // turnover lease), so every period in the timeline showed "—".
              // הסכם חניות: הציר נבנה על סך דמי החניה החודשי של השוכר.
              const tlBase = isParkingContract
                ? parkingSpots.reduce(function(s: number, p: any) {
                    if (p.tenant_id !== tenantId || p.contract_id) return s;
                    if (p.is_included_in_rent || p.subscription_type === "visitor") return s;
                    return s + (Number(p.monthly_fee) || 0) * (Number(p.quantity) || 1);
                  }, 0)
                : rentType === "revenue_pct"
                ? minRentSqm : (Number(rentPerSqm) || 0);
              const timeline = buildPriceTimeline({
                contractStart: startDate,
                contractEnd: endDate,
                baseRentPerSqm: tlBase,
                // Only when step-rent is actually ON. Ticking the box creates a
                // default tier; unticking it left that tier in state, and the
                // summary drew "שנה 1 / שנים 2-3" for a contract with no steps
                // at all — and inherited them into every option period.
                mainTiers: hasIncrease ? priceTiers : [],
                options: extensionOptions,
              });
              if (timeline.length === 0) return null;
              return (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">📊 {isParkingContract ? "ציר זמן דמי חניה" : rentType === "revenue_pct" ? 'ציר זמן שכ"ד מינימום' : "ציר זמן מחירים"}</div>
                  {isParkingContract && (
                    <div className="text-[11px] text-slate-500 mb-2 leading-relaxed">
                      הסכומים הם <b>סך דמי החניה לחודש</b> — מדרגות ואופציות חלות עליהם ככל שכ&quot;ד.
                    </div>
                  )}
                  {rentType === "revenue_pct" && !isParkingContract && (
                    <div className="text-[11px] text-slate-500 mb-2 leading-relaxed">
                      הסכומים הם ה<b>מינימום</b> למ&quot;ר לחודש. שכ&quot;ד בפועל = הגבוה מבין {revenuePct || 0}% מהפדיון לבין המינימום.
                    </div>
                  )}
                  <div className="space-y-1">
                    {timeline.map((entry, i) => {
                      const isOption = entry.source.startsWith("option");
                      const bgColor = isOption ? "bg-blue-50 border-blue-200" : "bg-white border-slate-100";
                      const textColor = isOption ? "text-blue-800" : "text-slate-800";
                      return (
                        <div key={i} className={"rounded-lg border px-3 py-2 flex items-center justify-between text-xs " + bgColor}>
                          <div className="flex items-center gap-2">
                            <span className={"font-bold " + textColor}>{entry.label}</span>
                            <span className="text-slate-400">
                              {entry.startDate && new Date(entry.startDate).toLocaleDateString("he-IL")} → {entry.endDate && new Date(entry.endDate).toLocaleDateString("he-IL")}
                            </span>
                          </div>
                          <span className={"font-black text-sm " + textColor}>
                            {entry.rentPerSqm
                              ? (isParkingContract
                                  ? <>{fmtMoney(entry.rentPerSqm)}<span className="font-normal text-[11px] text-slate-400">/חודש</span></>
                                  : leasedArea > 0
                                  ? <>{fmtMoney(entry.rentPerSqm * leasedArea)}<span className="font-normal text-[11px] text-slate-400">/חודש · {fmtMoney(entry.rentPerSqm)}/מ&quot;ר</span></>
                                  : <>{fmtMoney(entry.rentPerSqm)}/מ&quot;ר</>)
                              : entry.fixedAmount ? `${fmtMoney(entry.fixedAmount)}/חודש` : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-6 pt-4 border-t border-slate-100">
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              ← חזור
            </button>
          )}
          <div className="flex-1" />
          {step < 6 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={
                (step === 1 && (!tenantId || !propertyId)) ||
                (step === 2 && (
                  // A contract awaiting handover has no start date yet — the
                  // handover date stands in for it, so requiring one here left
                  // the user stuck on step 2 with no way forward.
                  (!startDate && !(hasFutureHandover && (plannedHandover || actualHandover))) ||
                  // הסכם חניות: נדרשת הקצאת חניה עם דמי חניה במקום שכ"ד למ"ר.
                  (isParkingContract
                    ? !parkingSpots.some(function(p){ return p.tenant_id === tenantId && !p.contract_id && Number(p.monthly_fee) > 0; })
                    : (rentType === "revenue_pct" ? !revenuePct : (!rentPerSqm && Object.keys(unitRentOverrides).filter(function(k){return unitRentOverrides[k];}).length === 0)))))
              }
              className="rounded-xl bg-blue-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-40"
            >
              המשך →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="rounded-xl bg-green-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-green-800 disabled:opacity-50"
            >
              {saving ? "שומר..." : amendmentOfId ? "✅ שמור תוספת" : "✅ צור חוזה"}
            </button>
          )}
        </div>
      </div>

        {/* Inline creation modals */}
        {showNewTenant && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-bold text-slate-800 mb-4">שוכר חדש</h3>
              <TenantForm onSubmit={handleNewTenant} onCancel={() => setShowNewTenant(false)} />
            </div>
          </div>
        )}
        {showNewProperty && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-bold text-slate-800 mb-4">נכס חדש</h3>
              <PropertyForm onSubmit={handleNewProperty} onCancel={() => setShowNewProperty(false)} />
            </div>
          </div>
        )}

        {/* מכתב דרישות בסיום ההקמה — המכתב וגם הפעולות (מקדמות שיקים וכו') */}
        {onboard && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto" dir="rtl">
              <h3 className="text-lg font-bold text-slate-800 mb-1">📋 החוזה נשמר — להפיק מכתב דרישות לשוכר?</h3>
              <div className="text-xs text-slate-500 mb-3">
                המכתב מפרט מה על השוכר להמציא, והמערכת גם תבצע את הפעולות בפועל
                {onboard.params.paymentMethod === "checks_advance" ? " (רישום שיקי המקדמות עד סוף השנה במסך המקדמות)" : ""}.
              </div>
              <div className="space-y-1.5 mb-4">
                {buildOnboardingBody(onboard.params).items.map(function (it, i) {
                  return <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 leading-relaxed">{it}</div>;
                })}
              </div>
              <div className="flex gap-2">
                <button onClick={confirmOnboarding} disabled={onboardSaving}
                  className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                  {onboardSaving ? "יוצר..." : "📨 צור מכתב ובצע פעולות"}
                </button>
                <button onClick={function () { setOnboard(null); router.push("/contracts"); }} disabled={onboardSaving}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
                  דלג
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
