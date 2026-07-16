import { supabase } from '../config/supabase.js';

const REQUEST_FIELDS = `
  id,
  clinic_id,
  patient_id,
  converted_patient_id,
  full_name,
  email,
  phone,
  interest,
  message,
  consent_accepted,
  consent_at,
  status,
  source,
  contacted_at,
  converted_at,
  closed_at,
  closed_reason,
  created_at,
  updated_at
`;

export async function submitPatientRequest(data) {
  const { data: request, error } = await supabase.rpc('submit_patient_request', {
    p_clinic_slug: data.clinicSlug,
    p_full_name: data.fullName,
    p_email: data.email,
    p_phone: data.phone,
    p_interest: data.interest,
    p_message: data.message || null,
    p_consent_accepted: data.consentAccepted,
    p_honeypot: data.honeypot || null,
    p_rendered_at: data.renderedAt
  });

  if (error) throw normalizeRequestError(error);
  return request;
}

export async function listPatientRequests(clinicId, filters = {}) {
  let query = supabase
    .from('patient_requests')
    .select(REQUEST_FIELDS)
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw normalizeRequestError(error);
  return data || [];
}

export async function updatePatientRequestStatus(request, status, reason = null) {
  const rpcName = {
    contacted: 'mark_patient_request_contacted',
    qualified: 'qualify_patient_request',
    closed: 'close_patient_request'
  }[status];

  if (!rpcName) throw new Error('Transicao de solicitacao invalida.');

  const args = status === 'closed'
    ? { p_request_id: request.id, p_reason: reason }
    : { p_request_id: request.id };

  const { data, error } = await supabase.rpc(rpcName, args);

  if (error) throw normalizeRequestError(error);
  return data;
}

export async function startPatientJourney(requestId) {
  const { data, error } = await supabase.functions.invoke('start-patient-journey', {
    body: { request_id: requestId }
  });

  if (error) throw await mapFunctionError(error);
  return data;
}

export async function getPatientJourneySummary(clinicId) {
  const [requests, onboarding] = await Promise.all([
    listPatientRequests(clinicId),
    listOnboardingSummary(clinicId)
  ]);

  return {
    requests: {
      total: requests.length,
      new: requests.filter((item) => item.status === 'new').length,
      contacted: requests.filter((item) => item.status === 'contacted').length,
      qualified: requests.filter((item) => item.status === 'qualified').length
    },
    onboarding
  };
}

async function listOnboardingSummary(clinicId) {
  const { data, error } = await supabase
    .from('patient_onboarding')
    .select('id, status, current_step')
    .eq('clinic_id', clinicId);

  if (error) throw normalizeRequestError(error);

  const rows = data || [];
  return {
    profile_pending: rows.filter((item) => ['welcome', 'password', 'profile'].includes(item.current_step)).length,
    anamnesis_pending: rows.filter((item) => item.current_step === 'anamnesis').length
  };
}

export function buildWhatsAppUrl(phone, message) {
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}

export function buildFirstContactMessage() {
  return [
    'Ola.',
    '',
    'Recebemos sua solicitacao de atendimento.',
    '',
    'Gostaria de conversar com voce para compreender melhor sua necessidade.'
  ].join('\n');
}

function normalizeRequestError(error) {
  return new Error(error?.message || 'Nao foi possivel processar a solicitacao.');
}

async function mapFunctionError(error) {
  if (error?.context instanceof Response) {
    try {
      const payload = await error.context.json();
      if (typeof payload?.error === 'string') return new Error(payload.error);
    } catch (_parseError) {
      return new Error('Nao foi possivel iniciar o acompanhamento.');
    }
  }

  return new Error(error?.message || 'Nao foi possivel iniciar o acompanhamento.');
}
