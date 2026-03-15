"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

interface SearchResult {
  type: "contract" | "tenant" | "property" | "space";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon: string;
}

export function GlobalSearch() {
  const router = useRouter();
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // סגור בלחיצה מחוץ
  useEffect(function() {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return function() { document.removeEventListener("mousedown", handleClick); };
  }, []);

  // קיצור מקשים: Cmd+K / Ctrl+K
  useEffect(function() {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") { setOpen(false); setQuery(""); }
    }
    document.addEventListener("keydown", handleKey);
    return function() { document.removeEventListener("keydown", handleKey); };
  }, []);

  useEffect(function() {
    if (!query || query.length < 2) { setResults([]); return; }
    const timer = setTimeout(function() { doSearch(query); }, 250);
    return function() { clearTimeout(timer); };
  }, [query]);

  async function doSearch(q: string) {
    setLoading(true);
    try {
      const [{ data: tenants }, { data: properties }, { data: contracts }, { data: spaces }] = await Promise.all([
        supabase.from("tenants").select("id, name").ilike("name", "%" + q + "%").limit(4),
        supabase.from("properties").select("id, name, address").ilike("name", "%" + q + "%").limit(4),
        supabase.from("contracts")
          .select("id, tenants(name), properties(name), status")
          .or("status.eq.active,status.eq.expiring,status.eq.extended")
          .limit(4),
        supabase.from("spaces").select("id, space_name, space_type, properties(name)").ilike("space_name", "%" + q + "%").limit(3),
      ]);

      const res: SearchResult[] = [];
      (tenants ?? []).forEach(function(t: any) {
        res.push({ type: "tenant", id: t.id, title: t.name, subtitle: "שוכר", href: "/tenants", icon: "👥" });
      });
      (properties ?? []).forEach(function(p: any) {
        res.push({ type: "property", id: p.id, title: p.name, subtitle: p.address ?? "נכס", href: "/properties", icon: "🏢" });
      });
      (contracts ?? []).forEach(function(c: any) {
        const title = (c.tenants?.name ?? "") + " — " + (c.properties?.name ?? "");
        if (title.toLowerCase().includes(q.toLowerCase()) || c.tenants?.name?.includes(q) || c.properties?.name?.includes(q)) {
          res.push({ type: "contract", id: c.id, title, subtitle: "חוזה", href: "/contracts", icon: "📄" });
        }
      });
      (spaces ?? []).forEach(function(s: any) {
        res.push({ type: "space", id: s.id, title: s.space_name, subtitle: s.properties?.name ?? "יחידה", href: "/units", icon: "🚪" });
      });
      setResults(res.slice(0, 8));
    } finally { setLoading(false); }
  }

  function handleSelect(result: SearchResult) {
    router.push(result.href);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm hover:border-slate-300 transition-colors"
        onClick={function() { inputRef.current?.focus(); setOpen(true); }}>
        <span className="text-slate-400 text-sm">🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={function(e) { setQuery(e.target.value); setOpen(true); }}
          placeholder="חיפוש... (⌘K)"
          className="bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none w-48 text-right"
          dir="rtl"
        />
        {loading && <span className="text-slate-300 text-xs animate-spin">⟳</span>}
      </div>

      {open && (query.length >= 2) && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden"
          dir="rtl">
          {results.length === 0 && !loading ? (
            <div className="px-4 py-6 text-center text-slate-400 text-sm">
              לא נמצאו תוצאות עבור &quot;{query}&quot;
            </div>
          ) : (
            <div>
              {results.map(function(r, i) {
                return (
                  <button key={r.id + i}
                    onClick={function() { handleSelect(r); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-blue-50 border-b border-slate-100 last:border-0 transition-colors">
                    <span className="text-lg shrink-0">{r.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{r.title}</div>
                      <div className="text-xs text-slate-400">{r.subtitle}</div>
                    </div>
                    <span className="text-slate-300 text-xs shrink-0">←</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
