"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const navItems = [
  { href: "/dashboard",   label: "דשבורד",         icon: "⊞"  },
  { href: "/properties",  label: "נכסים",           icon: "🏢" },
  { href: "/units",       label: "יחידות",          icon: "🚪" },
  { href: "/tenants",     label: "שוכרים",          icon: "👥" },
  { href: "/contracts",   label: "חוזים",           icon: "📄" },
  { href: "/payments",    label: "חיובים",          icon: "₪"  },
  { href: "/management",  label: "דמי ניהול",       icon: "🔧" },
  { href: "/letters",     label: "מכתבים",          icon: "✉"  },
  { href: "/reports",     label: "דוחות",           icon: "📊" },
  { href: "/alerts",      label: "התראות",          icon: "🔔", badge: true },
  { href: "/indexation",  label: "חישוב הצמדות",   icon: "🔢" },
  { href: "/insurances",  label: "ביטוחים",         icon: "🛡️" },
  { href: "/safety",      label: "בדיקות בטיחות",   icon: "🔒" },
  { href: "/documents",   label: "מסמכים",          icon: "🗂" },
  { href: "/settings",    label: "הגדרות",          icon: "⚙"  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [alertCount, setAlertCount] = useState(0);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("is_handled", false)
      .then(function({ count }) { setAlertCount(count ?? 0); });

    supabase.auth.getUser().then(function({ data }) { setUser(data?.user); });
  }, [pathname]);

  return (
    <aside className="w-56 shrink-0 bg-white border-l border-slate-100 flex flex-col h-screen sticky top-0 shadow-sm">
      {/* לוגו */}
      <div className="px-5 py-5 border-b border-slate-100">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-2xl">🏙</span>
          <div>
            <div className="font-bold text-slate-800 text-sm leading-tight">PropManager</div>
            <div className="text-xs text-slate-400 leading-tight">מערכת ניהול נכסים</div>
          </div>
        </Link>
      </div>

      {/* ניווט */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {navItems.map(function(item) {
          const isActive = pathname === item.href || (pathname?.startsWith(item.href + "/") ?? false);
          return (
            <Link key={item.href} href={item.href}
              className={"flex items-center justify-between gap-2.5 rounded-lg px-3 py-2 mb-0.5 text-sm transition-colors " +
                (isActive
                  ? "bg-blue-700 text-white font-semibold"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-800")}>
              <div className="flex items-center gap-2.5">
                <span className="text-base w-5 text-center">{item.icon}</span>
                <span>{item.label}</span>
              </div>
              {item.badge && alertCount > 0 && (
                <span className={"text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center " +
                  (isActive ? "bg-white/20 text-white" : "bg-red-500 text-white")}>
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* משתמש */}
      <div className="px-4 py-3 border-t border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-white text-sm font-bold shrink-0">
            {user?.email?.[0]?.toUpperCase() ?? "א"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-700 truncate">
              {user?.email ?? "אדמין"}
            </div>
            <button
              onClick={function() { supabase.auth.signOut().then(function() { window.location.href = "/"; }); }}
              className="text-xs text-slate-400 hover:text-red-500 transition-colors">
              התנתק
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
