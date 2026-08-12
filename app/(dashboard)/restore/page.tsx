"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui';
import { logAudit } from '@/lib/audit-log';
import { useAccess } from '@/components/AccessProvider';

// סל המיחזור — מסך לבעלי המערכת בלבד (masterOnly ב-ROUTE_RULES; גם ה-RLS על
// row_history מסתיר את הנתונים מכל אחד אחר). כל עדכון/מחיקה בטבלאות העסקיות
// נתפס בטריגר DB עם השורה המלאה שלפני השינוי; כאן צופים ומשחזרים.

const TABLE_HE: Record<string, string> = {
  contracts: "חוזים", tenants: "שוכרים", properties: "נכסים", spaces: "יחידות",
  contract_spaces: "יחידות בחוזה", contract_options: "אופציות", contract_price_tiers: "מדרגות מחיר",
  contract_ti: "השקעות בינוי", guarantees: "ביטחונות", insurances_tenant: "ביטוחי שוכר",
  charges: "חיובים", advance_payments: "מקדמות/שיקים", letters: "מכתבים",
  revenue_reports: "דיווחי פדיון", concessions: "ויתורים והנחות",
  billing_groups: "קבוצות חיוב", billing_group_spaces: "יחידות בקבוצת חיוב",
  billing_reconciliations: "התחשבנויות", mgmt_reconciliation_inputs: "קלטי התחשבנות ניהול",
  management_fees: "דמי ניהול", parking_subscriptions: "מנויי חניה",
  cpi_diff_calculations: "חישובי הצמדה", documents: "מסמכים", companies: "חברות",
  user_profiles: "משתמשים", user_property_access: "הרשאות נכס", user_company_access: "הרשאות חברה",
  cpi_records: "רשומות מדד", vat_rates: "שיעורי מע\"מ", safety_inspections: "בדיקות בטיחות",
};
const tblHe = function(t: string) { return TABLE_HE[t] || t; };

// Insert order for grouped restores: parents before children, so FK targets
// exist by the time the children arrive. Unlisted tables go in the middle.
const RESTORE_ORDER = ["companies", "properties", "spaces", "tenants", "contracts", "billing_groups"];
function orderKey(t: string): number { var i = RESTORE_ORDER.indexOf(t); return i === -1 ? RESTORE_ORDER.length : i; }

function rowLabel(r: any): string {
  var d = r.old_data || {};
  return d.tenant_name || d.name || d.full_name || d.company_name || d.space_name || d.title || d.email
    || (d.notes ? String(d.notes).slice(0, 40) : "") || (r.row_pk ? r.row_pk.slice(0, 8) : "—");
}
function fmtVal(v: any): string {
  if (v === null || v === undefined || v === "") return "ריק";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v).slice(0, 80);
}

interface HistoryEvent { txid: number; time: string; user: string; rows: any[]; }

