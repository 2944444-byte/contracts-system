"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

export default function AlertsBadge() {
  const router  = useRouter();
  const [count, setCount] = useState(0);

  useEffect(function() {
    async function load() {
      const { count: c } = await supabase.from("alerts")
        .select("id", { count: "exact", head: true })
        .eq("status", "open");
      setCount(c ?? 0);
    }
    load();
    const interval = setInterval(load, 60000); // refresh every minute
    return function() { clearInterval(interval); };
  }, []);

  return (
    <button onClick={function() { router.push("/alerts"); }}
      className="relative p-2 rounded-xl hover:bg-slate-100 transition-colors">
      <span className="text-lg">🔔</span>
      {count > 0 && (
        <span className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
