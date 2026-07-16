import { PERMISSIONS, hasPermission } from '../auth/permissions.js';
import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { closeModal, openModal } from '../ui/modal.js';
import { clearChildren } from '../ui/table.js';
import { clearMessage, showMessage } from '../ui/messages.js';
import { dateTimeLocalInput, formatCurrency, formatDate, formatDateTimeInTimezone } from '../ui/formatters.js';
import {
  APPOINTMENT_STATUS_LABELS,
  FINANCIAL_CHARGE_STATUS_LABELS,
  FINANCIAL_CHARGE_TYPE_LABELS,
  FINANCIAL_PAYMENT_METHOD_LABELS,
  FINANCIAL_PAYMENT_STATUS_LABELS,
  FINANCIAL_RECEIPT_STATUS_LABELS,
  SUPPORTED_CURRENCIES
} from '../config/constants.js';
import { listPatients } from '../services/patients.service.js';
import { listAppointments } from '../services/appointments.service.js';
import {
  cancelCharge,
  createFinancialCharge,
  downloadReceiptPdf,
  getFinancialChargeDefaults,
  getFinancialDashboardSummary,
  generateReceiptPdf,
  getReceiptPdfUrl,
  listFinancialCharges,
  listFinancialPayments,
  listFinancialReceipts,
  registerPayment
} from '../services/financial.service.js';

let profile = await protectPage(PERMISSIONS.FINANCE_READ);
let patients = [];
let appointments = [];
let charges = [];
let payments = [];
let receipts = [];
let summary = null;
let chargeDefaults = {};

const CHARGEABLE_APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed'];
const CANCELLED_APPOINTMENT_STATUSES = ['cancelled', 'cancelled_by_patient', 'cancelled_by_clinic', 'no_show', 'archived'];
const FINANCIAL_APPOINTMENT_STATUS_LABELS = {
  ...APPOINTMENT_STATUS_LABELS,
  completed: 'Concluída'
};

if (profile) {
  mountLayout(profile);
  await loadFinancial();
  bindEvents();
}

async function loadFinancial() {
  const message = document.querySelector('[data-page-message]');
  clearMessage(message);

  try {
    [patients, appointments, summary, charges, payments, receipts, chargeDefaults] = await Promise.all([
      listPatients(profile.clinic_id),
      listAppointments(profile.clinic_id, { statuses: CHARGEABLE_APPOINTMENT_STATUSES }),
      getFinancialDashboardSummary(),
      listFinancialCharges(),
      listFinancialPayments(),
      listFinancialReceipts(),
      getFinancialChargeDefaults(profile.clinic_id)
    ]);

    renderSummary();
    renderCharges();
    renderPayments();
    renderReceipts();
    renderCashflow();
    fillChargeForm();
    applyPermissions();
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel carregar o financeiro.', 'error');
  }
}

function bindEvents() {
  document.querySelector('[data-refresh-financial]')?.addEventListener('click', loadFinancial);
  document.querySelector('[data-new-charge]')?.addEventListener('click', openChargeForm);
  document.querySelectorAll('[data-close-charge-modal]').forEach((button) => button.addEventListener('click', () => closeModal(document.querySelector('[data-charge-modal]'))));
  document.querySelectorAll('[data-close-payment-modal]').forEach((button) => button.addEventListener('click', () => closeModal(document.querySelector('[data-payment-modal]'))));
  document.querySelectorAll('[data-close-cancel-modal]').forEach((button) => button.addEventListener('click', () => closeModal(document.querySelector('[data-cancel-modal]'))));
  document.querySelector('[data-charge-form]')?.addEventListener('submit', saveCharge);
  document.querySelector('[data-payment-form]')?.addEventListener('submit', savePayment);
  document.querySelector('[data-cancel-form]')?.addEventListener('submit', saveCancelCharge);
  document.querySelector('[data-charge-form] [name="patient_id"]')?.addEventListener('change', updateAppointmentOptions);
  document.querySelector('[data-charge-form] [name="appointment_id"]')?.addEventListener('change', handleChargeAppointmentChange);
  document.querySelector('[data-charge-form] [name="charge_type"]')?.addEventListener('change', handleChargeTypeChange);
  document.querySelectorAll('[data-tab-button]').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tabButton));
  });
}

function applyPermissions() {
  document.querySelector('[data-new-charge]').hidden = !hasPermission(profile, PERMISSIONS.FINANCE_CREATE_CHARGE);
}

