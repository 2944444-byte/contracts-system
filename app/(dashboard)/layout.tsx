import Sidebar from "../../components/Sidebar";
import ContractSyncer from "../../components/ContractSyncer";
import { GlobalSearch } from "../../components/GlobalSearch";
import "../globals.css";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50 flex-row-reverse" dir="rtl">
      <Sidebar />
      <ContractSyncer />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header עם חיפוש */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-100 shadow-sm px-6 py-3 flex items-center justify-between">
          <GlobalSearch />
          <div className="text-xs text-slate-400">PropManager v4</div>
        </header>
        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
