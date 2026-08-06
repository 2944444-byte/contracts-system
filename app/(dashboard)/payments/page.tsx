"use client";
import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { chargeBalance, waivedTotalFor, describeConcession, concessionValue, canGrantConcessions, REASON_LABELS, type ConcessionReason } from "@/lib/concessions";
import { getVatRates, vatPctAt, getVatPctForDate, type VatRate } from "@/lib/vat";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows, getCurrentAccess } from '@/lib/permissions';
import { reconcileAlerts } from '@/lib/alerts-reconcile';
import { graceFactorsFor } from '@/lib/store-opening';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

// All charge types known to the system. The first 6 are user-creatable;
// "insurance", "cpi_diff", "waste" are emitted by the billing tabs and
// CpiDiffTab, so they need to render with proper labels in this view.
const CHARGE_TYPES = [
  { v: "rent",        l: 'שכ"ד',              icon: "🏢" },
  { v: "management",  l: "דמי ניהול",         icon: "🔧" },
  { v: "parking",     l: "חניה",              icon: "🅿️" },
  { v: "water",       l: "מים",               icon: "💧" },
  { v: "electricity", l: "חשמל",              icon: "⚡" },
  { v: "insurance",   l: "ביטוח מבנה",        icon: "🏛" },
  { v: "cpi_diff",    l: "הפרשי הצמדה",       icon: "📊" },
  { v: "waste",       l: "פינוי אשפה",        icon: "🗑" },
  { v: "option_penalty", l: "פיצוי אי מימוש אופציה", icon: "⚖️" },
  { v: "late_opening_penalty", l: "קנס אי-פתיחת המושכר", icon: "⏰" },
  { v: "investment_clawback", l: "החזר השקעות ביציאה מוקדמת", icon: "↩️" },
  { v: "revenue_settlement", l: "התחשבנות פדיון", icon: "⚖️" },
  { v: "other",       l: "אחר",               icon: "📋" },
];