function renderSummary() {
  const container = document.querySelector('[data-financial-summary]');
  clearChildren(container);
  const currencies = normalizeCurrencies(summary?.currencies || []);

  currencies.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'financial-summary-card';
    const title = document.createElement('h2');
    title.textContent = item.currency;
    const values = document.createElement('div');
    values.className = 'financial-summary-values';
    values.append(
      summaryLine('A receber', formatCurrency(item.receivable, item.currency)),
      summaryLine('Recebido no mes', formatCurrency(item.received_month, item.currency)),
      summaryLine('Em atraso', formatCurrency(item.overdue, item.currency))
    );
    card.append(title, values);
    container.appendChild(card);
  });
}

function renderCharges() {
  const tbody = document.querySelector('[data-charges-table]');
  clearChildren(tbody);

  if (!charges.length) {
    appendEmptyRow(tbody, 10, 'Nenhuma cobranca encontrada.');
    return;
  }

  charges.forEach((charge) => {
    const row = document.createElement('tr');
    row.append(
      td(charge.patient?.full_name || 'Paciente'),
      td(charge.description),
      appointmentCell(charge),
      td(formatDate(charge.due_date)),
      td(charge.currency),
      td(formatCurrency(charge.final_amount, charge.currency)),
      td(formatCurrency(charge.paid_amount, charge.currency)),
      td(formatCurrency(charge.remaining_amount, charge.currency)),
      statusCell(charge.status, FINANCIAL_CHARGE_STATUS_LABELS),
      actionsCell(charge)
    );
    tbody.appendChild(row);
  });
}

function renderPayments() {
  const tbody = document.querySelector('[data-payments-table]');
  clearChildren(tbody);

  if (!payments.length) {
    appendEmptyRow(tbody, 8, 'Nenhum pagamento registado.');
    return;
  }

  payments.forEach((payment) => {
    const receipt = receipts.find((item) => item.payment_id === payment.id);
    const row = document.createElement('tr');
    row.append(
      td(payment.patient?.full_name || 'Paciente'),
      td(payment.charge?.description || '-'),
      td(formatDateTimeInTimezone(payment.payment_date, profile.clinics?.timezone)),
      td(FINANCIAL_PAYMENT_METHOD_LABELS[payment.payment_method] || payment.payment_method),
      td(payment.currency),
      td(formatCurrency(payment.amount, payment.currency)),
      statusCell(payment.payment_status, FINANCIAL_PAYMENT_STATUS_LABELS),
      receiptActionsCell(receipt)
    );
    tbody.appendChild(row);
  });
}

function renderReceipts() {
  const tbody = document.querySelector('[data-receipts-table]');
  clearChildren(tbody);

  if (!receipts.length) {
    appendEmptyRow(tbody, 8, 'Nenhum recibo emitido.');
    return;
  }

  receipts.forEach((receipt) => {
    const row = document.createElement('tr');
    row.append(
      td(receipt.receipt_number),
      td(receipt.patient?.full_name || 'Paciente'),
      td(receipt.charge?.description || '-'),
      td(formatDateTimeInTimezone(receipt.issued_at, profile.clinics?.timezone)),
      td(receipt.currency),
      td(formatCurrency(receipt.amount, receipt.currency)),
      statusCell(receipt.status, FINANCIAL_RECEIPT_STATUS_LABELS),
      receiptActionsCell(receipt)
    );
    tbody.appendChild(row);
  });
}

function renderCashflow() {
  const container = document.querySelector('[data-cashflow-grid]');
  clearChildren(container);
  normalizeCurrencies(summary?.currencies || []).forEach((item) => {
    const card = document.createElement('article');
    card.className = 'financial-cashflow-card';
    const title = document.createElement('strong');
    title.textContent = item.currency;
    const received = document.createElement('p');
    received.textContent = `Entradas confirmadas no mes: ${formatCurrency(item.received_month, item.currency)}`;
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Saidas/despesas nao implementadas nesta Sprint.';
    card.append(title, received, note);
    container.appendChild(card);
  });
}

function fillChargeForm() {
  const form = document.querySelector('[data-charge-form]');
  clearChildren(form.patient_id);
  clearChildren(form.currency);

  patients.forEach((patient) => {
    const option = document.createElement('option');
    option.value = patient.id;
    option.textContent = patient.full_name;
    form.patient_id.appendChild(option);
  });

  SUPPORTED_CURRENCIES.forEach((currency) => {
    const option = document.createElement('option');
    option.value = currency;
    option.textContent = currency;
    form.currency.appendChild(option);
  });

  form.currency.value = profile.clinics?.default_currency || 'EUR';
  updateAppointmentOptions();
}

function updateAppointmentOptions() {
  const form = document.querySelector('[data-charge-form]');
  const patientId = form.patient_id.value;
  clearChildren(form.appointment_id);

  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Sem Appointment';
  form.appointment_id.appendChild(empty);

  appointments
    .filter((appointment) => appointment.patient_id === patientId && CHARGEABLE_APPOINTMENT_STATUSES.includes(appointment.status))
    .forEach((appointment) => {
      const option = document.createElement('option');
      option.value = appointment.id;
      option.textContent = `${formatAppointmentDateTime(appointment)} - ${formatAppointmentStatus(appointment.status)}`;
      form.appointment_id.appendChild(option);
    });
}

