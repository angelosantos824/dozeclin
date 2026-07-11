import { supabase } from '../config/supabase.js';

export async function createAuditLog({ clinicId, action, entity, entityId, previousData = null, newData = null }) {
  const { error } = await supabase.from('audit_logs').insert([{
    clinic_id: clinicId,
    action,
    entity,
    entity_id: entityId,
    previous_data: previousData,
    new_data: newData
  }]);

  if (error) throw error;
}
