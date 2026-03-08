import Sidebar from "../../components/Sidebar";
import ContractSyncer from "../../components/ContractSyncer";
import "../globals.css";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50 flex-row-reverse" dir="rtl">
      <Sidebar />
      <ContractSyncer />
      <main className="flex-1 p-8" style={{ marginRight: 0, marginLeft: 0, minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}