function openChargeForm() {
  const form = document.querySelector('[data-charge-form]');
  form.reset();
  form.currency.value = profile.clinics?.default_currency || 'EUR';
  form.charge_type.value = 'manual';
  updateAppointmentOptions();
  openModal(document.querySelector('[data-charge-modal]'));
}

function handleChargeAppointmentChange(event) {
  const form = event.currentTarget.form;
  const appointment = appointments.find((item) => item.id === form.appointment_id.value);

  if (!appointment) {
    if (form.charge_type.value === 'appointment') {
      form.charge_type.value = 'manual';
    }
    return;
  }

  form.charge_type.value = 'appointment';
  form.currency.value = profile.clinics?.default_currency || form.currency.value || 'EUR';

  if (!form.description.value.trim()) {
    form.description.value = `Atendimento de ${formatAppointmentDateTime(appointment)}`;
  }

  if (!Number(form.amount.value || 0) && Number(chargeDefaults?.default_session_price || 0) > 0) {
    form.amount.value = Number(chargeDefaults.default_session_price).toFixed(2);
  }
}

function handleChargeTypeChange(event) {
  const form = event.currentTarget.form;

  if (form.charge_type.value !== 'appointment') {
    form.appointment_id.value = '';
  }
}

function openPaymentForm(charge) {
  const form = document.querySelector('[data-payment-form]');
  form.reset();
  form.charge_id.value = charge.id;
  form.remaining_amount.value = formatCurrency(charge.remaining_amount, charge.currency);
  form.amount.max = String(charge.remaining_amount);
  form.amount.value = charge.remaining_amount;
  form.payment_date.value = dateTimeLocalInput();
  document.querySelector('[data-payment-subtitle]').textContent = `${charge.patient?.full_name || 'Paciente'} | ${charge.description}`;
  openModal(document.querySelector('[data-payment-modal]'));
}

function openCancelForm(charge) {
  const form = document.querySelector('[data-cancel-form]');
  form.reset();
  form.charge_id.value = charge.id;
  openModal(document.querySelector('[data-cancel-modal]'));
}

async function saveCharge(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('[data-charge-message]');
  clearMessage(message);

  try {
    if (form.charge_type.value === 'appointment' && !form.appointment_id.value) {
      showMessage(message, 'Selecione um atendimento para criar cobranca de atendimento.', 'error');
      return;
    }

    await createFinancialCharge({
      patient_id: form.patient_id.value,
      charge_type: form.appointment_id.value ? 'appointment' : form.charge_type.value,
      appointment_id: form.appointment_id.value,
      description: form.description.value.trim(),
      currency: form.currency.value,
      amount: form.amount.value,
      discount_amount: form.discount_amount.value,
      due_date: form.due_date.value,
      notes: form.notes.value.trim()
    });
    closeModal(document.querySelector('[data-charge-modal]'));
    await loadFinancial();
    showMessage(document.querySelector('[data-page-message]'), 'Cobranca criada com sucesso.', 'success');
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel criar a cobranca.', 'error');
  }
}

async function savePayment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('[data-payment-message]');
  clearMessage(message);
  const charge = charges.find((item) => item.id === form.charge_id.value);
  const amount = Number(form.amount.value || 0);

  if (charge && amount > Number(charge.remaining_amount)) {
    showMessage(message, 'Valor maior que o saldo restante.', 'error');
    return;
  }

  try {
    const result = await registerPayment({
      charge_id: form.charge_id.value,
      amount,
      payment_method: form.payment_method.value,
      payment_date: form.payment_date.value,
      external_reference: form.external_reference.value.trim(),
      notes: form.notes.value.trim()
    });
    closeModal(document.querySelector('[data-payment-modal]'));
    await loadFinancial();
    showMessage(document.querySelector('[data-page-message]'), `Pagamento registado. Recibo ${result.receipt?.receipt_number || ''}`, 'success');
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel registar o pagamento.', 'error');
  }
}

async function saveCancelCharge(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('[data-cancel-message]');
  clearMessage(message);

  try {
    await cancelCharge(form.charge_id.value, form.reason.value.trim());
    closeModal(document.querySelector('[data-cancel-modal]'));
    await loadFinancial();
    showMessage(document.querySelector('[data-page-message]'), 'Cobranca cancelada.', 'success');
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel cancelar a cobranca.', 'error');
  }
}

