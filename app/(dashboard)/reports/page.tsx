"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

function fmtDate(d: string) {
  if (!d) return "—";
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

type ReportType = "occupancy"|"contracts"|"revenue"|"expiring"|"options"|"guarantees";

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>("occupancy");
  const [loading, setLoading]       = useState(false);
  const [data, setData]             = useState<any[]>([]);
  const [fromDate, setFromDate]     = useState("");
  const [toDate, setToDate]         = useState("");

  const reports: { key: ReportType; label: string; icon: string; desc: string }[] = [
    { key: "occupancy",  label: "תפוסת נכסים",        icon: "🏢", desc: "שטח מושכר vs. פנוי לכל נכס" },
    { key: "contracts",  label: "חוזים פעילים",        icon: "📄", desc: "כל החוזים הפעילים עם פרטים" },
    { key: "revenue",    label: "הכנסות לפי נכס",      icon: "💰", desc: "הכנסה חודשית ושנתית לכל נכס" },
    { key: "expiring",   label: "חוזים לפקיעה",        icon: "⏰", desc: "חוזים שפגים ב-12 החודשים הקרובים" },
    { key: "options",    label: "אופציות וסטטוס",      icon: "📋", desc: "כל האופציות עם מועדי הודעה" },
    { key: "guarantees", label: "ערבויות ובטחונות",    icon: "🛡️", desc: "סטטוס ערבויות לפי שוכר" },
  ];

  useEffect(() => { loadReport(); }, [reportType]);

  async function loadReport() {
    setLoading(true);
    setData([]);
    try {
      if (reportType === "occupancy") {
        const { data: props } = await supabase
          .from("properties")
          .select("*, contracts(id, status, charged_area, rent_per_sqm, investment_addition, tenants(name))")
          .order("name");
        const rows = (props ?? []).map((p: any) => {
          const active = (p.contracts ?? []).filter((c: any) =>
            ["active","expiring","extended"].includes(c.status));
          const rentedArea = active.reduce((s: number, c: any) => s + (c.charged_area ?? 0), 0);
          const revenue    = active.reduce((s: number, c: any) =>
            s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0), 0);
          const total = p.total_rentable_area ?? 0;
          return {
            name: p.name,
            type: p.property_type ?? "—",
            total_area: total,
            rented_area: rentedArea,
            vacant_area: total - rentedArea,
            occupancy_pct: total > 0 ? Math.round(rentedArea / total * 100) : 0,
            active_contracts: active.length,
            monthly_revenue: revenue,
          };
        });
        setData(rows);

      } else if (reportType === "contracts") {
        const { data: contracts } = await supabase
          .from("contracts")
          .select("*, tenants(name), properties(name)")
          .in("status", ["active","expiring","extended","upcoming"])
          .order("end_date");
        setData((contracts ?? []).map((c: any) => ({
          tenant: c.tenants?.name,
          property: c.properties?.name,
          start: c.start_date,
          end: c.end_date,
          status: c.status,
          rent_per_sqm: c.rent_per_sqm,
          area: c.charged_area,
          monthly: (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0),
          days_left: c.end_date ? daysLeft(c.end_date) : null,
        })));

      } else if (reportType === "revenue") {
        const { data: props } = await supabase
          .from("properties")
          .select("*, contracts(id, status, rent_per_sqm, charged_area, investment_addition, tenants(name))")
          .order("name");
        setData((props ?? []).map((p: any) => {
          const active = (p.contracts ?? []).filter((c: any) =>
            ["active","expiring","extended"].includes(c.status));
          const monthly = active.reduce((s: number, c: any) =>
            s + (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0), 0);
          return {
            property: p.name,
            active_contracts: active.length,
            monthly_revenue: monthly,
            annual_revenue: monthly * 12,
            tenants: active.map((c: any) => c.tenants?.name).join(", "),
          };
        }));

      } else if (reportType === "expiring") {
        const in365 = new Date();
        in365.setDate(in365.getDate() + 365);
        const { data: contracts } = await supabase
          .from("contracts")
          .select("*, tenants(name), properties(name)")
          .in("status", ["active","expiring","extended"])
          .lte("end_date", in365.toISOString().split("T")[0])
          .order("end_date");
        setData((contracts ?? []).map((c: any) => ({
          tenant: c.tenants?.name,
          property: c.properties?.name,
          end_date: c.end_date,
          days_left: daysLeft(c.end_date),
          option_months: c.option_months,
          monthly: (c.rent_per_sqm ?? 0) * (c.charged_area ?? 0) + (c.investment_addition ?? 0),
        })));

      } else if (reportType === "options") {
        const { data: opts } = await supabase
          .from("contract_options")
          .select("*, contracts(tenant_id, property_id, tenants(name), properties(name))")
          .order("notice_deadline");
        setData((opts ?? []).map((o: any) => ({
          tenant: o.contracts?.tenants?.name,
          property: o.contracts?.properties?.name,
          option_number: o.option_number,
          duration_months: o.duration_months,
          start_date: o.start_date,
          end_date: o.end_date,
          notice_deadline: o.notice_deadline,
          days_to_deadline: o.notice_deadline ? daysLeft(o.notice_deadline) : null,
          status: o.status,
          notice_type: o.notice_type,
        })));

      } else if (reportType === "guarantees") {
        const { data: g } = await supabase
          .from("guarantees")
          .select("*, contracts(tenant_id, property_id, tenants(name), properties(name))")
          .order("end_date");
        setData((g ?? []).map((gg: any) => ({
          tenant: gg.contracts?.tenants?.name,
          property: gg.contracts?.properties?.name,
          type: gg.guarantee_type,
          amount_required: gg.amount_required,
          amount_actual: gg.amount_actual,
          end_date: gg.end_date,
          days_left: gg.end_date ? daysLeft(gg.end_date) : null,
          status: gg.status,
        })));
      }
    } finally { setLoading(false); }
  }

  function exportCSV() {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(","),
      ...data.map(row =>
        headers.map(h => {
          const v = row[h];
          return typeof v === "string" && v.includes(",") ? `"${v}"` : v ?? "";
        }).join(",")
      )
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${reportType}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const currentReport = reports.find(r => r.key === reportType)!;

  // סיכומים לפי סוג דוח
  const summaries = (() => {
    if (!data.length) return null;
    if (reportType === "occupancy") {
      const totalArea    = data.reduce((s, r) => s + r.total_area, 0);
      const rentedArea   = data.reduce((s, r) => s + r.rented_area, 0);
      const totalRev     = data.reduce((s, r) => s + r.monthly_revenue, 0);
      return [
        { label: "שטח כולל",     value: `${totalArea.toLocaleString()} מ"ר` },
        { label: "מושכר",         value: `${rentedArea.toLocaleString()} מ"ר (${totalArea > 0 ? Math.round(rentedArea/totalArea*100) : 0}%)` },
        { label: "הכנסה חודשית", value: `₪${totalRev.toLocaleString()}` },
        { label: "שנתי",          value: `₪${(totalRev*12).toLocaleString()}` },
      ];
    }
    if (reportType === "revenue") {
      const total = data.reduce((s, r) => s + r.monthly_revenue, 0);
      return [
        { label: "סה\"כ חודשי",  value: `₪${total.toLocaleString()}` },
        { label: "סה\"כ שנתי",   value: `₪${(total*12).toLocaleString()}` },
        { label: "נכסים פעילים", value: data.filter(r => r.monthly_revenue > 0).length },
      ];
    }
    if (reportType === "contracts") {
      const total = data.reduce((s, r) => s + r.monthly, 0);
      return [
        { label: "חוזים",          value: data.length },
        { label: "הכנסה חודשית",  value: `₪${total.toLocaleString()}` },
      ];
    }
    return null;
  })();

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">דוחות</h1>
          <p className="text-sm text-slate-500 mt-1">ניתוח וסיכום נתוני המערכת</p>
        </div>
        {data.length > 0 && (
          <button onClick={exportCSV}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm flex items-center gap-2">
            📥 ייצוא CSV
          </button>
        )}
      </div>

      {/* בחירת דוח */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {reports.map(r => (
          <button key={r.key} onClick={() => setReportType(r.key)}
            className={`rounded-xl border p-3 text-right transition-colors shadow-sm ${reportType === r.key ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
            <div className="text-2xl mb-1">{r.icon}</div>
            <div className={`text-xs font-bold ${reportType === r.key ? "text-blue-700" : "text-slate-700"}`}>{r.label}</div>
            <div className="text-xs text-slate-400 mt-0.5 leading-tight">{r.desc}</div>
          </button>
        ))}
      </div>

      {/* סיכומים */}
      {summaries && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {summaries.map((s: any, i: number) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-center">
              <div className="text-xl font-bold text-slate-900">{s.value}</div>
              <div className="text-xs text-slate-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* טבלת דוח */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : data.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400 shadow-sm">
          <div className="text-5xl mb-3">{currentReport.icon}</div>
          <div>אין נתונים להצגה</div>
        </div>
      ) : reportType === "occupancy" ? (
        <OccupancyTable data={data} />
      ) : reportType === "revenue" ? (
        <RevenueTable data={data} />
      ) : reportType === "contracts" || reportType === "expiring" ? (
        <ContractsTable data={data} />
      ) : reportType === "options" ? (
        <OptionsTable data={data} />
      ) : (
        <GuaranteesTable data={data} />
      )}
    </div>
  );
}

function OccupancyTable({ data }: { data: any[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <table className="w-full text-right text-sm">
        <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 font-semibold">נכס</th>
            <th className="px-4 py-3 font-semibold">סוג</th>
            <th className="px-4 py-3 font-semibold">שטח כולל</th>
            <th className="px-4 py-3 font-semibold">מושכר</th>
            <th className="px-4 py-3 font-semibold">פנוי</th>
            <th className="px-4 py-3 font-semibold">תפוסה</th>
            <th className="px-4 py-3 font-semibold">חוזים</th>
            <th className="px-4 py-3 font-semibold">הכנסה חודשית</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-3 font-semibold text-slate-900">{r.name}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{r.type}</td>
              <td className="px-4 py-3 text-slate-700">{r.total_area.toLocaleString()} מ"ר</td>
              <td className="px-4 py-3 text-green-700 font-medium">{r.rented_area.toLocaleString()} מ"ר</td>
              <td className="px-4 py-3 text-orange-600">{r.vacant_area.toLocaleString()} מ"ר</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-slate-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${r.occupancy_pct >= 80 ? "bg-green-500" : r.occupancy_pct >= 50 ? "bg-yellow-500" : "bg-red-400"}`}
                      style={{ width: `${r.occupancy_pct}%` }} />
                  </div>
                  <span className="text-xs font-semibold">{r.occupancy_pct}%</span>
                </div>
              </td>
              <td className="px-4 py-3 text-slate-700">{r.active_contracts}</td>
              <td className="px-4 py-3 font-bold text-slate-900">₪{r.monthly_revenue.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContractsTable({ data }: { data: any[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <table className="w-full text-right text-sm">
        <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 font-semibold">שוכר</th>
            <th className="px-4 py-3 font-semibold">נכס</th>
            <th className="px-4 py-3 font-semibold">התחלה</th>
            <th className="px-4 py-3 font-semibold">סיום</th>
            <th className="px-4 py-3 font-semibold">ימים לסיום</th>
            <th className="px-4 py-3 font-semibold">שטח</th>
            <th className="px-4 py-3 font-semibold">הכנסה חודשית</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-3 font-semibold text-slate-900">{r.tenant}</td>
              <td className="px-4 py-3 text-slate-600">{r.property}</td>
              <td className="px-4 py-3 text-slate-500">{fmtDate(r.start)}</td>
              <td className="px-4 py-3 text-slate-500">{fmtDate(r.end ?? r.end_date)}</td>
              <td className="px-4 py-3">
                {r.days_left != null && (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.days_left <= 30 ? "bg-red-100 text-red-700" : r.days_left <= 90 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}>
                    {r.days_left < 0 ? `פג לפני ${Math.abs(r.days_left)}י` : `${r.days_left} ימים`}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">{r.area ? `${r.area} מ"ר` : "—"}</td>
              <td className="px-4 py-3 font-bold text-slate-900">₪{(r.monthly ?? 0).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RevenueTable({ data }: { data: any[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <table className="w-full text-right text-sm">
        <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 font-semibold">נכס</th>
            <th className="px-4 py-3 font-semibold">שוכרים</th>
            <th className="px-4 py-3 font-semibold">חוזים פעילים</th>
            <th className="px-4 py-3 font-semibold">הכנסה חודשית</th>
            <th className="px-4 py-3 font-semibold">הכנסה שנתית</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-3 font-semibold text-slate-900">{r.property}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{r.tenants || "—"}</td>
              <td className="px-4 py-3 text-slate-700">{r.active_contracts}</td>
              <td className="px-4 py-3 font-bold text-green-700">₪{r.monthly_revenue.toLocaleString()}</td>
              <td className="px-4 py-3 font-bold text-slate-800">₪{r.annual_revenue.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OptionsTable({ data }: { data: any[] }) {
  const statusLabels: Record<string, string> = {
    pending: "ממתין", exercised: "מומש", not_exercised: "לא מומש", auto_extended: "הוארך אוטו׳"
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <table className="w-full text-right text-sm">
        <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 font-semibold">שוכר</th>
            <th className="px-4 py-3 font-semibold">נכס</th>
            <th className="px-4 py-3 font-semibold">אופציה</th>
            <th className="px-4 py-3 font-semibold">תקופה</th>
            <th className="px-4 py-3 font-semibold">מועד הודעה</th>
            <th className="px-4 py-3 font-semibold">ימים להודעה</th>
            <th className="px-4 py-3 font-semibold">סטטוס</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className={`border-t border-slate-100 hover:bg-slate-50 ${r.days_to_deadline != null && r.days_to_deadline <= 30 && r.status === "pending" ? "bg-red-50" : ""}`}>
              <td className="px-4 py-3 font-semibold text-slate-900">{r.tenant}</td>
              <td className="px-4 py-3 text-slate-600">{r.property}</td>
              <td className="px-4 py-3 text-slate-700">{r.option_number} ({r.duration_months} חו׳)</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(r.start_date)} — {fmtDate(r.end_date)}</td>
              <td className="px-4 py-3 text-slate-600">{fmtDate(r.notice_deadline)}</td>
              <td className="px-4 py-3">
                {r.days_to_deadline != null && r.status === "pending" && (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.days_to_deadline <= 0 ? "bg-red-100 text-red-700" : r.days_to_deadline <= 30 ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-700"}`}>
                    {r.days_to_deadline < 0 ? `עבר לפני ${Math.abs(r.days_to_deadline)}י` : `${r.days_to_deadline} ימים`}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.status === "pending" ? "bg-yellow-100 text-yellow-700" : r.status === "exercised" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                  {statusLabels[r.status] ?? r.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GuaranteesTable({ data }: { data: any[] }) {
  const typeLabels: Record<string, string> = {
    bank: "בנקאית", check: "שיק", cash: "מזומן", personal: "אישית"
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <table className="w-full text-right text-sm">
        <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 font-semibold">שוכר</th>
            <th className="px-4 py-3 font-semibold">נכס</th>
            <th className="px-4 py-3 font-semibold">סוג</th>
            <th className="px-4 py-3 font-semibold">נדרש</th>
            <th className="px-4 py-3 font-semibold">בפועל</th>
            <th className="px-4 py-3 font-semibold">תוקף</th>
            <th className="px-4 py-3 font-semibold">סטטוס</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-3 font-semibold text-slate-900">{r.tenant}</td>
              <td className="px-4 py-3 text-slate-600">{r.property}</td>
              <td className="px-4 py-3 text-slate-600">{typeLabels[r.type] ?? r.type}</td>
              <td className="px-4 py-3 text-slate-700">{r.amount_required ? `₪${r.amount_required.toLocaleString()}` : "—"}</td>
              <td className="px-4 py-3">
                {r.amount_actual && r.amount_required && r.amount_actual < r.amount_required
                  ? <span className="text-red-600 font-semibold">₪{r.amount_actual.toLocaleString()} ⚠️</span>
                  : <span className="text-slate-700">{r.amount_actual ? `₪${r.amount_actual.toLocaleString()}` : "—"}</span>}
              </td>
              <td className="px-4 py-3">
                {r.end_date && (
                  <span className={r.days_left != null && r.days_left <= 30 ? "text-red-600 font-semibold" : "text-slate-500"}>
                    {fmtDate(r.end_date)}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.status === "active" ? "bg-green-100 text-green-700" : r.status === "expired" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                  {r.status === "active" ? "פעילה" : r.status === "expired" ? "פגה" : r.status === "forfeited" ? "חולטה" : "הוחזרה"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
