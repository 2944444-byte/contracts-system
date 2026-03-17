import { supabase } from "./supabase";

interface AuditParams {
  entity_type: string;
  entity_id:   string;
  action:      string;
  notes?:      string;
}

export async function logAudit({ entity_type, entity_id, action, notes }: AuditParams): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      entity_type,
      entity_id,
      action,
      notes:        notes ?? null,
      performed_by: user?.id ?? null,
      performed_at: new Date().toISOString(),
    });
  } catch {
    // audit log failure should not break the app
    console.warn("audit log failed");
  }
}
