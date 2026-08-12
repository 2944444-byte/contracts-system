"use client";
import React from "react";
import { supabase } from "@/lib/supabase";

// שכבת הניטור: משתמשים לא מדווחים על שגיאות — האפליקציה חייבת. כל קריסת
// מסך (ErrorBoundary), שגיאה גלובלית או promise שנשבר נרשמים ל-app_errors;
// בעלי המערכת רואים אותם במסך "שגיאות ודיווחים". שקט לחלוטין למשתמש —
// חוץ מקריסת מסך, שם מוצג מסך ידידותי במקום הלבן.

let seen: Record<string, boolean> = {};
let sentThisSession = 0;

export async function reportAppError(kind: "client_error" | "unhandled_promise" | "user_report", message: string, stack?: string) {
  try {
    // Throttle: one report per distinct message, max 8 per session — a render
    // loop must not flood the table.
    var key = kind + "|" + message.slice(0, 200);
    if (kind !== "user_report") {
      if (seen[key] || sentThisSession >= 8) return;
      seen[key] = true; sentThisSession++;
    }
    var uid: string | null = null, email: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      uid = data?.user?.id ?? null; email = data?.user?.email ?? null;
    } catch (e) { /* not signed in */ }
    await supabase.from("app_errors").insert({
      user_id: uid, email: email,
      route: typeof window !== "undefined" ? window.location.pathname : null,
      kind: kind,
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 6000) : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
    });
  } catch (e) { /* reporting must never throw */ }
}

// Global handlers — errors outside React's render tree (async, events).
export function GlobalErrorCatcher() {
  React.useEffect(function () {
    function onError(ev: ErrorEvent) {
      reportAppError("client_error", ev.message || "window.onerror", ev.error?.stack);
    }
    function onRejection(ev: PromiseRejectionEvent) {
      var r: any = ev.reason;
      reportAppError("unhandled_promise", r?.message || String(r), r?.stack);
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return function () {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

// Render-crash boundary: reports, then shows a friendly Hebrew screen instead
// of the blank "Application error".
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { crashed: boolean }> {
  constructor(props: any) { super(props); this.state = { crashed: false }; }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(error: any, info: any) {
    reportAppError("client_error", error?.message || String(error), (error?.stack || "") + "\n--component stack--" + (info?.componentStack || ""));
  }
  render() {
    if (this.state.crashed) {
      return (
        <div dir="rtl" className="flex items-center justify-center min-h-[60vh] p-6">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-8 text-center max-w-md">
            <div className="text-5xl mb-3">🛠</div>
            <div className="text-lg font-bold text-slate-800 mb-1">משהו השתבש במסך הזה</div>
            <div className="text-sm text-slate-500 mb-1">הפרטים המלאים כבר דווחו אוטומטית לבעלי המערכת ✓</div>
            <div className="text-xs text-slate-400 mb-4">אפשר לנסות לרענן — בדרך כלל זה פותר את זה. אם זה חוזר, עברו למסך אחר בינתיים.</div>
            <div className="flex gap-2 justify-center">
              <button onClick={function(){ window.location.reload(); }}
                className="rounded-xl bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800">🔄 רענן את המסך</button>
              <button onClick={function(){ window.location.href = "/dashboard"; }}
                className="rounded-xl border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-50">לדשבורד</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children as any;
  }
}
