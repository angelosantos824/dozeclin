import { PERMISSIONS } from '../auth/permissions.js';
import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { openModal, closeModal } from '../ui/modal.js';
import { showMessage, clearMessage } from '../ui/messages.js';
import {
  createSignatureFromFile,
  listProfessionalSignatures,
  revokeSignature,
  setDefaultSignature
} from '../services/signatures.service.js';

const SIGNATURE_LABELS = {
  drawn: 'Assinatura desenhada',
  image: 'Imagem da assinatura',
  stamp: 'Carimbo profissional',
  seal: 'Selo da clinica',
  clinic_signature: 'Assinatura institucional',
  clinic_stamp: 'Carimbo da clinica',
  clinic_seal: 'Selo institucional',
  clinic_logo: 'Logotipo da clinica'
};

let profile = await protectPage(PERMISSIONS.SIGNATURES_READ);
let signatures = [];
let drawing = false;
let canvasTouched = false;

if (profile) {
  mountLayout(profile);
  setupCanvas();
  bindEvents();
  await loadSignatures();
}

function bindEvents() {
  document.querySelector('[data-open-signature-form]')?.addEventListener('click', openSignatureForm);
  document.querySelector('[data-close-signature-modal]')?.addEventListener('click', () => closeModal(document.querySelector('[data-signature-modal]')));
  document.querySelector('[data-signature-form]')?.addEventListener('submit', saveSignature);
  document.querySelector('[data-clear-canvas]')?.addEventListener('click', clearCanvas);
  document.querySelector('[name="signature_type"]')?.addEventListener('change', updateInputMode);
}

async function loadSignatures() {
  try {
    signatures = await listProfessionalSignatures();
    renderSignatures();
  } catch (error) {
    showMessage(document.querySelector('[data-page-message]'), error.message, 'error');
  }
}

function renderSignatures() {
  const list = document.querySelector('[data-signature-list]');
  list.replaceChildren();

  if (!signatures.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Nenhuma assinatura cadastrada.';
    list.appendChild(empty);
    return;
  }

  signatures.forEach((signature) => {
    const card = document.createElement('article');
    card.className = 'signature-card';
    const title = document.createElement('h2');
    title.textContent = signature.display_name || SIGNATURE_LABELS[signature.signature_type];
    const badge = document.createElement('span');
    badge.className = `status-badge ${signature.revoked_at ? 'status-cancelled' : 'status-active'}`;
    badge.textContent = signature.revoked_at ? 'Revogada' : signature.is_default ? 'Padrao ativo' : 'Ativa';
    const meta = document.createElement('dl');
    meta.append(
      term('Tipo', SIGNATURE_LABELS[signature.signature_type]),
      term('Dono', signature.owner_type === 'clinic' ? 'Clinica' : 'Profissional'),
      term('Profissional', signature.profile?.full_name || '-'),
      term('Hash', signature.file_hash ? `${signature.file_hash.slice(0, 12)}...` : '-')
    );
    const actions = document.createElement('div');
    actions.className = 'signature-actions';
    if (!signature.revoked_at) {
      actions.append(
        button('Definir padrao', () => handleDefault(signature), 'button-secondary'),
        button('Revogar', () => handleRevoke(signature), 'button-danger')
      );
    }
    card.append(title, badge, meta, actions);
    list.appendChild(card);
  });
}

function openSignatureForm() {
  const form = document.querySelector('[data-signature-form]');
  form.reset();
  clearCanvas();
  updateInputMode();
  openModal(document.querySelector('[data-signature-modal]'));
}

async function saveSignature(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('[data-form-message]');
  const buttonEl = document.querySelector('[data-save-signature]');
  clearMessage(message);

  try {
    buttonEl.disabled = true;
    buttonEl.textContent = 'A guardar...';
    const type = form.signature_type.value;
    const file = type === 'drawn'
      ? await canvasToFile()
      : form.signature_file.files[0];
    await createSignatureFromFile({
      file,
      signatureType: type,
      displayName: form.display_name.value.trim(),
      isDefault: form.is_default.checked
    });
    closeModal(document.querySelector('[data-signature-modal]'));
    await loadSignatures();
    showMessage(document.querySelector('[data-page-message]'), 'Assinatura guardada com sucesso.', 'success');
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel guardar a assinatura.', 'error');
  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = 'Guardar assinatura';
  }
}

async function handleDefault(signature) {
  await setDefaultSignature(signature);
  await loadSignatures();
}

async function handleRevoke(signature) {
  const reason = window.prompt('Informe o motivo da revogacao:');
  if (!reason) return;
  await revokeSignature(signature.id, reason);
  await loadSignatures();
}

function setupCanvas() {
  const canvas = document.querySelector('[data-signature-canvas]');
  const context = canvas.getContext('2d');
  context.lineWidth = 3;
  context.lineCap = 'round';
  context.strokeStyle = '#102a3a';

  canvas.addEventListener('pointerdown', (event) => {
    drawing = true;
    canvasTouched = true;
    const point = pointerPoint(canvas, event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const point = pointerPoint(canvas, event);
    context.lineTo(point.x, point.y);
    context.stroke();
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((eventName) => {
    canvas.addEventListener(eventName, () => {
      drawing = false;
    });
  });
}

function clearCanvas() {
  const canvas = document.querySelector('[data-signature-canvas]');
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  canvasTouched = false;
}

async function canvasToFile() {
  if (!canvasTouched) throw new Error('Desenhe a assinatura antes de guardar.');
  const canvas = document.querySelector('[data-signature-canvas]');
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new File([blob], 'assinatura.png', { type: 'image/png' });
}

function pointerPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height
  };
}

function updateInputMode() {
  const type = document.querySelector('[name="signature_type"]').value;
  document.querySelector('[data-canvas-field]').hidden = type !== 'drawn';
  document.querySelector('[data-file-field]').hidden = type === 'drawn';
}

function term(label, value) {
  const fragment = document.createDocumentFragment();
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value || '-';
  fragment.append(dt, dd);
  return fragment;
}

function button(label, handler, variant = 'button-secondary') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `button button-sm ${variant}`;
  element.textContent = label;
  element.addEventListener('click', handler);
  return element;
}
