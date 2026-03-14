"use client";
import { useEffect, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const statusConfig: Record<string, { label: string; bg: string; color: string }> = {
  active:   { label: "פעיל",     bg: "bg-green-100",  color: "text-green-800"  },
  upcoming: { label: "עתידי",    bg: "bg-blue-100",   color: "text-blue-800"   },
  expiring: { label: "פג בקרוב", bg: "bg-yellow-100", color: "text-yellow-800" },
  ended:    { label: "הסתיים",   bg: "bg-slate-100",  color: "text-slate-600"  },
  extended: { label: "הוארך",    bg: "bg-purple-100", color: "text-purple-800" },
};

const optionStatusConfig: Record<string, { label: string; bg: string; color: string }> = {
  pending:       { label: "ממתין",        bg: "bg-yellow-50",  color: "text-yellow-700" },
  exercised:     { label: "מומש ✓",       bg: "bg-green-50",   color: "text-green-700"  },
  not_exercised: { label: "לא מומש",      bg: "bg-red-50",     color: "text-red-700"    },
  auto_extended: { label: "הוארך אוטו׳",  bg: "bg-purple-50",  color: "text-purple-700" },
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
  const [contracts, setContracts]   = useState<any[]>([]);
  const [options, setOptions]       = useState<Record<string, any[]>>({});
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingOption, setSavingOption] = useState<string | null>(null);

  async function load() {
    const { data: contractsData } = await supabase
      .from("contracts")
      .select("*, tenants(name, contact_phone, contact_email), properties(name, address)")
      .order("start_date", { ascending: false });

    // טען אופציות לכל החוזים
    const { data: optionsData } = await supabase
      .from("contract_options")
      .select("*")
      .order("option_number");

    // קבץ אופציות לפי contract_id
    const optsByContract: Record<string, any[]> = {};
    (optionsData ?? []).forEach((o: any) => {
      if (!optsByContract[o.contract_id]) optsByContract[o.contract_id] = [];
      optsByContract[o.contract_id].push(o);
    });
    setOptions(optsByContract);

    const today = new Date(); today.setHours(0,0,0,0);
    const enriched = (contractsData ?? []).map((c: any) => {
      const contractOpts = optsByContract[c.id] ?? [];
      // תאריך סיום אמיתי — לוקח בחשבון אופציות ממומשות
      const exercisedOpts = contractOpts.filter((o: any) => o.status === "exercised" || o.status === "auto_extended");
      const effectiveEnd = exercisedOpts.length > 0
        ? exercisedOpts.reduce((max: string, o: any) => o.end_date > max ? o.end_date : max, c.end_date)
        : c.end_date;

      const start = new Date(c.start_date);
      const end   = new Date(effectiveEnd);
      const days  = daysLeft(effectiveEnd);
      let status  = c.status;
      if (today < start)       status = "upcoming";
      else if (today > end)    status = c.option_exercised ? "extended" : "ended";
      else if (days <= 90)     status = "expiring";
      else                     status = "active";

      // בדוק אם יש אופציות שמועד ההודעה שלהן עבר ועדיין pending → auto_extend
      const now = new Date();
      contractOpts.forEach((o: any) => {
        if (o.status === "pending" && o.notice_deadline && new Date(o.notice_deadline) < now) {
          o._shouldAutoExtend = true;
        }
      });

      return { ...c, computedStatus: status, daysLeft: days, effectiveEnd };
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
    active:       contracts.filter(c => c.computedStatus === "active" || c.computedStatus === "expiring").length,
    expiring:     contracts.filter(c => c.computedStatus === "expiring").length,
    upcoming:     contracts.filter(c => c.computedStatus === "upcoming").length,
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

  async function handleOptionAction(optionId: string, contractId: string, action: "exercised" | "not_exercised" | "auto_extended") {
    setSavingOption(optionId);
    try {
      await supabase.from("contract_options")
        .update({ status: action, exercised_at: new Date().toISOString() })
        .eq("id", optionId);

      // אם מומשה — עדכן את החוזה ל-extended
      if (action === "exercised" || action === "auto_extended") {
        await supabase.from("contracts")
          .update({ option_exercised: true, status: "extended" })
          .eq("id", contractId);
      }
      await load();
    } finally {
      setSavingOption(null);
    }
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
        <button onClick={() => router.push("/contracts/new")}
          className="rounded-lg bg-blue-700 px-5 py-2.5 font-bold text-white hover:bg-blue-800">+ חוזה חדש</button>
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
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm">
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
                <th className="px-3 py-3 w-6"></th>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">שוכר</th>
                <th className="px-4 py-3 font-semibold">נכס</th>
                <th className="px-4 py-3 font-semibold">סיום בפועל</th>
                <th className="px-4 py-3 font-semibold">ימים לסיום</th>
                <th className="px-4 py-3 font-semibold">שכ"ד חודשי</th>
                <th className="px-4 py-3 font-semibold">אופציות</th>
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
                const contractOpts = options[c.id] ?? [];
                const pendingOpts  = contractOpts.filter((o: any) => o.status === "pending");
                const hasUrgent    = pendingOpts.some((o: any) =>
                  o.notice_deadline && daysLeft(o.notice_deadline) <= 30);

                return (
                  <Fragment key={c.id}>
                    {/* שורה ראשית */}
                    <tr onClick={() => toggleExpand(c.id)}
                      className={`border-t border-slate-100 cursor-pointer transition-colors ${isExpanded ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                      <td className="px-3 py-3 text-slate-400 text-center text-xs">
                        {isExpanded ? "▲" : "▼"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${sc.bg} ${sc.color}`}>{sc.label}</span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{c.tenants?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{c.properties?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatDate(c.effectiveEnd)}
                        {c.effectiveEnd !== c.end_date && (
                          <span className="mr-1 text-xs text-purple-600">(כולל אופציה)</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const d = c.daysLeft;
                          return <span className={`text-xs font-semibold ${d < 0 ? "text-red-600" : d < 90 ? "text-yellow-700" : "text-slate-600"}`}>
                            {d < 0 ? `פג לפני ${Math.abs(d)}י` : `${d} ימים`}
                          </span>;
                        })()}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {monthly > 0 ? "₪"+monthly.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {contractOpts.length > 0 ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full font-semibold">
                              {contractOpts.length} אופציות
                            </span>
                            {hasUrgent && <span className="text-xs text-red-600 font-bold">⚠️</span>}
                            {pendingOpts.length > 0 && (
                              <span className="text-xs text-yellow-700">({pendingOpts.length} ממתינות)</span>
                            )}
                          </div>
                        ) : c.option_months ? (
                          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                            {c.option_months} חו׳
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">אין</span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <button onClick={() => router.push(`/contracts/${c.id}/edit`)}
                            className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-50 font-medium">עריכה</button>
                          <button onClick={() => handleDelete(c.id)}
                            className="text-xs border border-red-100 rounded px-2 py-1 text-red-500 hover:bg-red-50">מחיקה</button>
                        </div>
                      </td>
                    </tr>

                    {/* פאנל פרטים inline */}
                    {isExpanded && (
                      <tr key={c.id+"-details"}>
                        <td colSpan={9} className="p-0 border-t border-blue-100">
                          <div className="bg-blue-50 border-b border-blue-100 px-6 py-5">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

                              {/* עמודה 1: שוכר */}
                              <div className="space-y-4">
                                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                  <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">👤 פרטי שוכר</div>
                                  <div className="text-slate-900 font-bold text-base mb-3">{c.tenants?.name}</div>
                                  {c.tenants?.contact_phone && (
                                    <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                                      <span className="text-slate-500 text-xs">📞 טלפון</span>
                                      <a href={"tel:"+c.tenants.contact_phone} className="text-blue-700 font-semibold text-sm">{c.tenants.contact_phone}</a>
                                    </div>
                                  )}
                                  {c.tenants?.contact_email && (
                                    <div className="flex items-center justify-between py-1.5">
                                      <span className="text-slate-500 text-xs">✉️ אימייל</span>
                                      <a href={"mailto:"+c.tenants.contact_email} className="text-blue-700 text-xs">{c.tenants.contact_email}</a>
                                    </div>
                                  )}
                                </div>
                                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                  <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">📎 מסמכים</div>
                                  {c.document_url
                                    ? <a href={c.document_url} target="_blank" rel="noopener noreferrer" className="text-blue-700 text-sm font-semibold">פתח חוזה ↗</a>
                                    : <span className="text-slate-400 text-xs">לא הוסף קישור</span>}
                                </div>
                              </div>

                              {/* עמודה 2: תנאי חוזה */}
                              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">📅 תנאי חוזה</div>
                                <Row label="נכס" value={c.properties?.name ?? "—"} />
                                <Row label="התחלה" value={formatDate(c.start_date)} />
                                <Row label="סיום חוזה" value={formatDate(c.end_date)} />
                                {c.effectiveEnd !== c.end_date && (
                                  <Row label="סיום בפועל" value={<span className="text-purple-700 font-bold">{formatDate(c.effectiveEnd)}</span>} />
                                )}
                                {c.price_increase_type && (
                                  <Row label="עליית מחיר" value={
                                    c.price_increase_type === "percent"
                                      ? `${c.price_increase_value}% כל ${c.price_increase_freq_months} חו׳`
                                      : `₪${c.price_increase_value} כל ${c.price_increase_freq_months} חו׳`
                                  } />
                                )}
                                {c.index_base_value && (
                                  <Row label="מדד בסיס" value={`${c.index_base_value} (${c.index_base_month}/${c.index_base_year})`} />
                                )}
                                {c.guarantee_type && (
                                  <Row label="ערבות" value={
                                    c.guarantee_type === "bank" ? "בנקאית" :
                                    c.guarantee_type === "check" ? "שיק" : "מזומן"
                                  } />
                                )}
                              </div>

                              {/* עמודה 3: תשלום + פעולות */}
                              <div className="space-y-4">
                                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                  <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">💰 תשלום</div>
                                  {c.rent_per_sqm && <Row label='מחיר למ"ר' value={`₪${c.rent_per_sqm}`} />}
                                  {c.charged_area && <Row label='שטח מחויב' value={`${c.charged_area} מ"ר`} />}
                                  {c.investment_addition > 0 && <Row label="תוספת השקעות" value={`₪${c.investment_addition.toLocaleString()}`} />}
                                  <div className="mt-3 pt-3 border-t border-green-100 flex justify-between items-center">
                                    <span className="text-slate-600 font-semibold">סה"כ חודשי</span>
                                    <span className="text-green-800 font-bold text-lg">₪{monthly.toLocaleString()}</span>
                                  </div>
                                </div>
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

                            {/* אופציות */}
                            {contractOpts.length > 0 && (
                              <div className="mt-5 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                <div className="text-xs font-bold text-slate-500 mb-4 uppercase tracking-wide">📋 אופציות להארכה</div>
                                <div className="space-y-3">
                                  {contractOpts.map((opt: any) => {
                                    const os = optionStatusConfig[opt.status] ?? optionStatusConfig.pending;
                                    const daysToDeadline = opt.notice_deadline ? daysLeft(opt.notice_deadline) : null;
                                    const isUrgent = daysToDeadline !== null && daysToDeadline <= 30 && opt.status === "pending";
                                    const isOverdue = daysToDeadline !== null && daysToDeadline < 0 && opt.status === "pending";
                                    return (
                                      <div key={opt.id}
                                        className={`rounded-lg border p-3 ${isUrgent || isOverdue ? "border-red-200 bg-red-50" : "border-slate-100 bg-slate-50"}`}>
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                              <span className="font-bold text-slate-800 text-sm">אופציה {opt.option_number}</span>
                                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${os.bg} ${os.color}`}>{os.label}</span>
                                              {(isUrgent || isOverdue) && (
                                                <span className="text-xs font-bold text-red-600">
                                                  {isOverdue ? "⚠️ מועד עבר!" : `⚠️ ${daysToDeadline} ימים`}
                                                </span>
                                              )}
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-600">
                                              <div><span className="text-slate-400">משך: </span><span className="font-medium">{opt.duration_months} חודשים</span></div>
                                              {opt.start_date && <div><span className="text-slate-400">מ: </span><span className="font-medium">{formatDate(opt.start_date)}</span></div>}
                                              {opt.end_date && <div><span className="text-slate-400">עד: </span><span className="font-medium">{formatDate(opt.end_date)}</span></div>}
                                              {opt.notice_deadline && (
                                                <div>
                                                  <span className="text-slate-400">מועד הודעה: </span>
                                                  <span className={`font-medium ${isUrgent || isOverdue ? "text-red-600" : ""}`}>
                                                    {formatDate(opt.notice_deadline)}
                                                  </span>
                                                </div>
                                              )}
                                            </div>
                                            {opt.notes && <div className="mt-1 text-xs text-slate-500">{opt.notes}</div>}
                                          </div>

                                          {/* כפתורי פעולה לאופציה */}
                                          {opt.status === "pending" && (
                                            <div className="flex flex-col gap-1 shrink-0">
                                              <button
                                                onClick={() => handleOptionAction(opt.id, c.id, "exercised")}
                                                disabled={savingOption === opt.id}
                                                className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 font-semibold disabled:opacity-50 whitespace-nowrap">
                                                ✓ מומש
                                              </button>
                                              <button
                                                onClick={() => handleOptionAction(opt.id, c.id, "not_exercised")}
                                                disabled={savingOption === opt.id}
                                                className="text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200 font-semibold disabled:opacity-50 whitespace-nowrap">
                                                ✗ לא מומש
                                              </button>
                                              {isOverdue && (
                                                <button
                                                  onClick={() => handleOptionAction(opt.id, c.id, "auto_extended")}
                                                  disabled={savingOption === opt.id}
                                                  className="text-xs bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg hover:bg-purple-200 font-semibold disabled:opacity-50 whitespace-nowrap">
                                                  🔄 אוטו׳
                                                </button>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

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
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
