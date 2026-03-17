export default function Loading() {
  return (
    <div dir="rtl" className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        <span className="text-sm text-slate-400 font-medium">טוען...</span>
      </div>
    </div>
  );
}
