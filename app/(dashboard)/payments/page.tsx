"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';

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
  { v: "other",       l: "אחר",               icon: "📋" },
];

const HEB_MONTHS = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function fmtMoney(n: number) { return "₪" + (n ?? 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function typeInfo(v: string) { return CHARGE_TYPES.find(function(t) { return t.v === v; }) ?? CHARGE_TYPES[CHARGE_TYPES.length - 1]; }

// Unified row shape — a charge or a virtual "unpaid advance" row.
type Row = {
  id: string;
  source: "charge" | "advance";
  contractId: string;
  tenantName: string;
  propertyName: string;
  chargeType: string;          // for charges; "rent" for advances
  description: string;          // human-readable (notes for charges, period for advances)
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  vatType: string;
  dueDate: string | null;       // ISO date
  status: "pending" | "approved" | "paid";
  createdAt: string;
  spaceName?: string;           // for advances
  period?: string;              // for advances
};

export default function PaymentsPage() {
  const currentYear = new Date().getFullYear();
  const [rows,      setRows]      = useState<Row[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editingId, setEditingId] = useState("");
  const [saving,    setSaving]    = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "approved" | "paid" | "overdue">("pending");
  const [filterYear,   setFilterYear]   = useState<number>(currentYear);
  const [filterType,   setFilterType]   = useState<string>("");
  const [filterSearch, setFilterSearch] = useState<string>("");
  const [includeAdvances, setIncludeAdvances] = useState<boolean>(true);
  // Collapsed month sections
  const [collapsedMonths, setCollapsedMonths] = useState<Record<string, boolean>>({});

  // New-charge form state
  const [fContractId,  setFContractId]  = useState("");
  const [fType,        setFType]        = useState("rent");
  const [fBaseAmount,  setFBaseAmount]  = useState("");
  const [fVatType,     setFVatType]     = useState("taxable");
  const [fPeriodFrom,  setFPeriodFrom]  = useState("");
  const [fPeriodTo,    setFPeriodTo]    = useState("");
  const [fDueDate,     setFDueDate]     = useState("");
  const [fNotes,       setFNotes]       = useState("");

  useEffect(function() { loadAll(); }, [filterYear, includeAdvances]);

  async function loadAll() {
    setLoading(true);
    var yearStart = filterYear + "-01-01";
    var yearEnd   = (filterYear + 1) + "-01-01";

    const [chargesRes, contractsRes, advRes] = await Promise.all([
      // Load all charges with a due_date in the selected year. Falls back to
      // billing_period_start when due_date is null (older data).
      supabase.from("charges")
        .select("*, contracts(tenants(name),properties(name),vat_type)")
        .or("due_date.gte." + yearStart + ",billing_period_start.gte." + yearStart)
        .or("due_date.lt." + yearEnd + ",billing_period_start.lt." + yearEnd)
        .order("due_date", { ascending: true }),
      supabase.from("contracts").select("id,vat_type,rent_per_sqm,charged_area,investment_addition,tenants(name),properties(name)").in("status", ["active", "expiring", "extended"]),
      // Unpaid rent advances for the year — virtual rows so the user has
      // a single screen showing what each tenant owes right now.
      includeAdvances ? supabase.from("advance_payments")
        .select("id, contract_id, period, space_name, tenant_name, check_date, total_with_vat, total_before_vat, vat_amount, actual_paid, waived")
        .gte("check_date", yearStart)
        .lt("check_date", yearEnd)
        .order("check_date", { ascending: true })
        : Promise.resolve({ data: [] }),
    ]);

    var ch = chargesRes.data || [];
    var adv = (advRes.data || []).filter(function(a: any) {
      // Only unpaid + not waived
      var paid = Number(a.actual_paid) || 0;
      return !a.waived && paid < 1;
    });

    // Property lookup for advance rows (advance_payments doesn't join properties cleanly)
    var contractMap: Record<string, any> = {};
    (contractsRes.data || []).forEach(function(c: any) { contractMap[c.id] = c; });

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
        vatType: c.vat_type || "",
        dueDate: c.due_date,
        status: c.status || "pending",
        createdAt: c.created_at,
      });
    });

    adv.forEach(function(a: any) {
      var c = contractMap[a.contract_id];
      var property = (c?.properties as any)?.name || "";
      allRows.push({
        id: "adv-" + a.id,
        source: "advance",
        contractId: a.contract_id,
        tenantName: a.tenant_name || (c?.tenants as any)?.name || "—",
        propertyName: property,
        chargeType: "rent",
        description: "מקדמת שכ\"ד — " + (a.period || "—") + (a.space_name ? " (" + a.space_name + ")" : ""),
        baseAmount: Number(a.total_before_vat) || 0,
        vatAmount: Number(a.vat_amount) || 0,
        totalAmount: Number(a.total_with_vat) || 0,
        vatType: "taxable",
        dueDate: a.check_date,
        status: "pending",
        createdAt: a.check_date,
        spaceName: a.space_name,
        period: a.period,
      });
    });

    setRows(allRows);
    setContracts(contractsRes.data || []);
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
      const vat = fVatType === "taxable" ? base * 0.18 : 0;
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
  async function markPaid(id: string) {
    await supabase.from("charges").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", id);
    await logAudit({ entity_type: "charge", entity_id: id, action: "paid" });
    await loadAll();
  }
  async function markAdvPaid(advId: string) {
    var realId = advId.replace(/^adv-/, "");
    await supabase.from("advance_payments").update({ actual_paid: 0.01, actual_paid_date: new Date().toISOString().slice(0, 10) }).eq("id", realId);
    await loadAll();
  }
  async function deleteCharge(id: string) {
    if (!confirm("למחוק?")) return;
    await supabase.from("charges").delete().eq("id", id);
    await loadAll();
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
    if (filterStatus === "overdue") { if (!isOverdueRow(r)) return false; }
    else if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterType && r.chargeType !== filterType) return false;
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

  // KPIs
  var totalPending  = rows.filter(function(r) { return r.status === "pending"; }).reduce(function(s, r) { return s + r.totalAmount; }, 0);
  var totalApproved = rows.filter(function(r) { return r.status === "approved"; }).reduce(function(s, r) { return s + r.totalAmount; }, 0);
  var totalPaid     = rows.filter(function(r) { return r.status === "paid"; }).reduce(function(s, r) { return s + r.totalAmount; }, 0);
  var totalOverdue  = rows.filter(function(r) { return isOverdueRow(r); }).reduce(function(s, r) { return s + r.totalAmount; }, 0);
  var pendingCount  = rows.filter(function(r) { return r.status === "pending"; }).length;
  var overdueCount  = rows.filter(function(r) { return isOverdueRow(r); }).length;

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

  async function bulkApprove() {
    var toApprove = filtered.filter(function(r) { return r.source === "charge" && r.status === "pending"; });
    for (var r of toApprove) {
      await supabase.from("charges").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", r.id);
    }
    await loadAll();
  }

  return (
    <div dir="rtl">
      <div className="mb-4">
        <h1 className="text-3xl font-bold text-slate-800">חיובים</h1>
        <p className="text-sm text-slate-500 mt-1">
          {rows.length} פריטים בשנת {filterYear}
          {includeAdvances && <span className="text-xs text-blue-600 mr-2">(כולל מקדמות שכ&quot;ד שטרם שולמו)</span>}
        </p>
      </div>

      {/* KPIs — clickable to filter by status */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { f: "pending",  label: "ממתינים", amount: totalPending,  count: pendingCount, color: "text-slate-700", bg: "bg-white" },
          { f: "overdue",  label: "באיחור",  amount: totalOverdue,  count: overdueCount, color: "text-red-700",   bg: "bg-red-50" },
          { f: "approved", label: "מאושרים", amount: totalApproved, count: rows.filter(function(r){return r.status==="approved";}).length, color: "text-blue-700",  bg: "bg-blue-50" },
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
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={filterSearch}
          onChange={function(e) { setFilterSearch(e.target.value); }}
          placeholder="🔍 חיפוש שוכר / נכס / תיאור"
          className={ic + " flex-1 min-w-[200px]"}
        />
        <select value={filterYear} onChange={function(e) { setFilterYear(Number(e.target.value)); }} className={ic + " w-32"}>
          {yearOptions.map(function(y) { return <option key={y} value={y}>📅 {y}</option>; })}
        </select>
        <select value={filterType} onChange={function(e) { setFilterType(e.target.value); }} className={ic + " w-44"}>
          <option value="">📋 סוג: הכל</option>
          {CHARGE_TYPES.map(function(t) { return <option key={t.v} value={t.v}>{t.icon} {t.l}</option>; })}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 px-2 py-1 cursor-pointer">
          <input type="checkbox" checked={includeAdvances} onChange={function(e) { setIncludeAdvances(e.target.checked); }} className="w-3.5 h-3.5"/>
          כלול מקדמות שכ&quot;ד
        </label>
        {(filterSearch || filterType || filterStatus !== "all") && (
          <button onClick={function() { setFilterSearch(""); setFilterType(""); setFilterStatus("all"); }} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 border border-slate-200 rounded">
            ✕ נקה
          </button>
        )}
        <div className="text-xs text-slate-500 mr-auto">
          {filtered.length} / {rows.length}
        </div>
        {filtered.filter(function(r) { return r.source === "charge" && r.status === "pending"; }).length > 0 && (
          <button onClick={bulkApprove} className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">
            ✓ אשר כל הממתינים
          </button>
        )}
        <button onClick={openNew} className="rounded-lg bg-blue-700 px-5 py-2 font-bold text-white hover:bg-blue-800">
          + חיוב חדש
        </button>
      </div>

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
        <div className="text-center py-12 text-slate-400">טוען...</div>
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
              <div key={mk} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
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
                  <table className="w-full text-right text-sm">
                    <thead className="bg-slate-50/50 border-b">
                      <tr>
                        <th className="px-4 py-2 font-semibold text-slate-700">שוכר/נכס</th>
                        <th className="px-4 py-2 font-semibold text-slate-700">תיאור</th>
                        <th className="px-4 py-2 font-semibold text-slate-700">בסיס</th>
                        <th className="px-4 py-2 font-semibold text-slate-700">מע&quot;מ</th>
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
                        return (
                          <tr key={r.id} className={"border-t border-slate-100 " + (overdue ? "bg-red-50/60" : "hover:bg-slate-50")}>
                            <td className="px-4 py-2.5">
                              <div className="font-semibold text-slate-800">{r.tenantName}</div>
                              <div className="text-xs text-slate-400">{r.propertyName}</div>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-base">{t.icon}</span>
                                <span className="text-xs text-slate-700">{r.description}</span>
                              </div>
                              {r.source === "advance" && (
                                <div className="text-[10px] text-blue-700 font-semibold mt-0.5">📅 מקדמת שכ&quot;ד</div>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-slate-700 font-mono">{fmtMoney(r.baseAmount)}</td>
                            <td className="px-4 py-2.5 text-slate-500 font-mono">{fmtMoney(r.vatAmount)}</td>
                            <td className="px-4 py-2.5 font-bold text-slate-800 font-mono">{fmtMoney(r.totalAmount)}</td>
                            <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                              {fmtDate(r.dueDate || "")}
                              {overdue && <div className="text-red-600 font-semibold">⚠ באיחור</div>}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " + (
                                r.status === "paid" ? "bg-green-100 text-green-700" :
                                r.status === "approved" ? "bg-blue-100 text-blue-700" :
                                "bg-slate-100 text-slate-600"
                              )}>
                                {r.status === "paid" ? "שולם" : r.status === "approved" ? "מאושר" : "ממתין"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex gap-1">
                                {r.source === "charge" && r.status === "pending" && (
                                  <button onClick={function() { approve(r.id); }} className="text-xs bg-blue-600 text-white px-2 py-1 rounded font-semibold" title="אשר חיוב">✓</button>
                                )}
                                {r.source === "charge" && r.status === "approved" && (
                                  <button onClick={function() { markPaid(r.id); }} className="text-xs bg-green-600 text-white px-2 py-1 rounded font-semibold" title="סמן כשולם">₪</button>
                                )}
                                {r.source === "advance" && (
                                  <button onClick={function() { markAdvPaid(r.id); }} className="text-xs bg-green-600 text-white px-2 py-1 rounded font-semibold" title="סמן מקדמה כשולמה">₪</button>
                                )}
                                {r.source === "charge" && (
                                  <button onClick={function() { deleteCharge(r.id); }} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50" title="מחק">🗑</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
                    <option value="taxable">חייב (18%)</option>
                    <option value="exempt">פטור</option>
                  </select>
                </div>
              </div>
              {fBaseAmount && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-slate-600">בסיס</span><span className="font-semibold">{fmtMoney(Number(fBaseAmount))}</span></div>
                  {fVatType === "taxable" && <div className="flex justify-between"><span className="text-slate-600">מע&quot;מ 18%</span><span>{fmtMoney(Number(fBaseAmount) * 0.18)}</span></div>}
                  <div className="flex justify-between font-black text-blue-800 pt-1 border-t border-blue-200 mt-1"><span>סה&quot;כ</span><span>{fmtMoney(Number(fBaseAmount) * (fVatType === "taxable" ? 1.18 : 1))}</span></div>
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
