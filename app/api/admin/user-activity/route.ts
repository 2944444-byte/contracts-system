import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, callerProfile, isUnrestrictedAdmin, SERVICE_KEY_MSG, FORBIDDEN_MSG } from "@/lib/admin-api-auth";

// פעילות משתמשים — למנהלי מערכת בלבד.
// GET                → שורת סיכום לכל משתמש (admin_user_activity).
// GET ?detail=<uid>  → דוח מפורט למשתמש: פעימות לפי יום ומסך (30 יום)
//                      + פעולות אחרונות מיומן הפעולות.
// הנתונים נשלפים בפונקציות SECURITY DEFINER שהוענקו ל-service_role בלבד
// (סכמת auth אינה חשופה ללקוח); מנהל מערכת מוגבל-היקף מקבל רק משתמשים
// שכלל היקפם בתוך שלו — אותו כלל נראות כמו רשימת מסך המשתמשים.

// אילו משתמשים מותר לקורא לראות? null = כולם (בלתי-מוגבל).
async function allowedUserIds(prof: { uid: string }, admin: SupabaseClient): Promise<Set<string> | null> {
  if (await isUnrestrictedAdmin(prof as any, admin)) return null;
  const [{ data: profiles }, { data: uca }, { data: upa }, { data: props }] = await Promise.all([
    admin.from("user_profiles").select("id, role, is_master, created_by"),
    admin.from("user_company_access").select("user_id, company_id"),
    admin.from("user_property_access").select("user_id, property_id"),
    admin.from("properties").select("id, company_id"),
  ]);
  const scope: Record<string, { c: string[]; p: string[] }> = {};
  (uca ?? []).forEach(function (r: any) { (scope[r.user_id] = scope[r.user_id] || { c: [], p: [] }).c.push(r.company_id); });
  (upa ?? []).forEach(function (r: any) { (scope[r.user_id] = scope[r.user_id] || { c: [], p: [] }).p.push(r.property_id); });
  // ההיקף האפקטיבי שלי: הנכסים שהוקצו לי + כל נכסי החברות שהוקצו לי
  const myC = new Set((scope[prof.uid]?.c) || []);
  const myP = new Set((scope[prof.uid]?.p) || []);
  (props ?? []).forEach(function (pr: any) { if (myC.has(pr.company_id)) myP.add(pr.id); });
  const allowed = new Set<string>();
  (profiles ?? []).forEach(function (u: any) {
    if (u.id === prof.uid) { allowed.add(u.id); return; }           // עצמי
    if (u.is_master) return;                                        // מאסטר — לעולם לא
    const sc = scope[u.id] || { c: [], p: [] };
    if (sc.c.length === 0 && sc.p.length === 0) {
      // ללא שיוך: admin כזה הוא בלתי-מוגבל → מוסתר; אחרים — רק אם אני יצרתי
      if (u.role === "admin") return;
      if (u.created_by === prof.uid) allowed.add(u.id);
      return;
    }
    const ok = sc.c.every(function (c: string) { return myC.has(c); }) &&
               sc.p.every(function (p: string) { return myP.has(p); });
    if (ok) allowed.add(u.id);
  });
  return allowed;
}

export async function GET(req: NextRequest) {
  try {
    const admin = adminClient();
    if (!admin) return NextResponse.json({ error: SERVICE_KEY_MSG }, { status: 500 });
    const prof = await callerProfile(req, admin);
    if (!prof || prof.role !== "admin") {
      return NextResponse.json({ error: FORBIDDEN_MSG }, { status: 403 });
    }
    const allowed = await allowedUserIds(prof, admin);

    const detail = req.nextUrl.searchParams.get("detail");
    if (detail) {
      if (allowed !== null && !allowed.has(detail)) {
        return NextResponse.json({ error: FORBIDDEN_MSG }, { status: 403 });
      }
      const [{ data: days, error: dErr }, { data: actions }] = await Promise.all([
        admin.rpc("admin_user_activity_detail", { target: detail }),
        admin.from("audit_log").select("action, entity_type, created_at")
          .eq("user_id", detail).order("created_at", { ascending: false }).limit(20),
      ]);
      if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
      return NextResponse.json({ days: days ?? [], actions: actions ?? [] });
    }

    const { data, error } = await admin.rpc("admin_user_activity");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    let rows: any[] = data ?? [];
    if (allowed !== null) {
      rows = rows.filter(function (r: any) { return allowed.has(r.user_id); });
    }
    return NextResponse.json({ rows: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
