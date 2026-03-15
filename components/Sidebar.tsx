"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

const NAV = [
  { section: "ראשי" },
  { href: "/dashboard",   label: "דשבורד",       icon: "⊞" },
  { href: "/properties",  label: "נכסים",         icon: "🏢" },
  { href: "/groups",      label: "קבוצות נכסים",  icon: "🏗️" },
  { href: "/units",       label: "יחידות",        icon: "🚪" },
  { href: "/parking",     label: "חניה",          icon: "🅿️" },
  { href: "/tenants",     label: "שוכרים",        icon: "👥" },
  { href: "/contracts",   label: "חוזים",         icon: "📄" },
  { section: "כספים" },
  { href: "/payments",    label: "חיובים",        icon: "₪"  },
  { href: "/management",  label: "דמי ניהול",     icon: "🔧" },
  { href: "/indexation",  label: "הצמדה למדד",    icon: "📈" },
  { href: "/revenue",      label: "שכ\"ד פידיון",   icon: "📊" },
  { section: "תפעול" },
  { href: "/guarantees",  label: "ערבויות",       icon: "🏦" },
  { href: "/insurances",  label: "ביטוחים",       icon: "🛡️" },
  { href: "/safety",      label: "בטיחות",        icon: "🔒" },
  { href: "/documents",   label: "מסמכים",        icon: "🗂️" },
  { href: "/letters",     label: "מכתבים",        icon: "✉️" },
  { section: "ניהול" },
  { href: "/reports",     label: "דוחות",         icon: "📊" },
  { href: "/alerts",      label: "התראות",        icon: "🔔" },
  { href: "/companies",   label: "חברות",         icon: "🏛️" },
  { href: "/users",       label: "משתמשים",       icon: "👑" },
  { href: "/settings",    label: "הגדרות",        icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="flex h-screen w-56 flex-col border-l border-slate-200 bg-white shadow-sm" dir="rtl">
      {/* לוגו */}
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="text-lg font-black text-blue-700">🏙️ PropManager</div>
        <div className="text-xs text-slate-400 mt-0.5">ניהול נכסים מסחריים</div>
      </div>

      {/* ניווט */}
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map(function(item, i) {
          if ("section" in item) {
            return (
              <div key={i} className="px-5 pt-4 pb-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{item.section}</div>
              </div>
            );
          }
          const isActive = pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href as string));
          return (
            <Link key={item.href} href={item.href as string}
              className={"flex items-center gap-2.5 px-5 py-2 text-sm transition-colors " +
                (isActive ? "bg-blue-50 text-blue-700 font-semibold border-r-2 border-r-blue-600" :
                  "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}>
              <span className="text-base w-5 text-center">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* יציאה */}
      <div className="border-t border-slate-100 px-5 py-3">
        <button onClick={handleLogout}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-red-500 transition-colors w-full">
          <span>🚪</span>
          <span>יציאה מהמערכת</span>
        </button>
      </div>
    </aside>
  );
}
