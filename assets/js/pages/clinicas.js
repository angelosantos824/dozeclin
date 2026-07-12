import { PERMISSIONS, hasPermission } from '../auth/permissions.js';
import { requirePlatformSuperAdmin, requireProductAccess } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { appendEmptyRow, clearChildren, createCell } from '../ui/table.js';
import { closeModal, openModal } from '../ui/modal.js';
import { clearMessage, showMessage } from '../ui/messages.js';
import {
  CLINIC_PLAN_LABELS,
  CLINIC_SPECIALTY_LABELS,
  CLINIC_STATUS_LABELS
} from '../config/constants.js';
import {
  cancelClinic,
  createClinicAdminAccess,
  createClinicWithAdmin,
  listClinics,
  reactivateClinic,
  resetClinicAdminTemporaryPassword,
  suspendClinic
} from '../services/clinics.service.js';

let profile = await requirePlatformSuperAdmin();
let clinics = [];
let latestAccessData = null;

if (profile) {
  profile = await requireProductAccess('dozeclin');
  if (profile) {
    mountLayout(profile);
    bindEvents();
    await loadClinics();
  }
}

function bindEvents() {
  document.querySelector('[data-new-clinic]')?.addEventListener('click', () => {
    if (!hasPermission(profile, PERMISSIONS.CLINICS_CREATE)) return;

    const form = document.querySelector('[data-clinic-form]');
    form.reset();
    form.country.value = 'Portugal';
    form.timezone.value = 'Europe/Lisbon';
    form.default_currency.value = 'EUR';
    form.primary_color.value = '#7c3aed';
    form.secondary_color.value = '#a855f7';
    clearMessage(document.querySelector('[data-form-message]'));
    openModal(document.querySelector('[data-clinic-modal]'));
  });

  document.querySelector('[data-close-modal]')?.addEventListener('click', () => {
    closeModal(document.querySelector('[data-clinic-modal]'));
  });

  document.querySelector('[data-clinic-form]')?.addEventListener('submit', createClinic);
  document.querySelector('[data-close-access-modal]')?.addEventListener('click', closeAccessModal);
  document.querySelector('[data-copy-access]')?.addEventListener('click', copyAccessData);
  document.querySelector('[data-clinic-form] input[name="name"]')?.addEventListener('input', syncSlug);
  document.querySelector('[data-filter]')?.addEventListener('input', renderTable);
  document.querySelector('[data-status-filter]')?.addEventListener('change', loadClinics);
  document.querySelector('[data-plan-filter]')?.addEventListener('change', loadClinics);
}

async function loadClinics() {
  const message = document.querySelector('[data-page-message]');
  showMessage(message, 'A carregar clinicas...', 'info');

  try {
    clinics = await listClinics({
      status: document.querySelector('[data-status-filter]')?.value || '',
      planCode: document.querySelector('[data-plan-filter]')?.value || ''
    });
    renderMetrics();
    renderTable();
    showMessage(message, `${clinics.length} clinica(s) encontradas.`, 'success');
  } catch (error) {
    console.error(error);
    showMessage(message, 'Nao foi possivel carregar as clinicas.', 'error');
  }
}

function renderMetrics() {
  setMetric('total', clinics.length);
  setMetric('active', clinics.filter((clinic) => clinic.status === 'active').length);
  setMetric('suspended', clinics.filter((clinic) => clinic.status === 'suspended').length);
  setMetric('trial', clinics.filter((clinic) => clinic.status === 'trial').length);
  setMetric('cancelled', clinics.filter((clinic) => clinic.status === 'cancelled').length);
}

function setMetric(name, value) {
  const element = document.querySelector(`[data-metric-${name}]`);
  if (element) element.textContent = value;
}

function renderTable() {
  const tbody = document.querySelector('[data-clinics-table]');
  const textFilter = String(document.querySelector('[data-filter]')?.value || '').toLowerCase();
  clearChildren(tbody);

  const filtered = clinics.filter((clinic) => {
    return [
      clinic.name,
      clinic.legal_name,
      clinic.document,
      clinic.email,
      clinic.city,
      clinic.owner?.full_name,
      clinic.owner?.email
    ].some((value) => String(value || '').toLowerCase().includes(textFilter));
  });

  if (!filtered.length) {
    appendEmptyRow(tbody, 6, 'Nenhuma clinica encontrada.');
    return;
  }

  filtered.forEach((clinic) => {
    const row = document.createElement('tr');
    row.append(
      createClinicCell(clinic),
      createAdminCell(clinic),
      createPlanCell(clinic),
      createStatusCell(clinic),
      createUsersCell(clinic),
      createActionsCell(clinic)
    );
    tbody.appendChild(row);
  });
}

