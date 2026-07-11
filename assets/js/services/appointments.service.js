import { supabase } from '../config/supabase.js';
import { todayDateInput } from '../ui/formatters.js';

const APPOINTMENT_FIELDS = `
  id,
  clinic_id,
  patient_id,
  professional_id,
  appointment_date,
  start_time,
  end_time,
  status,
  appointment_type,
  notes,
  created_by,
  created_at,
  updated_at,
  patients:patient_id(id, full_name, email, phone),
  professional:professional_id(id, full_name, email, specialty)
`;

export async function listAppointments(clinicId, filters = {}) {
  let query = supabase
    .from('appointments')
    .select(APPOINTMENT_FIELDS)
    .eq('clinic_id', clinicId)
    .order('appointment_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (filters.date) query = query.eq('appointment_date', filters.date);
  if (filters.from) query = query.gte('appointment_date', filters.from);
  if (filters.to) query = query.lte('appointment_date', filters.to);
  if (filters.professionalId) query = query.eq('professional_id', filters.professionalId);
  if (filters.patientId) query = query.eq('patient_id', filters.patientId);
  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createAppointment(clinicId, createdBy, payload) {
  const { data, error } = await supabase
    .from('appointments')
    .insert([{ ...payload, clinic_id: clinicId, created_by: createdBy }])
    .select(APPOINTMENT_FIELDS)
    .single();

  if (error) throw normalizeAppointmentError(error);
  return data;
}

export async function updateAppointment(id, payload) {
  const { data, error } = await supabase
    .from('appointments')
    .update(payload)
    .eq('id', id)
    .select(APPOINTMENT_FIELDS)
    .single();

  if (error) throw normalizeAppointmentError(error);
  return data;
}

export async function updateAppointmentStatus(id, status) {
  return updateAppointment(id, { status });
}

export async function countUpcomingAppointments(clinicId) {
  const today = todayDateInput();
  const { count, error } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .gte('appointment_date', today)
    .in('status', ['scheduled', 'confirmed']);

  if (error) throw error;
  return count || 0;
}

export async function getDashboardAppointmentSummary(clinicId) {
  const today = todayDateInput();
  const appointments = await listAppointments(clinicId, { from: today });
  const todayAppointments = appointments.filter((item) => item.appointment_date === today);

  return {
    today: todayAppointments.length,
    upcoming: appointments.filter((item) => ['scheduled', 'confirmed'].includes(item.status)).length,
    confirmedToday: todayAppointments.filter((item) => item.status === 'confirmed').length,
    next: appointments
      .filter((item) => ['scheduled', 'confirmed', 'in_progress'].includes(item.status))
      .slice(0, 5)
  };
}

function normalizeAppointmentError(error) {
  if (String(error.message || '').includes('profissional ja possui')) {
    return new Error('O profissional ja possui uma consulta neste periodo.');
  }

  return error;
}
