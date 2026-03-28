"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
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
  { v: "checks_advance", l: "שיקים מראש" },
  { v: "one_time", l: "חד פעמי" },
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
  { v: "check", l: "שיקים", icon: "📝" },
  { v: "cash", l: "מזומן", icon: "💵" },
  { v: "insurance", l: "ביטוח", icon: "🛡️" },
  { v: "personal", l: "אישית", icon: "👤" },
];
const INCREASE_TYPES = [
  { v: "pct", l: "אחוז (%)", icon: "📈" },
  { v: "fixed_sqm", l: '₪/מ"ר', icon: "📐" },
  { v: "fixed_total", l: "סכום קבוע (₪)", icon: "💰" },
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
  return "₪" + Math.round(n).toLocaleString("he-IL");
}

export default function ContractsNewPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [tenants, setTenants] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [spaces, setSpaces] = useState<any[]>([]);
  const [cpiRecords, setCpiRecords] = useState<any[]>([]);
  const [currentVatPct, setCurrentVatPct] = useState(18);
  const [unitRentOverrides, setUnitRentOverrides] = useState<Record<string, string>>({});

  // Step 1 — Tenant & Property
  const [tenantId, setTenantId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [selSpaces, setSelSpaces] = useState<string[]>([]);
  const [contractType, setContractType] = useState("regular");

  // Step 2 — Dates & Terms
  const [startDate, setStartDate] = useState("");
  const [leasePeriodValue, setLeasePeriodValue] = useState(12);
  const [leasePeriodUnit, setLeasePeriodUnit] = useState<"months" | "years">("months");
  const [endDate, setEndDate] = useState("");
  const [rentPerSqm, setRentPerSqm] = useState("");
  const [chargedArea, setChargedArea] = useState("");
  const [investAdd, setInvestAdd] = useState("");
  const [vatType, setVatType] = useState("taxable");
  const [paymentFreq, setPaymentFreq] = useState("monthly");
  const [paymentDay, setPaymentDay] = useState("1");
  const [indexMethod, setIndexMethod] = useState("standard");
  const [baseCPI, setBaseCPI] = useState("");
  const [baseCPIDate, setBaseCPIDate] = useState("");
  const [mgmtFeePct, setMgmtFeePct] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");

  // Step 3 — Grace & Increase
  const [hasGrace, setHasGrace] = useState(false);
  const [graceMonths, setGraceMonths] = useState("3");
  const [graceType, setGraceType] = useState("full");
  const [graceDiscountPct, setGraceDiscountPct] = useState("50");
  const [hasIncrease, setHasIncrease] = useState(false);
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);

  // CBS fetch state
  const [cbsFetching, setCbsFetching] = useState(false);

  // Step 4 — Extension Options
  const [extensionOptions, setExtensionOptions] = useState<ExtensionOption[]>([]);

  // Step 5 — Guarantees
  const [addGuarantee, setAddGuarantee] = useState(false);
  const [guaranteeType, setGuaranteeType] = useState("bank");
  const [guaranteeAmt, setGuaranteeAmt] = useState("");
  const [guaranteeActual, setGuaranteeActual] = useState("");
  const [guaranteeBank, setGuaranteeBank] = useState("");
  const [guaranteeEnd, setGuaranteeEnd] = useState("");
  const [depositCalcMethod, setDepositCalcMethod] = useState<"months_based" | "fixed_amount">("months_based");
  const [depositMonths, setDepositMonths] = useState(3);
  const [depositIncludesMgmt, setDepositIncludesMgmt] = useState(false);

  // === Auto-calculate end date from start + period ===
  useEffect(() => {
    if (startDate && leasePeriodValue > 0) {
      const calc = calculateEndDate(startDate, leasePeriodValue, leasePeriodUnit);
      if (calc) setEndDate(calc);
    }
  }, [startDate, leasePeriodValue, leasePeriodUnit]);

  // === Auto-populate CPI base index from start date (month before start) ===
  useEffect(() => {
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
  }, [startDate, cpiRecords.length, indexMethod]);

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

  const calculatedDeposit = calculateDepositAmount({
    depositMethod: depositCalcMethod,
    depositMonths,
    fixedAmount: Number(guaranteeAmt) || 0,
    monthlyRent: baseRent,
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

  async function loadRef() {
    const [{ data: t }, { data: p }, { data: cpi }, { data: vat }] = await Promise.all([
      supabase.from("tenants").select("id,name,company_name").order("name"),
      supabase.from("properties").select("id,name,city").order("name"),
      supabase.from("cpi_records").select("year,month,value").order("year", { ascending: false }).order("month", { ascending: false }),
      supabase.from("vat_rates").select("rate_pct,effective_from,effective_to").order("effective_from", { ascending: false }).limit(1),
    ]);
    setTenants(t ?? []);
    setProperties(p ?? []);
    setCpiRecords(cpi ?? []);
    if (vat && vat.length > 0) setCurrentVatPct(Number(vat[0].rate_pct));
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
    if (!tenantId || !propertyId || !startDate || !endDate || !rentPerSqm) {
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

      const insertPayload: any = {
        tenant_id: tenantId,
        property_id: propertyId,
        contract_type: contractType,
        start_date: startDate,
        end_date: endDate,
        lease_period_value: leasePeriodValue,
        lease_period_unit: leasePeriodUnit,
        rent_per_sqm: Number(rentPerSqm) || null,
        charged_area: Number(chargedArea) || null,
        investment_addition: Number(investAdd) || null,
        vat_type: vatType,
        payment_frequency: paymentFreq,
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
      }

      const { data: contract, error: ce } = await supabase
        .from("contracts")
        .insert(insertPayload)
        .select()
        .single();
      if (ce) throw new Error(ce.message);
      if (!contract?.id) throw new Error("שגיאה בשמירת חוזה");

      // Contract ↔ Spaces (with per-unit rent overrides)
      if (selSpaces.length > 0) {
        await supabase.from("contract_spaces").insert(
          selSpaces.map((sid) => ({
            contract_id: contract.id,
            space_id: sid,
            price_per_sqm: unitRentOverrides[sid] ? Number(unitRentOverrides[sid]) : Number(rentPerSqm) || null,
            charge_method: "per_sqm",
          }))
        );
        await supabase.from("spaces").update({ status: "occupied" }).in("id", selSpaces);
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
          new_rent_value: opt.new_rent_value,
          rent_increase_pct: opt.rent_increase_pct,
          auto_extend: opt.auto_renewal,
          status: "pending",
          notes: opt.notes || null,
          price_schedule_type: opt.price_schedule_type || "inherit",
          price_tiers: opt.price_schedule_type === "custom" ? opt.price_tiers : [],
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
                  price_per_sqm: tier.increase_type === "fixed_total" ? null : tier.calculated_rent_per_sqm,
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
      if (addGuarantee && guaranteeAmt) {
        await supabase.from("guarantees").insert({
          contract_id: contract.id,
          guarantee_type: guaranteeType,
          amount_required: Number(guaranteeAmt),
          amount_actual: guaranteeActual ? Number(guaranteeActual) : null,
          bank: guaranteeBank || null,
          end_date: guaranteeEnd || null,
          status: "active",
        });
      }

      // Price Tiers → contract_price_tiers
      if (hasIncrease && priceTiers.length > 0) {
        const tiersWithPreviews = calculateTierPreviews(priceTiers, Number(rentPerSqm) || 0);
        const contractStart = new Date(startDate);
        await supabase.from("contract_price_tiers").insert(
          tiersWithPreviews.map((tier, i) => {
            const tierStart = new Date(contractStart);
            tierStart.setFullYear(tierStart.getFullYear() + tier.from_year - 1);
            const tierEnd = new Date(contractStart);
            tierEnd.setFullYear(tierEnd.getFullYear() + tier.to_year);
            return {
              contract_id: contract.id,
              tier_number: i + 1,
              start_date: tierStart.toISOString().split("T")[0],
              end_date: tierEnd.toISOString().split("T")[0],
              increase_type: tier.increase_type,
              increase_value: tier.increase_value || 0,
              is_recurring: tier.is_recurring,
              recurring_every_years: tier.recurring_every_years,
              from_year: tier.from_year,
              to_year: tier.to_year,
              price_per_sqm: tier.increase_type === "fixed_total" ? null : tier.calculated_rent_per_sqm,
              fixed_amount: tier.increase_type === "fixed_total" ? tier.increase_value : null,
              calculated_rent_per_sqm: tier.calculated_rent_per_sqm,
              notes: tier.notes || null,
            };
          })
        );
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
        <h1 className="text-3xl font-bold text-slate-800">חוזה חדש</h1>
      </div>

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
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
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
              <select
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className={ic}
              >
                <option value="">-- בחר שוכר --</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.company_name ? " — " + t.company_name : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                נכס *
              </label>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className={ic}
              >
                <option value="">-- בחר נכס --</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.city ? " — " + p.city : ""}
                  </option>
                ))}
              </select>
            </div>

            {spaces.length > 0 && (
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">
                  שטחים משויכים לחוזה
                </label>
                <div className="grid grid-cols-3 gap-2">
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
                            : s.status === "occupied"
                              ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                              : "border-slate-200 hover:bg-slate-50")
                        }
                        disabled={s.status === "occupied" && !sel}
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

            {/* Date + Period → auto end date */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  תחילת חוזה *
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

            {/* Auto-calculated end date display */}
            {endDate && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-green-700 font-semibold">
                  תאריך סיום מחושב
                </span>
                <span className="text-lg font-black text-green-800">
                  {new Date(endDate).toLocaleDateString("he-IL")}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
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
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  תוספת השקעות (₪)
                </label>
                <input
                  type="number"
                  value={investAdd}
                  onChange={(e) => setInvestAdd(e.target.value)}
                  className={ic}
                />
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

            {/* Rent preview */}
            {baseRent > 0 && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
                <div className="text-xs font-bold text-blue-700 mb-2">
                  תצוגת שכ&quot;ד חודשי
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
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

            {/* Per-unit rent overrides — shown when multiple spaces selected */}
            {selSpaces.length > 1 && (
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-bold text-slate-700 mb-2">מחיר למ&quot;ר לפי יחידה (אופציונלי)</div>
                <div className="text-xs text-slate-400 mb-3">השאר ריק להשתמש במחיר ברירת מחדל ({rentPerSqm || "0"} ₪)</div>
                <div className="space-y-2">
                  {selSpaces.map((sid) => {
                    const sp = spaces.find((s) => s.id === sid);
                    if (!sp) return null;
                    return (
                      <div key={sid} className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-slate-600 w-32 truncate">{sp.space_name}</span>
                        <span className="text-xs text-slate-400">{sp.area} מ&quot;ר</span>
                        <input
                          type="number"
                          value={unitRentOverrides[sid] || ""}
                          onChange={(e) => setUnitRentOverrides((prev) => ({ ...prev, [sid]: e.target.value }))}
                          placeholder={rentPerSqm || "מחיר ברירת מחדל"}
                          className={ic + " flex-1 max-w-32"}
                        />
                        <span className="text-xs text-slate-400">₪/מ&quot;ר</span>
                      </div>
                    );
                  })}
                </div>
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
                      setCbsFetching(true);
                      try {
                        const d = new Date(baseCPIDate);
                        const year = d.getFullYear();
                        const month = d.getMonth() + 1;
                        const res = await fetch(`/api/cpi?year=${year}`);
                        const data = await res.json();
                        const records = data.records || [];
                        const rec = records.find((r: any) => r.year === year && r.month === month);
                        if (rec) {
                          setBaseCPI(rec.value.toString());
                          // Also refresh CPI records in state
                          const allRes = await fetch("/api/cpi");
                          const allData = await allRes.json();
                          if (allData.records) setCpiRecords(allData.records);
                        } else {
                          alert(`מדד לחודש ${month}/${year} לא פורסם עדיין בלמ"ס`);
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
                  <label htmlFor="increase" className="text-sm font-bold text-slate-700">עלייה מדורגת בשכ&quot;ד (Step-Rent)</label>
                </div>
                {hasIncrease && (
                  <button type="button" onClick={() => {
                    const last = priceTiers[priceTiers.length - 1];
                    setPriceTiers(prev => [...prev, emptyPriceTier(last ? last.to_year + 1 : 1)]);
                  }} className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-800">
                    + הוסף שלב
                  </button>
                )}
              </div>

              {hasIncrease && (() => {
                const contractYears = leasePeriodUnit === "years" ? leasePeriodValue : Math.ceil(leasePeriodValue / 12);
                const errors = validatePriceTiers(priceTiers, contractYears);
                const previews = calculateTierPreviews(priceTiers, Number(rentPerSqm) || 0);
                return (
                  <div className="space-y-3">
                    {/* Validation errors */}
                    {errors.length > 0 && (
                      <div className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-1">
                        {errors.map((err, i) => (
                          <div key={i} className="text-xs text-red-600 flex items-center gap-1">
                            <span>⚠️</span> {err}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Base period before first tier */}
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

                    {/* Tier rows */}
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

                          {/* Duration type: Range vs Recurring */}
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
                            {/* Duration fields */}
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

                            {/* Increase type */}
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

                          {/* Value input */}
                          {tier.increase_type !== "none" && (
                            <div className="max-w-xs">
                              <label className="mb-1 block text-xs text-slate-500">
                                {tier.increase_type === "pct" ? "שיעור עלייה (%)" :
                                 tier.increase_type === "fixed_sqm" ? 'תוספת למ"ר (₪)' :
                                 "סכום חודשי קבוע (₪)"}
                              </label>
                              <input type="number" step="0.1" value={tier.increase_value || ""}
                                onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, increase_value: Number(e.target.value) || 0 } : t))}
                                className={ic} />
                            </div>
                          )}

                          {/* Notes */}
                          <div>
                            <input type="text" value={tier.notes} placeholder="הערות (אופציונלי)"
                              onChange={(e) => setPriceTiers(prev => prev.map((t, i) => i === idx ? { ...t, notes: e.target.value } : t))}
                              className={ic + " text-xs"} />
                          </div>

                          {/* Preview */}
                          {preview?.calculated_rent_per_sqm && Number(rentPerSqm) > 0 && (
                            <div className={"rounded-lg px-3 py-2 text-xs font-semibold " + (hasError ? "bg-red-100 text-red-700" : "bg-green-50 border border-green-200 text-green-700")}>
                              {tier.increase_type === "none"
                                ? `שנים ${tier.from_year}-${tier.to_year}: מחיר קפוא — ${fmtMoney(Number(rentPerSqm))}/מ"ר`
                                : tier.increase_type === "fixed_total"
                                  ? `שנים ${tier.from_year}-${tier.to_year}: סכום קבוע ${fmtMoney(tier.increase_value)}/חודש`
                                  : `שנים ${tier.from_year}-${tier.to_year}: ${fmtMoney(preview.calculated_rent_per_sqm)}/מ"ר`
                                    + (tier.is_recurring ? ` (חוזר כל ${tier.recurring_every_years} שנים)` : "")}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Add step button */}
                    <button type="button" onClick={() => {
                      const last = priceTiers[priceTiers.length - 1];
                      setPriceTiers(prev => [...prev, emptyPriceTier(last ? last.to_year + 1 : 1)]);
                    }} className="rounded-lg border-2 border-dashed border-blue-300 px-4 py-3 text-xs font-bold text-blue-600 hover:bg-blue-50 w-full transition-all">
                      + הוסף שלב עלייה נוסף
                    </button>
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
              <button type="button" onClick={() => setExtensionOptions((prev) => [...prev, emptyOption()])}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800">+ הוסף אופציה</button>
            </div>

            {extensionOptions.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-400">
                <div className="text-4xl mb-2">📋</div>
                <div className="text-sm">אין אופציות — לחץ להוספה (אופציונלי)</div>
              </div>
            ) : (
              extensionOptions.map((opt, idx) => (
                <div key={idx} className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-700 text-sm">אופציה {idx + 1}</span>
                    <button type="button" onClick={() => removeOption(idx)} className="text-xs text-red-500 hover:text-red-700 font-semibold">🗑 הסר</button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">תקופה (שנים) *</label>
                      <input type="number" min="1" value={opt.duration_years}
                        onChange={(e) => { const y = Number(e.target.value) || 0; updateOption(idx, "duration_years", y); updateOption(idx, "duration_months", y * 12); }}
                        className={ic} />
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
                        <label className="mb-1 block text-xs font-semibold text-slate-700">מחיר חדש למ&quot;ר (₪)</label>
                        <input type="number" value={opt.new_rent_value ?? ""}
                          onChange={(e) => updateOption(idx, "new_rent_value", Number(e.target.value) || null)} className={ic} />
                      </div>
                    )}
                  </div>

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
                            let optBase = Number(rentPerSqm) || 0;
                            if (priceTiers.length > 0) {
                              const mainPrev = calculateTierPreviews(priceTiers, optBase);
                              optBase = mainPrev[mainPrev.length - 1]?.calculated_rent_per_sqm ?? optBase;
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
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {GUARANTEE_TYPES.map((t) => (
                    <button
                      key={t.v}
                      type="button"
                      onClick={() => setGuaranteeType(t.v)}
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
              ✅ סיכום החוזה
            </h2>
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
                { l: 'שכ"ד לחודש', v: fmtMoney(totalRent) },
                { l: "שנתי", v: fmtMoney(annualRent) },
                {
                  l: "תדירות",
                  v: PAYMENT_FREQS.find((p) => p.v === paymentFreq)?.l,
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
                  v: hasIncrease && priceTiers.length > 0
                    ? `${priceTiers.length} שלבים`
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
                  l: "ערבות",
                  v: addGuarantee
                    ? fmtMoney(Number(guaranteeAmt) || 0)
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
                (step === 2 && (!startDate || !rentPerSqm))
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
              {saving ? "שומר..." : "✅ צור חוזה"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
