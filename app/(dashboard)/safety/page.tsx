"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import PropertyHierarchyFilter from '@/components/PropertyHierarchyFilter';
import { PageHero } from '@/components/ui';
import { getScopeIds, scopeRows } from '@/lib/permissions';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const INSPECTION_TYPES = [
  { v:"fire",        l:"כיבוי אש",       icon:"🔥" },
  { v:"elevator",    l:"מעלית",          icon:"🛗" },
  { v:"electrical",  l:"חשמל",           icon:"⚡" },
  { v:"gas",         l:"גז",             icon:"🔵" },
  { v:"hvac",        l:'מיזוג אוויר',    icon:"❄️" },
  { v:"accessibility",l:"נגישות",        icon:"♿" },
  { v:"structure",   l:"קונסטרוקציה",    icon:"🏗️" },
  { v:"other",       l:"אחר",            icon:"🔒" },
];

const SCOPES = [
  { v: "public",   l: "ציבורי / משותף", icon: "🏢", desc: "רכוש משותף ומערכות — אחריות חברת ניהול" },
  { v: "unit",     l: "יחידה (שוכר)",   icon: "🏠", desc: "בדיקה ליחידה ספציפית — אחריות שוכר" },
  { v: "property", l: "נכס שלם",        icon: "🏗️", desc: "בדיקה כוללת לנכס" },
];

// Standard required checks catalog, derived from the company's
// "נוהל מעקב אישורים וביטוח". responsible: management = חברת ניהול (חלקים
// ציבוריים/מערכות), tenant = שוכר. freq = recommended frequency in months.
const CHECK_CATALOG = [
  // ── Management responsibility (public / building systems) ──
  { key:"electrical_inspection", l:"בדיקת חשמל ע\"י בודק מוסמך", type:"electrical", standard:"ת\"י / בודק מוסמך", freq:24, responsible:"management", scope:"public", note:"כולל לוחות חשמל, חיווט ורציפות הארקה" },
  { key:"thermographic",         l:"סריקה תרמוגרפית ללוחות חשמל", type:"electrical", standard:"מעל 100A", freq:12, responsible:"management", scope:"public", note:"תיקון ליקויים וקבלת אישור 'אפס ליקויים'" },
  { key:"extinguishers",         l:"בדיקת מטפים מיטלטלים",       type:"fire", standard:"ת\"י 129 ח'1 (טופס 2)", freq:12, responsible:"management", scope:"public", note:"טופס 2 חתום ע\"י חברה מוסמכת; נשלח למוקד כבאות" },
  { key:"fire_detection",        l:"בדיקת מערכת גילוי אש ועשן",   type:"fire", standard:"ת\"י 1220 ח'11", freq:12, responsible:"management", scope:"public", note:"ע\"י גורם מוסמך/מהנדס" },
  { key:"sprinklers",            l:"תחזוקת ספרינקלרים (מתזים)",   type:"fire", standard:"ת\"י 1928", freq:12, responsible:"management", scope:"public", note:"ע\"י חברה מוסמכת מת\"י" },
  { key:"pa_system",             l:"בדיקת מערכת כריזה",           type:"fire", standard:"משטרת ישראל / ת\"י", freq:12, responsible:"management", scope:"public", note:"לפי דרישות" },
  { key:"emergency_lighting",    l:"בדיקת תאורת חירום ושילוט מילוט", type:"fire", standard:"ת\"י תאורת חירום", freq:12, responsible:"management", scope:"public", note:"מעל דלתות יציאה ובמסדרונות" },
  { key:"alarm",                 l:"מערכת אזעקה — תקינה ופעילה",  type:"other", standard:"בדיקה שנתית", freq:12, responsible:"management", scope:"public", note:"חיבור למוקד אם נדרש בפוליסה" },
  { key:"elevators",             l:"בדיקת מעליות",                type:"elevator", standard:"מהנדס מוסמך", freq:6, responsible:"management", scope:"public", note:"כל 6 חודשים" },
  { key:"solar_pv",              l:"תחזוקת מערכת סולארית (PV)",   type:"other", standard:"הוראות יצרן + קונסטרוקטור", freq:12, responsible:"management", scope:"public", note:"אישור עומסי רוח/שלג אם על הגג" },
  { key:"fire_site_file",        l:"תיק שטח (תיק בטיחות אש)",     type:"fire", standard:"רשות הכבאות", freq:12, responsible:"management", scope:"public", note:"נהלי חירום, שרטוטים, דרכי גישה" },
  // ── Tenant responsibility (their unit / business) ──
  { key:"tenant_fire_license",   l:"אישור כיבוי אש לעסק השוכר",   type:"fire", standard:"רשות הכבאות / רישיון עסק", freq:12, responsible:"tenant", scope:"unit", note:"באחריות השוכר מול הרשות; עותק לתיק הנכס" },
];
function catalogInfo(key: string) { return CHECK_CATALOG.find(function(c){return c.key===key;}); }
// Management-responsibility catalog keys — used for the per-property gap check.
const MGMT_KEYS = CHECK_CATALOG.filter(function(c){return c.responsible==="management";}).map(function(c){return c.key;});

