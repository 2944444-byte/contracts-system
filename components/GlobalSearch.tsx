"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';

type Result = {type:string;id:string;title:string;subtitle?:string;href:string;icon:string};

const QUICK = [
  {label:"חוזה חדש",  href:"/contracts/new", icon:"📄", bg:"bg-blue-600"    },
  {label:"שוכר חדש",  href:"/tenants",        icon:"👤", bg:"bg-emerald-600" },
  {label:"חיוב",       href:"/payments",       icon:"💳", bg:"bg-purple-600"  },
  {label:"ערבות",     href:"/guarantees",     icon:"🏦", bg:"bg-teal-600"    },
  {label:"התראות",    href:"/alerts",         icon:"🔔", bg:"bg-orange-500"  },
  {label:"דוחות",     href:"/reports",        icon:"📋", bg:"bg-slate-600"   },
];

export default function GlobalSearch() {
  const router  = useRouter();
  const [open,    setOpen]    = useState(false);
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel,     setSel]     = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<any>(null);

  useEffect(function() {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey||e.ctrlKey)&&e.key==="k") { e.preventDefault(); setOpen(true); setTimeout(function(){inputRef.current?.focus();},60); }
      if (e.key==="Escape") { setOpen(false); setQuery(""); setResults([]); }
    }
    window.addEventListener("keydown",onKey);
    return function(){window.removeEventListener("keydown",onKey);};
  }, []);

  useEffect(function() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(function(){doSearch(query);}, 180);
    return function(){if(timerRef.current)clearTimeout(timerRef.current);};
  }, [query]);

  async function doSearch(q: string) {
    setLoading(true);
    const like="%"+q+"%";
    const [{ data: t }, { data: p }, { data: c }, { data: g }] = await Promise.all([
      supabase.from("tenants").select("id,name,company_name").ilike("name",like).limit(4),
      supabase.from("properties").select("id,name,city").ilike("name",like).limit(3),
      supabase.from("contracts").select("id,status,tenants(name),properties(name)").in("status",["active","expiring"]).limit(3),
      supabase.from("guarantees").select("id,guarantee_type,contracts(tenants(name))").eq("status","active").limit(2),
    ]);
    const res: Result[] = [];
    (t??[]).forEach(function(x:any){res.push({type:"tenant",   id:x.id,title:x.name,subtitle:x.company_name,href:"/tenants",    icon:"👤"});});
    (p??[]).forEach(function(x:any){res.push({type:"property", id:x.id,title:x.name,subtitle:x.city,         href:"/properties", icon:"🏢"});});
    (c??[]).forEach(function(x:any){res.push({type:"contract", id:x.id,title:x.tenants?.name??"חוזה",subtitle:x.properties?.name,href:"/contracts",icon:"📄"});});
    setResults(res); setSel(0); setLoading(false);
  }

  function go(href: string) { router.push(href); setOpen(false); setQuery(""); setResults([]); }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key==="ArrowDown") { e.preventDefault(); setSel(function(s){return Math.min(s+1,(results.length||QUICK.length)-1);}); }
    if (e.key==="ArrowUp")   { e.preventDefault(); setSel(function(s){return Math.max(s-1,0);}); }
    if (e.key==="Enter") {
      if (results.length>0 && results[sel]) go(results[sel].href);
      else if (!query.trim() && QUICK[sel]) go(QUICK[sel].href);
    }
  }

  if (!open) return (
    <button onClick={function(){setOpen(true);setTimeout(function(){inputRef.current?.focus();},60);}}
      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-400 hover:bg-white hover:border-slate-300 transition-all">
      <span>🔍</span>
      <span className="hidden sm:block">חיפוש מהיר...</span>
      <kbd className="hidden sm:block text-xs bg-slate-200 text-slate-500 rounded px-1.5 py-0.5 font-mono">⌘K</kbd>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/40 backdrop-blur-sm"
      onClick={function(){setOpen(false);setQuery("");}}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden"
        onClick={function(e){e.stopPropagation();}}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <span className="text-slate-400">🔍</span>
          <input ref={inputRef} dir="rtl" value={query}
            onChange={function(e){setQuery(e.target.value);}} onKeyDown={onKeyDown}
            placeholder="חפש שוכרים, נכסים, חוזים..."
            className="flex-1 text-sm text-slate-800 placeholder-slate-400 outline-none bg-transparent"/>
          {loading && <div className="w-4 h-4 rounded-full border-2 border-blue-300 border-t-blue-600 animate-spin shrink-0"/>}
          <kbd className="text-xs text-slate-300 bg-slate-100 rounded px-1.5 py-0.5 shrink-0">Esc</kbd>
        </div>

        {results.length>0 ? (
          <div className="max-h-72 overflow-y-auto py-1" dir="rtl">
            {results.map(function(r,i){
              return (
                <button key={r.id+r.type} onClick={function(){go(r.href);}}
                  className={"flex items-center gap-3 w-full px-4 py-2.5 text-right transition-colors "+(i===sel?"bg-blue-50":"hover:bg-slate-50")}>
                  <span className="text-xl shrink-0">{r.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 text-sm truncate">{r.title}</div>
                    {r.subtitle&&<div className="text-xs text-slate-400 truncate">{r.subtitle}</div>}
                  </div>
                  <span className="text-xs text-slate-300 bg-slate-100 rounded-full px-2 py-0.5 shrink-0">
                    {r.type==="tenant"?"שוכר":r.type==="property"?"נכס":"חוזה"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : query.trim()&&!loading ? (
          <div className="py-8 text-center text-slate-400 text-sm" dir="rtl">לא נמצאו תוצאות עבור "{query}"</div>
        ) : (
          <div className="p-3" dir="rtl">
            <div className="text-xs font-semibold text-slate-400 mb-2 px-1">⚡ פעולות מהירות</div>
            <div className="grid grid-cols-3 gap-2">
              {QUICK.map(function(q,i){
                return (
                  <button key={q.href} onClick={function(){go(q.href);}}
                    className={"flex flex-col items-center gap-1 p-2.5 rounded-xl text-center transition-all hover:opacity-90 text-white ring-2 " + q.bg + (sel===i?" ring-white":"ring-transparent")}>
                    <span className="text-xl">{q.icon}</span>
                    <span className="text-xs font-semibold">{q.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-4 px-4 py-2 border-t border-slate-100 text-xs text-slate-400" dir="rtl">
          <span><kbd className="bg-slate-100 rounded px-1">↑↓</kbd> ניווט</span>
          <span><kbd className="bg-slate-100 rounded px-1">↵</kbd> פתח</span>
          <span><kbd className="bg-slate-100 rounded px-1">Esc</kbd> סגור</span>
        </div>
      </div>
    </div>
  );
}
