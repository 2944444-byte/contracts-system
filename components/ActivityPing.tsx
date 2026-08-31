"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

// פעימת לב לפעילות משתמשים (שלב ב' של המעקב): מדווח "אני פעיל במסך X"
// לטבלת user_activity_pings — בכניסה למסך וכל PING_MS כשהטאב גלוי.
// טאב ברקע אינו מדווח (visibilityState), כך שמשך השימוש הנגזר
// (פעימה ≈ 5 דקות) משקף עבודה בפועל ולא טאבים פתוחים ונשכחים.
// RLS מבטיח שמשתמש רושם רק את עצמו; הקריאה — רק דרך מסך המשתמשים
// למנהל מערכת. כשל דיווח לעולם אינו מפריע לעבודה.
const PING_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000; // מעבר מסכים מהיר לא מציף שורות

export default function ActivityPing() {
  const pathname = usePathname();
  const last = useRef<{ at: number; screen: string }>({ at: 0, screen: "" });

  useEffect(function () {
    let stopped = false;

    async function ping(screen: string, force: boolean) {
      try {
        if (stopped) return;
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        const now = Date.now();
        if (!force && now - last.current.at < MIN_GAP_MS && last.current.screen === screen) return;
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id;
        if (!uid) return;
        last.current = { at: now, screen: screen };
        await supabase.from("user_activity_pings").insert({ user_id: uid, screen: screen });
      } catch (e) { /* דיווח פעילות לא מפיל את האפליקציה */ }
    }

    // כניסה למסך (או ניווט) — דיווח מיידי; ובנוסף פעימה מחזורית
    ping(pathname || "/", false);
    const iv = setInterval(function () { ping(pathname || "/", true); }, PING_MS);
    // חזרה לטאב אחרי היעדרות ארוכה — פעימה כדי שהרצף יתחדש
    function onVisible() {
      if (document.visibilityState === "visible" && Date.now() - last.current.at > PING_MS) {
        ping(pathname || "/", true);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return function () {
      stopped = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname]);

  return null;
}
