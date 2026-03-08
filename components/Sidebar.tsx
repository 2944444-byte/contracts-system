"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "דשבורד", icon: "⊞" },
  { href: "/properties", label: "נכסים", icon: "🏢" },
  { href: "/units", label: "יחידות", icon: "🚪" },
  { href: "/tenants", label: "שוכרים", icon: "👥" },
  { href: "/contracts", label: "חוזים", icon: "📄" },
  { href: "/billing", label: "חיובים", icon: "₪" },
  { href: "/letters", label: "מכתבים", icon: "✉" },
  { href: "/reports", label: "דוחות", icon: "📊" },
  { href: "/alerts", label: "התראות", icon: "🔔" },
  { href: "/cpi", label: "מדד המחירים", icon: "📊" },
    { href: "/documents", label: "מסמכים", icon: "🗂" },
  { href: "/settings", label: "הגדרות", icon: "⚙" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="flex h-screen w-56 flex-col border-l border-slate-200 bg-white shadow-sm"
      dir="rtl"
    >
      {/* לוגו */}
      <div className="border-b border-slate-100 px-5 py-5">
        <div className="text-lg font-bold text-blue-700">🏙 PropManager</div>
        <div className="mt-0.5 text-xs text-slate-400">מערכת ניהול נכסים</div>
      </div>

      {/* ניווט */}
      <nav className="flex-1 overflow-y-auto py-3">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-blue-50 font-semibold text-blue-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
              {item.href === "/alerts" && (
                <span className="mr-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  3
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* משתמש */}
      <div className="border-t border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
            א
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-700">אדמין</div>
            <div className="text-[10px] text-slate-400">admin@prop.co.il</div>
          </div>
        </div>
      </div>
    </aside>
  );
}