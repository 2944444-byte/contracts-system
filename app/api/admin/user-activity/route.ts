import { NextRequest, NextResponse } from "next/server";
import { adminClient, callerProfile, isUnrestrictedAdmin, SERVICE_KEY_MSG, FORBIDDEN_MSG } from "@/lib/admin-api-auth";

// פעילות משתמשים — למנהלי מערכת בלבד: התחברות אחרונה, פעילות אחרונה
// (רענון ה-session האחרון), חיבורים פתוחים ופעולות מיומן הפעולות.
// הנתונים נשלפים בפונקציית admin_user_activity() — SECURITY DEFINER
// שההרצה שלה הוענקה ל-service_role בלבד (סכמת auth אינה חשופה ללקוח).
//
// היקף: מנהל מערכת בלתי-מוגבל מקבל את כולם; מנהל מערכת מוגבל-היקף מקבל
// רק משתמשים שכלל היקפם בתוך שלו — אותו כלל נראוּת כמו רשימת המשתמשים
// במסך (visibleUsers) — כדי שהתגובה הגולמית לא תדלוף מעבר למה שמוצג.
export async function GET(req: NextRequest) {
  try {
    const admin = adminClient();
    if (!admin) return NextResponse.json({ error: SERVICE_KEY_MSG }, { status: 500 });
    const prof = await callerProfile(req, admin);
    if (!prof || prof.role !== "admin") {
      return NextResponse.json({ error: FORBIDDEN_MSG }, { status: 403 });
    }
    const { data, error } = await admin.rpc("admin_user_activity");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    let rows: any[] = data ?? [];

    if (!(await isUnrestrictedAdmin(prof, admin))) {
      // מנהל מערכת מוגבל — סינון שרת לפי כלל הנראוּת של מסך המשתמשים
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
      rows = rows.filter(function (r: any) { return allowed.has(r.user_id); });
    }

    return NextResponse.json({ rows: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
