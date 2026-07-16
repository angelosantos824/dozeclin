import { protectPage } from '../auth/guards.js';
import { PERMISSIONS, hasPermission } from '../auth/permissions.js';
import { mountLayout } from '../ui/layout.js';
import { countPatientsByStatus } from '../services/patients.service.js';
import { getDashboardAppointmentSummary, listAppointments } from '../services/appointments.service.js';
import { getPatientJourneySummary } from '../services/patient-requests.service.js';
import { getFinancialDashboardSummary } from '../services/financial.service.js';
import { APPOINTMENT_MODALITY_LABELS, APPOINTMENT_STATUS_LABELS } from '../config/constants.js';
import { formatCurrency, formatTimeInTimezone, todayDateInput } from '../ui/formatters.js';
import { clearChildren } from '../ui/table.js';

const OPERATIONAL_STATUSES = ['scheduled', 'confirmed', 'checked_in', 'in_progress'];

const profile = await protectPage();

if (profile) {
  mountLayout(profile);
  await loadDashboard(profile);
}

async function loadDashboard(profile) {
  const clinicId = profile.clinic_id;
  showLoadingState(true);
  clearDashboardError();

  try {
    const today = todayDateInput();
    const [patientsSummary, appointmentSummary, journeySummary, financialSummary, todayAppointments] = await Promise.all([
      countPatientsByStatus(clinicId),
      getDashboardAppointmentSummary(clinicId),
      getPatientJourneySummary(clinicId),
      hasPermission(profile, PERMISSIONS.FINANCE_READ) ? getFinancialDashboardSummary() : Promise.resolve(null),
      listAppointments(clinicId, { date: today, statuses: OPERATIONAL_STATUSES })
    ]);

    const data = {
      profile,
      patientsSummary,
      appointmentSummary,
      journeySummary,
      financialSummary,
      todayAppointments: todayAppointments.filter(isOperationalAppointment).slice(0, 5)
    };

    renderClinicStatus(profile);
    renderPrimaryMetrics(data);
    renderSecondaryMetrics(data);
    renderTodayAppointments(data.todayAppointments);
    renderRequestsSummary(data);
    renderFinancialSummary(data.financialSummary);
    renderOperationalAlerts(data);
    showDashboardContent();
  } catch (error) {
    showDashboardError('Nao foi possivel carregar o painel. Verifique a conexao e as permissoes.');
  } finally {
    showLoadingState(false);
  }
}

function renderPrimaryMetrics(data) {
  const container = document.querySelector('[data-primary-metrics]');
  clearChildren(container);

  const today = data.todayAppointments.length;
  const confirmed = data.todayAppointments.filter((item) => item.status === 'confirmed').length;
  const waiting = data.todayAppointments.filter((item) => item.status === 'checked_in').length;
  const inProgress = data.todayAppointments.filter((item) => item.status === 'in_progress').length;

  [
    {
      label: 'Sessoes hoje',
      value: today,
      unit: today === 1 ? 'sessao' : 'sessoes',
      detail: today ? `${today} sessao${today === 1 ? '' : 'es'} agendada${today === 1 ? '' : 's'}` : 'Nenhuma sessao agendada',
      action: 'Ver agenda',
      href: 'agenda.html',
      tone: 'today',
      icon: '📅'
    },
    {
      label: 'Confirmadas',
      value: confirmed,
      detail: confirmed ? 'Pacientes confirmados' : 'Nenhuma confirmacao',
      action: 'Abrir agenda',
      href: 'agenda.html',
      tone: 'confirmed',
      icon: '✅'
    },
    {
      label: 'Aguardando',
      value: waiting,
      detail: waiting ? 'Check-in realizado' : 'Nenhum check-in',
      action: 'Ver pacientes',
      href: 'pacientes.html',
      tone: 'waiting',
      icon: '⏳'
    },
    {
      label: 'Em atendimento',
      value: inProgress,
      detail: inProgress ? 'Sessao iniciada' : 'Nenhuma sessao iniciada',
      action: 'Acompanhar agenda',
      href: 'agenda.html',
      tone: 'in-progress',
      icon: '🩺'
    }
  ].forEach((metric) => container.appendChild(createMetricCard(metric, 'primary-metric')));
}

function renderSecondaryMetrics(data) {
  const container = document.querySelector('[data-secondary-metrics]');
  clearChildren(container);
  const { patientsSummary, appointmentSummary } = data;

  const metrics = [
    {
      label: 'Pacientes cadastrados',
      value: patientsSummary.total,
      detail: `${patientsSummary.active || 0} ativos`
    },
    {
      label: 'Sessoes futuras',
      value: appointmentSummary.upcoming,
      detail: 'Agenda operacional'
    },
    {
      label: 'Concluidas',
      value: appointmentSummary.completedToday,
      detail: 'Hoje'
    },
    {
      label: 'Canceladas',
      value: appointmentSummary.cancelledToday,
      detail: 'Hoje',
      tone: 'cancelled'
    },
    {
      label: 'Nao compareceram',
      value: appointmentSummary.noShowToday,
      detail: 'Hoje',
      tone: 'no-show'
    },
    {
      label: 'Online',
      value: appointmentSummary.onlineToday,
      detail: 'Hoje'
    },
    {
      label: 'Presenciais',
      value: appointmentSummary.presentialToday,
      detail: 'Hoje'
    },
    {
      label: 'Tempo medio',
      value: `${appointmentSummary.averageDuration} min`,
      detail: 'Sessoes concluidas'
    },
    {
      label: 'Comparecimento',
      value: `${appointmentSummary.attendanceRate}%`,
      detail: 'Base operacional'
    }
  ];

  metrics.forEach((metric) => container.appendChild(createMetricCard(metric, 'secondary-metric')));
}

