import { supabase } from '../config/supabase.js';

export async function countUpcomingAppointments(clinicId) {
  const today = new Date().toISOString().slice(0, 10);
  const { count, error } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .gte('appointment_date', today)
    .in('status', ['scheduled', 'confirmed']);

  if (error) throw error;
  return count || 0;
}
