import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50" dir="rtl">
      <div className="text-center">
        <div className="text-8xl mb-4">🏗️</div>
        <h1 className="text-4xl font-black text-slate-800 mb-2">404</h1>
        <p className="text-slate-500 mb-6">הדף שחיפשת לא נמצא</p>
        <Link href="/dashboard" className="rounded-xl bg-blue-700 px-6 py-3 font-bold text-white hover:bg-blue-800 transition-colors">
          חזור לדשבורד →
        </Link>
      </div>
    </div>
  );
}
