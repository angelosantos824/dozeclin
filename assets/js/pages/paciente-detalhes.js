import { PERMISSIONS, hasPermission } from '../auth/permissions.js';
import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { closeModal, openModal } from '../ui/modal.js';
import { clearChildren } from '../ui/table.js';
import { clearMessage, showMessage } from '../ui/messages.js';
import { dateTimeLocalInput, formatCurrency, formatDateTime, formatDateTimeInTimezone } from '../ui/formatters.js';
import {
  APPOINTMENT_MODALITY_LABELS,
  APPOINTMENT_STATUS_LABELS,
  FINANCIAL_CHARGE_STATUS_LABELS,
  MEDICAL_RECORD_STATUS_LABELS,
  MEDICAL_RECORD_TYPE_LABELS,
  PATIENT_STATUS_LABELS
} from '../config/constants.js';
import { getPatientById } from '../services/patients.service.js';
import { listAppointments } from '../services/appointments.service.js';
import { listProfessionals } from '../services/profiles.service.js';
import { createAuditLog } from '../services/audit.service.js';
import {
  cancelMedicalRecord,
  createMedicalRecord,
  listMedicalRecords,
  signMedicalRecord,
  updateMedicalRecord
} from '../services/records.service.js';
import { createDocumentFromAppointment } from '../services/documents.service.js';
import { getPatientFinancialSummary } from '../services/financial.service.js';

const patientId = new URLSearchParams(window.location.search).get('id');
let profile = await protectPage(PERMISSIONS.MEDICAL_RECORDS_READ);
let patient = null;
let records = [];
let professionals = [];
let appointments = [];
let financialSummary = null;
let editingRecord = null;
let saving = false;

if (profile) {
  mountLayout(profile);
  await loadPage();
  bindEvents();
}

async function loadPage() {
  if (!patientId) {
    showMessage(document.querySelector('[data-page-message]'), 'Paciente nao identificado.', 'error');
    return;
  }

  try {
    [patient, professionals, records, appointments] = await Promise.all([
      getPatientById(profile.clinic_id, patientId),
      listProfessionals(profile.clinic_id),
      listMedicalRecords(patientId),
      listAppointments(profile.clinic_id, { patientId })
    ]);

    if (hasPermission(profile, PERMISSIONS.FINANCE_READ)) {
      financialSummary = await getPatientFinancialSummary(patientId);
    }

    renderPatient();
    renderAppointmentCard();
    renderPatientFinancial();
    fillProfessionalSelect();
    fillAppointmentSelect();
    renderRecords();
    applyPermissions();
  } catch (error) {
    showMessage(document.querySelector('[data-page-message]'), 'Nao foi possivel carregar o prontuario.', 'error');
  }
}

function bindEvents() {
  document.querySelector('[data-new-record]')?.addEventListener('click', () => openRecordForm());
  document.querySelector('[data-close-record-modal]')?.addEventListener('click', () => closeModal(document.querySelector('[data-record-modal]')));
  document.querySelector('[data-close-view-modal]')?.addEventListener('click', () => closeModal(document.querySelector('[data-view-modal]')));
  document.querySelector('[data-generate-document]')?.addEventListener('click', openDocumentForm);
  document.querySelector('[data-close-document-modal]')?.addEventListener('click', () => closeModal(document.querySelector('[data-document-modal]')));
  document.querySelector('[data-record-form]')?.addEventListener('submit', saveRecord);
  document.querySelector('[data-document-form]')?.addEventListener('submit', saveDocumentDraft);
  document.querySelector('[data-document-form] [name="document_type"]')?.addEventListener('change', updateDocumentTemplateCode);
  document.querySelector('[data-document-form] [name="appointment_id"]')?.addEventListener('change', (event) => {
    setDocumentContextFromAppointment(event.currentTarget.value);
  });
}

function applyPermissions() {
  const button = document.querySelector('[data-new-record]');
  if (button) button.hidden = !hasPermission(profile, PERMISSIONS.MEDICAL_RECORDS_CREATE);
}

