import { PERMISSIONS, hasPermission } from '../auth/permissions.js';
import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { showMessage } from '../ui/messages.js';
import { DOCUMENT_SIGNATURE_STATUS_LABELS, DOCUMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS, DOCUMENT_VISIBILITY_LABELS } from '../config/constants.js';
import {
  archiveClinicalDocument,
  generateDocumentQrCode,
  generateDocumentShareLink,
  getClinicalDocumentPdf,
  issueClinicalDocument,
  listClinicalDocuments,
  revokeClinicalDocument,
  setDocumentPatientAccess,
  signClinicalDocument
} from '../services/documents.service.js';
import { listProfessionalSignatures } from '../services/signatures.service.js';

let profile = await protectPage(PERMISSIONS.DOCUMENTS_READ);
let documents = [];
let signatures = [];

if (profile) {
  mountLayout(profile);
  document.querySelector('[data-status-filter]')?.addEventListener('change', loadDocuments);
  await Promise.all([loadDocuments(), loadSignatures()]);
}

async function loadDocuments() {
  try {
    const status = document.querySelector('[data-status-filter]')?.value || '';
    documents = await listClinicalDocuments({ status });
    renderDocuments();
  } catch (error) {
    showMessage(document.querySelector('[data-page-message]'), error.message, 'error');
  }
}

async function loadSignatures() {
  try {
    signatures = await listProfessionalSignatures();
  } catch (_error) {
    signatures = [];
  }
}

function renderDocuments() {
  const list = document.querySelector('[data-documents-list]');
  list.replaceChildren();

  if (!documents.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Nenhum documento encontrado.';
    list.appendChild(empty);
    return;
  }

  documents.forEach((documentRow) => list.appendChild(documentItem(documentRow)));
}

function documentItem(documentRow) {
  const item = document.createElement('article');
  item.className = 'record-item';

  const main = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = documentRow.title || documentRow.document_number;
  const meta = document.createElement('div');
  meta.className = 'record-meta';
  meta.textContent = `${documentRow.document_number} | ${DOCUMENT_TYPE_LABELS[documentRow.document_type] || documentRow.document_type} | ${documentRow.patient?.full_name || 'Paciente'} | Versao ${documentRow.current_version}`;
  const summary = document.createElement('p');
  summary.className = 'record-summary';
  summary.textContent = [
    DOCUMENT_SIGNATURE_STATUS_LABELS[documentRow.signature_status] || documentRow.signature_status,
    DOCUMENT_VISIBILITY_LABELS[documentRow.visibility] || documentRow.visibility,
    documentRow.public_validation_enabled ? 'validacao publica ativa' : 'sem validacao publica',
    documentRow.patient_access_enabled ? 'liberado ao paciente' : 'nao liberado ao paciente'
  ].join(' | ');
  const badge = document.createElement('span');
  badge.className = `status-badge status-${documentRow.status}`;
  badge.textContent = DOCUMENT_STATUS_LABELS[documentRow.status] || documentRow.status;
  main.append(title, meta, summary, badge);

  item.append(main, actionMenu(documentRow));
  return item;
}

function actionMenu(documentRow) {
  const actions = document.createElement('div');
  actions.className = 'record-actions';
  const primaryActions = actionGroup('Acoes principais');
  const distributionActions = actionGroup('Distribuicao');
  const criticalActions = actionGroup('Acao critica');
  const isDraft = documentRow.status === 'draft';
  const isIssued = documentRow.status === 'issued';
  const isSignedIssued = isIssued && documentRow.signature_status === 'signed';
  const canArchiveStatus = ['revoked', 'cancelled'].includes(documentRow.status);

  if (isDraft && hasPermission(profile, PERMISSIONS.DOCUMENTS_ISSUE)) {
    primaryActions.append(button('Emitir', () => handleIssue(documentRow)));
  }
  if (isIssued && documentRow.signature_status === 'unsigned' && hasPermission(profile, PERMISSIONS.DOCUMENTS_SIGN)) {
    primaryActions.append(button('Assinar', () => handleSign(documentRow)));
  }
  if (isSignedIssued && hasPermission(profile, PERMISSIONS.DOCUMENTS_RELEASE_TO_PATIENT)) {
    distributionActions.append(button(documentRow.patient_access_enabled ? 'Retirar do portal' : 'Liberar ao paciente', () => handlePatientAccess(documentRow)));
  }
  if (isSignedIssued && documentRow.current_pdf_path) {
    primaryActions.append(button('Visualizar PDF', () => handlePdf(documentRow, 'view')));
    primaryActions.append(button('Descarregar', () => handlePdf(documentRow, 'download')));
    primaryActions.append(button('Imprimir', () => handlePdf(documentRow, 'print')));
  } else if (isSignedIssued) {
    const pending = document.createElement('span');
    pending.className = 'record-action-note';
    pending.textContent = 'Documento em preparacao.';
    primaryActions.appendChild(pending);
    if (hasPermission(profile, PERMISSIONS.DOCUMENTS_EXPORT)) {
      primaryActions.append(button('Gerar PDF', () => handleGeneratePdf(documentRow)));
    }
  }
  if (isSignedIssued && hasPermission(profile, PERMISSIONS.DOCUMENTS_PUBLIC_VALIDATION)) {
    distributionActions.append(button('Gerar QR', () => handleQr(documentRow)));
  }
  if (isSignedIssued && documentRow.current_pdf_path && hasPermission(profile, PERMISSIONS.DOCUMENTS_SHARE)) {
    distributionActions.append(button('Criar link', () => handleShare(documentRow)));
  }
  if (isSignedIssued && hasPermission(profile, PERMISSIONS.DOCUMENTS_REVOKE)) {
    criticalActions.append(button('Revogar', () => handleRevoke(documentRow), 'button-danger'));
  }
  if (canArchiveStatus && hasPermission(profile, PERMISSIONS.DOCUMENTS_ARCHIVE)) {
    criticalActions.append(button('Arquivar', () => handleArchive(documentRow), 'button-secondary'));
  }
  [primaryActions, distributionActions, criticalActions]
    .filter((group) => group.children.length)
    .forEach((group) => actions.appendChild(group));
  if (!actions.children.length) {
    const empty = document.createElement('span');
    empty.className = 'record-action-note';
    empty.textContent = 'Sem acoes disponiveis';
    actions.appendChild(empty);
  }
  return actions;
}

