import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { countPatientsByStatus } from '../services/patients.service.js';
import { countUpcomingAppointments } from '../services/appointments.service.js';

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
    const [patientsSummary, appointmentsCount] = await Promise.all([
      countPatientsByStatus(clinicId),
      countUpcomingAppointments(clinicId)
    ]);

    setMetric('metric-patients', patientsSummary.total);
    setMetric('metric-active', patientsSummary.active);
    setMetric('metric-appointments', appointmentsCount);
    setMetric('metric-clinic', profile.clinics?.status === 'trial' ? 'Teste' : 'Ativa');

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
