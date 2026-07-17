import { getCurrentProfile, signOut } from '../auth/auth.js';
import { APP_URLS, buildAppUrl } from '../config/app-config.js';
import {
  completePatientProfile,
  getPatientPortalContext,
  getPortalClinicalDocumentPdf,
  savePatientAnamnesisStep,
  updatePatientTimezone
} from '../services/patient-portal.service.js';
import { downloadReceiptPdf, getReceiptPdfUrl } from '../services/financial.service.js';
import { getClinicLogoSignedUrl } from '../services/clinic-settings.service.js';
import { APPOINTMENT_MODALITY_LABELS, APPOINTMENT_STATUS_LABELS, COMMON_TIMEZONES } from '../config/constants.js';
import { formatCurrency, formatDateTimeInTimezone, formatTimeInTimezone } from '../ui/formatters.js';
import { showMessage, clearMessage } from '../ui/messages.js';
import { closeModal, openModal } from '../ui/modal.js';

const ANAMNESIS_STEPS = [
  ['dados_gerais', 'Dados gerais'],
  ['historia', 'Historia'],
  ['familia', 'Familia'],
  ['habitos', 'Habitos'],
  ['tratamentos', 'Tratamentos'],
  ['observacoes', 'Observacoes']
];

let profile = await getCurrentProfile();
let context = null;
let currentAnamnesisIndex = 0;
let timezoneReturnFocus = null;

if (!profile) {
  window.location.replace(APP_URLS.login);
} else if (profile.must_change_password) {
  window.location.replace(APP_URLS.initialPassword);
} else if (profile.role !== 'patient') {
  window.location.replace(APP_URLS.dashboard);
} else if (profile.clinics && !['trial', 'active'].includes(profile.clinics.status)) {
  window.location.replace(buildAppUrl('acesso-indisponivel.html', { status: profile.clinics.status }));
} else {
  await loadPortal();
  bindEvents();
}

async function loadPortal() {
  try {
    context = await getPatientPortalContext();
    fillProfileForm(context.patient);
    renderPortalHeader(context);
    renderNextAppointment(context.next_appointment);
    renderPortalSummary(context);
    renderPortalAttention(context);
    renderQuickActions(context);
    renderAppointmentHistory(context.appointments);
    renderPortalDocuments(context.documents || []);
    renderPortalFinancial(context.financial);
    showStep(resolveInitialStep(context));
    updateAnamnesisStep();
  } catch (error) {
    console.error('Erro ao carregar Portal do Paciente', {
      code: error?.code || null,
      message: error?.originalMessage || error?.message || null,
      details: error?.details || null,
      hint: error?.hint || null
    });
    renderUnavailablePortal();
  }
}

function renderPortalDocuments(rows = []) {
  const count = document.querySelector('[data-portal-documents-count]');
  if (count) count.textContent = `${rows.length} disponiveis`;

  const container = document.querySelector('[data-portal-documents]');
  if (!container) return;
  container.replaceChildren();

  if (!rows.length) {
    container.append(textBlock('Documentos', 'Nenhum documento liberado.'));
    return;
  }

  rows.slice(0, 6).forEach((documentRow) => {
    const row = document.createElement('div');
    row.className = 'portal-document-row';
    const body = document.createElement('div');
    body.className = 'portal-document-body';
    const title = document.createElement('strong');
    title.className = 'portal-document-title';
    title.textContent = resolvePortalDocumentTitle(documentRow);
    const meta = document.createElement('span');
    meta.className = 'portal-document-meta';
    meta.textContent = `Emitido em ${formatPortalDocumentDate(documentRow.issued_at || documentRow.created_at)}`;
    const status = document.createElement('span');
    status.className = 'portal-document-status';
    status.textContent = documentRow.status === 'revoked'
      ? 'Documento revogado'
      : (documentRow.pdf_available ? 'Documento disponivel' : 'PDF em preparacao');
    body.append(title, meta, status);
    row.appendChild(body);
    if (documentRow.pdf_available) {
      const actions = document.createElement('div');
      actions.className = 'portal-document-actions';
      actions.append(
        portalDocumentButton('Ver documento', documentRow, 'view'),
        portalDocumentButton('Descarregar PDF', documentRow, 'download'),
        portalDocumentButton('Imprimir', documentRow, 'print')
      );
      row.appendChild(actions);
    }
    container.appendChild(row);
  });
}