function renderPatient() {
  document.querySelector('[data-patient-name]').textContent = patient.full_name;
  document.querySelector('[data-patient-meta]').textContent = patient.email || 'Sem email informado';
  document.querySelector('[data-patient-contact]').textContent = patient.phone || 'Sem telefone informado';
  document.querySelector('[data-patient-status]').textContent = PATIENT_STATUS_LABELS[patient.status] || patient.status;
  const next = getNextAppointment();
  const last = appointments
    .filter((appointment) => appointment.status === 'completed')
    .sort((a, b) => new Date(b.scheduled_start) - new Date(a.scheduled_start))[0];
  document.querySelector('[data-patient-next]').textContent = `Proxima sessao: ${next ? formatDateTimeInTimezone(next.scheduled_start, next.clinic_timezone) : '-'}`;
  document.querySelector('[data-patient-last]').textContent = `Ultimo atendimento: ${last ? formatDateTimeInTimezone(last.scheduled_start, last.clinic_timezone) : '-'}`;
  document.querySelector('[data-patient-sessions]').textContent = `Sessoes realizadas: ${appointments.filter((item) => item.status === 'completed').length}`;
  document.querySelector('[data-patient-finance]').textContent = `Status financeiro: ${formatOpenBalance(financialSummary?.open_balance || [])}`;
  document.querySelector('[data-patient-anamnesis]').textContent = patient.profile_completed_at ? 'Anamnese/cadastro em jornada' : 'Pendente';
  document.querySelector('[data-patient-specialty]').textContent = `Especialidade: ${next?.professional?.specialty || professionals[0]?.specialty || '-'}`;
}

function renderPatientFinancial() {
  const panel = document.querySelector('[data-patient-financial-panel]');
  if (!panel) return;
  panel.hidden = !hasPermission(profile, PERMISSIONS.FINANCE_READ);
  if (panel.hidden) return;

  const summary = document.querySelector('[data-patient-financial-summary]');
  const history = document.querySelector('[data-patient-financial-history]');
  clearChildren(summary);
  clearChildren(history);

  addDetail(summary, 'Saldo em aberto', formatOpenBalance(financialSummary?.open_balance || []));
  addDetail(summary, 'Cobrancas', String(financialSummary?.charges?.length || 0));
  addDetail(summary, 'Pagamentos', String(financialSummary?.payments?.length || 0));
  addDetail(summary, 'Recibos', String(financialSummary?.receipts?.length || 0));

  const charges = financialSummary?.charges || [];
  if (!charges.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Nenhuma cobranca encontrada para este paciente.';
    history.appendChild(empty);
    return;
  }

  charges.slice(0, 8).forEach((charge) => {
    const item = document.createElement('article');
    item.className = 'record-item';
    const main = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = charge.description;
    const meta = document.createElement('div');
    meta.className = 'record-meta';
    meta.textContent = `${charge.currency} | Valor ${formatCurrency(charge.final_amount, charge.currency)} | Saldo ${formatCurrency(charge.remaining_amount, charge.currency)}`;
    const badge = document.createElement('span');
    badge.className = `status-badge status-${charge.status}`;
    badge.textContent = FINANCIAL_CHARGE_STATUS_LABELS[charge.status] || charge.status;
    main.append(title, meta, badge);
    item.appendChild(main);
    history.appendChild(item);
  });
}

function fillProfessionalSelect() {
  const select = document.querySelector('[name="professional_id"]');
  clearChildren(select);

  professionals
    .filter((professional) => professional.status === 'active')
    .forEach((professional) => {
      const option = document.createElement('option');
      option.value = professional.id;
      option.textContent = professional.full_name;
      select.appendChild(option);
    });
}

function fillAppointmentSelect() {
  const select = document.querySelector('[name="appointment_id"]');
  clearChildren(select);

  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Selecione o Appointment';
  select.appendChild(empty);

  appointments
    .filter((appointment) => appointment.status === 'completed' || appointment.medical_record_id)
    .forEach((appointment) => {
      const option = document.createElement('option');
      option.value = appointment.id;
      option.textContent = `${formatDateTimeInTimezone(appointment.scheduled_start, appointment.clinic_timezone)} | ${appointment.professional?.full_name || 'Profissional'} | ${APPOINTMENT_STATUS_LABELS[appointment.status]}`;
      select.appendChild(option);
    });
}

function fillDocumentAppointmentSelect() {
  const select = document.querySelector('[data-document-form] [name="appointment_id"]');
  if (!select) return;
  clearChildren(select);
  const completedAppointments = appointments
    .filter((appointment) => appointment.status === 'completed')
    .sort((a, b) => new Date(b.scheduled_start) - new Date(a.scheduled_start));

  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Selecione uma sessao concluida';
  select.appendChild(empty);

  completedAppointments.forEach((appointment) => {
    const option = document.createElement('option');
    option.value = appointment.id;
    option.textContent = `${formatDateTimeInTimezone(appointment.scheduled_start, appointment.clinic_timezone)} - ${appointment.professional?.full_name || 'Profissional'} - ${APPOINTMENT_MODALITY_LABELS[appointment.modality] || appointment.modality || '-'}`;
    select.appendChild(option);
  });

  select.required = true;
  if (completedAppointments.length) {
    select.value = completedAppointments[0].id;
  }
  setDocumentContextFromAppointment(select.value);
  updateDocumentDraftAvailability();
}

