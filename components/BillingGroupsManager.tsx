"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";
function fmtMoney(n: number) { return "₪" + (n ?? 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

interface Props {
  propertyId: string;
  year: number;
  groupType: "management" | "waste";
  onChange?: () => void;
}

interface Group {
  id: string;
  name: string;
  rate_per_sqm_monthly: number | null;
  annual_amount: number | null;
  notes: string | null;
  spaceIds: string[];
  totalArea: number;
}

export default function BillingGroupsManager({ propertyId, year, groupType, onChange }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [allSpaces, setAllSpaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Group | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [fName, setFName] = useState("");
  const [fRate, setFRate] = useState("");
  const [fAnnual, setFAnnual] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fSpaceIds, setFSpaceIds] = useState<string[]>([]);

  useEffect(() => {
    if (propertyId && year) loadAll();
  }, [propertyId, year, groupType]);

  async function loadAll() {
    setLoading(true);
    const [{ data: spaces }, { data: bgs }] = await Promise.all([
      supabase.from("spaces").select("id,space_name,area,space_type,status").eq("property_id", propertyId).order("space_name"),
      supabase.from("billing_groups")
        .select("*,billing_group_spaces(space_id)")
        .eq("property_id", propertyId)
        .eq("group_type", groupType)
        .eq("year", year),
    ]);
    setAllSpaces(spaces ?? []);
    const loadedGroups: Group[] = (bgs ?? []).map((g: any) => {
      const sids = (g.billing_group_spaces || []).map((x: any) => x.space_id);
      const totalArea = sids.reduce((s: number, sid: string) => {
        const sp = (spaces ?? []).find((x: any) => x.id === sid);
        return s + (Number(sp?.area) || 0);
      }, 0);
      return {
        id: g.id,
        name: g.name,
        rate_per_sqm_monthly: g.rate_per_sqm_monthly,
        annual_amount: g.annual_amount,
        notes: g.notes,
        spaceIds: sids,
        totalArea,
      };
    });
    setGroups(loadedGroups);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true);
    setEditing({ id: "", name: "", rate_per_sqm_monthly: null, annual_amount: null, notes: null, spaceIds: [], totalArea: 0 });
    setFName("");
    setFRate("");
    setFAnnual("");
    setFNotes("");
    setFSpaceIds([]);
  }

  function openEdit(g: Group) {
    setIsNew(false);
    setEditing(g);
    setFName(g.name);
    setFRate(g.rate_per_sqm_monthly ? String(g.rate_per_sqm_monthly) : "");
    setFAnnual(g.annual_amount ? String(g.annual_amount) : "");
    setFNotes(g.notes || "");
    setFSpaceIds([...g.spaceIds]);
  }

  function toggleSpace(sid: string) {
    setFSpaceIds((prev) => prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]);
  }

  // Auto-compute annual from rate × area × 12 (when rate is input)
  const editingTotalArea = fSpaceIds.reduce((s, sid) => {
    const sp = allSpaces.find((x) => x.id === sid);
    return s + (Number(sp?.area) || 0);
  }, 0);
  const computedAnnual = fRate && editingTotalArea > 0 ? Number(fRate) * editingTotalArea * 12 : 0;
  const computedRate = fAnnual && editingTotalArea > 0 ? Number(fAnnual) / editingTotalArea / 12 : 0;

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם הקבוצה"); return; }
    if (fSpaceIds.length === 0) { alert("יש לבחור לפחות יחידה אחת"); return; }
    if (!fRate && !fAnnual) { alert("יש להזין תעריף או סכום שנתי"); return; }
    // Validate no space is in another group of same type
    const conflicts: string[] = [];
    for (const sid of fSpaceIds) {
      const other = groups.find((g) => g.id !== editing?.id && g.spaceIds.includes(sid));
      if (other) {
        const sp = allSpaces.find((x) => x.id === sid);
        conflicts.push(`${sp?.space_name} (בקבוצה "${other.name}")`);
      }
    }
    if (conflicts.length > 0) {
      alert("יחידות כבר משויכות לקבוצה אחרת:\n" + conflicts.join("\n"));
      return;
    }

    setSaving(true);
    try {
      const rate = fRate ? Number(fRate) : (computedRate || null);
      const annual = fAnnual ? Number(fAnnual) : (computedAnnual || null);

      let groupId: string;
      if (isNew) {
        const { data, error } = await supabase.from("billing_groups").insert({
          property_id: propertyId,
          group_type: groupType,
          name: fName.trim(),
          year,
          rate_per_sqm_monthly: rate,
          annual_amount: annual,
          notes: fNotes || null,
        }).select().single();
        if (error) throw error;
        groupId = data.id;
      } else {
        groupId = editing!.id;
        await supabase.from("billing_groups").update({
          name: fName.trim(),
          rate_per_sqm_monthly: rate,
          annual_amount: annual,
          notes: fNotes || null,
        }).eq("id", groupId);
        // Remove old space links
        await supabase.from("billing_group_spaces").delete().eq("billing_group_id", groupId);
      }
      // Insert space links
      if (fSpaceIds.length > 0) {
        await supabase.from("billing_group_spaces").insert(
          fSpaceIds.map((sid) => ({ billing_group_id: groupId, space_id: sid }))
        );
      }
      setEditing(null);
      await loadAll();
      onChange?.();
    } catch (e: any) {
      alert("שגיאה: " + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק קבוצה? היחידות יחזרו למצב לא-משויך")) return;
    await supabase.from("billing_groups").delete().eq("id", id);
    await loadAll();
    onChange?.();
  }

  // Spaces not in any group for this property+type+year
  const allAssignedSpaceIds = new Set(groups.flatMap((g) => g.spaceIds));
  const unassignedSpaces = allSpaces.filter((s) => !allAssignedSpaceIds.has(s.id));

  const typeLabel = groupType === "management" ? "ניהול" : "אשפה";
  const typeColor = groupType === "management" ? "blue" : "orange";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-slate-700">קבוצות {typeLabel} ({groups.length})</div>
        <button onClick={openNew} className={"rounded-lg px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 " + (groupType === "management" ? "bg-blue-600" : "bg-orange-600")}>
          + קבוצה חדשה
        </button>
      </div>

      {loading ? (
        <div className="text-center py-4 text-slate-400 text-sm">טוען...</div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-slate-200 p-6 text-center text-slate-400 text-sm">
          אין קבוצות {typeLabel} מוגדרות. {groupType === "management" ? "ברירת מחדל: תעריף הנכס." : "יחידות לא יחויבו באשפה."}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const rateComputed = g.rate_per_sqm_monthly || (g.annual_amount && g.totalArea > 0 ? g.annual_amount / g.totalArea / 12 : 0);
            const annualComputed = g.annual_amount || (g.rate_per_sqm_monthly && g.totalArea > 0 ? g.rate_per_sqm_monthly * g.totalArea * 12 : 0);
            return (
              <div key={g.id} className={"rounded-lg border p-3 " + (groupType === "management" ? "border-blue-200 bg-blue-50/30" : "border-orange-200 bg-orange-50/30")}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-bold text-slate-800 text-sm">{g.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {g.spaceIds.length} יחידות | {g.totalArea.toLocaleString("he-IL")} מ&quot;ר
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(g)} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-white">✏️</button>
                    <button onClick={() => handleDelete(g.id)} className="text-xs border border-red-200 rounded px-2 py-1 text-red-500 hover:bg-red-50">🗑</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex justify-between bg-white rounded px-2 py-1">
                    <span className="text-slate-500">תעריף</span>
                    <span className="font-bold">{fmtMoney(rateComputed)}/מ&quot;ר/חו'</span>
                  </div>
                  <div className="flex justify-between bg-white rounded px-2 py-1">
                    <span className="text-slate-500">סכום שנתי</span>
                    <span className="font-bold">{fmtMoney(annualComputed)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Unassigned units visibility */}
      {!loading && unassignedSpaces.length > 0 && (
        <div className={"rounded-lg border p-3 " + (groupType === "waste" ? "border-red-200 bg-red-50/30" : "border-slate-200 bg-slate-50")}>
          <div className={"text-sm font-bold mb-2 " + (groupType === "waste" ? "text-red-700" : "text-slate-600")}>
            {groupType === "waste" ? "⚠️ יחידות לא משלמות אשפה" : "🏢 יחידות בתעריף ברירת מחדל"} ({unassignedSpaces.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unassignedSpaces.map((s) => (
              <span key={s.id} className="bg-white border border-slate-200 rounded px-2 py-0.5 text-xs text-slate-600">
                {s.space_name} ({s.area || 0} מ&quot;ר)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setEditing(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew ? "קבוצה חדשה" : "עריכת קבוצה"} — {typeLabel}</h2>
              <button onClick={() => setEditing(null)} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">שם הקבוצה *</label>
                <input type="text" value={fName} onChange={(e) => setFName(e.target.value)} className={ic}
                  placeholder={groupType === "management" ? "לדוגמה: מחסנים / משרדים" : "לדוגמה: אשפה רגילה / אשפה מיוחדת"} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תעריף (₪/מ&quot;ר/חודש)</label>
                  <input type="number" step="0.01" value={fRate}
                    onChange={(e) => { setFRate(e.target.value); if (e.target.value) setFAnnual(""); }}
                    className={ic} placeholder="0" />
                  {fAnnual && computedRate > 0 && <div className="text-xs text-slate-500 mt-1">מחושב: {fmtMoney(computedRate)}/מ&quot;ר</div>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סכום שנתי (₪)</label>
                  <input type="number" value={fAnnual}
                    onChange={(e) => { setFAnnual(e.target.value); if (e.target.value) setFRate(""); }}
                    className={ic} placeholder="0" />
                  {fRate && computedAnnual > 0 && <div className="text-xs text-slate-500 mt-1">מחושב: {fmtMoney(computedAnnual)}</div>}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-700">יחידות בקבוצה ({fSpaceIds.length} נבחרו, {editingTotalArea.toLocaleString("he-IL")} מ&quot;ר)</label>
                  <button type="button" onClick={() => {
                      // Select all unassigned (not in OTHER groups) + currently selected
                      const takenByOthers = new Set<string>();
                      for (const g of groups) {
                        if (g.id === editing?.id) continue;
                        g.spaceIds.forEach((sid) => takenByOthers.add(sid));
                      }
                      const available = allSpaces.filter((s) => !takenByOthers.has(s.id)).map((s) => s.id);
                      setFSpaceIds(fSpaceIds.length === available.length ? [] : available);
                    }}
                    className="text-xs text-blue-600 hover:underline">
                    {fSpaceIds.length > 0 ? "נקה הכל" : "בחר הכל הזמינים"}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto border border-slate-200 rounded-lg p-2">
                  {allSpaces.map((s) => {
                    const sel = fSpaceIds.includes(s.id);
                    // Find if it's in another group (not the one being edited)
                    const otherGroup = groups.find((g) => g.id !== editing?.id && g.spaceIds.includes(s.id));
                    const takenByOther = !!otherGroup;
                    return (
                      <button key={s.id} type="button"
                        onClick={() => { if (!takenByOther) toggleSpace(s.id); }}
                        disabled={takenByOther}
                        className={"rounded-lg border p-2 text-right text-xs transition-all " +
                          (takenByOther
                            ? "border-slate-200 bg-slate-100 opacity-60 cursor-not-allowed"
                            : sel ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-slate-50")}>
                        <div className="flex items-center justify-between">
                          <span>{s.space_name}</span>
                          <span className="text-slate-400">{s.area || 0} מ&quot;ר</span>
                        </div>
                        {takenByOther && (
                          <div className="text-[10px] text-slate-500 mt-0.5 italic">בקבוצה: {otherGroup!.name}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label>
                <input type="text" value={fNotes} onChange={(e) => setFNotes(e.target.value)} className={ic} />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditing(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
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