const HEB_MONTHS = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function fmtMoney(n: number) { return "₪" + (n ?? 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function typeInfo(v: string) { return CHARGE_TYPES.find(function(t) { return t.v === v; }) ?? CHARGE_TYPES[CHARGE_TYPES.length - 1]; }

// Custom dropdown — native <select> in RTL Chrome positions its panel
// off the left edge of the viewport. This component renders the panel
// inside the document flow (absolute below the trigger), so it can never
// overflow the page. Anchored to the right edge of the trigger so it
// reads naturally in RTL.
function Dropdown(props: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(function() {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return function() { document.removeEventListener("mousedown", onClick); };
  }, [open]);
  var current = props.options.find(function(o) { return o.value === props.value; });
  var btnClass = props.buttonClassName ||
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm bg-white hover:bg-slate-50";
  return (
    <div ref={ref} className={"relative " + (props.className || "")}>
      <button
        type="button"
        onClick={function() { setOpen(!open); }}
        className={btnClass + " flex items-center justify-between gap-2"}
      >
        <span className="text-slate-400 text-xs">{open ? "▲" : "▼"}</span>
        <span className="flex-1 text-right truncate">{current ? current.label : (props.placeholder || "")}</span>
      </button>
      {open && (
        <div
          className="absolute z-50 bg-white border border-slate-200 rounded-lg shadow-xl max-h-72 overflow-y-auto"
          style={{
            top: "calc(100% + 4px)",
            right: 0,
            // Width = widest item, clamped between min/max. Critically NOT
            // "minWidth: 100%" — that was inheriting from a flex parent and
            // blowing the panel up to most of the viewport.
            width: "max-content",
            minWidth: "140px",
            maxWidth: "260px",
          }}
        >
          {props.options.map(function(o) {
            var isSel = o.value === props.value;
            return (
              <button
                key={o.value || "__empty"}
                type="button"
                onClick={function() { props.onChange(o.value); setOpen(false); }}
                className={"block w-full text-right px-3 py-2 text-sm whitespace-nowrap overflow-hidden text-ellipsis " + (isSel ? "bg-blue-50 text-blue-700 font-semibold" : "text-slate-700 hover:bg-slate-50")}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Unified row shape. Five sources:
//   "charge"                  — single row from the `charges` table
//   "rent_check"              — virtual row aggregating advance_payments by check
//   "revenue"                 — virtual row from revenue_reports
//   "missing_revenue_report"  — virtual row for revenue tenants who haven't
//                               submitted their monthly report yet; appears as
//                               "ממתין לדיווח", becomes overdue past the
//                               contract's revenue_report_day. Lets the user
//                               chase missing reports the same way they chase
//                               unpaid debts.
type Row = {
  id: string;
  source: "charge" | "rent_check" | "revenue" | "missing_revenue_report";
  reportMonth?: string;          // YYYY-MM, on missing-report rows only
  contractId: string;
  tenantName: string;
  propertyName: string;
  chargeType: string;
  description: string;
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  vatType: string;
  dueDate: string | null;
  status: "pending" | "approved" | "paid";
  createdAt: string;
  // Concessions granted on this row, and the balance they leave.
  concessions?: any[];
  waived?: number;
  balance?: number;
  underlyingAdvanceIds?: string[];
  unitsBreakdown?: Array<{ name: string; amount: number; period: string }>;
  period?: string;
  // revenue row reference
  revenueReportId?: string;
};

export default function PaymentsPage() {
  const router = useRouter();
  const currentYear = new Date().getFullYear();
  const [rows,      setRows]      = useState<Row[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  // Non-empty when a fetch failed — shown on screen so a broken query is never
  // mistaken for "no data".
  const [loadError, setLoadError] = useState("");
  // ויתורים והסדרים
  const [mayGrant, setMayGrant] = useState(false);
  const [concFor, setConcFor] = useState<any>(null);
  const [cMethod, setCMethod] = useState<"full"|"percent"|"amount">("full");
  const [cPercent, setCPercent] = useState("50");
  const [cAmount, setCAmount] = useState("");
  const [cReason, setCReason] = useState<ConcessionReason>("goodwill");
  const [cNotes, setCNotes] = useState("");
  const [cInstallments, setCInstallments] = useState("");
  const [cSaving, setCSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [saving,    setSaving]    = useState(false);
  // Full VAT-rate history — each charge uses the rate in effect for ITS period
  // (revenue row → its month; manual charge → its billing-period start).
  const [vatRates,  setVatRates]  = useState<VatRate[]>([]);

  // Filters. Default to "all" so the user sees full history (paid + unpaid)
  // out of the box — they can still click any KPI card to drill in.
  const [filterStatus,   setFilterStatus]   = useState<"all" | "pending" | "approved" | "paid" | "overdue">("all");
  const [filterYear,     setFilterYear]     = useState<number>(currentYear);
  const [filterType,     setFilterType]     = useState<string>("");
  const [filterProperty, setFilterProperty] = useState<string>("");
  const [filterSearch,   setFilterSearch]   = useState<string>("");
  const [includeAdvances, setIncludeAdvances] = useState<boolean>(true);
  // Collapsed month sections
  const [collapsedMonths, setCollapsedMonths] = useState<Record<string, boolean>>({});
  // On entering the screen, jump to the CURRENT month (the user works on "now";
  // older months are above, scroll up to reach them). Only on the first load of
  // a year — re-filtering / marking paid must not yank the scroll back.
  const currentMonthRef = useRef<HTMLDivElement | null>(null);
  const didScrollRef = useRef(false);
  const nowDate = new Date();
  const currentMonthKey = nowDate.getFullYear() + "-" + String(nowDate.getMonth() + 1).padStart(2, "0");
  useEffect(function(){ didScrollRef.current = false; }, [filterYear]);
  useEffect(function() {
    if (loading || didScrollRef.current) return;
    if (filterYear !== nowDate.getFullYear()) { didScrollRef.current = true; return; }
    if (currentMonthRef.current) {
      currentMonthRef.current.scrollIntoView({ behavior: "auto", block: "start" });
    }
    didScrollRef.current = true;
  }, [loading, filterYear]);
  // Selection for bulk operations (e.g., one tenant pays one check that covers
  // their rent + CPI diff + insurance — select all three and mark paid together)
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // Expanded rent_check rows showing unit breakdown
  const [expandedChecks, setExpandedChecks] = useState<Record<string, boolean>>({});

  // New-charge form state
  const [fContractId,  setFContractId]  = useState("");
  const [fType,        setFType]        = useState("rent");
  const [fBaseAmount,  setFBaseAmount]  = useState("");
  const [fVatType,     setFVatType]     = useState("taxable");
  const [fPeriodFrom,  setFPeriodFrom]  = useState("");
  const [fPeriodTo,    setFPeriodTo]    = useState("");
  const [fDueDate,     setFDueDate]     = useState("");
  const [fNotes,       setFNotes]       = useState("");
  // VAT rate previewed in the new-charge form — for the entered billing period.
  const formVatPct = vatPctAt(vatRates, fPeriodFrom || new Date());

  useEffect(function() { loadAll(); }, [filterYear, includeAdvances]);

  async function loadAll() {
    setLoading(true);
    var rates = await getVatRates();
    setVatRates(rates);
    var yearStart = filterYear + "-01-01";
    var yearEnd   = (filterYear + 1) + "-01-01";

    const [chargesRes, concRes, contractsRes, advRes, revRes] = await Promise.all([
      // Load all charges with a due_date in the selected year. Falls back to
      // billing_period_start when due_date is null (older data).
      supabase.from("charges")
        // The embed names its foreign key explicitly. Without it, ANY second
        // relationship between charges and contracts makes PostgREST refuse to
        // resolve the embed and the query returns nothing — which silently
        // emptied this screen of every charge row once such a key existed.
        .select("*, contracts!charges_contract_id_fkey(property_id,tenants(name),properties(name),vat_type)")
        .or("due_date.gte." + yearStart + ",billing_period_start.gte." + yearStart)
        .or("due_date.lt." + yearEnd + ",billing_period_start.lt." + yearEnd)
        .order("due_date", { ascending: true }),
      // Concessions are read separately and matched in memory: a charge can
      // carry several, and the balance every row shows is derived from them.
      supabase.from("concessions").select("*").eq("status", "active"),
      supabase.from("contracts").select("id,property_id,vat_type,rent_type,revenue_pct,revenue_report_day,revenue_minimum_advance,minimum_rent,payment_method,start_date,end_date,rent_per_sqm,charged_area,investment_addition,is_amendment,grace_months,grace_days,grace_type,grace_discount_pct,grace_mgmt_discount_pct,grace_ends_on_opening,mgmt_charge_starts,mgmt_free_max_days,works_start_date,planned_handover_date,actual_handover_date,planned_opening_date,actual_opening_date,tenants(name),properties(name)").in("status", ["active", "expiring", "extended"]),
      // Rent advances for the year (both paid + unpaid — paid ones still need
      // to show on this screen so שולמו KPI is honest)
      includeAdvances ? supabase.from("advance_payments")
        .select("id, contract_id, period, space_name, tenant_name, check_date, total_with_vat, total_before_vat, vat_amount, actual_paid, waived")
        .gte("check_date", yearStart)
        .lt("check_date", yearEnd)
        .order("check_date", { ascending: true })
        : Promise.resolve({ data: [] }),
      // Revenue (פידיון) reports for the year — these are the monthly rent
      // amounts for revenue-pct tenants who don't have advance_payments.
      // Without this, those tenants are invisible on the payments screen.
      supabase.from("revenue_reports")
        .select("id, contract_id, report_month, gross_revenue, final_rent, actual_paid, contracts(tenants(name), properties(name), vat_type)")
        .gte("report_month", yearStart)
        .lt("report_month", yearEnd)
        .order("report_month", { ascending: true }),
    ]);

    // Data-level scoping: every row resolves to a contract → property; rows
    // outside the user's allowed properties are dropped (admin scope = null).
    var scope = await getScopeIds();
    var scopedContracts = scopeRows(contractsRes.data || [], scope, function(c: any){ return c.property_id; });
    var scopedContractIds: Record<string, boolean> = {};
    scopedContracts.forEach(function(c: any){ scopedContractIds[c.id] = true; });
    var inScope = function(contractId: any){ return scope === null || (contractId != null && !!scopedContractIds[contractId]); };

    // A failed query used to fall through as an empty array, so a broken fetch
    // looked exactly like "there are no charges" — that is what turned a schema
    // mistake into money apparently vanishing. Surface it instead.
    // advRes may be the plain { data: [] } stand-in when advances are toggled
    // off, so it has no `error` field to read.
    var advErr = (advRes as any).error;
    if (chargesRes.error) setLoadError("שליפת החיובים נכשלה: " + chargesRes.error.message);
    else if (advErr) setLoadError("שליפת המקדמות נכשלה: " + advErr.message);
    else if (revRes.error) setLoadError("שליפת דיווחי הפדיון נכשלה: " + revRes.error.message);
    else setLoadError("");

    var ch = scopeRows(chargesRes.data || [], scope, function(c: any){ return c.contracts?.property_id; });
    var concByCharge: Record<string, any[]> = {};
    var concByAdvance: Record<string, any[]> = {};
    ((concRes as any).data || []).forEach(function(x: any) {
      if (x.charge_id) (concByCharge[x.charge_id] = concByCharge[x.charge_id] || []).push(x);
      if (x.advance_id) (concByAdvance[x.advance_id] = concByAdvance[x.advance_id] || []).push(x);
    });
    // Keep BOTH paid and unpaid advances — paid ones still need to appear
    // on this screen so the שולמו KPI reflects collected rent. Only waived
    // advances are dropped entirely (they're explicitly cancelled).
    var adv = (advRes.data || []).filter(function(a: any) { return !a.waived && inScope(a.contract_id); });

    // Property lookup for advance rows (advance_payments doesn't join properties cleanly)
    var contractMap: Record<string, any> = {};
    scopedContracts.forEach(function(c: any) { contractMap[c.id] = c; });

    var allRows: Row[] = [];

    ch.forEach(function(c: any) {
      var tenant = (c.contracts?.tenants as any)?.name || "—";
      var property = (c.contracts?.properties as any)?.name || "";
      var t = typeInfo(c.charge_type);
      var description = c.notes || t.l;
      allRows.push({
        id: c.id,
        source: "charge",
        contractId: c.contract_id,
        tenantName: tenant,
        propertyName: property,
        chargeType: c.charge_type || "other",
        description: description,
        baseAmount: Number(c.base_amount) || 0,
        vatAmount: Number(c.vat_amount) || 0,
        totalAmount: Number(c.total_amount) || 0,
        // What is actually still owed once concessions are taken off.
        concessions: concByCharge[c.id] || [],
        waived: waivedTotalFor(concByCharge[c.id]),
        balance: chargeBalance(c, concByCharge[c.id]),
        vatType: c.vat_type || "",
        dueDate: c.due_date,
        status: c.status || "pending",
        createdAt: c.created_at,
      });
    });

    // Group advance_payments by (contract_id, check_date) — one check from the
    // tenant typically covers all the units they hold in that period. We render
    // a single row per check and let the user mark the whole check paid in one
    // click (which updates every underlying advance_payments row).
    var checksMap: Record<string, {
      contractId: string;
      tenantName: string;
      checkDate: string;
      period: string;
      rows: any[];
    }> = {};
    adv.forEach(function(a: any) {
      var key = a.contract_id + "|" + (a.check_date || "no-date");
      if (!checksMap[key]) checksMap[key] = {
        contractId: a.contract_id,
        tenantName: a.tenant_name || (contractMap[a.contract_id]?.tenants as any)?.name || "—",
        checkDate: a.check_date,
        period: a.period || "",
        rows: [],
      };
      checksMap[key].rows.push(a);
    });
    // Build a lookup of reported months per contract so we can detect gaps.
    var reportedMonths: Record<string, Record<string, boolean>> = {};
    var revenueRows = (revRes.data || []).filter(function(r: any){ return inScope(r.contract_id); });
    revenueRows.forEach(function(rev: any) {
      var monthKey = rev.report_month ? rev.report_month.slice(0, 7) : ""; // YYYY-MM
      if (!reportedMonths[rev.contract_id]) reportedMonths[rev.contract_id] = {};
      reportedMonths[rev.contract_id][monthKey] = true;
    });

    // Missing revenue reports → virtual rows.
    // For each active revenue-pct contract (base only), iterate every month
    // from contract.start_date up to the current month (capped by contract
    // end_date and the selected year). For any month that has no
    // revenue_report yet, generate a "ממתין לדיווח" row so the user can
    // chase the tenant for the report.
    var todayDate = new Date();
    var monthKeyForDate = function(d: Date) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    };
    scopedContracts.forEach(function(c: any) {
      if (c.is_amendment) return;
      var isRev = c.rent_type === "revenue_pct" || c.rent_type === "revenue_based" || Number(c.revenue_pct) > 0;
      if (!isRev) return;
      var reportDay = Number(c.revenue_report_day) || 10;
      // A month with no rent due has no turnover to report: the shop is still
      // being fitted out and has not traded. Chasing a report for it is asking
      // the tenant to declare nothing. The rent factor decides — a month that
      // is only partly free, or discounted rather than free, still trades and
      // still reports.
      var monthNeedsReport = function(mStart: Date, mEnd: Date) {
        return graceFactorsFor({ contract: c, periodStart: mStart, periodEnd: mEnd }).rentFactor > 0;
      };
      var startMonth = c.start_date ? new Date(c.start_date) : new Date(filterYear, 0, 1);
      var endMonth = c.end_date ? new Date(c.end_date) : todayDate;
      // Cap end to current month (a future month's report isn't "missing" yet)
      var iterEnd = todayDate < endMonth ? todayDate : endMonth;
      // Walk months
      var cursor = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1);
      var stop = new Date(iterEnd.getFullYear(), iterEnd.getMonth(), 1);
      while (cursor.getTime() <= stop.getTime()) {
        var monthYear = cursor.getFullYear();
        if (monthYear === filterYear) {
          var mk = monthKeyForDate(cursor);
          var hasReport = reportedMonths[c.id] && reportedMonths[c.id][mk];
          var needsReport = monthNeedsReport(
            new Date(cursor.getFullYear(), cursor.getMonth(), 1),
            new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
          if (!hasReport && needsReport) {
            var monthLabel = HEB_MONTHS[cursor.getMonth() + 1] + " " + monthYear;
            // Report for month M is due by day=reportDay of month M+1
            var nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
            var daysInNextMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
            var safeDay = Math.min(reportDay, daysInNextMonth);
            var due = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), safeDay);
            allRows.push({
              id: "missrep-" + c.id + "-" + mk,
              source: "missing_revenue_report",
              contractId: c.id,
              tenantName: (c.tenants as any)?.name || "—",
              propertyName: (c.properties as any)?.name || "",
              chargeType: "rent",
              description: "ממתין לדיווח מחזור — " + monthLabel + " (סופי לדיווח: " + safeDay + "/" + (nextMonth.getMonth()+1) + ")",
              baseAmount: 0,
              vatAmount: 0,
              totalAmount: 0,
              vatType: "",
              dueDate: due.toISOString().slice(0, 10),
              status: "pending",
              createdAt: cursor.toISOString().slice(0, 10),
              period: monthLabel,
              // The month in YYYY-MM, so the row can hand the revenue screen
              // exactly which report is missing without re-parsing a label.
              reportMonth: mk,
            });
          }
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }
    });

    // A turnover tenant normally pays the MINIMUM monthly (rent advances) and
    // only the top-up to the turnover share is settled afterwards. Billing the
    // report's full final rent alongside those advances would show the minimum
    // twice, so work out what each month already carried.
    var minBilledByMonth: Record<string, number> = {};
    // Separately: what actually came in. A cheque that was never presented or a
    // transfer that never arrived is still BILLED, so it keeps reducing the
    // top-up (otherwise the same shortfall shows up in two rows) — but the user
    // has to be able to see that the minimum was not in fact collected.
    var minCollectedByMonth: Record<string, number> = {};
    adv.forEach(function(a: any) {
      if (!a.check_date) return;
      var k = a.contract_id + "|" + String(a.check_date).slice(0, 7);
      minBilledByMonth[k] = (minBilledByMonth[k] || 0) + (Number(a.total_before_vat) || 0);
      // Collected = an amount actually recorded against the advance. Falls back
      // to the recorded actual amount; clearing_status is unused in the data.
      var got = Number(a.actual_paid) || Number(a.actual_amount) || 0;
      if (got > 0) {
        var vatShare = Number(a.total_with_vat) > 0 ? (Number(a.total_before_vat) || 0) / Number(a.total_with_vat) : 1;
        minCollectedByMonth[k] = (minCollectedByMonth[k] || 0) + got * vatShare;
      }
    });

    // Revenue (פידיון) reports → virtual rows
    revenueRows.forEach(function(rev: any) {
      var fullRent = Number(rev.final_rent) || 0;
      if (fullRent < 0.01) return;
      // Net off whatever the month's advances already billed. With no advances
      // this is the whole rent, exactly as before.
      var revContract: any = rev.contracts || contractMap[rev.contract_id];
      var paysMinAdvance = !!revContract?.revenue_minimum_advance;
      var alreadyBilled = minBilledByMonth[rev.contract_id + "|" + String(rev.report_month).slice(0, 7)] || 0;
      // The arrangement comes from the contract, not from whether advance rows
      // happen to exist yet: a month whose advances have not been generated
      // must still show the top-up, or the minimum gets collected twice.
      var expectedMin = paysMinAdvance ? (Number(revContract?.minimum_rent) || 0) : 0;
      var creditedMin = paysMinAdvance ? Math.max(alreadyBilled, expectedMin) : alreadyBilled;
      var isTopUp = creditedMin > 0.01;
      var advanceMissing = paysMinAdvance && alreadyBilled < 0.01 && expectedMin > 0.01;
      var collectedMin = minCollectedByMonth[rev.contract_id + "|" + String(rev.report_month).slice(0, 7)] || 0;
      // Billed but not collected — the minimum is owed on its own row, so say so
      // rather than letting the top-up imply the month was settled.
      var advanceUncollected = paysMinAdvance && alreadyBilled > 0.01 && collectedMin < alreadyBilled - 0.01;
      var byCheque = (revContract?.payment_method || "") === "checks_advance";
      var finalRent = isTopUp ? Math.round(Math.max(0, fullRent - creditedMin) * 100) / 100 : fullRent;
      // Minimum already covered the month — nothing further to collect.
      if (finalRent < 0.01) return;
      var contract = rev.contracts || contractMap[rev.contract_id];
      var tenant = (contract?.tenants as any)?.name || "—";
      var property = (contract?.properties as any)?.name || "";
      var vatType = (contract?.vat_type) || "exempt";
      var vat = vatType === "taxable" ? finalRent * vatPctAt(rates, rev.report_month) : 0;
      var monthDate = new Date(rev.report_month);
      var monthLabel = HEB_MONTHS[monthDate.getMonth() + 1] + " " + monthDate.getFullYear();
      var paid = Number(rev.actual_paid) || 0;
      allRows.push({
        id: "rev-" + rev.id,
        source: "revenue",
        contractId: rev.contract_id,
        tenantName: tenant,
        propertyName: property,
        chargeType: "rent",
        description: (isTopUp ? "השלמה לפדיון — " : "שכ\"ד פידיון — ") + monthLabel
          + " (מחזור " + fmtMoney(Number(rev.gross_revenue) || 0)
          + (isTopUp ? " · מינימום שחויב " + fmtMoney(creditedMin) : "")
          + (advanceMissing ? " · ⚠ טרם הופקה מקדמת מינימום לחודש זה" : "")
          + (advanceUncollected ? " · ⚠ " + (byCheque ? "השיק של המינימום טרם נפרע" : "העברת המינימום טרם נרשמה")
              + " (" + fmtMoney(collectedMin) + " מתוך " + fmtMoney(alreadyBilled) + ")" : "") + ")",
        baseAmount: finalRent,
        vatAmount: vat,
        totalAmount: finalRent + vat,
        vatType: vatType,
        // Due 30 days after the report month end
        dueDate: (function() {
          var d = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 30);
          return d.toISOString().slice(0, 10);
        })(),
        status: paid >= finalRent * 0.99 ? "paid" : "pending",
        createdAt: rev.report_month,
        revenueReportId: rev.id,
      });
    });

    Object.keys(checksMap).forEach(function(key) {
      var ck = checksMap[key];
      var c = contractMap[ck.contractId];
      var property = (c?.properties as any)?.name || "";
      var totalBefore = ck.rows.reduce(function(s, r) { return s + (Number(r.total_before_vat) || 0); }, 0);
      var totalVat    = ck.rows.reduce(function(s, r) { return s + (Number(r.vat_amount) || 0); }, 0);
      var totalWith   = ck.rows.reduce(function(s, r) { return s + (Number(r.total_with_vat) || 0); }, 0);
      var unitNames = Array.from(new Set(ck.rows.map(function(r) { return r.space_name; }).filter(Boolean)));
      var unitsLabel = unitNames.length > 0
        ? (unitNames.length <= 2 ? unitNames.join(", ") : unitNames.slice(0, 2).join(", ") + " +" + (unitNames.length - 2))
        : "—";
      // Check status: paid only when every underlying advance row was marked
      // paid (actual_paid > 0). A partially-paid check stays "לתשלום" because
      // we still owe collecting the rest.
      var allPaid = ck.rows.every(function(r) { return (Number(r.actual_paid) || 0) > 0; });
      allRows.push({
        id: "check-" + key,
        source: "rent_check",
        contractId: ck.contractId,
        tenantName: ck.tenantName,
        propertyName: property,
        chargeType: "rent",
        description: "שיק שכ\"ד — " + (ck.period || "—") + " · " + unitsLabel,
        baseAmount: totalBefore,
        vatAmount: totalVat,
        totalAmount: totalWith,
        vatType: "taxable",
        dueDate: ck.checkDate,
        status: allPaid ? "paid" : "pending",
        createdAt: ck.checkDate,
        // Concessions on the cheque's advance rows, netted the same way a
        // charge is — including the legacy `waived` flag, which is treated as a
        // full waiver so nothing recorded before this feature is lost.
        concessions: ck.rows.reduce(function(acc: any[], r: any) {
          var own = concByAdvance[r.id] || [];
          if (own.length === 0 && r.waived) {
            own = [{ status: "active", total_amount: Number(r.total_with_vat) || 0, method: "full", reason_code: "other", reason_notes: "ויתור שנרשם לפני מנגנון הוויתורים" }];
          }
          return acc.concat(own);
        }, []),
        waived: waivedTotalFor(ck.rows.reduce(function(acc: any[], r: any) {
          var own = concByAdvance[r.id] || [];
          if (own.length === 0 && r.waived) own = [{ status: "active", total_amount: Number(r.total_with_vat) || 0 }];
          return acc.concat(own);
        }, [])),
        balance: Math.max(0, Math.round((totalWith - waivedTotalFor(ck.rows.reduce(function(acc: any[], r: any) {
          var own = concByAdvance[r.id] || [];
          if (own.length === 0 && r.waived) own = [{ status: "active", total_amount: Number(r.total_with_vat) || 0 }];
          return acc.concat(own);
        }, []))) * 100) / 100),
        underlyingAdvanceIds: ck.rows.map(function(r) { return r.id; }),
        unitsBreakdown: ck.rows.map(function(r) {
          return { name: r.space_name || "—", amount: Number(r.total_with_vat) || 0, period: r.period || "" };
        }),
        period: ck.period,
      });
    });

    setRows(allRows);
    setContracts(scopedContracts);
    setLoading(false);
  }

  function openNew() {
    setEditingId("new");
    setFContractId("");
    setFType("rent");
    setFBaseAmount("");
    setFVatType("taxable");
    var today = new Date();
    var due = new Date(); due.setDate(due.getDate() + 30);
    setFPeriodFrom(today.toISOString().slice(0, 10));
    setFPeriodTo(today.toISOString().slice(0, 10));
    setFDueDate(due.toISOString().slice(0, 10));
    setFNotes("");
  }

  function fillFromContract(id: string) {
    const c = contracts.find(function(x) { return x.id === id; });
    if (!c) return;
    setFBaseAmount(Math.round((c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0)).toString());
    setFVatType(c.vat_type ?? "taxable");
  }

  async function handleSave() {
    if (!fContractId || !fBaseAmount) { alert("חובה: חוזה + סכום"); return; }
    setSaving(true);
    try {
      const base = Number(fBaseAmount);
      // Rate for the period this charge covers (its billing-period start), so a
      // back-dated charge gets the rate that applied then — not today's.
      const vatRate = await getVatPctForDate(fPeriodFrom || new Date());
      const vat = fVatType === "taxable" ? base * vatRate : 0;
      const { data, error: _ie } = await supabase.from("charges").insert({
        contract_id: fContractId, charge_type: fType,
        base_amount: base, vat_amount: vat, total_amount: base + vat,
        vat_type: fVatType, billing_period_start: fPeriodFrom || null,
        billing_period_end: fPeriodTo || null, due_date: fDueDate || null,
        status: "pending", notes: fNotes || null,
      }).select().single();
      if (_ie) throw new Error(_ie.message);
      if (!data?.id) throw new Error("שגיאה בשמירה");
      await logAudit({ entity_type: "charge", entity_id: data.id, action: "create" });
      setEditingId(""); await loadAll();
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function approve(id: string) {
    await supabase.from("charges").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", id);
    await logAudit({ entity_type: "charge", entity_id: id, action: "approve" });
    await loadAll();
  }
  useEffect(function () {
    getCurrentAccess().then(function (a) { setMayGrant(canGrantConcessions(a)); }).catch(function () {});
  }, []);

  function openConcession(r: any) {
    setConcFor(r);
    setCMethod("full"); setCPercent("50"); setCAmount("");
    setCReason("goodwill"); setCNotes(""); setCInstallments("");
  }

  async function saveConcession() {
    if (!concFor) return;
    if (!cNotes.trim()) { alert("נא להזין נימוק — הוא נשמר בתיק ומופיע בדוח הוויתורים."); return; }
    setCSaving(true);
    try {
      var v = concessionValue({
        method: cMethod,
        percent: Number(cPercent) || 0,
        amount: Number(cAmount) || 0,
        itemBase: Number(concFor.baseAmount) || 0,
        itemVat: Number(concFor.vatAmount) || 0,
      });
      if (concFor.source === "rent_check") {
        await saveAdvanceConcession(concFor);
        await logAudit({ entity_type: "contract", entity_id: concFor.contractId, action: "concession_advance" });
        setConcFor(null);
        await loadAll();
        return;
      }
      if (v.total <= 0) throw new Error("סכום הוויתור אינו יכול להיות אפס");
      var { data: au } = await supabase.auth.getUser();
      var { error } = await supabase.from("concessions").insert({
        scope: "charge",
        charge_id: concFor.id,
        contract_id: concFor.contractId,
        method: cMethod,
        percent: cMethod === "percent" ? Number(cPercent) || 0 : null,
        base_amount: v.base, vat_amount: v.vat, total_amount: v.total,
        reason_code: cReason,
        reason_notes: cNotes.trim(),
        installments: Number(cInstallments) > 1 ? Number(cInstallments) : null,
        granted_by: au?.user?.id ?? null,
      });
      if (error) throw new Error(error.message);
      await logAudit({ entity_type: "charge", entity_id: concFor.id, action: "concession" });
      setConcFor(null);
      await loadAll();
    } catch (e: any) { alert("שגיאה: " + e?.message); }
    finally { setCSaving(false); }
  }

  // A rent cheque row aggregates several advance rows. A concession on it is
  // recorded per advance, so the report and the balance stay accurate per unit.
  async function saveAdvanceConcession(r: any) {
    var ids: string[] = r.underlyingAdvanceIds || [];
    if (ids.length === 0) throw new Error("לא נמצאו שורות מקדמה לוויתור");
    var { data: advs, error: aErr } = await supabase.from("advance_payments")
      .select("id, total_before_vat, vat_amount, total_with_vat").in("id", ids);
    if (aErr) throw new Error(aErr.message);
    var { data: au } = await supabase.auth.getUser();
    var rows: any[] = [];
    (advs || []).forEach(function(a: any) {
      var v = concessionValue({
        method: cMethod,
        percent: Number(cPercent) || 0,
        // A fixed sum is split across the cheque's units in proportion.
        amount: (Number(cAmount) || 0) * ((Number(a.total_before_vat) || 0) / Math.max(1, Number(r.baseAmount) || 1)),
        itemBase: Number(a.total_before_vat) || 0,
        itemVat: Number(a.vat_amount) || 0,
      });
      if (v.total <= 0) return;
      rows.push({
        scope: "advance", advance_id: a.id, contract_id: r.contractId,
        method: cMethod, percent: cMethod === "percent" ? Number(cPercent) || 0 : null,
        base_amount: v.base, vat_amount: v.vat, total_amount: v.total,
        reason_code: cReason, reason_notes: cNotes.trim(),
        installments: Number(cInstallments) > 1 ? Number(cInstallments) : null,
        granted_by: au?.user?.id ?? null,
      });
    });
    if (rows.length === 0) throw new Error("סכום הוויתור אינו יכול להיות אפס");
    var { error } = await supabase.from("concessions").insert(rows);
    if (error) throw new Error(error.message);
  }

  async function markPaid(id: string) {
    await supabase.from("charges").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", id);
    // Settling a debt is exactly what an arrears alert was chasing — close it
    // now rather than leaving it on the alerts screen until the nightly sync.
    try { await reconcileAlerts(supabase); } catch (e) { /* non-fatal */ }
    await logAudit({ entity_type: "charge", entity_id: id, action: "paid" });
    await loadAll();
  }
  // Marks a whole rent check paid — updates every underlying advance_payments
  // row at once, with the same actual_paid_date. The actual_paid value is the
  // sum so the row's "paid in full" check uses real data.
  async function markRentCheckPaid(row: Row) {
    if (!row.underlyingAdvanceIds || row.underlyingAdvanceIds.length === 0) return;
    var today = new Date().toISOString().slice(0, 10);
    // Update each row with its own total_with_vat as actual_paid (keeps
    // per-unit ledger accurate; the alternative would be putting the full
    // check total on one row which breaks per-unit reconciliation).
    if (!row.unitsBreakdown) return;
    for (var i = 0; i < row.underlyingAdvanceIds.length; i++) {
      var rid = row.underlyingAdvanceIds[i];
      var amount = row.unitsBreakdown[i]?.amount || 0;
      await supabase.from("advance_payments").update({
        actual_paid: amount, actual_paid_date: today,
      }).eq("id", rid);
    }
    await loadAll();
  }
  async function deleteCharge(id: string) {
    if (!confirm("למחוק?")) return;
    await supabase.from("charges").delete().eq("id", id);
    await loadAll();
  }

  // Marks a revenue (פידיון) report's rent as collected.
  async function markRevenuePaid(row: Row) {
    if (!row.revenueReportId) return;
    var today = new Date().toISOString().slice(0, 10);
    await supabase.from("revenue_reports").update({
      actual_paid: row.baseAmount, actual_paid_date: today,
    }).eq("id", row.revenueReportId);
    await loadAll();
  }

  // Bulk mark: when a single tenant payment covers multiple debts (rent
  // check + CPI diff + insurance), the user selects them all and clicks
  // "סמן את הנבחרים כשולמו". One round-trip per row.
  async function bulkMarkSelectedPaid() {
    var keys = Object.keys(selected).filter(function(k) { return selected[k]; });
    if (keys.length === 0) { alert("בחר חיובים תחילה"); return; }
    if (!confirm("לסמן " + keys.length + " חיובים כשולמו?")) return;
    for (var k of keys) {
      var row = rows.find(function(r) { return r.id === k; });
      if (!row) continue;
      if (row.source === "charge") {
        await supabase.from("charges").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", row.id);
      } else if (row.source === "rent_check") {
        await markRentCheckPaid(row);
      } else if (row.source === "revenue") {
        await markRevenuePaid(row);
      }
    }
    setSelected({});
    await loadAll();
  }

  // Creates a draft letter pre-filled with the debt info. For
  // missing-revenue-report rows the wording asks the tenant to send the
  // monthly revenue report rather than demanding payment.
  // A "waiting for a turnover report" row is a task, not a debt: the useful
  // action is to enter the report. Hands the revenue screen the contract and
  // the exact month so the form opens filled in rather than blank.
  function openRevenueReport(row: any) {
    const m = row?.reportMonth || "";
    router.push("/revenue?contract=" + encodeURIComponent(row.contractId || "") +
      (m ? "&month=" + encodeURIComponent(m) : "") + "&report=1");
  }

  async function sendLetter(row: Row) {
    try {
      var body: string;
      var title: string;
      var letterType: string;
      if (row.source === "missing_revenue_report") {
        body = "שוכר/ת נכבד/ה,\n\n" +
          "בהתאם להסכם השכירות, נדרש דיווח מחזור חודשי לחישוב שכ\"ד.\n" +
          "טרם נתקבל אצלנו דיווח עבור: " + (row.period || row.description) + "\n" +
          (row.dueDate ? "מועד אחרון לדיווח: " + fmtDate(row.dueDate) + "\n" : "") +
          "\nנודה לקבלת הדיווח בהקדם על מנת שנוכל להפיק את חיוב שכ\"ד הפידיון.\n\nבברכה,\nהנהלת הנכס";
        title = "דרישת דיווח מחזור — " + (row.period || "");
        letterType = "notice";
      } else {
        body = "שוכר/ת נכבד/ה,\n\n" +
          "להלן חיוב שטרם שולם:\n" +
          "תיאור: " + row.description + "\n" +
          "סכום: " + fmtMoney(row.totalAmount) + "\n" +
          (row.dueDate ? "תאריך לתשלום: " + fmtDate(row.dueDate) + "\n" : "") +
          "\nאנא הסדירו את התשלום בהקדם.\n\nבברכה,\nהנהלת הנכס";
        title = "דרישת תשלום — " + row.description.slice(0, 60);
        letterType = "demand";
      }
      var { data, error } = await supabase.from("letters").insert({
        contract_id: row.contractId,
        letter_type: letterType,
        title: title,
        content_json: { body: body, year: filterYear, tenant: row.tenantName },
        status: "draft",
      }).select().single();
      if (error) throw error;
      await logAudit({ entity_type: "letter", entity_id: data.id, action: row.source === "missing_revenue_report" ? "request_revenue_report" : "create_from_debt" });
      alert("✅ נוצרה טיוטת מכתב — היכנס למסך מכתבים לעריכה והדפסה");
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
  }

  // Apply filters
  function isOverdueRow(r: Row): boolean {
    if (r.status === "paid") return false;
    if (!r.dueDate) return false;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(r.dueDate) < today;
  }

  const filtered = rows.filter(function(r) {
    // "לתשלום" (pending) includes BOTH pending and approved — anything that
    // isn't paid yet. The intermediate "approved" state is internal and
    // doesn't get its own bucket anymore (was confusing the user).
    if (filterStatus === "overdue") { if (!isOverdueRow(r)) return false; }
    else if (filterStatus === "pending") { if (r.status !== "pending" && r.status !== "approved") return false; }
    else if (filterStatus === "paid") { if (r.status !== "paid") return false; }
    if (filterType && r.chargeType !== filterType) return false;
    if (filterProperty && r.propertyName !== filterProperty) return false;
    if (filterSearch) {
      var q = filterSearch.toLowerCase();
      var hay = (r.tenantName + " " + r.propertyName + " " + r.description).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  // Group by due-date month
  const byMonth: Record<string, Row[]> = {};
  filtered.forEach(function(r) {
    var key = r.dueDate ? r.dueDate.slice(0, 7) : "no-date";
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(r);
  });
  var monthKeys = Object.keys(byMonth).sort();

  // KPIs. Anything still OWED is counted net of concessions — a waived amount is
  // not a debt, so it must not inflate "לתשלום" or "באיחור". What was already
  // paid keeps its own figure.
  var owed = function(r: any) { return r.balance != null ? Number(r.balance) : r.totalAmount; };
  var stillOwed = function(r: any) { return owed(r) > 0.005; };
  var totalPending  = rows.filter(function(r) { return r.status === "pending"; }).reduce(function(s, r) { return s + owed(r); }, 0);
  var totalApproved = rows.filter(function(r) { return r.status === "approved"; }).reduce(function(s, r) { return s + owed(r); }, 0);
  var totalPaid     = rows.filter(function(r) { return r.status === "paid"; }).reduce(function(s, r) { return s + r.totalAmount; }, 0);
  var totalOverdue  = rows.filter(function(r) { return isOverdueRow(r) && stillOwed(r); }).reduce(function(s, r) { return s + owed(r); }, 0);
  var pendingCount  = rows.filter(function(r) { return r.status === "pending"; }).length;
  var overdueCount  = rows.filter(function(r) { return isOverdueRow(r) && stillOwed(r); }).length;

  // Per-tenant balance for the bottom summary
  var balanceByTenant: Record<string, number> = {};
  rows.filter(function(r) { return r.status !== "paid"; }).forEach(function(r) {
    balanceByTenant[r.tenantName] = (balanceByTenant[r.tenantName] || 0) + r.totalAmount;
  });
  var topDebtors = Object.entries(balanceByTenant)
    .filter(function(x) { return x[1] > 1; })
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 5);

  // Year options
  var yearOptions: number[] = [];
  for (var y = currentYear + 1; y >= currentYear - 5; y--) yearOptions.push(y);

  function toggleMonth(key: string) {
    setCollapsedMonths(function(prev) { return Object.assign({}, prev, { [key]: !prev[key] }); });
  }

  // Mark every visible unpaid row as paid in one click — covers all 3 sources.
  async function bulkMarkAllPaid() {
    var toMark = filtered.filter(function(r) { return r.status !== "paid"; });
    if (toMark.length === 0) { alert("אין חיובים לסמן"); return; }
    if (!confirm("לסמן " + toMark.length + " חיובים כשולמו?")) return;
    for (var r of toMark) {
      if (r.source === "charge") {
        await supabase.from("charges").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", r.id);
      } else if (r.source === "rent_check") {
        await markRentCheckPaid(r);
      } else if (r.source === "revenue") {
        await markRevenuePaid(r);
      }
    }
    await loadAll();
  }

  return (
    <div dir="rtl">
      {/* ויתור על חיוב — the charge itself is never edited; this records what
          was given up, why, and by whom. */}
      {concFor && (function () {
        var v = concessionValue({
          method: cMethod, percent: Number(cPercent) || 0, amount: Number(cAmount) || 0,
          itemBase: Number(concFor.baseAmount) || 0, itemVat: Number(concFor.vatAmount) || 0,
        });
        var newBalance = Math.max(0, (Number(concFor.balance) || 0) - v.total);
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={function () { if (!cSaving) setConcFor(null); }}>
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[85vh] overflow-auto" onClick={function (e: any) { e.stopPropagation(); }}>
              <div className="text-lg font-bold text-slate-800 mb-1">🤝 ויתור / הסדר</div>
              <div className="text-xs text-slate-500 mb-4">{concFor.tenantName} · {concFor.description} · חיוב {fmtMoney(concFor.totalAmount)}</div>

              <label className="mb-1 block text-xs font-semibold text-slate-700">היקף הוויתור</label>
              <div className="flex gap-1 mb-3 flex-wrap">
                <button type="button" onClick={function () { setCMethod("full"); }}
                  className={"rounded border px-3 py-1.5 text-xs " + (cMethod === "full" ? "border-emerald-500 bg-emerald-50 font-bold text-emerald-700" : "border-slate-200 text-slate-600")}>ויתור מלא</button>
                <button type="button" onClick={function () { setCMethod("percent"); }}
                  className={"rounded border px-3 py-1.5 text-xs " + (cMethod === "percent" ? "border-emerald-500 bg-emerald-50 font-bold text-emerald-700" : "border-slate-200 text-slate-600")}>אחוז</button>
                <button type="button" onClick={function () { setCMethod("amount"); }}
                  className={"rounded border px-3 py-1.5 text-xs " + (cMethod === "amount" ? "border-emerald-500 bg-emerald-50 font-bold text-emerald-700" : "border-slate-200 text-slate-600")}>סכום</button>
              </div>

              {cMethod === "percent" && (
                <div className="mb-3">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">אחוז הוויתור (%)</label>
                  <input type="number" min="1" max="100" value={cPercent} onChange={function (e) { setCPercent(e.target.value); }} className={ic} />
                </div>
              )}
              {cMethod === "amount" && (
                <div className="mb-3">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום הוויתור לפני מע&quot;מ (₪)</label>
                  <input type="number" step="0.01" value={cAmount} onChange={function (e) { setCAmount(e.target.value); }} className={ic} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סיבה</label>
                  <select value={cReason} onChange={function (e) { setCReason(e.target.value as any); }} className={ic}>
                    <option value="war">מלחמה / מצב חירום</option>
                    <option value="covid">קורונה</option>
                    <option value="compensation">פיצוי לשוכר</option>
                    <option value="goodwill">מחווה מסחרית</option>
                    <option value="billing_error">טעות בחיוב</option>
                    <option value="dispute">פשרה במחלוקת</option>
                    <option value="other">אחר</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">פריסת היתרה (תשלומים)</label>
                  <input type="number" min="0" value={cInstallments} placeholder="ריק = ללא פריסה"
                    onChange={function (e) { setCInstallments(e.target.value); }} className={ic} />
                </div>
              </div>

              <label className="mb-1 block text-xs font-semibold text-slate-700">נימוק (חובה)</label>
              <textarea value={cNotes} onChange={function (e) { setCNotes(e.target.value); }} rows={2}
                placeholder="ההסבר נשמר בתיק ומופיע בדוח הוויתורים" className={ic + " mb-3"} />

              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 space-y-0.5 mb-4">
                <div>ויתור: <b>{fmtMoney(v.base)}</b> + מע&quot;מ {fmtMoney(v.vat)} = <b>{fmtMoney(v.total)}</b></div>
                <div>יתרה לתשלום אחרי הוויתור: <b>{fmtMoney(newBalance)}</b></div>
                <div className="text-emerald-700">החיוב המקורי נשמר כפי שהוא — הסכום שוויתרנו עליו לא ייחשב כחוב של השוכר.</div>
              </div>

              <div className="flex gap-2">
                <button disabled={cSaving || v.total <= 0} onClick={saveConcession}
                  className="flex-1 rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
                  {cSaving ? "⏳ שומר..." : "✓ אשר ויתור"}
                </button>
                <button onClick={function () { setConcFor(null); }} disabled={cSaving}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">ביטול</button>
              </div>
            </div>
          </div>
        );
      })()}

      <PageHero title="חיובים" icon="💳" tone="emerald"
        subtitle={<>
          {rows.length} פריטים בשנת {filterYear}
          {includeAdvances && <span className="text-white/70 text-xs mr-2">(כולל מקדמות שכ&quot;ד שטרם שולמו)</span>}
        </>} />

      {/* KPIs — clickable to filter by status. Simplified to 3 buckets:
          לתשלום (everything not yet paid, including approved), באיחור (subset
          past due_date), שולמו. The "approved" intermediate state was confusing
          to the user — they expected ✓ to mean "paid". We now drive ✓ directly
          to paid, and treat "approved" rows the same as "pending" in the KPIs. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        {[
          { f: "pending",  label: "לתשלום", amount: totalPending + totalApproved,  count: pendingCount + rows.filter(function(r){return r.status==="approved";}).length, color: "text-slate-700", bg: "bg-white" },
          { f: "overdue",  label: "באיחור (מעל ימי החסד)",  amount: totalOverdue,  count: overdueCount, color: "text-red-700",   bg: "bg-red-50" },
          { f: "paid",     label: "שולמו",   amount: totalPaid,     count: rows.filter(function(r){return r.status==="paid";}).length, color: "text-green-700", bg: "bg-green-50" },
        ].map(function(k) {
          return (
            <button
              key={k.f}
              onClick={function() { setFilterStatus(filterStatus === k.f ? "all" : k.f as any); }}
              className={"rounded-xl border p-4 text-center transition-all " + k.bg + (filterStatus === k.f ? " border-blue-500 ring-2 ring-blue-300" : " border-slate-200")}
            >
              <div className={"text-2xl font-black " + k.color}>{k.count}</div>
              <div className={"text-sm font-bold " + k.color}>{fmtMoney(k.amount)}</div>
              <div className={"text-xs " + k.color}>{k.label}</div>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3 space-y-2">
        {/* Top row: text search + year + property + advance toggle + clear + counter + actions */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={filterSearch}
            onChange={function(e) { setFilterSearch(e.target.value); }}
            placeholder="🔍 חיפוש שוכר / נכס / תיאור"
            className={ic + " flex-1 min-w-[200px]"}
          />
          <Dropdown
            className="w-full sm:w-32"
            value={String(filterYear)}
            onChange={function(v) { setFilterYear(Number(v)); }}
            options={yearOptions.map(function(y) { return { value: String(y), label: "📅 " + y }; })}
          />
          <Dropdown
            className="w-full sm:w-48"
            value={filterProperty}
            placeholder="🏢 נכס: הכל"
            onChange={function(v) { setFilterProperty(v); }}
            options={[{ value: "", label: "🏢 נכס: הכל" }].concat(
              Array.from(new Set(rows.map(function(r) { return r.propertyName; }).filter(Boolean))).sort().map(function(p) {
                return { value: p as string, label: p as string };
              })
            )}
          />
          <label className="flex items-center gap-1.5 text-xs text-slate-600 px-2 py-1 cursor-pointer">
            <input type="checkbox" checked={includeAdvances} onChange={function(e) { setIncludeAdvances(e.target.checked); }} className="w-3.5 h-3.5"/>
            כלול מקדמות שכ&quot;ד
          </label>
          {(filterSearch || filterType || filterProperty || filterStatus !== "all") && (
            <button onClick={function() { setFilterSearch(""); setFilterType(""); setFilterProperty(""); setFilterStatus("all"); }} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 border border-slate-200 rounded">
              ✕ נקה
            </button>
          )}
          <div className="text-xs text-slate-500 mr-auto">
            {filtered.length} / {rows.length}
          </div>
          {(function() {
            // Selected rows + their combined total — lets the user confirm the
            // sum matches what the tenant is paying in ONE transfer / cheque.
            var sel = rows.filter(function(r) { return selected[r.id]; });
            if (sel.length === 0) return null;
            var tot = sel.reduce(function(s, r) { return s + (r.totalAmount || 0); }, 0);
            return (
              <div className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5">
                <span className="text-sm font-bold text-green-800 whitespace-nowrap">{sel.length} נבחרו · סה&quot;כ {fmtMoney(tot)}</span>
                <button onClick={bulkMarkSelectedPaid} className="rounded-md bg-green-600 text-white px-3 py-1 text-sm font-bold hover:bg-green-700 whitespace-nowrap">✓ סמן כשולמו</button>
                <button onClick={function() { setSelected({}); }} className="rounded-md border border-slate-300 text-slate-500 px-2 py-1 text-sm hover:bg-slate-100" title="נקה בחירה">✕</button>
              </div>
            );
          })()}
          {filtered.filter(function(r) { return r.status !== "paid"; }).length > 0 && (
            <button onClick={bulkMarkAllPaid} className="rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-100" title="סמן את כל המסוננים כשולמו">
              ₪ סמן הכל כשולם
            </button>
          )}
          <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2 font-bold text-white hover:bg-blue-800">
            + חיוב חדש
          </button>
        </div>
        {/* Type chips — replaces the native select dropdown which was
            overflowing the viewport in RTL Chrome. All options visible at
            once, click to toggle on/off. */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-100">
          <span className="text-[11px] text-slate-500 ml-1">סוג חיוב:</span>
          <button
            onClick={function() { setFilterType(""); }}
            className={"rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors " + (filterType === "" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
          >
            הכל
          </button>
          {CHARGE_TYPES.map(function(t) {
            var isActive = filterType === t.v;
            return (
              <button
                key={t.v}
                onClick={function() { setFilterType(isActive ? "" : t.v); }}
                className={"rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors " + (isActive ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
              >
                {t.icon} {t.l}
              </button>
            );
          })}
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-bold">⚠️ שגיאה בטעינת הנתונים — הרשימה שמוצגת אינה מלאה</div>
          <div className="mt-0.5 text-xs" dir="ltr">{loadError}</div>
        </div>
      )}

      {/* Top debtors strip — quickly see who owes the most */}
      {topDebtors.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
          <div className="text-xs font-bold text-amber-900 mb-1.5">🏆 הסכומים הגבוהים שמגיעים לתשלום (לפי שוכר)</div>
          <div className="flex flex-wrap gap-2">
            {topDebtors.map(function(x) {
              return (
                <button
                  key={x[0]}
                  onClick={function() { setFilterSearch(x[0]); }}
                  className="rounded-md bg-white border border-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                  title={"לחץ לסינון לפי " + x[0]}
                >
                  {x[0]} <span className="text-amber-700 font-bold mr-1">{fmtMoney(x[1])}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div>
      ) : monthKeys.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">💳</div>
          <div>אין חיובים התואמים את הסינון</div>
          <button onClick={openNew} className="mt-3 text-blue-600 hover:underline text-sm">+ חיוב חדש</button>
        </div>
      ) : (
        <div className="space-y-3">
          {monthKeys.map(function(mk) {
            var monthRows = byMonth[mk];
            var monthTotal = monthRows.reduce(function(s, r) { return s + r.totalAmount; }, 0);
            var monthLabel = mk === "no-date" ? "ללא תאריך" : (function() {
              var p = mk.split("-");
              return HEB_MONTHS[Number(p[1])] + " " + p[0];
            })();
            var monthOverdueCount = monthRows.filter(isOverdueRow).length;
            var isCollapsed = !!collapsedMonths[mk];
            return (
              <div key={mk} ref={mk === currentMonthKey ? currentMonthRef : undefined} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden scroll-mt-4">
                <button
                  onClick={function() { toggleMonth(mk); }}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100"
                >
                  <div className="flex items-center gap-2 text-right">
                    <span className="text-lg">📅</span>
                    <span className="font-bold text-slate-800">{monthLabel}</span>
                    <span className="text-xs text-slate-500">— {monthRows.length} פריטים</span>
                    {monthOverdueCount > 0 && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">{monthOverdueCount} באיחור</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-800">{fmtMoney(monthTotal)}</span>
                    <span className="text-slate-400 text-sm">{isCollapsed ? "▶" : "▼"}</span>
                  </div>
                </button>
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-right text-sm">
                    <thead className="bg-slate-50/50 border-b">
                      <tr>
                        <th className="px-2 py-2 font-semibold text-slate-700 w-8">
                          <input
                            type="checkbox"
                            checked={monthRows.every(function(r) { return !!selected[r.id]; })}
                            onChange={function(e) {
                              setSelected(function(prev) {
                                var next = Object.assign({}, prev);
                                monthRows.forEach(function(r) { next[r.id] = e.target.checked; });
                                return next;
                              });
                            }}
                            className="w-4 h-4 cursor-pointer accent-blue-600"
                            title="בחר/בטל את כל החודש"
                          />
                        </th>
                        <th className="px-4 py-2 font-semibold text-slate-700">שוכר/נכס</th>
                        <th className="px-4 py-2 font-semibold text-slate-700">תיאור</th>
                        <th className="px-4 py-2 font-semibold text-slate-700">סה&quot;כ</th>
                        <th className="px-4 py-2 font-semibold text-slate-700">לתשלום</th>
                        <th className="px-4 py-2 font-semibold text-slate-700">סטטוס</th>
                        <th className="px-4 py-2 font-semibold text-slate-700">פעולות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthRows.map(function(r) {
                        var overdue = isOverdueRow(r);
                        var t = typeInfo(r.chargeType);
                        var isExpanded = !!expandedChecks[r.id];
                        var unitCount = r.unitsBreakdown?.length || 0;
                        return (
                          <React.Fragment key={r.id}>
                            <tr className={"border-t border-slate-100 " + (overdue ? "bg-red-50/60" : selected[r.id] ? "bg-blue-50/40" : "hover:bg-slate-50")}>
                              <td className="px-2 py-2.5">
                                <input
                                  type="checkbox"
                                  checked={!!selected[r.id]}
                                  onChange={function(e) {
                                    setSelected(function(prev) { return Object.assign({}, prev, { [r.id]: e.target.checked }); });
                                  }}
                                  className="w-4 h-4 cursor-pointer accent-blue-600"
                                />
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="font-semibold text-slate-800">{r.tenantName}</div>
                                <div className="text-xs text-slate-400">{r.propertyName}</div>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-base">{t.icon}</span>
                                  <span className="text-xs text-slate-700">{r.description}</span>
                                </div>
                                {r.source === "rent_check" && (
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-blue-700 font-semibold">📅 שיק שכ&quot;ד · {unitCount} {unitCount === 1 ? "יחידה" : "יחידות"}</span>
                                    {unitCount > 1 && (
                                      <button
                                        onClick={function() { setExpandedChecks(function(p) { return Object.assign({}, p, { [r.id]: !p[r.id] }); }); }}
                                        className="text-[10px] text-blue-600 hover:underline"
                                      >
                                        {isExpanded ? "▲ הסתר פירוט" : "▼ פירוט יחידות"}
                                      </button>
                                    )}
                                  </div>
                                )}
                                {r.source === "revenue" && (
                                  <div className="text-[10px] text-purple-700 font-semibold mt-0.5">📊 שכ&quot;ד פידיון</div>
                                )}
                                {r.source === "missing_revenue_report" && (
                                  <button onClick={function(){ openRevenueReport(r); }}
                                    className="text-[10px] text-orange-700 font-semibold mt-0.5 underline hover:text-purple-700 text-right"
                                    title="פתח את טופס דיווח הפדיון">📝 ממתין לדיווח מהשוכר — לחץ להזנת הדיווח</button>
                                )}
                              </td>
                              <td className="px-4 py-2.5 font-bold text-slate-800 font-mono whitespace-nowrap">
                                {/* With a concession the demand and the balance
                                    are different numbers, and both matter. */}
                                {Number(r.waived) > 0 ? (
                                  <>
                                    <span className="line-through text-slate-400">{fmtMoney(r.totalAmount)}</span>
                                    <div className="text-emerald-700">{fmtMoney(Number(r.balance) || 0)}</div>
                                  </>
                                ) : fmtMoney(r.totalAmount)}
                                {r.vatAmount > 0 && <div className="text-[10px] text-slate-400 font-normal">בסיס {fmtMoney(r.baseAmount)} + מע&quot;מ {fmtMoney(r.vatAmount)}</div>}
                                {Number(r.waived) > 0 && (
                                  <div className="text-[10px] mt-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 px-1.5 py-0.5 font-semibold inline-block"
                                    title={(r.concessions || []).map(function(x: any){ return describeConcession(x) + (x.reason_notes ? " — " + x.reason_notes : ""); }).join("\n")}>
                                    🤝 ויתור {fmtMoney(Number(r.waived) || 0)}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                                {fmtDate(r.dueDate || "")}
                                {overdue && <div className="text-red-600 font-semibold">⚠ באיחור</div>}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + (
                                  r.status === "paid" ? "bg-green-100 text-green-700"
                                    : r.source === "missing_revenue_report" ? "bg-orange-100 text-orange-700"
                                    : "bg-slate-100 text-slate-600"
                                )}>
                                  {r.status === "paid" ? "שולם"
                                    : r.source === "missing_revenue_report" ? "ממתין לדיווח"
                                    : "לתשלום"}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex gap-1">
                                  {/* Single ₪ button does the right thing for every row type.
                                      No more "approve first then pay" — caused user confusion. */}
                                  {r.status !== "paid" && r.source === "charge" && (
                                    <button onClick={function() { markPaid(r.id); }} className="text-xs bg-green-600 text-white px-2 py-1 rounded font-semibold" title="סמן כשולם">₪ שולם</button>
                                  )}
                                  {r.status !== "paid" && r.source === "rent_check" && (
                                    <button onClick={function() { markRentCheckPaid(r); }} className="text-xs bg-green-600 text-white px-2 py-1 rounded font-semibold" title={"סמן את כל " + unitCount + " היחידות כשולמו"}>₪ שולם</button>
                                  )}
                                  {r.status !== "paid" && r.source === "revenue" && (
                                    <button onClick={function() { markRevenuePaid(r); }} className="text-xs bg-green-600 text-white px-2 py-1 rounded font-semibold" title="סמן שכ&quot;ד פידיון כשולם">₪ שולם</button>
                                  )}
                                  {mayGrant && (r.source === "charge" || r.source === "rent_check") && r.status !== "paid" && Number(r.balance) > 0 && (
                                    <button onClick={function() { openConcession(r); }}
                                      className="text-xs border border-emerald-200 bg-emerald-50 rounded px-2 py-1 text-emerald-700 hover:bg-emerald-100"
                                      title="ויתור מלא או חלקי על החיוב — לא יירשם כחוב של השוכר">🤝 ויתור</button>
                                  )}
                                  {r.source === "missing_revenue_report" && (
                                    <button onClick={function() { openRevenueReport(r); }}
                                      className="text-xs bg-purple-600 text-white px-2 py-1 rounded font-semibold hover:bg-purple-700"
                                      title="פתח את טופס דיווח הפדיון לחודש הזה">📊 הזן דיווח</button>
                                  )}
                                  <button onClick={function() { sendLetter(r); }} className="text-xs border border-amber-200 bg-amber-50 rounded px-2 py-1 text-amber-700 hover:bg-amber-100" title="צור טיוטת מכתב דרישה">📧</button>
                                  {r.source === "charge" && (
                                    <button onClick={function() { deleteCharge(r.id); }} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50" title="מחק">🗑</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {r.source === "rent_check" && isExpanded && r.unitsBreakdown && (
                              <tr className="bg-blue-50/30">
                                <td colSpan={7} className="px-12 py-2">
                                  <div className="text-[11px] text-slate-600 space-y-0.5">
                                    {r.unitsBreakdown.map(function(u, i) {
                                      return (
                                        <div key={i} className="flex justify-between border-b border-blue-100/60 py-0.5">
                                          <span>📐 {u.name} · {u.period}</span>
                                          <span className="font-mono font-semibold">{fmtMoney(u.amount)}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">חיוב חדש</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה *</label>
                <select value={fContractId} onChange={function(e) { setFContractId(e.target.value); fillFromContract(e.target.value); }} className={ic}>
                  <option value="">-- בחר --</option>
                  {contracts.map(function(c) { return <option key={c.id} value={c.id}>{(c.tenants as any)?.name} — {(c.properties as any)?.name}</option>; })}
                </select>
              </div>
              <div>
                <div className="flex gap-2 flex-wrap">
                  {CHARGE_TYPES.map(function(t) {
                    return (
                      <button key={t.v} type="button" onClick={function() { setFType(t.v); }} className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " + (fType === t.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
                        {t.icon} {t.l}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום בסיס (₪) *</label>
                  <input type="number" value={fBaseAmount} onChange={function(e) { setFBaseAmount(e.target.value); }} className={ic}/>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">מע&quot;מ</label>
                  <select value={fVatType} onChange={function(e) { setFVatType(e.target.value); }} className={ic}>
                    <option value="taxable">חייב ({Math.round(formVatPct*100)}%)</option>
                    <option value="exempt">פטור</option>
                  </select>
                </div>
              </div>
              {fBaseAmount && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-slate-600">בסיס</span><span className="font-semibold">{fmtMoney(Number(fBaseAmount))}</span></div>
                  {fVatType === "taxable" && <div className="flex justify-between"><span className="text-slate-600">מע&quot;מ {Math.round(formVatPct*100)}%</span><span>{fmtMoney(Number(fBaseAmount) * formVatPct)}</span></div>}
                  <div className="flex justify-between font-black text-blue-800 pt-1 border-t border-blue-200 mt-1"><span>סה&quot;כ</span><span>{fmtMoney(Number(fBaseAmount) * (fVatType === "taxable" ? (1 + formVatPct) : 1))}</span></div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">תקופה מ-</label><input type="date" value={fPeriodFrom} onChange={function(e) { setFPeriodFrom(e.target.value); }} className={ic}/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">תקופה עד</label><input type="date" value={fPeriodTo} onChange={function(e) { setFPeriodTo(e.target.value); }} className={ic}/></div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך לתשלום</label>
                <input type="date" value={fDueDate} onChange={function(e) { setFDueDate(e.target.value); }} className={ic}/>
                <div className="text-[10px] text-slate-400 mt-1">ברירת מחדל: היום + 30 ימים</div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={function(e) { setFNotes(e.target.value); }} className={ic} placeholder="תיאור החיוב — יוצג ברשימה"/>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function() { setEditingId(""); }} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? "שומר..." : "שמור חיוב"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
