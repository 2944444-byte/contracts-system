import Link from "next/link";

export default function NotFound() {
  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="text-8xl font-black text-slate-200 mb-4">404</div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">הדף לא נמצא</h1>
        <p className="text-slate-500 mb-6">הדף שחיפשת לא קיים במערכת</p>
        <Link href="/dashboard"
          className="rounded-xl bg-blue-600 px-6 py-3 text-white font-semibold hover:bg-blue-700 transition-colors">
          ← חזרה לדשבורד
        </Link>
      </div>
    </div>
  );
}
