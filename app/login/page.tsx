"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const router   = useRouter();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [showPw,   setShowPw]   = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()||!password) { setError("נא מלא אימייל וסיסמה"); return; }
    setLoading(true); setError("");
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) throw err;
      router.push("/dashboard"); router.refresh();
    } catch(e: any) {
      setError(e.message==="Invalid login credentials"?"אימייל או סיסמה שגויים":e.message??"שגיאת כניסה");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-950 via-slate-900 to-blue-900" dir="rtl">
      {/* רקע */}
      <div className="absolute inset-0 overflow-hidden">
        {[{s:"w-96 h-96",t:"top-10",l:"left-10",o:"opacity-10"},{s:"w-64 h-64",t:"bottom-20",r:"right-20",o:"opacity-5"},{s:"w-48 h-48",t:"top-1/2",l:"left-1/2",o:"opacity-10"}].map(function(b,i){return (
          <div key={i} className={"absolute rounded-full bg-blue-400 blur-3xl "+b.s+" "+b.o} style={{top:b.t,left:b.l,right:b.r,transform:b.t==="top-1/2"?"translate(-50%,-50%)":undefined}}/>
        );})}
      </div>

      <div className="relative w-full max-w-sm mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-2xl mb-4">
            <span className="text-3xl">🏙️</span>
          </div>
          <h1 className="text-2xl font-black text-white">PropManager</h1>
          <p className="text-blue-300 text-sm mt-1">ניהול נכסים מסחריים v4</p>
        </div>

        {/* Card */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl">
          <h2 className="text-xl font-bold text-white text-center mb-6">כניסה למערכת</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-blue-200 mb-1.5">אימייל</label>
              <input type="email" value={email} onChange={function(e){setEmail(e.target.value);setError("");}}
                placeholder="your@email.com" dir="ltr"
                className="w-full rounded-xl bg-white/10 border border-white/20 px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent text-sm transition-all"/>
            </div>
            <div>
              <label className="block text-sm font-semibold text-blue-200 mb-1.5">סיסמה</label>
              <div className="relative">
                <input type={showPw?"text":"password"} value={password} onChange={function(e){setPassword(e.target.value);setError("");}}
                  placeholder="••••••••"
                  className="w-full rounded-xl bg-white/10 border border-white/20 px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent text-sm transition-all"/>
                <button type="button" onClick={function(){setShowPw(!showPw);}}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 text-sm">
                  {showPw?"🙈":"👁"}
                </button>
              </div>
            </div>

            {error&&(
              <div className="rounded-xl bg-red-500/20 border border-red-400/30 px-4 py-3 text-sm text-red-300 text-center">
                ⚠️ {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:opacity-60 py-3 text-white font-bold text-sm transition-all shadow-lg hover:shadow-blue-500/25 mt-2">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"/>
                  מתחבר...
                </span>
              ) : "כניסה →"}
            </button>
          </form>
        </div>

        <p className="text-center text-blue-400/60 text-xs mt-6">
          PropManager v4 © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
