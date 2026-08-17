"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { CC_TOPICS } from "@/lib/letter-cc";

// עורך אנשי הקשר הפנימיים (מכותבי CC) — משובץ בטופס עריכת נכס וחברה.
// כל שורה: שם, תפקיד, אימייל, ולאילו נושאים היא מנויה. השמירה מיידית
// (לא תלויה בשמירת הטופס המארח).
export default function OrgContactsEditor(props: { companyId?: string; propertyId?: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [nName, setNName] = useState("");
  const [nRole, setNRole] = useState("");
  const [nEmail, setNEmail] = useState("");
  const [nTopics, setNTopics] = useState<Record<string, boolean>>({});

  const scopeCol = props.propertyId ? "property_id" : "company_id";
  const scopeVal = props.propertyId || props.companyId || "";

  useEffect(function () { load(); }, [scopeVal]);
  async function load() {
    if (!scopeVal) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from("org_contacts").select("*")
      .eq(scopeCol, scopeVal).order("created_at");
    setRows(data ?? []);
    setLoading(false);
  }

  async function addContact() {
    var email = nEmail.trim();
    if (!email || email.indexOf("@") === -1) { alert("נדרשת כתובת אימייל תקינה"); return; }
    var topics = Object.keys(nTopics).filter(function (k) { return nTopics[k]; });
    if (topics.length === 0) { alert("סמן לפחות נושא אחד (או 'כל ההתכתבויות')"); return; }
    const { error } = await supabase.from("org_contacts").insert({
      company_id: props.propertyId ? null : props.companyId,
      property_id: props.propertyId || null,
      name: nName.trim() || null, role_label: nRole.trim() || null,
      email: email, topics: topics, is_active: true,
    });
    if (error) { alert("שגיאה: " + error.message); return; }
    setNName(""); setNRole(""); setNEmail(""); setNTopics({}); setAdding(false);
    await load();
  }

  async function toggleTopic(row: any, topic: string) {
    var topics: string[] = Array.isArray(row.topics) ? row.topics.slice() : [];
    var i = topics.indexOf(topic);
    if (i === -1) topics.push(topic); else topics.splice(i, 1);
    await supabase.from("org_contacts").update({ topics: topics }).eq("id", row.id);
    await load();
  }

  async function removeContact(row: any) {
    if (!confirm("להסיר את " + (row.name || row.email) + " מרשימת המכותבים?")) return;
    await supabase.from("org_contacts").delete().eq("id", row.id);
    await load();
  }

  if (!scopeVal) {
    return <div className="text-[11px] text-slate-400">שמור קודם — ואז ניתן להוסיף אנשי קשר מכותבים.</div>;
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-indigo-900">📧 מכותבים פנימיים (עותק למייל לפי נושא)</div>
        <button type="button" onClick={function(){ setAdding(!adding); }}
          className="rounded-lg bg-indigo-600 text-white px-2.5 py-1 text-[11px] font-bold hover:bg-indigo-700">
          {adding ? "✕ סגור" : "+ איש קשר"}
        </button>
      </div>
      <div className="text-[10px] text-indigo-700">
        כשנשלח מכתב לשוכר בנושא שסומן — איש הקשר מקבל עותק (CC) באותו מייל.
        {props.companyId && !props.propertyId ? " איש קשר ברמת החברה מכותב לכל נכסי החברה." : ""}
      </div>

      {adding && (
        <div className="rounded-lg border border-indigo-200 bg-white p-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="שם" value={nName} onChange={function(e){ setNName(e.target.value); }}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
            <input placeholder="תפקיד (למשל: מחלקת כספים)" value={nRole} onChange={function(e){ setNRole(e.target.value); }}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
          </div>
          <input placeholder="email@company.com" value={nEmail} onChange={function(e){ setNEmail(e.target.value); }}
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" dir="ltr" />
          <div className="flex flex-wrap gap-1.5">
            {CC_TOPICS.map(function(t) {
              var on = !!nTopics[t.v];
              return <button key={t.v} type="button" title={t.desc}
                onClick={function(){ setNTopics(function(p){ var n = { ...p }; if (n[t.v]) delete n[t.v]; else n[t.v] = true; return n; }); }}
                className={"rounded-lg border px-2 py-1 text-[11px] font-semibold " + (on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                {on ? "✓ " : ""}{t.icon} {t.l}
              </button>;
            })}
          </div>
          <button type="button" onClick={addContact}
            className="rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-indigo-700">שמור איש קשר</button>
        </div>
      )}

      {loading ? (
        <div className="text-[11px] text-slate-400">טוען...</div>
      ) : rows.length === 0 ? (
        !adding && <div className="text-[11px] text-slate-400">אין מכותבים — הוסף את מחלקת הכספים, אחראי הביטוח או הבטיחות.</div>
      ) : (
        <div className="space-y-1">
          {rows.map(function(r) {
            return (
              <div key={r.id} className="rounded-lg bg-white border border-indigo-100 px-2.5 py-1.5 text-xs flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <span className="font-semibold text-slate-800">{r.name || r.email}</span>
                  {r.role_label && <span className="text-slate-400"> · {r.role_label}</span>}
                  <span className="text-slate-400 mr-1" dir="ltr"> {r.name ? r.email : ""}</span>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {CC_TOPICS.map(function(t) {
                    var on = Array.isArray(r.topics) && r.topics.indexOf(t.v) !== -1;
                    return <button key={t.v} type="button" title={t.desc + " — לחץ להחלפה"}
                      onClick={function(){ toggleTopic(r, t.v); }}
                      className={"rounded-full px-1.5 py-0.5 text-[10px] font-bold border " + (on ? "bg-indigo-100 text-indigo-700 border-indigo-200" : "bg-slate-50 text-slate-300 border-slate-100")}>
                      {t.icon}
                    </button>;
                  })}
                  <button type="button" onClick={function(){ removeContact(r); }}
                    className="text-red-400 hover:text-red-600 text-xs px-1" title="הסר">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