export default function RestorePage() {
  const { access } = useAccess();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [openTx, setOpenTx] = useState<Record<string, boolean>>({});
  // filters
  const [fTable, setFTable] = useState("");
  const [fUser, setFUser] = useState("");
  const [fOp, setFOp] = useState("");
  const [fText, setFText] = useState("");

  useEffect(function() { load(); }, []);
  async function load() {
    setLoading(true);
    const { data } = await supabase.from("row_history")
      .select("*").order("id", { ascending: false }).limit(800);
    setRows(data ?? []);
    setLoading(false);
  }

  const isMaster = !!access?.profile?.is_master;

  const filtered = rows.filter(function(r) {
    if (fTable && r.table_name !== fTable) return false;
    if (fUser && (r.changed_by_email || "מערכת") !== fUser) return false;
    if (fOp && r.op !== fOp) return false;
    if (fText) {
      var hay = (JSON.stringify(r.old_data) + " " + r.table_name).toLowerCase();
      if (hay.indexOf(fText.toLowerCase()) === -1) return false;
    }
    return true;
  });

  // Group into events by txid (cascaded deletes share one transaction).
  const events: HistoryEvent[] = (function() {
    var map: Record<string, HistoryEvent> = {};
    var list: HistoryEvent[] = [];
    filtered.forEach(function(r) {
      var k = String(r.txid);
      if (!map[k]) { map[k] = { txid: r.txid, time: r.created_at, user: r.changed_by_email || "מערכת", rows: [] }; list.push(map[k]); }
      map[k].rows.push(r);
    });
    return list;
  })();

  const tables = Array.from(new Set(rows.map(function(r){ return r.table_name; }))).sort();
  const usersList = Array.from(new Set(rows.map(function(r){ return r.changed_by_email || "מערכת"; }))).sort();

  function showMsg(m: string) { setMsg(m); setTimeout(function(){ setMsg(""); }, 6000); }

  // Restore one event: deleted rows are re-inserted (parents first, with retry
  // rounds for FK ordering the static list doesn't know); updated rows get
  // their previous values written back.
  async function restoreEvent(ev: HistoryEvent) {
    if (!isMaster) return;
    var dels = ev.rows.filter(function(r){ return r.op === "DELETE"; });
    var upds = ev.rows.filter(function(r){ return r.op === "UPDATE"; });
    var what: string[] = [];
    if (dels.length) what.push("החזרת " + dels.length + " רשומות שנמחקו");
    if (upds.length) what.push("ביטול " + upds.length + " עדכונים (חזרה לערכים הקודמים)");
    if (!confirm("לשחזר?\n" + what.join("\n") + "\n\nהשחזור עצמו נרשם גם הוא בהיסטוריה.")) return;

    setBusy(true);
    var ok = 0; var errs: string[] = [];
    try {
      // deleted rows — parents first, then up to 3 retry rounds for the rest
      var pending = dels.slice().sort(function(a, b){ return orderKey(a.table_name) - orderKey(b.table_name); });
      for (var round = 0; round < 3 && pending.length > 0; round++) {
        var next: any[] = [];
        for (const r of pending) {
          const { error } = await supabase.from(r.table_name).insert(r.old_data);
          if (error) next.push({ ...r, _err: error.message }); else ok++;
        }
        pending = next;
      }
      pending.forEach(function(r){ errs.push(tblHe(r.table_name) + ": " + (r._err || "שגיאה")); });

      // updated rows — write the previous values back by pk
      for (const r of upds) {
        if (!r.row_pk) { errs.push(tblHe(r.table_name) + ": אין מזהה לשחזור"); continue; }
        const { error } = await supabase.from(r.table_name).update(r.old_data).eq("id", r.row_pk);
        if (error) errs.push(tblHe(r.table_name) + ": " + error.message); else ok++;
      }

      await logAudit({ entity_type: "system", entity_id: String(ev.txid), action: "restore_rows", notes: ok + " שוחזרו" + (errs.length ? ", " + errs.length + " נכשלו" : "") });
      showMsg(errs.length === 0 ? ("✅ שוחזרו " + ok + " רשומות") : ("שוחזרו " + ok + " · נכשלו " + errs.length + ":\n" + errs.join("\n")));
      await load();
    } catch (e: any) { showMsg("שגיאה: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  if (access && !isMaster) {
    return <div dir="rtl" className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400 mt-8">
      <div className="text-5xl mb-3">🔒</div>
      <div className="font-semibold text-slate-600">מסך השחזור זמין לבעלי המערכת בלבד</div>
    </div>;
  }

  return (
    <div dir="rtl">
      <PageHero title="שחזור נתונים" icon="🗄" tone="slate"
        subtitle="כל עדכון ומחיקה נשמרים 14 יום — וניתנים לשחזור מדויק" />

      {msg && <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800 whitespace-pre-line">{msg}</div>}

      {/* filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 mb-4 flex flex-wrap gap-2 items-center text-sm">
        <select value={fTable} onChange={function(e){ setFTable(e.target.value); }} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
          <option value="">כל הטבלאות</option>
          {tables.map(function(t){ return <option key={t} value={t}>{tblHe(t)}</option>; })}
        </select>
        <select value={fUser} onChange={function(e){ setFUser(e.target.value); }} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
          <option value="">כל המשתמשים</option>
          {usersList.map(function(u){ return <option key={u} value={u}>{u}</option>; })}
        </select>
        <select value={fOp} onChange={function(e){ setFOp(e.target.value); }} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
          <option value="">הכל</option>
          <option value="DELETE">מחיקות</option>
          <option value="UPDATE">עדכונים</option>
        </select>
        <input value={fText} onChange={function(e){ setFText(e.target.value); }} placeholder="חיפוש חופשי (שם שוכר, סכום...)"
          className="flex-1 min-w-[180px] rounded-lg border border-slate-200 px-3 py-1.5 text-xs" />
        <button onClick={load} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">🔄 רענן</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin"></span>טוען...</div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🗄</div>
          <div>אין שינויים בהיסטוריה{(fTable || fUser || fOp || fText) ? " (בסינון הנוכחי)" : " — כל עדכון או מחיקה מעכשיו יופיעו כאן"}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map(function(ev) {
            var hasDel = ev.rows.some(function(r){ return r.op === "DELETE"; });
            var main = ev.rows[0];
            var extra = ev.rows.length - 1;
            var open = !!openTx[String(ev.txid)];
            return (
              <div key={ev.txid + "-" + main.id} className={"rounded-xl border bg-white shadow-sm " + (hasDel ? "border-rose-200" : "border-slate-200")}>
                <button onClick={function(){ setOpenTx(function(p){ return { ...p, [String(ev.txid)]: !p[String(ev.txid)] }; }); }}
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 text-right">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="text-lg">{hasDel ? "🗑" : "✏️"}</span>
                    <span className={"font-bold " + (hasDel ? "text-rose-700" : "text-slate-700")}>
                      {hasDel ? "מחיקה" : "עדכון"} — {tblHe(main.table_name)}: {rowLabel(main)}
                    </span>
                    {extra > 0 && <span className="text-xs text-slate-400">+{extra} רשומות מקושרות</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0">
                    <span>{ev.user}</span>
                    <span dir="ltr">{new Date(ev.time).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{open ? "▲" : "▼"}</span>
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-3 space-y-2 border-t border-slate-100 pt-2">
                    {ev.rows.map(function(r) {
                      return (
                        <div key={r.id} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs">
                          <div className="font-semibold text-slate-700 mb-1">
                            {r.op === "DELETE" ? "🗑 נמחק" : "✏️ עודכן"} · {tblHe(r.table_name)} · {rowLabel(r)}
                          </div>
                          {r.op === "UPDATE" && (r.changed_cols || []).length > 0 ? (
                            <div className="space-y-0.5">
                              {(r.changed_cols || []).map(function(c: string) {
                                return <div key={c} className="flex gap-2"><span className="text-slate-400 min-w-[120px]" dir="ltr">{c}</span><span className="text-slate-600">היה: <b>{fmtVal(r.old_data?.[c])}</b></span></div>;
                              })}
                            </div>
                          ) : (
                            <div className="text-slate-500 leading-relaxed" dir="ltr">
                              {Object.keys(r.old_data || {}).filter(function(k){ var v = r.old_data[k]; return v !== null && v !== "" && typeof v !== "object"; }).slice(0, 8).map(function(k){ return k + ": " + fmtVal(r.old_data[k]); }).join(" · ")}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex justify-end">
                      <button onClick={function(){ restoreEvent(ev); }} disabled={busy}
                        className={"rounded-lg px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50 " + (hasDel ? "bg-rose-600 hover:bg-rose-700" : "bg-blue-600 hover:bg-blue-700")}>
                        {busy ? "משחזר..." : hasDel ? "↩️ שחזר את הרשומות שנמחקו" : "↩️ החזר לערכים הקודמים"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="text-center text-[11px] text-slate-400 mt-6 mb-4">
        ההיסטוריה נשמרת 14 יום ונמחקת אוטומטית בסנכרון הלילי · השחזור עצמו נרשם ביומן הפעולות ובהיסטוריה
      </div>
    </div>
  );
}
