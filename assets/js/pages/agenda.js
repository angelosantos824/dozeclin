import { PERMISSIONS, hasPermission } from '../auth/permissions.js';
import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { closeModal, openModal } from '../ui/modal.js';
import { clearChildren } from '../ui/table.js';
import { clearMessage, showMessage } from '../ui/messages.js';
import {
  formatDate,
  formatDateTimeInTimezone,
  formatTimeInTimezone,
  todayDateInput,
  toLocalDateInput,
  toLocalTimeInput
} from '../ui/formatters.js';
import {
  APPOINTMENT_MODALITY_LABELS,
  APPOINTMENT_STATUS_LABELS,
  COMMON_TIMEZONES
} from '../config/constants.js';
import { listPatients } from '../services/patients.service.js';
import { listProfessionals } from '../services/profiles.service.js';
import {
  createAppointment,
  listAppointments,
  rescheduleAppointment,
  updateAppointment,
  updateAppointmentStatus
} from '../services/appointments.service.js';

let profile = await protectPage(PERMISSIONS.APPOINTMENTS_READ);
let appointments = [];
let todayAppointments = [];
let patients = [];
let professionals = [];
let editingAppointment = null;
let reschedulingAppointment = null;
let rescheduleSaving = false;
let openActionsMenu = null;
let currentFilters = defaultFilters();
let draftFilters = null;
let filtersReturnFocus = null;
let baseDataLoading = false;
let baseDataError = '';

const OPERATIONAL_STATUSES = ['scheduled', 'confirmed', 'checked_in', 'in_progress'];
const HISTORICAL_STATUSES = ['completed', 'rescheduled', 'cancelled_by_patient', 'cancelled_by_clinic', 'no_show', 'archived'];
const CANCELLED_STATUSES = ['cancelled_by_patient', 'cancelled_by_clinic'];
const STATUS_GROUPS = {
  active: OPERATIONAL_STATUSES,
  completed: ['completed'],
  rescheduled: ['rescheduled'],
  cancelled: CANCELLED_STATUSES,
  no_show: ['no_show'],
  all: [...OPERATIONAL_STATUSES, ...HISTORICAL_STATUSES]
};

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
  baseDataLoading = true;
  setAppointmentFormLoading(true);

  try {
    [patients, professionals] = await Promise.all([
      listPatients(profile.clinic_id),
      listProfessionals(profile.clinic_id)
    ]);

    const filtersForm = document.querySelector('[data-filters-form]');
    const appointmentForm = document.querySelector('[data-appointment-form]');
    fillSelect(filtersForm.patient_id, patients, 'Todos os pacientes');
    fillSelect(filtersForm.professional_id, professionals, 'Todos os profissionais');
    fillSelect(appointmentForm.patient_id, patients, 'Selecione um paciente');
    fillSelect(appointmentForm.professional_id, professionals, 'Selecione um profissional');
    fillSelect(document.querySelector('[data-reschedule-form] [name="professional_id"]'), professionals, 'Selecione um profissional');
    fillTimezoneOptions();
    renderActiveFilterSummary();
    baseDataError = '';
    updateAppointmentFormAvailability();
  } catch (error) {
    patients = [];
    professionals = [];
    baseDataError = sanitizeLoadError(error);
    const appointmentForm = document.querySelector('[data-appointment-form]');
    fillSelect(appointmentForm.patient_id, [], 'Selecione um paciente');
    fillSelect(appointmentForm.professional_id, [], 'Selecione um profissional');
    showMessage(document.querySelector('[data-form-message]'), baseDataError, 'error');
    updateAppointmentFormAvailability(baseDataError);
  } finally {
    baseDataLoading = false;
    setAppointmentFormLoading(false);
  }
}