function renderTodayAppointments(appointments) {
  const container = document.querySelector('[data-today-appointments]');
  clearChildren(container);

  if (!appointments.length) {
    container.appendChild(emptyState('Nenhuma sessao operacional para hoje.'));
    return;
  }

  appointments.forEach((appointment) => {
    const row = document.createElement('div');
    row.className = 'dashboard-today-row';

    const time = document.createElement('strong');
    time.className = 'dashboard-today-time';
    time.textContent = formatTimeInTimezone(appointment.scheduled_start, appointment.clinic_timezone);

    const main = document.createElement('div');
    main.className = 'dashboard-today-main';
    const patient = document.createElement('strong');
    patient.textContent = appointment.patients?.full_name || 'Paciente';
    const meta = document.createElement('span');
    meta.textContent = APPOINTMENT_MODALITY_LABELS[appointment.modality] || '-';
    main.append(patient, meta);

    const badge = document.createElement('span');
    badge.className = `appointment-badge appointment-${appointment.status}`;
    badge.textContent = APPOINTMENT_STATUS_LABELS[appointment.status] || appointment.status;

    const link = document.createElement('a');
    link.className = 'button button-secondary button-sm';
    link.href = `paciente-detalhes.html?id=${appointment.patient_id}`;
    link.textContent = 'Abrir prontuario';

    row.append(time, main, badge, link);
    container.appendChild(row);
  });
}

function renderRequestsSummary(data) {
  const container = document.querySelector('[data-requests-summary]');
  clearChildren(container);
  const requests = data.journeySummary.requests;

  if (!requests.total) {
    container.appendChild(emptyState('Nenhuma solicitacao nova no momento.'));
    return;
  }

  const headline = document.createElement('p');
  headline.className = 'dashboard-card-detail';
  headline.textContent = `${requests.total} solicitacao${requests.total === 1 ? '' : 'es'} no funil`;

  const grid = document.createElement('div');
  grid.className = 'dashboard-request-grid';
  [
    ['Novas', requests.new],
    ['Em conversa', requests.contacted],
    ['Confirmadas', requests.qualified]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'dashboard-request-item';
    const strong = document.createElement('strong');
    strong.textContent = String(value);
    const span = document.createElement('span');
    span.textContent = label;
    item.append(strong, span);
    grid.appendChild(item);
  });

  container.append(headline, grid);
}

function renderFinancialSummary(financialSummary = {}) {
  const container = document.querySelector('[data-dashboard-financial]');
  clearChildren(container);
  const currencies = financialSummary.currencies || [];

  if (!currencies.length) {
    container.appendChild(emptyState('Sem movimentos financeiros.'));
    return;
  }

  currencies.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'dashboard-financial-row';
    const currency = document.createElement('strong');
    currency.textContent = item.currency;
    const values = document.createElement('span');
    values.textContent = `A receber ${formatCurrency(item.receivable, item.currency)} | Recebido ${formatCurrency(item.received_month, item.currency)} | Atraso ${formatCurrency(item.overdue, item.currency)}`;
    row.append(currency, values);
    container.appendChild(row);
  });
}

function renderOperationalAlerts(data) {
  const panel = document.querySelector('[data-alerts-panel]');
  const container = document.querySelector('[data-operational-alerts]');
  clearChildren(container);

  const alerts = buildOperationalAlerts(data);
  panel.hidden = alerts.length === 0;
  alerts.forEach((alert) => {
    const item = document.createElement('div');
    item.className = 'dashboard-alert';
    item.textContent = alert;
    container.appendChild(item);
  });
}

function renderClinicStatus(profile) {
  const status = document.querySelector('[data-clinic-status]');
  const clinicStatus = profile.clinics?.status || 'active';
  const plan = profile.clinics?.plan || 'Plano';
  status.className = `badge status-${clinicStatus}`;
  status.textContent = clinicStatus === 'trial'
    ? 'Clinica em teste'
    : `${plan} | Estado: ${clinicStatus === 'active' ? 'Ativa' : clinicStatus}`;
}