function renderAppointmentCard() {
  const card = document.querySelector('[data-appointment-card]');
  clearChildren(card);
  const appointment = getNextAppointment();

  if (!appointment) {
    addDetail(card, 'Proxima Sessao', 'Nenhuma sessao futura encontrada.');
    return;
  }

  addDetail(card, 'Data', formatDateTimeInTimezone(appointment.scheduled_start, appointment.clinic_timezone));
  addDetail(card, 'Modalidade', APPOINTMENT_MODALITY_LABELS[appointment.modality] || '-');
  addDetail(card, 'Paciente vera', `${formatDateTimeInTimezone(appointment.scheduled_start, appointment.patient_timezone_snapshot)} (${appointment.patient_timezone_snapshot})`);
  addDetail(card, 'Profissional vera', `${formatDateTimeInTimezone(appointment.scheduled_start, appointment.clinic_timezone)} (${appointment.clinic_timezone})`);
  addDetail(card, 'Duracao', `${appointment.expected_duration || '-'} min`);
  addDetail(card, 'Link', appointment.meeting_url || '-');
}

function renderRecords() {
  const container = document.querySelector('[data-record-list]');
  clearChildren(container);

  if (!records.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Nenhum registro clinico encontrado.';
    container.appendChild(empty);
    return;
  }

  records.forEach((record) => {
    container.appendChild(createRecordItem(record));
  });
}

function createRecordItem(record) {
  const item = document.createElement('article');
  item.className = 'record-item';

  const main = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = record.title || MEDICAL_RECORD_TYPE_LABELS[record.record_type] || 'Registro clinico';

  const meta = document.createElement('div');
  meta.className = 'record-meta';
  meta.textContent = `${formatDateTime(record.record_date)} | ${MEDICAL_RECORD_TYPE_LABELS[record.record_type]} | ${record.professional?.full_name || 'Profissional'}`;

  const summary = document.createElement('p');
  summary.className = 'record-summary';
  summary.textContent = summarize(record.content);

  const badge = document.createElement('span');
  badge.className = `status-badge status-${record.status}`;
  badge.textContent = MEDICAL_RECORD_STATUS_LABELS[record.status] || record.status;

  main.append(title, meta, summary, badge);
  item.append(main, createRecordActions(record));
  return item;
}

function createRecordActions(record) {
  const actions = document.createElement('div');
  actions.className = 'record-actions';

  addButton(actions, 'Visualizar', () => viewRecord(record));

  if (record.status === 'draft' && hasPermission(profile, PERMISSIONS.MEDICAL_RECORDS_UPDATE)) {
    addButton(actions, 'Editar', () => openRecordForm(record));
  }

  if (record.status === 'draft' && hasPermission(profile, PERMISSIONS.MEDICAL_RECORDS_SIGN)) {
    addButton(actions, 'Assinar', () => signRecord(record));
  }

  if (record.status !== 'cancelled' && hasPermission(profile, PERMISSIONS.MEDICAL_RECORDS_CANCEL)) {
    addButton(actions, 'Cancelar', () => cancelRecord(record));
  }

  return actions;
}

function addButton(container, label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button';
  button.textContent = label;
  button.addEventListener('click', handler);
  container.appendChild(button);
}

function openRecordForm(record = null) {
  editingRecord = record;
  const form = document.querySelector('[data-record-form]');
  form.reset();
  setFormReadonly(form, false);

  if (record) {
    form.appointment_id.value = record.appointment_id || '';
    form.record_type.value = record.record_type;
    form.professional_id.value = record.professional_id;
    form.record_date.value = dateTimeLocalInput(record.record_date);
    form.title.value = record.title || '';
    form.content.value = record.content || '';
    form.diagnosis.value = record.diagnosis || '';
    form.conduct.value = record.conduct || '';
    form.prescription.value = record.prescription || '';
  } else {
    form.record_date.value = dateTimeLocalInput();
    const completedWithoutRecord = appointments.find((appointment) => appointment.status === 'completed' && !appointment.medical_record_id);
    form.appointment_id.value = completedWithoutRecord?.id || '';
  }

  openModal(document.querySelector('[data-record-modal]'));
}