function bindEvents() {
  document.querySelector('[data-open-filters]')?.addEventListener('click', openFiltersModal);
  document.querySelector('[data-filters-form]')?.addEventListener('submit', applyFilters);
  document.querySelector('[data-clear-filters]')?.addEventListener('click', clearFilters);
  document.querySelectorAll('[data-cancel-filters]').forEach((button) => button.addEventListener('click', closeFiltersModal));
  document.querySelector('[data-focus-today]')?.addEventListener('click', () => {
    currentFilters = defaultFilters();
    renderActiveFilterSummary();
    loadAppointments();
  });
  document.querySelector('[data-new-appointment]')?.addEventListener('click', openNewAppointmentModal);
  document.querySelector('[data-appointment-form] [name="patient_id"]')?.addEventListener('change', updateAppointmentFormAvailability);
  document.querySelector('[data-appointment-form] [name="professional_id"]')?.addEventListener('change', updateAppointmentFormAvailability);
  document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => {
    closeModal(document.querySelector('[data-appointment-modal]'));
  }));
  document.querySelectorAll('[data-close-reschedule-modal]').forEach((button) => button.addEventListener('click', closeRescheduleModal));
  document.querySelector('[data-appointment-form]')?.addEventListener('submit', saveAppointment);
  document.querySelector('[data-reschedule-form]')?.addEventListener('submit', saveReschedule);
  document.querySelector('[name="patient_id"]')?.addEventListener('change', updatePatientTimezone);
  document.querySelector('[name="modality"]')?.addEventListener('change', toggleMeetingRequirement);
  document.querySelector('[data-reschedule-form] [name="modality"]')?.addEventListener('change', toggleRescheduleMeetingRequirement);
  document.addEventListener('click', closeActionsMenuOnOutsideClick);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!document.querySelector('[data-filters-modal]')?.hidden) {
      closeFiltersModal();
      return;
    }
    closeActionsMenu();
  });
}

async function openNewAppointmentModal() {
  editingAppointment = null;
  const form = document.querySelector('[data-appointment-form]');
  const message = document.querySelector('[data-form-message]');
  form.reset();
  clearMessage(message);
  form.appointment_date.value = currentFilters.from || todayDateInput();
  form.expected_duration.value = 50;
  form.clinic_timezone.value = profile.clinics?.timezone || 'Europe/Lisbon';
  form.patient_timezone_snapshot.value = 'Europe/Lisbon';
  openModal(document.querySelector('[data-appointment-modal]'));
  await loadBaseData();
  updateAppointmentFormAvailability();
}

async function loadAppointments() {
  const message = document.querySelector('[data-page-message]');
  showMessage(message, 'A carregar agenda...', 'info');

  try {
    [appointments, todayAppointments] = await Promise.all([
      listAppointments(profile.clinic_id, {
        from: currentFilters.from,
        to: currentFilters.to,
        professionalId: currentFilters.professionalId,
        patientId: currentFilters.patientId,
        statuses: getSelectedStatuses()
      }),
      listAppointments(profile.clinic_id, {
        date: todayDateInput(),
        professionalId: currentFilters.professionalId,
        patientId: currentFilters.patientId,
        statuses: OPERATIONAL_STATUSES
      })
    ]);
    renderAppointments();
    renderDayAgenda();
    showMessage(message, `${appointments.filter(isVisibleAppointment).length} consulta(s) encontradas.`, 'success');
  } catch (error) {
    showMessage(message, 'Nao foi possivel carregar a agenda.', 'error');
  }
}

function renderAppointments() {
  const list = document.querySelector('[data-appointments-list]');
  clearChildren(list);
  const visibleAppointments = appointments.filter(isVisibleAppointment);

  if (!visibleAppointments.length) {
    const empty = document.createElement('div');
    empty.className = 'panel empty-row';
    empty.textContent = 'Nenhuma consulta encontrada.';
    list.appendChild(empty);
    return;
  }

  visibleAppointments.forEach((appointment) => {
    list.appendChild(createAppointmentItem(appointment));
  });
}

function defaultFilters() {
  const today = todayDateInput();
  return {
    from: today,
    to: today,
    professionalId: '',
    patientId: '',
    statusGroup: 'active',
    showHistory: false
  };
}

function openFiltersModal(event) {
  filtersReturnFocus = event?.currentTarget || document.querySelector('[data-open-filters]');
  draftFilters = { ...currentFilters };
  fillFiltersForm(draftFilters);
  openModal(document.querySelector('[data-filters-modal]'));
  window.setTimeout(() => document.querySelector('[data-filters-form] [name="from"]')?.focus(), 0);
}

