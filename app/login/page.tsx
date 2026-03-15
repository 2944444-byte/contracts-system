"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  async function handleLogin() {
    if (!email || !password) { setError("נא למלא אימייל וסיסמה"); return; }
    setLoading(true); setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setError("אימייל או סיסמה שגויים"); setLoading(false); return; }
    router.push("/dashboard");
  }

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* לוגו */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🏙️</div>
          <h1 className="text-3xl font-black text-white">PropManager</h1>
          <p className="text-blue-200 mt-1">מערכת ניהול נכסים מסחריים</p>
        </div>

        {/* כרטיס */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-bold text-slate-800 mb-6 text-center">כניסה למערכת</h2>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">אימייל</label>
              <input
                type="email" value={email}
                onChange={function(e) { setEmail(e.target.value); }}
                onKeyDown={function(e) { if (e.key === "Enter") handleLogin(); }}
                placeholder="admin@company.co.il"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">סיסמה</label>
              <input
                type="password" value={password}
                onChange={function(e) { setPassword(e.target.value); }}
                onKeyDown={function(e) { if (e.key === "Enter") handleLogin(); }}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 text-center">
                ⚠️ {error}
              </div>
            )}

            <button
              onClick={handleLogin} disabled={loading}
              className="w-full rounded-xl bg-blue-700 py-3.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50 transition-colors mt-2">
              {loading ? "מתחבר..." : "כניסה →"}
            </button>
          </div>

          <p className="text-center text-xs text-slate-400 mt-6">
            PropManager v4.0 | מערכת מאובטחת
          </p>
        </div>
      </div>
    </div>
  );
}
