"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

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
  const [filterTenant, setFilterTenant] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCheckNum, setEditCheckNum] = useState("");
  const [editNotes, setEditNotes] = useState("");

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

  async function loadAdvances() {
    setLoading(true);
    var { data } = await supabase.from("advance_payments")
      .select("*")
      .eq("property_id", propId)
      .eq("year", year)
      .order("tenant_name")
      .order("space_name")
      .order("check_date");
    setAdvances(data ?? []);
    setLoading(false);
  }

  async function toggleReceived(id: string, currentStatus: string) {
    var newStatus = currentStatus === "received" ? "pending" : "received";
    var update: any = { status: newStatus };
    if (newStatus === "received") update.received_date = new Date().toISOString().split("T")[0];
    else update.received_date = null;
    await supabase.from("advance_payments").update(update).eq("id", id);
    loadAdvances();
  }

  async function saveCheckDetails(id: string) {
    await supabase.from("advance_payments").update({
      check_number: editCheckNum || null,
      notes: editNotes || null,
    }).eq("id", id);
    setEditingId(null);
    loadAdvances();
  }

  async function deleteAdvance(id: string) {
    if (!confirm("למחוק מקדמה זו?")) return;
    await supabase.from("advance_payments").delete().eq("id", id);
    loadAdvances();
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
      var vatPct = addVatType === "taxable" ? 0.18 : 0;
      var rent = Number(addRent) || 0;
      var mgmt = Number(addMgmt) || 0;
      var startM = Number(addPeriodStart) || 1;
      var endM = Number(addPeriodEnd) || 12;

      var inserts = [];
      for (var m = startM; m <= endM; m++) {
        var totalBV = rent + mgmt;
        var vat = totalBV * vatPct;
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

  // Group by tenant+space
  var grouped: Record<string, any[]> = {};
  var filtered = advances.filter(function (a) {
    if (filterTenant !== "all" && a.tenant_name !== filterTenant) return false;
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    return true;
  });
  filtered.forEach(function (a) {
    var key = (a.tenant_name || "—") + " — " + (a.space_name || "—");
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(a);
  });

  var tenantNames = Array.from(new Set(advances.map(function (a) { return a.tenant_name || "—"; }))).sort();

  // KPIs
  var totalAmount = advances.reduce(function (s, a) { return s + Number(a.total_with_vat || 0); }, 0);
  var receivedAmount = advances.filter(function (a) { return a.status === "received"; }).reduce(function (s, a) { return s + Number(a.total_with_vat || 0); }, 0);
  var pendingAmount = totalAmount - receivedAmount;
  var receivedCount = advances.filter(function (a) { return a.status === "received"; }).length;

  var ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid grid-cols-4 gap-3">
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
            <option value="pending">ממתין</option>
            <option value="received">התקבל</option>
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-center">
          <div className="text-lg font-black text-blue-800">{advances.length}</div>
          <div className="text-xs text-blue-600">סה&quot;כ שייקים</div>
        </div>
        <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-center">
          <div className="text-lg font-black text-green-800">{fmtMoney(totalAmount)}</div>
          <div className="text-xs text-green-600">סה&quot;כ מקדמות</div>
        </div>
        <div className="rounded-xl bg-teal-50 border border-teal-200 p-3 text-center">
          <div className="text-lg font-black text-teal-800">{fmtMoney(receivedAmount)}</div>
          <div className="text-xs text-teal-600">התקבלו ({receivedCount})</div>
        </div>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-center">
          <div className="text-lg font-black text-amber-800">{fmtMoney(pendingAmount)}</div>
          <div className="text-xs text-amber-600">ממתינים ({advances.length - receivedCount})</div>
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
          {Object.entries(grouped).map(function ([groupKey, items]) {
            var groupTotal = items.reduce(function (s, a) { return s + Number(a.total_with_vat || 0); }, 0);
            var groupReceived = items.filter(function (a) { return a.status === "received"; }).length;
            return (
              <div key={groupKey} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b flex items-center justify-between">
                  <div>
                    <span className="font-bold text-sm text-slate-800">{groupKey}</span>
                    <span className="text-xs text-slate-400 mr-2">{items.length} שייקים | {fmtMoney(groupTotal)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-green-600 font-semibold">{groupReceived} התקבלו</span>
                    <span className="text-slate-400 mx-1">|</span>
                    <span className="text-amber-600 font-semibold">{items.length - groupReceived} ממתינים</span>
                  </div>
                </div>
                <table className="w-full text-sm text-right">
                  <thead className="bg-slate-50 text-xs text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-semibold">תקופה</th>
                      <th className="px-3 py-2 font-semibold">תאריך שייק</th>
                      <th className="px-3 py-2 font-semibold">שכ&quot;ד צמוד</th>
                      <th className="px-3 py-2 font-semibold">ד.נ.</th>
                      <th className="px-3 py-2 font-semibold">לפני מע&quot;מ</th>
                      <th className="px-3 py-2 font-semibold">מע&quot;מ</th>
                      <th className="px-3 py-2 font-semibold">סכום שייק</th>
                      <th className="px-3 py-2 font-semibold">מס׳ שייק</th>
                      <th className="px-3 py-2 font-semibold w-24">סטטוס</th>
                      <th className="px-3 py-2 font-semibold w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(function (a) {
                      var isEditing = editingId === a.id;
                      return (
                        <tr key={a.id} className={"border-t border-slate-100 " + (a.status === "received" ? "bg-green-50/50" : "hover:bg-slate-50")}>
                          <td className="px-3 py-2 font-medium text-slate-700">{a.period}</td>
                          <td className="px-3 py-2 text-slate-600">{fmtDate(a.check_date)}</td>
                          <td className="px-3 py-2 text-green-700 font-semibold">{fmtMoney(a.indexed_rent)}</td>
                          <td className="px-3 py-2 text-slate-600">{fmtMoney(a.management_advance)}</td>
                          <td className="px-3 py-2">{fmtMoney(a.total_before_vat)}</td>
                          <td className="px-3 py-2 text-slate-500">{fmtMoney(a.vat_amount)}</td>
                          <td className="px-3 py-2 font-bold text-blue-700">{fmtMoney(a.total_with_vat)}</td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <input type="text" value={editCheckNum} onChange={function (e) { setEditCheckNum(e.target.value); }}
                                className="w-20 rounded border border-slate-300 px-1 py-0.5 text-xs" placeholder="מספר" />
                            ) : (
                              <span className="text-xs text-slate-500">{a.check_number || "—"}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={function () { toggleReceived(a.id, a.status); }}
                              className={"rounded-full px-2.5 py-1 text-xs font-bold transition-all " +
                                (a.status === "received"
                                  ? "bg-green-100 text-green-700 border border-green-300"
                                  : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-green-50 hover:text-green-600")}>
                              {a.status === "received" ? "✅ התקבל" : "☐ ממתין"}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              {isEditing ? (
                                <button onClick={function () { saveCheckDetails(a.id); }}
                                  className="text-xs text-blue-600 hover:text-blue-800">💾</button>
                              ) : (
                                <button onClick={function () { setEditingId(a.id); setEditCheckNum(a.check_number || ""); setEditNotes(a.notes || ""); }}
                                  className="text-xs text-slate-400 hover:text-slate-600">✏️</button>
                              )}
                              <button onClick={function () { deleteAdvance(a.id); }}
                                className="text-xs text-red-400 hover:text-red-600">🗑</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={function () { setShowAddModal(false); }}>
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
                <option value="taxable">חייב (18%)</option>
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
