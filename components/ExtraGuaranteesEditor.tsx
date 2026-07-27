"use client";

// Additional securities on a contract (e.g. a promissory note alongside a bank
// guarantee). Each one is a full guarantee row — amount, issuer, expiry,
// document, guarantors — not just a ticked type. Shared by the new-contract and
// edit-contract screens so both capture the same detail.

export type ExtraGuarantee = {
  id?: string;   // existing guarantees row — updated in place, never re-created
  type: string;
  amount_required: string;
  amount_actual: string;
  bank: string;
  reference_number: string;
  end_date: string;
  document_url: string;
  notes: string;
  guarantors: Array<{ name: string; id_number: string }>;
};

export const GUARANTEE_TYPE_LIST = [
  { v: "bank", l: "ערבות בנקאית", icon: "🏦" },
  { v: "promissory_note", l: "שטר חוב", icon: "📜" },
  { v: "check", l: "שיקים", icon: "📝" },
  { v: "cash", l: "פיקדון מזומן", icon: "💵" },
  { v: "insurance", l: "ביטוח", icon: "🛡️" },
  { v: "personal", l: "אישית", icon: "👤" },
];

// A promissory note / cash deposit is normally open-ended — no expiry field.
export const NO_EXPIRY_TYPES = ["promissory_note", "cash"];

export function emptyExtraGuarantee(type: string): ExtraGuarantee {
  return {
    type: type, amount_required: "", amount_actual: "", bank: "",
    reference_number: "", end_date: "", document_url: "", notes: "", guarantors: [],
  };
}

// Map a guarantees row (DB) → editor entry.
export function extraGuaranteeFromRow(g: any): ExtraGuarantee {
  return {
    id: g.id,
    type: g.guarantee_type,
    amount_required: g.amount_required != null ? String(g.amount_required) : "",
    amount_actual: g.amount_actual != null ? String(g.amount_actual) : "",
    bank: g.bank ?? "",
    reference_number: g.reference_number ?? "",
    end_date: g.end_date ? String(g.end_date).slice(0, 10) : "",
    document_url: g.document_url ?? "",
    notes: g.notes ?? "",
    guarantors: Array.isArray(g.guarantors) ? g.guarantors : [],
  };
}

// Map an editor entry → the guarantees columns this form owns. Deliberately
// excludes `status` and every lifecycle column (extension history, forfeiture,
// documents) so updating an existing security never resets them.
export function extraGuaranteeToRow(e: ExtraGuarantee, contractId: string): Record<string, any> {
  const noExpiry = NO_EXPIRY_TYPES.indexOf(e.type) !== -1;
  const validGuarantors = (e.guarantors || []).filter(function(g) { return g.name?.trim(); });
  return {
    contract_id: contractId,
    guarantee_type: e.type,
    amount_required: e.amount_required ? Number(e.amount_required) : null,
    amount_actual: e.amount_actual ? Number(e.amount_actual) : null,
    bank: e.bank || null,
    reference_number: e.reference_number || null,
    end_date: noExpiry ? null : (e.end_date || null),
    document_url: e.document_url || null,
    notes: e.notes || null,
    guarantors: e.type === "promissory_note" && validGuarantors.length > 0 ? validGuarantors : null,
  };
}

