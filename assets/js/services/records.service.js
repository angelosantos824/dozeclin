import { supabase } from '../config/supabase.js';
import { getCurrentProfile } from '../auth/auth.js';
import { getPatientById } from './patients.service.js';

const RECORD_FIELDS = `
  id,
  clinic_id,
  patient_id,
  professional_id,
  appointment_id,
  record_type,
  title,
  content,
  diagnosis,
  conduct,
  prescription,
  record_date,
  status,
  created_by,
  cancel_reason,
  signed_at,
  cancelled_at,
  created_at,
  updated_at,
  professional:professional_id(id, full_name, specialty, professional_registration),
  author:created_by(id, full_name, email)
`;

export async function listMedicalRecords(patientId) {
  const profile = await requireClinicalProfile();
  await assertPatientFromClinic(profile.clinic_id, patientId);

  const { data, error } = await supabase
    .from('medical_records')
    .select(RECORD_FIELDS)
    .eq('clinic_id', profile.clinic_id)
    .eq('patient_id', patientId)
    .order('record_date', { ascending: false });

  if (error) throw toPortugueseError(error);
  return data || [];
}

export async function getMedicalRecord(recordId) {
  const profile = await requireClinicalProfile();
  const { data, error } = await supabase
    .from('medical_records')
    .select(RECORD_FIELDS)
    .eq('clinic_id', profile.clinic_id)
    .eq('id', recordId)
    .single();

  if (error) throw toPortugueseError(error);
  return data;
}

export async function createMedicalRecord(data) {
  const profile = await requireClinicalProfile();
  await assertPatientFromClinic(profile.clinic_id, data.patient_id);

  const payload = {
    clinic_id: profile.clinic_id,
    patient_id: data.patient_id,
    professional_id: data.professional_id,
    appointment_id: data.appointment_id,
    record_type: data.record_type || 'evolution',
    title: data.title || null,
    content: data.content,
    diagnosis: data.diagnosis || null,
    conduct: data.conduct || null,
    prescription: data.prescription || null,
    record_date: data.record_date,
    status: 'draft'
  };

  const { data: record, error } = await supabase
    .from('medical_records')
    .insert([payload])
    .select(RECORD_FIELDS)
    .single();

  if (error) throw toPortugueseError(error);
  return record;
}

export async function updateMedicalRecord(recordId, data) {
  const current = await getMedicalRecord(recordId);

  if (current.status !== 'draft') {
    throw new Error('Apenas rascunhos podem ser editados.');
  }

  const payload = {
    professional_id: data.professional_id,
    appointment_id: data.appointment_id,
    record_type: data.record_type,
    title: data.title || null,
    content: data.content,
    diagnosis: data.diagnosis || null,
    conduct: data.conduct || null,
    prescription: data.prescription || null,
    record_date: data.record_date
  };

  const { data: record, error } = await supabase
    .from('medical_records')
    .update(payload)
    .eq('id', recordId)
    .select(RECORD_FIELDS)
    .single();

  if (error) throw toPortugueseError(error);
  return record;
}

export async function signMedicalRecord(recordId) {
  const { data, error } = await supabase
    .from('medical_records')
    .update({ status: 'signed' })
    .eq('id', recordId)
    .select(RECORD_FIELDS)
    .single();

  if (error) throw toPortugueseError(error);
  return data;
}

export async function cancelMedicalRecord(recordId, reason) {
  if (!reason?.trim()) {
    throw new Error('Informe o motivo do cancelamento.');
  }

  const { data, error } = await supabase
    .from('medical_records')
    .update({ status: 'cancelled', cancel_reason: reason.trim() })
    .eq('id', recordId)
    .select(RECORD_FIELDS)
    .single();

  if (error) throw toPortugueseError(error);
  return data;
}

async function requireClinicalProfile() {
  const profile = await getCurrentProfile();

  if (!profile?.clinic_id || profile.status !== 'active') {
    throw new Error('Sessao invalida para acessar prontuario.');
  }

  return profile;
}

async function assertPatientFromClinic(clinicId, patientId) {
  if (!patientId) throw new Error('Paciente nao identificado.');
  await getPatientById(clinicId, patientId);
}

function toPortugueseError(error) {
  const message = String(error?.message || '');

  if (message.includes('assinado')) {
    return new Error('Registro assinado nao pode ser editado diretamente.');
  }

  if (message.includes('Conteudo clinico')) {
    return new Error('Conteudo clinico obrigatorio.');
  }

  if (message.includes('Paciente invalido')) {
    return new Error('Paciente invalido para esta clinica.');
  }

  if (message.includes('medical_records_appointment_required') || message.includes('appointment_id')) {
    return new Error('Selecione o Appointment que originou este prontuario.');
  }

  return new Error(message || 'Nao foi possivel processar o prontuario.');
}