function createClinicCell(clinic) {
  const cell = document.createElement('td');
  const name = document.createElement('strong');
  name.textContent = clinic.name;
  const details = document.createElement('small');
  details.className = 'muted';
  details.textContent = [CLINIC_SPECIALTY_LABELS[clinic.specialty], clinic.city, clinic.email, `Criada em ${formatDate(clinic.created_at)}`]
    .filter(Boolean)
    .join(' · ');
  cell.append(name, details);
  return cell;
}

function createAdminCell(clinic) {
  const cell = document.createElement('td');
  const name = document.createElement('div');
  name.textContent = clinic.owner?.full_name || 'Administrador pendente';
  const email = document.createElement('small');
  email.className = 'muted';
  email.textContent = clinic.owner?.email || 'Associacao Auth pendente';
  cell.append(name, email);
  return cell;
}

function createPlanCell(clinic) {
  const cell = document.createElement('td');
  const plan = document.createElement('div');
  plan.textContent = CLINIC_PLAN_LABELS[clinic.plan_code] || clinic.plan_code || '-';
  const since = document.createElement('small');
  since.className = 'muted';
  since.textContent = clinic.activated_at ? `Desde ${formatDate(clinic.activated_at)}` : 'Sem ativacao';
  cell.append(plan, since);
  return cell;
}

function createStatusCell(clinic) {
  const cell = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `status-badge status-${clinic.status}`;
  badge.textContent = CLINIC_STATUS_LABELS[clinic.status] || clinic.status;
  cell.appendChild(badge);

  if (clinic.suspension_reason) {
    const reason = document.createElement('small');
    reason.className = 'muted';
    reason.textContent = clinic.suspension_reason;
    cell.appendChild(reason);
  }

  return cell;
}

function createUsersCell(clinic) {
  const cell = document.createElement('td');
  if (clinic.active_users_count === null || clinic.users_count === null) {
    cell.textContent = 'Restrito';
    return cell;
  }

  cell.textContent = `${clinic.active_users_count || 0}/${clinic.users_count || 0} ativos`;
  return cell;
}

function createActionsCell(clinic) {
  const cell = document.createElement('td');
  cell.className = 'table-actions';

  if (!hasPermission(profile, PERMISSIONS.CLINICS_UPDATE)) {
    cell.textContent = '-';
    return cell;
  }

  if (clinic.status === 'suspended') {
    cell.appendChild(actionButton('Reativar', () => changeClinicStatus(clinic, 'active')));
  }

  if (clinic.status !== 'suspended' && clinic.status !== 'cancelled') {
    cell.appendChild(actionButton('Suspender', () => changeClinicStatus(clinic, 'suspended'), 'danger'));
  }

  if (clinic.status !== 'cancelled') {
    cell.appendChild(actionButton('Cancelar', () => changeClinicStatus(clinic, 'cancelled'), 'danger'));
  }

  if (clinic.owner?.status === 'pending_invite') {
    cell.appendChild(actionButton('Criar acesso inicial', (event) => createInitialAccess(clinic, event.currentTarget)));
  }

  if (clinic.owner?.status === 'active') {
    cell.appendChild(actionButton('Gerar nova senha temporaria', (event) => resetTemporaryPassword(clinic, event.currentTarget)));
  }

  return cell;
}

