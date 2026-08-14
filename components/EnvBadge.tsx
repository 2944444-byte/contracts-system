"use client";
import { useEffect, useState } from "react";

// תג "סביבת בדיקות" — נראה אך ורק ב-preview deployments (ענף dev).
// בפרודקשן הרכיב מרנדר כלום, כך שהמשתמשים לעולם לא רואים אותו.
// זיהוי כפול: משתנה הסביבה של Vercel (נטבע בזמן build) + זיהוי לפי
// הדומיין (כתובות ענף מכילות "-git-"), כגיבוי אם המשתנה לא נחשף.
export default function EnvBadge() {
  const [staging, setStaging] = useState(false);
  useEffect(function () {
    var env = process.env.NEXT_PUBLIC_VERCEL_ENV;
    var host = typeof window !== "undefined" ? window.location.hostname : "";
    setStaging(env === "preview" || host.indexOf("-git-") !== -1 || host === "localhost");
  }, []);
  if (!staging) return null;
  return (
    <span
      className="flex items-center gap-1 rounded-full bg-orange-500 text-white text-xs font-black px-3 py-1 shadow-sm animate-pulse"
      title="זו סביבת הבדיקות (ענף dev) — גרסה שטרם שוחררה למשתמשים. הנתונים אמיתיים ומשותפים.">
      🧪 סביבת בדיקות
    </span>
  );
}