function closeFiltersModal() {
  draftFilters = null;
  closeModal(document.querySelector('[data-filters-modal]'));
  filtersReturnFocus?.focus();
}

async function applyFilters(event) {
  event.preventDefault();
  draftFilters = readFiltersForm();
  currentFilters = { ...draftFilters };
  closeFiltersModal();
  renderActiveFilterSummary();
  await loadAppointments();
}

function clearFilters() {
  draftFilters = defaultFilters();
  fillFiltersForm(draftFilters);
}

function fillFiltersForm(filters) {
  const form = document.querySelector('[data-filters-form]');
  form.from.value = filters.from || '';
  form.to.value = filters.to || '';
  form.professional_id.value = filters.professionalId || '';
  form.patient_id.value = filters.patientId || '';
  form.status_group.value = filters.statusGroup || 'active';
  form.show_history.checked = Boolean(filters.showHistory);
}

function readFiltersForm() {
  const form = document.querySelector('[data-filters-form]');
  return {
    from: form.from.value,
    to: form.to.value,
    professionalId: form.professional_id.value,
    patientId: form.patient_id.value,
    statusGroup: form.status_group.value,
    showHistory: form.show_history.checked
  };
}

function renderActiveFilterSummary() {
  const container = document.querySelector('[data-active-filters]');
  const button = document.querySelector('[data-open-filters]');
  clearChildren(container);

  const chips = getActiveFilterChips();
  button.textContent = chips.length ? `Filtrar (${chips.length})` : 'Filtrar';
  container.hidden = chips.length === 0;
  if (!chips.length) return;

  const label = document.createElement('span');
  label.textContent = 'Filtros ativos:';
  container.appendChild(label);

  chips.forEach((chip) => {
    const element = document.createElement('span');
    element.className = 'filter-chip';
    element.appendChild(textLine(chip.label));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'x';
    remove.setAttribute('aria-label', `Remover filtro ${chip.label}`);
    remove.addEventListener('click', async () => {
      chip.remove();
      renderActiveFilterSummary();
      await loadAppointments();
    });
    element.appendChild(remove);
    container.appendChild(element);
  });
}

function createAppointmentItem(appointment) {
  const item = document.createElement('article');
  item.className = isHistoricalAppointment(appointment) ? 'appointment-card is-history' : 'appointment-card';
  item.dataset.appointmentId = appointment.id;

  const time = document.createElement('div');
  time.className = 'appointment-time';
  time.textContent = formatTimeInTimezone(appointment.scheduled_start, appointment.clinic_timezone);

  const main = document.createElement('div');
  main.className = 'appointment-details';
  const patient = document.createElement('h3');
  patient.textContent = appointment.patients?.full_name || 'Paciente';
  const meta = document.createElement('div');
  meta.className = 'appointment-meta';
  meta.append(
    textLine(formatDate(appointment.appointment_date)),
    textLine(appointment.professional?.full_name || 'Profissional'),
    textLine(APPOINTMENT_MODALITY_LABELS[appointment.modality] || 'Outro'),
    textLine(`${appointment.expected_duration} min`)
  );

  const schedule = document.createElement('div');
  schedule.className = 'appointment-schedule';
  schedule.append(
    textLine(`Profissional vera: ${formatDateTimeInTimezone(appointment.scheduled_start, appointment.clinic_timezone)} (${appointment.clinic_timezone})`),
    textLine(`Paciente vera: ${formatDateTimeInTimezone(appointment.scheduled_start, appointment.patient_timezone_snapshot)} (${appointment.patient_timezone_snapshot})`)
  );

  const relations = createAppointmentRelations(appointment);
  const badge = document.createElement('span');
  badge.className = `appointment-badge appointment-${appointment.status}`;
  badge.textContent = APPOINTMENT_STATUS_LABELS[appointment.status] || appointment.status;
  main.append(patient, meta, schedule, relations, badge);

  item.append(time, main, createActions(appointment));
  return item;
}

