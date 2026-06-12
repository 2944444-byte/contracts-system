"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getScopeIds, getCompanyScopeIds, getTenantScopeIds, scopeRows, scopeGroups } from '@/lib/permissions';
import { logAudit } from "@/lib/audit-log";
import {
  calculateEndDate,
  calculateOptionDates,
  calculateDepositAmount,
  emptyOption,
  emptyPriceTier,
  validatePriceTiers,
  calculateTierPreviews,
  buildPriceTimeline,
  type ExtensionOption,
  type PriceTier,
} from "@/lib/contract-utils";
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
  { v: "cash", l: "מזומן", icon: "💵" },
  { v: "insurance", l: "ביטוח", icon: "🛡️" },
  { v: "personal", l: "אישית", icon: "👤" },
];
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

export default function ContractEditPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [tenants, setTenants] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [spaces, setSpaces] = useState<any[]>([]);
  const [cpiRecords, setCpiRecords] = useState<any[]>([]);
  const [currentVatPct, setCurrentVatPct] = useState(18);
  const [unitRentOverrides, setUnitRentOverrides] = useState<Record<string, string>>({});
  const [unitRentTypes, setUnitRentTypes] = useState<Record<string, "per_sqm" | "fixed">>({});
  const [dataLoaded, setDataLoaded] = useState(false);

  // Step 1
  const [tenantId, setTenantId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [selSpaces, setSelSpaces] = useState<string[]>([]);
  const [originalBaseSpaceIds, setOriginalBaseSpaceIds] = useState<string[]>([]);
  const [contractHasAmendments, setContractHasAmendments] = useState(false);
  const [contractType, setContractType] = useState("regular");
  const [showNewTenant, setShowNewTenant] = useState(false);
  const [showNewProperty, setShowNewProperty] = useState(false);

  // Step 2
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
  const [minimumRent, setMinimumRent] = useState("");
  const [revenueReportDay, setRevenueReportDay] = useState("5");
  const [mgmtIncludedInRevenue, setMgmtIncludedInRevenue] = useState(false);
  const [rentPerSqm, setRentPerSqm] = useState("");
  const [chargedArea, setChargedArea] = useState("");
  const [investAdd, setInvestAdd] = useState("");
  const [vatType, setVatType] = useState("taxable");
  const [paymentFreq, setPaymentFreq] = useState("monthly");
  const [paymentMethod, setPaymentMethod] = useState("checks_advance");
  const [paymentDay, setPaymentDay] = useState("1");
  const [indexMethod, setIndexMethod] = useState("standard");
  const [baseCPI, setBaseCPI] = useState("");
  const [baseCPIDate, setBaseCPIDate] = useState("");
  const [mgmtFeePct, setMgmtFeePct] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");

  // Step 3
  const [hasGrace, setHasGrace] = useState(false);
  const [graceMonths, setGraceMonths] = useState("3");
  const [graceType, setGraceType] = useState("full");
  const [graceDiscountPct, setGraceDiscountPct] = useState("50");
  const [hasIncrease, setHasIncrease] = useState(false);
  const [increaseMode, setIncreaseMode] = useState<"unified" | "per_unit">("unified");
  const [perUnitTiers, setPerUnitTiers] = useState<Record<string, PriceTier[]>>({});
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [cbsFetching, setCbsFetching] = useState(false);
  const [cbsFetchedMonth, setCbsFetchedMonth] = useState("");
  const [editParkingSpots, setEditParkingSpots] = useState<any[]>([]);

  // Step 4
  const [extensionOptions, setExtensionOptions] = useState<ExtensionOption[]>([]);

  // Step 5
  const [addGuarantee, setAddGuarantee] = useState(false);
  const [guaranteeType, setGuaranteeType] = useState("bank");
  const [guaranteeAmt, setGuaranteeAmt] = useState("");
  const [guaranteeActual, setGuaranteeActual] = useState("");
  const [guaranteeBank, setGuaranteeBank] = useState("");
  const [guaranteeEnd, setGuaranteeEnd] = useState("");
  const [depositCalcMethod, setDepositCalcMethod] = useState<"months_based" | "fixed_amount">("months_based");
  const [depositMonths, setDepositMonths] = useState(3);
  const [depositIncludesMgmt, setDepositIncludesMgmt] = useState(false);

  // === Auto-calculate end date ===
  useEffect(() => {
    if (!dataLoaded) return;
    if (startDate && leasePeriodValue > 0) {
      const calc = calculateEndDate(startDate, leasePeriodValue, leasePeriodUnit);
      if (calc) setEndDate(calc);
    }
  }, [startDate, leasePeriodValue, leasePeriodUnit, dataLoaded]);

  // === Auto-calculate option dates ===
  useEffect(() => {
    if (endDate && extensionOptions.length > 0) {
      const updated = calculateOptionDates(endDate, extensionOptions);
      const needsUpdate = updated.some(
        (u, i) =>
          u.start_date !== extensionOptions[i].start_date ||
          u.end_date !== extensionOptions[i].end_date
      );
      if (needsUpdate) setExtensionOptions(updated);
    }
  }, [endDate, extensionOptions.length, ...extensionOptions.map((o) => o.duration_years || o.duration_months)]);

  // === Auto-calculate deposit ===
  // Calculate baseRent: from global rent or per-unit pricing
  var baseRent = (Number(rentPerSqm) || 0) * (Number(chargedArea) || 0) + (Number(investAdd) || 0);
  if (baseRent === (Number(investAdd) || 0) && Object.keys(unitRentOverrides).length > 0) {
    var perUnitTotal = 0;
    selSpaces.forEach(function(sid) {
      var sp = spaces.find(function(s) { return s.id === sid; });
      var rType = unitRentTypes[sid] || "per_sqm";
      var rVal = Number(unitRentOverrides[sid]) || 0;
      if (rType === "fixed") perUnitTotal += rVal;
      else perUnitTotal += rVal * (sp?.area || 0);
    });
    if (perUnitTotal > 0) baseRent = perUnitTotal + (Number(investAdd) || 0);
  }
  const mgmtFeeMonthly = (Number(mgmtFeePct) || 0) * (Number(chargedArea) || 0);
  const vat = vatType === "taxable" ? baseRent * (currentVatPct / 100) : 0;
  const totalRent = baseRent + vat;
  const annualRent = baseRent * 12;

  const calculatedDeposit = calculateDepositAmount({
    depositMethod: depositCalcMethod,
    depositMonths,
    fixedAmount: Number(guaranteeAmt) || 0,
    monthlyRent: baseRent,
    managementFee: mgmtFeeMonthly,
    includesManagement: depositIncludesMgmt,
    vatPct: vatType === "taxable" ? currentVatPct : 0,
  });

  useEffect(() => {
    if (depositCalcMethod === "months_based" && calculatedDeposit > 0) {
      setGuaranteeAmt(calculatedDeposit.toString());
    }
  }, [calculatedDeposit, depositCalcMethod]);

  // === Load reference data + existing contract ===
  useEffect(() => {
    loadAll();
  }, [id]);

  async function loadAll() {
    // Load ref data
    const [{ data: t }, { data: p }, { data: cpi }, { data: vatData }] = await Promise.all([
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
    if (vatData && vatData.length > 0) setCurrentVatPct(Number(vatData[0].rate_pct));

    // Load contract
    const { data: c } = await supabase.from("contracts").select("*").eq("id", id).single();
    if (!c) { router.push("/contracts"); return; }

    // Load children
    const [{ data: opts }, { data: guar }, { data: cs }] = await Promise.all([
      supabase.from("contract_options").select("*").eq("contract_id", id).order("option_number"),
      supabase.from("guarantees").select("*").eq("contract_id", id).limit(1),
      supabase.from("contract_spaces").select("*").eq("contract_id", id),
    ]);

    // Load spaces for the property
    if (c.property_id) {
      const { data: sp } = await supabase.from("spaces").select("id,space_name,area,status").eq("property_id", c.property_id);
      setSpaces(sp ?? []);
    }

    // Check for amendments — if parent contract has amendments, merge latest
    var effectiveCs = cs ?? [];
    var effectiveEndDate = c.end_date;
    var effectiveArea = c.charged_area;
    var effectiveRent = c.rent_per_sqm;
    var hasAmendments = false;
    var amends: any[] | null = null;

    // Store original base spaces (before amendment pollution)
    var baseSpaceIds = (cs ?? []).map(function(s: any) { return s.space_id; });
    setOriginalBaseSpaceIds(baseSpaceIds);

    if (!c.is_amendment) {
      var { data: amendsData } = await supabase.from("contracts")
        .select("*, contract_spaces(space_id,charge_method,fixed_rent,price_per_sqm,index_base_value,index_base_date,use_original_index)")
        .eq("parent_contract_id", id)
        .eq("is_amendment", true)
        .order("amendment_number");
      amends = amendsData;
      if (amends && amends.length > 0) {
        hasAmendments = true;
        setContractHasAmendments(true);
        var latest = amends[amends.length - 1];
        // Override spaces with latest amendment's spaces
        if (latest.contract_spaces?.length > 0) {
          effectiveCs = latest.contract_spaces;
        }
        // Override end date if extended
        if (latest.end_date && latest.end_date > c.end_date) {
          effectiveEndDate = latest.end_date;
        }
        // Override area/rent if changed
        if (latest.charged_area) effectiveArea = latest.charged_area;
        if (latest.rent_per_sqm) effectiveRent = latest.rent_per_sqm;
      }
    }

    // Populate Step 1
    setTenantId(c.tenant_id ?? "");
    setPropertyId(c.property_id ?? "");
    setContractType(c.contract_type ?? "regular");
    const spaceIds = (effectiveCs).map((s: any) => s.space_id);
    setSelSpaces(spaceIds);
    const overrides: Record<string, string> = {};
    const rentTypes: Record<string, "per_sqm" | "fixed"> = {};
    (effectiveCs).forEach((s: any) => {
      if (s.charge_method === "fixed" && s.fixed_rent) {
        rentTypes[s.space_id] = "fixed";
        overrides[s.space_id] = s.fixed_rent.toString();
      } else if (s.price_per_sqm) {
        rentTypes[s.space_id] = "per_sqm";
        overrides[s.space_id] = s.price_per_sqm.toString();
      }
    });
    setUnitRentOverrides(overrides);
    setUnitRentTypes(rentTypes);

    // Populate Step 2
    setSigningDate(c.signing_date?.split("T")[0] ?? "");
    setPlannedHandover(c.planned_handover_date?.split("T")[0] ?? "");
    setActualHandover(c.actual_handover_date?.split("T")[0] ?? "");
    setHasFutureHandover(c.handover_status && c.handover_status !== "not_applicable");
    setStartDate(c.start_date?.split("T")[0] ?? "");
    var effEnd = (effectiveEndDate || c.end_date)?.split("T")[0] ?? "";
    setEndDate(effEnd);
    // ALWAYS use the stored base period (lease_period_value). DO NOT
    // recompute from end_date — contract.end_date may already include
    // exercised-option extensions (so it ends years AFTER the base
    // period ends), and recomputing from it would inflate the period
    // every save cycle: each click on "Edit" would push the contract
    // forward by the option duration (4 years for ג'ובניל), the option
    // start/end dates would shift accordingly, and on the NEXT edit the
    // newly-inflated end_date would push it again.
    //
    // Architecture:
    //   - lease_period_value = BASE period the user originally agreed to
    //   - end_date            = "active until" (= base end OR last
    //                           exercised option's end, whichever is later)
    // Edit page treats lease_period_value as the source of truth for the
    // period; end_date is derived from it + exercised options at save time.
    //
    // Fallback (rare): legacy contracts without lease_period_value stored
    // — infer from dates as before.
    if (c.lease_period_value && c.lease_period_unit) {
      setLeasePeriodValue(c.lease_period_value);
      setLeasePeriodUnit(c.lease_period_unit);
    } else if (c.start_date && effEnd) {
      var startMs = new Date(c.start_date).getTime();
      var endMs = new Date(effEnd).getTime();
      var diffMonths = Math.round((endMs - startMs) / (30.44 * 24 * 60 * 60 * 1000));
      if (diffMonths >= 12 && diffMonths % 12 === 0) {
        setLeasePeriodValue(diffMonths / 12);
        setLeasePeriodUnit("years");
      } else {
        setLeasePeriodValue(diffMonths);
        setLeasePeriodUnit("months");
      }
    } else {
      setLeasePeriodValue(12);
      setLeasePeriodUnit("months");
    }
    setRentType(c.rent_type === "revenue_pct" ? "revenue_pct" : "fixed");
    setRevenuePct(c.revenue_pct?.toString() ?? "");
    setMinimumRent(c.minimum_rent?.toString() ?? "");
    setRevenueReportDay(c.revenue_report_day?.toString() ?? "5");
    setMgmtIncludedInRevenue(c.mgmt_included_in_revenue ?? false);
    setRentPerSqm((effectiveRent || c.rent_per_sqm)?.toString() ?? "");
    setChargedArea((effectiveArea || c.charged_area)?.toString() ?? "");
    setInvestAdd(c.investment_addition?.toString() ?? "");
    setVatType(c.vat_type ?? "taxable");
    setPaymentFreq(c.payment_frequency ?? "monthly");
    setPaymentMethod(c.payment_method ?? "checks_advance");
    setPaymentDay(c.payment_day?.toString() ?? "1");
    setIndexMethod(c.indexation_method ?? "standard");
    setBaseCPI(c.index_base_value?.toString() ?? "");
    setBaseCPIDate(c.index_base_date?.split("T")[0] ?? "");
    setMgmtFeePct(c.mgmt_fee_per_sqm?.toString() ?? "");
    setDocumentUrl(c.document_url ?? "");

    // Populate Step 3
    if (c.grace_months) {
      setHasGrace(true);
      setGraceMonths(c.grace_months.toString());
      setGraceType(c.grace_type ?? "full");
      setGraceDiscountPct(c.grace_discount_pct?.toString() ?? "50");
    }
    // Load price tiers — from latest amendment if exists, else from contract
    var tiersContractId = id;
    if (hasAmendments && amends && amends.length > 0) {
      // Check if latest amendment has its own tiers
      var { data: amendTiers } = await supabase.from("contract_price_tiers")
        .select("*").eq("contract_id", amends[amends.length - 1].id).order("tier_number");
      if (amendTiers && amendTiers.length > 0) {
        tiersContractId = amends[amends.length - 1].id;
      }
    }
    const { data: tiers } = await supabase.from("contract_price_tiers")
      .select("*").eq("contract_id", tiersContractId).order("tier_number");
    if (tiers && tiers.length > 0) {
      setHasIncrease(true);
      // Check if tiers have space_id → per-unit mode
      var hasSpaceId = tiers.some((t: any) => t.space_id);
      if (hasSpaceId) {
        setIncreaseMode("per_unit");
        var grouped: Record<string, PriceTier[]> = {};
        tiers.forEach((t: any) => {
          var sid = t.space_id;
          if (!sid) return;
          if (!grouped[sid]) grouped[sid] = [];
          grouped[sid].push({
            increase_type: t.increase_type ?? "pct",
            increase_value: t.increase_value ?? 0,
            from_year: t.from_year ?? 1,
            to_year: t.to_year ?? 3,
            is_recurring: t.is_recurring ?? false,
            recurring_every_years: t.recurring_every_years ?? (t.is_recurring ? 1 : null),
            calculated_rent_per_sqm: t.calculated_rent_per_sqm,
            notes: t.notes ?? "",
          });
        });
        setPerUnitTiers(grouped);
      } else {
        setIncreaseMode("unified");
        setPriceTiers(tiers.map((t: any) => ({
          increase_type: t.increase_type ?? "pct",
          increase_value: t.increase_value ?? 0,
          from_year: t.from_year ?? 1,
          to_year: t.to_year ?? 3,
          is_recurring: t.is_recurring ?? false,
          recurring_every_years: t.recurring_every_years ?? (t.is_recurring ? 1 : null),
          calculated_rent_per_sqm: t.calculated_rent_per_sqm,
          notes: t.notes ?? "",
        })));
      }
    } else if (c.increase_steps && !Array.isArray(c.increase_steps) && typeof c.increase_steps === 'object') {
      // Per-unit tiers stored as Record<space_id, tier[]>
      setHasIncrease(true);
      setIncreaseMode("per_unit");
      var loaded: Record<string, PriceTier[]> = {};
      Object.entries(c.increase_steps).forEach(function([sid, tiers]: [string, any]) {
        if (!Array.isArray(tiers)) return;
        loaded[sid] = tiers.map(function(s: any) {
          return {
            increase_type: s.increase_type ?? "pct",
            increase_value: s.increase_value ?? 0,
            from_year: s.from_year ?? 1,
            to_year: s.to_year ?? 3,
            is_recurring: s.is_recurring ?? false,
            recurring_every_years: s.recurring_every_years ?? null,
            calculated_rent_per_sqm: s.calculated_rent_per_sqm ?? null,
            notes: s.notes ?? "",
          };
        });
      });
      setPerUnitTiers(loaded);
    } else if (c.increase_steps && Array.isArray(c.increase_steps) && c.increase_steps.length > 0) {
      // Fallback: load from legacy JSONB field — skip empty/broken tiers
      var validSteps = c.increase_steps.filter(function(s: any) {
        return (s.increase_value && Number(s.increase_value) > 0) || s.increase_type === "none";
      });
      if (validSteps.length > 0) {
        setHasIncrease(true);
        setPriceTiers(validSteps.map((s: any) => ({
          increase_type: s.increase_type ?? s.type ?? "pct",
          increase_value: s.increase_value ?? s.value ?? 0,
          from_year: s.from_year ?? 1,
          to_year: s.to_year ?? 3,
          is_recurring: s.is_recurring ?? false,
          recurring_every_years: s.recurring_every_years ?? null,
          calculated_rent_per_sqm: null,
          notes: s.notes ?? "",
        })));
      }
    } else if (c.price_increase_type) {
      setHasIncrease(true);
      setPriceTiers([{
        increase_type: c.price_increase_type === "fixed" ? "fixed_sqm" : c.price_increase_type,
        increase_value: c.price_increase_value ?? 0,
        from_year: 1,
        to_year: Math.ceil((c.lease_period_value ?? 12) / (c.lease_period_unit === "years" ? 1 : 12)),
        is_recurring: true,
        recurring_every_years: Math.ceil((c.price_increase_freq_months ?? 12) / 12),
        calculated_rent_per_sqm: null,
        notes: "",
      }]);
    }

    // Populate Step 4
    if (opts && opts.length > 0) {
      setExtensionOptions(opts.map((o: any) => ({
        duration_months: o.duration_months ?? 12,
        duration_years: o.duration_years ?? (o.duration_months ? o.duration_months / 12 : 1),
        notice_type: o.notice_type ?? "exercise",
        notice_days_before_end: o.notice_days_before_end ?? 90,
        rent_mechanism: o.rent_mechanism ?? "no_change",
        new_rent_value: o.new_rent_value,
        rent_increase_pct: o.rent_increase_pct,
        auto_renewal: o.auto_extend ?? false,
        start_date: o.start_date?.split("T")[0] ?? "",
        end_date: o.end_date?.split("T")[0] ?? "",
        notes: o.notes ?? "",
        price_schedule_type: o.price_schedule_type ?? "inherit",
        price_tiers: o.price_tiers && Array.isArray(o.price_tiers) ? o.price_tiers : [],
        option_group: o.option_group ?? null,
        exit_points: o.exit_points && Array.isArray(o.exit_points) ? o.exit_points : [],
      })));
    }

    // Populate Step 5
    if (guar && guar.length > 0) {
      const g = guar[0];
      setAddGuarantee(true);
      setGuaranteeType(g.guarantee_type ?? "bank");
      setGuaranteeAmt(g.amount_required?.toString() ?? "");
      setGuaranteeActual(g.amount_actual?.toString() ?? "");
      setGuaranteeBank(g.bank ?? "");
      setGuaranteeEnd(g.end_date?.split("T")[0] ?? "");
    }
    if (c.deposit_calculation_method) setDepositCalcMethod(c.deposit_calculation_method as any);
    if (c.deposit_includes_mgmt) setDepositIncludesMgmt(true);

    // Load parking
    if (c.property_id) {
      const { data: pk } = await supabase.from("parking_subscriptions").select("id,spot_number,quantity,monthly_fee,is_marked,is_included_in_rent,tenants(name)")
        .eq("property_id", c.property_id).order("spot_number");
      setEditParkingSpots(pk ?? []);
    }

    setLoading(false);
    setDataLoaded(true);
  }

  // Load spaces when property changes (after initial load)
  useEffect(() => {
    if (!dataLoaded) return;
    if (propertyId) {
      supabase.from("spaces").select("id,space_name,area,status").eq("property_id", propertyId)
        .then(({ data }) => { setSpaces(data ?? []); });
    }
  }, [propertyId, dataLoaded]);

  function toggleSpace(sid: string) {
    setSelSpaces((prev) => prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]);
    const sp = spaces.find((s) => s.id === sid);
    if (sp?.area && !selSpaces.includes(sid)) {
      setChargedArea((prev) => (prev ? prev : sp.area.toString()));
    }
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

  function updateOption(idx: number, field: string, value: any) {
    setExtensionOptions((prev) => prev.map((opt, i) => (i === idx ? { ...opt, [field]: value } : opt)));
  }

  function removeOption(idx: number) {
    setExtensionOptions((prev) => prev.filter((_, i) => i !== idx));
  }

  // === SUBMIT (UPDATE) ===
  async function handleSubmit() {
    var hasAnyRent = rentType === "revenue_pct" ? !!revenuePct : (rentPerSqm || Object.keys(unitRentOverrides).some(function(k) { return unitRentOverrides[k]; }));
    if (!tenantId || !propertyId || !startDate || !endDate || !hasAnyRent) {
      alert("נא מלא כל שדות חובה");
      return;
    }
    setSaving(true);
    try {
      const today = new Date();
      const start = new Date(startDate);

      // Check if any exercised option extends the contract
      var effectiveEnd = new Date(endDate);
      for (var oi = 0; oi < extensionOptions.length; oi++) {
        var eOpt = extensionOptions[oi];
        if (eOpt.end_date) {
          // Check if this option was exercised (from existing status map)
          var existingOpt = (await supabase.from("contract_options").select("is_exercised").eq("contract_id", id).eq("option_number", oi + 1).single()).data;
          if (existingOpt?.is_exercised && new Date(eOpt.end_date) > effectiveEnd) {
            effectiveEnd = new Date(eOpt.end_date);
          }
        }
      }
      var effectiveEndStr = effectiveEnd.toISOString().split("T")[0];

      let status = "active";
      if (today < start) status = "future";
      else if (today > effectiveEnd) status = "ended";

      // For future handover: if not yet delivered, status = "upcoming"
      if (hasFutureHandover && !actualHandover) status = "upcoming";

      const updatePayload: any = {
        tenant_id: tenantId,
        property_id: propertyId,
        contract_type: contractType,
        signing_date: signingDate || null,
        planned_handover_date: plannedHandover || null,
        actual_handover_date: actualHandover || null,
        handover_status: hasFutureHandover ? (actualHandover ? "delivered" : "pending") : "not_applicable",
        start_date: startDate,
        end_date: effectiveEndStr,
        lease_period_value: leasePeriodValue,
        lease_period_unit: leasePeriodUnit,
        rent_type: rentType,
        rent_per_sqm: Number(rentPerSqm) || null,
        revenue_pct: rentType === "revenue_pct" ? Number(revenuePct) || null : null,
        minimum_rent: rentType === "revenue_pct" ? Number(minimumRent) || 0 : null,
        revenue_report_day: rentType === "revenue_pct" ? Number(revenueReportDay) || 5 : null,
        mgmt_included_in_revenue: mgmtIncludedInRevenue,
        charged_area: Number(chargedArea) || null,
        investment_addition: Number(investAdd) || null,
        vat_type: vatType,
        payment_frequency: paymentFreq,
        payment_method: paymentMethod,
        payment_day: Number(paymentDay) || 1,
        indexation_method: indexMethod,
        index_base_value: baseCPI ? Number(baseCPI) : null,
        index_base_date: baseCPIDate || null,
        mgmt_fee_per_sqm: mgmtFeePct ? Number(mgmtFeePct) : null,
        document_url: documentUrl || null,
        status,
      };

      // Grace
      if (hasGrace) {
        updatePayload.grace_months = Number(graceMonths) || null;
        updatePayload.grace_type = graceType;
        updatePayload.grace_discount_pct = graceType === "partial" ? Number(graceDiscountPct) || null : null;
      } else {
        updatePayload.grace_months = null;
        updatePayload.grace_type = null;
        updatePayload.grace_discount_pct = null;
      }

      // Increase — save legacy fields from first tier
      if (hasIncrease && increaseMode === "per_unit" && Object.keys(perUnitTiers).length > 0) {
        // Per-unit mode: save indicator in legacy fields
        updatePayload.price_increase_type = "per_unit";
        updatePayload.price_increase_value = null;
        updatePayload.increase_steps = perUnitTiers; // backup all per-unit tiers in JSONB
      } else if (hasIncrease && priceTiers.length > 0) {
        const first = priceTiers[0];
        updatePayload.price_increase_type = first.increase_type;
        updatePayload.price_increase_value = first.increase_value || null;
        updatePayload.increase_steps = priceTiers; // backup in JSONB
      } else {
        updatePayload.price_increase_type = null;
        updatePayload.price_increase_value = null;
        updatePayload.price_increase_freq_months = null;
        updatePayload.price_increase_until_year = null;
        updatePayload.increase_steps = [];
      }

      // Deposit
      if (addGuarantee) {
        updatePayload.deposit_calculation_method = depositCalcMethod;
        updatePayload.deposit_includes_mgmt = depositIncludesMgmt;
      }

      // UPDATE contract
      const { error: ue } = await supabase.from("contracts").update(updatePayload).eq("id", id);
      if (ue) throw new Error(ue.message);

      // Delete + re-insert contract_spaces
      // IMPORTANT: if contract has amendments, save the ORIGINAL base spaces
      // exactly as they were — don't let effective-spaces overwrite them.
      var spacesToSave = selSpaces;
      if (contractHasAmendments && originalBaseSpaceIds.length > 0) {
        // Save original base spaces AS-IS (not the intersection with selSpaces)
        spacesToSave = originalBaseSpaceIds;
      }
      await supabase.from("contract_spaces").delete().eq("contract_id", id);
      if (spacesToSave.length > 0) {
        await supabase.from("contract_spaces").insert(
          spacesToSave.map((sid) => {
            var rType = unitRentTypes[sid] || "per_sqm";
            var rVal = unitRentOverrides[sid] ? Number(unitRentOverrides[sid]) : null;
            return {
              contract_id: id,
              space_id: sid,
              charge_method: rType,
              price_per_sqm: rType === "per_sqm" ? (rVal ?? Number(rentPerSqm) ?? null) : null,
              fixed_rent: rType === "fixed" ? rVal : null,
            };
          })
        );
      }

      // Save options: preserve status of existing options, delete removed ones
      // First load existing option statuses to preserve exercised state
      const { data: existingOpts } = await supabase.from("contract_options")
        .select("option_number,status,is_exercised").eq("contract_id", id);
      const existingStatusMap: Record<number, { status: string; is_exercised: boolean }> = {};
      (existingOpts ?? []).forEach(function(o: any) { existingStatusMap[o.option_number] = { status: o.status, is_exercised: o.is_exercised }; });

      await supabase.from("contract_options").delete().eq("contract_id", id);
      if (extensionOptions.length > 0) {
        const { data: insertedOpts, error: optErr } = await supabase.from("contract_options").insert(
          extensionOptions.map((opt, i) => {
            // Preserve existing status (exercised, etc.)
            const existing = existingStatusMap[i + 1];
            return {
              contract_id: id,
              option_number: i + 1,
              duration_months: Math.round(opt.duration_months || (opt.duration_years ? opt.duration_years * 12 : 12)),
              duration_years: opt.duration_years || null,
              start_date: opt.start_date || null,
              end_date: opt.end_date || null,
              notice_type: opt.notice_type || "exercise",
              notice_days_before_end: opt.notice_days_before_end || 90,
              rent_mechanism: opt.rent_mechanism || "no_change",
              new_rent_value: opt.new_rent_value || null,
              rent_increase_pct: opt.rent_increase_pct || null,
              auto_extend: opt.auto_renewal || false,
              status: existing?.status ?? "pending",
              is_exercised: existing?.is_exercised ?? false,
              notes: opt.notes || null,
              price_schedule_type: opt.price_schedule_type || "inherit",
              price_tiers: opt.price_schedule_type === "custom" ? (opt.price_tiers || []) : [],
              option_group: opt.option_group || null,
              exit_points: opt.exit_points?.length > 0 ? opt.exit_points : [],
            };
          })
        ).select("id,option_number");
        if (optErr) { console.error("Options save error:", optErr); alert("שגיאה בשמירת אופציות: " + optErr.message); }

        // Save option-level price tiers
        if (insertedOpts) {
          for (const dbOpt of insertedOpts) {
            const uiOpt = extensionOptions[dbOpt.option_number - 1];
            if (uiOpt?.price_schedule_type === "custom" && uiOpt.price_tiers?.length > 0) {
              const optPreviews = calculateTierPreviews(uiOpt.price_tiers, Number(rentPerSqm) || 0);
              await supabase.from("contract_price_tiers").insert(
                optPreviews.map((tier, i) => ({
                  contract_id: id,
                  option_id: dbOpt.id,
                  tier_number: i + 1,
                  start_date: uiOpt.start_date,
                  end_date: uiOpt.end_date,
                  increase_type: tier.increase_type,
                  increase_value: tier.increase_value || 0,
                  is_recurring: tier.is_recurring,
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

      // Delete + re-insert guarantee
      await supabase.from("guarantees").delete().eq("contract_id", id);
      if (addGuarantee && guaranteeAmt) {
        await supabase.from("guarantees").insert({
          contract_id: id,
          guarantee_type: guaranteeType,
          amount_required: Number(guaranteeAmt),
          amount_actual: guaranteeActual ? Number(guaranteeActual) : null,
          bank: guaranteeBank || null,
          end_date: guaranteeEnd || null,
          status: "active",
        });
      }

      // Delete + re-insert price tiers (save ORIGINAL tiers, not expanded)
      console.log("TIERS SAVE: hasIncrease=" + hasIncrease + " increaseMode=" + increaseMode + " perUnitTiers=" + JSON.stringify(Object.keys(perUnitTiers)) + " priceTiers.length=" + priceTiers.length);
      await supabase.from("contract_price_tiers").delete().eq("contract_id", id);
      if (hasIncrease) {
        const contractStart = new Date(startDate);
        var allTiersToInsert: any[] = [];

        if (increaseMode === "per_unit" && Object.keys(perUnitTiers).length > 0) {
          var globalTierNum = 0; // running counter across all spaces (UNIQUE constraint on contract_id + tier_number)
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
                contract_id: id,
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
          var tiersWithPreviews = calculateTierPreviews(priceTiers, Number(rentPerSqm) || 0);
          priceTiers.forEach(function(tier, i) {
            var preview = tiersWithPreviews.find(function(t) { return t.from_year === tier.from_year && t.to_year === tier.to_year; }) || tiersWithPreviews[i];
            var tierStart = new Date(contractStart);
            tierStart.setFullYear(tierStart.getFullYear() + tier.from_year - 1);
            var tierEnd = new Date(contractStart);
            tierEnd.setFullYear(tierEnd.getFullYear() + tier.to_year);
            allTiersToInsert.push({
              contract_id: id,
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
          console.log("Inserting " + allTiersToInsert.length + " price tiers:", JSON.stringify(allTiersToInsert));
          var { error: tiersErr } = await supabase.from("contract_price_tiers").insert(allTiersToInsert);
          if (tiersErr) {
            console.error("Failed to insert price tiers:", tiersErr);
            alert("שגיאה בשמירת מדרגות מחיר: " + tiersErr.message);
          }
        } else {
          console.log("No tiers to insert. hasIncrease=" + hasIncrease + " increaseMode=" + increaseMode + " perUnitTiers keys=" + Object.keys(perUnitTiers).length + " priceTiers=" + priceTiers.length);
        }
      }

      await logAudit({ entity_type: "contract", entity_id: id, action: "update" });
      router.push("/contracts");
    } catch (e: any) {
      alert("שגיאה: " + e?.message);
    } finally {
      setSaving(false);
    }
  }

  const tenant = tenants.find((t) => t.id === tenantId);
  const property = properties.find((p) => p.id === propertyId);

  if (loading) {
    return (
      <div dir="rtl" className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">📄</div>
          <div className="text-slate-400">טוען חוזה...</div>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">עריכת חוזה</h1>
          <p className="text-sm text-slate-500 mt-1">{tenant?.name} — {property?.name}</p>
        </div>
        <button onClick={() => router.push("/contracts")} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
          ← חזרה לחוזים
        </button>
      </div>

      {/* Steps */}
      <div className="flex gap-0 mb-8">
        {STEPS.map((s, i) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <div key={s.id} className="flex-1 flex items-center">
              <div
                className={"flex items-center gap-2 cursor-pointer " + (active ? "" : "opacity-50")}
                onClick={() => setStep(s.id)}
              >
                <div
                  className={"w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-all " +
                    (done ? "bg-green-500 text-white" : active ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500")}
                >
                  {done ? "✓" : s.icon}
                </div>
                <span className={"text-xs font-semibold hidden sm:block " + (active ? "text-blue-700" : "text-slate-400")}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={"flex-1 h-px mx-2 " + (step > s.id ? "bg-green-400" : "bg-slate-200")} />
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        {/* STEP 1 */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 text-lg mb-4">👤 שוכר ונכס</h2>
            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-700">סוג חוזה</label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {CONTRACT_TYPES.map((ct) => (
                  <button key={ct.v} type="button" onClick={() => setContractType(ct.v)}
                    className={"rounded-lg border p-2 text-center text-xs transition-all " +
                      (contractType === ct.v ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-slate-50")}>
                    {ct.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר *</label>
              <div className="flex gap-2">
                <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={ic + " flex-1"}>
                  <option value="">-- בחר שוכר --</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.company_name ? " — " + t.company_name : ""}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setShowNewTenant(true)}
                  className="rounded-lg bg-green-600 text-white px-3 py-2 text-xs font-bold hover:bg-green-700 whitespace-nowrap">
                  + שוכר חדש
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
              <div className="flex gap-2">
                <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className={ic + " flex-1"}>
                  <option value="">-- בחר נכס --</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.city ? " — " + p.city : ""}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setShowNewProperty(true)}
                  className="rounded-lg bg-green-600 text-white px-3 py-2 text-xs font-bold hover:bg-green-700 whitespace-nowrap">
                  + נכס חדש
                </button>
              </div>
            </div>
            {spaces.length > 0 && (
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">שטחים משויכים לחוזה</label>
                <div className="grid grid-cols-3 gap-2">
                  {spaces.map((s) => {
                    const sel = selSpaces.includes(s.id);
                    return (
                      <button key={s.id} type="button" onClick={() => toggleSpace(s.id)}
                        className={"rounded-lg border p-2 text-center text-xs transition-all " +
                          (sel ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-slate-50")}>
                        <div className="font-semibold">{s.space_name}</div>
                        {s.area && <div className="text-slate-400">{s.area} מ&quot;ר</div>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 text-lg mb-4">📋 תנאי שכירות</h2>

            <div className="flex items-center gap-2 mb-2">
              <input type="checkbox" id="editFutureHandover" checked={hasFutureHandover}
                onChange={(e) => setHasFutureHandover(e.target.checked)} className="w-4 h-4" />
              <label htmlFor="editFutureHandover" className="text-xs font-semibold text-slate-700">חוזה עם תהליך מסירה</label>
            </div>
            {hasFutureHandover && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 mb-3 space-y-3">
                <div className="text-xs font-bold text-amber-800">📋 פרטי מסירה</div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-slate-600">תאריך חתימה</label>
                    <input type="date" value={signingDate} onChange={(e) => setSigningDate(e.target.value)} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-slate-600">יעד מסירה</label>
                    <input type="date" value={plannedHandover} onChange={(e) => setPlannedHandover(e.target.value)} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-slate-600">מסירה בפועל</label>
                    <input type="date" value={actualHandover}
                      onChange={(e) => { setActualHandover(e.target.value); if (e.target.value && !startDate) setStartDate(e.target.value); }}
                      className={ic} />
                  </div>
                </div>
                <div className="text-[10px] text-amber-600">
                  {!actualHandover ? "⏳ טרם נמסר" : "✅ נמסר — " + new Date(actualHandover).toLocaleDateString("he-IL")}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">{hasFutureHandover ? "תחילת שכירות *" : "תחילת חוזה *"}</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={ic} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תקופה *</label>
                  <input type="number" min="1" value={leasePeriodValue}
                    onChange={(e) => setLeasePeriodValue(Number(e.target.value) || 0)} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">יחידה</label>
                  <select value={leasePeriodUnit} onChange={(e) => setLeasePeriodUnit(e.target.value as any)} className={ic}>
                    <option value="months">חודשים</option>
                    <option value="years">שנים</option>
                  </select>
                </div>
              </div>
            </div>
            {endDate && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-green-700 font-semibold">תאריך סיום מחושב</span>
                <span className="text-lg font-black text-green-800">{new Date(endDate).toLocaleDateString("he-IL")}</span>
              </div>
            )}
            {/* Rent type toggle */}
            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-slate-700">סוג שכ&quot;ד</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setRentType("fixed")}
                  className={"rounded-lg border px-4 py-2 text-sm font-semibold transition-all " +
                    (rentType === "fixed" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                  💰 שכ&quot;ד קבוע
                </button>
                <button type="button" onClick={() => setRentType("revenue_pct")}
                  className={"rounded-lg border px-4 py-2 text-sm font-semibold transition-all " +
                    (rentType === "revenue_pct" ? "border-purple-500 bg-purple-50 text-purple-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                  📊 אחוז מפדיון
                </button>
              </div>
            </div>

            {rentType === "revenue_pct" && (
              <div className="rounded-lg border border-purple-200 bg-purple-50/30 p-4 mb-3 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">אחוז מפדיון (%) *</label>
                    <input type="number" value={revenuePct} onChange={(e) => setRevenuePct(e.target.value)} className={ic} placeholder="12" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">דמי שכירות מינימום (₪/חודש)</label>
                    <input type="number" value={minimumRent} onChange={(e) => setMinimumRent(e.target.value)} className={ic} placeholder="0" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">יום דיווח מחזור</label>
                    <input type="number" value={revenueReportDay} onChange={(e) => setRevenueReportDay(e.target.value)} className={ic} />
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <input type="checkbox" id="mgmtInRev" checked={mgmtIncludedInRevenue}
                      onChange={(e) => setMgmtIncludedInRevenue(e.target.checked)} className="rounded" />
                    <label htmlFor="mgmtInRev" className="text-xs text-slate-700">דמי ניהול כלולים באחוז מהמחזור</label>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שכ&quot;ד למ&quot;ר (₪) {rentType === "fixed" ? "*" : "(מינימום/בסיס)"}</label>
                <input type="number" value={rentPerSqm} onChange={(e) => setRentPerSqm(e.target.value)} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שטח מחויב (מ&quot;ר)</label>
                <input type="number" value={chargedArea} onChange={(e) => setChargedArea(e.target.value)} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תוספת השקעות (₪)</label>
                <input type="number" value={investAdd} onChange={(e) => setInvestAdd(e.target.value)} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מע&quot;מ</label>
                <select value={vatType} onChange={(e) => setVatType(e.target.value)} className={ic}>
                  {VAT_TYPES.map((v) => <option key={v.v} value={v.v}>{v.l}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תדירות תשלום</label>
                <select value={paymentFreq} onChange={(e) => setPaymentFreq(e.target.value)} className={ic}>
                  {PAYMENT_FREQS.map((v) => <option key={v.v} value={v.v}>{v.l}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שיטת תשלום</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={ic}>
                  {PAYMENT_METHODS.map((v) => <option key={v.v} value={v.v}>{v.icon} {v.l}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">יום תשלום בחודש</label>
                <input type="number" min="1" max="28" value={paymentDay} onChange={(e) => setPaymentDay(e.target.value)} className={ic} />
              </div>
            </div>
            {baseRent > 0 && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
                <div className="text-xs font-bold text-blue-700 mb-2">תצוגת שכ&quot;ד חודשי</div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { l: 'שכ"ד בסיס', v: fmtMoney(baseRent) },
                    { l: 'מע"מ', v: fmtMoney(vat) },
                    { l: 'סה"כ לחודש', v: fmtMoney(totalRent) },
                  ].map((k) => (
                    <div key={k.l}>
                      <div className="text-lg font-black text-blue-800">{k.v}</div>
                      <div className="text-xs text-blue-600">{k.l}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Per-unit pricing display */}
            {selSpaces.length > 1 && Object.keys(unitRentOverrides).length > 0 && (
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-sm font-bold text-slate-700 mb-2">מחיר לפי יחידה</div>
                <div className="text-xs text-slate-500 mb-3">בחר למ&quot;ר או סכום קבוע לכל יחידה.</div>
                <div className="space-y-2">
                  {selSpaces.map(function(sid) {
                    var sp = spaces.find(function(s) { return s.id === sid; });
                    if (!sp) return null;
                    var rType = unitRentTypes[sid] || "per_sqm";
                    var rVal = unitRentOverrides[sid] || "";
                    var unitTotal = rType === "fixed" ? (Number(rVal) || 0) : (Number(rVal || rentPerSqm) || 0) * (sp.area || 0);
                    return (
                      <div key={sid} className="rounded-lg border border-slate-100 p-2 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-600 flex-1 truncate">{sp.space_name}</span>
                          <span className="text-xs text-slate-500">{sp.area} מ&quot;ר</span>
                          <div className="flex gap-1">
                            <button type="button" onClick={function(){setUnitRentTypes(function(prev){return {...prev,[sid]:"per_sqm"};});}}
                              className={"rounded border px-2 py-0.5 text-xs " + (rType === "per_sqm" ? "border-blue-500 bg-blue-50 text-blue-700 font-bold" : "border-slate-200 text-slate-500")}>למ&quot;ר</button>
                            <button type="button" onClick={function(){setUnitRentTypes(function(prev){return {...prev,[sid]:"fixed"};});}}
                              className={"rounded border px-2 py-0.5 text-xs " + (rType === "fixed" ? "border-blue-500 bg-blue-50 text-blue-700 font-bold" : "border-slate-200 text-slate-500")}>סכום קבוע</button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="number" value={rVal}
                            onChange={function(e){setUnitRentOverrides(function(prev){return {...prev,[sid]:e.target.value};});}}
                            placeholder={rType === "fixed" ? "סכום חודשי" : "₪/מ\"ר"}
                            className={ic + " flex-1 max-w-40"} />
                          <span className="text-xs text-slate-500">{rType === "fixed" ? "₪/חודש" : "₪/מ\"ר"}</span>
                          {unitTotal > 0 && <span className="text-xs font-bold text-green-700 mr-2">= {fmtMoney(unitTotal)}/חודש</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {baseRent > 0 && (
                  <div className="mt-3 rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                    <div className="text-lg font-black text-green-800">{fmtMoney(baseRent)}/חודש</div>
                    <div className="text-xs text-green-600">סה&quot;כ שכ&quot;ד כל היחידות</div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שיטת הצמדה</label>
                <select value={indexMethod} onChange={(e) => setIndexMethod(e.target.value)} className={ic}>
                  {INDEX_METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מדד בסיס</label>
                <div className="flex gap-2">
                  <input type="number" value={baseCPI} onChange={(e) => setBaseCPI(e.target.value)}
                    placeholder="נטען אוטומטית" className={ic + " flex-1"} />
                  <button type="button" disabled={cbsFetching || !baseCPIDate}
                    onClick={async () => {
                      if (!baseCPIDate) { alert("נא לבחור תאריך מדד בסיס קודם"); return; }
                      var d = new Date(baseCPIDate);
                      var day = d.getDate();
                      if (day === 15) {
                        alert("ה-15 לחודש הוא תאריך פרסום המדד. יש לבחור עד 14 לחודש או מ-16 ואילך.");
                        return;
                      }
                      setCbsFetching(true);
                      try {
                        // t-2 rule: known CPI at this date
                        var knownDate = new Date(d);
                        if (day >= 16) knownDate.setMonth(knownDate.getMonth() - 1);
                        else knownDate.setMonth(knownDate.getMonth() - 2);
                        var knownYear = knownDate.getFullYear();
                        var knownMonth = knownDate.getMonth() + 1;
                        var res = await fetch("/api/cpi?year=" + knownYear);
                        var data = await res.json();
                        var rec = (data.records || []).find(function(r: any) { return r.year === knownYear && r.month === knownMonth; });
                        var HEB_MONTHS = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
                        if (rec) {
                          setBaseCPI(rec.value.toString());
                          setCbsFetchedMonth(HEB_MONTHS[knownMonth] + " " + knownYear);
                        } else alert("מדד " + knownMonth + "/" + knownYear + " לא פורסם עדיין");
                      } catch (e: any) { alert("שגיאה: " + e.message); }
                      finally { setCbsFetching(false); }
                    }}
                    className="rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-40 whitespace-nowrap">
                    {cbsFetching ? "טוען..." : "משוך מדד"}
                  </button>
                </div>
                {cbsFetchedMonth && baseCPI && (
                  <div className="text-xs text-blue-600 mt-1 font-semibold">📊 מדד {cbsFetchedMonth} = {baseCPI}</div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך פרסום מדד הבסיס (מדד ידוע)</label>
                <input type="date" value={baseCPIDate} onChange={(e) => setBaseCPIDate(e.target.value)} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">דמי ניהול (₪/מ&quot;ר)</label>
                <input type="number" value={mgmtFeePct} onChange={(e) => setMgmtFeePct(e.target.value)} className={ic} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">קישור לחוזה מקורי (URL)</label>
              <input type="url" value={documentUrl} onChange={(e) => setDocumentUrl(e.target.value)}
                placeholder="https://drive.google.com/..." className={ic} dir="ltr" />
            </div>

            {/* Parking section */}
            {propertyId && (
              <div className="mt-6 pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-semibold text-slate-700">🅿️ חניות</label>
                  <button type="button" onClick={async function() {
                    var spot = prompt("מספר מקומות:");
                    if (!spot) return;
                    var fee = prompt("דמי חניה למקום/חודש (0 אם כלול):");
                    await supabase.from("parking_subscriptions").insert({
                      property_id: propertyId, tenant_id: tenantId || null,
                      quantity: Number(spot) || 1, monthly_fee: Number(fee) || 0,
                      subscription_type: "monthly", status: "active",
                    });
                    var { data: pk } = await supabase.from("parking_subscriptions").select("id,spot_number,quantity,monthly_fee,is_marked,is_included_in_rent,tenants(name)")
                      .eq("property_id", propertyId).order("spot_number");
                    setEditParkingSpots(pk ?? []);
                  }} className="rounded-lg bg-green-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-green-700">
                    + חניה
                  </button>
                </div>
                {editParkingSpots.length > 0 ? (
                  <div className="space-y-1">
                    {editParkingSpots.map(function(p: any) {
                      var qty = p.quantity || 1;
                      return (
                        <div key={p.id} className="rounded-lg border border-slate-200 p-2 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-semibold">{p.is_marked && p.spot_number ? "חניות " + p.spot_number : qty + " מקומות"}</span>
                            {p.monthly_fee > 0 && <span className="text-slate-400 mr-2">₪{(p.monthly_fee * qty).toLocaleString()}/חודש</span>}
                            {p.is_included_in_rent && <span className="text-orange-500 mr-1">(כלול)</span>}
                            {p.tenants?.name && <span className="text-green-600 mr-2">👤 {p.tenants.name}</span>}
                          </div>
                          <button onClick={async function() {
                            if (!confirm("למחוק?")) return;
                            await supabase.from("parking_subscriptions").delete().eq("id", p.id);
                            var { data: pk } = await supabase.from("parking_subscriptions").select("id,spot_number,quantity,monthly_fee,is_marked,is_included_in_rent,tenants(name)")
                              .eq("property_id", propertyId).order("spot_number");
                            setEditParkingSpots(pk ?? []);
                          }} className="text-red-500 hover:text-red-700">🗑</button>
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

        {/* STEP 3 — Grace & Increase */}
        {step === 3 && (
          <div className="space-y-5">
            <h2 className="font-bold text-slate-800 text-lg mb-4">📈 גרייס ועלייה שנתית</h2>
            {/* Grace */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <input type="checkbox" id="grace" checked={hasGrace} onChange={(e) => setHasGrace(e.target.checked)} className="w-4 h-4" />
                <label htmlFor="grace" className="text-sm font-bold text-slate-700">תקופת גרייס</label>
              </div>
              {hasGrace && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">מספר חודשי גרייס</label>
                      <input type="number" min="1" max="24" value={graceMonths} onChange={(e) => setGraceMonths(e.target.value)} className={ic} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">סוג גרייס</label>
                      <select value={graceType} onChange={(e) => setGraceType(e.target.value)} className={ic}>
                        {GRACE_TYPES.map((g) => <option key={g.v} value={g.v}>{g.l}</option>)}
                      </select>
                    </div>
                  </div>
                  {graceType === "partial" && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">אחוז הנחה בגרייס (%)</label>
                      <input type="number" min="1" max="99" value={graceDiscountPct} onChange={(e) => setGraceDiscountPct(e.target.value)} className={ic} />
                    </div>
                  )}
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
                  <label htmlFor="increase" className="text-sm font-bold text-slate-700">עלייה מדורגת בשכ&quot;ד (Step-Rent)</label>
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

              {/* Unified / Per-unit toggle */}
              {hasIncrease && selSpaces.length > 1 && Object.keys(unitRentOverrides).some(k => unitRentOverrides[k]) && (
                <div className="flex gap-2 mb-4">
                  <button type="button" onClick={() => setIncreaseMode("unified")}
                    className={"rounded-lg border px-4 py-2 text-xs font-bold transition-all " +
                      (increaseMode === "unified" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                    מנגנון אחיד לכל היחידות
                  </button>
                  <button type="button" onClick={() => {
                    setIncreaseMode("per_unit");
                    setPerUnitTiers(prev => {
                      const next = { ...prev };
                      selSpaces.forEach(sid => { if (!next[sid] || next[sid].length === 0) next[sid] = [emptyPriceTier(1)]; });
                      return next;
                    });
                  }}
                    className={"rounded-lg border px-4 py-2 text-xs font-bold transition-all " +
                      (increaseMode === "per_unit" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                    מנגנון נפרד לכל יחידה
                  </button>
                </div>
              )}

              {/* UNIFIED MODE */}
              {hasIncrease && increaseMode === "unified" && (() => {
                const contractYears = leasePeriodUnit === "years" ? leasePeriodValue : Math.ceil(leasePeriodValue / 12);
                const errors = validatePriceTiers(priceTiers, contractYears);
                const previews = calculateTierPreviews(priceTiers, Number(rentPerSqm) || 0);
                return (
                  <div className="space-y-3">
                    {errors.length > 0 && (
                      <div className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-1">
                        {errors.map((err, i) => (
                          <div key={i} className="text-xs text-red-600 flex items-center gap-1"><span>⚠️</span> {err}</div>
                        ))}
                      </div>
                    )}
                    {priceTiers.length > 0 && (() => {
                      const sorted = [...priceTiers].sort((a, b) => a.from_year - b.from_year);
                      if (sorted[0]?.from_year > 1) {
                        return (
                          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-700 font-semibold">
                            שנים 1–{sorted[0].from_year - 1}: {fmtMoney(Number(rentPerSqm) || 0)}/מ&quot;ר (מחיר בסיס)
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
                              className={"rounded-lg border px-3 py-1.5 text-xs transition-all " + (!tier.is_recurring ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-white")}>
                              📅 טווח שנים
                            </button>
                            <button type="button" onClick={() => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, is_recurring: true } : t))}
                              className={"rounded-lg border px-3 py-1.5 text-xs transition-all " + (tier.is_recurring ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-white")}>
                              🔁 חוזר כל X שנים
                            </button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {!tier.is_recurring ? (
                              <>
                                <div>
                                  <label className="mb-1 block text-xs text-slate-500">משנה</label>
                                  <input type="number" min="1" value={tier.from_year}
                                    onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, from_year: Number(e.target.value) || 1 } : t))} className={ic} />
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs text-slate-500">עד שנה</label>
                                  <input type="number" min="1" value={tier.to_year}
                                    onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, to_year: Number(e.target.value) || 1 } : t))} className={ic} />
                                </div>
                              </>
                            ) : (
                              <>
                                <div>
                                  <label className="mb-1 block text-xs text-slate-500">כל X שנים</label>
                                  <input type="number" min="1" max="10" value={tier.recurring_every_years ?? 1}
                                    onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, recurring_every_years: Number(e.target.value) || 1 } : t))} className={ic} />
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs text-slate-500">עד שנה</label>
                                  <input type="number" min="1" value={tier.to_year}
                                    onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, to_year: Number(e.target.value) || 1 } : t))} className={ic} />
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
                                {tier.increase_type === "pct" ? "שיעור עלייה (%)" : tier.increase_type === "fixed_sqm" ? 'תוספת למ"ר (₪)' : "תוספת קבועה לחודש (₪)"}
                              </label>
                              <input type="number" step="0.1" value={tier.increase_value || ""}
                                onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, increase_value: Number(e.target.value) || 0 } : t))} className={ic} />
                            </div>
                          )}
                          <input type="text" value={tier.notes} placeholder="הערות (אופציונלי)"
                            onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, notes: e.target.value } : t))} className={ic + " text-xs"} />
                          {Number(rentPerSqm) > 0 && (function() {
                            var expanded = calculateTierPreviews([tier], idx === 0 ? Number(rentPerSqm) : (previews[idx-1]?.calculated_rent_per_sqm ?? Number(rentPerSqm)));
                            if (!expanded.length) return null;
                            return (
                              <div className={"rounded-lg px-3 py-2 text-xs font-semibold space-y-0.5 " + (hasError ? "bg-red-100 text-red-700" : "bg-green-50 border border-green-200 text-green-700")}>
                                {expanded.map(function(exp, ei) {
                                  return (
                                    <div key={ei}>
                                      שנים {exp.from_year}-{exp.to_year}: {exp.increase_type === "none"
                                        ? `מחיר קפוא — ${fmtMoney(Number(rentPerSqm))}/מ"ר`
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

              {/* PER-UNIT MODE */}
              {hasIncrease && increaseMode === "per_unit" && (() => {
                var contractYears = leasePeriodUnit === "years" ? leasePeriodValue : Math.ceil(leasePeriodValue / 12);
                return (
                  <div className="space-y-4">
                    {selSpaces.map(function(sid) {
                      var sp = spaces.find(function(s: any) { return s.id === sid; });
                      if (!sp) return null;
                      var rType = (sp as any).charge_method || "per_sqm";
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
                                    setPerUnitTiers(function(prev) { var next = { ...prev }; next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, is_recurring: false } : t; }); return next; });
                                  }} className={"rounded border px-2 py-1 text-[10px] " + (!tier.is_recurring ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200")}>
                                    📅 טווח
                                  </button>
                                  <button type="button" onClick={function() {
                                    setPerUnitTiers(function(prev) { var next = { ...prev }; next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, is_recurring: true } : t; }); return next; });
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
                                          onChange={function(e) { setPerUnitTiers(function(prev) { var next = { ...prev }; next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, from_year: Number(e.target.value) || 1 } : t; }); return next; }); }}
                                          className={ic + " text-xs"} />
                                      </div>
                                      <div>
                                        <label className="mb-0.5 block text-[10px] text-slate-400">עד שנה</label>
                                        <input type="number" min="1" value={tier.to_year}
                                          onChange={function(e) { setPerUnitTiers(function(prev) { var next = { ...prev }; next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, to_year: Number(e.target.value) || 1 } : t; }); return next; }); }}
                                          className={ic + " text-xs"} />
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <div>
                                        <label className="mb-0.5 block text-[10px] text-slate-400">כל X שנים</label>
                                        <input type="number" min="1" max="10" value={tier.recurring_every_years ?? 1}
                                          onChange={function(e) { setPerUnitTiers(function(prev) { var next = { ...prev }; next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, recurring_every_years: Number(e.target.value) || 1 } : t; }); return next; }); }}
                                          className={ic + " text-xs"} />
                                      </div>
                                      <div>
                                        <label className="mb-0.5 block text-[10px] text-slate-400">עד שנה</label>
                                        <input type="number" min="1" value={tier.to_year}
                                          onChange={function(e) { setPerUnitTiers(function(prev) { var next = { ...prev }; next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, to_year: Number(e.target.value) || 1 } : t; }); return next; }); }}
                                          className={ic + " text-xs"} />
                                      </div>
                                    </>
                                  )}
                                  <div className="col-span-2">
                                    <label className="mb-0.5 block text-[10px] text-slate-400">סוג עלייה</label>
                                    <div className="flex gap-1 flex-wrap">
                                      {INCREASE_TYPES.map(function(it) { return (
                                        <button key={it.v} type="button"
                                          onClick={function() { setPerUnitTiers(function(prev) { var next = { ...prev }; next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, increase_type: it.v as PriceTier["increase_type"] } : t; }); return next; }); }}
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
                                      onChange={function(e) { setPerUnitTiers(function(prev) { var next = { ...prev }; next[sid] = unitTiers.map(function(t, i) { return i === idx ? { ...t, increase_value: Number(e.target.value) || 0 } : t; }); return next; }); }}
                                      placeholder={tier.increase_type === "pct" ? "%" : "₪"}
                                      className={ic + " text-xs"} />
                                  </div>
                                )}
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

              {!hasIncrease && <div className="text-xs text-slate-400 mt-1">ללא עלייה שנתית (מעבר להצמדה)</div>}
            </div>
          </div>
        )}

        {/* STEP 4 — Options */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800 text-lg">🔄 אופציות להארכת חוזה</h2>
              <div className="flex gap-2">
                <button type="button" onClick={() => setExtensionOptions((prev) => [...prev, emptyOption()])}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800">+ אופציה רציפה</button>
                <button type="button" onClick={() => {
                  var groups = extensionOptions.map(function(o) { return o.option_group; }).filter(Boolean);
                  var nextGroup = "A";
                  if (groups.length > 0) {
                    var lastGroup = groups.sort().pop() || "A";
                    nextGroup = String.fromCharCode(lastGroup.charCodeAt(0) + 1);
                  }
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
                  className="rounded-lg border border-purple-400 bg-purple-50 px-4 py-2 text-xs font-bold text-purple-700 hover:bg-purple-100">+ חלופית (A/B)</button>
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
                        <span className="rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-[10px] font-bold">חלופה {opt.option_group}</span>
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
                        {NOTICE_TYPES.map((nt) => <option key={nt.v} value={nt.v}>{nt.l}</option>)}
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
                        {RENT_MECHANISMS.map((rm) => <option key={rm.v} value={rm.v}>{rm.l}</option>)}
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
                        <label className="mb-1 block text-xs font-semibold text-slate-700">מחיר חדש למ&quot;ר (₪)</label>
                        <input type="number" value={opt.new_rent_value ?? ""}
                          onChange={(e) => updateOption(idx, "new_rent_value", Number(e.target.value) || null)} className={ic} />
                      </div>
                    )}
                  </div>
                  {opt.start_date && opt.end_date && (
                    <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 flex justify-between text-xs text-green-700">
                      <span>תחילה: {new Date(opt.start_date).toLocaleDateString("he-IL")}</span>
                      <span>סיום: {new Date(opt.end_date).toLocaleDateString("he-IL")}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={opt.auto_renewal} onChange={(e) => updateOption(idx, "auto_renewal", e.target.checked)} className="w-4 h-4" />
                    <label className="text-xs font-semibold text-slate-700">הארכה אוטומטית (אם לא נמסרה הודעה)</label>
                  </div>
                  {/* Price Schedule within Option */}
                  {opt.duration_years > 1 && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-blue-800">מנגנון עליית מחיר בתקופת אופציה:</label>
                        <div className="flex gap-1">
                          <button type="button" onClick={() => updateOption(idx, "price_schedule_type", "inherit")}
                            className={"rounded border px-2.5 py-1 text-xs transition-all " + ((opt.price_schedule_type ?? "inherit") === "inherit" ? "border-blue-500 bg-blue-100 font-bold text-blue-700" : "border-slate-200 bg-white")}>
                            המשך מחוזה ראשי
                          </button>
                          <button type="button" onClick={() => {
                            updateOption(idx, "price_schedule_type", "custom");
                            if (!opt.price_tiers || opt.price_tiers.length === 0) updateOption(idx, "price_tiers", [emptyPriceTier(1)]);
                          }} className={"rounded border px-2.5 py-1 text-xs transition-all " + (opt.price_schedule_type === "custom" ? "border-blue-500 bg-blue-100 font-bold text-blue-700" : "border-slate-200 bg-white")}>
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
                                  <span className="text-xs font-bold text-slate-600">שלב {tIdx + 1}</span>
                                  {(opt.price_tiers || []).length > 1 && (
                                    <button type="button" onClick={() => {
                                      const newTiers = (opt.price_tiers || []).filter((_: any, i: number) => i !== tIdx);
                                      updateOption(idx, "price_tiers", newTiers);
                                    }} className="text-xs text-red-500">הסר</button>
                                  )}
                                </div>
                                <div className="grid grid-cols-4 gap-2">
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
                                    <input type="number" step="0.1" value={tier.increase_value || ""}
                                      onChange={(e) => {
                                        const newTiers = [...(opt.price_tiers || [])];
                                        newTiers[tIdx] = { ...newTiers[tIdx], increase_value: Number(e.target.value) || 0 };
                                        updateOption(idx, "price_tiers", newTiers);
                                      }} className={ic} placeholder={tier.increase_type === "pct" ? "%" : "₪"} />
                                  </div>
                                )}
                                {hasError && <div className="text-xs text-red-500">⚠️ חורג מתקופת האופציה</div>}
                              </div>
                            );
                          })}
                          <button type="button" onClick={() => {
                            const tiers = opt.price_tiers || [];
                            const last = tiers[tiers.length - 1];
                            updateOption(idx, "price_tiers", [...tiers, emptyPriceTier(last ? last.to_year + 1 : 1)]);
                          }} className="rounded border border-dashed border-blue-300 px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 w-full">
                            + שלב נוסף
                          </button>

                          {/* Price preview */}
                          {(() => {
                            // Chain from main → previous options → this option
                            let optBase = Number(rentPerSqm) || 0;
                            if (priceTiers.length > 0) {
                              const mainPrev = calculateTierPreviews(priceTiers, optBase);
                              optBase = mainPrev[mainPrev.length - 1]?.calculated_rent_per_sqm ?? optBase;
                            }
                            for (let pi = 0; pi < idx; pi++) {
                              const prevOpt = extensionOptions[pi];
                              if (prevOpt.rent_mechanism === "increase_pct" && prevOpt.rent_increase_pct) {
                                optBase = optBase * (1 + prevOpt.rent_increase_pct / 100);
                              } else if (prevOpt.rent_mechanism === "new_value" && prevOpt.new_rent_value) {
                                optBase = prevOpt.new_rent_value;
                              }
                              if (prevOpt.price_schedule_type === "custom" && prevOpt.price_tiers?.length > 0) {
                                const prevPreviews = calculateTierPreviews(prevOpt.price_tiers, optBase);
                                optBase = prevPreviews[prevPreviews.length - 1]?.calculated_rent_per_sqm ?? optBase;
                              }
                            }
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
                      {(opt.price_schedule_type ?? "inherit") === "inherit" && (
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
                        <div className="text-[10px] text-orange-500">אין נקודות יציאה — השוכר מחויב לכל תקופת האופציה</div>
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
                              <span className="text-orange-700">הודעה מראש (ימים)</span>
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

                  {/* Year-by-year price forecast */}
                  {opt.duration_years > 0 && Number(rentPerSqm) > 0 && (function() {
                    // Calculate base rent at option start (chain from main → previous options → this)
                    var forecastBase = Number(rentPerSqm) || 0;
                    if (priceTiers.length > 0) {
                      var mp = calculateTierPreviews(priceTiers, forecastBase);
                      forecastBase = mp[mp.length - 1]?.calculated_rent_per_sqm ?? forecastBase;
                    }
                    // For alternatives, use contract last rent
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
                    // Apply this option's exercise jump
                    if (opt.rent_mechanism === "increase_pct" && opt.rent_increase_pct) forecastBase = forecastBase * (1 + opt.rent_increase_pct / 100);
                    else if (opt.rent_mechanism === "new_value" && opt.new_rent_value) forecastBase = opt.new_rent_value;
                    forecastBase = Math.round(forecastBase * 100) / 100;

                    // Build year-by-year forecast
                    var years = Math.ceil(opt.duration_years);
                    var forecast: Array<{year: number; rent: number; label: string}> = [];
                    var currentRent = forecastBase;

                    if (opt.price_schedule_type === "custom" && opt.price_tiers?.length > 0) {
                      var expanded = calculateTierPreviews(opt.price_tiers, forecastBase);
                      forecast.push({ year: 1, rent: forecastBase, label: "בסיס" });
                      expanded.forEach(function(t) { forecast.push({ year: t.to_year, rent: t.calculated_rent_per_sqm ?? currentRent, label: t.increase_type === "pct" ? "+" + t.increase_value + "%" : t.increase_type === "fixed_sqm" ? "+₪" + t.increase_value : "" }); });
                    } else if (priceTiers.length > 0) {
                      // Inherit — apply main tiers pattern
                      forecast.push({ year: 1, rent: forecastBase, label: "בסיס (מימוש)" });
                      var virtualTiers = priceTiers.map(function(mt) { return { ...mt, from_year: Math.min(mt.from_year, years), to_year: Math.min(mt.to_year, years) }; }).filter(function(t) { return t.from_year < t.to_year; });
                      if (virtualTiers.length > 0) {
                        var vp = calculateTierPreviews(virtualTiers, forecastBase);
                        vp.forEach(function(t) { forecast.push({ year: t.to_year, rent: t.calculated_rent_per_sqm ?? currentRent, label: t.increase_type === "pct" ? "+" + t.increase_value + "%" : "" }); });
                      }
                    } else {
                      forecast.push({ year: 1, rent: forecastBase, label: "קבוע" });
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

        {/* STEP 5 — Guarantees */}
        {step === 5 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 text-lg mb-4">🏦 ביטחונות</h2>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="guar" checked={addGuarantee} onChange={(e) => setAddGuarantee(e.target.checked)} className="w-4 h-4" />
              <label htmlFor="guar" className="text-sm font-semibold text-slate-700">הוסף ערבות לחוזה</label>
            </div>
            {addGuarantee && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {GUARANTEE_TYPES.map((t) => (
                    <button key={t.v} type="button" onClick={() => setGuaranteeType(t.v)}
                      className={"rounded-xl border p-2.5 text-center " + (guaranteeType === t.v ? "border-blue-500 bg-blue-50" : "border-slate-200")}>
                      <div>{t.icon}</div>
                      <div className={"text-xs font-semibold " + (guaranteeType === t.v ? "text-blue-700" : "text-slate-600")}>{t.l}</div>
                    </button>
                  ))}
                </div>
                <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="text-xs font-bold text-slate-700 mb-2">שיטת חישוב סכום ערבות</div>
                  <div className="flex gap-2">
                    {DEPOSIT_METHODS.map((dm) => (
                      <button key={dm.v} type="button" onClick={() => setDepositCalcMethod(dm.v as any)}
                        className={"rounded-lg border px-3 py-2 text-xs transition-all " +
                          (depositCalcMethod === dm.v ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-slate-50")}>
                        {dm.l}
                      </button>
                    ))}
                  </div>
                  {depositCalcMethod === "months_based" && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">מספר חודשים</label>
                          <input type="number" min="1" value={depositMonths} onChange={(e) => setDepositMonths(Number(e.target.value) || 1)} className={ic} />
                        </div>
                        <div className="flex items-end pb-2">
                          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                            <input type="checkbox" checked={depositIncludesMgmt} onChange={(e) => setDepositIncludesMgmt(e.target.checked)} className="w-4 h-4" />
                            כולל דמי ניהול
                          </label>
                        </div>
                      </div>
                      {calculatedDeposit > 0 && (
                        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-center justify-between">
                          <span className="text-sm text-green-700 font-semibold">סכום ערבות מחושב</span>
                          <span className="text-lg font-black text-green-800">{fmtMoney(calculatedDeposit)}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">סכום נדרש (₪)</label>
                    <input type="number" value={guaranteeAmt} onChange={(e) => setGuaranteeAmt(e.target.value)}
                      className={ic} readOnly={depositCalcMethod === "months_based"} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">סכום בפועל (₪)</label>
                    <input type="number" value={guaranteeActual} onChange={(e) => setGuaranteeActual(e.target.value)} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">בנק / מוציא</label>
                    <input type="text" value={guaranteeBank} onChange={(e) => setGuaranteeBank(e.target.value)} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">תוקף ערבות</label>
                    <input type="date" value={guaranteeEnd} onChange={(e) => setGuaranteeEnd(e.target.value)} className={ic} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 6 — Summary */}
        {step === 6 && (
          <div className="space-y-4">
            <h2 className="font-bold text-slate-800 text-lg mb-4">✅ סיכום שינויים</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { l: "סוג חוזה", v: CONTRACT_TYPES.find((c) => c.v === contractType)?.l },
                { l: "שוכר", v: tenant?.name },
                { l: "נכס", v: property?.name },
                { l: "שטחים", v: selSpaces.length > 0 ? `${selSpaces.length} שטחים` : "לא נבחרו" },
                { l: "תחילה", v: startDate },
                { l: "תקופה", v: `${leasePeriodValue} ${leasePeriodUnit === "months" ? "חודשים" : "שנים"}` },
                { l: "סיום (מחושב)", v: endDate ? new Date(endDate).toLocaleDateString("he-IL") : "" },
                { l: 'שכ"ד לחודש', v: fmtMoney(totalRent) },
                { l: "שנתי", v: fmtMoney(annualRent) },
                { l: "תדירות", v: PAYMENT_FREQS.find((p) => p.v === paymentFreq)?.l },
                { l: "הצמדה", v: INDEX_METHODS.find((m) => m.v === indexMethod)?.l },
                { l: 'מע"מ', v: vatType === "taxable" ? `${currentVatPct}%` : "פטור" },
                { l: "גרייס", v: hasGrace ? `${graceMonths} חודשים` : "לא" },
                { l: "עלייה מדורגת", v: hasIncrease ? (increaseMode === "per_unit" ? `לפי יחידה (${Object.keys(perUnitTiers).filter(k => perUnitTiers[k]?.length > 0).length} יחידות)` : priceTiers.length > 0 ? `${priceTiers.length} שלבים` : "לא") : "לא" },
                { l: "אופציות", v: extensionOptions.length > 0 ? `${extensionOptions.length} אופציות` : "לא" },
                { l: "ערבות", v: addGuarantee ? fmtMoney(Number(guaranteeAmt) || 0) : "לא" },
              ].map((r) =>
                r.v ? (
                  <div key={r.l} className="flex justify-between border-b border-slate-100 py-2">
                    <span className="text-slate-500">{r.l}</span>
                    <span className="font-semibold text-slate-800">{r.v}</span>
                  </div>
                ) : null
              )}
            </div>
            {/* Price Timeline — per-unit or unified */}
            {(() => {
              // Per-unit summary when no global rent_per_sqm
              if (!rentPerSqm && selSpaces.length > 0 && Object.keys(unitRentOverrides).length > 0) {
                return (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-bold text-slate-800 mb-3">📊 פירוט שכ&quot;ד לפי יחידה</div>
                    <div className="space-y-1.5">
                      {selSpaces.map(function(sid) {
                        var sp = spaces.find(function(s) { return s.id === sid; });
                        if (!sp) return null;
                        var rType = unitRentTypes[sid] || "per_sqm";
                        var rVal = Number(unitRentOverrides[sid]) || 0;
                        var monthly = rType === "fixed" ? rVal : rVal * (sp.area || 0);
                        return (
                          <div key={sid} className="rounded-lg border border-slate-100 bg-white px-3 py-2 flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-700">{sp.space_name}</span>
                              <span className="text-slate-500">{sp.area} מ&quot;ר</span>
                              <span className="text-slate-500">{rType === "fixed" ? fmtMoney(rVal)+"/חודש" : fmtMoney(rVal)+'/מ"ר'}</span>
                            </div>
                            <span className="font-bold text-green-700">{fmtMoney(monthly)}/חודש</span>
                          </div>
                        );
                      })}
                      <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-center">
                        <span className="text-base font-black text-green-800">{fmtMoney(baseRent)}/חודש</span>
                        <span className="text-sm text-green-600 mr-2">סה&quot;כ כל היחידות</span>
                      </div>
                    </div>
                  </div>
                );
              }
              // Unified price timeline
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
                  <div className="text-sm font-bold text-slate-800 mb-3">📊 ציר זמן מחירים</div>
                  <div className="space-y-1">
                    {timeline.map((entry, i) => {
                      const isOption = entry.source.startsWith("option");
                      return (
                        <div key={i} className={"rounded-lg border px-3 py-2 flex items-center justify-between text-xs " + (isOption ? "bg-blue-50 border-blue-200" : "bg-white border-slate-100")}>
                          <div className="flex items-center gap-2">
                            <span className={"font-bold " + (isOption ? "text-blue-800" : "text-slate-800")}>{entry.label}</span>
                            <span className="text-slate-400">
                              {entry.startDate && new Date(entry.startDate).toLocaleDateString("he-IL")} → {entry.endDate && new Date(entry.endDate).toLocaleDateString("he-IL")}
                            </span>
                          </div>
                          <span className={"font-black text-sm " + (isOption ? "text-blue-800" : "text-slate-800")}>
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
            <button onClick={() => setStep(step - 1)}
              className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
              ← חזור
            </button>
          )}
          <div className="flex-1" />
          {step < 6 ? (
            <button onClick={() => setStep(step + 1)}
              className="rounded-xl bg-blue-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-800">
              המשך →
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={saving}
              className="rounded-xl bg-green-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-green-800 disabled:opacity-50">
              {saving ? "שומר..." : "💾 שמור שינויים"}
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
