import { PERMISSIONS, hasPermission } from '../auth/permissions.js';
import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { closeModal, openModal } from '../ui/modal.js';
import { clearChildren } from '../ui/table.js';
import { clearMessage, showMessage } from '../ui/messages.js';
import { formatDate, formatTime, todayDateInput } from '../ui/formatters.js';
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from '../config/constants.js';
import { listPatients } from '../services/patients.service.js';
import { listProfessionals } from '../services/profiles.service.js';
import {
  createAppointment,
  listAppointments,
  updateAppointment,
  updateAppointmentStatus
} from '../services/appointments.service.js';
import { createAuditLog } from '../services/audit.service.js';

let profile = await protectPage(PERMISSIONS.APPOINTMENTS_READ);
let appointments = [];
let patients = [];
let professionals = [];
let editingAppointment = null;

if (profile) {
  mountLayout(profile);
  await loadBaseData();
  applyPermissions();
  bindEvents();
  await loadAppointments();
}

function applyPermissions() {
  const createButton = document.querySelector('[data-new-appointment]');
  if (createButton) {
    createButton.hidden = !hasPermission(profile, PERMISSIONS.APPOINTMENTS_CREATE);
  }
}

async function loadBaseData() {
  const today = todayDateInput();
  document.querySelector('[data-filter-from]').value = today;
  document.querySelector('[data-filter-to]').value = today;

  [patients, professionals] = await Promise.all([
    listPatients(profile.clinic_id),
    listProfessionals(profile.clinic_id)
  ]);

  fillSelect(document.querySelector('[data-filter-patient]'), patients, 'Todos os pacientes');
  fillSelect(document.querySelector('[data-filter-professional]'), professionals, 'Todos os profissionais');
  fillSelect(document.querySelector('[name="patient_id"]'), patients, 'Selecione o paciente');
  fillSelect(document.querySelector('[name="professional_id"]'), professionals, 'Selecione o profissional');
}

function bindEvents() {
  document.querySelector('[data-apply-filters]')?.addEventListener('click', loadAppointments);
  document.querySelector('[data-new-appointment]')?.addEventListener('click', () => {
    editingAppointment = null;
    const form = document.querySelector('[data-appointment-form]');
    form.reset();
    form.appointment_date.value = document.querySelector('[data-filter-from]').value || todayDateInput();
    form.status.value = 'scheduled';
    openModal(document.querySelector('[data-appointment-modal]'));
  });
  document.querySelector('[data-close-modal]')?.addEventListener('click', () => {
    closeModal(document.querySelector('[data-appointment-modal]'));
  });
  document.querySelector('[data-appointment-form]')?.addEventListener('submit', saveAppointment);
}

async function loadAppointments() {
  const message = document.querySelector('[data-page-message]');
  showMessage(message, 'A carregar agenda...', 'info');

  try {
    appointments = await listAppointments(profile.clinic_id, {
      from: document.querySelector('[data-filter-from]').value,
      to: document.querySelector('[data-filter-to]').value,
      professionalId: document.querySelector('[data-filter-professional]').value,
      patientId: document.querySelector('[data-filter-patient]').value,
      status: document.querySelector('[data-filter-status]').value
    });
    renderAppointments();
    showMessage(message, `${appointments.length} consulta(s) encontradas.`, 'success');
  } catch (error) {
    showMessage(message, 'Nao foi possivel carregar a agenda.', 'error');
  }
}

function renderAppointments() {
  const list = document.querySelector('[data-appointments-list]');
  clearChildren(list);

  if (!appointments.length) {
    const empty = document.createElement('div');
    empty.className = 'panel empty-row';
    empty.textContent = 'Nenhuma consulta encontrada.';
    list.appendChild(empty);
    return;
  }

  appointments.forEach((appointment) => {
    list.appendChild(createAppointmentItem(appointment));
  });
}

function createAppointmentItem(appointment) {
  const item = document.createElement('article');
  item.className = 'appointment-item';

  const time = document.createElement('div');
  time.className = 'appointment-time';
  time.textContent = `${formatTime(appointment.start_time)} - ${formatTime(appointment.end_time)}`;

  const main = document.createElement('div');
  main.className = 'appointment-main';
  const patient = document.createElement('strong');
  patient.textContent = appointment.patients?.full_name || 'Paciente';
  const meta = document.createElement('div');
  meta.className = 'appointment-meta';
  meta.textContent = `${formatDate(appointment.appointment_date)} | ${appointment.professional?.full_name || 'Profissional'} | ${APPOINTMENT_TYPE_LABELS[appointment.appointment_type] || 'Outro'}`;
  const badge = document.createElement('span');
  badge.className = `appointment-badge appointment-${appointment.status}`;
  badge.textContent = APPOINTMENT_STATUS_LABELS[appointment.status] || appointment.status;
  main.append(patient, meta, badge);

  item.append(time, main, createActions(appointment));
  return item;
}