function portalDocumentButton(label, documentRow, mode) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-secondary button-sm';
  button.textContent = label;
  button.addEventListener('click', async () => {
    try {
      button.disabled = true;
      button.textContent = 'A preparar...';
      const result = await getPortalClinicalDocumentPdf(documentRow.id, mode);
      if (result?.signed_url) window.open(result.signed_url, '_blank', 'noopener');
    } catch (_error) {
      window.alert('Nao foi possivel abrir o documento neste momento.');
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
  return button;
}

function resolvePortalDocumentTitle(documentRow) {
  const labels = {
    attendance_certificate: 'Declaracao de Comparecimento',
    follow_up_certificate: 'Declaracao de Acompanhamento',
    service_certificate: 'Declaracao de Atendimento',
    clinical_report: 'Relatorio Clinico',
    clinical_progress: 'Evolucao Clinica',
    referral: 'Encaminhamento',
    treatment_plan: 'Plano Terapeutico',
    consent: 'Consentimento',
    custom: documentRow.title || 'Documento clinico'
  };
  return documentRow.title || labels[documentRow.document_type] || 'Documento clinico';
}

function formatPortalDocumentDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Lisbon'
  }).format(new Date(value));
}

function bindEvents() {
  document.querySelector('[data-start-portal]')?.addEventListener('click', () => showStep('profile'));
  document.querySelector('[data-profile-form]')?.addEventListener('submit', saveProfile);
  document.querySelector('[data-anamnesis-form]')?.addEventListener('submit', saveAnamnesis);
  document.querySelector('[data-timezone-form]')?.addEventListener('submit', saveTimezone);
  document.querySelector('[data-open-timezone-modal]')?.addEventListener('click', openTimezoneModal);
  document.querySelectorAll('[data-close-timezone-modal]').forEach((button) => button.addEventListener('click', closeTimezoneModal));
  document.querySelector('[data-prev-step]')?.addEventListener('click', () => {
    currentAnamnesisIndex = Math.max(0, currentAnamnesisIndex - 1);
    updateAnamnesisStep();
  });
  document.querySelector('[data-portal-signout]')?.addEventListener('click', async (event) => {
    event.preventDefault();
    await signOut();
    window.location.replace(APP_URLS.login);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('[data-timezone-modal]')?.hidden) {
      closeTimezoneModal();
    }
  });
  fillTimezoneOptions();
}

function resolveInitialStep(data) {
  const step = data?.onboarding?.current_step;
  if (step === 'completed') return 'done';
  if (step === 'anamnesis') return 'anamnesis';
  if (data?.patient?.profile_completed_at) return 'anamnesis';
  return 'welcome';
}

function showStep(step) {
  document.querySelectorAll('[data-step]').forEach((section) => {
    section.hidden = section.dataset.step !== step;
  });
}

function fillProfileForm(patient) {
  const form = document.querySelector('[data-profile-form]');
  if (!form || !patient) return;
  [
    'full_name',
    'email',
    'phone',
    'document',
    'birth_date',
    'sex',
    'marital_status',
    'profession',
    'address',
    'city',
    'postal_code',
    'emergency_contact_name',
    'emergency_contact_phone'
  ].forEach((field) => {
    if (form[field]) form[field].value = patient[field] || '';
  });
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('[data-profile-message]');
  const submit = form.querySelector('button[type="submit"]');
  clearMessage(message);

  const payload = {
    document: form.document.value.trim(),
    birth_date: form.birth_date.value || null,
    sex: form.sex.value.trim(),
    marital_status: form.marital_status.value.trim(),
    profession: form.profession.value.trim(),
    address: form.address.value.trim(),
    city: form.city.value.trim(),
    postal_code: form.postal_code.value.trim(),
    emergency_contact_name: form.emergency_contact_name.value.trim(),
    emergency_contact_phone: form.emergency_contact_phone.value.trim()
  };

  try {
    submit.disabled = true;
    submit.textContent = 'A guardar...';
    await completePatientProfile(payload);
    showMessage(message, 'Cadastro atualizado. Vamos para a anamnese.', 'success');
    showStep('anamnesis');
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel guardar o cadastro.', 'error');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Guardar e continuar';
  }
}

