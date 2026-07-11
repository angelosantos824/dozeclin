import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { countPatientsByStatus } from '../services/patients.service.js';
import { getDashboardAppointmentSummary } from '../services/appointments.service.js';
import { APPOINTMENT_STATUS_LABELS } from '../config/constants.js';
import { formatDate, formatTime } from '../ui/formatters.js';
import { clearChildren } from '../ui/table.js';

const profile = await protectPage();

if (profile) {
  mountLayout(profile);
  await loadDashboard(profile);
}

async function loadDashboard(profile) {
  const clinicId = profile.clinic_id;
  const cards = document.querySelector('[data-dashboard-cards]');
  const status = document.querySelector('[data-dashboard-status]');

  try {
    const [patientsSummary, appointmentSummary] = await Promise.all([
      countPatientsByStatus(clinicId),
      getDashboardAppointmentSummary(clinicId)
    ]);

    setMetric('metric-patients', patientsSummary.total);
    setMetric('metric-active', patientsSummary.active);
    setMetric('metric-appointments', appointmentSummary.upcoming);
    setMetric('metric-today', appointmentSummary.today);
    setMetric('metric-confirmed-today', appointmentSummary.confirmedToday);
    setMetric('metric-clinic', profile.clinics?.status === 'trial' ? 'Teste' : 'Ativa');
    renderNextAppointments(appointmentSummary.next);

    status.textContent = 'Dados carregados da clinica autenticada.';
    cards.hidden = false;
  } catch (error) {
    status.textContent = 'Nao foi possivel carregar o painel. Verifique Supabase, migrations e RLS.';
  }
}

function setMetric(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value);
}

function renderNextAppointments(appointments) {
  const container = document.querySelector('[data-next-appointments]');
  clearChildren(container);

  if (!appointments.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Nenhuma consulta futura encontrada.';
    container.appendChild(empty);
    return;
  }

  appointments.forEach((appointment) => {
    const item = document.createElement('article');
    item.className = 'appointment-item';

    const time = document.createElement('div');
    time.className = 'appointment-time';
    time.textContent = formatTime(appointment.start_time);

    const main = document.createElement('div');
    main.className = 'appointment-main';
    const title = document.createElement('strong');
    title.textContent = appointment.patients?.full_name || 'Paciente';
    const meta = document.createElement('span');
    meta.className = 'appointment-meta';
    meta.textContent = `${formatDate(appointment.appointment_date)} | ${appointment.professional?.full_name || 'Profissional'}`;
    main.append(title, meta);

    const badge = document.createElement('span');
    badge.className = `appointment-badge appointment-${appointment.status}`;
    badge.textContent = APPOINTMENT_STATUS_LABELS[appointment.status] || appointment.status;

    item.append(time, main, badge);
    container.appendChild(item);
  });
}