// Fire requirements by property/use type, Part C of the procedure — reference only.
const FIRE_BY_TYPE: Array<{type:string; icon:string; rows:string[]}> = [
  { type:"משרדים", icon:"🏢", rows:["מטפי כיבוי תקניים (ת\"י 129)","גלאי עשן/אש + מערכת גילוי (ת\"י 1220)","תאורת חירום + שילוט מילוט","דלתות אש / חדרי מדרגות מוגנים","מערכת כריזת חירום (מעל גודל מסוים)","תיק בטיחות אש (תיק שטח)"] },
  { type:"מסחר / חנויות", icon:"🛍️", rows:["מטפים + גלגלוני כיבוי (ת\"י 129)","מערכת גילוי אש ועשן (ת\"י 1220)","ספרינקלרים לפי שטח (ת\"י 1928)","תאורת חירום ושילוט מילוט","רישיון עסק + אישור כיבוי אש","דרכי מילוט פנויות ולא נעולות"] },
  { type:"תעשייה", icon:"🏭", rows:["מערכת ספרינקלרים מלאה + מאגר (ת\"י 1928)","גילוי אש ועשן ממוען + גנרטור (ת\"י 1220)","מטפים + עמדות + ברזי שריפה (ת\"י 129)","סקר סיכוני אש / יועץ בטיחות","הפרדות אש / מחסומי אש (ת\"י 755/921)","אישור כבאות פרטני (לא תצהיר)"] },
  { type:"לוגיסטיקה / מחסנים", icon:"📦", rows:["ספרינקלרים מותאמי גובה אחסון (ת\"י 1928)","גילוי אש ועשן על כל שטח ולוחות (ת\"י 1220)","מטפים + גלגלונים + ברזי כיבוי","פתחי שחרור עשן ואוורור","דרכי גישה לרכב כיבוי","אזעקה + חיבור למוקד; תיק שטח"] },
];

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString("he-IL") : "—"; }
function daysLeft(d: string) { return Math.ceil((new Date(d).getTime()-Date.now())/86400000); }
function addMonths(dateStr: string, months: number): string {
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0,10);
}

type Health = "expired" | "due30" | "due60" | "valid" | "unknown";
function healthOf(ins: any): Health {
  if (ins.status === "expired") return "expired";
  var nd = ins.next_inspection_date;
  if (!nd) return "unknown";
  var d = daysLeft(nd);
  if (d < 0) return "expired";
  if (d <= 30) return "due30";
  if (d <= 60) return "due60";
  return "valid";
}
function healthOrder(h: Health) { return ({expired:0,due30:1,due60:2,unknown:3,valid:4} as any)[h]; }