function buildOperationalAlerts(data) {
  const alerts = [];
  const waiting = data.todayAppointments.filter((item) => item.status === 'checked_in').length;
  const unconfirmed = data.todayAppointments.filter((item) => item.status === 'scheduled').length;
  const onlineWithoutMeeting = data.todayAppointments
    .filter((item) => item.modality === 'online' && !item.meeting_url)
    .length;
  const profilePending = data.journeySummary.onboarding.profile_pending;
  const anamnesisPending = data.journeySummary.onboarding.anamnesis_pending;

  if (waiting) alerts.push(`${waiting} paciente${waiting === 1 ? '' : 's'} aguardando atendimento.`);
  if (unconfirmed) alerts.push(`${unconfirmed} sessao${unconfirmed === 1 ? '' : 'es'} sem confirmacao.`);
  if (profilePending) alerts.push(`${profilePending} cadastro${profilePending === 1 ? '' : 's'} pendente${profilePending === 1 ? '' : 's'}.`);
  if (anamnesisPending) alerts.push(`${anamnesisPending} anamnese${anamnesisPending === 1 ? '' : 's'} pendente${anamnesisPending === 1 ? '' : 's'}.`);
  if (data.profile.clinics?.status === 'trial') alerts.push('Clinica em teste.');
  if (onlineWithoutMeeting) alerts.push(`${onlineWithoutMeeting} sessao${onlineWithoutMeeting === 1 ? '' : 'es'} online sem link de reuniao.`);
  if (data.financialSummary?.completed_without_charge) alerts.push(`${data.financialSummary.completed_without_charge} sessao${data.financialSummary.completed_without_charge === 1 ? '' : 'es'} concluida${data.financialSummary.completed_without_charge === 1 ? '' : 's'} sem cobranca.`);
  if (data.financialSummary?.overdue_charges) alerts.push(`${data.financialSummary.overdue_charges} cobranca${data.financialSummary.overdue_charges === 1 ? '' : 's'} vencida${data.financialSummary.overdue_charges === 1 ? '' : 's'}.`);
  if (data.financialSummary?.partial_charges) alerts.push(`${data.financialSummary.partial_charges} pagamento${data.financialSummary.partial_charges === 1 ? ' parcial' : 's parciais'}.`);

  return alerts;
}

function createMetricCard(metric, className) {
  const card = document.createElement('article');
  card.className = `dashboard-card ${className}${metric.tone ? ` ${metric.tone}` : ''}`;

  if (className === 'primary-metric') {
    const header = document.createElement('div');
    header.className = 'dashboard-card-kpi-header';

    const label = document.createElement('span');
    label.className = 'dashboard-card-label';
    label.textContent = metric.label;

    const icon = document.createElement('span');
    icon.className = 'dashboard-card-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = metric.icon || '•';

    header.append(label, icon);

    const body = document.createElement('div');
    body.className = 'dashboard-card-kpi-body';

    const valueGroup = document.createElement('div');
    valueGroup.className = 'dashboard-card-value-group';

    const value = document.createElement('strong');
    value.className = 'dashboard-card-value';
    value.textContent = String(metric.value);
    valueGroup.appendChild(value);

    if (metric.unit) {
      const unit = document.createElement('span');
      unit.className = 'dashboard-card-unit';
      unit.textContent = metric.unit;
      valueGroup.appendChild(unit);
    }

    const detail = document.createElement('span');
    detail.className = 'dashboard-card-detail';
    detail.textContent = metric.detail;
    body.append(valueGroup, detail);

    card.append(header, body);

    if (metric.action && metric.href) {
      const action = document.createElement('a');
      action.className = 'dashboard-card-action';
      action.href = metric.href;
      action.textContent = metric.action;
      card.appendChild(action);
    }

    return card;
  }

  const label = document.createElement('span');
  label.className = 'dashboard-card-label';
  label.textContent = metric.label;

  const value = document.createElement('strong');
  value.className = 'dashboard-card-value';
  value.textContent = String(metric.value);

  const detail = document.createElement('span');
  detail.className = 'dashboard-card-detail';
  detail.textContent = metric.detail;

  card.append(label, value, detail);

  if (metric.action && metric.href) {
    const action = document.createElement('a');
    action.className = 'dashboard-card-action';
    action.href = metric.href;
    action.textContent = metric.action;
    card.appendChild(action);
  }

  return card;
}

function isOperationalAppointment(appointment) {
  return OPERATIONAL_STATUSES.includes(appointment.status);
}

function emptyState(message) {
  const empty = document.createElement('p');
  empty.className = 'dashboard-empty';
  empty.textContent = message;
  return empty;
}

function showLoadingState(isLoading) {
  document.querySelector('[data-dashboard-skeleton]').hidden = !isLoading;
}

function showDashboardContent() {
  document.querySelector('[data-primary-metrics]').hidden = false;
  document.querySelector('[data-secondary-metrics]').hidden = false;
  document.querySelector('[data-dashboard-operational]').hidden = false;
}

function clearDashboardError() {
  const status = document.querySelector('[data-dashboard-status]');
  status.hidden = true;
  status.className = '';
  status.textContent = '';
}

function showDashboardError(message) {
  const status = document.querySelector('[data-dashboard-status]');
  status.hidden = false;
  status.className = 'dashboard-error';
  status.textContent = message;
}
