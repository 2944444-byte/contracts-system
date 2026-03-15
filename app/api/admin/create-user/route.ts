import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const { email, password, role, name } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: "Missing email or password" }, { status: 400 });
  }

  // Admin client עם service_role
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // צור משתמש ב-Auth
  const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, role },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // צור profile
  await supabaseAdmin.from("user_profiles").insert({
    id:         user.user.id,
    email:      email,
    full_name:  name || null,
    role:       role || "viewer",
    is_active:  true,
  });

  return NextResponse.json({ id: user.user.id });
}