export default function SafetyPage() {
  const [inspections, setInspections] = useState<any[]>([]);
  const [properties,  setProperties]  = useState<any[]>([]);
  const [contracts,   setContracts]   = useState<any[]>([]);
  const [spaces,      setSpaces]      = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [editingId,   setEditingId]   = useState("");
  const [isNew,       setIsNew]       = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [activeTab,   setActiveTab]   = useState<"public"|"tenant">("public");
  const [filterType,  setFilterType]  = useState("all");
  const [filterPropIds, setFilterPropIds] = useState<string[]>([]);
  const [filterSt,    setFilterSt]    = useState<"all"|"valid"|"due"|"expired">("all");
  const [showRef,     setShowRef]     = useState(false);

  // Form fields
  const [fPropertyId,     setFPropertyId]     = useState("");
  const [fCheckKey,       setFCheckKey]       = useState("");
  const [fType,           setFType]           = useState("fire");
  const [fScope,          setFScope]          = useState("public");
  const [fStandard,       setFStandard]       = useState("");
  const [fFreq,           setFFreq]           = useState("");
  const [fSelectedSpaces, setFSelectedSpaces] = useState<string[]>([]);
  const [fInspector,      setFInspector]      = useState("");
  const [fCertNum,        setFCertNum]        = useState("");
  const [fLastDate,       setFLastDate]       = useState("");
  const [fNextDate,       setFNextDate]       = useState("");
  const [fStatus,         setFStatus]         = useState("valid");
  const [fNotes,          setFNotes]          = useState("");
  const [fResponsible,    setFResponsible]    = useState("management");
  const [fDocUrl,         setFDocUrl]         = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading]     = useState(false);

  useEffect(function() { loadAll(); }, []);

  useEffect(function() {
    if (fPropertyId) {
      supabase.from("spaces").select("id,space_name,area").eq("property_id", fPropertyId).order("space_name")
        .then(function({ data }) { setSpaces(data ?? []); });
    } else { setSpaces([]); }
  }, [fPropertyId]);

  async function loadAll() {
    const [{ data: ins }, { data: pr }, { data: c }] = await Promise.all([
      supabase.from("safety_inspections")
        .select("*, properties(name), inspection_spaces(space_id, spaces(space_name))")
        .order("next_inspection_date"),
      supabase.from("properties").select("id,name").order("name"),
      supabase.from("contracts")
        .select("id, tenant_id, property_id, status, is_amendment, parent_contract_id, tenants(name), properties(name), contract_spaces(space_id, spaces(space_name))")
        .in("status", ["active","expiring","extended","upcoming"])
        .order("start_date", { ascending: false }),
    ]);
    var scope = await getScopeIds();
    setInspections(scopeRows(ins ?? [], scope, function(x: any){ return x.property_id; }));
    setProperties(scopeRows(pr ?? [], scope, function(x: any){ return x.id; }));
    setContracts(scopeRows(c ?? [], scope, function(x: any){ return x.property_id; }));
    setLoading(false);
  }

  function spacesLabel(contract: any): string {
    var arr = contract?.contract_spaces || [];
    var names = arr.map(function(cs: any){ return cs?.spaces?.space_name; }).filter(Boolean);
    if (names.length === 0) return "—";
    if (names.length <= 3) return names.join(" · ");
    return names.slice(0,3).join(" · ") + " +" + (names.length-3);
  }

  async function uploadFile(file: File): Promise<string> {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = "safety/" + Date.now() + "_" + safe;
    const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
    if (upErr) throw upErr;
    const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
    return urlData.publicUrl;
  }
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try { setFDocUrl(await uploadFile(file)); }
    catch (err: any) { alert("שגיאה בהעלאה: " + (err?.message || err)); }
    finally { setUploading(false); }
  }

  // Apply a catalog template into the form.
  function applyCatalog(key: string) {
    var c = catalogInfo(key);
    setFCheckKey(key);
    if (!c) return;
    setFType(c.type); setFScope(c.scope); setFStandard(c.standard);
    setFFreq(String(c.freq)); setFResponsible(c.responsible);
    setFNotes(function(prev){ return prev || c.note; });
  }

  function openNew(prefillPropId?: string, prefillKey?: string) {
    setIsNew(true); setEditingId("new");
    var tenantTab = activeTab === "tenant";
    setFPropertyId(prefillPropId || ""); setFType("fire");
    setFScope(tenantTab ? "unit" : "public");
    setFCheckKey(""); setFStandard(""); setFFreq("");
    setFSelectedSpaces([]); setFInspector(""); setFCertNum("");
    setFLastDate(""); setFNextDate(""); setFStatus("valid");
    setFNotes(""); setFResponsible(tenantTab ? "tenant" : "management"); setFDocUrl("");
    if (fileRef.current) fileRef.current.value = "";
    // On the tenant tab, default to the tenant fire-license check if none given.
    if (prefillKey) applyCatalog(prefillKey);
    else if (tenantTab) applyCatalog("tenant_fire_license");
  }

  function openEdit(ins: any) {
    setIsNew(false); setEditingId(ins.id);
    setFPropertyId(ins.property_id??""); setFType(ins.inspection_type??"fire");
    setFScope(ins.scope ?? "public");
    setFCheckKey(ins.check_key ?? ""); setFStandard(ins.standard ?? "");
    setFFreq(ins.frequency_months ? String(ins.frequency_months) : "");
    setFResponsible(ins.responsible_party ?? "management");
    const linkedSpaces = (ins.inspection_spaces || []).map(function(s: any) { return s.space_id; });
    setFSelectedSpaces(linkedSpaces);
    setFInspector(ins.inspector??""); setFCertNum(ins.certificate_number??"");
    setFLastDate(ins.last_inspection_date?.split("T")[0]??"");
    setFNextDate(ins.next_inspection_date?.split("T")[0]??"");
    setFStatus(ins.status??"valid"); setFNotes(ins.notes??"");
    setFDocUrl(ins.document_url ?? "");
    if (fileRef.current) fileRef.current.value = "";
  }

  // Auto-fill next date when last date + frequency are present and next is empty.
  useEffect(function() {
    if (fLastDate && fFreq && !fNextDate) {
      var nd = addMonths(fLastDate, Number(fFreq));
      if (nd) setFNextDate(nd);
    }
  }, [fLastDate, fFreq]); // eslint-disable-line

  async function handleSave() {
    if (!fPropertyId) { alert("חובה: נכס"); return; }
    if (fScope === "unit" && fSelectedSpaces.length === 0) { alert("נא לבחור לפחות יחידה אחת"); return; }
    setSaving(true);
    try {
      // Auto-derive status from next date when possible.
      var derivedStatus = fStatus;
      if (fNextDate) {
        var dl = daysLeft(fNextDate);
        derivedStatus = dl < 0 ? "expired" : "valid";
      }
      const existing = !isNew ? inspections.find(function(x){return x.id===editingId;}) : null;
      const prevDocs: any[] = Array.isArray(existing?.documents) ? existing.documents : [];
      const docs = prevDocs.slice();
      if (fDocUrl && fDocUrl !== existing?.document_url) docs.push({ url: fDocUrl, uploaded_at: new Date().toISOString() });

      const payload: any = {
        property_id:           fPropertyId,
        check_key:             fCheckKey || null,
        inspection_type:       fType,
        standard:              fStandard || null,
        frequency_months:      fFreq ? Number(fFreq) : null,
        scope:                 fScope,
        responsible_party:     fScope === "unit" ? "tenant" : fResponsible,
        inspector:             fInspector||null,
        certificate_number:    fCertNum||null,
        last_inspection_date:  fLastDate||null,
        next_inspection_date:  fNextDate||null,
        status:                derivedStatus,
        notes:                 fNotes||null,
        document_url:          fDocUrl||null,
        documents:             docs,
      };
      let recordId = editingId;
      if (isNew) {
        const { data, error: _ie } = await supabase.from("safety_inspections").insert(payload).select().single();
        if (_ie) throw new Error(_ie.message);
        if (!data?.id) throw new Error("שגיאה בשמירה");
        recordId = data.id;
        await logAudit({ entity_type:"safety", entity_id:data.id, action:"create" });
      } else {
        const { error: ue } = await supabase.from("safety_inspections").update(payload).eq("id", editingId);
        if (ue) throw new Error(ue.message);
        await logAudit({ entity_type:"safety", entity_id:editingId, action:"update" });
      }
      await supabase.from("inspection_spaces").delete().eq("inspection_id", recordId);
      if (fScope === "unit" && fSelectedSpaces.length > 0) {
        await supabase.from("inspection_spaces").insert(
          fSelectedSpaces.map(function(sid) { return { inspection_id: recordId, space_id: sid }; })
        );
      }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק בדיקה?")) return;
    await supabase.from("safety_inspections").delete().eq("id", id);
    await logAudit({ entity_type:"safety", entity_id:id, action:"delete" });
    await loadAll();
  }

  // Demand letter to the tenant for a tenant-responsibility check (e.g. fire
  // license). Resolves the active contract from the inspection's linked units.
  async function sendSafetyDemand(ins: any) {
    var spaceIds = (ins.inspection_spaces || []).map(function(s:any){ return s.space_id; }).filter(Boolean);
    if (spaceIds.length === 0) { alert("לבדיקה לא משויכות יחידות — לא ניתן לזהות שוכר. ערוך את הבדיקה ושייך יחידה."); return; }
    try {
      const { data: cs } = await supabase.from("contract_spaces")
        .select("contracts(id, status, tenants(name), properties(name))")
        .in("space_id", spaceIds);
      var active = (cs || [])
        .map(function(x:any){ return x.contracts; })
        .filter(function(c:any){ return c && ["active","expiring","extended"].includes(c.status); });
      if (active.length === 0) { alert("לא נמצא חוזה פעיל ליחידה המשויכת."); return; }
      var contract = active[0];
      var cat = ins.check_key ? catalogInfo(ins.check_key) : null;
      var checkLabel = cat ? cat.l : typeInfo(ins.inspection_type).l;
      var body = "שוכר/ת נכבד/ה " + (contract.tenants?.name || "") + ",\n\n" +
        "בהתאם להוראות הסכם השכירות ונוהל הבטיחות, עליך להמציא/לחדש את האישור הבא עבור המושכר:\n" +
        "• " + checkLabel + (ins.standard ? " (" + ins.standard + ")" : "") + "\n" +
        (ins.next_inspection_date ? "מועד נדרש: " + fmtDate(ins.next_inspection_date) + "\n" : "") +
        "\nנא להמציא אישור בתוקף בהקדם, ולהפקיד עותק במשרדנו לתיק הנכס.\n\nבברכה,\nהנהלת הנכס";
      const { data, error } = await supabase.from("letters").insert({
        contract_id: contract.id,
        letter_type: "demand",
        title: "דרישת אישור בטיחות — " + checkLabel,
        content_json: { body: body, kind: "safety_demand" },
        status: "draft",
      }).select().single();
      if (error) throw error;
      await logAudit({ entity_type:"letter", entity_id:data.id, action:"safety_demand" });
      alert("✅ נוצרה טיוטת מכתב דרישה — היכנס למסך מכתבים לעריכה והדפסה");
    } catch (e:any) { alert("שגיאה: " + (e?.message || e)); }
  }

  // Create all standard management checks for a property that don't exist yet.
  async function generateStandardChecks(propId: string, propName: string) {
    var existingKeys = new Set(inspections.filter(function(i){return i.property_id===propId;}).map(function(i){return i.check_key;}));
    var toAdd = CHECK_CATALOG.filter(function(c){ return c.responsible==="management" && !existingKeys.has(c.key); });
    if (toAdd.length === 0) { alert("כל בדיקות התקן כבר קיימות לנכס זה."); return; }
    if (!confirm("ליצור " + toAdd.length + " בדיקות תקן לנכס " + propName + "? (ללא תאריכים — תמלא אותם בהמשך)")) return;
    var rows = toAdd.map(function(c){ return {
      property_id: propId, check_key: c.key, inspection_type: c.type, standard: c.standard,
      frequency_months: c.freq, scope: c.scope, responsible_party: c.responsible, status: "pending",
      notes: c.note,
    };});
    await supabase.from("safety_inspections").insert(rows);
    await logAudit({ entity_type:"safety", entity_id:propId, action:"generate_standard_checks", notes: toAdd.length+" בדיקות" });
    await loadAll();
  }

  function toggleSpace(sid: string) {
    setFSelectedSpaces(function(prev) {
      return prev.includes(sid) ? prev.filter(function(x) { return x !== sid; }) : [...prev, sid];
    });
  }

  // A record belongs to the tenant tab when its responsibility is the tenant
  // (or scope=unit); otherwise it's a public/building (management) record.
  function tabOf(ins: any): "public"|"tenant" {
    var rp = ins.responsible_party ?? (ins.scope === "unit" ? "tenant" : "management");
    return rp === "tenant" ? "tenant" : "public";
  }

  // ─── Filtering + sorting (within the active tab) ──────────────────
  const tabList = inspections.filter(function(ins){ return tabOf(ins) === activeTab; });
  const filtered = tabList.filter(function(ins) {
    const mt = filterType==="all" || ins.inspection_type===filterType;
    const mp = filterPropIds.length===0 || filterPropIds.includes(ins.property_id);
    var h = healthOf(ins);
    var mst = filterSt==="all"
      || (filterSt==="valid" && h==="valid")
      || (filterSt==="due" && (h==="due30"||h==="due60"))
      || (filterSt==="expired" && h==="expired");
    return mt && mp && mst;
  });
  const sorted = filtered.slice().sort(function(a,b){
    var ha=healthOrder(healthOf(a)), hb=healthOrder(healthOf(b));
    if (ha!==hb) return ha-hb;
    var ea=a.next_inspection_date?new Date(a.next_inspection_date).getTime():Infinity;
    var eb=b.next_inspection_date?new Date(b.next_inspection_date).getTime():Infinity;
    return ea-eb;
  });

  const propScoped = tabList.filter(function(ins){ return filterPropIds.length===0 || filterPropIds.includes(ins.property_id); });
  const expiring = propScoped.filter(function(ins) { var h=healthOf(ins); return h==="due30"||h==="due60"; });
  const expired  = propScoped.filter(function(ins) { return healthOf(ins)==="expired"; });
  const valid    = propScoped.filter(function(ins) { return healthOf(ins)==="valid"; });
  const publicCount = inspections.filter(function(i){ return tabOf(i)==="public"; }).length;
  const tenantCount = inspections.filter(function(i){ return tabOf(i)==="tenant"; }).length;

  // PUBLIC tab gap: per-property management checks not yet set up.
  const propsForGap = properties.filter(function(p){ return filterPropIds.length===0 || filterPropIds.includes(p.id); });
  const missingByProperty = propsForGap.map(function(p:any){
    var keys = new Set(inspections.filter(function(i){return i.property_id===p.id;}).map(function(i){return i.check_key;}));
    var missing = CHECK_CATALOG.filter(function(c){ return c.responsible==="management" && !keys.has(c.key); });
    return { p: p, missing: missing };
  }).filter(function(x){ return x.missing.length>0; });

  // TENANT tab gap: active contracts (units) with no tenant safety check.
  const tenantInspections = inspections.filter(function(i){ return tabOf(i)==="tenant"; });
  function contractHasTenantCheck(contract: any): boolean {
    var contractSpaceIds = new Set((contract.contract_spaces||[]).map(function(cs:any){return cs.space_id;}));
    return tenantInspections.some(function(ins:any){
      var insSpaceIds = (ins.inspection_spaces||[]).map(function(s:any){return s.space_id;});
      if (insSpaceIds.some(function(id:string){ return contractSpaceIds.has(id); })) return true;
      if (ins.tenant_id && contract.tenant_id && ins.tenant_id === contract.tenant_id) return true;
      return false;
    });
  }
  const baseActiveContracts = contracts.filter(function(c:any){
    if (filterPropIds.length>0 && !filterPropIds.includes(c.property_id)) return false;
    if (c.is_amendment===true) return false;
    if (c.parent_contract_id) return false;
    return true;
  });
  const contractsMissingTenantCheck = baseActiveContracts.filter(function(c:any){ return !contractHasTenantCheck(c); });

  const typeInfo  = function(v: string) { return INSPECTION_TYPES.find(function(t){return t.v===v;}) ?? INSPECTION_TYPES[7]; };
  const scopeInfo = function(v: string) { return SCOPES.find(function(s){return s.v===v;}) ?? SCOPES[0]; };

  return (
    <div dir="rtl">
      <PageHero title="בדיקות בטיחות ואישורים" icon="🧯" tone="rose"
        subtitle={<>
          {valid.length} תקינות
          {expiring.length > 0 && <span className="text-amber-200 font-semibold"> | {expiring.length} פגות ב-60 יום</span>}
          {expired.length > 0 && <span className="text-rose-100 font-semibold"> | {expired.length} פגו!</span>}
        </>}
        actions={
          <>
            <button onClick={function(){setShowRef(!showRef);}} className="rounded-xl bg-white/15 backdrop-blur border border-white/25 px-3 py-2 text-sm text-white hover:bg-white/25" title="דרישות כיבוי אש לפי סוג נכס (מידע)">📖 דרישות לפי סוג</button>
            <button onClick={function(){openNew();}} className="rounded-xl bg-white text-rose-700 px-4 py-2 text-sm font-bold hover:bg-rose-50 shadow-sm" title={activeTab==="tenant"?"הוסף אישור בטיחות לשוכר":"הוסף בדיקה לחלקים הציבוריים/מערכות המבנה"}>+ {activeTab==="tenant"?"אישור שוכר":"בדיקה"} חדש</button>
          </>
        } />

      {/* Tabs: public (management) vs tenant (units/contracts) */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {[{v:"public",l:"🏢 ציבורי / מבנה (חברת ניהול)",c:publicCount},{v:"tenant",l:"🏠 יחידות / שוכרים (חוזים)",c:tenantCount}].map(function(t) {
          return (
            <button key={t.v} onClick={function(){setActiveTab(t.v as any); setFilterSt("all"); setFilterType("all");}}
              className={"px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px " +
                (activeTab===t.v?"border-blue-600 text-blue-700":"border-transparent text-slate-500 hover:text-slate-700")}>
              {t.l}
              <span className="mr-2 text-xs bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5">{t.c}</span>
            </button>
          );
        })}
      </div>

      {/* Reference: fire requirements by property type */}
      {showRef && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 mb-4">
          <div className="text-sm font-bold text-slate-800 mb-2">📖 דרישות כיבוי אש טיפוסיות לפי סוג נכס</div>
          <div className="text-[11px] text-slate-500 mb-3">הדרישה המחייבת בפועל נקבעת ע\"י הרשות הארצית לכבאות לאחר ביקורת/חוות דעת יועץ בטיחות. זהו מידע התשתית הטיפוסי.</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {FIRE_BY_TYPE.map(function(ft){
              return (
                <div key={ft.type} className="rounded-lg border border-slate-200 p-3">
                  <div className="font-bold text-slate-700 text-sm mb-1.5">{ft.icon} {ft.type}</div>
                  <ul className="space-y-1">
                    {ft.rows.map(function(r,i){ return <li key={i} className="text-[11px] text-slate-600">• {r}</li>; })}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* KPI — clickable filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          {f:"all",     label:"סה\"כ",       value:propScoped.length, color:"text-slate-600", bg:"bg-white"},
          {f:"valid",   label:"תקינות",     value:valid.length,    color:"text-green-700", bg:"bg-white"},
          {f:"due",     label:"פגות בקרוב", value:expiring.length, color:expiring.length>0?"text-yellow-700":"text-slate-400", bg:expiring.length>0?"bg-yellow-50":"bg-white"},
          {f:"expired", label:"פגו!",       value:expired.length,  color:expired.length>0?"text-red-700":"text-slate-400", bg:expired.length>0?"bg-red-50":"bg-white"},
        ].map(function(k) {
          return (
            <button key={k.label} onClick={function(){setFilterSt(k.f as any);}}
              className={"rounded-xl border p-3 text-center transition-all " + k.bg + (filterSt===k.f?" border-blue-500 ring-2 ring-blue-300":" border-slate-200")}>
              <div className={"text-2xl font-black " + k.color}>{k.value}</div>
              <div className={"text-xs font-semibold " + k.color}>{k.label}</div>
            </button>
          );
        })}
      </div>

      <div className="mb-4">
        <PropertyHierarchyFilter onChange={function(f) { setFilterPropIds(f.propertyIds); }} />
      </div>

      {/* TENANT tab: contracts (units) with no tenant safety check */}
      {activeTab==="tenant" && contractsMissingTenantCheck.length > 0 && (
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4 mb-4">
          <div className="font-bold text-rose-800 text-sm">⚠ שוכרים ללא אישור בטיחות — {contractsMissingTenantCheck.length}</div>
          <div className="text-xs text-rose-600 mt-0.5">חוזים פעילים שלא נרשם עבורם אישור בטיחות (למשל אישור כיבוי אש לעסק השוכר). באחריות השוכר להמציא — עותק לתיק הנכס.</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {contractsMissingTenantCheck.slice(0,15).map(function(c:any){
              return (
                <div key={c.id} className="rounded-lg bg-white border border-rose-200 p-2.5 text-xs">
                  <div className="font-semibold text-slate-800">{(c.tenants as any)?.name}</div>
                  <div className="text-slate-500">{(c.properties as any)?.name}</div>
                  <div className="text-[10px] text-indigo-700 mt-0.5">יח&apos;: {spacesLabel(c)}</div>
                  <button onClick={function(){openNew(c.property_id, "tenant_fire_license");}} title="הוסף אישור בטיחות עבור שוכר זה"
                    className="mt-1.5 text-[11px] rounded bg-rose-600 hover:bg-rose-700 text-white px-2 py-1 font-semibold">+ הוסף אישור</button>
                </div>
              );
            })}
          </div>
          {contractsMissingTenantCheck.length>15 && <div className="text-[11px] text-rose-600 mt-2">ועוד {contractsMissingTenantCheck.length-15} שוכרים...</div>}
        </div>
      )}

      {/* PUBLIC tab: per-property management checks not yet set up */}
      {activeTab==="public" && missingByProperty.length > 0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 mb-4">
          <div className="font-bold text-amber-800 text-sm">⚠ בדיקות תקן מומלצות שטרם הוקמו — באחריות חברת הניהול</div>
          <div className="text-xs text-amber-700 mt-0.5">לפי נוהל המעקב, אלו הבדיקות התקופתיות לחלקים הציבוריים/מערכות המבנה. הקם אותן כדי לשמור על תוקף הביטוח. (התאמת הרשימה לנכס נעשית לפי המערכות הקיימות בו.)</div>
          <div className="mt-3 space-y-2">
            {missingByProperty.map(function(x:any){
              return (
                <div key={x.p.id} className="rounded-lg bg-white border border-amber-200 p-2.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="font-semibold text-slate-800 text-sm">{x.p.name} — חסרות {x.missing.length} בדיקות</div>
                    <button onClick={function(){generateStandardChecks(x.p.id, x.p.name);}} title="צור את כל בדיקות התקן החסרות לנכס בלחיצה אחת"
                      className="text-[11px] rounded bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 font-semibold">⚙ צור בדיקות תקן לנכס</button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {x.missing.map(function(c:any){
                      return (
                        <button key={c.key} onClick={function(){openNew(x.p.id, c.key);}} title={c.note + " · " + c.standard}
                          className="text-[10px] rounded border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 px-1.5 py-0.5">
                          + {c.l}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Type filters */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {[{v:"all",l:"הכל"}, ...INSPECTION_TYPES.map(function(t){return {v:t.v,l:t.icon+" "+t.l};})].map(function(f) {
          return (
            <button key={f.v} onClick={function(){setFilterType(f.v);}}
              className={"rounded-xl border px-2.5 py-1.5 text-xs font-semibold " +
                (filterType===f.v?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600")}>
              {f.l}
            </button>
          );
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🔒</div><div>אין בדיקות התואמות את הסינון</div>
          <button onClick={function(){openNew();}} className="mt-3 text-blue-600 hover:underline text-sm">+ הוסף בדיקה</button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-right text-sm min-w-[640px]">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">בדיקה / סוג</th>
                <th className="px-4 py-3 font-semibold text-slate-700">נכס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">שיוך / אחראי</th>
                <th className="px-4 py-3 font-semibold text-slate-700">תדירות / תקן</th>
                <th className="px-4 py-3 font-semibold text-slate-700">בדיקה הבאה</th>
                <th className="px-4 py-3 font-semibold text-slate-700">סטטוס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(function(ins) {
                const ti   = typeInfo(ins.inspection_type);
                const sc   = scopeInfo(ins.scope ?? "public");
                const cat  = ins.check_key ? catalogInfo(ins.check_key) : null;
                const h    = healthOf(ins);
                const d    = ins.next_inspection_date ? daysLeft(ins.next_inspection_date) : null;
                const rowBg = h==="expired" ? "bg-red-50 border-r-4 border-red-500"
                  : h==="due30" ? "bg-orange-50 border-r-4 border-orange-400"
                  : h==="due60" ? "bg-yellow-50/40" : "hover:bg-slate-50";
                const linkedSpaces = (ins.inspection_spaces || []).map(function(is: any) { return is.spaces?.space_name || ""; }).filter(Boolean);
                const isTenant = (ins.responsible_party ?? (ins.scope==="unit"?"tenant":"management")) === "tenant";
                const docs = Array.isArray(ins.documents) ? ins.documents : [];
                return (
                  <tr key={ins.id} className={"border-t border-slate-100 " + rowBg}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-lg">{ti.icon}</span>
                        <span className="text-xs font-semibold text-slate-800">{cat ? cat.l : ti.l}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{ins.properties?.name}</td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (isTenant?"bg-teal-100 text-teal-700":"bg-purple-100 text-purple-700")}>
                        {isTenant ? "🏠 שוכר" : "🏢 חברת ניהול"}
                      </span>
                      {linkedSpaces.length > 0 && <div className="text-xs text-slate-400 mt-0.5">{linkedSpaces.join(", ")}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {ins.frequency_months ? <div>כל {ins.frequency_months} חוד׳</div> : null}
                      {ins.standard ? <div className="text-[10px] text-slate-400">{ins.standard}</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-slate-700">{fmtDate(ins.next_inspection_date)}</div>
                      {d!==null && h!=="valid" && (
                        <div className={"text-xs font-bold " + (d<0?"text-red-600":d<=30?"text-orange-600":"text-yellow-600")}>
                          {d<0 ? "פג לפני "+Math.abs(d)+" ימים" : "נותרו "+d+" ימים"}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-semibold " +
                        (h==="expired"?"bg-red-100 text-red-700":h==="valid"?"bg-green-100 text-green-700":h==="unknown"?"bg-slate-100 text-slate-600":"bg-yellow-100 text-yellow-700")}>
                        {h==="expired"?"פגה":h==="valid"?"תקינה":h==="unknown"?"ללא תאריך":"מתקרבת"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        <button onClick={function(){openEdit(ins);}} title="ערוך / עדכן ביצוע בדיקה" className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50">✏️ ערוך</button>
                        {isTenant && (
                          <button onClick={function(){sendSafetyDemand(ins);}} title="צור טיוטת מכתב דרישה לשוכר להמצאת/חידוש האישור"
                            className="text-xs border border-amber-200 bg-amber-50 rounded px-2 py-1 text-amber-700 hover:bg-amber-100">✉ דרישה</button>
                        )}
                        {(docs.length>0 ? docs.map(function(dc:any,i:number){ return <a key={i} href={dc.url} target="_blank" rel="noopener noreferrer" title="פתח אישור/תעודה" className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50">📄</a>; }) : (ins.document_url && <a href={ins.document_url} target="_blank" rel="noopener noreferrer" title="פתח אישור/תעודה" className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50">📄</a>))}
                        <button onClick={function(){handleDelete(ins.id);}} title="מחק בדיקה" className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={function(){setEditingId("");}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">{isNew?"בדיקה / אישור חדש":"עריכת בדיקה"}</h2>
              <button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">נכס *</label>
                <select value={fPropertyId} onChange={function(e){setFPropertyId(e.target.value); setFSelectedSpaces([]);}} className={ic}>
                  <option value="">-- בחר נכס --</option>
                  {properties.map(function(p){return <option key={p.id} value={p.id}>{p.name}</option>;})}
                </select>
              </div>

              {/* Catalog quick-pick */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">בדיקת תקן (ממלא אוטומטית סוג/תדירות/תקן)</label>
                <select value={fCheckKey} onChange={function(e){applyCatalog(e.target.value);}} className={ic}>
                  <option value="">— בדיקה מותאמת אישית —</option>
                  <optgroup label="🏢 אחריות חברת ניהול">
                    {CHECK_CATALOG.filter(function(c){return c.responsible==="management";}).map(function(c){return <option key={c.key} value={c.key}>{c.l} (כל {c.freq} חוד׳)</option>;})}
                  </optgroup>
                  <optgroup label="🏠 אחריות שוכר">
                    {CHECK_CATALOG.filter(function(c){return c.responsible==="tenant";}).map(function(c){return <option key={c.key} value={c.key}>{c.l}</option>;})}
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">שיוך בדיקה</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SCOPES.map(function(s) {
                    return (
                      <button key={s.v} type="button" title={s.desc} onClick={function(){
                        setFScope(s.v);
                        if (s.v !== "unit") setFSelectedSpaces([]);
                        setFResponsible(s.v === "unit" ? "tenant" : "management");
                      }}
                        className={"rounded-xl border p-2.5 text-center transition-all " + (fScope===s.v?"border-blue-500 bg-blue-50":"border-slate-200 hover:bg-slate-50")}>
                        <div className="text-xl">{s.icon}</div>
                        <div className={"text-xs font-bold " + (fScope===s.v?"text-blue-700":"text-slate-600")}>{s.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {fScope === "unit" && fPropertyId && spaces.length > 0 && (
                <div>
                  <label className="mb-2 block text-xs font-semibold text-slate-700">בחר יחידות *</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto">
                    {spaces.map(function(sp) {
                      const sel = fSelectedSpaces.includes(sp.id);
                      return (
                        <button key={sp.id} type="button" onClick={function(){ toggleSpace(sp.id); }}
                          className={"rounded-lg border p-2 text-center text-xs transition-all " +
                            (sel ? "border-teal-500 bg-teal-50 font-bold text-teal-700" : "border-slate-200 hover:bg-slate-50")}>
                          <div className="font-semibold">{sp.space_name}</div>
                          {sp.area && <div className="text-slate-400">{sp.area} מ&quot;ר</div>}
                        </button>
                      );
                    })}
                  </div>
                  {fSelectedSpaces.length > 0 && <div className="text-xs text-teal-600 mt-1 font-semibold">{fSelectedSpaces.length} יחידות נבחרו</div>}
                </div>
              )}

              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 flex items-center gap-2">
                <span className="text-xs text-slate-500">אחראי:</span>
                <span className={"text-xs font-bold " + (fScope === "unit" ? "text-teal-700" : "text-purple-700")}>
                  {fScope === "unit" ? "🏠 שוכר" : "🏢 חברת ניהול"}
                </span>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">סוג בדיקה</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {INSPECTION_TYPES.map(function(t) {
                    return (
                      <button key={t.v} type="button" onClick={function(){setFType(t.v);}}
                        className={"rounded-lg border p-2 text-center " + (fType===t.v?"border-blue-500 bg-blue-50":"border-slate-200 hover:bg-slate-50")}>
                        <div className="text-lg">{t.icon}</div>
                        <div className={"text-xs " + (fType===t.v?"text-blue-700 font-bold":"text-slate-500")}>{t.l}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">תדירות (חודשים)</label><input type="number" value={fFreq} onChange={function(e){setFFreq(e.target.value);}} className={ic} placeholder="לדוגמה 12" /></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">תקן / מקור</label><input type="text" value={fStandard} onChange={function(e){setFStandard(e.target.value);}} className={ic} /></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">מבצע / מפקח</label><input type="text" value={fInspector} onChange={function(e){setFInspector(e.target.value);}} className={ic} /></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">מספר תעודה</label><input type="text" value={fCertNum} onChange={function(e){setFCertNum(e.target.value);}} className={ic} dir="ltr" /></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">בדיקה אחרונה</label><input type="date" value={fLastDate} onChange={function(e){setFLastDate(e.target.value);}} className={ic} /></div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">בדיקה הבאה</label>
                  <input type="date" value={fNextDate} onChange={function(e){setFNextDate(e.target.value);}} className={ic} />
                  {fLastDate && fFreq && <button type="button" onClick={function(){var nd=addMonths(fLastDate,Number(fFreq)); if(nd)setFNextDate(nd);}} className="text-[10px] text-blue-600 hover:underline mt-0.5">חשב מ-{fFreq} חוד׳ →</button>}
                </div>
              </div>

              {/* Cloud document upload */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                <label className="block text-xs font-semibold text-slate-700">📄 אישור / תעודת בדיקה (עליה לענן או קישור)</label>
                <div className="flex gap-2 items-center flex-wrap">
                  <input ref={fileRef} type="file" onChange={handleFileChange}
                    className="text-xs file:rounded file:border-0 file:bg-blue-600 file:text-white file:px-3 file:py-1.5 file:font-semibold file:cursor-pointer file:ml-2"/>
                  {uploading && <span className="text-xs text-blue-600">מעלה...</span>}
                </div>
                <input type="text" value={fDocUrl} onChange={function(e){setFDocUrl(e.target.value);}} placeholder="או הדבק קישור (Drive / Dropbox / כל URL)" className={ic} dir="ltr"/>
                {fDocUrl && <div className="text-[11px] text-emerald-700 flex items-center gap-2">✓ מסמך מצורף — <a href={fDocUrl} target="_blank" rel="noopener noreferrer" className="underline">פתח</a><button type="button" onClick={function(){setFDocUrl("");}} className="text-rose-600 underline">הסר</button></div>}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סטטוס</label>
                <select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} className={ic}>
                  <option value="valid">תקינה</option>
                  <option value="pending">בהמתנה / טרם בוצעה</option>
                  <option value="expired">פגה</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1">הסטטוס יחושב אוטומטית לפי תאריך הבדיקה הבאה בעת השמירה.</p>
              </div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label><input type="text" value={fNotes} onChange={function(e){setFNotes(e.target.value);}} className={ic} /></div>
              <div className="flex gap-3 pt-2">
                <button onClick={function(){setEditingId("");}} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving?"שומר...":"שמור"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