function createActions(appointment) {
  const actions = document.createElement('div');
  actions.className = 'appointment-actions';
  const visibleActions = getVisibleAppointmentActions(appointment);

  visibleActions.primary.forEach((action) => {
    if (action.kind === 'link') {
      addLinkAction(actions, action.label, action.href, action.permission);
      return;
    }
    addAction(actions, action.label, action.handler, action.permission, action.variant);
  });

  if (visibleActions.secondary.length) {
    addMoreActions(actions, appointment, visibleActions.secondary);
  }

  if (appointment.rescheduled_to_appointment_id) {
    addAction(actions, 'Abrir nova sessao', () => scrollToAppointment(appointment.rescheduled_to_appointment_id), PERMISSIONS.APPOINTMENTS_READ, 'secondary');
  }

  return actions;
}

function addAction(container, label, handler, permission, variant = 'secondary') {
  if (!hasPermission(profile, permission)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = variant === 'primary' ? 'button button-sm' : 'button button-secondary button-sm';
  button.textContent = label;
  button.addEventListener('click', handler);
  container.appendChild(button);
}

function addLinkAction(container, label, href, permission) {
  if (!hasPermission(profile, permission)) return;
  const link = document.createElement('a');
  link.className = 'button button-secondary button-sm';
  link.href = href;
  link.textContent = label;
  container.appendChild(link);
}

function addMoreActions(container, appointment, actions) {
  const wrapper = document.createElement('div');
  wrapper.className = 'more-actions';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-secondary button-sm';
  button.textContent = 'Mais acoes';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'appointment-action-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');

  actions.forEach((action) => {
    if (!hasPermission(profile, action.permission)) return;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'button button-secondary button-sm';
    item.textContent = action.label;
    item.setAttribute('role', 'menuitem');
    item.addEventListener('click', async () => {
      closeActionsMenu();
      await action.handler();
    });
    menu.appendChild(item);
  });

  if (!menu.children.length) return;

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleActionsMenu(menu, button);
  });

  wrapper.append(button, menu);
  container.appendChild(wrapper);
}

function editAppointment(appointment) {
  editingAppointment = appointment;
  const form = document.querySelector('[data-appointment-form]');
  form.patient_id.value = appointment.patient_id;
  form.professional_id.value = appointment.professional_id;
  form.modality.value = appointment.modality || 'presential';
  form.appointment_date.value = toLocalDateInput(appointment.scheduled_start, appointment.clinic_timezone);
  form.start_time.value = toLocalTimeInput(appointment.scheduled_start, appointment.clinic_timezone);
  form.expected_duration.value = appointment.expected_duration || 50;
  form.clinic_timezone.value = appointment.clinic_timezone || profile.clinics?.timezone || 'Europe/Lisbon';
  form.patient_timezone_snapshot.value = appointment.patient_timezone_snapshot || 'Europe/Lisbon';
  form.meeting_url.value = appointment.meeting_url || '';
  form.room.value = appointment.room || '';
  form.public_notes.value = appointment.public_notes || '';
  form.internal_notes.value = appointment.internal_notes || '';
  toggleMeetingRequirement();
  openModal(document.querySelector('[data-appointment-modal]'));
}

function openRescheduleForm(appointment) {
  reschedulingAppointment = appointment;
  const form = document.querySelector('[data-reschedule-form]');
  form.reset();
  form.patient_name.value = appointment.patients?.full_name || 'Paciente';
  form.professional_id.value = appointment.professional_id;
  form.modality.value = appointment.modality || 'presential';
  form.appointment_date.value = toLocalDateInput(appointment.scheduled_start, appointment.clinic_timezone);
  form.start_time.value = toLocalTimeInput(appointment.scheduled_start, appointment.clinic_timezone);
  form.expected_duration.value = appointment.expected_duration || 50;
  form.clinic_timezone.value = appointment.clinic_timezone || profile.clinics?.timezone || 'Europe/Lisbon';
  form.patient_timezone_snapshot.value = appointment.patient_timezone_snapshot || 'Europe/Lisbon';
  form.meeting_url.value = appointment.meeting_url || '';
  form.room.value = appointment.room || '';
  form.public_notes.value = appointment.public_notes || '';
  form.internal_notes.value = appointment.internal_notes || '';
  form.reason.value = '';
  toggleRescheduleMeetingRequirement();
  clearMessage(document.querySelector('[data-reschedule-message]'));
  openModal(document.querySelector('[data-reschedule-modal]'));
}

