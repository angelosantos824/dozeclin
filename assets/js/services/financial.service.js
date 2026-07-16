import { supabase } from '../config/supabase.js';

const CHARGE_FIELDS = `
  id,
  clinic_id,
  patient_id,
  appointment_id,
  description,
  charge_type,
  status,
  currency,
  amount,
  discount_amount,
  final_amount,
  due_date,
  paid_amount,
  remaining_amount,
  created_by,
  cancelled_by,
  cancelled_at,
  created_at,
  updated_at,
  patient:patient_id(id, full_name, email, phone),
  appointment:appointment_id(id, scheduled_start, clinic_timezone, status)
`;

const PAYMENT_FIELDS = `
  id,
  clinic_id,
  charge_id,
  patient_id,
  amount,
  currency,
  payment_method,
  payment_status,
  payment_date,
  registered_by,
  cancelled_at,
  created_at,
  updated_at,
  patient:patient_id(id, full_name),
  charge:charge_id(id, description, status)
`;

const RECEIPT_FIELDS = `
  id,
  clinic_id,
  payment_id,
  charge_id,
  patient_id,
  receipt_number,
  currency,
  amount,
  issued_at,
  issued_by,
  status,
  document_status,
  pdf_storage_path,
  pdf_generated_at,
  pdf_hash,
  external_fiscal_reference,
  external_fiscal_document_type,
  external_fiscal_document_number,
  external_fiscal_atcud,
  cancelled_at,
  created_at,
  patient:patient_id(id, full_name),
  charge:charge_id(id, description),
  payment:payment_id(id, payment_method, payment_date)
`;

export async function getFinancialDashboardSummary() {
  const { data, error } = await supabase.rpc('get_financial_dashboard_summary');
  if (error) throw normalizeFinancialError(error);
  return data || {};
}

export async function getFinancialChargeDefaults(clinicId) {
  const { data, error } = await supabase
    .from('clinic_settings')
    .select('default_session_price')
    .eq('clinic_id', clinicId)
    .maybeSingle();

  if (error) throw normalizeFinancialError(error);
  return data || {};
}

export async function listFinancialCharges(filters = {}) {
  let query = supabase
    .from('financial_charges')
    .select(CHARGE_FIELDS)
    .order('created_at', { ascending: false });

  if (filters.patientId) query = query.eq('patient_id', filters.patientId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.currency) query = query.eq('currency', filters.currency);

  const { data, error } = await query;
  if (error) throw normalizeFinancialError(error);
  return data || [];
}

export async function listFinancialPayments(filters = {}) {
  let query = supabase
    .from('financial_payments')
    .select(PAYMENT_FIELDS)
    .order('payment_date', { ascending: false });

  if (filters.patientId) query = query.eq('patient_id', filters.patientId);
  if (filters.chargeId) query = query.eq('charge_id', filters.chargeId);

  const { data, error } = await query;
  if (error) throw normalizeFinancialError(error);
  return data || [];
}

export async function listFinancialReceipts(filters = {}) {
  let query = supabase
    .from('financial_receipts')
    .select(RECEIPT_FIELDS)
    .order('issued_at', { ascending: false });

  if (filters.patientId) query = query.eq('patient_id', filters.patientId);
  if (filters.chargeId) query = query.eq('charge_id', filters.chargeId);

  const { data, error } = await query;
  if (error) throw normalizeFinancialError(error);
  return data || [];
}

export async function getPatientFinancialSummary(patientId) {
  const { data, error } = await supabase.rpc('get_patient_financial_summary', {
    p_patient_id: patientId
  });
  if (error) throw normalizeFinancialError(error);
  return data || { charges: [], payments: [], receipts: [], open_balance: [] };
}

export async function createFinancialCharge(payload) {
  const appointmentId = payload.appointment_id || null;
  const chargeType = appointmentId ? 'appointment' : payload.charge_type;

  const { data, error } = await supabase.rpc('create_financial_charge', {
    p_patient_id: payload.patient_id,
    p_description: payload.description,
    p_charge_type: chargeType,
    p_appointment_id: appointmentId,
    p_currency: payload.currency,
    p_amount: Number(payload.amount || 0),
    p_discount_amount: Number(payload.discount_amount || 0),
    p_due_date: payload.due_date || null,
    p_notes: payload.notes || null
  });

  if (error) throw normalizeFinancialError(error);
  return data;
}

export async function registerPayment(payload) {
  const { data, error } = await supabase.rpc('register_payment', {
    p_charge_id: payload.charge_id,
    p_amount: Number(payload.amount || 0),
    p_payment_method: payload.payment_method,
    p_payment_date: payload.payment_date ? new Date(payload.payment_date).toISOString() : new Date().toISOString(),
    p_external_reference: payload.external_reference || null,
    p_notes: payload.notes || null
  });

  if (error) throw normalizeFinancialError(error);
  return data;
}

export async function cancelCharge(chargeId, reason) {
  const { data, error } = await supabase.rpc('cancel_charge', {
    p_charge_id: chargeId,
    p_reason: reason
  });

  if (error) throw normalizeFinancialError(error);
  return data;
}

export async function generateReceiptPdf(receiptId) {
  return requestReceiptPdf(receiptId, 'generate');
}

export async function getReceiptPdfUrl(receiptId) {
  return requestReceiptPdf(receiptId, 'view');
}

export async function downloadReceiptPdf(receiptId) {
  return requestReceiptPdf(receiptId, 'download');
}

export function groupAmountsByCurrency(rows, amountField = 'remaining_amount') {
  return rows.reduce((summary, row) => {
    const currency = row.currency || 'EUR';
    summary[currency] = (summary[currency] || 0) + Number(row[amountField] || 0);
    return summary;
  }, {});
}

async function requestReceiptPdf(receiptId, mode) {
  const { data, error } = await supabase.functions.invoke('generate-financial-receipt-pdf', {
    body: {
      receipt_id: receiptId,
      mode
    }
  });

  if (error) throw normalizeFinancialError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

function normalizeFinancialError(error) {
  return new Error(error?.message || 'Nao foi possivel processar o financeiro.');
}
