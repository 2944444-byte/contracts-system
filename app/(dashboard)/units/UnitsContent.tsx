
"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const SPACE_TYPES = [
  { v: "office", l: "משרדים", icon: "💼" },
  { v: "retail", l: "מסחר", icon: "🏪" },
  { v: "store", l: "חנות", icon: "🏬" },
  { v: "warehouse", l: "מחסן", icon: "📦" },
  { v: "industrial", l: "תעשיה", icon: "🏭" },
  { v: "yard", l: "חצר פתוחה", icon: "🌳" },
  { v: "other", l: "אחר", icon: "📋" },
];

/** Map legacy DB values to canonical keys */
function normalizeSpaceType(raw: string | null | undefined): string {
  if (!raw) return "";
  if (raw === "store") return "retail";
  return raw;
}

function spaceTypeLabel(raw: string | null | undefined): string {
  const key = normalizeSpaceType(raw);
  const found = SPACE_TYPES.find((t) => t.v === key);
  return found ? `${found.icon} ${found.l}` : raw ?? "";
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  vacant:        { label: "פנוי",         color: "text-red-700",    bg: "bg-red-100 border-red-200" },
  occupied:      { label: "תפוס",         color: "text-green-700",  bg: "bg-green-100 border-green-200" },
  reserved:      { label: "שמור (עתידי)", color: "text-blue-700",   bg: "bg-blue-100 border-blue-200" },
  future_vacant: { label: "מתפנה בקרוב", color: "text-orange-700", bg: "bg-orange-100 border-orange-200" },
};

