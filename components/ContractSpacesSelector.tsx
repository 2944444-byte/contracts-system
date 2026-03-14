// רכיב לבחירת שטחים + שיטת חיוב — מוטמע בטופס חוזה חדש/עריכה

"use client";

export interface SpaceCharge {
  space_id:       string;
  space_name:     string;
  space_type:     string;
  area:           number | null;
  quantity:       number | null;
  is_commercial:  boolean;
  charge_method:  string; // per_sqm | fixed | per_unit | revenue_pct | revenue_or_sqm | included
  price_per_sqm:  string;
  fixed_amount:   string;
  price_per_unit: string;
  revenue_pct:    string;
  min_rent:       string;
  revenue_type:   string; // revenue_only | revenue_or_sqm
  included_in_main_rent: boolean;
  notes:          string;
}

const SPACE_TYPE_ICONS: Record<string,string> = {
  unit: "🚪", operational: "⚙️", open_storage: "📦", parking: "🅿️", other: "📐",
};
const SPACE_TYPE_LABELS: Record<string,string> = {
  unit: "יחידה סגורה", operational: "שטח תפעולי",
  open_storage: "שטח פתוח", parking: "חניה", other: "אחר",
};

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

interface Props {
  availableSpaces: any[];
  selectedSpaces:  SpaceCharge[];
  onChange:        (spaces: SpaceCharge[]) => void;
}