function openDocumentForm() {
  const form = document.querySelector('[data-document-form]');
  form.reset();
  form.patient_name.value = patient.full_name;
  fillDocumentAppointmentSelect();
  updateDocumentTemplateCode();
  openModal(document.querySelector('[data-document-modal]'));
}

function setDocumentContextFromAppointment(appointmentId) {
  const form = document.querySelector('[data-document-form]');
  const appointment = appointments.find((item) => item.id === appointmentId);
  if (!form) return;
  form.patient_name.value = appointment?.patients?.full_name || patient.full_name;
  form.professional_name.value = appointment?.professional?.full_name || '';
}

function updateDocumentTemplateCode() {
  const form = document.querySelector('[data-document-form]');
  const template = templateForDocumentType(form?.document_type.value);
  if (form?.template_code) form.template_code.value = template.code;
  if (form?.template_name) form.template_name.value = template.name;
  fillDocumentAppointmentSelect();
}

function documentTypeRequiresCompletedAppointment(type) {
  return ['attendance_certificate', 'clinical_progress'].includes(type);
}

function templateForDocumentType(type) {
  const templates = {
    attendance_certificate: ['ATTENDANCE_CERTIFICATE', 'Declaracao de comparecimento'],
    follow_up_certificate: ['FOLLOW_UP_CERTIFICATE', 'Declaracao de acompanhamento'],
    service_certificate: ['SERVICE_CERTIFICATE', 'Declaracao de atendimento'],
    clinical_report: ['CLINICAL_REPORT', 'Relatorio clinico'],
    referral: ['REFERRAL', 'Encaminhamento'],
    clinical_progress: ['CLINICAL_PROGRESS', 'Evolucao clinica'],
    treatment_plan: ['TREATMENT_PLAN', 'Plano terapeutico'],
    consent: ['CONSENT', 'Consentimento'],
    custom: ['CUSTOM', 'Documento personalizado']
  };
  const [code, name] = templates[type] || templates.custom;
  return { code, name };
}

function updateDocumentDraftAvailability() {
  const form = document.querySelector('[data-document-form]');
  const button = document.querySelector('[data-save-document-draft]');
  const message = document.querySelector('[data-document-message]');
  if (!form || !button) return;

  const hasCompletedAppointment = appointments.some((appointment) => appointment.status === 'completed');
  const hasAppointment = Boolean(form.appointment_id.value);
  const hasProfessional = Boolean(form.professional_name.value);
  button.disabled = !hasAppointment || !hasProfessional;

  if (!hasCompletedAppointment) {
    showMessage(message, 'Nenhuma sessao concluida disponivel para este paciente.', 'warning');
    return;
  }

  if (!hasProfessional) {
    showMessage(message, 'Nenhum profissional ativo disponivel para este documento.', 'warning');
    return;
  }

  clearMessage(message);
}

async function saveDocumentDraft(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('[data-document-message]');
  const button = document.querySelector('[data-save-document-draft]');
  clearMessage(message);

  try {
    button.disabled = true;
    button.textContent = 'A criar...';
    await createDocumentFromAppointment({
      appointmentId: form.appointment_id.value,
      documentType: form.document_type.value,
      templateCode: form.template_code.value.trim(),
      visibility: form.visibility.value,
      releaseToPatient: form.release_to_patient.checked
    });
    closeModal(document.querySelector('[data-document-modal]'));
    showMessage(document.querySelector('[data-page-message]'), 'Rascunho documental criado.', 'success');
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel criar o documento.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Criar rascunho';
  }
}

