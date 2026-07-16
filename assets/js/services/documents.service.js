import { supabase } from '../config/supabase.js';
import { getCurrentProfile } from '../auth/auth.js';

const DOCUMENT_FIELDS = `
  id,
  clinic_id,
  patient_id,
  source_medical_record_id,
  appointment_id,
  professional_id,
  document_type,
  document_number,
  document_year,
  document_sequence,
  document_prefix,
  title,
  visibility,
  status,
  signature_status,
  issued_at,
  signed_at,
  current_version,
  document_hash,
  current_pdf_path,
  current_pdf_hash,
  current_pdf_generated_at,
  current_pdf_template_version,
  template_code,
  template_name,
  template_version,
  public_validation_enabled,
  patient_access_enabled,
  revoked_at,
  revocation_reason,
  created_at,
  professional_snapshot,
  patient:patient_id(id, full_name, email),
  signed_profile:signed_by(id, full_name, specialty, display_title)
`;

export async function listClinicalDocuments(filters = {}) {
  const profile = await requireProfile();
  let query = supabase
    .from('clinical_documents')
    .select(DOCUMENT_FIELDS)
    .eq('clinic_id', profile.clinic_id)
    .order('created_at', { ascending: false });

  if (filters.patientId) query = query.eq('patient_id', filters.patientId);
  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw mapDocumentError(error);
  return data || [];
}

export async function signClinicalDocument(documentId, signatureId) {
  const { data, error } = await supabase.rpc('sign_clinical_document', {
    p_document_id: documentId,
    p_signature_id: signatureId
  });
  if (error) throw error;
  return data;
}

export async function issueClinicalDocument(documentId) {
  const { data, error } = await supabase.rpc('issue_clinical_document', {
    p_document_id: documentId
  });
  if (error) throw mapDocumentError(error);
  return data;
}

export async function archiveClinicalDocument(documentId) {
  const { data, error } = await supabase.rpc('archive_clinical_document', {
    p_document_id: documentId
  });
  if (error) throw mapDocumentError(error);
  return data;
}

export async function createDocumentFromAppointment({ appointmentId, documentType, templateCode, visibility, releaseToPatient = false }) {
  const { data, error } = await supabase.rpc('create_document_from_appointment', {
    p_appointment_id: appointmentId,
    p_document_type: documentType,
    p_template_code: templateCode,
    p_visibility: visibility,
    p_release_to_patient: Boolean(releaseToPatient)
  });
  if (error) throw mapDocumentError(error);
  return data;
}

export async function revokeClinicalDocument(documentId, reason) {
  const { data, error } = await supabase.rpc('revoke_clinical_document', {
    p_document_id: documentId,
    p_reason: reason
  });
  if (error) throw mapDocumentError(error);
  return data;
}

export async function setDocumentPatientAccess(documentId, enabled) {
  const { data, error } = await supabase.rpc('set_document_patient_access', {
    p_document_id: documentId,
    p_enabled: enabled
  });
  if (error) throw mapDocumentError(error);
  return data;
}

export async function verifyPublicDocument(token) {
  const { data, error } = await supabase.rpc('verify_public_document', {
    p_token: token
  });
  if (error) throw new Error('Nao foi possivel verificar o documento.');
  return data;
}

export async function generateDocumentQrCode(documentId) {
  const { data, error } = await supabase.functions.invoke('generate-document-qrcode', {
    body: { document_id: documentId }
  });
  if (error) throw mapDocumentError(error);
  return data;
}

export async function getClinicalDocumentPdf(documentId, mode = 'view') {
  const { data, error } = await supabase.functions.invoke('generate-clinical-document-pdf', {
    body: { document_id: documentId, mode }
  });
  if (error) throw mapDocumentError(error);
  return data;
}

export async function generateDocumentShareLink(documentId, options = {}) {
  const { data, error } = await supabase.functions.invoke('generate-document-share-link', {
    body: {
      document_id: documentId,
      expiration: options.expiration || '24_hours',
      allow_download: Boolean(options.allowDownload),
      max_views: options.maxViews || null
    }
  });
  if (error) throw mapDocumentError(error);
  return data;
}

export async function accessSharedDocument(token, mode = 'view') {
  const { data, error } = await supabase.functions.invoke('access-shared-document', {
    body: { token, mode }
  });
  if (error) throw new Error('Link invalido ou expirado.');
  return data;
}

async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id || profile.status !== 'active') {
    throw new Error('Sessao invalida para documentos.');
  }
  return profile;
}

function mapDocumentError(error) {
  return new Error(error?.message || 'Nao foi possivel processar o documento.');
}
