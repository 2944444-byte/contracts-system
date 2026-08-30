import { NextRequest, NextResponse } from "next/server";
import { adminClient, callerProfile, SERVICE_KEY_MSG, FORBIDDEN_MSG } from "@/lib/admin-api-auth";

// פעילות משתמשים — למנהלי מערכת בלבד: התחברות אחרונה, פעילות אחרונה
// (רענון ה-session האחרון), חיבורים פתוחים ופעולות מיומן הפעולות.
// הנתונים נשלפים בפונקציית admin_user_activity() — SECURITY DEFINER
// שההרצה שלה הוענקה ל-service_role בלבד (סכמת auth אינה חשופה ללקוח).
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
    return NextResponse.json({ rows: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