async function saveRecord(event) {
  event.preventDefault();
  if (saving) return;

  const form = event.currentTarget;
  const message = document.querySelector('[data-form-message]');
  const button = document.querySelector('[data-save-record]');
  clearMessage(message);

  const payload = {
    patient_id: patientId,
    professional_id: form.professional_id.value,
    appointment_id: form.appointment_id.value,
    record_type: form.record_type.value,
    record_date: new Date(form.record_date.value).toISOString(),
    title: form.title.value.trim(),
    content: form.content.value.trim(),
    diagnosis: form.diagnosis.value.trim(),
    conduct: form.conduct.value.trim(),
    prescription: form.prescription.value.trim()
  };

  if (!payload.content) {
    showMessage(message, 'Conteudo clinico obrigatorio.', 'error');
    return;
  }

  if (!payload.appointment_id) {
    showMessage(message, 'Selecione o Appointment que originou este prontuario.', 'error');
    return;
  }

  saving = true;
  button.disabled = true;
  button.textContent = 'A guardar...';

  try {
    const saved = editingRecord
      ? await updateMedicalRecord(editingRecord.id, payload)
      : await createMedicalRecord(payload);

    await audit(editingRecord ? 'medical_records.update' : 'medical_records.create', saved, editingRecord);
    showMessage(document.querySelector('[data-page-message]'), 'Registro guardado com sucesso.', 'success');
    closeModal(document.querySelector('[data-record-modal]'));
    await reloadRecords();
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel guardar o registro.', 'error');
  } finally {
    saving = false;
    button.disabled = false;
    button.textContent = 'Guardar registro';
  }
}

function viewRecord(record) {
  const subtitle = document.querySelector('[data-view-subtitle]');
  subtitle.textContent = `${MEDICAL_RECORD_STATUS_LABELS[record.status]} | ${formatDateTime(record.record_date)}`;

  const detail = document.querySelector('[data-record-detail]');
  clearChildren(detail);

  addDetail(detail, 'Paciente', patient.full_name);
  addDetail(detail, 'Profissional', record.professional?.full_name || '-');
  addDetail(detail, 'Tipo', MEDICAL_RECORD_TYPE_LABELS[record.record_type] || '-');
  addDetail(detail, 'Titulo', record.title || '-');
  addDetail(detail, 'Conteudo', record.content);
  addDetail(detail, 'Diagnostico', record.diagnosis || '-');
  addDetail(detail, 'Conduta', record.conduct || '-');
  addDetail(detail, 'Prescricao', record.prescription || '-');
  addDetail(detail, 'Autor', record.author?.full_name || '-');
  addDetail(detail, 'Criado em', formatDateTime(record.created_at));
  addDetail(detail, 'Ultima atualizacao', formatDateTime(record.updated_at));

  if (record.status === 'cancelled') {
    addDetail(detail, 'Motivo do cancelamento', record.cancel_reason || '-');
  }

  openModal(document.querySelector('[data-view-modal]'));
}

function addDetail(container, label, value) {
  const block = document.createElement('div');
  block.className = 'record-detail-block';
  const strong = document.createElement('strong');
  strong.textContent = label;
  const text = document.createElement('p');
  text.textContent = value || '-';
  block.append(strong, text);
  container.appendChild(block);
}

async function signRecord(record) {
  if (!window.confirm('Assinar este registro clinico?')) return;
  const signed = await signMedicalRecord(record.id);
  await audit('medical_records.sign', signed, record);
  await reloadRecords();
}

async function cancelRecord(record) {
  const reason = window.prompt('Informe o motivo do cancelamento:');
  if (!reason) return;
  const cancelled = await cancelMedicalRecord(record.id, reason);
  await audit('medical_records.cancel', cancelled, record);
  await reloadRecords();
}

async function reloadRecords() {
  [records, appointments] = await Promise.all([
    listMedicalRecords(patientId),
    listAppointments(profile.clinic_id, { patientId })
  ]);
  renderPatient();
  renderAppointmentCard();
  fillAppointmentSelect();
  renderRecords();
}

async function audit(action, record, previousData = null) {
  await createAuditLog({
    clinicId: profile.clinic_id,
    action,
    entity: 'medical_records',
    entityId: record.id,
    previousData: sanitizeRecord(previousData),
    newData: sanitizeRecord(record)
  });
}

function sanitizeRecord(record) {
  if (!record) return null;
  const { id, clinic_id, patient_id, professional_id, record_type, title, record_date, status } = record;
  return { id, clinic_id, patient_id, professional_id, appointment_id: record.appointment_id, record_type, title, record_date, status };
}

function summarize(content) {
  const text = String(content || '');
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function getNextAppointment() {
  return appointments
    .filter((appointment) => ['scheduled', 'confirmed', 'checked_in', 'in_progress'].includes(appointment.status))
    .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start))[0];
}

function formatOpenBalance(rows) {
  if (!rows.length) return 'Sem saldo em aberto';
  return rows
    .map((item) => formatCurrency(item.amount, item.currency))
    .join(' | ');
}

function setFormReadonly(form, readonly) {
  Array.from(form.elements).forEach((element) => {
    if (element.name) element.disabled = readonly;
  });
}
