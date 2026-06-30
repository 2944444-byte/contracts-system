import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-api-auth";
import { sendEmail } from "../../../lib/email-utils";

export async function POST(req: NextRequest) {
  try {
    if (!(await requireUser(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { to, subject, html } = await req.json();
    if (!to || !subject || !html) {
      return NextResponse.json({ error: "Missing to/subject/html" }, { status: 400 });
    }
    const result = await sendEmail({ to, subject, html });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch(e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
