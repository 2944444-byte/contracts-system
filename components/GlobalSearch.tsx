"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

type Result = {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  icon: string;
};

export default function GlobalSearch() {
  const router = useRouter();
  const [open,    setOpen]    = useState(false);
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected,setSelected]= useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // פתיחה ב-Cmd+K / Ctrl+K
  useEffect(function() {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(function() { inputRef.current?.focus(); }, 50);
      }
      if (e.key === "Escape") { setOpen(false); setQuery(""); }
    }
    window.addEventListener("keydown", onKey);
    return function() { window.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(function() {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(function() { search(query); }, 200);
    return function() { clearTimeout(timer); };
  }, [query]);

  async function search(q: string) {
    setLoading(true);
    const like = "%" + q + "%";
    const [{ data: tenants }, { data: properties }, { data: contracts }, { data: spaces }] = await Promise.all([
      supabase.from("tenants").select("id,name,company_name,contact_phone").ilike("name", like).limit(4),
      supabase.from("properties").select("id,name,city").ilike("name", like).limit(3),
      supabase.from("contracts").select("id,status,tenants(name),properties(name)").or("tenants.name.ilike." + like).limit(4),
      supabase.from("spaces").select("id,name,properties(name)").ilike("name", like).limit(3),
    ]);

    const res: Result[] = [];

    (tenants ?? []).forEach(function(t: any) {
      res.push({ type: "tenant", id: t.id, title: t.name, subtitle: t.company_name ?? t.contact_phone, href: "/tenants", icon: "👤" });
    });
    (properties ?? []).forEach(function(p: any) {
      res.push({ type: "property", id: p.id, title: p.name, subtitle: p.city, href: "/properties", icon: "🏢" });
    });
    (contracts ?? []).forEach(function(c: any) {
      res.push({ type: "contract", id: c.id, title: c.tenants?.name ?? "חוזה", subtitle: c.properties?.name, href: "/contracts", icon: "📄" });
    });
    (spaces ?? []).forEach(function(s: any) {
      res.push({ type: "space", id: s.id, title: s.name, subtitle: s.properties?.name, href: "/units", icon: "🚪" });
    });

    setResults(res);
    setSelected(0);
    setLoading(false);
  }

  function navigate(href: string) {
    router.push(href);
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(function(s) { return Math.min(s + 1, results.length - 1); }); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelected(function(s) { return Math.max(s - 1, 0); }); }
    if (e.key === "Enter" && results[selected]) { navigate(results[selected].href); }
  }

  if (!open) return (
    <button onClick={function() { setOpen(true); setTimeout(function() { inputRef.current?.focus(); }, 50); }}
      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-400 hover:bg-white hover:border-slate-300 transition-all">
      <span>🔍</span>
      <span>חיפוש מהיר</span>
      <kbd className="hidden sm:block text-xs bg-slate-200 rounded px-1.5 py-0.5 font-mono">⌘K</kbd>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
      onClick={function() { setOpen(false); setQuery(""); }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden"
        onClick={function(e) { e.stopPropagation(); }}>
        {/* שדה חיפוש */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <span className="text-slate-400 text-lg">🔍</span>
          <input
            ref={inputRef}
            dir="rtl"
            value={query}
            onChange={function(e) { setQuery(e.target.value); }}
            onKeyDown={onKeyDown}
            placeholder="חיפוש שוכרים, נכסים, חוזים..."
            className="flex-1 text-sm text-slate-800 placeholder-slate-400 outline-none bg-transparent"
            autoComplete="off"
          />
          {loading && <span className="text-xs text-slate-400 animate-pulse">מחפש...</span>}
          <kbd className="text-xs text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* תוצאות */}
        {results.length > 0 ? (
          <div className="max-h-80 overflow-y-auto py-1" dir="rtl">
            {results.map(function(r, i) {
              return (
                <button key={r.id + r.type} onClick={function() { navigate(r.href); }}
                  className={"flex items-center gap-3 w-full px-4 py-2.5 text-right transition-colors " +
                    (i === selected ? "bg-blue-50" : "hover:bg-slate-50")}>
                  <span className="text-xl shrink-0">{r.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 text-sm truncate">{r.title}</div>
                    {r.subtitle && <div className="text-xs text-slate-400 truncate">{r.subtitle}</div>}
                  </div>
                  <span className="text-xs text-slate-300 shrink-0">
                    {r.type === "tenant" ? "שוכר" : r.type === "property" ? "נכס" : r.type === "contract" ? "חוזה" : "יחידה"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : query.trim() && !loading ? (
          <div className="py-8 text-center text-slate-400 text-sm" dir="rtl">
            לא נמצאו תוצאות עבור "{query}"
          </div>
        ) : !query.trim() ? (
          <div className="py-6 text-center text-slate-400 text-sm" dir="rtl">
            הקלד לחיפוש...
          </div>
        ) : null}

        {/* footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 text-xs text-slate-400" dir="rtl">
          <span><kbd className="bg-slate-100 rounded px-1">↑↓</kbd> ניווט</span>
          <span><kbd className="bg-slate-100 rounded px-1">Enter</kbd> פתח</span>
          <span><kbd className="bg-slate-100 rounded px-1">Esc</kbd> סגור</span>
        </div>
      </div>
    </div>
  );
}
