"use client";
import { PageHero } from '@/components/ui';
import { APP_VERSION, BUILD_DATE, CHANGELOG } from '@/lib/version';

// "מה חדש" — היסטוריית הגרסאות, פתוח לכל המשתמשים. הרשומות מתוחזקות
// ב-lib/version.ts ומתעדכנות בכל שחרור גרסה.
export default function WhatsNewPage() {
  return (
    <div dir="rtl" className="max-w-3xl mx-auto">
      <PageHero title="מה חדש במערכת" icon="🆕" tone="blue"
        subtitle={"גרסה נוכחית: " + APP_VERSION + (BUILD_DATE ? " · עודכן " + BUILD_DATE : "")} />
      <div className="space-y-4">
        {CHANGELOG.map(function(rel, i) {
          return (
            <div key={rel.v} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className={"text-sm font-black rounded-full px-3 py-1 " + (i === 0 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600")}>
                  גרסה {rel.v}
                </span>
                <span className="text-xs text-slate-400">{rel.date}</span>
                {i === 0 && <span className="text-[10px] bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-bold">נוכחית</span>}
              </div>
              <ul className="space-y-1.5">
                {rel.highlights.map(function(h, j) {
                  return <li key={j} className="text-sm text-slate-700 leading-relaxed">{h}</li>;
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="text-center text-[11px] text-slate-400 mt-6 mb-4">
        גרסאות משוחררות לאחר בדיקה בסביבת הניסוי · שאלות? מסך המדריך למשתמש 📖
      </div>
    </div>
  );
}
