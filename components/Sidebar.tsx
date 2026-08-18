"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { canAccessRoute, getScopeIds, scopeRows } from '@/lib/permissions';
import { useAccess } from '@/components/AccessProvider';
import { useMobileNav } from '@/components/MobileNav';
import { APP_VERSION } from '@/lib/version';

type NavItem = {href:string;label:string;icon:string} | {section:string};

const NAV: NavItem[] = [
  {href:"/dashboard",    label:"דשבורד",        icon:"🏠"},
  {section:"נכסים"},
  {href:"/properties",   label:"נכסים",          icon:"🏢"},
  {href:"/groups",       label:"קבוצות",         icon:"📁"},
  {href:"/units",        label:"יחידות",         icon:"🚪"},
  {href:"/parking",      label:"חניה",           icon:"🅿️"},
  {section:"שוכרים"},
  {href:"/tenants",      label:"שוכרים",         icon:"👤"},
  {href:"/contracts",    label:"חוזים",          icon:"📄"},
  {section:"כספים"},
  {href:"/billing",      label:"חיובי נכס",      icon:"🧾"},
  {href:"/payments",     label:"חיובים",         icon:"💳"},
  {href:"/indexation",   label:'הצמדה CBS',     icon:"📈"},
  {href:"/revenue",      label:'שכ"ד פידיון',   icon:"📊"},
  {href:"/cashflow",     label:"תזרים שנתי",     icon:"💹"},
  {section:"בטחונות"},
  {href:"/guarantees",   label:"ערבויות",        icon:"🏦"},
  {href:"/insurances",   label:"ביטוחים",        icon:"🛡️"},
  {href:"/safety",       label:"בדיקות בטיחות", icon:"🔒"},
  {section:"תפעול"},
  {href:"/documents",    label:"מסמכים",         icon:"📁"},
  {href:"/letters",      label:"מכתבים",         icon:"✉️"},
  {href:"/alerts",       label:"התראות",         icon:"🔔"},
  {href:"/calendar",     label:"לוח שנה",        icon:"📅"},
  {href:"/timeline",     label:"Timeline",       icon:"📊"},
  {section:"דוחות"},
  {href:"/reports",      label:"דוחות",          icon:"📋"},
  {href:"/audit",        label:"יומן פעולות",   icon:"📝"},
  {section:"ניהול"},
  {href:"/companies",    label:"חברות",          icon:"🏛️"},
  {href:"/users",        label:"משתמשים",        icon:"👑"},
  {href:"/restore",      label:"שחזור נתונים",   icon:"🗄"},
  {href:"/errors",       label:"שגיאות ודיווחים", icon:"🐞"},
  {href:"/settings",     label:"הגדרות",         icon:"⚙️"},
  {href:"/guide",        label:"מדריך למשתמש",  icon:"📖"},
];

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { access } = useAccess();
  const { open, setOpen } = useMobileNav();
  const [pendingPay, setPendingPay] = useState(0);
  const [openAlerts, setOpenAlerts] = useState(0);
  const [openErrors, setOpenErrors] = useState(0);

  // Menu filtered by the user's permissions (admin sees all; while access is
  // still loading we show everything — RouteGate blocks navigation anyway).
  // Section headers with no visible items underneath are dropped too.
  const visibleNav: NavItem[] = (function() {
    var items = NAV.filter(function(item) {
      if ("section" in item) return true;
      return !access || canAccessRoute(access, item.href);
    });
    var out: NavItem[] = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if ("section" in it) {
        var hasChild = false;
        for (var j = i + 1; j < items.length; j++) {
          if ("section" in items[j]) break;
          hasChild = true; break;
        }
        if (hasChild) out.push(it);
      } else out.push(it);
    }
    return out;
  })();

  useEffect(function() {
    async function loadBadges() {
      // Badge counts are SCOPED — a user limited to one property must not see
      // counts that include other properties' charges/alerts.
      const scope = await getScopeIds();
      const [{ data: ch }, { data: al }] = await Promise.all([
        supabase.from("charges").select("id,contracts!charges_contract_id_fkey(property_id)").eq("status","pending"),
        // Unread open alerts only — read-but-open alerts stop inflating the badge.
        supabase.from("alerts").select("id,property_id,contracts(property_id)").eq("is_resolved",false).is("read_at", null),
      ]);
      setPendingPay(scopeRows(ch ?? [], scope, function(r: any){ return r.contracts?.property_id; }).length);
      setOpenAlerts(scopeRows(al ?? [], scope, function(a: any){ return a.property_id || a.contracts?.property_id; }).length);
      // Unresolved error reports — RLS returns rows to the master only, so
      // everyone else just gets 0 (and the nav item is hidden anyway).
      const { count: errCount } = await supabase.from("app_errors")
        .select("id", { count: "exact", head: true }).eq("resolved", false);
      setOpenErrors(errCount ?? 0);
    }
    loadBadges();
    const interval = setInterval(loadBadges, 120000);
    return function() { clearInterval(interval); };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login"); router.refresh();
  }

  const BADGES: Record<string,number> = {
    "/payments": pendingPay,
    "/alerts":   openAlerts,
    "/errors":   openErrors,
  };

  async function reportProblem() {
    var text = window.prompt("מה קרה? תארו בקצרה את הבעיה או ההצעה — הדיווח יגיע לבעלי המערכת יחד עם שם המסך הנוכחי:");
    if (!text || !text.trim()) return;
    const { reportAppError } = await import("@/components/ErrorReporting");
    await reportAppError("user_report", text.trim());
    alert("✅ הדיווח נשלח — תודה!");
  }

  return (
    <>
      {/* Mobile overlay — tap to close. Never shown on desktop. */}
      {open && <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setOpen(false); }} aria-hidden="true" />}
      <aside
        dir="rtl"
        className={
          // Mobile: fixed off-canvas drawer (slides from the right in RTL).
          "fixed inset-y-0 right-0 z-50 w-64 max-w-[82vw] shadow-xl transition-transform duration-200 " +
          // Desktop (lg+): IDENTICAL to before — static w-56 sticky sidebar.
          "lg:static lg:inset-auto lg:z-auto lg:w-56 lg:max-w-none lg:shadow-sm lg:transition-none lg:translate-x-0 lg:sticky lg:top-0 " +
          "shrink-0 bg-white border-l border-slate-100 flex flex-col h-screen " +
          (open ? "translate-x-0" : "translate-x-full lg:translate-x-0")
        }>
      {/* Logo */}
      <div className="px-4 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-lg shrink-0">🏙️</div>
          <div>
            <div className="font-black text-slate-800 text-sm leading-tight">PropManager</div>
            <Link href="/whats-new" className="text-xs text-slate-400 leading-tight hover:text-blue-600" title={"מה חדש בגרסה " + APP_VERSION}>
              v{APP_VERSION} 🆕
            </Link>
          </div>
        </div>
        {/* Close button — mobile only */}
        <button onClick={function(){ setOpen(false); }} className="lg:hidden text-slate-400 hover:text-slate-600 text-xl px-1" aria-label="סגור תפריט">✕</button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {visibleNav.map(function(item, idx) {
          if ("section" in item) {
            return <div key={idx} className="px-2 pt-3 pb-1"><div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{item.section}</div></div>;
          }
          const isActive = pathname===item.href || (item.href!=="/dashboard" && pathname.startsWith(item.href));
          const badge = BADGES[item.href] ?? 0;
          return (
            <Link key={item.href} href={item.href}
              className={"flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all mb-0.5 " +
                (isActive?"bg-blue-600 text-white shadow-sm":"text-slate-600 hover:bg-slate-50 hover:text-slate-800")}>
              <span className="text-base shrink-0">{item.icon}</span>
              <span className="truncate flex-1">{item.label}</span>
              {badge > 0 && (
                <span className={"text-xs rounded-full px-1.5 py-0.5 font-bold shrink-0 " +
                  (isActive?"bg-white/30 text-white":"bg-red-100 text-red-600")}>
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Report a problem + Logout */}
      <div className="border-t border-slate-100 p-3 space-y-0.5">
        <button onClick={reportProblem}
          className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-500 hover:bg-amber-50 hover:text-amber-700 transition-colors">
          <span>📣</span><span>דווח על בעיה</span>
        </button>
        <button onClick={handleLogout}
          className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors">
          <span>🚪</span><span>יציאה</span>
        </button>
      </div>
      </aside>
    </>
  );
}