function closeRescheduleModal() {
  reschedulingAppointment = null;
  rescheduleSaving = false;
  closeModal(document.querySelector('[data-reschedule-modal]'));
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
    expected_duration: Number(form.expected_duration.value),
    clinic_timezone: form.clinic_timezone.value.trim(),
    patient_timezone_snapshot: form.patient_timezone_snapshot.value.trim(),
    modality: form.modality.value,
    meeting_url: form.meeting_url.value.trim() || null,
    room: form.room.value.trim() || null,
    public_notes: form.public_notes.value.trim() || null,
    internal_notes: form.internal_notes.value.trim() || null
  };

  if (!payload.patient_id || !payload.professional_id || !payload.appointment_date || !payload.start_time || !payload.expected_duration) {
    showMessage(message, 'Preencha paciente, profissional, data, hora e duracao.', 'error');
    return;
  }

  if (payload.modality === 'online' && !payload.meeting_url) {
    showMessage(message, 'Informe o link da sessao online.', 'error');
    return;
  }

  try {
    if (editingAppointment) {
      await updateAppointment(editingAppointment.id, payload);
    } else {
      await createAppointment(profile.clinic_id, profile.id, payload);
    }

    closeModal(document.querySelector('[data-appointment-modal]'));
    await loadAppointments();
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel guardar a consulta.', 'error');
  }
}

async function saveReschedule(event) {
  event.preventDefault();
  if (rescheduleSaving || !reschedulingAppointment) return;

  const form = event.currentTarget;
  const message = document.querySelector('[data-reschedule-message]');
  const submit = document.querySelector('[data-submit-reschedule]');
  clearMessage(message);

  const payload = {
    professional_id: form.professional_id.value,
    appointment_date: form.appointment_date.value,
    start_time: form.start_time.value,
    expected_duration: Number(form.expected_duration.value),
    modality: form.modality.value,
    meeting_url: form.meeting_url.value.trim() || null,
    room: form.room.value.trim() || null,
    public_notes: form.public_notes.value.trim() || null,
    internal_notes: form.internal_notes.value.trim() || null,
    reason: form.reason.value.trim()
  };

  if (!payload.professional_id || !payload.appointment_date || !payload.start_time || !payload.expected_duration) {
    showMessage(message, 'Preencha profissional, data, hora e duracao.', 'error');
    return;
  }

  if (payload.modality === 'online' && !payload.meeting_url) {
    showMessage(message, 'Informe o link da sessao online.', 'error');
    return;
  }

  if (!payload.reason) {
    showMessage(message, 'Informe o motivo da remarcacao.', 'error');
    return;
  }

  try {
    rescheduleSaving = true;
    submit.disabled = true;
    submit.textContent = 'A reagendar...';
    await rescheduleAppointment(reschedulingAppointment.id, payload);
    closeRescheduleModal();
    await loadAppointments();
    showMessage(document.querySelector('[data-page-message]'), 'Sessao reagendada com sucesso.', 'success');
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel reagendar a sessao.', 'error');
  } finally {
    rescheduleSaving = false;
    submit.disabled = false;
    submit.textContent = 'Confirmar reagendamento';
  }
}

async function changeAppointmentStatus(appointment, status) {
  try {
    await updateAppointmentStatus(appointment.id, status);
    await loadAppointments();
  } catch (error) {
    showMessage(document.querySelector('[data-page-message]'), 'Nao foi possivel alterar o estado da consulta.', 'error');
  }
}

async function checkInFromSchedule(appointment) {
  if (appointment.status === 'scheduled') {
    await updateAppointmentStatus(appointment.id, 'confirmed');
  }
  await updateAppointmentStatus(appointment.id, 'checked_in');
  await loadAppointments();
}

