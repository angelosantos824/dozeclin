import { supabase } from '../config/supabase.js';

export async function getPatientPortalContext() {
  const { data, error } = await supabase.rpc('get_patient_portal_context');
  if (error) throw mapPortalError(error);
  return data;
}

export async function completePatientProfile(profile) {
  const { data, error } = await supabase.rpc('complete_patient_profile', {
    p_profile: profile
  });

  if (error) throw mapPortalError(error);
  return data;
}

export async function savePatientAnamnesisStep(section, answers, isFinal = false) {
  const { data, error } = await supabase.rpc('save_patient_anamnesis_step', {
    p_section: section,
    p_answers: answers
  });

  if (error) throw mapPortalError(error);

  if (isFinal) return completePatientAnamnesis();
  return data;
}

export async function completePatientAnamnesis() {
  const { data, error } = await supabase.rpc('complete_patient_anamnesis');
  if (error) throw mapPortalError(error);
  return data;
}

export async function updatePatientTimezone(timezone) {
  const { data, error } = await supabase.rpc('update_patient_timezone', {
    p_timezone: timezone
  });

  if (error) throw mapPortalError(error);
  return data;
}

export async function getPortalClinicalDocumentPdf(documentId, mode = 'view') {
  const { data, error } = await supabase.functions.invoke('generate-clinical-document-pdf', {
    body: { document_id: documentId, mode }
  });

  if (error) throw mapPortalError(error);
  return data;
}

function mapPortalError(error) {
  const mapped = new Error('Nao foi possivel atualizar o Portal do Paciente.');
  mapped.code = error?.code || null;
  mapped.details = error?.details || null;
  mapped.hint = error?.hint || null;
  mapped.originalMessage = error?.message || null;
  return mapped;
}
