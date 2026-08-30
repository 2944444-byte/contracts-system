"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { TENANT_TOPICS } from "@/lib/tenant-contacts";
import { logAudit } from "@/lib/audit-log";
import { useAccess } from "@/components/AccessProvider";
import { hasPerm } from "@/lib/permissions";

// עורך אנשי הקשר של שוכר — כמו עורך המכותבים הפנימיים של חברה, אבל על
// tenants.contacts (מערך JSONB): שם, תפקיד, טלפון, אימייל ומינויי נושאים.
// משובץ בפאנל פרטי השוכר — צפייה, הוספה ועריכה בלי להיכנס לטופס העריכה.
// שמירה מיידית לכל פעולה; מכתבים מנותבים לאנשי הקשר לפי נושא המכתב.
const ic = "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right text-xs text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

export default function TenantContactsEditor(props: { tenantId: string; onChanged?: () => void }) {
  const { access } = useAccess();
  const canEdit = !access || hasPerm(access, "manage_contracts");
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [form, setForm] = useState<{ name: string; role: string; phone: string; email: string; topics: Record<string, boolean> }>({ name: "", role: "", phone: "", email: "", topics: { all: true } });

  useEffect(function () { load(); }, [props.tenantId]);
  async function load() {
    if (!props.tenantId) { setContacts([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from("tenants").select("contacts").eq("id", props.tenantId).single();
    setContacts(Array.isArray((data as any)?.contacts) ? (data as any).contacts : []);
    setLoading(false);
  }

  async function saveAll(next: any[], action: string) {
    const { error } = await supabase.from("tenants").update({ contacts: next }).eq("id", props.tenantId);
    if (error) { alert("שגיאה בשמירה: " + error.message); return false; }
    await logAudit({ entity_type: "tenant", entity_id: props.tenantId, action: "contacts_" + action });
    setContacts(next);
    if (props.onChanged) props.onChanged();
    return true;
  }

  function openAdd() {
    setForm({ name: "", role: "", phone: "", email: "", topics: { all: true } });
    setEditIdx(null); setAdding(true);
  }
  function openEditRow(i: number) {
    const c = contacts[i] || {};
    const topics: Record<string, boolean> = {};
    (Array.isArray(c.topics) ? c.topics : ["all"]).forEach(function (k: string) { topics[k] = true; });
    setForm({ name: c.name || "", role: c.role || "", phone: c.phone || "", email: c.email || "", topics: topics });
    setAdding(false); setEditIdx(i);
  }
  async function submitForm() {
    if (!form.name.trim() && !form.email.trim()) { alert("נדרש לפחות שם או אימייל"); return; }
    const topics = Object.keys(form.topics).filter(function (k) { return form.topics[k]; });
    if (topics.length === 0) { alert("סמן לפחות נושא אחד (או 'כל ההתכתבויות')"); return; }
    const entry = { name: form.name.trim(), role: form.role.trim(), phone: form.phone.trim(), email: form.email.trim(), topics: topics };
    let next: any[];
    if (editIdx !== null) {
      next = contacts.map(function (c, i) { return i === editIdx ? { ...c, ...entry } : c; });
    } else {
      next = contacts.concat([entry]);
    }
    if (await saveAll(next, editIdx !== null ? "update" : "add")) { setAdding(false); setEditIdx(null); }
  }
  async function removeRow(i: number) {
    const c = contacts[i];
    if (!confirm("להסיר את " + (c?.name || "איש הקשר") + "?")) return;
    await saveAll(contacts.filter(function (_, j) { return j !== i; }), "remove");
  }
  async function toggleTopic(i: number, key: string) {
    const c = contacts[i] || {};
    let topics: string[] = Array.isArray(c.topics) ? c.topics.slice() : ["all"];
    const at = topics.indexOf(key);
    if (at === -1) topics.push(key); else topics.splice(at, 1);
    if (topics.length === 0) { alert("איש קשר חייב לפחות נושא אחד"); return; }
    await saveAll(contacts.map(function (x, j) { return j === i ? { ...x, topics: topics } : x; }), "topics");
  }

  const formUI = (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-2.5 space-y-2 mb-2">
      <div className="grid grid-cols-2 gap-2">
        <input type="text" value={form.name} placeholder="שם *" className={ic}
          onChange={function (e) { setForm({ ...form, name: e.target.value }); }} />
        <input type="text" value={form.role} placeholder="תפקיד (למשל: הנהלת חשבונות)" className={ic}
          onChange={function (e) { setForm({ ...form, role: e.target.value }); }} />
        <input type="tel" value={form.phone} placeholder="טלפון" className={ic} dir="ltr"
          onChange={function (e) { setForm({ ...form, phone: e.target.value }); }} />
        <input type="email" value={form.email} placeholder="אימייל" className={ic} dir="ltr"
          onChange={function (e) { setForm({ ...form, email: e.target.value }); }} />
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {TENANT_TOPICS.map(function (tp) {
          const on = !!form.topics[tp.key];
          return (
            <button key={tp.key} type="button"
              onClick={function () { setForm({ ...form, topics: { ...form.topics, [tp.key]: !on } }); }}
              className={"rounded-full border px-2 py-1 text-[11px] font-semibold " + (on ? "border-blue-500 bg-blue-100 text-blue-800" : "border-slate-200 text-slate-500")}>
              {tp.icon} {tp.label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={submitForm} className="rounded-lg bg-blue-700 text-white px-3 py-1.5 text-xs font-bold hover:bg-blue-800">{editIdx !== null ? "שמור שינויים" : "הוסף"}</button>
        <button type="button" onClick={function () { setAdding(false); setEditIdx(null); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600">ביטול</button>
      </div>
    </div>
  );

  return (
    <div>
      {loading ? <div className="text-xs text-slate-400 py-2">טוען...</div> : (
        <>
          {contacts.length === 0 && !adding && <div className="text-xs text-slate-400 py-1">אין אנשי קשר — המכתבים נשלחים לאימייל הראשי של השוכר.</div>}
          {contacts.map(function (c, i) {
            if (editIdx === i) return <div key={i}>{formUI}</div>;
            const topics: string[] = Array.isArray(c.topics) ? c.topics : [];
            return (
              <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 mb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800">{c.name || "—"}{c.role && <span className="font-normal text-slate-500"> · {c.role}</span>}</div>
                    <div className="text-[11px] text-slate-500 flex gap-3 flex-wrap mt-0.5">
                      {c.phone && <a href={"tel:" + c.phone} className="hover:underline" dir="ltr">📞 {c.phone}</a>}
                      {c.email && <a href={"mailto:" + c.email} className="hover:underline" dir="ltr">✉️ {c.email}</a>}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={function () { openEditRow(i); }} className="text-[11px] border border-slate-200 rounded px-1.5 py-0.5 text-slate-500 hover:bg-white">✏️</button>
                      <button onClick={function () { removeRow(i); }} className="text-[11px] border border-red-100 rounded px-1.5 py-0.5 text-red-400 hover:bg-red-50">🗑</button>
                    </div>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap mt-1.5">
                  {TENANT_TOPICS.map(function (tp) {
                    const on = topics.indexOf(tp.key) !== -1;
                    if (!on && !canEdit) return null;
                    return (
                      <button key={tp.key} type="button" disabled={!canEdit}
                        onClick={function () { toggleTopic(i, tp.key); }}
                        title={canEdit ? "לחץ להוספה/הסרה של הנושא" : undefined}
                        className={"rounded-full border px-2 py-0.5 text-[10px] font-semibold " + (on ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-300 hover:text-slate-500")}>
                        {tp.icon} {tp.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {adding && editIdx === null && formUI}
          {canEdit && !adding && editIdx === null && (
            <button onClick={openAdd} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">+ איש קשר</button>
          )}
        </>
      )}
    </div>
  );
}
