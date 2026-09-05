"use client";
// חלון פיצול יחידה: חלקים, שטחים, ומה קורה לכל חלק (נשאר / פנוי / עובר
// לשוכר אחר). ההרצה עצמה ב-lib/split-unit.ts.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { performUnitSplit, validateSplit, partsTotal, type SplitPart, type SplitCandidateContract, type SplitResult } from "@/lib/split-unit";

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

export default function SplitUnitModal(props: {
  space: any;
  holder: { contractId: string; tenantName: string } | null;
  onClose: () => void;
  onDone: (r: SplitResult) => void;
}) {
  const { space, holder } = props;
  const origArea = Number(space.area) || 0;
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [parts, setParts] = useState<SplitPart[]>([
    { name: space.space_name + " א", area: origArea > 0 ? String(Math.round(origArea / 2 * 100) / 100) : "", disposition: holder ? "keep" : "vacant" },
    { name: space.space_name + " ב", area: origArea > 0 ? String(Math.round((origArea - origArea / 2) * 100) / 100) : "", disposition: "vacant" },
  ]);
  const [allowDiff, setAllowDiff] = useState(false);
  const [notes, setNotes] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [candidates, setCandidates] = useState<SplitCandidateContract[]>([]);
  const [holderCharge, setHolderCharge] = useState<{ method: string; fixed: number | null; price: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(function () {
    (async function () {
      const { data } = await supabase.from("contracts")
        .select("id, status, rent_per_sqm, tenants(name)")
        .eq("property_id", space.property_id).eq("is_amendment", false)
        .in("status", ["active", "expiring", "extended", "upcoming", "future"])
        .order("start_date", { ascending: false });
      setCandidates((data || []).filter(function (c: any) { return c.id !== holder?.contractId; }).map(function (c: any) {
        return { id: c.id, tenantName: c.tenants?.name || "—", status: c.status, rent_per_sqm: c.rent_per_sqm != null ? Number(c.rent_per_sqm) : null };
      }));
      if (holder) {
        // How the holder is charged for this unit — the retained part inherits it.
        const { data: amends } = await supabase.from("contracts").select("id, contract_spaces(area_override,space_id,charge_method,fixed_rent,price_per_sqm)")
          .eq("parent_contract_id", holder.contractId).eq("is_amendment", true).order("amendment_number", { ascending: false });
        const latest = (amends || []).find(function (a: any) { return (a.contract_spaces || []).length > 0; });
        let cs: any = latest ? (latest.contract_spaces || []).find(function (x: any) { return x.space_id === space.id; }) : null;
        if (!cs) {
          const { data: baseCs } = await supabase.from("contract_spaces").select("space_id,charge_method,fixed_rent,price_per_sqm").eq("contract_id", holder.contractId).eq("space_id", space.id).limit(1);
          cs = (baseCs || [])[0] || null;
        }
        setHolderCharge({ method: cs?.charge_method || "per_sqm", fixed: cs?.fixed_rent != null ? Number(cs.fixed_rent) : null, price: cs?.price_per_sqm != null ? Number(cs.price_per_sqm) : null });
      }
    })();
  }, [space.id, space.property_id, holder?.contractId]);

  const total = partsTotal(parts);
  const diff = Math.round((total - origArea) * 100) / 100;
  const isFixed = holderCharge?.method === "fixed";

  function setPart(i: number, patch: Partial<SplitPart>) {
    setParts(function (prev) { return prev.map(function (p, j) { return j === i ? { ...p, ...patch } : p; }); });
  }
  function addPart() {
    const n = parts.length;
    const letters = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח"];
    setParts(parts.concat([{ name: space.space_name + " " + (letters[n] || String(n + 1)), area: "", disposition: "vacant" }]));
  }
  function removePart(i: number) { if (parts.length > 2) setParts(parts.filter(function (_, j) { return j !== i; })); }

  const input = useMemo(function () {
    return { space: space, parts: parts, effectiveDate: date, holderContractId: holder?.contractId || null, allowDifferentTotal: allowDiff, notes: notes, documentUrl: docUrl };
  }, [space, parts, date, holder, allowDiff, notes, docUrl]);
  const liveError = validateSplit(input);

  const summary = parts.map(function (p) {
    const t = p.disposition === "transfer" ? candidates.find(function (c) { return c.id === p.targetContractId; }) : null;
    return "• " + (p.name || "?") + " — " + (Number(p.area) || 0).toLocaleString("he-IL") + ' מ"ר: ' +
      (p.disposition === "keep" ? "נשאר אצל " + (holder?.tenantName || "השוכר") : p.disposition === "vacant" ? "פנוי להשכרה" : "עובר ל" + (t?.tenantName || "…") + " (תוספת הוספת יחידות)");
  });

  async function run() {
    setErr(null);
    const v = validateSplit(input);
    if (v) { setErr(v); return; }
    const transfers = parts.filter(function (p) { return p.disposition === "transfer"; }).length;
    const msg = "לבצע את הפיצול?\n\n" + summary.join("\n") +
      (holder ? "\n\nלשוכר המחזיק (" + holder.tenantName + ") תיווצר תוספת להסכם מ-" + new Date(date).toLocaleDateString("he-IL") + " עם החלקים שנשארו אצלו." : "") +
      (transfers > 0 ? "\nלכל שוכר מקבל תיווצר תוספת \"הוספת יחידות\"." : "") +
      "\n\nהפעולה אינה הפיכה בלחיצה אחת (מחיקת התוספות ואיחוד היחידות ידניים).";
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await performUnitSplit(input);
      props.onDone(r);
    } catch (e: any) {
      setErr(e?.message || String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onMouseDown={function (e) { if (e.target === e.currentTarget && !busy) props.onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto" dir="rtl" onClick={function (e) { e.stopPropagation(); }}>
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-800 text-lg">✂️ פיצול יחידה: {space.space_name}</h2>
            <div className="text-xs text-slate-500 mt-0.5">{origArea > 0 ? origArea.toLocaleString("he-IL") + ' מ"ר' : "ללא שטח רשום"}{holder ? " · מוחזקת ע\"י " + holder.tenantName : " · פנויה"}</div>
          </div>
          <button onClick={props.onClose} disabled={busy} className="text-2xl text-slate-400">×</button>
        </div>

        <div className="p-6 space-y-4">
          {holder && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <div className="font-bold">היחידה מוחזקת על ידי {holder.tenantName}</div>
              <div className="mt-0.5">החלק שנשאר אצלו שומר על מזהה היחידה המקורי — המקדמות והחיובים הקיימים ממשיכים להצביע עליו. השאר ייווצרו כיחידות חדשות. השטח שלפני הפיצול מוקפא בצילומים הקודמים, כך שהצמדה, שכ"ד ודמי ניהול לתקופות שלפני תאריך התחולה מחושבים לפי השטח המקורי. לשוכר תיווצר תוספת להסכם מתאריך התחולה; חלק שעובר לשוכר אחר יוצר לו תוספת "הוספת יחידות".</div>
              {holderCharge && <div className="mt-1 text-amber-800">חיוב היחידה היום: {isFixed ? "סכום קבוע ₪" + (holderCharge.fixed || 0).toLocaleString("he-IL") + " לחודש — יש להזין את הסכום לחלק שנשאר" : 'לפי מ"ר' + (holderCharge.price != null ? " (₪" + holderCharge.price.toLocaleString("he-IL") + ')' : " (מחיר ההסכם)") + " — החלק שנשאר ממשיך באותו מחיר למ\"ר"}</div>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-xs font-semibold text-slate-700">תאריך תחולה *</label><input type="date" value={date} onChange={function (e) { setDate(e.target.value); }} className={ic} /></div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-700">קישור למסמך (תוכנית / תוספת חתומה)</label><input type="url" value={docUrl} onChange={function (e) { setDocUrl(e.target.value); }} className={ic} placeholder="https://…" /></div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700">החלקים</label>
              <button type="button" onClick={addPart} className="text-xs text-blue-600 hover:underline">+ הוסף חלק</button>
            </div>
            <div className="space-y-2">
              {parts.map(function (p, i) {
                return (
                  <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5"><label className="mb-1 block text-[11px] text-slate-500">שם החלק</label><input type="text" value={p.name} onChange={function (e) { setPart(i, { name: e.target.value }); }} className={ic} /></div>
                      <div className="col-span-3"><label className="mb-1 block text-[11px] text-slate-500">שטח (מ"ר)</label><input type="number" step="0.01" value={p.area} onChange={function (e) { setPart(i, { area: e.target.value }); }} className={ic} /></div>
                      <div className="col-span-3">
                        <label className="mb-1 block text-[11px] text-slate-500">מה קורה לחלק</label>
                        <select value={p.disposition} onChange={function (e) { setPart(i, { disposition: e.target.value as any, targetContractId: undefined }); }} className={ic}>
                          {holder && <option value="keep">נשאר אצל {holder.tenantName}</option>}
                          <option value="vacant">פנוי להשכרה</option>
                          <option value="transfer">עובר לשוכר אחר…</option>
                        </select>
                      </div>
                      <div className="col-span-1 text-left">{parts.length > 2 && <button type="button" onClick={function () { removePart(i); }} className="text-red-500 text-lg leading-none" title="הסר חלק">×</button>}</div>
                    </div>
                    {p.disposition === "transfer" && (
                      <div className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-8">
                          <label className="mb-1 block text-[11px] text-slate-500">לחוזה של</label>
                          <select value={p.targetContractId || ""} onChange={function (e) { setPart(i, { targetContractId: e.target.value || undefined }); }} className={ic}>
                            <option value="">-- בחר שוכר בנכס --</option>
                            {candidates.map(function (c) { return <option key={c.id} value={c.id}>{c.tenantName}{c.status === "future" || c.status === "upcoming" ? " (חוזה טרם החל)" : ""}{c.rent_per_sqm != null ? ' · ₪' + c.rent_per_sqm.toLocaleString("he-IL") + '/מ"ר' : ""}</option>; })}
                          </select>
                        </div>
                        <div className="col-span-4">
                          <label className="mb-1 block text-[11px] text-slate-500">₪ למ"ר (ריק = מחיר ההסכם המקבל)</label>
                          <input type="number" step="0.01" value={p.pricePerSqm || ""} onChange={function (e) { setPart(i, { pricePerSqm: e.target.value }); }} className={ic} placeholder={(function () { const c = candidates.find(function (x) { return x.id === p.targetContractId; }); return c?.rent_per_sqm != null ? String(c.rent_per_sqm) : ""; })()} />
                        </div>
                      </div>
                    )}
                    {p.disposition === "keep" && isFixed && (
                      <div className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-6">
                          <label className="mb-1 block text-[11px] text-slate-500">שכ"ד קבוע לחלק זה (₪ לחודש)</label>
                          <input type="number" step="0.01" value={p.fixedRent || ""} onChange={function (e) { setPart(i, { fixedRent: e.target.value }); }} className={ic}
                            placeholder={holderCharge?.fixed != null && origArea > 0 ? String(Math.round((holderCharge.fixed * (Number(p.area) || 0) / origArea) * 100) / 100) : ""} />
                        </div>
                        <div className="col-span-6 text-[11px] text-slate-500 pb-2">ריק = יחסי לשטח מתוך הסכום הקבוע הנוכחי</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className={"mt-2 text-xs " + (Math.abs(diff) > 0.5 && !allowDiff ? "text-red-600" : "text-slate-500")}>
              סה"כ {total.toLocaleString("he-IL")} מ"ר{origArea > 0 ? " מתוך " + origArea.toLocaleString("he-IL") + (Math.abs(diff) > 0.5 ? " (" + (diff > 0 ? "+" : "") + diff.toLocaleString("he-IL") + ")" : " ✓") : ""}
            </div>
            {origArea > 0 && (
              <label className="mt-1 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={allowDiff} onChange={function (e) { setAllowDiff(e.target.checked); }} /> השטח הכולל נמדד מחדש ושונה מהמקור</label>
            )}
          </div>

          <div><label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label><textarea value={notes} onChange={function (e) { setNotes(e.target.value); }} rows={2} className={ic} placeholder="למשל: לפי תוכנית מדידה מ-…" /></div>

          <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-700">
            <div className="font-bold mb-1">מה יקרה</div>
            {summary.map(function (s, i) { return <div key={i}>{s}</div>; })}
            {holder && <div className="mt-1 text-slate-500">+ תוספת להסכם ל{holder.tenantName} מ-{new Date(date).toLocaleDateString("he-IL")}</div>}
          </div>

          {(err || liveError) && <div className={"rounded-lg px-3 py-2 text-xs " + (err ? "bg-red-50 text-red-700 border border-red-200" : "bg-amber-50 text-amber-800 border border-amber-200")}>{err || liveError}</div>}

          <div className="flex gap-3 pt-1">
            <button onClick={props.onClose} disabled={busy} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
            <button onClick={run} disabled={busy || !!liveError} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? "מבצע…" : "בצע פיצול"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
