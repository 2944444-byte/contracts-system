"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getCurrentAccess, canAccessRoute, type CurrentAccess } from "@/lib/permissions";

// Loads the logged-in user's role/permissions/scope ONCE per session and shares
// it app-wide. RouteGate enforces section access centrally — no screen needs its
// own guard (the users screen keeps its finer-grained one).
const AccessContext = createContext<{ access: CurrentAccess | null; loading: boolean }>({ access: null, loading: true });

export function useAccess() { return useContext(AccessContext); }

export default function AccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess]   = useState<CurrentAccess | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(function () {
    var cancelled = false;
    getCurrentAccess().then(function (a) { if (!cancelled) { setAccess(a); setLoading(false); } });
    return function () { cancelled = true; };
  }, []);
  return <AccessContext.Provider value={{ access: access, loading: loading }}>{children}</AccessContext.Provider>;
}

export function RouteGate({ children }: { children: ReactNode }) {
  const { access, loading } = useAccess();
  const pathname = usePathname();
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 text-sm gap-2">
        <span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>
        טוען הרשאות...
      </div>
    );
  }
  if (access && !canAccessRoute(access, pathname || "")) {
    return (
      <div dir="rtl" className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400 mt-8">
        <div className="text-5xl mb-3">🔒</div>
        <div className="font-semibold text-slate-600">אין לך הרשאה למסך זה</div>
        <div className="text-sm mt-1">פנה למנהל המערכת להרחבת ההרשאות</div>
      </div>
    );
  }
  return <>{children}</>;
}