function fmtNum(n: number): string {
  return n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function UnitsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [properties, setProperties] = useState<any[]>([]);
  const [spaces, setSpaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPropertyId, setSelectedPropertyId] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editUnit, setEditUnit] = useState<any>(null);
  const [selectedUnit, setSelectedUnit] = useState<any>(null);
  const [unitContract, setUnitContract] = useState<any>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({
    property_id: "",
    space_name: "",
    area: "",
    space_type: "",
    floor: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const ic =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

  async function load() {
    const [{ data: props }, { data: spaceData }, { data: contractSpaces }] = await Promise.all([
      supabase.from("properties").select("id, name, total_area"),
      supabase.from("spaces").select("*, properties(name, total_area)"),
      supabase
        .from("contract_spaces")
        .select("space_id, contracts(id, status, is_amendment, parent_contract_id, amendment_number, amendment_date, start_date, end_date, tenants(name, contact_phone, contact_email), rent_per_sqm, charged_area)"),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Group contract_spaces by the specific contract row (base OR amendment),
    // collecting the unit set each row holds.
    const byContract: Record<string, { contract: any; spaceIds: Set<string> }> = {};
    (contractSpaces ?? []).forEach((cs: any) => {
      const c = cs.contracts;
      if (!c) return;
      if (!byContract[c.id]) byContract[c.id] = { contract: c, spaceIds: new Set() };
      byContract[c.id].spaceIds.add(cs.space_id);
    });

    // Group rows into contract families (parent or self). Amendments are
    // sequential snapshots; the CURRENT unit set is the latest snapshot's, so a
    // swapped unit follows the latest amendment (e.g. Golf 2026 → חנות 4, while
    // חנות 6 moved to Yehonatan), instead of the stale original base rows.
    const families: Record<string, Array<{ contract: any; spaceIds: Set<string> }>> = {};
    Object.keys(byContract).forEach((cid) => {
      const entry = byContract[cid];
      const fid = entry.contract.parent_contract_id || entry.contract.id;
      if (!families[fid]) families[fid] = [];
      families[fid].push(entry);
    });

    // space_id → holder (the family's BASE contract, for status/tenant/dates).
    const spaceHolder: Record<string, any> = {};
    Object.keys(families).forEach((fid) => {
      const snaps = families[fid];
      const baseEntry = snaps.find((s) => !s.contract.is_amendment) || snaps[0];
      // "Latest" snapshot = the one that took effect last. Rank by effective
      // date (amendment_date, else start_date) and break ties by amendment_number.
      const rank = function (e: any): number {
        const c = e.contract;
        const dt = c.amendment_date || c.start_date;
        const t = dt ? new Date(dt).getTime() : 0;
        return t * 1000 + (c.amendment_number || 0);
      };
      const latest = snaps.slice().sort(function (a, b) { return rank(a) - rank(b); })[snaps.length - 1];
      const holder = baseEntry.contract;
      const holderActive = holder.status === "active" || holder.status === "upcoming";
      latest.spaceIds.forEach((sid) => {
        const existing = spaceHolder[sid];
        const existingActive = existing && (existing.status === "active" || existing.status === "upcoming");
        if (!existing || (holderActive && !existingActive)) spaceHolder[sid] = holder;
      });
    });

    const enriched = (spaceData ?? []).map((space: any) => {
      const holder = spaceHolder[space.id];
      let status = "vacant";
      let tenant = null;
      let leaseInfo = null;

      if (holder && holder.status === "active") {
        const endDate = new Date(holder.end_date);
        const daysLeft = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        status = daysLeft <= 60 ? "future_vacant" : "occupied";
        tenant = holder.tenants;
        leaseInfo = holder;
      } else if (holder && holder.status === "upcoming") {
        status = "reserved";
        tenant = holder.tenants;
        leaseInfo = holder;
      }

      return { ...space, computedStatus: status, tenant, leaseInfo };
    });

    setProperties(props ?? []);
    setSpaces(enriched);
    setLoading(false);
  }

  useEffect(() => {
    load().then(() => {
      const pid = searchParams.get("propertyId");
      if (pid) {
        setForm((f) => ({ ...f, property_id: pid }));
        setShowForm(true);
      }
    });
  }, []);

  /* ---------- Filtering ---------- */
  const filtered = spaces.filter((u) => {
    const matchProp = selectedPropertyId === "all" || u.property_id === selectedPropertyId;
    const matchStatus = selectedStatus === "all" || u.computedStatus === selectedStatus;
    const matchSearch =
      !search ||
      u.space_name?.includes(search) ||
      u.properties?.name?.includes(search);
    return matchProp && matchStatus && matchSearch;
  });

  /* ---------- Group by property ---------- */
  const grouped: Record<string, any[]> = {};
  for (const sp of filtered) {
    const pid = sp.property_id ?? "_none";
    if (!grouped[pid]) grouped[pid] = [];
    grouped[pid].push(sp);
  }

  /* ---------- Stats ---------- */
  const totalArea = spaces.reduce((s, u) => s + (Number(u.area) || 0), 0);
  const occupiedSpaces = spaces.filter((u) => u.computedStatus === "occupied" || u.computedStatus === "future_vacant");
  const rentedArea = occupiedSpaces.reduce((s, u) => s + (Number(u.area) || 0), 0);
  const vacantCount = spaces.filter((u) => u.computedStatus === "vacant").length;
  const occupiedCount = spaces.filter((u) => u.computedStatus !== "vacant").length;
  const vacantPct = spaces.length > 0 ? Math.round((vacantCount / spaces.length) * 100) : 0;
  const occupiedPct = spaces.length > 0 ? Math.round((occupiedCount / spaces.length) * 100) : 0;

  /* ---------- Form helpers ---------- */
  function openNew() {
    setEditUnit(null);
    setForm({
      property_id: properties[0]?.id ?? "",
      space_name: "",
      area: "",
      space_type: "",
      floor: "",
      notes: "",
    });
    setShowForm(true);
  }

  function openEdit(u: any) {
    setEditUnit(u);
    setForm({
      property_id: u.property_id,
      space_name: u.space_name ?? "",
      area: u.area?.toString() ?? "",
      space_type: normalizeSpaceType(u.space_type),
      floor: u.floor?.toString() ?? "",
      notes: u.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.space_name || !form.property_id) {
      alert("שם ונכס הם חובה");
      return;
    }
    setSaving(true);
    const payload: any = {
      property_id: form.property_id,
      space_name: form.space_name,
      space_type: form.space_type || null,
      area: Number(form.area) || 0,
      floor: form.floor ? Number(form.floor) : null,
      notes: form.notes || null,
    };
    const res = editUnit
      ? await supabase.from("spaces").update(payload).eq("id", editUnit.id)
      : await supabase.from("spaces").insert(payload);
    if (res.error) {
      setSaving(false);
      alert("שגיאה בשמירה: " + res.error.message);
      return;
    }
    setSaving(false);
    setShowForm(false);
    setEditUnit(null);
    await load();
  }

  async function handleDelete(id: string) {
    const { data: linkedContracts } = await supabase
      .from("contract_spaces")
      .select("contract_id")
      .eq("space_id", id);
    const cIds = Array.from(new Set((linkedContracts || []).map((r: any) => r.contract_id)));
    const msg =
      cIds.length > 0
        ? `למחוק יחידה זו? פעולה זו תמחק גם ${cIds.length} חוזים וכל הנתונים הקשורים אליהם!`
        : "למחוק יחידה זו?";
    if (!confirm(msg)) return;
    try {
      if (cIds.length > 0) {
        await supabase.from("charges").delete().in("contract_id", cIds);
        await supabase.from("contract_spaces").delete().in("contract_id", cIds);
        await supabase.from("contract_options").delete().in("contract_id", cIds);
        await supabase.from("contract_price_tiers").delete().in("contract_id", cIds);
        await supabase.from("guarantees").delete().in("contract_id", cIds);
        await supabase.from("insurances_tenant").delete().in("contract_id", cIds);
        await supabase.from("letters").delete().in("contract_id", cIds);
        await supabase.from("contracts").delete().in("id", cIds);
      }
      await supabase.from("spaces").delete().eq("id", id);
      setSelectedUnit(null);
      await load();
    } catch (e: any) {
      alert("שגיאה במחיקה: " + e?.message);
    }
  }

  function toggleGroup(pid: string) {
    setCollapsedGroups((prev) => ({ ...prev, [pid]: !prev[pid] }));
  }

  /* ---------- Render ---------- */
  return (
    <div dir="rtl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">יחידות</h1>
          <p className="text-sm text-slate-500 mt-1">נהל את כל היחידות בנכסים שלך</p>
        </div>
        <button
          onClick={openNew}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800"
        >
          + יחידה חדשה
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'שטח כולל (מ"ר)', value: fmtNum(totalArea), cls: "text-slate-800" },
          { label: 'שטח מושכר (מ"ר)', value: fmtNum(rentedArea), cls: "text-green-600" },
          { label: "פנויות", value: `${vacantCount} (${vacantPct}%)`, cls: "text-red-600" },
          { label: "תפוסות", value: `${occupiedCount} (${occupiedPct}%)`, cls: "text-green-600" },
        ].map((s, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-center">
            <div className={`text-2xl font-bold ${s.cls}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש..."
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 flex-1 min-w-48"
        />
        <select
          value={selectedPropertyId}
          onChange={(e) => setSelectedPropertyId(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm focus:outline-none"
        >
          <option value="all">כל הנכסים ({spaces.length})</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm focus:outline-none"
        >
          <option value="all">כל הסטטוסים</option>
          {Object.entries(statusConfig).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      {/* Grouped cards */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <div className="text-4xl mb-2">🏠</div>
          <div>{search ? "לא נמצאו יחידות" : "אין יחידות עדיין"}</div>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([pid, groupSpaces]) => {
            const prop = properties.find((p) => p.id === pid);
            const propName = prop?.name ?? "ללא נכס";
            const propTotalArea = Number(prop?.total_area) || 0;
            const groupAreaSum = groupSpaces.reduce((s, u) => s + (Number(u.area) || 0), 0);
            const isCollapsed = collapsedGroups[pid] ?? false;

            return (
              <div key={pid} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(pid)}
                  className="w-full flex items-center justify-between px-5 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-right"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-sm">{isCollapsed ? "◀" : "▼"}</span>
                    <span className="font-bold text-slate-800 text-base">{propName}</span>
                    <span className="text-sm text-slate-500">
                      — שטח כולל: {fmtNum(propTotalArea)} מ&quot;ר | שטח יחידות: {fmtNum(groupAreaSum)} מ&quot;ר
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">{groupSpaces.length} יחידות</span>
                </button>

                {/* Cards grid */}
                {!isCollapsed && (
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {groupSpaces.map((unit) => {
                      const sc = statusConfig[unit.computedStatus] ?? statusConfig.vacant;
                      return (
                        <div
                          key={unit.id}
                          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col gap-2"
                          onClick={() => {
                            setSelectedUnit(unit);
                            setUnitContract(unit.leaseInfo);
                          }}
                        >
                          {/* Name + status */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-bold text-slate-800 text-base leading-tight">
                              {unit.space_name}
                            </div>
                            <span
                              className={`rounded-full border px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${sc.bg} ${sc.color}`}
                            >
                              {sc.label}
                            </span>
                          </div>

                          {/* Type */}
                          {unit.space_type && (
                            <div className="text-sm text-slate-600">
                              {spaceTypeLabel(unit.space_type)}
                            </div>
                          )}

                          {/* Property name */}
                          <div className="text-xs text-slate-400">{unit.properties?.name}</div>

                          {/* Area + floor */}
                          <div className="flex items-center gap-3 text-sm text-slate-600">
                            {unit.area != null && (
                              <span className="font-medium">{fmtNum(Number(unit.area))} מ&quot;ר</span>
                            )}
                            {unit.floor != null && <span>קומה {unit.floor}</span>}
                          </div>

                          {/* Tenant */}
                          {unit.tenant && (
                            <div className="text-sm font-medium text-blue-600 truncate">
                              👤 {unit.tenant.name}
                            </div>
                          )}

                          {/* Edit button */}
                          <div className="mt-auto pt-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => openEdit(unit)}
                              className="text-xs border border-slate-200 rounded px-2.5 py-1 text-slate-500 hover:text-blue-600 hover:border-blue-200"
                            >
                              עריכה
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Side panel */}
      {selectedUnit && (
        <div
          className="fixed inset-y-0 left-0 w-96 bg-white border-r border-slate-200 shadow-xl z-40 overflow-y-auto"
          dir="rtl"
        >
          <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-3">
            <button onClick={() => setSelectedUnit(null)} className="text-slate-400 hover:text-slate-700 text-xl">
              ←
            </button>
            <div className="flex-1">
              <div className="font-bold text-slate-800">{selectedUnit.space_name}</div>
              <div className="text-xs text-slate-400">{selectedUnit.properties?.name}</div>
            </div>
            <button onClick={() => setSelectedUnit(null)} className="text-2xl text-slate-400">
              &times;
            </button>
          </div>
          <div className="p-6 space-y-4">
            {/* Space details */}
            <div className="rounded-xl bg-slate-50 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">סטטוס</span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusConfig[selectedUnit.computedStatus]?.bg} ${statusConfig[selectedUnit.computedStatus]?.color}`}
                >
                  {statusConfig[selectedUnit.computedStatus]?.label}
                </span>
              </div>
              {selectedUnit.area && (
                <div className="flex justify-between">
                  <span className="text-slate-500">שטח</span>
                  <span className="font-medium">{fmtNum(Number(selectedUnit.area))} מ&quot;ר</span>
                </div>
              )}
              {selectedUnit.floor != null && (
                <div className="flex justify-between">
                  <span className="text-slate-500">קומה</span>
                  <span className="font-medium">{selectedUnit.floor}</span>
                </div>
              )}
              {selectedUnit.space_type && (
                <div className="flex justify-between">
                  <span className="text-slate-500">סוג שימוש</span>
                  <span className="font-medium">{spaceTypeLabel(selectedUnit.space_type)}</span>
                </div>
              )}
              {selectedUnit.notes && (
                <div className="text-xs text-slate-400 pt-1 border-t border-slate-200">
                  {selectedUnit.notes}
                </div>
              )}
            </div>

            {/* Tenant / contract info */}
            {selectedUnit.computedStatus === "vacant" ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 p-5 text-center">
                <div className="text-3xl mb-2">📭</div>
                <div className="font-medium text-slate-600 mb-3">יחידה פנויה</div>
                <button
                  onClick={() => router.push("/contracts/new")}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
                >
                  + הוסף חוזה
                </button>
              </div>
            ) : (
              unitContract && (
                <div className="space-y-3">
                  <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm space-y-1.5">
                    <div className="font-bold text-blue-800 mb-2">👤 {selectedUnit.tenant?.name}</div>
                    {selectedUnit.tenant?.contact_phone && (
                      <div className="flex justify-between">
                        <span className="text-blue-600">טלפון</span>
                        <a href={"tel:" + selectedUnit.tenant.contact_phone} className="font-medium">
                          {selectedUnit.tenant.contact_phone}
                        </a>
                      </div>
                    )}
                    {selectedUnit.tenant?.contact_email && (
                      <div className="flex justify-between">
                        <span className="text-blue-600">אימייל</span>
                        <span className="text-xs">{selectedUnit.tenant.contact_email}</span>
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4 text-sm space-y-1.5">
                    <div className="font-medium text-slate-600 mb-1">📅 תקופה</div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">התחלה</span>
                      <span className="font-medium">{unitContract.start_date}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">סיום</span>
                      <span className="font-medium">{unitContract.end_date}</span>
                    </div>
                    {(() => {
                      const days = Math.ceil(
                        (new Date(unitContract.end_date).getTime() - new Date().getTime()) /
                          (1000 * 60 * 60 * 24)
                      );
                      return (
                        <div
                          className={`rounded-lg px-3 py-1.5 text-xs text-center font-medium mt-1 ${
                            days < 0
                              ? "bg-red-100 text-red-700"
                              : days < 60
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-green-100 text-green-700"
                          }`}
                        >
                          {days < 0 ? `פג לפני ${Math.abs(days)} ימים` : `${days} ימים לסיום`}
                        </div>
                      );
                    })()}
                  </div>
                  {unitContract.rent_per_sqm && (
                    <div className="rounded-xl bg-green-50 border border-green-100 p-4 text-sm space-y-1.5">
                      <div className="font-medium text-green-700 mb-1">💰 תשלום</div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">מחיר למ&quot;ר</span>
                        <span className="font-bold">₪{unitContract.rent_per_sqm}</span>
                      </div>
                      {unitContract.charged_area && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">שטח מחויב</span>
                          <span>{unitContract.charged_area} מ&quot;ר</span>
                        </div>
                      )}
                      <div className="border-t border-green-200 pt-1.5 flex justify-between">
                        <span className="font-bold text-green-700">חודשי</span>
                        <span className="font-bold text-green-700">
                          ₪{(unitContract.rent_per_sqm * unitContract.charged_area).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => openEdit(selectedUnit)}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                עריכה
              </button>
              <button
                onClick={() => handleDelete(selectedUnit.id)}
                className="rounded-lg border border-red-100 py-2 px-3 text-sm text-red-400 hover:bg-red-50"
              >
                מחיקה
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setShowForm(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-slate-800">
                {editUnit ? "עריכת יחידה" : "יחידה חדשה"}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-2xl text-slate-400">
                &times;
              </button>
            </div>
            <div className="space-y-4">
              {/* Property */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">נכס *</label>
                <select
                  value={form.property_id}
                  onChange={(e) => setForm((f) => ({ ...f, property_id: e.target.value }))}
                  className={ic}
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Name + floor */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">שם יחידה *</label>
                  <input
                    type="text"
                    value={form.space_name}
                    onChange={(e) => setForm((f) => ({ ...f, space_name: e.target.value }))}
                    placeholder='קומה 3 — A'
                    className={ic}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">קומה</label>
                  <input
                    type="number"
                    value={form.floor}
                    onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value }))}
                    placeholder="3"
                    className={ic}
                  />
                </div>
              </div>

              {/* Area */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">שטח מ&quot;ר</label>
                <input
                  type="number"
                  value={form.area}
                  onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                  placeholder="0"
                  className={ic}
                />
              </div>

              {/* Space type buttons */}
              <div>
                <label className="mb-2 block text-xs font-medium text-slate-600">סוג שימוש</label>
                <div className="grid grid-cols-3 gap-2">
                  {SPACE_TYPES.map((t) => (
                    <button
                      key={t.v}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, space_type: f.space_type === t.v ? "" : t.v }))}
                      className={`rounded-lg border px-3 py-2 text-sm text-center transition-colors ${
                        form.space_type === t.v
                          ? "border-blue-500 bg-blue-50 text-blue-700 font-bold"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {t.icon} {t.l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">הערות</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className={ic}
                  placeholder="הערות נוספות..."
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-slate-600 hover:bg-slate-50"
                >
                  ביטול
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {saving ? "שומר..." : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
