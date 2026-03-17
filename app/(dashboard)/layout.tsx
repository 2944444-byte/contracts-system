import type { ReactNode } from "react";
import Sidebar from "../../components/Sidebar";
import GlobalSearch from "../../components/GlobalSearch";
import AlertsBadge from "../../components/AlertsBadge";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50" dir="rtl">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between shadow-sm">
          <GlobalSearch />
          <div className="flex items-center gap-2">
            <AlertsBadge />
            <span className="text-xs text-slate-400 font-medium hidden sm:block">PropManager v4</span>
          </div>
        </header>
        <main className="flex-1 p-5 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
