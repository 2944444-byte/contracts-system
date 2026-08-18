"use client";
import { useState, useEffect } from "react";
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui';
import { logAudit } from '@/lib/audit-log';
import { PERMISSIONS, VIEWER_PRESETS, getCurrentAccess, type CurrentAccess } from '@/lib/permissions';

const ic = "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400";

const ROLES = [
  { v: "admin",   l: "מנהל מערכת", icon: "👑", color: "bg-red-100 text-red-700",
    desc: "גישה מלאה לכל החברות, הנכסים והמסכים. רק מנהל מערכת מקים מנהלים ומנהלי מערכת." },
  { v: "manager", l: "מנהל",        icon: "👤", color: "bg-blue-100 text-blue-700",
    desc: "גישה לחברות/נכסים שהוקצו לו בלבד, עם הרשאות פעולה מוגדרות. יכול להקים משתמשי צפייה בנכסים שלו." },
  { v: "viewer",  l: "צופה",        icon: "👁", color: "bg-slate-100 text-slate-600",
    desc: "גישה ממוקדת — רואה/מעדכן רק את התחומים והנכסים שהוגדרו (למשל: אחראי בטיחות, איש כספים)." },
];
const roleInfo = function(v: string) { return ROLES.find(function(r){ return r.v === v; }) || ROLES[2]; };

function genPassword(): string {
  // Guarantee one of each class (upper/lower/digit/symbol) so the password meets
  // Supabase's strongest "letters, digits and symbols" requirement + length ≥ 8.
  var U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghjkmnpqrstuvwxyz", D = "23456789", S = "!@#$%^&*-_=+";
  var all = U + L + D + S;
  function pick(s: string) { return s[Math.floor(Math.random() * s.length)]; }
  var arr = [pick(U), pick(L), pick(D), pick(S)];
  for (var i = arr.length; i < 12; i++) arr.push(pick(all));
  for (var j = arr.length - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)); var t = arr[j]; arr[j] = arr[k]; arr[k] = t; }
  return arr.join("");
}