function actionButton(label, handler, variant = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = variant ? `icon-button ${variant}` : 'icon-button';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

async function createInitialAccess(clinic, button) {
  if (!window.confirm('Criar acesso inicial para o administrador desta clinica?')) return;

  try {
    button.disabled = true;
    const accessData = await createClinicAdminAccess(clinic.owner.id);
    showAccessModal(accessData);
    await loadClinics();
  } catch (error) {
    console.error('Falha ao criar acesso inicial.', error);
    showMessage(document.querySelector('[data-page-message]'), 'Nao foi possivel criar o acesso inicial.', 'error');
  } finally {
    button.disabled = false;
  }
}

async function resetTemporaryPassword(clinic, button) {
  if (!window.confirm('Gerar nova senha temporaria para este administrador?')) return;

  try {
    button.disabled = true;
    const accessData = await resetClinicAdminTemporaryPassword(clinic.owner.id);
    showAccessModal(accessData);
    await loadClinics();
  } catch (error) {
    console.error('Falha ao gerar nova senha temporaria.', error);
    showMessage(document.querySelector('[data-page-message]'), 'Nao foi possivel gerar a senha temporaria.', 'error');
  } finally {
    button.disabled = false;
  }
}

function showAccessModal(accessData) {
  latestAccessData = accessData;
  document.querySelector('[data-access-clinic]').textContent = accessData.clinic_name || '-';
  document.querySelector('[data-access-admin]').textContent = accessData.admin_name || '-';
  document.querySelector('[data-access-email]').textContent = accessData.email || '-';
  document.querySelector('[data-access-password]').textContent = accessData.temporary_password || '-';
  openModal(document.querySelector('[data-access-modal]'));
}

function closeAccessModal() {
  latestAccessData = null;
  document.querySelector('[data-access-password]').textContent = '';
  closeModal(document.querySelector('[data-access-modal]'));
}

async function copyAccessData() {
  if (!latestAccessData) return;
  const text = [
    'Sistema: DOZECLIN',
    `Endereco de acesso: ${window.location.origin}${window.location.pathname.replace(/clinicas\.html$/, 'login.html')}`,
    `Email: ${latestAccessData.email}`,
    `Senha temporaria: ${latestAccessData.temporary_password}`,
    'Aviso: no primeiro acesso sera obrigatorio criar uma nova senha.'
  ].join('\n');

  await navigator.clipboard.writeText(text);
  showMessage(document.querySelector('[data-page-message]'), 'Dados de acesso copiados.', 'success');
}

async function createClinic(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const message = document.querySelector('[data-form-message]');
  clearMessage(message);

  const payload = Object.fromEntries(new FormData(form).entries());
  payload.slug = normalizeSlug(payload.slug || payload.name);

  if (!payload.name || !payload.email || !payload.slug || !payload.admin_full_name || !payload.admin_email) {
    showMessage(message, 'Nome, email, slug e administrador sao obrigatorios.', 'error');
    return;
  }

  try {
    if (submit) submit.disabled = true;
    await createClinicWithAdmin(payload);
    closeModal(document.querySelector('[data-clinic-modal]'));
    await loadClinics();
    showMessage(
      document.querySelector('[data-page-message]'),
      'Clinica criada. Crie o utilizador Auth manualmente e associe-o ao perfil pendente.',
      'success'
    );
  } catch (error) {
    console.error(error);
    showMessage(message, error.message || 'Nao foi possivel criar a clinica.', 'error');
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function changeClinicStatus(clinic, status) {
  let reason = null;

  if (status === 'suspended') {
    reason = window.prompt('Motivo da suspensao');
  }

  if (status === 'cancelled') {
    reason = window.prompt('Motivo do cancelamento');
  }

  if ((status === 'suspended' || status === 'cancelled') && !String(reason || '').trim()) {
    showMessage(document.querySelector('[data-page-message]'), 'Informe o motivo da alteracao.', 'warning');
    return;
  }

  try {
    if (status === 'suspended') await suspendClinic(clinic.id, reason);
    if (status === 'active') await reactivateClinic(clinic.id);
    if (status === 'cancelled') await cancelClinic(clinic.id, reason);
    await loadClinics();
  } catch (error) {
    console.error(error);
    showMessage(document.querySelector('[data-page-message]'), 'Nao foi possivel alterar o estado da clinica.', 'error');
  }
}

function syncSlug(event) {
  const form = document.querySelector('[data-clinic-form]');
  if (!form?.slug || form.slug.dataset.touched === 'true') return;
  form.slug.value = normalizeSlug(event.target.value);
}

document.querySelector('[data-clinic-form] input[name="slug"]')?.addEventListener('input', (event) => {
  event.currentTarget.dataset.touched = 'true';
  event.currentTarget.value = normalizeSlug(event.currentTarget.value);
});

function normalizeSlug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-PT').format(new Date(value));
}
