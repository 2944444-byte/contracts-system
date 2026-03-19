"use client";
import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://ndvcqgrpsqykhodiyrhx.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kdmNxZ3Jwc3F5a2hvZGl5cmh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIwNjMwODgsImV4cCI6MjA1NzYzOTA4OH0.mS9MjwuBH7MkOEXmEIJCQF5uPBvkKk_c60lP7m6RI_c"
);

export default function LoginPage() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) { setError("נא מלא אימייל וסיסמה"); return; }
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) throw err;
      if (data.session) {
        // שימוש ב-window.location במקום router - מבטיח reload מלא עם cookies
        window.location.href = "/dashboard";
      }
    } catch (e: any) {
      setError(e.message === "Invalid login credentials" ? "אימייל או סיסמה שגויים" : e.message || "שגיאה");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900" dir="rtl">
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4 shadow-xl">
            <span className="text-3xl">🏙️</span>
          </div>
          <h1 className="text-2xl font-black text-white">PropManager v4</h1>
          <p className="text-blue-300 text-sm mt-1">ניהול נכסים מסחריים</p>
        </div>
        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-bold text-slate-800 text-center mb-6">כניסה למערכת</h2>
          <form onSubmit={handleLogin} className="space-y-4" noValidate>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">אימייל</label>
              <input
                type="email" value={email}
                onChange={function(e) { setEmail(e.target.value); setError(""); }}
                placeholder="your@email.com" autoComplete="email" dir="ltr"
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">סיסמה</label>
              <input
                type="password" value={password}
                onChange={function(e) { setPassword(e.target.value); setError(""); }}
                placeholder="••••••••" autoComplete="current-password"
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 text-center font-semibold">
                ⚠️ {error}
              </div>
            )}
            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 py-3 text-white font-bold text-sm transition-colors">
              {loading ? "מתחבר..." : "כניסה →"}
            </button>
          </form>
        </div>
        <p className="text-center text-blue-400/50 text-xs mt-4">PropManager v4 © {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}