function fillSelect(select, rows, placeholder) {
  if (!select) return;
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

function setSelectPlaceholder(select, label) {
  if (!select) return;
  clearChildren(select);
  const option = document.createElement('option');
  option.value = '';
  option.textContent = label;
  select.appendChild(option);
}

function setAppointmentFormLoading(isLoading) {
  const form = document.querySelector('[data-appointment-form]');
  if (!form) return;
  const patientSelect = form.patient_id;
  const professionalSelect = form.professional_id;
  if (isLoading) {
    setSelectPlaceholder(patientSelect, 'A carregar pacientes...');
    setSelectPlaceholder(professionalSelect, 'A carregar profissionais...');
  }
  patientSelect.disabled = isLoading;
  professionalSelect.disabled = isLoading;
  updateAppointmentFormAvailability();
}

function updateAppointmentFormAvailability(messageText = '') {
  const form = document.querySelector('[data-appointment-form]');
  if (!form) return;
  const submit = form.querySelector('button[type="submit"]');
  const message = document.querySelector('[data-form-message]');
  const hasPatients = patients.length > 0;
  const hasProfessionals = professionals.length > 0;
  const ready = !baseDataLoading && hasPatients && hasProfessionals;

  submit.disabled = !ready;
  form.patient_id.disabled = baseDataLoading || !hasPatients;
  form.professional_id.disabled = baseDataLoading || !hasProfessionals;

  if (messageText) {
    showMessage(message, messageText, 'error');
    return;
  }

  if (baseDataError) {
    showMessage(message, baseDataError, 'error');
    return;
  }

  if (!baseDataLoading && !hasPatients) {
    showMessage(message, 'Nenhum paciente disponivel para agendamento nesta clinica.', 'warning');
    return;
  }

  if (!baseDataLoading && !hasProfessionals) {
    showMessage(message, 'Nenhum profissional ativo disponivel para agendamento nesta clinica.', 'warning');
    return;
  }

  if (!baseDataLoading) clearMessage(message);
}

function sanitizeLoadError(error) {
  const text = String(error?.message || 'Nao foi possivel carregar pacientes e profissionais.');
  return text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]');
}

function fillTimezoneOptions() {
  const datalist = document.querySelector('[data-timezone-options]');
  clearChildren(datalist);
  COMMON_TIMEZONES.forEach((timezone) => {
    const option = document.createElement('option');
    option.value = timezone;
    datalist.appendChild(option);
  });
}

function updatePatientTimezone(event) {
  const patient = patients.find((item) => item.id === event.currentTarget.value);
  const field = document.querySelector('[name="patient_timezone_snapshot"]');
  if (field && patient) field.value = patient.timezone || profile.clinics?.timezone || 'Europe/Lisbon';
}

function toggleMeetingRequirement() {
  const form = document.querySelector('[data-appointment-form]');
  form.meeting_url.required = form.modality.value === 'online';
}

function toggleRescheduleMeetingRequirement() {
  const form = document.querySelector('[data-reschedule-form]');
  form.meeting_url.required = form.modality.value === 'online';
}

function isAllowedStatusAction(current, next) {
  const transitions = {
    scheduled: ['confirmed', 'cancelled_by_patient', 'cancelled_by_clinic', 'no_show'],
    confirmed: ['checked_in', 'cancelled_by_patient', 'cancelled_by_clinic', 'no_show'],
    checked_in: ['in_progress'],
    in_progress: ['completed'],
    completed: ['archived']
  };
  return transitions[current]?.includes(next);
}

function isOperationalAppointment(appointment) {
  return OPERATIONAL_STATUSES.includes(appointment.status);
}

function isHistoricalAppointment(appointment) {
  return HISTORICAL_STATUSES.includes(appointment.status);
}

function isVisibleAppointment(appointment) {
  const group = currentFilters.statusGroup || 'active';
  const showHistory = currentFilters.showHistory;
  if (group === 'active' && !showHistory) return isOperationalAppointment(appointment);
  return true;
}

function getSelectedStatuses() {
  const group = currentFilters.statusGroup || 'active';
  const showHistory = currentFilters.showHistory;
  if (group === 'active' && showHistory) return STATUS_GROUPS.all;
  return STATUS_GROUPS[group] || [group];
}

