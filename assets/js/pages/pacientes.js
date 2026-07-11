import { PERMISSIONS } from '../auth/permissions.js';
import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { archivePatient, createPatient, listPatients, updatePatient } from '../services/patients.service.js';
import { createAuditLog } from '../services/audit.service.js';
import { PATIENT_STATUS_LABELS } from '../config/constants.js';
import { appendEmptyRow, clearChildren, createCell } from '../ui/table.js';
import { closeModal, openModal } from '../ui/modal.js';
import { showMessage, clearMessage } from '../ui/messages.js';

let profile = await protectPage(PERMISSIONS.PATIENTS_READ);
let patients = [];
let editingPatient = null;

if (profile) {
  mountLayout(profile);
  bindEvents();
  await renderPatients();
}

function bindEvents() {
  document.querySelector('[data-new-patient]')?.addEventListener('click', () => {
    editingPatient = null;
    document.querySelector('[data-patient-form]').reset();
    document.querySelector('[name="status"]').value = 'active';
    openModal(document.querySelector('[data-patient-modal]'));
  });

  document.querySelector('[data-close-modal]')?.addEventListener('click', () => {
    closeModal(document.querySelector('[data-patient-modal]'));
  });

  document.querySelector('[data-patient-form]')?.addEventListener('submit', savePatient);
  document.querySelector('[data-filter]')?.addEventListener('input', renderTable);
}

async function renderPatients() {
  const status = document.querySelector('[data-page-status]');
  status.textContent = 'A carregar pacientes...';

  try {
    patients = await listPatients(profile.clinic_id);
    renderTable();
    status.textContent = `${patients.length} paciente(s) encontrados.`;
  } catch (error) {
    status.textContent = 'Nao foi possivel carregar pacientes.';
  }
}

function renderTable() {
  const tbody = document.querySelector('[data-patients-table]');
  const filter = String(document.querySelector('[data-filter]')?.value || '').toLowerCase();
  clearChildren(tbody);

  const filtered = patients.filter((patient) => {
    return [patient.full_name, patient.email, patient.phone, patient.document]
      .some((value) => String(value || '').toLowerCase().includes(filter));
  });

  if (!filtered.length) {
    appendEmptyRow(tbody, 5, 'Nenhum paciente encontrado.');
    return;
  }

  filtered.forEach((patient) => {
    const row = document.createElement('tr');
    row.append(
      createCell(patient.full_name),
      createCell(patient.email),
      createCell(patient.phone),
      createCell(PATIENT_STATUS_LABELS[patient.status] || patient.status),
      buildActions(patient)
    );
    tbody.appendChild(row);
  });
}

function buildActions(patient) {
  const cell = document.createElement('td');
  cell.className = 'table-actions';

  const open = document.createElement('a');
  open.className = 'icon-button';
  open.href = `paciente-detalhes.html?id=${patient.id}`;
  open.title = 'Abrir paciente';
  open.textContent = 'Abrir';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'icon-button';
  edit.title = 'Editar paciente';
  edit.textContent = 'Editar';
  edit.addEventListener('click', () => editPatient(patient));

  const archive = document.createElement('button');
  archive.type = 'button';
  archive.className = 'icon-button danger';
  archive.title = 'Arquivar paciente';
  archive.textContent = 'Arquivar';
  archive.addEventListener('click', () => archiveSelectedPatient(patient));

  cell.append(open, edit, archive);
  return cell;
}

function editPatient(patient) {
  editingPatient = patient;
  const form = document.querySelector('[data-patient-form]');
  form.full_name.value = patient.full_name || '';
  form.email.value = patient.email || '';
  form.phone.value = patient.phone || '';
  form.birth_date.value = patient.birth_date || '';
  form.document.value = patient.document || '';
  form.address.value = patient.address || '';
  form.timezone.value = patient.timezone || 'Europe/Lisbon';
  form.status.value = patient.status || 'active';
  openModal(document.querySelector('[data-patient-modal]'));
}

async function savePatient(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('[data-form-message]');
  clearMessage(message);

  const payload = {
    full_name: form.full_name.value.trim(),
    email: form.email.value.trim(),
    phone: form.phone.value.trim(),
    birth_date: form.birth_date.value || null,
    document: form.document.value.trim() || null,
    address: form.address.value.trim() || null,
    timezone: form.timezone.value,
    status: form.status.value
  };

  if (!payload.full_name || !payload.email) {
    showMessage(message, 'Nome e email sao obrigatorios.', 'error');
    return;
  }

  try {
    const saved = editingPatient
      ? await updatePatient(editingPatient.id, payload)
      : await createPatient(profile.clinic_id, payload);

    await createAuditLog({
      clinicId: profile.clinic_id,
      action: editingPatient ? 'patients.update' : 'patients.create',
      entity: 'patients',
      entityId: saved.id,
      previousData: editingPatient,
      newData: saved
    });

    closeModal(document.querySelector('[data-patient-modal]'));
    await renderPatients();
  } catch (error) {
    showMessage(message, 'Nao foi possivel guardar o paciente.', 'error');
  }
}

async function archiveSelectedPatient(patient) {
  const confirmed = window.confirm('Arquivar este paciente? Ele nao sera excluido definitivamente.');
  if (!confirmed) return;

  try {
    const archived = await archivePatient(patient.id);
    await createAuditLog({
      clinicId: profile.clinic_id,
      action: 'patients.archive',
      entity: 'patients',
      entityId: patient.id,
      previousData: patient,
      newData: archived
    });
    await renderPatients();
  } catch (error) {
    document.querySelector('[data-page-status]').textContent = 'Nao foi possivel arquivar o paciente.';
  }
}
