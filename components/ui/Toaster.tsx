"use client";
import { useEffect, useState } from "react";

// Global toast host. Mounted once in the dashboard layout, it overrides
// window.alert() so every existing alert("…") call across the app renders as a
// styled, non-blocking, RTL toast instead of a jarring browser dialog — without
// editing the ~185 call sites. The kind (success/error/info) is inferred from
// the message. window.confirm() is intentionally left native (it's synchronous).

type Kind = "success" | "error" | "info";
interface Toast { id: number; message: string; kind: Kind; }

function inferKind(msg: string): Kind {
  if (/✅|נשמר|נוצר|הושלם|בוצע|הצלח/.test(msg)) return "success";
  if (/שגיאה|❌|נכשל|⚠️|שגוי|חובה|אין /.test(msg)) return "error";
  return "info";
}

const STYLES: Record<Kind, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: "bg-green-50",  border: "border-green-200",  text: "text-green-800",  icon: "✅" },
  error:   { bg: "bg-red-50",    border: "border-red-200",    text: "text-red-700",    icon: "⚠️" },
  info:    { bg: "bg-blue-50",   border: "border-blue-200",   text: "text-blue-800",   icon: "ℹ️" },
};

let seq = 1;

export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(function () {
    const push = function (message: string, kind?: Kind) {
      const id = seq++;
      const k = kind || inferKind(message);
      setToasts(function (prev) { return prev.concat([{ id: id, message: message, kind: k }]).slice(-5); });
      const ttl = k === "error" ? 6000 : 4000;
      setTimeout(function () { setToasts(function (prev) { return prev.filter(function (t) { return t.id !== id; }); }); }, ttl);
    };

    const w = window as any;
    const originalAlert = w.alert;
    // Replace alert with the toast pusher (strip a leading emoji-only line break).
    w.alert = function (msg?: any) { push(String(msg ?? "")); };
    // Expose for intentional use going forward: window.toast("...", "success").
    w.toast = push;

    return function () { w.alert = originalAlert; if (w.toast === push) delete w.toast; };
  }, []);

  function dismiss(id: number) {
    setToasts(function (prev) { return prev.filter(function (t) { return t.id !== id; }); });
  }

  if (toasts.length === 0) return null;
  return (
    <div dir="rtl" className="fixed top-4 inset-x-0 z-[100] flex flex-col items-center gap-2 pointer-events-none px-4">
      {toasts.map(function (t) {
        const s = STYLES[t.kind];
        return (
          <div
            key={t.id}
            onClick={function () { dismiss(t.id); }}
            className={"pointer-events-auto cursor-pointer max-w-md w-full sm:w-auto sm:min-w-[320px] rounded-xl border shadow-lg px-4 py-3 flex items-start gap-2.5 text-sm font-medium animate-[toastIn_.18s_ease-out] " + s.bg + " " + s.border + " " + s.text}
            role="status"
          >
            <span className="text-base leading-none mt-0.5">{s.icon}</span>
            <span className="flex-1 whitespace-pre-wrap leading-relaxed">{t.message}</span>
            <span className="text-slate-400 hover:text-slate-600 leading-none">×</span>
          </div>
        );
      })}
    </div>
  );
}
