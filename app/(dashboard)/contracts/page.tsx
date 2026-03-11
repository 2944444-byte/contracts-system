"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const statusConfig: Record<string, { label: string; bg: string; color: string }> = {
  active:   { label: "פעיל",     bg: "bg-green-100",  color: "text-green-700"  },
  upcoming: { label: "עתידי",    bg: "bg-blue-100",   color: "text-blue-700"   },
  expiring: { label: "פג בקרוב", bg: "bg-yellow-100", color: "text-yellow-700" },
  ended:    { label: "הסתיים",   bg: "bg-slate-100",  color: "text-slate-500"  },
  extended: { label: "הוארך",    bg: "bg-purple-100", color: "text-purple-700" },
};

function daysLeft(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - new Date().getTime()) / (1000*60*60*24));
}
function formatDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default function ContractsPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<any>(null);

  async function load() {
    const { data } = await supabase
      .from("contracts")
      .select("*, tenants(name, contact_phone, contact_email), properties(name, address)")
      .order("start_date", { ascending: false });

    const today = new Date();
    today.setHours(0,0,0,0);

    const enriched = (data ?? []).map((c: any) => {
      const start = new Date(c.start_date);
      const end = new Date(c.end_date);
      const days = daysLeft(c.end_date);
      let status = c.status;

      if (today < start) {
        status = "upcoming";
      } else if (today > end) {
        // בדוק אם יש אופציה שממומשת (option_exercised=true) — אז הסטטוס "הוארך"
        status = c.option_exercised ? "extended" : "ended";
      } else if (days <= 90) {
        status = "expiring";
      } else {
        status = "active";
      }

      return { ...c, computedStatus: status, daysLeft: days };
    });

    setContracts(enriched);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = contracts.filter(c => {
    const matchStatus = statusFilter === "all" || c.computedStatus === statusFilter;
    const matchSearch = !search || c.tenants?.name?.includes(search) || c.properties?.name?.includes(search);
    return matchStatus && matchSearch;
  });

  const stats = {
    active:      contracts.filter(c => c.computedStatus === "active" || c.computedStatus === "expiring").length,
    expiring:    contracts.filter(c => c.computedStatus === "expiring").length,
    upcoming:    contracts.filter(c => c.computedStatus === "upcoming").length,
    totalRevenue: contracts
      .filter(c => c.computedStatus === "active" || c.computedStatus === "expiring")
      .reduce((s, c) => s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0), 0),
  };

  async function handleDelete(id: string) {
    if (!confirm("למחוק חוזה זה?")) return;
    await supabase.from("contracts").delete().eq("id", id);
    setSelected(null);
    load();
  }

  async function handleExtend(c: any) {
    router.push(`/contracts/${c.id}/edit?mode=extend`);
  }

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">חוזים</h1>
          <p className="text-sm text-slate-500 mt-1">עקוב אחר כל חוזי השכירות שלך</p>
        </div>
        <button onClick={() => router.push("/contracts/new")} className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">+ חוזה חדש</button>
      </div>

      {/* סטטיסטיקות */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-green-100 bg-green-50 p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-green-700">{stats.active}</div>
          <div className="text-xs text-green-600 mt-1">חוזים פעילים</div>
        </div>
        <div className="rounded-xl border border-yellow-100 bg-yellow-50 p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-yellow-700">{stats.expiring}</div>
          <div className="text-xs text-yellow-600 mt-1">פגים בקרוב</div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-blue-700">{stats.upcoming}</div>
          <div className="text-xs text-blue-600 mt-1">עתידיים</div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-slate-800">₪{stats.totalRevenue.toLocaleString()}</div>
          <div className="text-xs text-slate-500 mt-1">הכנסה חודשית</div>
        </div>
      </div>

      {/* פילטרים */}
      <div className="mb-4 flex flex-wrap gap-3">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 חיפוש לפי שוכר או נכס..."
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 flex-1 min-w-48" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm focus:outline-none">
          <option value="all">כל הסטטוסים</option>
          {Object.entries(statusConfig).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* טבלה */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-100">
              <tr>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">שוכר</th>
                <th className="px-4 py-3 font-semibold">נכס</th>
                <th className="px-4 py-3 font-semibold">תאריך התחלה</th>
                <th className="px-4 py-3 font-semibold">תאריך סיום</th>
                <th className="px-4 py-3 font-semibold">ימים לסיום</th>
                <th className="px-4 py-3 font-semibold">שכ"ד חודשי</th>
                <th className="px-4 py-3 font-semibold">אופציה</th>
                <th className="px-4 py-3 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-slate-400">
                  <div className="text-4xl mb-2">📄</div>
                  <div>{search ? "לא נמצאו חוזים" : "אין חוזים עדיין"}</div>
                </td></tr>
              ) : filtered.map(c => {
                const sc = statusConfig[c.computedStatus] ?? statusConfig.active;
                const monthly = (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0);
                return (
                  <tr key={c.id} onClick={() => setSelected(c)} className="border-t border-slate-50 hover:bg-slate-50 cursor-pointer">
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${sc.bg} ${sc.color}`}>{sc.label}</span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{c.tenants?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{c.properties?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(c.start_date)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(c.end_date)}</td>
                    <td className="px-4 py-3">
                      {c.end_date && (() => {
                        const d = c.daysLeft;
                        return <span className={`text-xs font-medium ${d < 0 ? "text-red-600" : d < 90 ? "text-yellow-600" : "text-slate-500"}`}>
                          {d < 0 ? `פג לפני ${Math.abs(d)}י` : `${d} ימים`}
                        </span>;
                      })()}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{monthly > 0 ? "₪"+monthly.toLocaleString() : "—"}</td>
                    <td className="px-4 py-3">
                      {c.option_months
                        ? <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">{c.option_months} חודשים</span>
                        : <span className="text-slate-300 text-xs">אין</span>}
                    </td>
                    <td className="px-4 py-3 flex gap-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => router.push(`/contracts/${c.id}/edit`)}
                        className="text-xs border border-blue-100 rounded px-2 py-1 text-blue-500 hover:bg-blue-50">עריכה</button>
                      <button onClick={() => handleDelete(c.id)}
                        className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:text-red-600">מחיקה</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* פאנל פרטים */}
      {selected && (
        <div className="fixed inset-y-0 left-0 w-96 bg-white border-r border-slate-200 shadow-xl z-40 overflow-y-auto" dir="rtl">
          <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
            <div>
              <div className="font-bold text-slate-800">{selected.tenants?.name}</div>
              <div className="text-xs text-slate-400">{selected.properties?.name}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => router.push(`/contracts/${selected.id}/edit`)}
                className="text-sm text-blue-600 hover:underline font-medium">✏️ עריכה</button>
              <button onClick={() => setSelected(null)} className="text-2xl text-slate-400">&times;</button>
            </div>
          </div>
          <div className="p-6 space-y-4">
            {/* סטטוס */}
            <div className={`rounded-xl p-3 text-center font-bold text-sm ${statusConfig[selected.computedStatus]?.bg} ${statusConfig[selected.computedStatus]?.color}`}>
              {statusConfig[selected.computedStatus]?.label}
              {selected.daysLeft > 0 && selected.computedStatus !== "upcoming" && ` — ${selected.daysLeft} ימים לסיום`}
            </div>

            {/* פעולות מהירות */}
            {(selected.computedStatus === "ended" || selected.computedStatus === "expiring") && (
              <div className="rounded-xl border border-purple-100 bg-purple-50 p-3 space-y-2">
                <div className="text-xs font-bold text-purple-700 mb-1">📋 פעולות לחוזה זה</div>
                <button onClick={() => handleExtend(selected)}
                  className="w-full rounded-lg bg-purple-600 py-2 text-sm font-bold text-white hover:bg-purple-700">
                  🔄 הארך חוזה / חדש הסכם
                </button>
              </div>
            )}

            {/* קישור מסמך */}
            {selected.document_url ? (
              <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 flex items-center justify-between">
                <span className="text-sm font-medium text-blue-700">📎 מסמך חוזה</span>
                <a href={selected.document_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline font-medium">פתח ↗</a>
              </div>
            ) : (
              <button onClick={() => router.push(`/contracts/${selected.id}/edit`)}
                className="w-full rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-400 hover:text-blue-500 hover:border-blue-200">
                📎 הוסף קישור למסמך (Dropbox/Drive)
              </button>
            )}

            {/* שוכר */}
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 space-y-1.5 text-sm">
              <div className="font-bold text-blue-800 mb-2">👤 פרטי שוכר</div>
              {selected.tenants?.contact_phone && <div className="flex justify-between"><span className="text-blue-600">טלפון</span><a href={"tel:"+selected.tenants.contact_phone} className="font-medium">{selected.tenants.contact_phone}</a></div>}
              {selected.tenants?.contact_email && <div className="flex justify-between"><span className="text-blue-600">אימייל</span><span className="text-xs">{selected.tenants.contact_email}</span></div>}
            </div>

            {/* תקופה */}
            <div className="rounded-xl bg-slate-50 p-4 space-y-2 text-sm">
              <div className="font-medium text-slate-600 mb-1">📅 תקופת חוזה</div>
              <div className="flex justify-between"><span className="text-slate-500">התחלה</span><span className="font-medium">{formatDate(selected.start_date)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">סיום</span><span className="font-medium">{formatDate(selected.end_date)}</span></div>
              {selected.option_months && <div className="flex justify-between"><span className="text-slate-500">אופציה</span><span className="font-medium text-purple-600">{selected.option_months} חודשים</span></div>}
              {selected.option_exercised && <div className="flex justify-between"><span className="text-slate-500">מומשה</span><span className="font-medium text-green-600">✓ כן</span></div>}
            </div>

            {/* תשלום */}
            {selected.rent_per_sqm && (
              <div className="rounded-xl bg-green-50 border border-green-100 p-4 space-y-2 text-sm">
                <div className="font-medium text-green-700 mb-1">💰 תשלום</div>
                <div className="flex justify-between"><span className="text-slate-500">מחיר למ"ר</span><span className="font-bold">₪{selected.rent_per_sqm}</span></div>
                {selected.charged_area && <div className="flex justify-between"><span className="text-slate-500">שטח מחויב</span><span>{selected.charged_area} מ"ר</span></div>}
                {selected.investment_addition > 0 && <div className="flex justify-between"><span className="text-slate-500">תוספת השקעות</span><span>₪{selected.investment_addition}</span></div>}
                {selected.mgmt_fee_per_sqm > 0 && <div className="flex justify-between"><span className="text-slate-500">דמי ניהול למ"ר</span><span>₪{selected.mgmt_fee_per_sqm}</span></div>}
                <div className="border-t border-green-200 pt-2 flex justify-between font-bold text-green-700">
                  <span>חודשי</span>
                  <span>₪{((selected.rent_per_sqm * selected.charged_area) + (selected.investment_addition ?? 0)).toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* מדד */}
            {selected.index_base_value && (
              <div className="rounded-xl bg-slate-50 p-4 space-y-2 text-sm">
                <div className="font-medium text-slate-600 mb-1">📈 מדד בסיס</div>
                <div className="flex justify-between"><span className="text-slate-500">ערך</span><span className="font-bold">{selected.index_base_value}</span></div>
                {selected.index_base_month && selected.index_base_year && <div className="flex justify-between"><span className="text-slate-500">תאריך</span><span>{selected.index_base_month}/{selected.index_base_year}</span></div>}
              </div>
            )}

            {/* ערבות */}
            {selected.guarantee_type && (
              <div className="rounded-xl bg-slate-50 p-4 space-y-2 text-sm">
                <div className="font-medium text-slate-600 mb-1">🛡️ ערבות</div>
                <div className="flex justify-between"><span className="text-slate-500">סוג</span><span className="font-medium">{selected.guarantee_type === "bank" ? "בנקאית" : selected.guarantee_type === "check" ? "שיק" : selected.guarantee_type === "cash" ? "מזומן" : selected.guarantee_type}</span></div>
                {selected.guarantee_amount && <div className="flex justify-between"><span className="text-slate-500">סכום</span><span className="font-bold">₪{selected.guarantee_amount.toLocaleString()}</span></div>}
                {selected.guarantee_expiry && <div className="flex justify-between"><span className="text-slate-500">תפוגה</span><span>{formatDate(selected.guarantee_expiry)}</span></div>}
              </div>
            )}

            {/* הערות */}
            {selected.notes && (
              <div className="rounded-xl bg-yellow-50 border border-yellow-100 p-4 text-sm">
                <div className="font-medium text-yellow-700 mb-1">📝 הערות</div>
                <p className="text-slate-700 text-xs whitespace-pre-wrap">{selected.notes}</p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={() => router.push(`/contracts/${selected.id}/edit`)}
                className="flex-1 rounded-lg border border-blue-200 py-2 text-sm text-blue-600 hover:bg-blue-50 font-medium">✏️ עריכה</button>
              <button onClick={() => handleDelete(selected.id)}
                className="flex-1 rounded-lg border border-red-200 py-2 text-sm text-red-500 hover:bg-red-50">🗑️ מחיקה</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