async function saveAnamnesis(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('[data-anamnesis-message]');
  const submit = form.querySelector('[data-next-step]');
  const [section] = ANAMNESIS_STEPS[currentAnamnesisIndex];
  const isFinal = currentAnamnesisIndex === ANAMNESIS_STEPS.length - 1;
  clearMessage(message);

  try {
    submit.disabled = true;
    submit.textContent = 'A guardar...';
    await savePatientAnamnesisStep(section, { answer: form.answer.value.trim() }, isFinal);
    form.answer.value = '';

    if (isFinal) {
      await loadPortal();
      showStep('done');
      return;
    }

    currentAnamnesisIndex += 1;
    updateAnamnesisStep();
    showMessage(message, 'Rascunho guardado.', 'success');
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel guardar a anamnese.', 'error');
  } finally {
    submit.disabled = false;
    submit.textContent = isFinal ? 'Concluir anamnese' : 'Continuar';
  }
}

function renderPortalHeader(data) {
  const patientName = data?.patient?.full_name || 'Paciente';
  const clinic = profile?.clinics || data?.patient?.clinics || {};
  applyPortalBrand(clinic);
  renderPortalLogo(clinic);
  document.querySelector('[data-portal-patient-name]').textContent = `Ola, ${firstName(patientName)}.`;
  const clinicName = document.querySelector('[data-clinic-name]');
  if (clinicName) clinicName.textContent = clinic.name || clinic.legal_name || 'Portal do Paciente';
  const welcome = document.querySelector('[data-portal-welcome-copy]');
  if (welcome) welcome.textContent = `Este e um espaco reservado para acompanhar o seu cuidado com tranquilidade.`;
  const contact = document.querySelector('[data-clinic-contact]');
  if (contact) {
    contact.textContent = [clinic.phone, clinic.email].filter(Boolean).join(' | ');
    contact.hidden = !contact.textContent;
  }
  const status = document.querySelector('[data-registration-status]');
  status.textContent = data?.patient?.profile_completed_at ? 'Cadastro concluido' : 'Cadastro pendente';
  status.className = `status-badge ${data?.patient?.profile_completed_at ? 'status-completed' : 'status-scheduled'}`;
}

async function renderPortalLogo(clinic = {}) {
  const wrapper = document.querySelector('[data-portal-logo]');
  const image = document.querySelector('[data-portal-logo-image]');
  const monogram = document.querySelector('[data-portal-logo-monogram]');
  if (!wrapper || !image || !monogram) return;

  monogram.textContent = (clinic.name || 'D').trim().charAt(0).toUpperCase() || 'D';
  if (!clinic.logo_url) {
    showPortalLogoPlaceholder(image, monogram);
    return;
  }

  try {
    const signedUrl = await getClinicLogoSignedUrl(clinic.logo_url);
    if (!signedUrl) throw new Error('Logotipo indisponivel.');
    monogram.hidden = true;
    image.src = signedUrl;
    image.hidden = false;
  } catch (_error) {
    showPortalLogoPlaceholder(image, monogram);
  }
}

function showPortalLogoPlaceholder(image, monogram) {
  image.removeAttribute('src');
  image.hidden = true;
  monogram.hidden = false;
}