function getActiveFilterChips() {
  const defaults = defaultFilters();
  const chips = [];

  if (currentFilters.from !== defaults.from || currentFilters.to !== defaults.to) {
    const label = currentFilters.from === currentFilters.to
      ? formatDate(currentFilters.from)
      : `${formatDate(currentFilters.from)} - ${formatDate(currentFilters.to)}`;
    chips.push({
      label,
      remove: () => {
        currentFilters.from = defaults.from;
        currentFilters.to = defaults.to;
      }
    });
  }

  if (currentFilters.professionalId) {
    const professional = professionals.find((item) => item.id === currentFilters.professionalId);
    chips.push({
      label: professional?.full_name || 'Profissional',
      remove: () => {
        currentFilters.professionalId = '';
      }
    });
  }

  if (currentFilters.patientId) {
    const patient = patients.find((item) => item.id === currentFilters.patientId);
    chips.push({
      label: patient?.full_name || 'Paciente',
      remove: () => {
        currentFilters.patientId = '';
      }
    });
  }

  if (currentFilters.statusGroup !== defaults.statusGroup || currentFilters.showHistory) {
    chips.push({
      label: statusGroupLabel(currentFilters.statusGroup, currentFilters.showHistory),
      remove: () => {
        currentFilters.statusGroup = defaults.statusGroup;
        currentFilters.showHistory = defaults.showHistory;
      }
    });
  }

  return chips;
}

function statusGroupLabel(group, showHistory) {
  const labels = {
    active: showHistory ? 'Ativas + historico' : 'Ativas',
    scheduled: 'Agendadas',
    confirmed: 'Confirmadas',
    checked_in: 'Aguardando atendimento',
    in_progress: 'Em atendimento',
    completed: 'Concluidas',
    rescheduled: 'Remarcadas',
    cancelled: 'Canceladas',
    no_show: 'Nao compareceram',
    all: 'Todas'
  };
  return labels[group] || group;
}

function getVisibleAppointmentActions(appointment) {
  const record = {
    kind: 'link',
    label: 'Abrir prontuario',
    href: `paciente-detalhes.html?id=${appointment.patient_id}`,
    permission: PERMISSIONS.APPOINTMENTS_READ
  };

  if (appointment.status === 'rescheduled') return { primary: [], secondary: [] };

  if (appointment.status === 'scheduled') {
    return {
      primary: [
        statusAction(appointment, 'confirmed', 'Confirmar', PERMISSIONS.APPOINTMENTS_UPDATE),
        { label: 'Reagendar', handler: () => openRescheduleForm(appointment), permission: PERMISSIONS.APPOINTMENTS_UPDATE, variant: 'primary' },
        { label: 'Paciente chegou', handler: () => checkInFromSchedule(appointment), permission: PERMISSIONS.APPOINTMENTS_UPDATE, variant: 'primary' },
        record
      ],
      secondary: secondaryStatusActions(appointment)
    };
  }

  if (appointment.status === 'confirmed') {
    return {
      primary: [
        statusAction(appointment, 'checked_in', 'Paciente chegou', PERMISSIONS.APPOINTMENTS_UPDATE),
        { label: 'Reagendar', handler: () => openRescheduleForm(appointment), permission: PERMISSIONS.APPOINTMENTS_UPDATE, variant: 'primary' },
        record
      ],
      secondary: secondaryStatusActions(appointment)
    };
  }

  if (appointment.status === 'checked_in') {
    return {
      primary: [
        statusAction(appointment, 'in_progress', 'Iniciar atendimento', PERMISSIONS.APPOINTMENTS_UPDATE),
        record
      ],
      secondary: []
    };
  }

  if (appointment.status === 'in_progress') {
    return {
      primary: [
        statusAction(appointment, 'completed', 'Concluir atendimento', PERMISSIONS.APPOINTMENTS_COMPLETE),
        record
      ],
      secondary: []
    };
  }

  if (appointment.status === 'completed') {
    return {
      primary: [
        statusAction(appointment, 'archived', 'Arquivar', PERMISSIONS.APPOINTMENTS_UPDATE),
        record
      ],
      secondary: []
    };
  }

  return { primary: [record], secondary: [] };
}

