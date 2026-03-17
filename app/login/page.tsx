"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const router   = useRouter();
  const [email,    setEmail]    = useState("2944444@gmail.com");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) { setError("נא למלא אימייל וסיסמה"); return; }
    setLoading(true); setError("");
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) throw err;
      router.push("/dashboard");
      router.refresh();
    } catch(e: any) {
      setError(e?.message?.includes("Invalid") ? "אימייל או סיסמה שגויים" : e?.message ?? "שגיאת כניסה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4" dir="rtl">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{backgroundImage:"radial-gradient(circle at 25% 25%, #3b82f6 0%, transparent 50%), radial-gradient(circle at 75% 75%, #1e40af 0%, transparent 50%)"}} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-2xl mb-4">
            <span className="text-3xl">🏙️</span>
          </div>
          <h1 className="text-3xl font-black text-white">PropManager</h1>
          <p className="text-blue-300 text-sm mt-1">מערכת ניהול נכסים מסחריים</p>
        </div>

        {/* Card */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl">
          <h2 className="text-xl font-bold text-white mb-6 text-center">כניסה למערכת</h2>

          {error && (
            <div className="mb-5 rounded-xl bg-red-500/20 border border-red-400/30 px-4 py-3 text-sm text-red-200 text-center">
              ⚠️ {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-blue-200">אימייל</label>
              <input
                type="email"
                dir="ltr"
                value={email}
                onChange={function(e) { setEmail(e.target.value); }}
                autoComplete="email"
                placeholder="your@email.com"
                className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder-blue-300/50 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30 transition-all"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-blue-200">סיסמה</label>
              <input
                type="password"
                value={password}
                onChange={function(e) { setPassword(e.target.value); }}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder-blue-300/50 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-xl bg-blue-600 py-3.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/25">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  מתחבר...
                </span>
              ) : "כניסה →"}
            </button>
          </form>
        </div>

        <p className="text-center text-blue-400/60 text-xs mt-6">PropManager v4.0 | מערכת מאובטחת</p>
      </div>
    </div>
  );
}
