import { NextRequest, NextResponse } from "next/server";
import { adminClient, callerRole, SERVICE_KEY_MSG, FORBIDDEN_MSG } from "@/lib/admin-api-auth";

// Set a new password for an existing auth user (service key). Caller must be a
// logged-in ADMIN — this route runs with the service key, so without the check
// anyone could take over any account by resetting its password.
export async function POST(req: NextRequest) {
  try {
    const { userId, password } = await req.json();
    if (!userId || !password) {
      return NextResponse.json({ error: "Missing userId or password" }, { status: 400 });
    }
    const admin = adminClient();
    if (!admin) return NextResponse.json({ error: SERVICE_KEY_MSG }, { status: 500 });
    const caller = await callerRole(req, admin);
    if (caller !== "admin") return NextResponse.json({ error: FORBIDDEN_MSG }, { status: 403 });
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