function actionGroup(label) {
  const group = document.createElement('div');
  group.className = 'record-action-group';
  group.setAttribute('aria-label', label);
  return group;
}

async function handleIssue(documentRow) {
  await issueClinicalDocument(documentRow.id);
  await loadDocuments();
}

async function handleSign(documentRow) {
  const signature = signatures.find((item) => item.is_default && item.is_active && !item.revoked_at);
  if (!signature) {
    window.alert('Cadastre uma assinatura padrao ativa antes de assinar.');
    return;
  }
  const signed = await signClinicalDocument(documentRow.id, signature.id);
  try {
    showMessage(document.querySelector('[data-page-message]'), 'Gerando documento...', 'info');
    await getClinicalDocumentPdf(signed.id || documentRow.id, 'generate');
    showMessage(document.querySelector('[data-page-message]'), 'Documento assinado e PDF gerado.', 'success');
  } catch (_error) {
    showMessage(document.querySelector('[data-page-message]'), 'Documento assinado. O PDF ainda esta em preparacao.', 'warning');
  }
  await loadDocuments();
}

async function handlePatientAccess(documentRow) {
  await setDocumentPatientAccess(documentRow.id, !documentRow.patient_access_enabled);
  await loadDocuments();
}

async function handleQr(documentRow) {
  const result = await generateDocumentQrCode(documentRow.id);
  if (result?.qr_signed_url) window.open(result.qr_signed_url, '_blank', 'noopener');
}

async function handlePdf(documentRow, mode) {
  const result = await getClinicalDocumentPdf(documentRow.id, mode);
  if (result?.signed_url) window.open(result.signed_url, '_blank', 'noopener');
}

async function handleGeneratePdf(documentRow) {
  showMessage(document.querySelector('[data-page-message]'), 'Gerando documento...', 'info');
  await getClinicalDocumentPdf(documentRow.id, 'generate');
  showMessage(document.querySelector('[data-page-message]'), 'PDF disponivel.', 'success');
  await loadDocuments();
}

async function handleShare(documentRow) {
  const result = await generateDocumentShareLink(documentRow.id, { expiration: '24_hours', allowDownload: false });
  if (result?.url) window.prompt('Link temporario criado:', result.url);
}

async function handleRevoke(documentRow) {
  const reason = window.prompt('Informe o motivo da revogacao:');
  if (!reason) return;
  await revokeClinicalDocument(documentRow.id, reason);
  await loadDocuments();
}

async function handleArchive(documentRow) {
  if (!['revoked', 'cancelled'].includes(documentRow.status)) {
    showMessage(document.querySelector('[data-page-message]'), 'Este documento ativo nao pode ser arquivado diretamente. Revogue o documento antes de arquivar.', 'warning');
    return;
  }
  if (!window.confirm('Arquivar este documento?')) return;
  await archiveClinicalDocument(documentRow.id);
  await loadDocuments();
}

function button(label, handler, variant = 'button-secondary') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `button button-sm ${variant}`;
  element.textContent = label;
  element.addEventListener('click', async () => {
    try {
      element.disabled = true;
      await handler();
    } catch (error) {
      showMessage(document.querySelector('[data-page-message]'), error.message, 'error');
    } finally {
      element.disabled = false;
    }
  });
  return element;
}