function renderNextAppointment(appointment) {
  const patientTimezone = context?.patient?.timezone || appointment?.patient_timezone_snapshot || 'Europe/Lisbon';
  const session = document.querySelector('[data-next-session]');
  const join = document.querySelector('[data-join-session]');
  const helper = document.querySelector('[data-next-session-helper]');
  const status = document.querySelector('[data-next-session-status]');

  session.replaceChildren();

  if (!appointment) {
    session.append(infoBlock('Data e hora local', 'Nenhuma sessao agendada.'));
    helper.textContent = 'A clinica ainda nao agendou sua proxima sessao.';
    status.textContent = 'Sem agenda';
    status.className = 'status-badge';
    join.href = '#';
    join.setAttribute('aria-disabled', 'true');
    return;
  }

  const canJoin = appointment.meeting_url
    && new Date(appointment.scheduled_start).getTime() - Date.now() <= 10 * 60 * 1000
    && ['scheduled', 'confirmed', 'checked_in', 'in_progress'].includes(appointment.status);

  helper.textContent = canJoin ? 'A sala esta disponivel.' : 'A sala sera liberada 10 minutos antes.';
  status.textContent = APPOINTMENT_STATUS_LABELS[appointment.status] || appointment.status;
  status.className = `status-badge status-${appointment.status}`;
  session.append(
    infoBlock('Quando', formatDateTimeInTimezone(appointment.scheduled_start, patientTimezone)),
    infoBlock('Profissional', appointment.professional_name || '-'),
    infoBlock('Modalidade', APPOINTMENT_MODALITY_LABELS[appointment.modality] || '-'),
    infoBlock('Duracao', `${appointment.expected_duration || '-'} minutos`)
  );

  join.href = canJoin ? appointment.meeting_url : '#';
  join.setAttribute('aria-disabled', canJoin ? 'false' : 'true');
}

function renderPortalAttention(data) {
  const container = document.querySelector('[data-portal-attention]');
  if (!container) return;
  container.replaceChildren();

  const financial = data.financial || {};
  const openCharges = financial.open_charges || [];
  const documents = data.documents || [];
  const items = [];

  if (!data?.patient?.profile_completed_at) {
    items.push(['Cadastro pendente', 'Complete seus dados para manter a clinica atualizada.']);
  }
  if (data?.anamnesis?.status !== 'completed') {
    items.push(['Anamnese em aberto', 'Responda no seu tempo. Suas respostas ficam salvas.']);
  }
  if (openCharges.some((charge) => ['overdue', 'pending', 'partially_paid'].includes(charge.status))) {
    const total = openCharges.reduce((sum, charge) => sum + Number(charge.remaining_amount || 0), 0);
    const currency = openCharges[0]?.currency || 'EUR';
    items.push(['Pagamento pendente', `Existe saldo em aberto de ${formatCurrency(total, currency)}.`]);
  }
  const readyDocuments = documents.filter((documentRow) => documentRow.pdf_available);
  if (readyDocuments.length) {
    items.push(['Documento disponivel', `${readyDocuments.length} documento${readyDocuments.length === 1 ? '' : 's'} pronto${readyDocuments.length === 1 ? '' : 's'} para consulta.`]);
  }

  if (!items.length) {
    items.push(['Tudo certo por aqui', 'Nao ha nenhuma pendencia neste momento.']);
  }

  items.slice(0, 4).forEach(([title, text]) => {
    const item = document.createElement('div');
    item.className = 'portal-attention-item';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    item.append(strong, paragraph);
    container.appendChild(item);
  });
}

function renderQuickActions(data) {
  const container = document.querySelector('[data-portal-quick-actions]');
  if (!container) return;
  container.replaceChildren();

  const actions = [
    ['Proxima sessao', data.next_appointment ? formatDateTimeInTimezone(data.next_appointment.scheduled_start, data.patient?.timezone) : 'Sem sessao agendada'],
    ['Documentos', `${(data.documents || []).length} disponiveis`],
    ['Recibos', `${(data.financial?.receipts || []).length} disponiveis`],
    ['Cadastro', data.patient?.profile_completed_at ? 'Concluido' : 'Pendente']
  ];

  actions.forEach(([title, value]) => {
    const card = document.createElement('div');
    card.className = 'portal-quick-action';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const span = document.createElement('span');
    span.textContent = value;
    card.append(strong, span);
    container.appendChild(card);
  });
}

