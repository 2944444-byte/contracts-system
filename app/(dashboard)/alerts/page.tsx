"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { logAudit } from "../../../lib/audit-log";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const SEVERITIES = [
  { v: "urgent",  l: "דחוף",   bg: "bg-red-100",    color: "text-red-700",    dot: "bg-red-500"    },
  { v: "warning", l: "אזהרה",  bg: "bg-yellow-100", color: "text-yellow-700", dot: "bg-yellow-500" },
  { v: "info",    l: "מידע",   bg: "bg-blue-100",   color: "text-blue-700",   dot: "bg-blue-500"   },
];

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("he-IL");
}

export default function AlertsPage() {
  const [alerts,   setAlerts]   = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [filterSt, setFilterSt] = useState("open");
  const [filterSv, setFilterSv] = useState("all");
  const [editingId,setEditingId]= useState("");
  const [isNew,    setIsNew]    = useState(false);
  const [saving,   setSaving]   = useState(false);

  const [fTitle,      setFTitle]      = useState("");
  const [fDesc,       setFDesc]       = useState("");
  const [fSeverity,   setFSeverity]   = useState("warning");
  const [fDueDate,    setFDueDate]    = useState("");
  const [fEntityType, setFEntityType] = useState("");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const { data } = await supabase.from("alerts")
      .select("*")
      .order("created_at", { ascending: false });
    setAlerts(data ?? []);
    setLoading(false);
  }

  function openNew() {
    setIsNew(true); setEditingId("new");
    setFTitle(""); setFDesc(""); setFSeverity("warning"); setFDueDate(""); setFEntityType("");
  }

  async function handleSave() {
    if (!fTitle.trim()) { alert("חובה: כותרת"); return; }
    setSaving(true);
    try {
      const payload = {
        title: fTitle.trim(), description: fDesc || null,
        severity: fSeverity, due_date: fDueDate || null,
        entity_type: fEntityType || null, status: "open",
      };
      if (isNew) {
        const { data } = await supabase.from("alerts").insert(payload).select().single();
        await logAudit({ entity_type: "alert", entity_id: data.id, action: "create" });
      } else {
        await supabase.from("alerts").update(payload).eq("id", editingId);
      }
      setEditingId("");
      await loadAll();
    } catch(e: any) { alert("שגיאה: " + e?.message); }
    finally { setSaving(false); }
  }

  async function closeAlert(id: string) {
    await supabase.from("alerts").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", id);
    await logAudit({ entity_type: "alert", entity_id: id, action: "close" });
    await loadAll();
  }

  async function bulkClose(ids: string[]) {
    for (const id of ids) {
      await supabase.from("alerts").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", id);
    }
    await loadAll();
  }

  async function deleteAlert(id: string) {
    if (!confirm("למחוק התראה?")) return;
    await supabase.from("alerts").delete().eq("id", id);
    await loadAll();
  }

  const filtered = alerts.filter(function(a) {
    const ms = filterSt === "all" || a.status === filterSt;
    const mv = filterSv === "all" || a.severity === filterSv;
    return ms && mv;
  });

  const openAlerts = alerts.filter(function(a) { return a.status === "open"; });
  const urgentCnt  = openAlerts.filter(function(a) { return a.severity === "urgent"; }).length;

  function sevInfo(v: string) {
    return SEVERITIES.find(function(s) { return s.v === v; }) ?? SEVERITIES[2];
  }

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">התראות</h1>
          <p className="text-sm text-slate-500 mt-1">
            {openAlerts.length} פתוחות
            {urgentCnt > 0 && <span className="text-red-600 font-bold"> | {urgentCnt} דחופות</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {openAlerts.length > 0 && (
            <button onClick={function() { bulkClose(openAlerts.map(function(a) { return a.id; })); }}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
              ✓ סגור הכל
            </button>
          )}
          <button onClick={openNew}
            className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">
            + התראה חדשה
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {SEVERITIES.map(function(s) {
          const cnt = openAlerts.filter(function(a) { return a.severity === s.v; }).length;
          return (
            <div key={s.v} className={"rounded-xl border p-4 " + s.bg}>
              <div className={"text-2xl font-black " + s.color}>{cnt}</div>
              <div className={"text-sm font-semibold " + s.color}>{s.l}</div>
            </div>
          );
        })}
      </div>

      {/* פילטרים */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { v: "open",   l: "פתוחות" },
          { v: "closed", l: "סגורות" },
          { v: "all",    l: "הכל"    },
        ].map(function(t) {
          return (
            <button key={t.v} onClick={function() { setFilterSt(t.v); }}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterSt === t.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
              {t.l}
            </button>
          );
        })}
        <div className="w-px bg-slate-200 mx-1" />
        {SEVERITIES.map(function(s) {
          return (
            <button key={s.v} onClick={function() { setFilterSv(filterSv === s.v ? "all" : s.v); }}
              className={"rounded-xl border px-3 py-1.5 text-xs font-semibold " +
                (filterSv === s.v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600")}>
              {s.l}
            </button>
          );
        })}
      </div>

      {/* רשימה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🔔</div>
          <div>אין התראות</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(function(a) {
            const si = sevInfo(a.severity);
            const isClosed = a.status === "closed";
            return (
              <div key={a.id}
                className={"rounded-xl border p-4 transition-all " +
                  (isClosed ? "border-slate-100 bg-slate-50 opacity-60" :
                    a.severity === "urgent" ? "border-red-200 bg-red-50" :
                    a.severity === "warning" ? "border-yellow-200 bg-yellow-50" :
                    "border-blue-200 bg-blue-50")}>
                <div className="flex items-start gap-3">
                  <div className={"w-2 h-2 rounded-full mt-1.5 shrink-0 " + si.dot} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm">{a.title}</span>
                      <span className={"text-xs px-1.5 py-0.5 rounded-full font-semibold " + si.bg + " " + si.color}>
                        {si.l}
                      </span>
                      {a.entity_type && (
                        <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                          {a.entity_type}
                        </span>
                      )}
                    </div>
                    {a.description && <div className="text-xs text-slate-600 mt-1">{a.description}</div>}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
                      <span>{fmtDate(a.created_at)}</span>
                      {a.due_date && <span className="text-orange-600">לטיפול עד: {fmtDate(a.due_date)}</span>}
                    </div>
                  </div>
                  {!isClosed && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={function() { closeAlert(a.id); }}
                        className="text-xs bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 font-semibold">
                        ✓ סגור
                      </button>
                      <button onClick={function() { deleteAlert(a.id); }}
                        className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">
                        🗑
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* מודל */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={function() { setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            onClick={function(e) { e.stopPropagation(); }} dir="rtl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-slate-800 text-lg">התראה חדשה</h2>
              <button onClick={function() { setEditingId(""); }} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">כותרת *</label>
                <input type="text" value={fTitle} onChange={function(e){setFTitle(e.target.value);}} className={ic} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">תיאור</label>
                <textarea value={fDesc} onChange={function(e){setFDesc(e.target.value);}} rows={2} className={ic} />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">עדיפות</label>
                <div className="grid grid-cols-3 gap-2">
                  {SEVERITIES.map(function(s) {
                    return (
                      <button key={s.v} type="button" onClick={function(){setFSeverity(s.v);}}
                        className={"rounded-lg border p-2 text-center " +
                          (fSeverity === s.v ? "border-blue-500 " + s.bg : "border-slate-200 hover:bg-slate-50")}>
                        <div className={"text-xs font-bold " + (fSeverity === s.v ? s.color : "text-slate-600")}>{s.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">תאריך טיפול</label>
                  <input type="date" value={fDueDate} onChange={function(e){setFDueDate(e.target.value);}} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">סוג ישות</label>
                  <input type="text" value={fEntityType} onChange={function(e){setFEntityType(e.target.value);}} className={ic} placeholder="contract, guarantee..." />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">
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
