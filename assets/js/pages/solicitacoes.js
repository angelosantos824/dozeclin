import { PERMISSIONS } from '../auth/permissions.js';
import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { showMessage, clearMessage } from '../ui/messages.js';
import { clearChildren } from '../ui/table.js';
import { closeModal, openModal } from '../ui/modal.js';
import { formatDateTime } from '../ui/formatters.js';
import {
  buildFirstContactMessage,
  buildWhatsAppUrl,
  listPatientRequests,
  startPatientJourney,
  updatePatientRequestStatus
} from '../services/patient-requests.service.js';
import { PATIENT_REQUEST_STATUS_LABELS } from '../config/constants.js';

let profile = await protectPage(PERMISSIONS.PATIENT_REQUESTS_READ);
let requests = [];
let lastPortalData = null;

if (profile) {
  mountLayout(profile);
  bindEvents();
  await loadRequests();
}

function bindEvents() {
  document.querySelector('[data-filter]')?.addEventListener('input', renderRequests);
  document.querySelector('[data-status-filter]')?.addEventListener('change', loadRequests);
  document.querySelectorAll('[data-close-portal-modal]').forEach((button) => {
    button.addEventListener('click', closePortalModal);
  });
  document.querySelector('[data-copy-ready-message]')?.addEventListener('click', copyReadyMessage);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && lastPortalData) closePortalModal();
  });
}

async function loadRequests() {
  const message = document.querySelector('[data-page-message]');
  showMessage(message, 'A carregar solicitacoes...', 'info');

  try {
    requests = await listPatientRequests(profile.clinic_id, {
      status: document.querySelector('[data-status-filter]')?.value || ''
    });
    renderRequests();
    showMessage(message, `${requests.length} solicitacao(oes) encontradas.`, 'success');
  } catch (error) {
    showMessage(message, 'Nao foi possivel carregar as solicitacoes.', 'error');
  }
}

function renderRequests() {
  const container = document.querySelector('[data-requests-list]');
  const filter = String(document.querySelector('[data-filter]')?.value || '').toLowerCase();
  clearChildren(container);

  const filtered = requests.filter((request) => [
    request.full_name,
    request.email,
    request.phone,
    request.interest,
    request.message
  ].some((value) => String(value || '').toLowerCase().includes(filter)));

  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-row';
    empty.textContent = 'Nenhuma solicitacao encontrada.';
    container.appendChild(empty);
    return;
  }

  filtered.forEach((request) => container.appendChild(createRequestCard(request)));
}

function createRequestCard(request) {
  const card = document.createElement('article');
  card.className = 'request-card';

  const header = document.createElement('div');
  header.className = 'request-card-header';
  const titleBox = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = request.full_name;
  const meta = document.createElement('div');
  meta.className = 'request-meta';
  meta.textContent = `${request.phone} | ${request.email} | ${formatDateTime(request.created_at)}`;
  titleBox.append(title, meta);

  const badge = document.createElement('span');
  badge.className = `badge ${statusClass(request.status)}`;
  badge.textContent = PATIENT_REQUEST_STATUS_LABELS[request.status] || request.status;
  header.append(titleBox, badge);

  const interest = document.createElement('strong');
  interest.textContent = request.interest;
  const summary = document.createElement('p');
  summary.className = 'muted';
  summary.textContent = request.message || 'Sem mensagem adicional.';

  const actions = document.createElement('div');
  actions.className = 'request-card-actions';
  actions.append(
    createWhatsAppAction(request),
    createStatusButton(request, 'qualified', 'Atendimento confirmado'),
    createStartButton(request),
    createStatusButton(request, 'closed', 'Encerrar contato', true)
  );

  card.append(header, interest, summary, actions);
  return card;
}

function createWhatsAppAction(request) {
  const link = document.createElement('a');
  link.className = 'button button-secondary';
  link.href = buildWhatsAppUrl(request.phone, buildFirstContactMessage());
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Abrir conversa';
  link.addEventListener('click', async () => {
    if (request.status === 'new') await changeStatus(request, 'contacted');
  });
  return link;
}

function createStatusButton(request, status, label, askReason = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = askReason ? 'button button-secondary' : 'button button-secondary';
  button.textContent = label;
  button.disabled = ['converted', 'closed'].includes(request.status);
  button.addEventListener('click', async () => {
    const reason = askReason ? window.prompt('Informe o motivo do encerramento.') : null;
    if (askReason && !reason) return;
    await changeStatus(request, status, reason);
  });
  return button;
}

function createStartButton(request) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button';
  button.textContent = 'Iniciar acompanhamento';
  button.disabled = request.status !== 'qualified';
  button.addEventListener('click', async () => startJourney(request, button));
  return button;
}

async function changeStatus(request, status, reason = null) {
  const message = document.querySelector('[data-page-message]');
  clearMessage(message);

  try {
    await updatePatientRequestStatus(request, status, reason);
    await loadRequests();
  } catch (error) {
    showMessage(message, 'Nao foi possivel atualizar a solicitacao.', 'error');
  }
}

async function startJourney(request, button) {
  const message = document.querySelector('[data-page-message]');
  clearMessage(message);

  try {
    button.disabled = true;
    button.textContent = 'A criar portal...';
    lastPortalData = await startPatientJourney(request.id);
    fillPortalModal(lastPortalData);
    await loadRequests();
    openModal(document.querySelector('[data-portal-modal]'));
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel iniciar o acompanhamento.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Iniciar acompanhamento';
  }
}

function fillPortalModal(data) {
  document.querySelector('[data-portal-name]').textContent = data.patient_name || '-';
  document.querySelector('[data-portal-email]').textContent = data.email || '-';
  document.querySelector('[data-portal-password]').textContent = data.temporary_password || '-';
  document.querySelector('[data-portal-url]').textContent = data.portal_url || '-';
  document.querySelector('[data-ready-message]').value = data.ready_message || '';
  const whatsapp = document.querySelector('[data-open-ready-whatsapp]');
  whatsapp.href = data.whatsapp_url || '#';
}

function closePortalModal() {
  lastPortalData = null;
  document.querySelector('[data-portal-name]').textContent = '';
  document.querySelector('[data-portal-email]').textContent = '';
  document.querySelector('[data-portal-password]').textContent = '';
  document.querySelector('[data-portal-url]').textContent = '';
  document.querySelector('[data-ready-message]').value = '';
  const whatsapp = document.querySelector('[data-open-ready-whatsapp]');
  whatsapp.removeAttribute('href');
  closeModal(document.querySelector('[data-portal-modal]'));
}

async function copyReadyMessage() {
  const text = document.querySelector('[data-ready-message]')?.value || '';
  await navigator.clipboard.writeText(text);
  showMessage(document.querySelector('[data-page-message]'), 'Mensagem copiada.', 'success');
}

function statusClass(status) {
  if (['converted'].includes(status)) return 'badge-success';
  if (['qualified', 'contacted'].includes(status)) return 'badge-warning';
  if (status === 'closed') return 'badge-neutral';
  return 'badge-info';
}
