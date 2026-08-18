"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getVatPct, getVatRates, vatPctAt } from "@/lib/vat";

function fmtMoney(n: number) { return "₪" + (n ?? 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }

interface Props {
  properties: any[];
}

export default function SavedAdvancesTab({ properties }: Props) {
  const [propId, setPropId] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [advances, setAdvances] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  // Configured VAT rate (vat_rates) for labels; default 18% until loaded.
  const [vatPctLabel, setVatPctLabel] = useState(0.18);
  useEffect(function(){ getVatPct().then(setVatPctLabel); }, []);
  const [filterTenant, setFilterTenant] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCheckNum, setEditCheckNum] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Detail edit modal
  const [editModal, setEditModal] = useState<{
    ids: string[]; date: string; amount: number; checkNum: string;
    status: string; clearingStatus: string; clearingDate: string;
    waived: boolean; chargeInterest: boolean; chargeCpiDiff: boolean;
    tenantName: string; period: string; interestPct: string;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Manual add state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addContracts, setAddContracts] = useState<any[]>([]);
  const [addContractId, setAddContractId] = useState("");
  const [addSpaceId, setAddSpaceId] = useState("");
  const [addPeriodStart, setAddPeriodStart] = useState("1");
  const [addPeriodEnd, setAddPeriodEnd] = useState("12");
  const [addRent, setAddRent] = useState("");
  const [addMgmt, setAddMgmt] = useState("");
  const [addVatType, setAddVatType] = useState("taxable");
  const [addSaving, setAddSaving] = useState(false);

  useEffect(function () {
    if (properties.length > 0 && !propId) setPropId(properties[0].id);
  }, [properties]);

  useEffect(function () {
    if (propId) loadAdvances();
  }, [propId, year]);

  async function loadAdvances(preserveScroll: boolean = false) {
    var scrollY = preserveScroll ? window.scrollY : 0;
    if (!preserveScroll) setLoading(true);
    var { data } = await supabase.from("advance_payments")
      .select("*")
      .eq("property_id", propId)
      .eq("year", year)
      .order("tenant_name")
      .order("space_name")
      .order("check_date");
    setAdvances(data ?? []);
    if (!preserveScroll) setLoading(false);
    if (preserveScroll) {
      // Restore scroll position after React re-renders
      setTimeout(function () { window.scrollTo({ top: scrollY, behavior: "instant" as any }); }, 0);
    }
  }

  async function toggleReceivedGroup(ids: string[], currentStatus: string) {
    // Cycle: pending → received → pending (the "not received" needs the modal for context)
    var newStatus = currentStatus === "received" ? "pending" : "received";
    var update: any = { status: newStatus };
    if (newStatus === "received") update.received_date = new Date().toISOString().split("T")[0];
    else update.received_date = null;
    await supabase.from("advance_payments").update(update).in("id", ids);
    loadAdvances(true);
  }

  async function markAllForContract(contractId: string, markReceived: boolean) {
    var msg = markReceived ? "לסמן את כל השייקים של חוזה זה כהתקבלו?" : "לבטל סימון התקבל מכל השייקים של חוזה זה?";
    if (!confirm(msg)) return;
    var update: any = { status: markReceived ? "received" : "pending" };
    if (markReceived) update.received_date = new Date().toISOString().split("T")[0];
    else update.received_date = null;
    await supabase.from("advance_payments").update(update)
      .eq("contract_id", contractId).eq("year", year);
    loadAdvances(true);
  }

  async function saveCheckGroupDetails(ids: string[]) {
    await supabase.from("advance_payments").update({
      check_number: editCheckNum || null,
      notes: editNotes || null,
    }).in("id", ids);
    setEditingId(null);
    loadAdvances(true);
  }

  async function deleteAdvanceGroup(ids: string[]) {
    if (!confirm("למחוק את כל השייקים בקבוצה זו?")) return;
    await supabase.from("advance_payments").delete().in("id", ids);
    loadAdvances(true);
  }

  async function saveCheckEdit() {
    if (!editModal) return;
    setEditSaving(true);
    try {
      var update: any = {
        check_number: editModal.checkNum || null,
        actual_check_date: editModal.date || null,
        actual_amount: Number(editModal.amount) || null,
        status: editModal.status,
        clearing_status: editModal.clearingStatus || null,
        clearing_date: editModal.clearingDate || null,
        waived: editModal.waived,
        charge_interest: editModal.chargeInterest,
        charge_cpi_diff: editModal.chargeCpiDiff,
        interest_pct: Number(editModal.interestPct) || null,
      };
      if (editModal.status === "received") update.received_date = new Date().toISOString().split("T")[0];
      await supabase.from("advance_payments").update(update).in("id", editModal.ids);
      setEditModal(null);
      loadAdvances(true);
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setEditSaving(false); }
  }

  // Load contracts for manual add
  async function openAddModal() {
    var { data } = await supabase.from("contracts")
      .select("id, rent_per_sqm, vat_type, tenants(name), contract_spaces(space_id, spaces(space_name, area))")
      .eq("property_id", propId)
      .in("status", ["active", "extended"])
      .eq("is_amendment", false);
    setAddContracts(data ?? []);
    setShowAddModal(true);
  }

  async function saveManualAdvance() {
    if (!addContractId || !addSpaceId || !addRent) { alert("יש למלא חוזה, יחידה וסכום"); return; }
    setAddSaving(true);
    try {
      var contract = addContracts.find(function (c: any) { return c.id === addContractId; });
      var space = (contract?.contract_spaces || []).find(function (cs: any) { return cs.space_id === addSpaceId; });
      // VAT history from the configured source — each month gets the rate that
      // applied in THAT month (a year may straddle a rate change), so a back-
      // dated entry stays historically correct.
      var vatHist = addVatType === "taxable" ? await getVatRates() : [];
      var rent = Number(addRent) || 0;
      var mgmt = Number(addMgmt) || 0;
      var startM = Number(addPeriodStart) || 1;
      var endM = Number(addPeriodEnd) || 12;

      var inserts = [];
      for (var m = startM; m <= endM; m++) {
        var totalBV = rent + mgmt;
        var monthDate = year + "-" + String(m).padStart(2, "0") + "-01";
        var vat = addVatType === "taxable" ? totalBV * vatPctAt(vatHist, monthDate) : 0;
        inserts.push({
          contract_id: addContractId,
          space_id: addSpaceId,
          property_id: propId,
          tenant_name: (contract?.tenants as any)?.name || "—",
          space_name: space?.spaces?.space_name || "—",
          year: year,
          period: "חודש " + m,
          base_rent: rent,
          indexed_rent: rent,
          management_advance: mgmt,
          total_before_vat: totalBV,
          vat_amount: vat,
          total_with_vat: totalBV + vat,
          check_date: year + "-" + String(m).padStart(2, "0") + "-01",
          status: "pending",
        });
      }
      var { error } = await supabase.from("advance_payments").insert(inserts);
      if (error) throw error;
      alert("✅ נוספו " + inserts.length + " שייקים");
      setShowAddModal(false);
      loadAdvances();
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setAddSaving(false); }
  }

  // Filter advances
  var filtered = advances.filter(function (a) {
    if (filterTenant !== "all" && a.tenant_name !== filterTenant) return false;
    return true;
  });

  // Group by contract → consolidate by check_date (one check per contract per date)
  type CheckGroup = { date: string; period: string; ids: string[]; totalRent: number; totalMgmt: number; totalParking: number; totalBeforeVat: number; totalVat: number; total: number; status: string; clearingStatus: string; clearingDate: string; waived: boolean; chargeInterest: boolean; chargeCpiDiff: boolean; checkNumber: string; spaceNames: string[]; actualDate: string; actualAmount: number; interestPct: number };
  type ContractGroup = { contractId: string; tenantName: string; spaces: string[]; checks: CheckGroup[] };
  var byContract: Record<string, ContractGroup> = {};
  filtered.forEach(function (a) {
    var cid = a.contract_id;
    if (!byContract[cid]) byContract[cid] = { contractId: cid, tenantName: a.tenant_name || "—", spaces: [], checks: [] };
    if (a.space_name && byContract[cid].spaces.indexOf(a.space_name) === -1) byContract[cid].spaces.push(a.space_name);
    var existing = byContract[cid].checks.find(function (c) { return c.date === a.check_date; });
    if (!existing) {
      existing = {
        date: a.check_date, period: a.period, ids: [],
        totalRent: 0, totalMgmt: 0, totalParking: 0,
        totalBeforeVat: 0, totalVat: 0, total: 0,
        status: a.status, checkNumber: a.check_number || "",
        clearingStatus: a.clearing_status || "",
        clearingDate: a.clearing_date || "",
        waived: a.waived || false,
        chargeInterest: a.charge_interest || false,
        chargeCpiDiff: a.charge_cpi_diff !== false,
        spaceNames: [],
        actualDate: a.actual_check_date || "",
        actualAmount: Number(a.actual_amount) || 0,
        interestPct: Number(a.interest_pct) || 0,
      };
      byContract[cid].checks.push(existing);
    }
    existing.ids.push(a.id);
    existing.totalRent += Number(a.indexed_rent) || 0;
    existing.totalMgmt += Number(a.management_advance) || 0;
    existing.totalParking += Number(a.parking_monthly) || 0;
    existing.totalBeforeVat += Number(a.total_before_vat) || 0;
    existing.totalVat += Number(a.vat_amount) || 0;
    existing.total += Number(a.total_with_vat) || 0;
    if (a.status !== "received") existing.status = a.status; // if any pending, group is pending
    if (a.check_number && !existing.checkNumber) existing.checkNumber = a.check_number;
    if (a.space_name) existing.spaceNames.push(a.space_name);
  });
  // Sort checks by date
  Object.values(byContract).forEach(function (g) {
    g.checks.sort(function (a, b) { return (a.date || "").localeCompare(b.date || ""); });
  });
  // Apply status filter on consolidated checks
  if (filterStatus !== "all") {
    Object.keys(byContract).forEach(function (cid) {
      byContract[cid].checks = byContract[cid].checks.filter(function (c) {
        if (filterStatus === "waived") return c.waived;
        if (filterStatus === "cleared") return c.clearingStatus === "cleared";
        if (filterStatus === "bounced") return c.clearingStatus === "bounced";
        if (filterStatus === "not_received") return c.status === "not_received";
        if (filterStatus === "received") return c.status === "received" && !c.clearingStatus;
        if (filterStatus === "pending") return c.status === "pending" && !c.waived;
        return true;
      });
      if (byContract[cid].checks.length === 0) delete byContract[cid];
    });
  }

  var tenantNames = Array.from(new Set(advances.map(function (a) { return a.tenant_name || "—"; }))).sort();

  // KPIs based on consolidated checks
  var totalChecks = 0, clearedChecks = 0, problemChecks = 0, waivedChecks = 0;
  var totalAmount = 0, clearedAmount = 0, problemAmount = 0;
  Object.values(byContract).forEach(function (g) {
    g.checks.forEach(function (c) {
      totalChecks++;
      var amt = c.actualAmount > 0 ? c.actualAmount : c.total;
      totalAmount += c.total;
      if (c.waived) { waivedChecks++; }
      else if (c.clearingStatus === "cleared") { clearedChecks++; clearedAmount += amt; }
      else if (c.status === "not_received" || c.clearingStatus === "bounced") { problemChecks++; problemAmount += c.total; }
    });
  });
  var pendingAmount = totalAmount - clearedAmount - problemAmount;
  var pendingChecks = totalChecks - clearedChecks - problemChecks - waivedChecks;

  var ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">נכס</label>
          <select value={propId} onChange={function (e) { setPropId(e.target.value); }} className={ic}>
            {properties.map(function (p: any) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">שנה</label>
          <input type="number" value={year} onChange={function (e) { setYear(Number(e.target.value)); }} className={ic} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">שוכר</label>
          <select value={filterTenant} onChange={function (e) { setFilterTenant(e.target.value); }} className={ic}>
            <option value="all">כל השוכרים</option>
            {tenantNames.map(function (n) { return <option key={n} value={n}>{n}</option>; })}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
          <select value={filterStatus} onChange={function (e) { setFilterStatus(e.target.value); }} className={ic}>
            <option value="all">הכל</option>
            <option value="pending">ממתינים לקבלה</option>
            <option value="received">התקבלו (טרם נפדו)</option>
            <option value="cleared">נפדו</option>
            <option value="bounced">לא נפדו</option>
            <option value="not_received">לא הגיעו</option>
            <option value="waived">ויתור</option>
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-center">
          <div className="text-lg font-black text-blue-800">{fmtMoney(totalAmount)}</div>
          <div className="text-xs text-blue-600">סה&quot;כ מקדמות ({totalChecks})</div>
        </div>
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center">
          <div className="text-lg font-black text-emerald-800">{fmtMoney(clearedAmount)}</div>
          <div className="text-xs text-emerald-600">נפדו ({clearedChecks})</div>
        </div>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-center">
          <div className="text-lg font-black text-amber-800">{fmtMoney(pendingAmount)}</div>
          <div className="text-xs text-amber-600">ממתינים ({pendingChecks})</div>
        </div>
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center">
          <div className="text-lg font-black text-red-800">{fmtMoney(problemAmount)}</div>
          <div className="text-xs text-red-600">חוב פעיל ({problemChecks})</div>
        </div>
        <div className="rounded-xl bg-slate-100 border border-slate-200 p-3 text-center">
          <div className="text-lg font-black text-slate-700">{waivedChecks}</div>
          <div className="text-xs text-slate-600">🤝 ויתורים</div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button onClick={openAddModal} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
          + הוסף שייק ידני
        </button>
      </div>

      {/* Grouped table */}
      {loading ? (
        <div className="text-center py-8 text-slate-400">טוען...</div>
      ) : advances.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-4xl mb-3">📋</div>
          <div>אין מקדמות שמורות לשנת {year}</div>
          <div className="text-xs mt-1">הרץ חישוב מקדמות בטאב &quot;מקדמות שכ&quot;ד&quot; ולחץ &quot;שמור&quot;</div>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.values(byContract).map(function (g) {
            var contractTotal = g.checks.reduce(function (s, c) { return s + c.total; }, 0);
            var contractReceived = g.checks.filter(function (c) { return c.status === "received"; }).length;
            var groupKey = g.tenantName + " — " + g.spaces.join(", ");
            return (
              <div key={g.contractId} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b flex items-center justify-between">
                  <div>
                    <span className="font-bold text-sm text-slate-800">{g.tenantName}</span>
                    <span className="text-xs text-slate-500 mr-2">{g.spaces.join(", ")}</span>
                    <span className="text-xs text-slate-400 mr-2">| {g.checks.length} שייקים | {fmtMoney(contractTotal)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-xs">
                      <span className="text-green-600 font-semibold">{contractReceived} התקבלו</span>
                      <span className="text-slate-400 mx-1">|</span>
                      <span className="text-amber-600 font-semibold">{g.checks.length - contractReceived} ממתינים</span>
                    </div>
                    {contractReceived === g.checks.length ? (
                      <button onClick={function () { markAllForContract(g.contractId, false); }}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 hover:bg-amber-100">
                        ☐ בטל סימון לכל השייקים
                      </button>
                    ) : (
                      <button onClick={function () { markAllForContract(g.contractId, true); }}
                        className="rounded-lg border border-green-300 bg-green-50 px-3 py-1 text-xs font-bold text-green-700 hover:bg-green-100">
                        ✅ סמן את כל השייקים כהתקבלו
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-xs text-right min-w-[560px]">
                  <thead className="bg-slate-50 text-xs text-slate-600">
                    <tr>
                      <th className="px-2 py-2 font-semibold">תקופה</th>
                      <th className="px-2 py-2 font-semibold">תאריך נדרש</th>
                      <th className="px-2 py-2 font-semibold">סכום נדרש</th>
                      <th className="px-2 py-2 font-semibold">תאריך בפועל</th>
                      <th className="px-2 py-2 font-semibold">סכום בפועל</th>
                      <th className="px-2 py-2 font-semibold">מס׳ שייק</th>
                      <th className="px-2 py-2 font-semibold w-24">קבלה</th>
                      <th className="px-2 py-2 font-semibold w-24">פדיון</th>
                      <th className="px-2 py-2 font-semibold w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.checks.map(function (c) {
                      var editKey = g.contractId + "|" + c.date;
                      var rowClass = "border-t border-slate-100 ";
                      if (c.waived) rowClass += "bg-slate-100 opacity-60";
                      else if (c.clearingStatus === "bounced") rowClass += "bg-red-50/50";
                      else if (c.clearingStatus === "cleared") rowClass += "bg-emerald-50/50";
                      else if (c.status === "received") rowClass += "bg-green-50/50";
                      else if (c.status === "not_received") rowClass += "bg-orange-50/50";
                      else rowClass += "hover:bg-slate-50";
                      var receiptLabel = c.status === "received" ? "✅ התקבל" : c.status === "not_received" ? "⛔ לא הגיע" : "☐ ממתין";
                      var receiptColor = c.status === "received" ? "bg-green-100 text-green-700 border-green-300" : c.status === "not_received" ? "bg-orange-100 text-orange-700 border-orange-300" : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-green-50 hover:text-green-600";
                      var clearingLabel = c.clearingStatus === "cleared" ? "✅ נפדה" : c.clearingStatus === "bounced" ? "❌ לא נפדה" : (c.status === "received" ? "⏳ ממתין" : "—");
                      var clearingColor = c.clearingStatus === "cleared" ? "bg-emerald-100 text-emerald-700 border-emerald-300" : c.clearingStatus === "bounced" ? "bg-red-100 text-red-700 border-red-300" : "bg-slate-50 text-slate-400 border-slate-200";
                      return (
                        <tr key={editKey} className={rowClass}>
                          <td className="px-2 py-2 font-medium text-slate-700">
                            {c.period}
                            {c.waived && <span className="block text-[10px] text-slate-500 mt-0.5">🤝 ויתור</span>}
                          </td>
                          <td className="px-2 py-2 text-slate-600">{fmtDate(c.date)}</td>
                          <td className="px-2 py-2 font-bold text-blue-700">{fmtMoney(c.total)}</td>
                          <td className="px-2 py-2 text-slate-600">{c.actualDate ? fmtDate(c.actualDate) : <span className="text-slate-300">—</span>}</td>
                          <td className="px-2 py-2 font-semibold">
                            {c.actualAmount > 0 ? (
                              <span className={c.actualAmount !== c.total ? "text-amber-700" : "text-slate-700"}>{fmtMoney(c.actualAmount)}</span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-2 py-2"><span className="text-xs text-slate-500">{c.checkNumber || "—"}</span></td>
                          <td className="px-2 py-2">
                            <button onClick={function () { toggleReceivedGroup(c.ids, c.status); }}
                              className={"rounded-full px-2 py-1 text-[10px] font-bold transition-all border " + receiptColor}>
                              {receiptLabel}
                            </button>
                          </td>
                          <td className="px-2 py-2">
                            <span className={"rounded-full px-2 py-1 text-[10px] font-bold border inline-block " + clearingColor}>
                              {clearingLabel}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex gap-1">
                              <button onClick={function () { setEditModal({
                                ids: c.ids,
                                date: c.actualDate || c.date,
                                amount: c.actualAmount || c.total,
                                checkNum: c.checkNumber,
                                status: c.status,
                                clearingStatus: c.clearingStatus || "",
                                clearingDate: c.clearingDate || "",
                                waived: c.waived,
                                chargeInterest: c.chargeInterest,
                                chargeCpiDiff: c.chargeCpiDiff,
                                tenantName: g.tenantName,
                                period: c.period,
                                interestPct: String(c.interestPct || ""),
                              }); }}
                                className="text-xs text-slate-500 hover:text-blue-600" title="ערוך פרטי שייק">✏️</button>
                              <button onClick={function () { deleteAdvanceGroup(c.ids); }}
                                className="text-xs text-red-400 hover:text-red-600">🗑</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual Add Modal */}
      {/* Edit Check Modal */}
      {editModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setEditModal(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 my-8" onClick={function (e) { e.stopPropagation(); }}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">✏️ עריכת פרטי שייק</h3>
              <button onClick={function () { setEditModal(null); }} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="text-xs text-slate-500 bg-slate-50 rounded p-2">
              <div><strong>{editModal.tenantName}</strong> | {editModal.period}</div>
            </div>

            {/* Stage 1: Receipt */}
            <div className="rounded-lg border border-slate-200 p-3 space-y-3">
              <div className="text-xs font-bold text-slate-700">📥 שלב 1 — קבלת השייק</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <button type="button" onClick={function () { setEditModal({ ...editModal, status: "pending" }); }}
                  className={"rounded-lg border px-3 py-2 text-xs font-bold " + (editModal.status === "pending" ? "border-slate-500 bg-slate-100 text-slate-700" : "border-slate-200 text-slate-500")}>
                  ☐ ממתין
                </button>
                <button type="button" onClick={function () { setEditModal({ ...editModal, status: "received" }); }}
                  className={"rounded-lg border px-3 py-2 text-xs font-bold " + (editModal.status === "received" ? "border-green-500 bg-green-100 text-green-700" : "border-slate-200 text-slate-500")}>
                  ✅ התקבל
                </button>
                <button type="button" onClick={function () { setEditModal({ ...editModal, status: "not_received" }); }}
                  className={"rounded-lg border px-3 py-2 text-xs font-bold " + (editModal.status === "not_received" ? "border-orange-500 bg-orange-100 text-orange-700" : "border-slate-200 text-slate-500")}>
                  ⛔ לא הגיע
                </button>
              </div>
              {/* Always show check details — for received OR for editing existing */}
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-600">תאריך השייק בפועל</label>
                  <input type="date" value={editModal.date} onChange={function (e) { setEditModal({ ...editModal, date: e.target.value }); }} className={ic} />
                  <div className="text-[10px] text-slate-400 mt-0.5">אם שונה מהתאריך הנדרש</div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-600">סכום בפועל (₪)</label>
                  <input type="number" step="0.01" value={editModal.amount} onChange={function (e) { setEditModal({ ...editModal, amount: Number(e.target.value) }); }} className={ic} />
                  <div className="text-[10px] text-slate-400 mt-0.5">אם שונה מהסכום הנדרש</div>
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-slate-600">מס׳ שייק</label>
                  <input type="text" value={editModal.checkNum} onChange={function (e) { setEditModal({ ...editModal, checkNum: e.target.value }); }} className={ic} placeholder="0001234" />
                </div>
              </div>
            </div>

            {/* Stage 2: Clearing (only if received) */}
            {editModal.status === "received" && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 space-y-3">
                <div className="text-xs font-bold text-blue-700">🏦 שלב 2 — פדיון בבנק</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <button type="button" onClick={function () { setEditModal({ ...editModal, clearingStatus: "" }); }}
                    className={"rounded-lg border px-3 py-2 text-xs font-bold " + (!editModal.clearingStatus ? "border-slate-500 bg-slate-100 text-slate-700" : "border-slate-200 text-slate-500")}>
                    ⏳ טרם הופקד
                  </button>
                  <button type="button" onClick={function () { setEditModal({ ...editModal, clearingStatus: "cleared", clearingDate: editModal.clearingDate || new Date().toISOString().split("T")[0] }); }}
                    className={"rounded-lg border px-3 py-2 text-xs font-bold " + (editModal.clearingStatus === "cleared" ? "border-green-500 bg-green-100 text-green-700" : "border-slate-200 text-slate-500")}>
                    ✅ נפדה
                  </button>
                  <button type="button" onClick={function () { setEditModal({ ...editModal, clearingStatus: "bounced" }); }}
                    className={"rounded-lg border px-3 py-2 text-xs font-bold " + (editModal.clearingStatus === "bounced" ? "border-red-500 bg-red-100 text-red-700" : "border-slate-200 text-slate-500")}>
                    ❌ לא נפדה
                  </button>
                </div>
                {(editModal.clearingStatus === "cleared" || editModal.clearingStatus === "bounced") && (
                  <div>
                    <label className="mb-1 block text-xs text-slate-600">תאריך {editModal.clearingStatus === "cleared" ? "פדיון" : "ניסיון פדיון"}</label>
                    <input type="date" value={editModal.clearingDate} onChange={function (e) { setEditModal({ ...editModal, clearingDate: e.target.value }); }} className={ic} />
                  </div>
                )}
              </div>
            )}

            {/* Debt handling — for not_received OR bounced */}
            {(editModal.status === "not_received" || editModal.clearingStatus === "bounced") && (
              <div className="rounded-lg border border-red-200 bg-red-50/30 p-3 space-y-3">
                <div className="text-xs font-bold text-red-700">⚠️ טיפול בחוב</div>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={editModal.waived} onChange={function (e) { setEditModal({ ...editModal, waived: e.target.checked }); }} className="mt-0.5" />
                    <div>
                      <div className="text-xs font-bold text-slate-700">🤝 ויתור על השייק</div>
                      <div className="text-xs text-slate-500">המנהל ויתר על תשלום זה. לא ייכלל בחישוב חובות סוף שנה.</div>
                    </div>
                  </label>
                  {!editModal.waived && (
                    <>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" checked={editModal.chargeCpiDiff} onChange={function (e) { setEditModal({ ...editModal, chargeCpiDiff: e.target.checked }); }} className="mt-0.5" />
                        <div>
                          <div className="text-xs font-bold text-slate-700">📈 חיוב הפרשי הצמדה</div>
                          <div className="text-xs text-slate-500">הפרש מדד מתאריך השייק עד תאריך תשלום בפועל.</div>
                        </div>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" checked={editModal.chargeInterest} onChange={function (e) { setEditModal({ ...editModal, chargeInterest: e.target.checked }); }} className="mt-0.5" />
                        <div>
                          <div className="text-xs font-bold text-slate-700">💰 חיוב ריבית פיגורים</div>
                          <div className="text-xs text-slate-500">בנוסף להצמדה — לפי אחוז שנתי.</div>
                        </div>
                      </label>
                      {editModal.chargeInterest && (
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">אחוז ריבית שנתית (%)</label>
                          <input type="number" step="0.1" value={editModal.interestPct} onChange={function (e) { setEditModal({ ...editModal, interestPct: e.target.value }); }} className={ic} placeholder="לדוגמה: 5" />
                          <div className="text-xs text-slate-400 mt-0.5">תחושב מתאריך הנדרש עד תאריך תשלום בפועל</div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            <button onClick={saveCheckEdit} disabled={editSaving}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              {editSaving ? "שומר..." : "💾 שמור שינויים"}
            </button>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setShowAddModal(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4" onClick={function (e) { e.stopPropagation(); }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold text-slate-800">➕ הוספת שייקים ידנית</h3>
              <button onClick={function () { setShowAddModal(false); }} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">חוזה / שוכר</label>
              <select value={addContractId} onChange={function (e) { setAddContractId(e.target.value); setAddSpaceId(""); }} className={ic}>
                <option value="">בחר חוזה...</option>
                {addContracts.map(function (c: any) {
                  return <option key={c.id} value={c.id}>{(c.tenants as any)?.name || "—"}</option>;
                })}
              </select>
            </div>

            {addContractId && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">יחידה</label>
                <select value={addSpaceId} onChange={function (e) { setAddSpaceId(e.target.value); }} className={ic}>
                  <option value="">בחר יחידה...</option>
                  {(addContracts.find(function (c: any) { return c.id === addContractId; })?.contract_spaces || []).map(function (cs: any) {
                    return <option key={cs.space_id} value={cs.space_id}>{cs.spaces?.space_name || cs.space_id} ({cs.spaces?.area || 0} מ&quot;ר)</option>;
                  })}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מחודש</label>
                <input type="number" min="1" max="12" value={addPeriodStart} onChange={function (e) { setAddPeriodStart(e.target.value); }} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">עד חודש</label>
                <input type="number" min="1" max="12" value={addPeriodEnd} onChange={function (e) { setAddPeriodEnd(e.target.value); }} className={ic} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שכ&quot;ד צמוד (₪/חודש)</label>
                <input type="number" value={addRent} onChange={function (e) { setAddRent(e.target.value); }} className={ic} placeholder="0" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">מקדמת ד.נ. (₪/חודש)</label>
                <input type="number" value={addMgmt} onChange={function (e) { setAddMgmt(e.target.value); }} className={ic} placeholder="0" />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">מע&quot;מ</label>
              <select value={addVatType} onChange={function (e) { setAddVatType(e.target.value); }} className={ic}>
                <option value="taxable">חייב ({Math.round(vatPctLabel*100)}%)</option>
                <option value="exempt">פטור</option>
              </select>
            </div>

            <button onClick={saveManualAdvance} disabled={addSaving}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              {addSaving ? "שומר..." : "➕ הוסף שייקים"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