export default function UsersPage() {
  const [me,     setMe]     = useState<CurrentAccess | null>(null);
  const [users,  setUsers]  = useState<any[]>([]);
  const [loading,setLoading]= useState(true);
  const [saving, setSaving] = useState(false);
  const [msg,    setMsg]    = useState("");

  // Reference data
  const [companies,  setCompanies]  = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  // Per-user scope (for table summaries): userId → {companyIds, propertyIds}
  const [scopes, setScopes] = useState<Record<string, { companyIds: string[]; propertyIds: string[] }>>({});

  // ── Create-user modal state ──
  const [showCreate, setShowCreate] = useState(false);
  const [fName,  setFName]  = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fPassword, setFPassword] = useState("");
  const [fRole,  setFRole]  = useState("viewer");
  const [fComps, setFComps] = useState<Record<string, boolean>>({});
  const [fProps, setFProps] = useState<Record<string, boolean>>({});
  const [fPerms, setFPerms] = useState<Record<string, boolean>>({});

  // ── Edit-access modal (scope + permissions of an existing user) ──
  const [accessUser, setAccessUser] = useState<any | null>(null);

  // ── Credentials panel (after create / password reset) ──
  const [creds, setCreds] = useState<{ name: string; email: string; password: string } | null>(null);

  useEffect(function() { init(); }, []);

  async function init() {
    var access = await getCurrentAccess();
    setMe(access);
    await loadAll();
  }

  async function loadAll() {
    const [{ data: u }, { data: c }, { data: p }, { data: uca }, { data: upa }] = await Promise.all([
      supabase.from("user_profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("companies").select("id,company_name").order("company_name"),
      supabase.from("properties").select("id,name,company_id").order("name"),
      supabase.from("user_company_access").select("user_id,company_id"),
      supabase.from("user_property_access").select("user_id,property_id"),
    ]);
    setUsers(u ?? []); setCompanies(c ?? []); setProperties(p ?? []);
    var sc: Record<string, { companyIds: string[]; propertyIds: string[] }> = {};
    (uca ?? []).forEach(function(r: any){ if (!sc[r.user_id]) sc[r.user_id] = { companyIds: [], propertyIds: [] }; sc[r.user_id].companyIds.push(r.company_id); });
    (upa ?? []).forEach(function(r: any){ if (!sc[r.user_id]) sc[r.user_id] = { companyIds: [], propertyIds: [] }; sc[r.user_id].propertyIds.push(r.property_id); });
    setScopes(sc);
    setLoading(false);
  }


  // The admin API routes verify the CALLER (they run with the service key) —
  // attach the logged-in session token to every call.
  async function authHeaders(): Promise<Record<string, string>> {
    var h: Record<string, string> = { "Content-Type": "application/json" };
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) h["Authorization"] = "Bearer " + data.session.access_token;
    } catch (e) { /* no session (local/dev) */ }
    return h;
  }

  function showMsg(m: string) { setMsg(m); setTimeout(function(){ setMsg(""); }, 4000); }

  // ── Who may do what on THIS screen ──
  const myRole = me?.role || "viewer";
  // Unrestricted = the master, or an admin with no scope rows. A SCOPED admin
  // (admin assigned to part of the companies/properties) keeps admin powers but
  // only over his slice — he can't grant or see beyond it.
  const iAmUnrestricted = myRole === "admin" && (!!me?.profile?.is_master || ((me?.companyIds || []).length === 0 && (me?.propertyIds || []).length === 0));
  // Only an UNRESTRICTED admin may create admins (a scoped admin creating an
  // unrestricted admin would be privilege escalation).
  const canCreateAdmins   = iAmUnrestricted;
  const canCreateManagers = myRole === "admin";
  // A manager needs the explicit manage_viewers capability — a manager without
  // it has no business on this screen at all (matches ROUTE_RULES + the DB
  // trigger, which rejects his writes anyway).
  const canCreateViewers  = myRole === "admin" || (myRole === "manager" && !!me?.permissions?.["manage_viewers"]);
  const canUseScreen      = canCreateViewers;

  // Granting is capped at the granter's OWN scope (manager AND scoped admin).
  function grantableCompanies(): any[] {
    if (iAmUnrestricted) return companies;
    return companies.filter(function(c){ return (me?.companyIds || []).indexOf(c.id) !== -1; });
  }
  function grantableProperties(): any[] {
    if (iAmUnrestricted) return properties;
    var myComps = me?.companyIds || [];
    var myProps = me?.propertyIds || [];
    return properties.filter(function(p){ return myProps.indexOf(p.id) !== -1 || myComps.indexOf(p.company_id) !== -1; });
  }
  // Permission ceiling: an admin (incl. scoped) may grant any capability; a
  // manager may grant ONLY capabilities he himself holds.
  function grantablePerms(): typeof PERMISSIONS {
    if (myRole === "admin") return PERMISSIONS;
    return PERMISSIONS.filter(function(p){ return !!me?.permissions?.[p.key]; });
  }
  // Whose access may I edit? Never the master; never MYSELF unless I'm an
  // unrestricted admin (a manager must not raise his own permissions); admin
  // rows only by the master.
  function canEditAccess(u: any): boolean {
    if (u.is_master) return false;
    if (me?.profile?.id && u.id === me.profile.id) return iAmUnrestricted;
    if (u.role === "admin") return !!me?.profile?.is_master;
    // A manager manages VIEWERS only — other managers are peers, not subjects
    // (enforced by the DB trigger too; this just hides the button).
    if (myRole === "manager") return u.role === "viewer";
    return true;
  }
  // Defense in depth: clamp whatever the UI submits to what I may grant.
  function clampGrant(comps: Record<string, boolean>, props: Record<string, boolean>, perms: Record<string, boolean>) {
    if (iAmUnrestricted) return { comps: comps, props: props, perms: perms };
    var gc: Record<string, boolean> = {}; grantableCompanies().forEach(function(c){ gc[c.id] = true; });
    var gp: Record<string, boolean> = {}; grantableProperties().forEach(function(p){ gp[p.id] = true; });
    var allowedPermKeys: Record<string, boolean> = {}; grantablePerms().forEach(function(p){ allowedPermKeys[p.key] = true; });
    var cc: Record<string, boolean> = {}; Object.keys(comps).forEach(function(k){ if (comps[k] && gc[k]) cc[k] = true; });
    var pp: Record<string, boolean> = {}; Object.keys(props).forEach(function(k){ if (props[k] && gp[k]) pp[k] = true; });
    var pm: Record<string, boolean> = {}; Object.keys(perms).forEach(function(k){ if (perms[k] && allowedPermKeys[k]) pm[k] = true; });
    return { comps: cc, props: pp, perms: pm };
  }

  // ── Which users THIS user may see ──
  // Admin: everyone. Manager: himself + users at his level or BELOW (managers/
  // viewers, never admins) whose entire scope is within his own allowed
  // companies/properties; unassigned users are visible only if he created them.
  function myEffectivePropIds(): Record<string, boolean> {
    var ok: Record<string, boolean> = {};
    (me?.propertyIds || []).forEach(function(id){ ok[id] = true; });
    var myComps = me?.companyIds || [];
    properties.forEach(function(p){ if (myComps.indexOf(p.company_id) !== -1) ok[p.id] = true; });
    return ok;
  }
  const visibleUsers = (function() {
    if (iAmUnrestricted) return users;
    var propOk = myEffectivePropIds();
    var compOk: Record<string, boolean> = {};
    (me?.companyIds || []).forEach(function(c){ compOk[c] = true; });
    return users.filter(function(u){
      if (me?.profile?.id && u.id === me.profile.id) return true;          // self
      // Level rule: a manager sees VIEWERS only — never admins and never
      // fellow managers; a scoped admin may see equal-level users, but only
      // if their scope is inside his.
      if (myRole === "manager" && u.role !== "viewer") return false;
      if (u.role === "admin" && myRole !== "admin") return false;
      if (u.is_master) return false;                                        // unrestricted by definition
      var sc = scopes[u.id] || { companyIds: [], propertyIds: [] };
      if (sc.companyIds.length === 0 && sc.propertyIds.length === 0) {
        // No scope rows: an admin like this is UNRESTRICTED → never visible to
        // a scoped user; others are visible only to their creator.
        if (u.role === "admin") return false;
        return u.created_by === me?.profile?.id;
      }
      var compsOk = sc.companyIds.every(function(cid){ return !!compOk[cid]; });
      var propsOk = sc.propertyIds.every(function(pid){ return !!propOk[pid]; });
      return compsOk && propsOk;
    });
  })();

  // ── Scope persistence (shared by create + edit) ──
  async function saveScopeAndPerms(userId: string, role: string, comps: Record<string, boolean>, props: Record<string, boolean>, perms: Record<string, boolean>) {
    // permissions live on the profile
    await supabase.from("user_profiles").update({ permissions: perms }).eq("id", userId);
    // company scope — full sync
    const { data: curC } = await supabase.from("user_company_access").select("id,company_id").eq("user_id", userId);
    var curCByCompany: Record<string, string> = {};
    (curC ?? []).forEach(function(r: any){ curCByCompany[r.company_id] = r.id; });
    var wantC = Object.keys(comps).filter(function(k){ return comps[k]; });
    var addC = wantC.filter(function(cid){ return !curCByCompany[cid]; });
    var delC = Object.keys(curCByCompany).filter(function(cid){ return wantC.indexOf(cid) === -1; }).map(function(cid){ return curCByCompany[cid]; });
    if (addC.length) await supabase.from("user_company_access").insert(addC.map(function(cid){ return { user_id: userId, company_id: cid }; }));
    if (delC.length) await supabase.from("user_company_access").delete().in("id", delC);
    // property scope — full sync (the role column feeds the letters-CC mechanism)
    const { data: curP } = await supabase.from("user_property_access").select("id,property_id").eq("user_id", userId);
    var curPByProp: Record<string, string> = {};
    (curP ?? []).forEach(function(r: any){ curPByProp[r.property_id] = r.id; });
    var wantP = Object.keys(props).filter(function(k){ return props[k]; });
    var addP = wantP.filter(function(pid){ return !curPByProp[pid]; });
    var delP = Object.keys(curPByProp).filter(function(pid){ return wantP.indexOf(pid) === -1; }).map(function(pid){ return curPByProp[pid]; });
    if (addP.length) await supabase.from("user_property_access").insert(addP.map(function(pid){ return { user_id: userId, property_id: pid, role: role }; }));
    if (delP.length) await supabase.from("user_property_access").delete().in("id", delP);
  }

  // ── Create ──
  function openCreate() {
    setFName(""); setFEmail(""); setFPassword(genPassword());
    setFRole("viewer"); setFComps({}); setFProps({}); setFPerms({});
    setShowCreate(true);
  }
  async function handleCreate() {
    if (!fEmail.trim() || !fPassword || !fName.trim()) { alert("חובה: שם + אימייל + סיסמה"); return; }
    if (fRole === "admin" && !canCreateAdmins) { alert("רק מנהל מערכת יכול להקים מנהל מערכת"); return; }
    if (fRole === "manager" && !canCreateManagers) { alert("רק מנהל מערכת יכול להקים מנהלים"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/create-user", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ email: fEmail.trim(), password: fPassword, fullName: fName.trim(), role: fRole }) });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || "יצירה נכשלה");
      var newId = d.userId;
      if (newId) {
        await supabase.from("user_profiles").update({ created_by: me?.profile?.id ?? null }).eq("id", newId);
        // Clamp to MY grantable scope/permissions (defense in depth), then save.
        // An admin WITH a scope selection becomes a scoped admin; without — an
        // unrestricted admin (perms are irrelevant for admins — role bypasses).
        var g = clampGrant(fComps, fProps, fRole === "admin" ? {} : fPerms);
        await saveScopeAndPerms(newId, fRole, g.comps, g.props, g.perms);
        await logAudit({ entity_type: "user", entity_id: newId, action: "create", notes: fRole + " — " + fEmail.trim() });
      }
      setShowCreate(false);
      setCreds({ name: fName.trim(), email: fEmail.trim(), password: fPassword });
      await loadAll();
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setSaving(false); }
  }

  // ── Reset password → fresh credentials panel ──
  async function resetPassword(u: any) {
    if (myRole !== "admin") { alert("רק מנהל מערכת יכול לאפס סיסמה"); return; }
    var pw = genPassword();
    if (!confirm("לאפס את הסיסמה של " + (u.full_name || u.email) + "?\nתיווצר סיסמה חדשה ויוצג חלון לשליחתה.")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/reset-password", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ userId: u.id, password: pw }) });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || "איפוס נכשל");
      await logAudit({ entity_type: "user", entity_id: u.id, action: "reset_password" });
      setCreds({ name: u.full_name || "", email: u.email, password: pw });
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setSaving(false); }
  }

  // ── Send credentials (local mail client — works in test mode; can move to
  //    the Resend path once configured) ──
  function sendCreds(c: { name: string; email: string; password: string }) {
    // Always link to the PUBLIC production URL — the admin may be browsing a
    // protected git-branch URL that would force a Vercel login on the recipient.
    var origin = process.env.NEXT_PUBLIC_SITE_URL || "https://contracts-system.vercel.app";
    var body = "שלום " + c.name + ",\n\n"
      + "להלן פרטי הגישה שלך למערכת PropManager:\n\n"
      + "קישור למערכת: " + origin + "/login\n"
      + "אימייל: " + c.email + "\n"
      + "סיסמה: " + c.password + "\n\n"
      + "מומלץ להחליף את הסיסמה לאחר הכניסה הראשונה.\n\nבברכה,\nהנהלת המערכת";
    window.location.href = "mailto:" + encodeURIComponent(c.email) + "?subject=" + encodeURIComponent("פרטי גישה למערכת PropManager") + "&body=" + encodeURIComponent(body);
  }

  // The master can do everything — except locking the system out of itself:
  // you can't deactivate/delete YOURSELF, nor remove the last remaining admin.
  function isSelf(u: any): boolean { return !!me?.profile?.id && u.id === me.profile.id; }
  function isLastAdmin(u: any): boolean {
    return u.role === "admin" && users.filter(function(x){ return x.role === "admin" && x.is_active; }).length <= 1;
  }
  async function toggleActive(u: any) {
    if (u.is_master) { alert("משתמש המאסטר מוגן — לא ניתן להשבית אותו"); return; }
    if (u.is_active && isSelf(u)) { alert("לא ניתן להשבית את המשתמש שאיתו אתה מחובר"); return; }
    if (u.is_active && isLastAdmin(u)) { alert("לא ניתן להשבית את מנהל המערכת האחרון"); return; }
    await supabase.from("user_profiles").update({ is_active: !u.is_active }).eq("id", u.id);
    await logAudit({ entity_type: "user", entity_id: u.id, action: u.is_active ? "deactivate" : "activate" });
    await loadAll();
  }
  async function deleteUser(u: any) {
    if (u.is_master) { alert("משתמש המאסטר מוגן — לא ניתן למחוק אותו"); return; }
    if (myRole !== "admin") { alert("רק מנהל מערכת יכול למחוק משתמשים"); return; }
    if (isSelf(u)) { alert("לא ניתן למחוק את המשתמש שאיתו אתה מחובר"); return; }
    if (isLastAdmin(u)) { alert("לא ניתן למחוק את מנהל המערכת האחרון"); return; }
    if (!confirm("למחוק לצמיתות את " + (u.full_name || u.email) + "? פעולה זו אינה הפיכה.")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/delete-user", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ userId: u.id }) });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || "מחיקה נכשלה");
      await logAudit({ entity_type: "user", entity_id: u.id, action: "delete", notes: u.email });
      await loadAll();
      showMsg("✅ המשתמש נמחק");
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setSaving(false); }
  }

  // ── Edit access modal ──
  function openAccess(u: any) {
    var sc = scopes[u.id] || { companyIds: [], propertyIds: [] };
    var comps: Record<string, boolean> = {}; sc.companyIds.forEach(function(id){ comps[id] = true; });
    var props: Record<string, boolean> = {}; sc.propertyIds.forEach(function(id){ props[id] = true; });
    setFComps(comps); setFProps(props);
    setFPerms((u.permissions && typeof u.permissions === "object") ? { ...u.permissions } : {});
    setAccessUser(u);
  }
  async function saveAccess() {
    if (!accessUser) return;
    if (!canEditAccess(accessUser)) { alert("אין לך הרשאה לערוך משתמש זה"); return; }
    setSaving(true);
    try {
      // Clamp to MY grantable scope/permissions — a manager can never hand out
      // more than he holds, even if the UI is tampered with.
      var g = clampGrant(fComps, fProps, accessUser.role === "admin" ? {} : fPerms);
      await saveScopeAndPerms(accessUser.id, accessUser.role || "viewer", g.comps, g.props, g.perms);
      await logAudit({ entity_type: "user", entity_id: accessUser.id, action: "update_access" });
      setAccessUser(null); await loadAll(); showMsg("✅ ההרשאות נשמרו");
    } catch (e: any) { alert("שגיאה: " + (e?.message || e)); }
    finally { setSaving(false); }
  }

  // ── Shared scope + permissions editor (used in create + edit modals) ──
  function renderScopeAndPerms(role: string) {
    var gComps = grantableCompanies();
    var gProps = grantableProperties();
    var gPerms = grantablePerms();
    return (
      <>
        {role === "admin" && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-700">
            👑 מנהל מערכת עם <b>בחירת חברות/נכסים</b> = מנהל מערכת <b>מוגבל להיקף שנבחר</b> (כל המסכים והפעולות, רק על הנתח שלו). ללא בחירה — גישה לכל המערכת.
          </div>
        )}
        <div>
          <div className="text-xs font-bold text-slate-700 mb-1.5">🏛 גישה לחברות <span className="font-normal text-slate-400">(חברה = כל הנכסים שלה, כולל עתידיים)</span></div>
          <div className="flex flex-wrap gap-1.5">
            {gComps.length === 0 && <span className="text-xs text-slate-400">אין חברות בהרשאתך</span>}
            {gComps.map(function(c){
              var on = !!fComps[c.id];
              return <button key={c.id} type="button" onClick={function(){ setFComps(function(prev){ var n = { ...prev }; if (n[c.id]) delete n[c.id]; else n[c.id] = true; return n; }); }}
                className={"rounded-lg border px-2.5 py-1 text-xs font-semibold " + (on ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                {on ? "✓ " : ""}{c.company_name}
              </button>;
            })}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold text-slate-700 mb-1.5">🏢 גישה לנכסים בודדים</div>
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {gProps.map(function(p){
              var viaCompany = !!fComps[p.company_id];
              var on = !!fProps[p.id] || viaCompany;
              return <button key={p.id} type="button" disabled={viaCompany}
                onClick={function(){ setFProps(function(prev){ var n = { ...prev }; if (n[p.id]) delete n[p.id]; else n[p.id] = true; return n; }); }}
                className={"rounded-lg border px-2.5 py-1 text-xs font-semibold " + (viaCompany ? "border-blue-200 bg-blue-50/50 text-blue-400 cursor-default" : on ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}
                title={viaCompany ? "כלול דרך הרשאת החברה" : ""}>
                {on ? "✓ " : ""}{p.name}
              </button>;
            })}
          </div>
        </div>
        {role !== "admin" && (
        <div>
          <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
            <div className="text-xs font-bold text-slate-700">🔑 הרשאות פעולה{myRole !== "admin" && <span className="font-normal text-slate-400"> (ניתן להעניק רק הרשאות שיש לך)</span>}</div>
            {role === "viewer" && (
              <div className="flex gap-1 flex-wrap">
                {VIEWER_PRESETS.map(function(pr){
                  return <button key={pr.label} type="button" onClick={function(){ var allowed: Record<string, boolean> = {}; gPerms.forEach(function(g){ if (pr.perms[g.key]) allowed[g.key] = true; }); setFPerms(allowed); }}
                    className="rounded-lg border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50" title="קיצור — ניתן לעריכה אחר-כך">
                    {pr.icon} {pr.label}
                  </button>;
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {gPerms.map(function(perm){
              if (perm.key === "manage_viewers" && role === "viewer") return null;
              var on = !!fPerms[perm.key];
              return <label key={perm.key} className={"flex items-start gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer " + (on ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:bg-slate-50")} title={perm.desc}>
                <input type="checkbox" checked={on} onChange={function(){ setFPerms(function(prev){ var n = { ...prev }; if (n[perm.key]) delete n[perm.key]; else n[perm.key] = true; return n; }); }} className="mt-0.5 w-3.5 h-3.5" />
                <span className="text-xs text-slate-700">{perm.icon} {perm.label}</span>
              </label>;
            })}
            {gPerms.length === 0 && <span className="text-xs text-slate-400">אין לך הרשאות פעולה להענקה</span>}
          </div>
        </div>
        )}
      </>
    );
  }

  // ── Render ──
  if (!loading && me && !canUseScreen) {
    return (
      <div dir="rtl">
        <PageHero title="משתמשים" icon="👥" tone="slate" />
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">🔒</div>
          <div className="font-semibold text-slate-600">אין לך הרשאה לנהל משתמשים</div>
          <div className="text-sm mt-1">להוספת משתמש או שינוי הרשאות — פנה לבעלי המערכת</div>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl">
      <PageHero title="משתמשים" icon="👥" tone="slate" subtitle={visibleUsers.length + " משתמשים"}
        actions={<button onClick={openCreate} className="rounded-xl bg-white text-slate-700 px-4 py-2 text-sm font-bold hover:bg-slate-100 shadow-sm">+ משתמש</button>} />

      {msg && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">{msg}</div>}

      {/* KPI per role */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        {ROLES.map(function(r){
          var cnt = visibleUsers.filter(function(u){ return u.role === r.v; }).length;
          return <div key={r.v} className="rounded-xl border border-slate-200 bg-white p-3 text-center" title={r.desc}>
            <div className="text-2xl">{r.icon}</div>
            <div className="text-2xl font-black text-slate-700">{cnt}</div>
            <div className="text-xs font-semibold text-slate-500">{r.l}</div>
          </div>;
        })}
      </div>

      {/* Users table */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-label="loading"></span>טוען...</div>
      ) : visibleUsers.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-400">
          <div className="text-5xl mb-3">👥</div><div>אין משתמשים — צור את הראשון</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-right text-sm min-w-[640px]">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">משתמש</th>
                <th className="px-4 py-3 font-semibold text-slate-700">תפקיד</th>
                <th className="px-4 py-3 font-semibold text-slate-700">היקף גישה</th>
                <th className="px-4 py-3 font-semibold text-slate-700">הרשאות</th>
                <th className="px-4 py-3 font-semibold text-slate-700">סטטוס</th>
                <th className="px-4 py-3 font-semibold text-slate-700">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map(function(u){
                var ri = roleInfo(u.role);
                var sc = scopes[u.id] || { companyIds: [], propertyIds: [] };
                var perms = (u.permissions && typeof u.permissions === "object") ? u.permissions : {};
                var permKeys = Object.keys(perms).filter(function(k){ return perms[k]; });
                var isAdmin = u.role === "admin";
                return (
                  <tr key={u.id} className={"border-t border-slate-100 " + (u.is_active ? "hover:bg-slate-50" : "opacity-50 bg-slate-50")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700">{(u.full_name || u.email || "?")[0].toUpperCase()}</div>
                        <div>
                          <div className="font-semibold text-slate-800">{u.full_name || "—"}</div>
                          <div className="text-xs text-slate-400" dir="ltr">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={"text-xs px-2 py-1 rounded-full font-semibold " + ri.color} title={ri.desc}>{ri.icon} {ri.l}</span>
                      {u.is_master && <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 font-bold mr-1" title="משתמש מוגן — לא ניתן למחוק או להשבית">🛡 מאסטר</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {isAdmin ? <span className="text-red-600 font-semibold">הכל</span> : (
                        <>
                          {sc.companyIds.length > 0 && <div>🏛 {sc.companyIds.length} חברות</div>}
                          {sc.propertyIds.length > 0 && <div>🏢 {sc.propertyIds.length} נכסים</div>}
                          {sc.companyIds.length === 0 && sc.propertyIds.length === 0 && <span className="text-amber-600">⚠ ללא שיוך</span>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin ? <span className="text-xs text-red-600 font-semibold">כל ההרשאות</span> : permKeys.length === 0 ? <span className="text-xs text-slate-400">צפייה בלבד</span> : (
                        <div className="flex flex-wrap gap-1 max-w-[230px]">
                          {permKeys.slice(0, 4).map(function(k){
                            var p = PERMISSIONS.find(function(x){ return x.key === k; });
                            return p ? <span key={k} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 rounded-full px-1.5 py-0.5" title={p.desc}>{p.icon} {p.label}</span> : null;
                          })}
                          {permKeys.length > 4 && <span className="text-[10px] text-slate-400">+{permKeys.length - 4}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={function(){ toggleActive(u); }}
                        className={"text-xs px-2 py-1 rounded-full font-semibold " + (u.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400")}
                        title={u.is_active ? "לחץ להשבתה" : "לחץ להפעלה"}>
                        {u.is_active ? "פעיל" : "מושבת"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {canEditAccess(u) && <button onClick={function(){ openAccess(u); }} className="text-xs border border-blue-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50" title="עריכת היקף גישה והרשאות">🔐 הרשאות</button>}
                        {myRole === "admin" && <button onClick={function(){ resetPassword(u); }} className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 hover:bg-slate-50" title="איפוס סיסמה + שליחת פרטי התחברות">🔑</button>}
                        {myRole === "admin" && !u.is_master && <button onClick={function(){ deleteUser(u); }} className="text-xs border border-red-100 rounded px-2 py-1 text-red-400 hover:bg-red-50" title="מחיקה לצמיתות">🗑</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create-user modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setShowCreate(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={function(e){ e.stopPropagation(); }} dir="rtl">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-lg font-bold text-slate-800">משתמש חדש</h2>
              <button onClick={function(){ setShowCreate(false); }} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">שם מלא *</label>
                  <input type="text" value={fName} onChange={function(e){ setFName(e.target.value); }} className={ic} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">אימייל *</label>
                  <input type="email" value={fEmail} onChange={function(e){ setFEmail(e.target.value); }} className={ic} dir="ltr" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">סיסמה *</label>
                <div className="flex gap-2">
                  <input type="text" value={fPassword} onChange={function(e){ setFPassword(e.target.value); }} className={ic} dir="ltr" />
                  <button type="button" onClick={function(){ setFPassword(genPassword()); }} className="rounded-lg border border-slate-200 px-3 text-sm hover:bg-slate-50" title="ייצר סיסמה אקראית">🎲</button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">בסיום היצירה יוצג חלון לשליחת פרטי ההתחברות למשתמש.</p>
              </div>

              <div>
                <div className="text-xs font-bold text-slate-700 mb-1.5">תפקיד</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ROLES.map(function(r){
                    var allowed = r.v === "viewer" ? canCreateViewers : r.v === "manager" ? canCreateManagers : canCreateAdmins;
                    var on = fRole === r.v;
                    return <button key={r.v} type="button" disabled={!allowed}
                      onClick={function(){
                        setFRole(r.v);
                        if (r.v === "manager") { var all: Record<string, boolean> = {}; PERMISSIONS.forEach(function(p){ all[p.key] = true; }); setFPerms(all); }
                        else if (r.v === "viewer") setFPerms({});
                      }}
                      className={"rounded-xl border p-3 text-center transition-all " + (on ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : allowed ? "border-slate-200 hover:bg-slate-50" : "border-slate-100 opacity-40 cursor-not-allowed")}
                      title={allowed ? r.desc : "רק מנהל מערכת יכול להקים תפקיד זה"}>
                      <div className="text-2xl mb-1">{r.icon}</div>
                      <div className="text-sm font-bold text-slate-700">{r.l}</div>
                    </button>;
                  })}
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">{roleInfo(fRole).desc}</p>
              </div>

              {renderScopeAndPerms(fRole)}

              <div className="flex gap-3 pt-2">
                <button onClick={handleCreate} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">{saving ? "יוצר..." : "צור משתמש"}</button>
                <button onClick={function(){ setShowCreate(false); }} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit-access modal ── */}
      {accessUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={function(e){ if (e.target !== e.currentTarget) return; setAccessUser(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={function(e){ e.stopPropagation(); }} dir="rtl">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-lg font-bold text-slate-800">🔐 הרשאות — {accessUser.full_name || accessUser.email}</h2>
              <button onClick={function(){ setAccessUser(null); }} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {renderScopeAndPerms(accessUser.role || "viewer")}
              <div className="flex gap-3 pt-2">
                <button onClick={saveAccess} disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">{saving ? "שומר..." : "שמור הרשאות"}</button>
                <button onClick={function(){ setAccessUser(null); }} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Credentials panel (after create / reset) ── */}
      {creds && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" dir="rtl">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">✅ פרטי התחברות</h2>
              <button onClick={function(){ setCreds(null); }} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-slate-600">המשתמש <b>{creds.name}</b> מוכן. שלח או שמור את הפרטים — <span className="text-amber-600 font-semibold">הסיסמה לא תוצג שוב</span>.</p>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm space-y-1" dir="ltr">
                <div><span className="text-slate-400">Email: </span><b>{creds.email}</b></div>
                <div><span className="text-slate-400">Password: </span><b className="font-mono">{creds.password}</b></div>
              </div>
              <div className="flex gap-2">
                <button onClick={function(){ sendCreds(creds); }} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white hover:bg-blue-800">📧 שלח למשתמש</button>
                <button onClick={function(){
                  var origin = typeof window !== "undefined" ? window.location.origin : "";
                  navigator.clipboard.writeText("קישור: " + origin + "/login\nאימייל: " + creds.email + "\nסיסמה: " + creds.password).then(function(){ showMsg("✅ הועתק ללוח"); });
                }} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">📋 העתק</button>
              </div>
              <button onClick={function(){ setCreds(null); }} className="w-full rounded-xl border border-slate-200 py-2 text-sm text-slate-500">סגור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
