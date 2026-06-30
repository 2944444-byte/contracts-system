import { supabase } from '@/lib/supabase';

// Attach the logged-in user's Supabase access token so server routes can verify
// the caller is authenticated. Use for every fetch() to a protected /api route.
export async function authHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) h["Authorization"] = "Bearer " + data.session.access_token;
  } catch (e) { /* no session */ }
  return h;
}
