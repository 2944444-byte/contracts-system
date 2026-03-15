import { supabase } from "./supabase";

interface AuditParams {
  entity_type: string;
  entity_id:   string;
  action:      string;
  notes?:      string;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
}

export async function logAudit(params: AuditParams): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      entity_type:  params.entity_type,
      entity_id:    params.entity_id,
      action:       params.action,
      notes:        params.notes ?? null,
      old_values:   params.old_values ?? null,
      new_values:   params.new_values ?? null,
      performed_by: user?.id ?? null,
      performed_at: new Date().toISOString(),
    });
  } catch {
    // שגיאת audit לא עוצרת את הפעולה
  }
}