export default function ExtraGuaranteesEditor(props: {
  value: ExtraGuarantee[];
  onChange: (next: ExtraGuarantee[]) => void;
  inputClass?: string;
}) {
  const list = props.value ?? [];
  const ic = props.inputClass ?? "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm";

  // Clicking a type ADDS a security — a contract can legitimately hold two of
  // the same kind (e.g. two bank guarantees). Removal is per card.
  function add(type: string) { props.onChange(list.concat([emptyExtraGuarantee(type)])); }
  function remove(idx: number) { props.onChange(list.filter(function(_, i) { return i !== idx; })); }
  function patch(idx: number, p: Partial<ExtraGuarantee>) {
    props.onChange(list.map(function(x, i) { return i === idx ? { ...x, ...p } : x; }));
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-xs font-bold text-slate-700 mb-2">ביטחונות נוספים בהסכם (אופציונלי)</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {GUARANTEE_TYPE_LIST.map(function(t) {
          const count = list.filter(function(x) { return x.type === t.v; }).length;
          return (
            <button key={t.v} type="button" onClick={function() { add(t.v); }}
              className={"rounded-lg border p-2 text-center text-xs " + (count > 0 ? "border-blue-500 bg-blue-50 text-blue-700 font-semibold" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
              <div>{t.icon}</div><div>+ {t.l}{count > 0 ? " (" + count + ")" : ""}</div>
            </button>
          );
        })}
      </div>

      {list.length === 0 ? (
        <div className="text-[11px] text-slate-400 mt-1.5">לא נבחרו ביטחונות נוספים.</div>
      ) : (
        <div className="mt-3 space-y-3">
          {list.map(function(e, idx) {
            const meta = GUARANTEE_TYPE_LIST.find(function(t) { return t.v === e.type; });
            const noExpiry = NO_EXPIRY_TYPES.indexOf(e.type) !== -1;
            return (
              <div key={idx} className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-blue-800">{meta?.icon} {meta?.l || e.type}</div>
                  <button type="button" onClick={function() { remove(idx); }}
                    className="text-xs text-red-500 hover:text-red-700">הסר</button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-700">סכום נדרש (₪)</label>
                    <input type="number" value={e.amount_required}
                      onChange={function(ev) { patch(idx, { amount_required: ev.target.value }); }} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-700">סכום בפועל (₪)</label>
                    <input type="number" value={e.amount_actual}
                      onChange={function(ev) { patch(idx, { amount_actual: ev.target.value }); }} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                      {e.type === "promissory_note" ? "עושה השטר / מוציא" : "בנק / מוציא"}
                    </label>
                    <input type="text" value={e.bank}
                      onChange={function(ev) { patch(idx, { bank: ev.target.value }); }} className={ic} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-700">מספר אסמכתא / שטר</label>
                    <input type="text" value={e.reference_number}
                      onChange={function(ev) { patch(idx, { reference_number: ev.target.value }); }} className={ic} />
                  </div>
                  {!noExpiry && (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-700">תוקף</label>
                      <input type="date" value={e.end_date}
                        onChange={function(ev) { patch(idx, { end_date: ev.target.value }); }} className={ic} />
                    </div>
                  )}
                  <div className={noExpiry ? "col-span-2" : ""}>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-700">קישור למסמך (URL)</label>
                    <input type="url" dir="ltr" value={e.document_url} placeholder="https://..."
                      onChange={function(ev) { patch(idx, { document_url: ev.target.value }); }} className={ic} />
                  </div>
                </div>

                {noExpiry && (
                  <div className="text-[11px] text-slate-500">
                    {e.type === "promissory_note" ? "שטר חוב — ללא תאריך תוקף (לא ייווצרו התראות פקיעה)." : "פיקדון — ללא תאריך תוקף."}
                  </div>
                )}

                {e.type === "promissory_note" && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-bold text-amber-800">ערבים לשטר</label>
                      <button type="button"
                        onClick={function() { patch(idx, { guarantors: (e.guarantors || []).concat([{ name: "", id_number: "" }]) }); }}
                        className="rounded bg-amber-600 text-white px-2 py-0.5 text-[11px] font-bold hover:bg-amber-700">+ ערב</button>
                    </div>
                    {(e.guarantors || []).length === 0 ? (
                      <div className="text-[11px] text-amber-600">אין ערבים לשטר</div>
                    ) : (
                      <div className="space-y-1.5">
                        {(e.guarantors || []).map(function(g, gi) {
                          return (
                            <div key={gi} className="flex items-center gap-2">
                              <input type="text" value={g.name} placeholder="שם הערב"
                                onChange={function(ev) {
                                  patch(idx, { guarantors: e.guarantors.map(function(x, j) { return j === gi ? { ...x, name: ev.target.value } : x; }) });
                                }} className="flex-1 rounded border border-amber-300 px-2 py-1 text-xs" />
                              <input type="text" value={g.id_number} placeholder="ת.ז."
                                onChange={function(ev) {
                                  patch(idx, { guarantors: e.guarantors.map(function(x, j) { return j === gi ? { ...x, id_number: ev.target.value } : x; }) });
                                }} className="w-28 rounded border border-amber-300 px-2 py-1 text-xs" />
                              <button type="button"
                                onClick={function() { patch(idx, { guarantors: e.guarantors.filter(function(_, j) { return j !== gi; }) }); }}
                                className="text-red-500 hover:text-red-700 text-xs">🗑</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <input type="text" value={e.notes} placeholder="הערות (לא חובה)"
                  onChange={function(ev) { patch(idx, { notes: ev.target.value }); }} className={ic} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
