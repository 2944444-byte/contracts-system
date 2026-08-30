"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import { PageHero } from '@/components/ui';
import OrgContactsEditor from '@/components/OrgContactsEditor';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

export default function CompaniesPage() {
  const router = useRouter();
  const [companies,  setCompanies]  = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState("");
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [selected,   setSelected]   = useState<string|null>(null);
  const [search,     setSearch]     = useState("");

  const [fName,    setFName]    = useState("");
  const [fId,      setFId]      = useState("");
  const [fAddress, setFAddress] = useState("");
  const [fCity,    setFCity]    = useState("");
  const [fPhone,   setFPhone]   = useState("");
  const [fEmail,   setFEmail]   = useState("");
  const [fContact, setFContact] = useState("");
  const [fNotes,   setFNotes]   = useState("");
  const [fLogoUrl, setFLogoUrl] = useState("");
  const [fBankName, setFBankName] = useState("");
  const [fBankBranch, setFBankBranch] = useState("");
  const [fBankAccount, setFBankAccount] = useState("");
  // Auto-created charges (insurance, mgmt diff, CPI diff, etc.) get
  // due_date = today + this many days. Default 30.
  const [fGraceDays, setFGraceDays] = useState<string>("30");

  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from("companies").select("*").order("company_name"),
      supabase.from("properties").select("id,name,company_id,city").order("name"),
    ]);
    setCompanies(c??[]); setProperties(p??[]); setLoading(false);
    if (!selected && (c??[]).length>0) setSelected((c??[])[0].id);
  }

  function openNew() { setIsNew(true); setEditingId("new"); setFName(""); setFId(""); setFAddress(""); setFCity(""); setFPhone(""); setFEmail(""); setFContact(""); setFNotes(""); setFLogoUrl(""); setFBankName(""); setFBankBranch(""); setFBankAccount(""); setFGraceDays("30"); }
  function openEdit(c: any) { setIsNew(false); setEditingId(c.id); setFName(c.company_name??""); setFId(c.company_id??""); setFAddress(c.address??""); setFCity(c.city??""); setFPhone(c.phone??""); setFEmail(c.email??""); setFContact(c.contact_name??""); setFNotes(c.notes??""); setFLogoUrl(c.logo_url??""); setFBankName(c.bank_name??""); setFBankBranch(c.bank_branch??""); setFBankAccount(c.bank_account??""); setFGraceDays(String(c.payment_grace_days ?? 30)); }

  async function handleSave() {
    if (!fName.trim()) { alert("חובה: שם חברה"); return; }
    setSaving(true);
    try {
      var graceNum = Number(fGraceDays);
      if (!graceNum || graceNum <= 0) graceNum = 30;
      const payload={company_name:fName.trim(),company_id:fId||null,address:fAddress||null,city:fCity||null,phone:fPhone||null,email:fEmail||null,contact_name:fContact||null,notes:fNotes||null,logo_url:fLogoUrl||null,bank_name:fBankName||null,bank_branch:fBankBranch||null,bank_account:fBankAccount||null,payment_grace_days:graceNum};
      if (isNew) { const { data, error: ie } = await supabase.from("companies").insert(payload).select().single(); if (ie) throw new Error(ie.message); await logAudit({entity_type:"company",entity_id:data!.id,action:"create"}); setSelected(data!.id); }
      else { await supabase.from("companies").update(payload).eq("id",editingId); await logAudit({entity_type:"company",entity_id:editingId,action:"update"}); }
      setEditingId(""); await loadAll();
    } catch(e:any) { alert("שגיאה: "+e?.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    const companyProps = properties.filter(p => p.company_id === id);
    const propCount = companyProps.length;
    if (!confirm(`למחוק חברה? פעולה זו תמחק גם ${propCount} נכסים, כל היחידות, החוזים, הערבויות והביטוחים הקשורים!`)) return;
    try {
      // For each property of the company, cascade delete
      for (const prop of companyProps) {
        const { data: pContracts } = await supabase.from("contracts").select("id").eq("property_id", prop.id);
        const cIds = (pContracts || []).map((c: any) => c.id);
        if (cIds.length > 0) {
          await supabase.from("charges").delete().in("contract_id", cIds);
          await supabase.from("contract_spaces").delete().in("contract_id", cIds);
          await supabase.from("contract_options").delete().in("contract_id", cIds);
          await supabase.from("contract_price_tiers").delete().in("contract_id", cIds);
          await supabase.from("guarantees").delete().in("contract_id", cIds);
          await supabase.from("insurances_tenant").delete().in("contract_id", cIds);
          await supabase.from("letters").delete().in("contract_id", cIds);
          await supabase.from("contracts").delete().in("id", cIds);
        }
        await supabase.from("units").delete().eq("property_id", prop.id);
        await supabase.from("spaces").delete().eq("property_id", prop.id);
        await supabase.from("insurances_building").delete().eq("property_id", prop.id);
        await supabase.from("safety_inspections").delete().eq("property_id", prop.id);
        await supabase.from("property_budgets").delete().eq("property_id", prop.id);
        await supabase.from("properties").delete().eq("id", prop.id);
      }
      await supabase.from("companies").delete().eq("id", id);
      await logAudit({ entity_type: "company", entity_id: id, action: "delete" });
      setSelected(null); await loadAll();
    } catch (e: any) { alert("שגיאה במחיקה: " + e?.message); }
  }

  const filtered = companies.filter(function(c){ return !search||c.company_name?.includes(search)||c.city?.includes(search); });
  const selCo    = companies.find(function(c){return c.id===selected;});
  const selProps = properties.filter(function(p){return p.company_id===selected;});

  return (
    <div dir="rtl">
      <PageHero title="חברות" subtitle={companies.length + " חברות"} icon="🏛️" tone="slate" actionLabel="+ חברה" onAction={openNew} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="space-y-2">
          <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="חיפוש..." className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm mb-2"/>
          {loading ? <div className="text-center py-4 text-slate-400">טוען...</div> : (
            filtered.map(function(c) {
              const propCount=properties.filter(function(p){return p.company_id===c.id;}).length;
              return (
                <div key={c.id} onClick={function(){setSelected(selected===c.id?null:c.id);}} className={"rounded-xl border p-3 cursor-pointer transition-all "+(selected===c.id?"border-blue-500 bg-blue-50 shadow-sm":"border-slate-200 bg-white hover:shadow-sm")}>
                  <div className="flex items-center justify-between"><div className="font-semibold text-slate-800 text-sm">🏛️ {c.company_name}</div>{propCount>0&&<span title={propCount + " נכסים בבעלות החברה"} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full cursor-help">{propCount}</span>}</div>
                  {c.city&&<div className="text-xs text-slate-400 mt-0.5">📍 {c.city}</div>}
                  {c.company_id&&<div className="text-xs text-slate-400 font-mono">ח.פ: {c.company_id}</div>}
                </div>
              );
            })
          )}
        </div>

        <div className="lg:col-span-2">
          {!selCo ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400"><div className="text-5xl mb-3">🏛️</div><div>בחר חברה</div></div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {selCo.logo_url && <img src={selCo.logo_url} alt="" className="h-12 max-w-[110px] object-contain rounded" />}
                    <div><h2 className="text-xl font-bold text-slate-800">{selCo.company_name}</h2>{selCo.company_id&&<div className="text-sm text-slate-500 font-mono">ח.פ: {selCo.company_id}</div>}</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function(){openEdit(selCo);}} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">✏️ עריכה</button>
                    <button onClick={function(){handleDelete(selCo.id);}} className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">🗑</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    {l:"כתובת",v:[selCo.address, selCo.city].filter(Boolean).join(", "),icon:"📍"},
                    {l:"טלפון",v:selCo.phone,icon:"📞"},
                    {l:"אימייל",v:selCo.email,icon:"✉️"},
                    {l:"איש קשר",v:selCo.contact_name,icon:"👤"},
                    {l:"מספר רישום",v:selCo.company_registration_number,icon:"🗂️"},
                    {l:"חשבון בנק",v:(selCo.bank_name||selCo.bank_account)?[selCo.bank_name, selCo.bank_branch?"סניף "+selCo.bank_branch:"", selCo.bank_account?"חשבון "+selCo.bank_account:""].filter(Boolean).join(" · "):"",icon:"🏦"},
                    {l:"ימי חסד לתשלום",v:selCo.payment_grace_days?selCo.payment_grace_days+" ימים":"",icon:"⏳"},
                  ].filter(function(f){return f.v;}).map(function(f){return <div key={f.l} className="flex items-center gap-2 text-slate-600"><span>{f.icon}</span><div><div className="text-xs text-slate-400">{f.l}</div><div className="font-medium text-slate-800">{f.v}</div></div></div>;})}
                </div>
                {/* קישורים מהירים — המסכים נפתחים מסוננים לחברה זו */}
                <div className="mt-4 flex gap-2 flex-wrap">
                  <button onClick={function(){router.push("/properties?companyId="+selCo.id);}} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">🏢 הנכסים של החברה</button>
                  <button onClick={function(){router.push("/contracts?companyId="+selCo.id);}} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">📄 החוזים של החברה</button>
                  <button onClick={function(){router.push("/tenants?companyId="+selCo.id);}} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">👤 השוכרים של החברה</button>
                </div>
                {selCo.notes&&<div className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg p-2">{selCo.notes}</div>}
              </div>
              {selProps.length>0&&(
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-700 text-sm">נכסים ({selProps.length})</div>
                  <div className="divide-y divide-slate-100">
                    {selProps.map(function(p){return <div key={p.id} onClick={function(){router.push("/units?propertyId="+p.id);}} className="px-5 py-3 flex items-center gap-2 hover:bg-slate-50 cursor-pointer" title="פתח את יחידות הנכס"><span>🏢</span><span className="text-sm font-medium text-slate-800">{p.name}</span>{p.city&&<span className="text-xs text-slate-400">— {p.city}</span>}<span className="mr-auto text-slate-300">‹</span></div>;})}
                  </div>
                </div>
              )}
              {/* מכותבים פנימיים למכתבים — אנשי הקשר של הארגון ברמת החברה:
                  מקבלים עותק אוטומטי במכתבים לשוכרי כל נכסי החברה, לפי נושא. */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="font-semibold text-slate-700 text-sm mb-1">📧 אנשי קשר למכתבים (מכותבים פנימיים)</div>
                <div className="text-[11px] text-slate-400 mb-3">מקבלים עותק אוטומטי במכתבים לשוכרים בכל נכסי החברה, לפי הנושאים שסומנו</div>
                <OrgContactsEditor companyId={selCo.id} />
              </div>
            </div>
          )}
        </div>
      </div>

      {editingId&&(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setEditingId(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={function(e){e.stopPropagation();}} dir="rtl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between"><h2 className="font-bold text-slate-800 text-lg">{isNew?"חברה חדשה":"עריכה"}</h2><button onClick={function(){setEditingId("");}} className="text-2xl text-slate-400">×</button></div>
            <div className="p-6 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="mb-1 block text-xs font-semibold text-slate-700">שם חברה *</label><input type="text" value={fName} onChange={function(e){setFName(e.target.value);}} className={ic}/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">ח.פ</label><input type="text" value={fId} onChange={function(e){setFId(e.target.value);}} className={ic} dir="ltr"/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">איש קשר</label><input type="text" value={fContact} onChange={function(e){setFContact(e.target.value);}} className={ic}/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">כתובת</label><input type="text" value={fAddress} onChange={function(e){setFAddress(e.target.value);}} className={ic}/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">עיר</label><input type="text" value={fCity} onChange={function(e){setFCity(e.target.value);}} className={ic}/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">טלפון</label><input type="tel" value={fPhone} onChange={function(e){setFPhone(e.target.value);}} className={ic} dir="ltr"/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-700">אימייל</label><input type="email" value={fEmail} onChange={function(e){setFEmail(e.target.value);}} className={ic} dir="ltr"/></div>
                <div className="col-span-2"><label className="mb-1 block text-xs font-semibold text-slate-700">הערות</label><textarea value={fNotes} onChange={function(e){setFNotes(e.target.value);}} rows={2} className={ic}/></div>
                <div className="col-span-2 border-t border-slate-200 pt-3 mt-1">
                  <div className="text-xs font-bold text-slate-600 mb-2">🏦 פרטי בנק (למכתבי דרישה)</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div><label className="mb-1 block text-xs text-slate-600">שם בנק</label><input value={fBankName} onChange={function(e){setFBankName(e.target.value);}} className={ic} placeholder="בנק הפועלים"/></div>
                    <div><label className="mb-1 block text-xs text-slate-600">סניף</label><input value={fBankBranch} onChange={function(e){setFBankBranch(e.target.value);}} className={ic} placeholder="159"/></div>
                    <div><label className="mb-1 block text-xs text-slate-600">מס׳ חשבון</label><input value={fBankAccount} onChange={function(e){setFBankAccount(e.target.value);}} className={ic} placeholder="15156"/></div>
                  </div>
                </div>
                <div className="col-span-2 border-t border-slate-200 pt-3 mt-1">
                  <div className="text-xs font-bold text-slate-600 mb-2">⚙️ הגדרות תשלום</div>
                  <div className="grid grid-cols-2 gap-3 items-end">
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">ימי חסד לתשלום (ברירת מחדל)</label>
                      <input type="number" min="1" max="365" value={fGraceDays} onChange={function(e){setFGraceDays(e.target.value);}} className={ic} placeholder="30"/>
                    </div>
                    <div className="text-[11px] text-slate-500 pb-2">
                      כל חיוב שנוצר אוטומטית (ביטוח, הפרשי הצמדה, התחשבנות ניהול) יקבל תאריך תשלום של היום + מספר זה. רק לאחר התאריך הזה הוא יסומן "באיחור".
                    </div>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">🖼️ לוגו חברה</label>
                  <div className="flex items-center gap-3">
                    <label className="cursor-pointer rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">
                      📁 בחר קובץ
                      <input type="file" accept="image/*" className="hidden" onChange={async function(e) {
                        var file = e.target.files?.[0];
                        if (!file) return;
                        var ext = file.name.split(".").pop() || "png";
                        var path = "company-" + (editingId || "new") + "-" + Date.now() + "." + ext;
                        var { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
                        if (error) { alert("שגיאה בהעלאה: " + error.message); return; }
                        var { data: urlData } = supabase.storage.from("logos").getPublicUrl(path);
                        setFLogoUrl(urlData.publicUrl);
                      }} />
                    </label>
                    {fLogoUrl && (
                      <div className="flex items-center gap-2">
                        <img src={fLogoUrl} alt="logo" className="h-12 object-contain rounded border" />
                        <button type="button" onClick={function(){setFLogoUrl("");}} className="text-xs text-red-500 hover:text-red-700">🗑</button>
                      </div>
                    )}
                    {!fLogoUrl && <span className="text-xs text-slate-400">אין לוגו — שם החברה יוצג במכתבים</span>}
                  </div>
                </div>
              </div>
              {/* מכותבים פנימיים — עותק מייל לפי נושא, לכל נכסי החברה */}
              <OrgContactsEditor companyId={isNew ? undefined : editingId} />

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