function renderPortalSummary(data) {
  const patientTimezone = data?.patient?.timezone || 'Europe/Lisbon';
  document.querySelector('[data-profile-status]').textContent = data?.patient?.profile_completed_at ? 'Concluido' : 'Pendente';
  document.querySelector('[data-anamnesis-status]').textContent = data?.anamnesis?.status === 'completed' ? 'Concluida' : 'Pendente';
  document.querySelector('[data-current-timezone]').textContent = patientTimezone;
  const timezoneForm = document.querySelector('[data-timezone-form]');
  if (timezoneForm) timezoneForm.timezone.value = patientTimezone;
}

function renderAppointmentHistory(rows = []) {
  const history = document.querySelector('[data-session-history]');
  const patientTimezone = context?.patient?.timezone || 'Europe/Lisbon';
  history.replaceChildren();

  if (!rows.length) {
    history.append(textBlock('Sessoes', 'Nenhuma sessao encontrada.'));
    return;
  }

  rows.slice(0, 5).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'portal-history-row';
    row.append(
      textLine(formatDateTimeInTimezone(item.scheduled_start, patientTimezone)),
      textLine(formatTimeInTimezone(item.scheduled_start, patientTimezone)),
      textLine(APPOINTMENT_MODALITY_LABELS[item.modality] || '-'),
      statusBadge(item.status)
    );
    history.appendChild(row);
  });
}

function renderPortalFinancial(financial = {}) {
  const container = document.querySelector('[data-portal-financial]');
  container.replaceChildren();

  const openCharges = financial.open_charges || [];
  const payments = financial.payments || [];
  const receipts = financial.receipts || [];

  if (!openCharges.length && !payments.length && !receipts.length) {
    container.append(textBlock('Financeiro', 'Nenhuma cobranca ou recibo disponivel.'));
    return;
  }

  openCharges.slice(0, 4).forEach((charge) => {
    container.appendChild(financialRow(
      charge.description,
      `Saldo ${formatCurrency(charge.remaining_amount, charge.currency)}`,
      charge.status === 'overdue' ? 'Em atraso' : 'Em aberto'
    ));
  });

  payments.slice(0, 3).forEach((payment) => {
    container.appendChild(financialRow(
      'Pagamento realizado',
      formatCurrency(payment.amount, payment.currency),
      formatDateTimeInTimezone(payment.payment_date, context?.patient?.timezone)
    ));
  });

  receipts.slice(0, 3).forEach((receipt) => {
    container.appendChild(receiptRow(receipt));
  });
}

function receiptRow(receipt) {
  const row = document.createElement('div');
  row.className = 'portal-financial-row portal-receipt-row';

  const title = document.createElement('strong');
  title.textContent = `Recibo ${receipt.receipt_number}`;

  const meta = document.createElement('span');
  const fiscal = receipt.external_fiscal_document_number
    ? ` - Documento fiscal associado: ${receipt.external_fiscal_document_number}${receipt.external_fiscal_atcud ? ` - ATCUD: ${receipt.external_fiscal_atcud}` : ''}`
    : '';
  meta.textContent = `${formatDateTimeInTimezone(receipt.issued_at, context?.patient?.timezone)} - ${formatCurrency(receipt.amount, receipt.currency)} - ${receipt.status || 'issued'}${fiscal}`;

  const actions = document.createElement('span');
  actions.className = 'portal-receipt-actions';
  actions.append(
    receiptButton('Visualizar', () => openReceiptPdf(receipt.id, 'view')),
    receiptButton('Descarregar', () => openReceiptPdf(receipt.id, 'download'))
  );

  row.append(title, meta, actions);
  return row;
}

