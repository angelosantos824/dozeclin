import { verifyPublicDocument } from '../services/documents.service.js';

const token = new URLSearchParams(window.location.search).get('token');
const state = document.querySelector('[data-validation-state]');
const details = document.querySelector('[data-validation-details]');
const TYPE_LABELS = {
  attendance_certificate: 'Declaracao de comparecimento',
  follow_up_certificate: 'Declaracao de acompanhamento',
  service_certificate: 'Declaracao de atendimento',
  clinical_report: 'Relatorio clinico',
  clinical_progress: 'Evolucao clinica',
  referral: 'Encaminhamento',
  treatment_plan: 'Plano terapeutico',
  consent: 'Consentimento',
  custom: 'Documento personalizado'
};

if (!token) {
  renderInvalid('Token ausente ou invalido.');
} else {
  verify();
}

async function verify() {
  try {
    const result = await verifyPublicDocument(token);
    if (result?.state === 'valid') {
      renderResult('Documento valido', 'state-valid', result);
    } else if (result?.state === 'revoked') {
      renderResult('Documento revogado', 'state-revoked', result);
    } else if (result?.state === 'cancelled') {
      renderResult('Documento cancelado', 'state-invalid', result);
    } else {
      renderInvalid('Documento invalido ou indisponivel.');
    }
  } catch (_error) {
    renderInvalid('Documento invalido ou indisponivel.');
  }
}

function renderResult(label, className, result) {
  state.textContent = label;
  state.className = `validation-state ${className}`;
  details.hidden = false;
  details.replaceChildren(
    row('Tipo', TYPE_LABELS[result.document_type] || result.document_type),
    row('Numero', result.document_number),
    row('Clinica', result.clinic_name),
    row('Profissional', result.professional_name),
    row('Atividade', result.professional_title),
    row('Paciente', result.patient_initials),
    row('Emitido em', formatDate(result.issued_at)),
    row('Versao', result.version),
    row('Hash parcial', result.hash_partial),
    row('Estado', result.status),
    ...(result.revoked_at ? [row('Revogado em', formatDate(result.revoked_at))] : [])
  );
}

function renderInvalid(message) {
  state.textContent = message;
  state.className = 'validation-state state-invalid';
  details.hidden = true;
  details.replaceChildren();
}

function row(label, value) {
  const fragment = document.createDocumentFragment();
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value || '-';
  fragment.append(term, description);
  return fragment;
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
