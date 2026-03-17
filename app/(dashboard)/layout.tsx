import type { ReactNode } from "next";
import Sidebar from "../../components/Sidebar";
import GlobalSearch from "../../components/GlobalSearch";
import AlertsBadge from "../../components/AlertsBadge";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50" dir="rtl">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="sticky top-0 z-20 bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between shadow-sm shrink-0">
          <GlobalSearch />
          <div className="flex items-center gap-2">
            <AlertsBadge />
            <span className="text-xs text-slate-400 font-medium hidden md:block">PropManager v4</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