async function openReceiptPdf(receiptId, mode) {
  const result = mode === 'download'
    ? await downloadReceiptPdf(receiptId)
    : await getReceiptPdfUrl(receiptId);

  if (result?.signed_url) {
    window.open(result.signed_url, '_blank', 'noopener');
  }
}

function receiptButton(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-secondary button-sm';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

async function saveTimezone(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await updatePatientTimezone(form.timezone.value.trim());
  closeTimezoneModal();
  await loadPortal();
  showStep('done');
}

function openTimezoneModal(event) {
  timezoneReturnFocus = event.currentTarget;
  openModal(document.querySelector('[data-timezone-modal]'));
  window.setTimeout(() => document.querySelector('[data-timezone-form] [name="timezone"]')?.focus(), 0);
}

function closeTimezoneModal() {
  closeModal(document.querySelector('[data-timezone-modal]'));
  timezoneReturnFocus?.focus();
}

function updateAnamnesisStep() {
  const [, title] = ANAMNESIS_STEPS[currentAnamnesisIndex];
  const progress = ((currentAnamnesisIndex + 1) / ANAMNESIS_STEPS.length) * 100;
  document.querySelector('[data-anamnesis-title]').textContent = title;
  document.querySelector('[data-progress-bar]').style.width = `${progress}%`;
  document.querySelector('[data-prev-step]').disabled = currentAnamnesisIndex === 0;
  document.querySelector('[data-next-step]').textContent =
    currentAnamnesisIndex === ANAMNESIS_STEPS.length - 1 ? 'Concluir anamnese' : 'Continuar';
}

function fillTimezoneOptions() {
  const datalist = document.querySelector('[data-portal-timezone-options]');
  if (!datalist) return;
  datalist.replaceChildren();
  COMMON_TIMEZONES.forEach((timezone) => {
    const option = document.createElement('option');
    option.value = timezone;
    datalist.appendChild(option);
  });
}

function textBlock(label, value) {
  const block = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = label;
  const text = document.createElement('p');
  text.className = 'muted';
  text.textContent = value || '-';
  block.append(strong, text);
  return block;
}

function infoBlock(label, value) {
  const block = document.createElement('div');
  block.className = 'portal-info-block';
  const strong = document.createElement('strong');
  strong.textContent = label;
  const text = document.createElement('span');
  text.textContent = value || '-';
  block.append(strong, text);
  return block;
}

function statusBadge(status) {
  const badge = document.createElement('span');
  badge.className = `status-badge status-${status}`;
  badge.textContent = APPOINTMENT_STATUS_LABELS[status] || status || '-';
  return badge;
}

function textLine(value) {
  const span = document.createElement('span');
  span.textContent = value || '-';
  return span;
}

function financialRow(title, value, action) {
  const row = document.createElement('div');
  row.className = 'portal-financial-row';
  const strong = document.createElement('strong');
  strong.textContent = title || '-';
  const amount = document.createElement('span');
  amount.textContent = value || '-';
  const status = document.createElement('span');
  status.textContent = action || '-';
  row.append(strong, amount, status);
  return row;
}

function renderUnavailablePortal() {
  document.body.replaceChildren();
  const panel = document.createElement('main');
  panel.className = 'public-panel';
  const title = document.createElement('h1');
  title.textContent = 'Portal indisponivel';
  const text = document.createElement('p');
  text.textContent = 'Nao foi possivel carregar o Portal do Paciente.';
  panel.append(title, text);
  document.body.appendChild(panel);
}

function applyPortalBrand(clinic = {}) {
  const root = document.documentElement;
  if (clinic.primary_color) root.style.setProperty('--portal-accent', clinic.primary_color);
  if (clinic.secondary_color) root.style.setProperty('--portal-accent-soft', clinic.secondary_color);
}

function firstName(value) {
  return String(value || 'Paciente').trim().split(/\s+/)[0] || 'Paciente';
}