export function ContractSpacesSelector({ availableSpaces, selectedSpaces, onChange }: Props) {
  function isSelected(spaceId: string) {
    return selectedSpaces.some(function(s) { return s.space_id === spaceId; });
  }

  function toggleSpace(space: any) {
    if (isSelected(space.id)) {
      onChange(selectedSpaces.filter(function(s) { return s.space_id !== space.id; }));
    } else {
      // ברירת מחדל לפי סוג
      const defaultMethod = space.space_type === "parking" ? "per_unit"
        : space.space_type === "operational" || space.space_type === "open_storage" ? "fixed"
        : "per_sqm";

      const newSpace: SpaceCharge = {
        space_id:       space.id,
        space_name:     space.space_name,
        space_type:     space.space_type,
        area:           space.area,
        quantity:       space.quantity,
        is_commercial:  space.is_commercial ?? false,
        charge_method:  defaultMethod,
        price_per_sqm:  "",
        fixed_amount:   "",
        price_per_unit: "",
        revenue_pct:    "",
        min_rent:       "",
        revenue_type:   "revenue_only",
        included_in_main_rent: false,
        notes:          "",
      };
      onChange([...selectedSpaces, newSpace]);
    }
  }

  function updateCharge(spaceId: string, field: string, value: any) {
    onChange(selectedSpaces.map(function(s) {
      if (s.space_id !== spaceId) return s;
      return { ...s, [field]: value };
    }));
  }

  // חישוב סה"כ חיוב חודשי
  function calcMonthly(sc: SpaceCharge): number | null {
    if (sc.charge_method === "included") return 0;
    if (sc.charge_method === "per_sqm" && sc.area && sc.price_per_sqm)
      return Math.round(Number(sc.price_per_sqm) * sc.area);
    if (sc.charge_method === "fixed" && sc.fixed_amount)
      return Number(sc.fixed_amount);
    if (sc.charge_method === "per_unit" && sc.quantity && sc.price_per_unit)
      return Math.round(Number(sc.price_per_unit) * sc.quantity);
    if (sc.charge_method === "revenue_pct" && sc.min_rent)
      return Number(sc.min_rent);
    if (sc.charge_method === "revenue_or_sqm" && sc.price_per_sqm && sc.area)
      return Math.round(Number(sc.price_per_sqm) * sc.area);
    return null;
  }

  const totalMonthly = selectedSpaces.reduce(function(acc, sc) {
    const m = calcMonthly(sc);
    return acc + (m ?? 0);
  }, 0);

  // קבוצות לפי סוג
  const byType: Record<string, any[]> = {};
  availableSpaces.forEach(function(s) {
    if (!byType[s.space_type]) byType[s.space_type] = [];
    byType[s.space_type].push(s);
  });

  return (
    <div className="space-y-4">
      {/* רשימת שטחים לבחירה */}
      <div>
        <div className="text-xs font-semibold text-slate-500 mb-2">בחר שטחים לשיוך לחוזה:</div>
        {availableSpaces.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-4">אין שטחים מוגדרים לנכס זה</div>
        ) : (
          Object.entries(byType).map(function([type, items]) {
            return (
              <div key={type} className="mb-3">
                <div className="text-xs text-slate-400 mb-1.5">
                  {SPACE_TYPE_ICONS[type]} {SPACE_TYPE_LABELS[type]}
                </div>
                <div className="space-y-1">
                  {items.map(function(space) {
                    const sel = isSelected(space.id);
                    return (
                      <label key={space.id}
                        className={"flex items-center gap-3 rounded-lg border p-2.5 cursor-pointer transition-all " +
                          (sel ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}>
                        <input type="checkbox" checked={sel}
                          onChange={function() { toggleSpace(space); }}
                          className="w-4 h-4 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-slate-800 text-sm">{space.space_name}</span>
                          {space.space_type === "parking"
                            ? <span className="text-xs text-slate-400 mr-2">{space.quantity ?? 1} מקומות</span>
                            : space.area
                              ? <span className="text-xs text-slate-400 mr-2">{space.area} מ&quot;ר</span>
                              : null}
                          {space.is_commercial && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded mr-1">מסחרי</span>
                          )}
                        </div>
                        <span className={"text-xs font-semibold " + (space.status === "vacant" ? "text-green-600" : "text-blue-600")}>
                          {space.status === "vacant" ? "פנוי" : "מושכר"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* תנאי חיוב לכל שטח נבחר */}
      {selectedSpaces.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-500">תנאי חיוב לכל שטח:</div>
          {selectedSpaces.map(function(sc) {
            const monthly = calcMonthly(sc);
            const isParking   = sc.space_type === "parking";
            const isCommercial = sc.is_commercial;

            return (
              <div key={sc.space_id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">{SPACE_TYPE_ICONS[sc.space_type]}</span>
                  <span className="font-bold text-slate-800">{sc.space_name}</span>
                  {sc.area && <span className="text-xs text-slate-400">{sc.area} מ&quot;ר</span>}
                  {monthly != null && monthly > 0 && (
                    <span className="mr-auto text-sm font-bold text-green-700">₪{monthly.toLocaleString()}/חודש</span>
                  )}
                  {sc.charge_method === "included" && (
                    <span className="mr-auto text-xs text-slate-400">כלול בשכ&quot;ד הראשי</span>
                  )}
                </div>

                {/* שיטת חיוב */}
                <div className="mb-3">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">שיטת חיוב</label>
                  <select value={sc.charge_method}
                    onChange={function(e) { updateCharge(sc.space_id, "charge_method", e.target.value); }}
                    className={ic}>
                    <option value="per_sqm">לפי מחיר למ&quot;ר</option>
                    <option value="fixed">סכום קבוע לחודש</option>
                    {isParking && <option value="per_unit">לפי מספר מקומות</option>}
                    {isCommercial && <option value="revenue_pct">אחוז מפידיון בלבד</option>}
                    {isCommercial && <option value="revenue_or_sqm">הגבוה: פידיון או מ&quot;ר</option>}
                    <option value="included">כלול בשכ&quot;ד הראשי (ללא חיוב נפרד)</option>
                  </select>
                </div>

                {/* שדות לפי שיטה */}
                {sc.charge_method === "per_sqm" && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">מחיר למ&quot;ר (₪)</label>
                    <input type="number" value={sc.price_per_sqm}
                      onChange={function(e) { updateCharge(sc.space_id, "price_per_sqm", e.target.value); }}
                      className={ic} placeholder="43" />
                    {sc.area && sc.price_per_sqm && (
                      <div className="mt-1 text-xs text-green-700 font-medium">
                        סה&quot;כ: ₪{Math.round(Number(sc.price_per_sqm) * sc.area).toLocaleString()}/חודש
                      </div>
                    )}
                  </div>
                )}

                {sc.charge_method === "fixed" && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">סכום קבוע (₪/חודש)</label>
                    <input type="number" value={sc.fixed_amount}
                      onChange={function(e) { updateCharge(sc.space_id, "fixed_amount", e.target.value); }}
                      className={ic} placeholder="500" />
                  </div>
                )}

                {sc.charge_method === "per_unit" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">כמות מקומות</label>
                      <input type="number" value={sc.quantity ?? ""}
                        onChange={function(e) { updateCharge(sc.space_id, "quantity", Number(e.target.value)); }}
                        className={ic} placeholder={String(sc.quantity ?? 1)} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">מחיר למקום (₪/חודש)</label>
                      <input type="number" value={sc.price_per_unit}
                        onChange={function(e) { updateCharge(sc.space_id, "price_per_unit", e.target.value); }}
                        className={ic} placeholder="300" />
                    </div>
                  </div>
                )}

                {(sc.charge_method === "revenue_pct" || sc.charge_method === "revenue_or_sqm") && (
                  <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 space-y-3">
                    <div className="text-xs font-bold text-amber-700 mb-2">
                      📊 תמחור לפי {sc.charge_method === "revenue_pct" ? "פידיון בלבד" : "הגבוה: פידיון או מ\"ר"}
                    </div>
                    <div className="rounded-lg bg-white border border-amber-200 p-2 text-xs text-amber-800">
                      ⚠️ שכ&quot;ד לפי פידיון — <strong>ללא הצמדה</strong> על הרכיב הפידיוני
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">% מהמחזור</label>
                        <input type="number" step="0.1" value={sc.revenue_pct}
                          onChange={function(e) { updateCharge(sc.space_id, "revenue_pct", e.target.value); }}
                          className={ic} placeholder="8.5" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">מינימום שכ&quot;ד (₪/חודש)</label>
                        <input type="number" value={sc.min_rent}
                          onChange={function(e) { updateCharge(sc.space_id, "min_rent", e.target.value); }}
                          className={ic} placeholder="10000" />
                      </div>
                    </div>
                    {sc.charge_method === "revenue_or_sqm" && (
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">מחיר בסיס למ&quot;ר (₪)</label>
                        <input type="number" value={sc.price_per_sqm}
                          onChange={function(e) { updateCharge(sc.space_id, "price_per_sqm", e.target.value); }}
                          className={ic} placeholder="43" />
                        <div className="text-xs text-slate-400 mt-1">
                          החיוב = הגבוה מבין: {sc.price_per_sqm && sc.area ? "₪" + Math.round(Number(sc.price_per_sqm) * sc.area).toLocaleString() + " (מ\"ר)" : "שכ\"ד למ\"ר"} לבין {sc.revenue_pct ? sc.revenue_pct + "% מהמחזור" : "% מהמחזור"}
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">מחזור חודשי מדווח (₪) — לחישוב</label>
                      <input type="number" value={(sc as any).monthly_reported_revenue ?? ""}
                        onChange={function(e) { updateCharge(sc.space_id, "monthly_reported_revenue", e.target.value); }}
                        className={ic} placeholder="0" />
                    </div>
                  </div>
                )}

                {/* הערה לשיוך */}
                <div className="mt-3">
                  <input type="text" value={sc.notes}
                    onChange={function(e) { updateCharge(sc.space_id, "notes", e.target.value); }}
                    className={ic} placeholder="הערה לשיוך זה..." />
                </div>
              </div>
            );
          })}

          {/* סיכום */}
          {totalMonthly > 0 && (
            <div className="rounded-xl bg-green-50 border border-green-200 p-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-slate-700">סה&quot;כ חיוב חודשי (כל השטחים)</span>
                <span className="text-xl font-bold text-green-700">₪{totalMonthly.toLocaleString()}</span>
              </div>
              {selectedSpaces.some(function(s) { return s.charge_method === "revenue_pct" || s.charge_method === "revenue_or_sqm"; }) && (
                <div className="text-xs text-amber-600 mt-1">* שטחי פידיון מוצגים לפי מינימום / שכ&quot;ד בסיס</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
