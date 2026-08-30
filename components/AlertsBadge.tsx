"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { getScopeIds, scopeRows } from '@/lib/permissions';

export default function AlertsBadge() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [urgent, setUrgent] = useState(0);
  const [openTotal, setOpenTotal] = useState(0);

  useEffect(function() {
    loadCount();
    // רענון כל 2 דקות
    const interval = setInterval(loadCount, 120000);
    return function() { clearInterval(interval); };
  }, []);

  async function loadCount() {
    // Count UNREAD open alerts — marked-read alerts stop inflating the badge;
    // an escalation resets read_at so the alert counts (and pops) again.
    // SCOPED: only alerts of the user's allowed properties are counted.
    const scope = await getScopeIds();
    const { data } = await supabase.from("alerts")
      .select("id,severity,read_at,property_id,contracts(property_id)").eq("is_resolved",false);
    const all = scopeRows(data ?? [], scope, function(a: any){ return a.property_id || a.contracts?.property_id; });
    const unread = all.filter(function(a: any){ return !a.read_at; });
    setOpenTotal(all.length);
    setCount(unread.length);
    setUrgent(unread.filter(function(a){return a.severity==="urgent";}).length);
  }

  if (count === 0) return null;

  return (
    <button onClick={function(){router.push("/alerts");}}
      title={count + " התראות חדשות (שטרם נקראו) מתוך " + openTotal + " פתוחות בסך הכול" + (urgent > 0 ? " · " + urgent + " מהחדשות דחופות (העיגול האדום)" : "") + " — לחיצה פותחת את מסך ההתראות"}
      className="relative flex items-center gap-1.5 rounded-xl bg-red-50 border border-red-200 px-3 py-1.5 hover:bg-red-100 transition-colors">
      <span className="text-base">🔔</span>
      <span className="text-xs font-bold text-red-700">{count}</span>
      {urgent > 0 && (
        <span title={urgent + " התראות דחופות שטרם נקראו"}
          className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 text-white text-[10px] font-black rounded-full flex items-center justify-center">
          {urgent}
        </span>
      )}
    </button>
  );
}
