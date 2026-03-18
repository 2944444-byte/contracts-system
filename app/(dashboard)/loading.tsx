export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[300px]" dir="rtl">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center animate-pulse">
          <span className="text-2xl">🏙️</span>
        </div>
        <div className="text-slate-400 text-sm font-medium">טוען...</div>
        <div className="flex gap-1.5">
          {[0,1,2].map(function(i){return (
            <div key={i} className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{animationDelay:i*0.15+"s"}}/>
          );})}
        </div>
      </div>
    </div>
  );
}