function statusAction(appointment, status, label, permission) {
  return {
    label,
    permission,
    variant: 'primary',
    handler: () => changeAppointmentStatus(appointment, status)
  };
}

function secondaryStatusActions(appointment) {
  return [
    statusAction(appointment, 'cancelled_by_patient', 'Cancelar pelo paciente', PERMISSIONS.APPOINTMENTS_CANCEL),
    statusAction(appointment, 'cancelled_by_clinic', 'Cancelar pela clinica', PERMISSIONS.APPOINTMENTS_CANCEL),
    statusAction(appointment, 'no_show', 'Nao compareceu', PERMISSIONS.APPOINTMENTS_CANCEL)
  ];
}

function createAppointmentRelations(appointment) {
  const container = document.createElement('div');
  container.className = 'appointment-relations';

  if (appointment.rescheduled_to?.scheduled_start) {
    container.appendChild(textLine(`Remarcada para ${formatDateTimeInTimezone(
      appointment.rescheduled_to.scheduled_start,
      appointment.rescheduled_to.clinic_timezone || appointment.clinic_timezone
    )}`));
  }

  if (appointment.rescheduled_from?.scheduled_start) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'text-link';
    link.textContent = `Ver sessao anterior (${formatDateTimeInTimezone(
      appointment.rescheduled_from.scheduled_start,
      appointment.rescheduled_from.clinic_timezone || appointment.clinic_timezone
    )})`;
    link.addEventListener('click', () => scrollToAppointment(appointment.rescheduled_from_appointment_id));
    container.appendChild(link);
  }

  if (appointment.reschedule_reason) {
    container.appendChild(textLine(`Motivo: ${appointment.reschedule_reason}`));
  }

  return container;
}

function toggleActionsMenu(menu, button) {
  if (openActionsMenu && openActionsMenu !== menu) closeActionsMenu();
  const nextState = menu.hidden;
  menu.hidden = !nextState;
  button.setAttribute('aria-expanded', String(nextState));
  openActionsMenu = nextState ? menu : null;
}

function closeActionsMenu() {
  if (!openActionsMenu) return;
  const button = openActionsMenu.parentElement?.querySelector('[aria-expanded]');
  openActionsMenu.hidden = true;
  button?.setAttribute('aria-expanded', 'false');
  openActionsMenu = null;
}

function closeActionsMenuOnOutsideClick(event) {
  if (!openActionsMenu) return;
  if (openActionsMenu.parentElement?.contains(event.target)) return;
  closeActionsMenu();
}

function scrollToAppointment(appointmentId) {
  const target = document.querySelector(`[data-appointment-id="${appointmentId}"]`);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('is-highlighted');
  window.setTimeout(() => target.classList.remove('is-highlighted'), 1600);
}

function textLine(value) {
  const span = document.createElement('span');
  span.textContent = value;
  return span;
}

function renderDayAgenda() {
  const container = document.querySelector('[data-day-agenda]');
  clearChildren(container);
  const today = todayDateInput();
  document.querySelector('[data-today-label]').textContent = formatDate(today);
  const todayItems = todayAppointments
    .filter(isOperationalAppointment)
    .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start))
    .slice(0, 5);

  if (!todayItems.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Nenhuma sessao hoje.';
    container.appendChild(empty);
    return;
  }

  todayItems.forEach((appointment) => {
    const link = document.createElement('a');
    link.className = 'agenda-day-slot';
    link.href = `paciente-detalhes.html?id=${appointment.patient_id}`;

    const time = document.createElement('strong');
    time.textContent = formatTimeInTimezone(appointment.scheduled_start, appointment.clinic_timezone);
    const main = document.createElement('span');
    main.className = 'agenda-day-main';
    const label = document.createElement('span');
    label.textContent = appointment.patients?.full_name || 'Livre';
    const modality = document.createElement('span');
    modality.textContent = APPOINTMENT_MODALITY_LABELS[appointment.modality] || '-';
    main.append(label, modality);
    const status = document.createElement('span');
    status.className = 'agenda-day-status';
    status.textContent = APPOINTMENT_STATUS_LABELS[appointment.status] || appointment.status;

    link.append(time, main, status);
    container.appendChild(link);
  });
}
