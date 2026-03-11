"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const statusConfig: Record<string, { label: string; bg: string; color: string; border: string }> = {
  active:   { label: "פעיל",     bg: "bg-green-100",  color: "text-green-800",  border: "border-green-200" },
  upcoming: { label: "עתידי",    bg: "bg-blue-100",   color: "text-blue-800",   border: "border-blue-200"  },
  expiring: { label: "פג בקרוב", bg: "bg-yellow-100", color: "text-yellow-800", border: "border-yellow-200"},
  ended:    { label: "הסתיים",   bg: "bg-slate-100",  color: "text-slate-600",  border: "border-slate-200" },
  extended: { label: "הוארך",    bg: "bg-purple-100", color: "text-purple-800", border: "border-purple-200"},
};

function daysLeft(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - new Date().getTime()) / (1000*60*60*24));
}
function formatDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className="text-slate-900 text-sm font-medium">{value}</span>
    </div>
  );
}

export default function ContractsPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("contracts")
      .select("*, tenants(name, contact_phone, contact_email), properties(name, address)")
      .order("start_date", { ascending: false });

    const today = new Date(); today.setHours(0,0,0,0);
    const enriched = (data ?? []).map((c: any) => {
      const start = new Date(c.start_date);
      const end = new Date(c.end_date);
      const days = daysLeft(c.end_date);
      let status = c.status;
      if (today < start) status = "upcoming";
      else if (today > end) status = c.option_exercised ? "extended" : "ended";
      else if (days <= 90) status = "expiring";
      else status = "active";
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
    active: contracts.filter(c => c.computedStatus === "active" || c.computedStatus === "expiring").length,
    expiring: contracts.filter(c => c.computedStatus === "expiring").length,
    upcoming: contracts.filter(c => c.computedStatus === "upcoming").length,
    totalRevenue: contracts
      .filter(c => c.computedStatus === "active" || c.computedStatus === "expiring")
      .reduce((s, c) => s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0), 0),
  };

  async function handleDelete(id: string) {
    if (!confirm("למחוק חוזה זה?")) return;
    await supabase.from("contracts").delete().eq("id", id);
    setExpandedId(null);
    load();
  }

  function toggleExpand(id: string) {
    setExpandedId(prev => prev === id ? null : id);
  }

  return (
    <div dir="rtl">
      {/* כותרת */}
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
          <div className="text-xs text-green-700 mt-1 font-medium">חוזים פעילים</div>
        </div>
        <div className="rounded-xl border border-yellow-100 bg-yellow-50 p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-yellow-700">{stats.expiring}</div>
          <div className="text-xs text-yellow-700 mt-1 font-medium">פגים בקרוב</div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-blue-700">{stats.upcoming}</div>
          <div className="text-xs text-blue-700 mt-1 font-medium">עתידיים</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-slate-900">₪{stats.totalRevenue.toLocaleString()}</div>
          <div className="text-xs text-slate-600 mt-1 font-medium">הכנסה חודשית</div>
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
            <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-semibold w-6"></th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">שוכר</th>
                <th className="px-4 py-3 font-semibold">נכס</th>
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
                const isExpanded = expandedId === c.id;

                return [
                  /* שורה ראשית */
                  <tr key={c.id}
                    onClick={() => toggleExpand(c.id)}
                    className={`border-t border-slate-100 cursor-pointer transition-colors ${isExpanded ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                    <td className="px-3 py-3 text-slate-400 text-center">
                      <span className="text-xs">{isExpanded ? "▲" : "▼"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${sc.bg} ${sc.color}`}>{sc.label}</span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{c.tenants?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-700">{c.properties?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDate(c.end_date)}</td>
                    <td className="px-4 py-3">
                      {c.end_date && (() => {
                        const d = c.daysLeft;
                        return <span className={`text-xs font-semibold ${d < 0 ? "text-red-600" : d < 90 ? "text-yellow-700" : "text-slate-600"}`}>
                          {d < 0 ? `פג לפני ${Math.abs(d)}י` : `${d} ימים`}
                        </span>;
                      })()}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900">{monthly > 0 ? "₪"+monthly.toLocaleString() : "—"}</td>
                    <td className="px-4 py-3">
                      {c.option_months
                        ? <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full font-semibold">{c.option_months} חודשים</span>
                        : <span className="text-slate-300 text-xs">אין</span>}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <button onClick={() => router.push(`/contracts/${c.id}/edit`)}
                          className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50 font-medium">עריכה</button>
                        <button onClick={() => handleDelete(c.id)}
                          className="text-xs border border-red-100 rounded px-2 py-1 text-red-500 hover:bg-red-50">מחיקה</button>
                      </div>
                    </td>
                  </tr>,

                  /* פאנל פרטים inline */
                  isExpanded && (
                    <tr key={c.id+"-details"}>
                      <td colSpan={9} className="p-0 border-t border-blue-100">
                        <div className="bg-blue-50 border-b border-blue-100 px-6 py-5">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

                            {/* עמודה 1: שוכר + קשר */}
                            <div className="space-y-4">
                              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">👤 פרטי שוכר</div>
                                <div className="text-slate-900 font-bold text-base mb-3">{c.tenants?.name}</div>
                                {c.tenants?.contact_phone && (
                                  <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                                    <span className="text-slate-500 text-xs">📞 טלפון</span>
                                    <a href={"tel:"+c.tenants.contact_phone} className="text-blue-700 font-semibold text-sm hover:underline">{c.tenants.contact_phone}</a>
                                  </div>
                                )}
                                {c.tenants?.contact_email && (
                                  <div className="flex items-center justify-between py-1.5">
                                    <span className="text-slate-500 text-xs">✉️ אימייל</span>
                                    <a href={"mailto:"+c.tenants.contact_email} className="text-blue-700 text-xs hover:underline">{c.tenants.contact_email}</a>
                                  </div>
                                )}
                              </div>

                              {/* מסמך */}
                              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">📎 מסמכים</div>
                                {c.document_url
                                  ? <a href={c.document_url} target="_blank" rel="noopener noreferrer" className="text-blue-700 text-sm font-semibold hover:underline">פתח חוזה ↗</a>
                                  : <span className="text-slate-400 text-xs">לא הוסף קישור</span>}
                              </div>
                            </div>

                            {/* עמודה 2: תנאי חוזה */}
                            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                              <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">📅 תנאי חוזה</div>
                              <Row label="נכס" value={c.properties?.name ?? "—"} />
                              <Row label="התחלה" value={formatDate(c.start_date)} />
                              <Row label="סיום" value={formatDate(c.end_date)} />
                              {c.option_months && <Row label="אופציה" value={<span className="text-purple-700 font-bold">{c.option_months} חודשים</span>} />}
                              {c.option_exercised && <Row label="מומשה" value={<span className="text-green-700 font-bold">✓ כן</span>} />}
                              {c.price_increase_type && (
                                <Row label="עליית מחיר" value={
                                  c.price_increase_type === "percent"
                                    ? `${c.price_increase_value}% כל ${c.price_increase_freq_months} חודשים`
                                    : `₪${c.price_increase_value} כל ${c.price_increase_freq_months} חודשים`
                                } />
                              )}
                              {c.guarantee_type && (
                                <>
                                  <Row label="ערבות" value={c.guarantee_type === "bank" ? "בנקאית" : c.guarantee_type === "check" ? "שיק" : "מזומן"} />
                                  {c.guarantee_amount && <Row label="סכום ערבות" value={`₪${c.guarantee_amount.toLocaleString()}`} />}
                                </>
                              )}
                            </div>

                            {/* עמודה 3: תשלום + פעולות */}
                            <div className="space-y-4">
                              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">💰 תשלום</div>
                                {c.rent_per_sqm && <Row label='מחיר למ"ר' value={`₪${c.rent_per_sqm}`} />}
                                {c.charged_area && <Row label='שטח מחויב' value={`${c.charged_area} מ"ר`} />}
                                {c.investment_addition > 0 && <Row label="תוספת השקעות" value={`₪${c.investment_addition.toLocaleString()}`} />}
                                {c.mgmt_fee_per_sqm > 0 && <Row label='דמי ניהול למ"ר' value={`₪${c.mgmt_fee_per_sqm}`} />}
                                {c.index_base_value && <Row label="מדד בסיס" value={`${c.index_base_value} (${c.index_base_month}/${c.index_base_year})`} />}
                                <div className="mt-3 pt-3 border-t border-green-100 flex justify-between items-center">
                                  <span className="text-slate-600 font-semibold">סה"כ חודשי</span>
                                  <span className="text-green-800 font-bold text-lg">₪{monthly.toLocaleString()}</span>
                                </div>
                              </div>

                              {/* פעולות */}
                              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-2">
                                <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">⚡ פעולות</div>
                                <button onClick={() => router.push(`/contracts/${c.id}/edit`)}
                                  className="w-full rounded-lg border border-blue-200 py-2 text-sm text-blue-800 hover:bg-blue-50 font-semibold">✏️ עריכת חוזה</button>
                                {(c.computedStatus === "ended" || c.computedStatus === "expiring" || c.computedStatus === "extended") && (
                                  <button onClick={() => router.push(`/contracts/${c.id}/edit?mode=extend`)}
                                    className="w-full rounded-lg bg-purple-600 py-2 text-sm text-white hover:bg-purple-700 font-semibold">🔄 הארך חוזה</button>
                                )}
                                {c.document_url && (
                                  <a href={c.document_url} target="_blank" rel="noopener noreferrer"
                                    className="block w-full rounded-lg border border-slate-200 py-2 text-sm text-slate-700 hover:bg-slate-50 font-medium text-center">📄 פתח מסמך</a>
                                )}
                                <button onClick={() => handleDelete(c.id)}
                                  className="w-full rounded-lg border border-red-100 py-2 text-sm text-red-600 hover:bg-red-50">🗑️ מחיקה</button>
                              </div>
                            </div>

                          </div>

                          {/* הערות */}
                          {c.notes && (
                            <div className="mt-4 bg-yellow-50 border border-yellow-100 rounded-xl p-3">
                              <span className="text-xs font-bold text-yellow-700">📝 הערות: </span>
                              <span className="text-slate-800 text-xs">{c.notes}</span>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
