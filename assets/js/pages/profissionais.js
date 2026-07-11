import { PERMISSIONS, hasPermission } from '../auth/permissions.js';
import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { appendEmptyRow, clearChildren, createCell } from '../ui/table.js';
import { closeModal, openModal } from '../ui/modal.js';
import { clearMessage, showMessage } from '../ui/messages.js';
import { USER_STATUS_LABELS } from '../config/constants.js';
import { createAuditLog } from '../services/audit.service.js';
import {
  createProfessional,
  listProfessionals,
  updateProfessional,
  updateProfessionalStatus
} from '../services/profiles.service.js';

let profile = await protectPage(PERMISSIONS.PROFESSIONALS_READ);
let professionals = [];
let editingProfessional = null;

if (profile) {
  mountLayout(profile);
  applyPermissions();
  bindEvents();
  await loadProfessionals();
}

function applyPermissions() {
  const createButton = document.querySelector('[data-new-professional]');
  if (createButton) {
    createButton.hidden = !hasPermission(profile, PERMISSIONS.PROFESSIONALS_CREATE);
  }
}

function bindEvents() {
  document.querySelector('[data-new-professional]')?.addEventListener('click', () => {
    editingProfessional = null;
    const form = document.querySelector('[data-professional-form]');
    form.reset();
    form.status.value = 'pending_invite';
    form.status.disabled = true;
    openModal(document.querySelector('[data-professional-modal]'));
  });

  document.querySelector('[data-close-modal]')?.addEventListener('click', () => {
    closeModal(document.querySelector('[data-professional-modal]'));
  });

  document.querySelector('[data-professional-form]')?.addEventListener('submit', saveProfessional);
  document.querySelector('[data-filter]')?.addEventListener('input', renderTable);
  document.querySelector('[data-status-filter]')?.addEventListener('change', renderTable);
}

async function loadProfessionals() {
  const message = document.querySelector('[data-page-message]');
  showMessage(message, 'A carregar profissionais...', 'info');

  try {
    professionals = await listProfessionals(profile.clinic_id);
    renderTable();
    showMessage(message, `${professionals.length} profissional(is) encontrados.`, 'success');
  } catch (error) {
    showMessage(message, 'Nao foi possivel carregar profissionais.', 'error');
  }
}

function renderTable() {
  const tbody = document.querySelector('[data-professionals-table]');
  const textFilter = String(document.querySelector('[data-filter]')?.value || '').toLowerCase();
  const statusFilter = document.querySelector('[data-status-filter]')?.value || '';
  clearChildren(tbody);

  const filtered = professionals.filter((professional) => {
    const matchesText = [professional.full_name, professional.email, professional.specialty]
      .some((value) => String(value || '').toLowerCase().includes(textFilter));
    const matchesStatus = !statusFilter || professional.status === statusFilter;
    return matchesText && matchesStatus;
  });

  if (!filtered.length) {
    appendEmptyRow(tbody, 6, 'Nenhum profissional encontrado.');
    return;
  }

  filtered.forEach((professional) => {
    const row = document.createElement('tr');
    row.append(
      createCell(professional.full_name),
      createCell(professional.specialty),
      createCell(professional.professional_registration),
      createContactCell(professional),
      createStatusCell(professional.status),
      createActionsCell(professional)
    );
    tbody.appendChild(row);
  });
}

function createContactCell(professional) {
  const cell = document.createElement('td');
  const email = document.createElement('div');
  email.textContent = professional.email || '-';
  const phone = document.createElement('small');
  phone.className = 'muted';
  phone.textContent = professional.phone || '-';
  cell.append(email, phone);
  return cell;
}

function createStatusCell(status) {
  const cell = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `status-badge status-${status}`;
  badge.textContent = USER_STATUS_LABELS[status] || status;
  cell.appendChild(badge);
  return cell;
}

function createActionsCell(professional) {
  const cell = document.createElement('td');
  cell.className = 'table-actions';

  if (!hasPermission(profile, PERMISSIONS.PROFESSIONALS_UPDATE)) {
    cell.textContent = '-';
    return cell;
  }

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'icon-button';
  edit.textContent = 'Editar';
  edit.addEventListener('click', () => editProfessional(professional));
  cell.appendChild(edit);

  ['active', 'inactive', 'suspended'].forEach((status) => {
    if (professional.status === status) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.textContent = USER_STATUS_LABELS[status];
    button.addEventListener('click', () => changeStatus(professional, status));
    cell.appendChild(button);
  });

  return cell;
}

function editProfessional(professional) {
  editingProfessional = professional;
  const form = document.querySelector('[data-professional-form]');
  form.full_name.value = professional.full_name || '';
  form.email.value = professional.email || '';
  form.phone.value = professional.phone || '';
  form.role.value = professional.role === 'supervisor' ? 'supervisor' : 'professional';
  form.specialty.value = professional.specialty || '';
  form.professional_registration.value = professional.professional_registration || '';
  form.status.value = professional.status || 'inactive';
  form.status.disabled = false;
  openModal(document.querySelector('[data-professional-modal]'));
}

async function saveProfessional(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('[data-form-message]');
  clearMessage(message);

  const payload = {
    full_name: form.full_name.value.trim(),
    email: form.email.value.trim(),
    phone: form.phone.value.trim() || null,
    role: form.role.value,
    specialty: form.specialty.value.trim(),
    professional_registration: form.professional_registration.value.trim() || null
  };

  if (!payload.full_name || !payload.email || !payload.specialty) {
    showMessage(message, 'Nome, email e especialidade sao obrigatorios.', 'error');
    return;
  }

  try {
    const saved = editingProfessional
      ? await updateProfessional(editingProfessional.id, { ...payload, status: form.status.value })
      : await createProfessional(profile.clinic_id, payload);

    await createAuditLog({
      clinicId: profile.clinic_id,
      action: editingProfessional ? 'professionals.update' : 'professionals.create',
      entity: 'profiles',
      entityId: saved.id,
      previousData: editingProfessional,
      newData: sanitizeProfessional(saved)
    });

    closeModal(document.querySelector('[data-professional-modal]'));
    await loadProfessionals();
  } catch (error) {
    showMessage(message, 'Nao foi possivel guardar o profissional.', 'error');
  }
}

async function changeStatus(professional, status) {
  try {
    const updated = await updateProfessionalStatus(professional.id, status);
    await createAuditLog({
      clinicId: profile.clinic_id,
      action: 'professionals.status.update',
      entity: 'profiles',
      entityId: professional.id,
      previousData: sanitizeProfessional(professional),
      newData: sanitizeProfessional(updated)
    });
    await loadProfessionals();
  } catch (error) {
    showMessage(document.querySelector('[data-page-message]'), 'Nao foi possivel alterar o estado.', 'error');
  }
}

function sanitizeProfessional(professional) {
  if (!professional) return null;
  const { id, clinic_id, full_name, email, phone, role, professional_registration, specialty, status } = professional;
  return { id, clinic_id, full_name, email, phone, role, professional_registration, specialty, status };
}
