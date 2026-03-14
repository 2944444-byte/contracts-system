import { supabase } from "./supabase";

export async function logAudit(params: {
  entity_type: string;   // contract | property | tenant | charge | option | ti | guarantee
  entity_id:   string;
  action:      string;   // create | update | delete | approve | issue | pay | exercise | cancel
  field_name?: string;
  old_value?:  string;
  new_value?:  string;
  notes?:      string;
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      entity_type: params.entity_type,
      entity_id:   params.entity_id,
      action:      params.action,
      field_name:  params.field_name ?? null,
      old_value:   params.old_value ?? null,
      new_value:   params.new_value ?? null,
      notes:       params.notes ?? null,
      performed_by: user?.id ?? null,
      performed_at: new Date().toISOString(),
    });
  } catch(e) {
    // לא נכשל שקט — audit log לא חוסם פעולות
    console.error("audit log error:", e);
  }
}
