import type { ReactNode } from "react";
import Sidebar from "../../components/Sidebar";
import GlobalSearch from "../../components/GlobalSearch";
import AlertsBadge from "../../components/AlertsBadge";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50" dir="rtl">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-white border-b border-slate-100 px-6 py-3 flex items-center justify-between shadow-sm">
          <GlobalSearch />
          <div className="flex items-center gap-3">
            <AlertsBadge />
            <div className="text-xs text-slate-400 font-medium">PropManager v4</div>
          </div>
        </header>
        {/* תוכן */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
