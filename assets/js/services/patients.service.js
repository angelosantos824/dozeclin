import { supabase } from '../config/supabase.js';

const PATIENT_FIELDS = 'id, clinic_id, full_name, email, phone, birth_date, document, address, timezone, status, access_code, created_at, updated_at';

export async function listPatients(clinicId) {
  const { data, error } = await supabase
    .from('patients')
    .select(PATIENT_FIELDS)
    .eq('clinic_id', clinicId)
    .order('full_name', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getPatientById(clinicId, patientId) {
  const { data, error } = await supabase
    .from('patients')
    .select(PATIENT_FIELDS)
    .eq('clinic_id', clinicId)
    .eq('id', patientId)
    .single();

  if (error) throw error;
  return data;
}

export async function createPatient(clinicId, payload) {
  const { data, error } = await supabase
    .from('patients')
    .insert([{ ...payload, clinic_id: clinicId, status: payload.status || 'active' }])
    .select(PATIENT_FIELDS)
    .single();

  if (error) throw error;
  return data;
}

export async function updatePatient(id, payload) {
  const { data, error } = await supabase
    .from('patients')
    .update(payload)
    .eq('id', id)
    .select(PATIENT_FIELDS)
    .single();

  if (error) throw error;
  return data;
}

export async function archivePatient(id) {
  return updatePatient(id, { status: 'archived' });
}

export async function countPatientsByStatus(clinicId) {
  const patients = await listPatients(clinicId);
  return patients.reduce((summary, patient) => {
    summary.total += 1;
    summary[patient.status] = (summary[patient.status] || 0) + 1;
    return summary;
  }, { total: 0, active: 0, inactive: 0, discharged: 0, archived: 0 });
}
