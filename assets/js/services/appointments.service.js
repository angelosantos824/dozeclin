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
  scheduled_start,
  scheduled_end,
  clinic_timezone,
  patient_timezone_snapshot,
  meeting_url,
  meeting_provider,
  modality,
  expected_duration,
  actual_duration,
  room,
  public_notes,
  internal_notes,
  confirmed_at,
  checked_in_at,
  started_at,
  completed_at,
  cancelled_at,
  archived_at,
  rescheduled_to_appointment_id,
  rescheduled_from_appointment_id,
  rescheduled_at,
  rescheduled_by,
  reschedule_reason,
  created_by,
  updated_by,
  medical_record_id,
  created_at,
  updated_at,
  patients:patient_id(id, full_name, email, phone),
  professional:professional_id(id, full_name, email, specialty, display_title)
`;

export async function listAppointments(clinicId, filters = {}) {
  let query = supabase
    .from('appointments')
    .select(APPOINTMENT_FIELDS)
    .eq('clinic_id', clinicId)
    .order('scheduled_start', { ascending: filters.ascending ?? true });

  if (filters.date) query = query.eq('appointment_date', filters.date);
  if (filters.from) query = query.gte('appointment_date', filters.from);
  if (filters.to) query = query.lte('appointment_date', filters.to);
  if (filters.professionalId) query = query.eq('professional_id', filters.professionalId);
  if (filters.patientId) query = query.eq('patient_id', filters.patientId);
  if (filters.statuses?.length) query = query.in('status', filters.statuses);
  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getAppointmentById(id) {
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_FIELDS)
    .eq('id', id)
    .single();

  if (error) throw normalizeAppointmentError(error);
  return data;
}

export async function createAppointment(_clinicId, _createdBy, payload) {
  const { data, error } = await supabase.rpc('create_appointment', toAppointmentRpcPayload(payload));
  if (error) throw normalizeAppointmentError(error);
  return getAppointmentById(data.id);
}

export async function updateAppointment(id, payload) {
  const { data, error } = await supabase.rpc('update_appointment_details', {
    p_appointment_id: id,
    ...toAppointmentRpcPayload(payload)
  });
  if (error) throw normalizeAppointmentError(error);
  return getAppointmentById(data.id);
}

export async function updateAppointmentStatus(id, status) {
  const rpcByStatus = {
    confirmed: 'confirm_appointment',
    checked_in: 'check_in_appointment',
    in_progress: 'start_appointment',
    completed: 'complete_appointment',
    no_show: 'mark_appointment_no_show',
    cancelled_by_patient: 'cancel_appointment_by_patient',
    cancelled_by_clinic: 'cancel_appointment_by_clinic',
    archived: 'archive_appointment'
  };
  const rpc = rpcByStatus[status];
  if (!rpc) throw new Error('Estado de Appointment invalido.');

  const { data, error } = await supabase.rpc(rpc, { p_appointment_id: id });
  if (error) throw normalizeAppointmentError(error);
  return getAppointmentById(data.id);
}

export async function rescheduleAppointment(id, payload) {
  const { data, error } = await supabase.rpc('reschedule_appointment', {
    p_appointment_id: id,
    p_new_local_date: payload.appointment_date,
    p_new_local_time: payload.start_time,
    p_expected_duration: Number(payload.expected_duration || 50),
    p_professional_id: payload.professional_id,
    p_modality: payload.modality,
    p_meeting_url: payload.meeting_url || null,
    p_room: payload.room || null,
    p_public_notes: payload.public_notes || null,
    p_internal_notes: payload.internal_notes || null,
    p_reason: payload.reason
  });

  if (error) throw normalizeAppointmentError(error);
  return data;
}

export async function countUpcomingAppointments(clinicId) {
  const today = todayDateInput();
  const { count, error } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .gte('appointment_date', today)
    .in('status', ['scheduled', 'confirmed', 'checked_in', 'in_progress']);

  if (error) throw error;
  return count || 0;
}

export async function getDashboardAppointmentSummary(clinicId) {
  const today = todayDateInput();
  const appointments = await listAppointments(clinicId, { from: today });
  const todayAppointments = appointments.filter((item) => item.appointment_date === today);
  const completed = todayAppointments.filter((item) => item.status === 'completed');
  const cancelled = todayAppointments.filter((item) => ['cancelled_by_patient', 'cancelled_by_clinic', 'cancelled'].includes(item.status));
  const attended = todayAppointments.filter((item) => ['checked_in', 'in_progress', 'completed'].includes(item.status)).length;
  const expected = todayAppointments.filter((item) => !['rescheduled', 'archived'].includes(item.status)).length;
  const durations = completed.map((item) => Number(item.actual_duration || item.expected_duration || 0)).filter(Boolean);

  return {
    today: todayAppointments.length,
    upcoming: appointments.filter((item) => ['scheduled', 'confirmed', 'checked_in', 'in_progress'].includes(item.status)).length,
    confirmedToday: todayAppointments.filter((item) => item.status === 'confirmed').length,
    inProgressToday: todayAppointments.filter((item) => item.status === 'in_progress').length,
    completedToday: completed.length,
    cancelledToday: cancelled.length,
    noShowToday: todayAppointments.filter((item) => item.status === 'no_show').length,
    onlineToday: todayAppointments.filter((item) => item.modality === 'online').length,
    presentialToday: todayAppointments.filter((item) => item.modality === 'presential').length,
    averageDuration: durations.length
      ? Math.round(durations.reduce((total, item) => total + item, 0) / durations.length)
      : 0,
    attendanceRate: expected ? Math.round((attended / expected) * 100) : 0,
    next: appointments
      .filter((item) => ['scheduled', 'confirmed', 'checked_in', 'in_progress'].includes(item.status))
      .slice(0, 5)
  };
}

function toAppointmentRpcPayload(payload) {
  return {
    p_patient_id: payload.patient_id,
    p_professional_id: payload.professional_id,
    p_local_date: payload.appointment_date,
    p_local_time: payload.start_time,
    p_expected_duration: Number(payload.expected_duration || 50),
    p_clinic_timezone: payload.clinic_timezone,
    p_patient_timezone: payload.patient_timezone_snapshot,
    p_modality: payload.modality,
    p_meeting_url: payload.meeting_url || null,
    p_room: payload.room || null,
    p_public_notes: payload.public_notes || null,
    p_internal_notes: payload.internal_notes || null
  };
}

function normalizeAppointmentError(error) {
  if (String(error.message || '').includes('profissional ja possui')) {
    return new Error('O profissional ja possui uma consulta neste periodo.');
  }

  if (String(error.message || '').includes('Timezone')) {
    return new Error(error.message);
  }

  return error;
}
