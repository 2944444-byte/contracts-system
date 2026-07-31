"use client";
import { useState, useEffect, Suspense } from "react";
import { guaranteedMonthlyRent } from "@/lib/guarantee-base";
import RevenuePctTiersEditor from "@/components/RevenuePctTiersEditor";
import { RevenuePctTier, pctTiersFromRow, describePctTiers } from "@/lib/revenue-pct-steps";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { authHeaders } from '@/lib/api-auth-client';
import { getScopeIds, getCompanyScopeIds, getTenantScopeIds, scopeRows, scopeGroups } from '@/lib/permissions';
import { logAudit } from "@/lib/audit-log";
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
import ExtraGuaranteesEditor, { emptyExtraGuarantee, extraGuaranteeFromRow, extraGuaranteeToRow, type ExtraGuarantee } from '@/components/ExtraGuaranteesEditor';
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
  const [unitRentTypes, setUnitRentTypes] = useState<Record<string, "per_sqm" | "fixed">>({});

  // Step 1 — Tenant & Property
  const [tenantId, setTenantId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [selSpaces, setSelSpaces] = useState<string[]>([]);
  const [contractType, setContractType] = useState("regular");
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
  const [revReportFreq, setRevReportFreq] = useState("monthly");
  const [revLateHigherIndex, setRevLateHigherIndex] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("checks_advance");
  const [paymentDay, setPaymentDay] = useState("1");
  const [indexMethod, setIndexMethod] = useState("standard");
  const [baseCPI, setBaseCPI] = useState("");
  const [baseCPIDate, setBaseCPIDate] = useState("");
  const [baseIndexRule, setBaseIndexRule] = useState<BaseIndexRule>({ mode: "fixed", anchor: "actual_handover", offsetMonths: null });
  const [mgmtProtection, setMgmtProtection] = useState<MgmtProtection>(emptyMgmtProtection());
  const [mgmtFeePct, setMgmtFeePct] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");

  // Step 3 — Grace & Increase
  const [hasGrace, setHasGrace] = useState(false);
  const [graceMonths, setGraceMonths] = useState("3");
  const [graceType, setGraceType] = useState("full");
  const [graceDiscountPct, setGraceDiscountPct] = useState("50");
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

  // Leased area used to preview a per-sqm non-exercise penalty: the selected
  // units' area, falling back to the manually charged area.
  const penaltyPreviewArea = (function() {
    var sum = 0;
    selSpaces.forEach(function(sid) {
      const sp = spaces.find(function(s) { return s.id === sid; });
      if (sp?.area) sum += Number(sp.area) || 0;
    });
    return sum > 0 ? sum : (Number(chargedArea) || 0);
  })();

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
  }, [startDate, cpiRecords.length, indexMethod, baseIndexRule.mode]);

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
        .select("*, tenants(name), properties(name), contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,spaces(space_name,area)), contract_options(id,option_number,duration_months,duration_years,notice_type,notice_days_before_end,rent_mechanism,revenue_pct_tiers,rent_increase_pct,new_rent_value,option_group,exit_points,price_schedule_type,price_tiers,non_exercise_penalty_type,non_exercise_penalty_value,non_exercise_penalty_basis,non_exercise_penalty_months,non_exercise_penalty_indexed,non_exercise_penalty_vat,non_exercise_penalty_days,non_exercise_penalty_notes), guarantees(id,guarantee_type,amount_required,amount_actual,bank,reference_number,end_date,document_url,notes,guarantors)")
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
      setBaseCPIDate(c.index_base_date || "");
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
      supabase.from("parking_subscriptions").select("id,spot_number,quantity,monthly_fee,vehicle_number,status,tenant_id,is_marked,is_included_in_rent,tenants(name)")
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
    const { data } = await supabase.from("parking_subscriptions").select("id,spot_number,quantity,monthly_fee,vehicle_number,status,tenant_id,is_marked,is_included_in_rent,tenants(name)")
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
      if (data.index_base_date) { setBaseCPIDate(data.index_base_date + "-15"); filled++; }
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
    var hasAnyRent = rentType === "revenue_pct" ? !!revenuePct : (rentPerSqm || Object.keys(unitRentOverrides).some(function(k) { return unitRentOverrides[k]; }));
    if (!tenantId || !propertyId || !startDate || !endDate || !hasAnyRent) {
      alert("נא מלא כל שדות חובה");
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
        lease_period_unit: leasePeriodUnit,
        rent_type: rentType,
        rent_per_sqm: Number(rentPerSqm) || null,
        revenue_pct: rentType === "revenue_pct" ? Number(revenuePct) || null : null,
        minimum_rent: rentType === "revenue_pct" && minRentBasis === "monthly" ? Number(minimumRent) || 0 : null,
        // The per-sqm floor is what the revenue screen reads; it also rises with
        // the rent steps, so this is the field that makes "המינימום עולה משנה 4" work.
        min_rent_per_sqm: rentType === "revenue_pct" && minRentBasis === "per_sqm" ? Number(minimumRent) || 0 : null,
        revenue_pct_tiers: rentType === "revenue_pct" && revenuePctTiers.length > 0 ? revenuePctTiers : null,
        revenue_report_day: rentType === "revenue_pct" ? Number(revenueReportDay) || 5 : null,
        revenue_minimum_advance: rentType === "revenue_pct" ? revMinAdvance : false,
        ...(rentType === "revenue_pct" ? revenueProtectionToRow(revProtection) : revenueProtectionToRow(null)),
        revenue_categories: rentType === "revenue_pct" ? revCategories.filter(function(c){ return c.name.trim(); }) : [],
        revenue_settlement_freq: rentType === "revenue_pct" ? revSettleFreq : "monthly",
        revenue_settlement_day: rentType === "revenue_pct" ? (Number(revSettleDay) || null) : null,
        revenue_report_freq: rentType === "revenue_pct" ? revReportFreq : "monthly",
        revenue_late_report_higher_index: rentType === "revenue_pct" ? revLateHigherIndex : false,
        mgmt_included_in_revenue: rentType === "revenue_pct" ? mgmtIncludedInRevenue : false,
        charged_area: Number(chargedArea) || null,
        investment_addition: Number(investAdd) || null,
        vat_type: vatType,
        payment_frequency: paymentFreq,
        payment_method: paymentMethod,
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
        mgmt_fee_per_sqm: mgmtFeePct ? Number(mgmtFeePct) : null,
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
      if (hasGrace) {
        insertPayload.grace_months = Number(graceMonths) || null;
        insertPayload.grace_type = graceType;
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
                  tier_number: i + 1,
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
          amount_required: guaranteeAmt ? Number(guaranteeAmt) : null,
          amount_actual: guaranteeActual ? Number(guaranteeActual) : null,
          bank: guaranteeBank || null,
          end_date: noExpiry ? null : (guaranteeEnd || null),
          document_url: guaranteeDocUrl || null,
          guarantors: guaranteeType === "promissory_note" && validGuarantors.length > 0 ? validGuarantors : null,
          status: "active",
        });
      }

      // Construction investment (השקעות בינוי) — store the itemised record +
      // reimbursement terms alongside the contract's monthly rent addition.
      if (Number(investAdd) > 0 && (tiAmount || tiDescription)) {
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
                tier_number: globalTierNum,
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
              tier_number: i + 1,
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
          await supabase.from("contract_price_tiers").insert(allTiersToInsert);
        }
      }

      await logAudit({
        entity_type: "contract",
        entity_id: contract.id,
        action: "create",
        notes: tenants.find((t) => t.id === tenantId)?.name,
      });
      router.push("/contracts");
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

            {propertyId && (
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
                      onChange={(e) => { setPlannedHandover(e.target.value); if (e.target.value && !startDate && !actualHandover) setStartDate(e.target.value); }}
                      className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-slate-600">מסירה בפועל</label>
                    <input type="date" value={actualHandover}
                      onChange={(e) => { setActualHandover(e.target.value); if (e.target.value && !startDate) setStartDate(e.target.value); }}
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

            {/* Rent type toggle */}
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
                      {minRentBasis === "per_sqm" && Number(minimumRent) > 0 && Number(chargedArea) > 0 && (
                        <span> · {fmtMoney(Number(minimumRent) * Number(chargedArea))}/חודש ל-{chargedArea} מ&quot;ר</span>
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
                    <label className="mb-1 block text-xs font-semibold text-purple-700">יום עריכת ההתחשבנות (בחודש שאחרי)</label>
                    <input type="number" min="1" max="28" value={revSettleDay}
                      onChange={(e) => setRevSettleDay(e.target.value)} className={ic} />
                  </div>
                  <div className="col-span-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-blue-800">🛡️ הגנה על שכ&quot;ד</label>
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
              {rentType === "fixed" && (
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

            {/* Construction-investment detail + reimbursement terms. Appears once
                an investment rent addition is entered, so the addition is never
                unexplained and the payment terms are captured with the contract. */}
            {Number(investAdd) > 0 && (
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
            {baseRent > 0 && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
                <div className="text-xs font-bold text-blue-700 mb-2">
                  תצוגת שכ&quot;ד חודשי
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
                  {[
                    { l: 'שכ"ד בסיס', v: fmtMoney(baseRent) },
                    { l: 'מע"מ', v: fmtMoney(vat) },
                    { l: 'סה"כ לחודש', v: fmtMoney(totalRent) },
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
                  שנתי: <strong>{fmtMoney(annualRent)}</strong>
                </div>
              </div>
            )}

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
                    const unitTotal = rType === "fixed" ? (Number(rVal) || 0) : (Number(rVal || rentPerSqm) || 0) * (sp.area || 0);
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
                          </div>
                        </div>
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
                    if (rType === "fixed") total += rVal;
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
                    onChange={(e) => setBaseCPI(e.target.value)}
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
                  onChange={(e) => setBaseCPIDate(e.target.value)}
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
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  דמי ניהול (₪/מ&quot;ר)
                </label>
                <input
                  type="number"
                  value={mgmtFeePct}
                  onChange={(e) => setMgmtFeePct(e.target.value)}
                  placeholder="5"
                  className={ic}
                />
              </div>
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
              <div className="mt-6 pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-semibold text-slate-700">חניות</label>
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
                        מספר חודשי גרייס
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="24"
                        value={graceMonths}
                        onChange={(e) => setGraceMonths(e.target.value)}
                        className={ic}
                      />
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
                  {graceType === "partial" && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        אחוז הנחה בגרייס (%)
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
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
                    גרייס: {graceMonths} חודשים |{" "}
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
                </div>
              )}
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
                  {minRentBasis === "per_sqm"
                    ? <span> הבסיס: {fmtMoney(Number(minimumRent) || 0)}/מ&quot;ר לחודש.</span>
                    : <span> הבסיס מוזן כסכום חודשי — כדי שהמדרגות יחולו עליו, הזן את המינימום לפי מ&quot;ר.</span>}
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
                const stepBase = rentType === "revenue_pct" && minRentBasis === "per_sqm"
                  ? (Number(minimumRent) || 0) : (Number(rentPerSqm) || 0);
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
                            שנים 1–{sorted[0].from_year - 1}: {fmtMoney(stepBase)}/מ&quot;ר ({rentType === "revenue_pct" ? "מינימום בסיס" : "מחיר בסיס"})
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

                          <div className="flex gap-2 mb-2">
                            <button type="button" onClick={() => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, is_recurring: false } : t))}
                              className={"rounded-lg border px-3 py-1.5 text-xs transition-all " +
                                (!tier.is_recurring ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-white")}>
                              📅 טווח שנים
                            </button>
                            <button type="button" onClick={() => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, is_recurring: true } : t))}
                              className={"rounded-lg border px-3 py-1.5 text-xs transition-all " +
                                (tier.is_recurring ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-white")}>
                              🔁 חוזר כל X שנים
                            </button>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {!tier.is_recurring ? (
                              <>
                                <div>
                                  <label className="mb-1 block text-xs text-slate-500">משנה</label>
                                  <input type="number" min="1" value={tier.from_year}
                                    onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, from_year: Number(e.target.value) || 1 } : t))}
                                    className={ic} />
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs text-slate-500">עד שנה</label>
                                  <input type="number" min="1" value={tier.to_year}
                                    onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, to_year: Number(e.target.value) || 1 } : t))}
                                    className={ic} />
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
                                      שנים {exp.from_year}-{exp.to_year}: {exp.increase_type === "none"
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
                { l: 'שכ"ד', v: rentType === "revenue_pct" ? `${revenuePct}% ממחזור${Number(minimumRent) > 0 ? " | מינימום " + fmtMoney(Number(minimumRent)) : " | ללא מינימום"}` : fmtMoney(totalRent) + "/חודש" },
                ...(rentType === "revenue_pct" ? [{ l: "התחשבנות פדיון", v: ({monthly:"חודשית",quarterly:"רבעונית",semiannual:"חצי שנתית",annual:"שנתית"} as any)[revSettleFreq] + " · דו\"ח " + ({monthly:"חודשי",quarterly:"רבעוני",semiannual:"חצי שנתי",annual:"שנתי"} as any)[revReportFreq] }] : []),
                { l: "שנתי", v: fmtMoney(annualRent) },
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
              const timeline = buildPriceTimeline({
                contractStart: startDate,
                contractEnd: endDate,
                baseRentPerSqm: Number(rentPerSqm) || 0,
                mainTiers: priceTiers,
                options: extensionOptions,
              });
              if (timeline.length === 0) return null;
              return (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">📊 ציר זמן מחירים</div>
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
                            {entry.rentPerSqm ? `${fmtMoney(entry.rentPerSqm)}/מ"ר` : entry.fixedAmount ? `${fmtMoney(entry.fixedAmount)}/חודש` : "—"}
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
                  (rentType === "revenue_pct" ? !revenuePct : (!rentPerSqm && Object.keys(unitRentOverrides).filter(function(k){return unitRentOverrides[k];}).length === 0))))
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
    </div>
  );
}