function createActions(appointment) {
  const actions = document.createElement('div');
  actions.className = 'appointment-actions';

  addAction(actions, 'Editar', () => editAppointment(appointment), PERMISSIONS.APPOINTMENTS_UPDATE);
  addStatusAction(actions, appointment, 'confirmed', 'Confirmar', PERMISSIONS.APPOINTMENTS_UPDATE);
  addStatusAction(actions, appointment, 'in_progress', 'Iniciar', PERMISSIONS.APPOINTMENTS_UPDATE);
  addStatusAction(actions, appointment, 'completed', 'Concluir', PERMISSIONS.APPOINTMENTS_COMPLETE);
  addStatusAction(actions, appointment, 'cancelled', 'Cancelar', PERMISSIONS.APPOINTMENTS_CANCEL, true);
  addStatusAction(actions, appointment, 'no_show', 'Nao compareceu', PERMISSIONS.APPOINTMENTS_CANCEL);

  const patientLink = document.createElement('a');
  patientLink.className = 'icon-button';
  patientLink.href = `pacientes.html?paciente=${appointment.patient_id}`;
  patientLink.textContent = 'Paciente';
  actions.appendChild(patientLink);

  return actions;
}

function addAction(container, label, handler, permission) {
  if (!hasPermission(profile, permission)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button';
  button.textContent = label;
  button.addEventListener('click', handler);
  container.appendChild(button);
}

function addStatusAction(container, appointment, status, label, permission, confirmAction = false) {
  if (appointment.status === status) return;
  addAction(container, label, async () => {
    if (confirmAction && !window.confirm('Cancelar esta consulta?')) return;
    await changeAppointmentStatus(appointment, status);
  }, permission);
}

function editAppointment(appointment) {
  editingAppointment = appointment;
  const form = document.querySelector('[data-appointment-form]');
  form.patient_id.value = appointment.patient_id;
  form.professional_id.value = appointment.professional_id;
  form.appointment_date.value = appointment.appointment_date;
  form.start_time.value = formatTime(appointment.start_time);
  form.end_time.value = formatTime(appointment.end_time);
  form.appointment_type.value = appointment.appointment_type || 'session';
  form.status.value = appointment.status || 'scheduled';
  form.notes.value = appointment.notes || '';
  openModal(document.querySelector('[data-appointment-modal]'));
}

async function saveAppointment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('[data-form-message]');
  clearMessage(message);

  const payload = {
    patient_id: form.patient_id.value,
    professional_id: form.professional_id.value,
    appointment_date: form.appointment_date.value,
    start_time: form.start_time.value,
    end_time: form.end_time.value,
    appointment_type: form.appointment_type.value,
    status: form.status.value,
    notes: form.notes.value.trim() || null
  };

  if (!payload.patient_id || !payload.professional_id || !payload.appointment_date || !payload.start_time || !payload.end_time) {
    showMessage(message, 'Preencha paciente, profissional, data e horarios.', 'error');
    return;
  }

  if (payload.end_time <= payload.start_time) {
    showMessage(message, 'A hora final deve ser posterior a hora inicial.', 'error');
    return;
  }

  try {
    const saved = editingAppointment
      ? await updateAppointment(editingAppointment.id, payload)
      : await createAppointment(profile.clinic_id, profile.id, payload);

    await createAuditLog({
      clinicId: profile.clinic_id,
      action: editingAppointment ? 'appointments.update' : 'appointments.create',
      entity: 'appointments',
      entityId: saved.id,
      previousData: sanitizeAppointment(editingAppointment),
      newData: sanitizeAppointment(saved)
    });

    closeModal(document.querySelector('[data-appointment-modal]'));
    await loadAppointments();
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel guardar a consulta.', 'error');
  }
}

async function changeAppointmentStatus(appointment, status) {
  try {
    const updated = await updateAppointmentStatus(appointment.id, status);
    await createAuditLog({
      clinicId: profile.clinic_id,
      action: status === 'cancelled' ? 'appointments.cancel' : status === 'completed' ? 'appointments.complete' : 'appointments.status.update',
      entity: 'appointments',
      entityId: appointment.id,
      previousData: sanitizeAppointment(appointment),
      newData: sanitizeAppointment(updated)
    });
    await loadAppointments();
  } catch (error) {
    showMessage(document.querySelector('[data-page-message]'), 'Nao foi possivel alterar o estado da consulta.', 'error');
  }
}

function fillSelect(select, rows, placeholder) {
  clearChildren(select);
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = placeholder;
  select.appendChild(empty);

  rows.forEach((row) => {
    const option = document.createElement('option');
    option.value = row.id;
    option.textContent = row.full_name;
    select.appendChild(option);
  });
}

function sanitizeAppointment(appointment) {
  if (!appointment) return null;
  const { id, clinic_id, patient_id, professional_id, appointment_date, start_time, end_time, status, appointment_type } = appointment;
  return { id, clinic_id, patient_id, professional_id, appointment_date, start_time, end_time, status, appointment_type };
}
