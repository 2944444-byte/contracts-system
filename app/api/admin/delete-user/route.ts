import { NextRequest, NextResponse } from "next/server";
import { adminClient, callerRole, SERVICE_KEY_MSG, FORBIDDEN_MSG } from "@/lib/admin-api-auth";

// Permanently delete a user: auth record + profile + access rows. Caller must
// be a logged-in ADMIN (service-key route — see lib/admin-api-auth).
export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    const admin = adminClient();
    if (!admin) return NextResponse.json({ error: SERVICE_KEY_MSG }, { status: 500 });
    const caller = await callerRole(req, admin);
    if (caller !== "admin") return NextResponse.json({ error: FORBIDDEN_MSG }, { status: 403 });
    // The protected master user can never be deleted — enforced server-side so
    // no client (or future bug) can bypass it.
    const { data: prof } = await admin.from("user_profiles").select("is_master").eq("id", userId).maybeSingle();
    if (prof?.is_master) {
      return NextResponse.json({ error: "לא ניתן למחוק את משתמש המאסטר" }, { status: 403 });
    }
    await admin.from("user_property_access").delete().eq("user_id", userId);
    await admin.from("user_company_access").delete().eq("user_id", userId);
    await admin.from("user_profiles").delete().eq("id", userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error && error.message.indexOf("not found") === -1) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
