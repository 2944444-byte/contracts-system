import type { ReactNode } from "react";
import Sidebar from "../../components/Sidebar";
import GlobalSearch from "../../components/GlobalSearch";
import AlertsBadge from "../../components/AlertsBadge";
import UserBadge from "../../components/UserBadge";
import Toaster from "../../components/ui/Toaster";
import AccessProvider, { RouteGate } from "../../components/AccessProvider";
import { MobileNavProvider, MobileMenuButton } from "../../components/MobileNav";
import { AppErrorBoundary, GlobalErrorCatcher } from "../../components/ErrorReporting";
import EnvBadge from "../../components/EnvBadge";
import Link from "next/link";
import { APP_VERSION } from "../../lib/version";

function VersionTag() {
  return (
    <Link href="/whats-new" className="hidden md:flex items-center gap-1 text-xs text-slate-400 font-medium hover:text-blue-600" title="מה חדש">
      <span>🆕</span>
      <span>PropManager v{APP_VERSION}</span>
    </Link>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AccessProvider>
      <MobileNavProvider>
        <div className="flex min-h-screen bg-slate-50" dir="rtl">
          <Toaster />
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <header className="sticky top-0 z-20 bg-white border-b border-slate-100 px-3 sm:px-5 py-3 flex items-center justify-between gap-2 shadow-sm shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <MobileMenuButton />
                <GlobalSearch />
              </div>
              <div className="flex items-center gap-3">
                <EnvBadge />
                <AlertsBadge />
                <UserBadge />
                <VersionTag />
              </div>
            </header>
            {/* Mobile: allow wide tables to scroll horizontally within the content
                area instead of being clipped. Desktop (lg) is unchanged. */}
            <main className="flex-1 overflow-y-auto overflow-x-auto lg:overflow-x-hidden p-3 sm:p-4 lg:p-5">
              {/* Central section-level enforcement — every dashboard route passes
                  through this gate; no per-screen guards needed. */}
              <GlobalErrorCatcher />
              {/* A screen crash reports itself and shows a friendly fallback
                  instead of the blank "Application error". */}
              <AppErrorBoundary>
                <RouteGate>{children}</RouteGate>
              </AppErrorBoundary>
            </main>
          </div>
        </div>
      </MobileNavProvider>
    </AccessProvider>
  );
}
