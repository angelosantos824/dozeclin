import { PERMISSIONS, hasPermission } from '../auth/permissions.js';
import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { closeModal, openModal } from '../ui/modal.js';
import { clearChildren } from '../ui/table.js';
import { clearMessage, showMessage } from '../ui/messages.js';
import { dateTimeLocalInput, formatDateTime } from '../ui/formatters.js';
import {
  MEDICAL_RECORD_STATUS_LABELS,
  MEDICAL_RECORD_TYPE_LABELS,
  PATIENT_STATUS_LABELS
} from '../config/constants.js';
import { getPatientById } from '../services/patients.service.js';
import { listProfessionals } from '../services/profiles.service.js';
import { createAuditLog } from '../services/audit.service.js';
import {
  cancelMedicalRecord,
  createMedicalRecord,
  listMedicalRecords,
  signMedicalRecord,
  updateMedicalRecord
} from '../services/records.service.js';

const patientId = new URLSearchParams(window.location.search).get('id');
let profile = await protectPage(PERMISSIONS.MEDICAL_RECORDS_READ);
let patient = null;
let records = [];
let professionals = [];
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
    [patient, professionals, records] = await Promise.all([
      getPatientById(profile.clinic_id, patientId),
      listProfessionals(profile.clinic_id),
      listMedicalRecords(patientId)
    ]);
    renderPatient();
    fillProfessionalSelect();
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
  document.querySelector('[data-record-form]')?.addEventListener('submit', saveRecord);
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
  }

  openModal(document.querySelector('[data-record-modal]'));
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
  records = await listMedicalRecords(patientId);
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
  return { id, clinic_id, patient_id, professional_id, record_type, title, record_date, status };
}

function summarize(content) {
  const text = String(content || '');
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function setFormReadonly(form, readonly) {
  Array.from(form.elements).forEach((element) => {
    if (element.name) element.disabled = readonly;
  });
}