function actionsCell(charge) {
  const cell = document.createElement('td');
  const actions = document.createElement('div');
  actions.className = 'financial-table-actions';

  if (['pending', 'partially_paid', 'overdue'].includes(charge.status) && hasPermission(profile, PERMISSIONS.FINANCE_REGISTER_PAYMENT)) {
    actions.appendChild(actionButton('Registar pagamento', () => openPaymentForm(charge)));
  }

  if (['pending', 'overdue'].includes(charge.status) && hasPermission(profile, PERMISSIONS.FINANCE_CANCEL_CHARGE)) {
    actions.appendChild(actionButton('Cancelar', () => openCancelForm(charge), 'button-danger'));
  }

  actions.appendChild(linkButton('Ver recibos', 'receipts'));
  cell.appendChild(actions);
  return cell;
}

function receiptActionsCell(receipt) {
  const cell = document.createElement('td');
  const actions = document.createElement('div');
  actions.className = 'financial-table-actions';

  if (!receipt) {
    cell.textContent = '-';
    return cell;
  }

  if (!receipt.pdf_storage_path) {
    actions.appendChild(actionButton('Gerar PDF', () => handleReceiptPdf(receipt, 'generate')));
  } else {
    actions.append(
      actionButton('Visualizar', () => handleReceiptPdf(receipt, 'view')),
      actionButton('Descarregar', () => handleReceiptPdf(receipt, 'download'), 'button-secondary')
    );
  }

  cell.appendChild(actions);
  return cell;
}

async function handleReceiptPdf(receipt, mode) {
  const message = document.querySelector('[data-page-message]');
  clearMessage(message);

  try {
    const result = mode === 'download'
      ? await downloadReceiptPdf(receipt.id)
      : mode === 'generate'
        ? await generateReceiptPdf(receipt.id)
        : await getReceiptPdfUrl(receipt.id);

    if (result?.signed_url) {
      window.open(result.signed_url, '_blank', 'noopener');
    }

    if (mode === 'generate') {
      await loadFinancial();
      showMessage(message, 'Comprovativo PDF gerado.', 'success');
    }
  } catch (error) {
    showMessage(message, error.message || 'Nao foi possivel abrir o comprovativo.', 'error');
  }
}

function actionButton(label, handler, extraClass = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button button-sm ${extraClass || 'button-secondary'}`;
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function linkButton(label, tab) {
  const button = actionButton(label, () => activateTab(tab));
  return button;
}

function activateTab(tab) {
  document.querySelectorAll('[data-tab-button]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tabButton === tab);
  });
  document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tab;
  });
}

function statusCell(status, labels) {
  const cell = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `financial-status-${status}`;
  badge.textContent = labels[status] || status;
  cell.appendChild(badge);
  return cell;
}

function td(value) {
  const cell = document.createElement('td');
  cell.textContent = value || '-';
  return cell;
}

function appendEmptyRow(tbody, colspan, message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = colspan;
  cell.className = 'empty-row';
  cell.textContent = message;
  row.appendChild(cell);
  tbody.appendChild(row);
}

function summaryLine(label, value) {
  const line = document.createElement('div');
  line.className = 'financial-summary-line';
  const span = document.createElement('span');
  span.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  line.append(span, strong);
  return line;
}

function formatAppointment(appointment) {
  if (!appointment) return '-';
  return formatAppointmentDateTime(appointment);
}

function appointmentCell(charge) {
  const cell = document.createElement('td');
  const appointment = charge.appointment;

  if (!appointment) {
    cell.textContent = '-';
    return cell;
  }

  const line = document.createElement('span');
  line.textContent = `${formatAppointment(appointment)} - ${formatAppointmentStatus(appointment.status)}`;
  cell.appendChild(line);

  if (CANCELLED_APPOINTMENT_STATUSES.includes(appointment.status) && Number(charge.paid_amount || 0) > 0) {
    const alert = document.createElement('small');
    alert.className = 'muted';
    alert.textContent = 'Atendimento cancelado com pagamento registado. Fluxo de estorno sera implementado futuramente.';
    cell.appendChild(document.createElement('br'));
    cell.appendChild(alert);
  }

  return cell;
}

function formatAppointmentDateTime(appointment) {
  return formatDateTimeInTimezone(appointment.scheduled_start, appointment.clinic_timezone);
}

function formatAppointmentStatus(status) {
  return FINANCIAL_APPOINTMENT_STATUS_LABELS[status] || status;
}

function normalizeCurrencies(rows) {
  return SUPPORTED_CURRENCIES.map((currency) => {
    const found = rows.find((item) => item.currency === currency);
    return {
      currency,
      receivable: Number(found?.receivable || 0),
      received_month: Number(found?.received_month || 0),
      overdue: Number(found?.overdue || 0)
    };
  });
}
