import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import {
  HttpError,
  jsonResponse,
  readJsonRequest,
  getAuthenticatedUser
} from '../_shared/first-access.ts';

const BUCKET = 'financial-documents';
const SIGNED_URL_TTL = 60 * 10;
const STAFF_ROLES = ['clinic_admin', 'finance', 'supervisor', 'reception'];
const DOCUMENT_TEMPLATE_VERSION = 'internal_payment_receipt_v1';

Deno.serve(async (req) => {
  let currentStep = 'request_start';
  try {
    currentStep = 'read_request';
    console.log('financial_receipt_pdf_step', 'request');
    const parsed = await readJsonRequest(req);
    if (parsed.response) return parsed.response;

    currentStep = 'authenticate';
    console.log('financial_receipt_pdf_step', 'authorization');
    const { user, serviceClient } = await getAuthenticatedUser(req);
    const { receipt_id: receiptId, mode = 'view' } = parsed.body as {
      receipt_id?: string;
      mode?: 'generate' | 'view' | 'download';
    };

    if (!receiptId) throw new HttpError('Informe o recibo.', 400);
    if (!['generate', 'view', 'download'].includes(mode)) throw new HttpError('Modo invalido.', 400);

    currentStep = 'load_receipt';
    const receipt = await loadReceipt(serviceClient, receiptId);
    console.log('financial_receipt_pdf_step', 'receipt_loaded');
    currentStep = 'assert_access';
    await assertAccess(serviceClient, user.id, receipt);

    currentStep = 'validate_receipt';
    if (receipt.status !== 'issued') throw new HttpError('Recibo indisponivel para PDF.', 409);
    if (receipt.payment?.payment_status !== 'confirmed') {
      throw new HttpError('Apenas pagamentos confirmados podem gerar comprovativo.', 409);
    }

    let storagePath = receipt.pdf_storage_path as string | null;
    let pdfHash = receipt.pdf_hash as string | null;

    if (!storagePath || !pdfHash) {
      currentStep = 'build_snapshots';
      const snapshots = buildSnapshots(receipt);
      console.log('financial_receipt_pdf_step', 'snapshots_built');
      currentStep = 'build_storage_path';
      storagePath = buildStoragePath(receipt);
      currentStep = 'render_pdf';
      console.log('financial_receipt_pdf_step', 'pdf_start');
      const logoAsset = await loadClinicLogo(serviceClient, snapshots.issuer.logo_url);
      const pdfBytes = await buildReceiptPdf(receipt, snapshots, logoAsset, (step) => {
        currentStep = `render_pdf.${step}`;
      });
      currentStep = 'hash_pdf';
      pdfHash = await sha256Hex(pdfBytes);

      currentStep = 'upload_pdf';
      const { error: uploadError } = await serviceClient.storage
        .from(BUCKET)
        .upload(storagePath, pdfBytes, {
          contentType: 'application/pdf',
          cacheControl: '31536000',
          upsert: false
        });

      if (uploadError && !String(uploadError.message || '').toLowerCase().includes('already exists')) {
        throw uploadError;
      }
      console.log('financial_receipt_pdf_step', 'uploaded');

      currentStep = 'finalize_pdf';
      const { data: finalized, error: finalizeError } = await serviceClient
        .schema('dozeclin')
        .rpc('finalize_financial_receipt_pdf', {
          p_receipt_id: receipt.id,
          p_document_template_version: DOCUMENT_TEMPLATE_VERSION,
          p_issuer_snapshot: snapshots.issuer,
          p_professional_snapshot: snapshots.professional,
          p_patient_snapshot: snapshots.patient,
          p_service_snapshot: snapshots.service,
          p_payment_snapshot: snapshots.payment,
          p_tax_snapshot: snapshots.tax,
          p_pdf_storage_path: storagePath,
          p_pdf_hash: pdfHash
        });

      if (finalizeError) throw finalizeError;
      storagePath = finalized.pdf_storage_path;
      pdfHash = finalized.pdf_hash;
      console.log('financial_receipt_pdf_step', 'finalized');
    }

    currentStep = 'create_signed_url';
    const { data: signed, error: signedError } = await serviceClient.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL, {
        download: mode === 'download' ? `${safeFileName(receipt.receipt_number)}.pdf` : undefined
      });

    if (signedError || !signed?.signedUrl) throw signedError || new Error('Falha ao gerar URL temporaria.');

    currentStep = 'audit_access';
    await auditAccess(serviceClient, receipt, user.id, mode);

    currentStep = 'response';
    return jsonResponse({
      receipt_id: receipt.id,
      receipt_number: receipt.receipt_number,
      pdf_storage_path: storagePath,
      pdf_hash: pdfHash,
      document_template_version: DOCUMENT_TEMPLATE_VERSION,
      signed_url: signed.signedUrl,
      expires_in: SIGNED_URL_TTL,
      mode
    });
  } catch (error) {
    const caughtError = error instanceof Error
      ? error
      : new Error(String(error));

    console.error('financial_receipt_pdf_error', JSON.stringify({
      step: currentStep,
      name: caughtError.name,
      message: caughtError.message,
      stack: caughtError.stack,
      code: (error as any)?.code ?? null
    }));

    return jsonResponse({
      error: 'Nao foi possivel gerar o comprovativo.',
      code: 'FINANCIAL_RECEIPT_PDF_GENERATION_FAILED'
    }, 500);
  }
});

async function loadReceipt(serviceClient: any, receiptId: string) {
  const { data, error } = await serviceClient
    .schema('dozeclin')
    .from('financial_receipts')
    .select(`
      *,
      payment:payment_id(*),
      charge:charge_id(*, appointment:appointment_id(*, professional:professional_id(*))),
      patient:patient_id(*),
      clinic:clinic_id(*)
    `)
    .eq('id', receiptId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new HttpError('Recibo nao encontrado.', 404);

  const { data: settings, error: settingsError } = await serviceClient
    .schema('dozeclin')
    .from('clinic_settings')
    .select('*')
    .eq('clinic_id', data.clinic_id)
    .maybeSingle();

  if (settingsError) throw settingsError;
  data.clinic_settings = settings;
  return data;
}

async function assertAccess(serviceClient: any, authUserId: string, receipt: any) {
  const { data: staff, error: staffError } = await serviceClient
    .schema('dozeclin')
    .from('profiles')
    .select('id, clinic_id, role, status')
    .eq('auth_user_id', authUserId)
    .eq('clinic_id', receipt.clinic_id)
    .eq('status', 'active')
    .maybeSingle();

  if (staffError) throw staffError;
  if (staff && STAFF_ROLES.includes(staff.role)) return;

  const { data: portal, error: portalError } = await serviceClient
    .schema('dozeclin')
    .from('patient_portals')
    .select('id, clinic_id, patient_id, status')
    .eq('auth_user_id', authUserId)
    .eq('clinic_id', receipt.clinic_id)
    .eq('patient_id', receipt.patient_id)
    .eq('status', 'active')
    .maybeSingle();

  if (portalError) throw portalError;
  if (portal) return;

  throw new HttpError('Sem permissao para este documento.', 403);
}

function buildSnapshots(receipt: any) {
  const clinic = receipt.clinic || {};
  const settings = receipt.clinic_settings || {};
  const patient = receipt.patient || {};
  const payment = receipt.payment || {};
  const charge = receipt.charge || {};
  const appointment = charge.appointment || null;
  const professional = appointment?.professional || null;
  const serviceDescription = resolveServiceDescription(charge, appointment, professional);
  const vatRate = Number(settings.vat_rate || 0);
  const taxRegime = settings.tax_regime || 'normal';
  const taxBase = Number(payment.amount || receipt.amount || 0);
  const vatAmount = taxRegime === 'normal' ? roundMoney(taxBase * (vatRate / 100)) : 0;
  const balanceAfter = Number(charge.remaining_amount || 0);
  const paymentAmount = Number(payment.amount || 0);
  const balanceBefore = roundMoney(balanceAfter + paymentAmount);

  return {
    issuer: {
      legal_name: settings.legal_name || clinic.legal_name || clinic.name,
      trade_name: clinic.name || null,
      name: settings.legal_name || clinic.legal_name || clinic.name,
      professional_title: professionalTitleLabel(clinic.specialty),
      tax_identifier: settings.tax_identifier || clinic.document || null,
      fiscal_address: settings.fiscal_address || clinic.address || null,
      fiscal_postal_code: settings.fiscal_postal_code || clinic.postal_code || null,
      fiscal_city: settings.fiscal_city || clinic.city || null,
      fiscal_country: settings.fiscal_country || clinic.country || null,
      address: settings.fiscal_address || clinic.address || null,
      postal_code: settings.fiscal_postal_code || clinic.postal_code || null,
      city: settings.fiscal_city || clinic.city || null,
      country: settings.fiscal_country || clinic.country || null,
      email: settings.financial_email || clinic.email || null,
      phone: clinic.phone || null,
      logo_url: settings.receipt_logo_url || clinic.logo_url || null,
      receipt_footer: settings.receipt_footer || settings.footer_text || null,
      fiscal_document_mode: settings.fiscal_document_mode || 'internal_only'
    },
    professional: professional ? {
      profile_id: professional.id || null,
      full_name: professional.full_name || null,
      name: professional.full_name || null,
      specialty: professional.specialty || null,
      display_title: professional.specialty || null,
      professional_registration: professional.professional_registration || null,
      tax_identifier: professional.tax_identifier || null,
      email: professional.email || null
    } : null,
    patient: {
      patient_id: patient.id || null,
      full_name: patient.full_name || null,
      name: patient.full_name || null,
      tax_identifier: patient.document || null,
      email: patient.email || null,
      address: patient.address || null,
      postal_code: patient.postal_code || null,
      city: patient.city || null,
      country: patient.country || null
    },
    service: {
      document_template_version: DOCUMENT_TEMPLATE_VERSION,
      description: serviceDescription,
      appointment_id: appointment?.id || null,
      appointment_date: appointment?.appointment_date || null,
      appointment_status: appointment?.status || null,
      scheduled_start: appointment?.scheduled_start || null,
      clinic_timezone: appointment?.clinic_timezone || null,
      patient_timezone_snapshot: appointment?.patient_timezone_snapshot || null,
      modality: appointment?.modality || null,
      expected_duration: appointment?.expected_duration || null,
      duration_minutes: appointment?.expected_duration || null,
      currency: receipt.currency,
      unit_price: charge.amount,
      discount_amount: charge.discount_amount,
      final_amount: charge.final_amount,
      charge_id: charge.id,
      charge_reference: charge.id,
      payment_timing: appointment && new Date(payment.payment_date).getTime() < new Date(appointment.scheduled_start).getTime()
        ? 'prepaid'
        : 'standard'
    },
    payment: {
      document_template_version: DOCUMENT_TEMPLATE_VERSION,
      receipt_id: receipt.id,
      receipt_number: receipt.receipt_number,
      payment_id: payment.id,
      charge_id: charge.id,
      amount: payment.amount,
      currency: payment.currency || receipt.currency,
      charge_amount: charge.amount,
      discount_amount: charge.discount_amount,
      final_amount: charge.final_amount,
      payment_amount: payment.amount,
      payment_method: payment.payment_method,
      payment_date: payment.payment_date,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      issued_at: receipt.issued_at,
      remaining_amount_after_payment: charge.remaining_amount,
      paid_amount_after_payment: charge.paid_amount
    },
    tax: {
      document_template_version: DOCUMENT_TEMPLATE_VERSION,
      tax_regime: taxRegime,
      regime: taxRegime,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      taxable_base: taxBase,
      total: roundMoney(taxBase + vatAmount),
      exemption_reason: taxRegime === 'normal' ? null : settings.vat_exemption_reason || taxRegimeLabel(taxRegime)
    }
  };
}

async function buildReceiptPdf(receipt: any, snapshots: any, logoAsset: any = null, setStep: (step: string) => void = () => {}) {
  setStep('create_document');
  const pdf = await PDFDocument.create();
  pdf.setTitle('Comprovativo de Pagamento');
  pdf.setSubject('Documento interno nao fiscal');
  pdf.setCreator('DOZECLIN');
  pdf.setProducer('DOZECLIN');
  pdf.setKeywords(['dozeclin', 'comprovativo-pagamento']);

  setStep('embed_fonts');
  const page = pdf.addPage([595.28, 841.89]);
  const PAGE_WIDTH = page.getWidth();
  const PAGE_HEIGHT = page.getHeight();
  const MARGIN_X = 28;
  const MARGIN_TOP = 28;
  const MARGIN_BOTTOM = 32;
  const FOOTER_HEIGHT = 34;
  const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN_X * 2);
  const SECTION_GAP = 16;
  const SMALL_GAP = 8;
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.12, 0.16, 0.20);
  const muted = rgb(0.34, 0.38, 0.42);
  const accent = rgb(0.04, 0.36, 0.46);
  const accentDark = rgb(0.03, 0.25, 0.32);
  const titleSoft = rgb(0.91, 0.97, 0.98);
  const soft = rgb(0.96, 0.98, 0.98);
  const zebra = rgb(0.985, 0.988, 0.99);
  const line = rgb(0.82, 0.86, 0.88);
  const fonts = { regular, bold };
  const colors = { dark, muted, accent, accentDark, titleSoft, soft, zebra, line };
  const bottomLimit = MARGIN_BOTTOM + FOOTER_HEIGHT + 12;

  let cursorTop = PAGE_HEIGHT - MARGIN_TOP;
  const ensureFits = (blockHeight: number, blockName: string) => {
    if (cursorTop - blockHeight < bottomLimit) {
      throw new Error(`Comprovativo financeiro excede a area util antes de desenhar ${blockName}.`);
    }
  };

  setStep('header');
  console.log('financial_receipt_pdf_step', 'header');
  const headerHeight = 162;
  ensureFits(headerHeight, 'cabecalho');
  await drawReceiptHeader(page, pdf, receipt, snapshots, logoAsset, {
    x: MARGIN_X,
    top: cursorTop,
    width: CONTENT_WIDTH,
    height: headerHeight
  }, fonts, colors);
  cursorTop -= headerHeight + SECTION_GAP;

  setStep('patient_box');
  console.log('financial_receipt_pdf_step', 'patient_box');
  const patientRows: [string, unknown][] = [
    ['', snapshots.patient.name],
    ['Documento', snapshots.patient.tax_identifier],
    ['Morada', joinAddress(snapshots.patient)],
    ['Email', snapshots.patient.email]
  ];

  const appointmentDate = snapshots.service.scheduled_start || snapshots.payment.payment_date;
  const serviceRows: [string, unknown][] = [
    ['Descricao', snapshots.service.description],
    ['Data', formatDateAtTime(appointmentDate)],
    ['Profissional', snapshots.professional?.name]
  ];
  const twoColumnGap = 16;
  const partyBoxWidth = (CONTENT_WIDTH - twoColumnGap) / 2;
  const partyHeight = Math.max(
    measurePartyBoxHeight(patientRows, partyBoxWidth, fonts),
    measurePartyBoxHeight(serviceRows, partyBoxWidth, fonts)
  );
  ensureFits(partyHeight, 'dados do paciente e servico');
  drawPartyBox(page, MARGIN_X, cursorTop, partyBoxWidth, partyHeight, 'DADOS DO PACIENTE', patientRows, fonts, colors);

  setStep('service_box');
  drawPartyBox(page, MARGIN_X + partyBoxWidth + twoColumnGap, cursorTop, partyBoxWidth, partyHeight, 'SERVICO', serviceRows, fonts, colors);
  cursorTop -= partyHeight + SECTION_GAP;

  setStep('service_table');
  console.log('financial_receipt_pdf_step', 'service_table');
  const tableRows = [[
    formatReceiptDate(appointmentDate),
    snapshots.service.description,
    snapshots.professional?.name || '-',
    '1',
    money(snapshots.payment.final_amount, receipt.currency)
  ]];
  const tableHeight = measureServiceTableHeight(tableRows, CONTENT_WIDTH, fonts);
  ensureFits(18 + SMALL_GAP + tableHeight, 'tabela de servicos');
  drawSectionTitle(page, 'Itens do servico', MARGIN_X, cursorTop, bold, accent);
  cursorTop -= 18 + SMALL_GAP;
  drawServiceTable(page, MARGIN_X, cursorTop, CONTENT_WIDTH, tableRows, fonts, colors);
  cursorTop -= tableHeight + SECTION_GAP;

  setStep('financial_summary');
  console.log('financial_receipt_pdf_step', 'financial_summary');
  const lowerGap = 16;
  const lowerColumnWidth = (CONTENT_WIDTH - lowerGap) / 2;
  const lowerHeight = 130;
  ensureFits(18 + SMALL_GAP + lowerHeight, 'resumo financeiro e pagamento');
  drawSectionTitle(page, 'Resumo financeiro', MARGIN_X, cursorTop, bold, accent);
  setStep('payment_info');
  console.log('financial_receipt_pdf_step', 'payment_details');
  drawSectionTitle(page, 'Informacoes do pagamento', MARGIN_X + lowerColumnWidth + lowerGap, cursorTop, bold, accent);
  cursorTop -= 18 + SMALL_GAP;
  drawFinancialSummary(page, MARGIN_X, cursorTop, lowerColumnWidth, lowerHeight, snapshots, receipt, fonts, colors);
  drawPaymentDetails(page, MARGIN_X + lowerColumnWidth + lowerGap, cursorTop, lowerColumnWidth, lowerHeight, [
    ['Metodo', paymentMethodLabel(snapshots.payment.payment_method)],
    ['Moeda', receipt.currency],
    ['Data', formatDateTime(snapshots.payment.payment_date)],
    ['IVA', money(snapshots.tax.vat_amount, receipt.currency)],
    ['Base tributavel', money(snapshots.tax.taxable_base, receipt.currency)],
    ['Situacao', 'Pago']
  ], fonts, colors);
  cursorTop -= lowerHeight + SECTION_GAP;

  setStep('authenticity_box');
  setStep('additional_info');
  const infoHeight = 72;
  const authHeight = 78;
  const bottomRowHeight = Math.max(infoHeight, authHeight);
  ensureFits(bottomRowHeight, 'informacoes adicionais e autenticidade');
  const professionalTitle = professionalTitleLabel(snapshots.professional?.display_title || snapshots.professional?.specialty);
  drawAdditionalInfo(page, MARGIN_X, cursorTop, lowerColumnWidth, bottomRowHeight, [
    'Este documento confirma o pagamento do atendimento descrito acima.',
    snapshots.professional?.name ? `Profissional: ${snapshots.professional.name}` : null,
    professionalTitle ? `Titulo: ${professionalTitle}` : null,
    snapshots.professional?.professional_registration ? `Registo profissional: ${snapshots.professional.professional_registration}` : null
  ].filter(Boolean).join('  '), fonts, colors);
  drawAuthenticityBox(page, MARGIN_X + lowerColumnWidth + lowerGap, cursorTop, lowerColumnWidth, bottomRowHeight, receipt.receipt_number, fonts, colors);
  cursorTop -= bottomRowHeight + SECTION_GAP;

  setStep('footer');
  console.log('financial_receipt_pdf_step', 'footer');
  drawFooter(page, MARGIN_X, MARGIN_BOTTOM, CONTENT_WIDTH, FOOTER_HEIGHT, fonts, colors);

  setStep('save_pdf');
  const bytes = await pdf.save();
  console.log('financial_receipt_pdf_step', 'pdf_saved');
  return bytes;
}

function resolveServiceDescription(charge: any, appointment: any, professional: any) {
  const text = `${professional?.specialty || ''} ${professional?.full_name || ''}`.toLowerCase();
  const rawDescription = String(charge.description || '').trim();
  const normalizedDescription = rawDescription.toLowerCase();

  if (text.includes('psican') || normalizedDescription.includes('psican')) return 'Sessao de psicanalise';
  if (text.includes('psycholog') || text.includes('psicol') || normalizedDescription.includes('psicol')) return 'Atendimento psicologico';
  if (text.includes('nutrition') || text.includes('nutri')) return 'Consulta de nutricao';
  if (text.includes('physio') || text.includes('fisio')) return 'Sessao de fisioterapia';
  if (text.includes('dent')) return 'Consulta de medicina dentaria';
  if (rawDescription && !/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(rawDescription)) return rawDescription;
  return 'Atendimento clinico';
}

async function loadClinicLogo(serviceClient: any, path: string | null) {
  if (!path) return null;

  try {
    let bytes: ArrayBuffer | null = null;
    let contentType = '';

    if (/^https?:\/\//i.test(path)) {
      const response = await fetch(path);
      if (!response.ok) return null;
      contentType = response.headers.get('content-type') || '';
      bytes = await response.arrayBuffer();
    } else {
      const { data, error } = await serviceClient.storage
        .from('document-assets')
        .download(path);
      if (error || !data) return null;
      contentType = data.type || '';
      bytes = await data.arrayBuffer();
    }

    const lowerPath = path.toLowerCase();
    const kind = contentType.includes('png') || lowerPath.endsWith('.png')
      ? 'png'
      : (contentType.includes('jpeg') || contentType.includes('jpg') || lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg') ? 'jpg' : null);

    if (!kind || !bytes) return null;
    return { bytes: new Uint8Array(bytes), kind };
  } catch (_error) {
    return null;
  }
}

async function drawPdfLogo(pdf: any, page: any, logoAsset: any, x: number, y: number, maxWidth: number, maxHeight: number) {
  const image = logoAsset.kind === 'png'
    ? await pdf.embedPng(logoAsset.bytes)
    : await pdf.embedJpg(logoAsset.bytes);
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: x + (maxWidth - width) / 2,
    y: y + (maxHeight - height) / 2,
    width,
    height
  });
}

function hasDisplayValue(value: unknown) {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== '';
}

function drawSectionTitle(page: any, title: string, x: number, y: number, font: any, color: any) {
  page.drawText(title, { x, y, size: 11.3, font, color });
}

async function drawReceiptHeader(page: any, pdf: any, receipt: any, snapshots: any, logoAsset: any, box: any, fonts: any, colors: any) {
  const { regular, bold } = fonts;
  const { dark, muted, accent, accentDark, titleSoft, line } = colors;
  const padding = 14;
  const headerLeftWidth = box.width * 0.52;
  const headerRightWidth = box.width - headerLeftWidth;
  const y = box.top - box.height;
  const splitX = box.x + headerLeftWidth;
  const logoBoxWidth = 64;
  const logoBoxHeight = 64;
  const logoX = box.x + padding;
  const logoY = box.top - padding - logoBoxHeight;
  const textX = logoX + logoBoxWidth + 14;
  const textWidth = headerLeftWidth - padding * 2 - logoBoxWidth - 14;
  const rightX = splitX + padding;
  const rightWidth = headerRightWidth - padding * 2;

  page.drawRectangle({ x: box.x, y, width: box.width, height: box.height, borderColor: line, borderWidth: 1, color: rgb(1, 1, 1), borderRadius: 6 });
  page.drawLine({ start: { x: splitX, y: y + 12 }, end: { x: splitX, y: box.top - 12 }, thickness: 0.7, color: line });

  const issuerInitial = sanitizePdfText(String(snapshots.issuer.name || 'D').trim().charAt(0).toUpperCase() || 'D');
  page.drawRectangle({ x: logoX, y: logoY, width: logoBoxWidth, height: logoBoxHeight, borderColor: accent, borderWidth: 1, color: titleSoft, borderRadius: 10 });
  if (logoAsset) {
    await drawPdfLogo(pdf, page, logoAsset, logoX + 6, logoY + 6, logoBoxWidth - 12, logoBoxHeight - 12);
  } else {
    page.drawText(issuerInitial, { x: logoX + 23, y: logoY + 24, size: 24, font: bold, color: accentDark });
  }

  const clinicName = snapshots.issuer.trade_name || snapshots.issuer.name || 'DOZECLIN';
  const clinicNameSize = fitTextToWidth(clinicName, bold, textWidth, 18, 12);
  drawWrappedText(page, clinicName, textX, box.top - padding - 6, textWidth, clinicNameSize, bold, accentDark, 2);
  page.drawText(sanitizePdfText(snapshots.issuer.professional_title || 'Documento interno nao fiscal'), {
    x: textX,
    y: box.top - padding - 44,
    size: 10,
    font: regular,
    color: muted
  });
  drawWrappedText(page, joinAddress(snapshots.issuer), box.x + padding, logoY - 14, headerLeftWidth - padding * 2, 8.8, regular, dark, 2);
  drawWrappedText(page, [
    snapshots.issuer.phone ? `Telefone: ${snapshots.issuer.phone}` : null,
    snapshots.issuer.email ? `Email: ${snapshots.issuer.email}` : null,
    snapshots.issuer.tax_identifier ? `NIF: ${snapshots.issuer.tax_identifier}` : null
  ].filter(Boolean).join('  '), box.x + padding, logoY - 42, headerLeftWidth - padding * 2, 8.2, regular, muted, 3);

  page.drawRectangle({ x: rightX - 1, y: box.top - padding - 42, width: rightWidth + 2, height: 42, color: titleSoft, borderRadius: 6 });
  drawWrappedText(page, 'COMPROV. PAGAMENTO', rightX + 2, box.top - padding - 13, rightWidth - 4, 16.5, bold, accentDark, 2);
  drawHeaderPair(page, 'Numero', receipt.receipt_number, rightX, box.top - padding - 58, rightWidth, fonts, colors);
  drawHeaderPair(page, 'Emissao', formatDateTime(receipt.issued_at), rightX, box.top - padding - 78, rightWidth, fonts, colors);
  drawHeaderPair(page, 'Moeda', receipt.currency, rightX, box.top - padding - 98, rightWidth, fonts, colors);
  page.drawText('Situacao', { x: rightX, y: box.top - padding - 118, size: 8.4, font: bold, color: muted });
  page.drawRectangle({ x: rightX + 82, y: box.top - padding - 123, width: 54, height: 18, borderRadius: 9, color: rgb(0.28, 0.67, 0.35) });
  page.drawText('PAGO', { x: rightX + 95, y: box.top - padding - 118, size: 7.8, font: bold, color: rgb(1, 1, 1) });
  drawHeaderPair(page, 'Codigo', receipt.receipt_number, rightX, box.top - padding - 142, rightWidth, fonts, colors);
}

function drawHeaderPair(page: any, label: string, value: unknown, x: number, y: number, width: number, fonts: any, colors: any) {
  page.drawText(label, { x, y, size: 8.4, font: fonts.bold, color: colors.muted });
  const text = sanitizePdfText(formatValue(value));
  const valueSize = fitTextToWidth(text, fonts.bold, width - 88, 8.8, 7.4);
  page.drawText(text, { x: x + 88, y, size: valueSize, font: fonts.bold, color: colors.dark });
}

function measurePartyBoxHeight(rows: [string, unknown][], width: number, fonts: any) {
  const padding = 12;
  const contentWidth = width - padding * 2;
  const rowHeight = rows
    .filter(([, value]) => hasDisplayValue(value))
    .reduce((total, [label, value]) => {
      if (!label) {
        return total + measureWrappedTextHeight(formatValue(value), contentWidth, 10.6, fonts.bold, 1) + 14;
      }

      return total + 8 + 5 + measureWrappedTextHeight(formatValue(value), contentWidth, 8.8, fonts.regular, label === 'Morada' ? 2 : 1) + 11;
    }, 0);
  return Math.max(120, 34 + rowHeight + padding);
}

function drawPartyBox(page: any, x: number, top: number, width: number, height: number, title: string, rows: [string, unknown][], fonts: any, colors: any) {
  const padding = 12;
  const y = top - height;
  const contentWidth = width - padding * 2;
  page.drawRectangle({ x, y, width, height, borderColor: colors.line, borderWidth: 1, color: rgb(1, 1, 1), borderRadius: 6 });
  page.drawRectangle({ x: x + 1, y: top - 31, width: width - 2, height: 30, color: colors.titleSoft, borderRadius: 6 });
  page.drawText(title, { x: x + padding, y: top - 20, size: 10.7, font: fonts.bold, color: colors.accent });

  let cursorY = top - 47;
  rows
    .filter(([, value]) => hasDisplayValue(value))
    .forEach(([label, value]) => {
      if (!label) {
        drawWrappedText(page, formatValue(value), x + padding, cursorY, contentWidth, 10.6, fonts.bold, colors.dark, 1);
        cursorY -= 25;
        return;
      }

      page.drawText(label, { x: x + padding, y: cursorY, size: 7.8, font: fonts.bold, color: colors.muted });
      cursorY -= 12;
      const maxLines = label === 'Morada' ? 2 : 1;
      const usedLines = drawWrappedText(page, formatValue(value), x + padding, cursorY, contentWidth, 8.8, fonts.regular, colors.dark, maxLines);
      cursorY -= usedLines * (8.8 + 3) + 10;
    });
}

function measureServiceTableHeight(rows: unknown[][], width: number, fonts: any) {
  const widths = tableColumnWidths(width);
  const headerHeight = 27;
  const rowHeights = rows.map((row) => Math.max(
    34,
    ...row.map((cell, index) => {
      if (index >= 3) return 34;
      return measureWrappedTextHeight(formatValue(cell), widths[index] - 18, 8.5, index === 0 ? fonts.bold : fonts.regular, 2) + 16;
    })
  ));
  return headerHeight + rowHeights.reduce((sum, height) => sum + height, 0);
}

function drawServiceTable(page: any, x: number, top: number, width: number, rows: unknown[][], fonts: any, colors: any) {
  const widths = tableColumnWidths(width);
  const headers = ['DATA', 'DESCRICAO', 'PROFISSIONAL', 'QTD.', 'TOTAL'];
  const headerHeight = 27;
  page.drawRectangle({ x, y: top - headerHeight, width, height: headerHeight, color: colors.accentDark, borderRadius: 4 });
  let cellX = x;
  headers.forEach((header, index) => {
    const textWidth = fonts.bold.widthOfTextAtSize(header, 8.2);
    const alignX = index >= 3 ? cellX + (widths[index] - textWidth) / 2 : cellX + 9;
    page.drawText(header, { x: alignX, y: top - 17, size: 8.2, font: fonts.bold, color: rgb(1, 1, 1) });
    cellX += widths[index];
  });

  let rowTop = top - headerHeight;
  rows.forEach((row, rowIndex) => {
    const rowHeight = Math.max(
      34,
      ...row.map((cell, index) => {
        if (index >= 3) return 34;
        return measureWrappedTextHeight(formatValue(cell), widths[index] - 18, 8.5, index === 0 ? fonts.bold : fonts.regular, 2) + 16;
      })
    );
    const rowY = rowTop - rowHeight;
    page.drawRectangle({ x, y: rowY, width, height: rowHeight, borderColor: colors.line, borderWidth: 0.5, color: rowIndex % 2 === 0 ? rgb(1, 1, 1) : colors.zebra });
    let itemX = x;
    row.forEach((cell, index) => {
      const text = formatValue(cell);
      const font = index === 0 || index === 4 ? fonts.bold : fonts.regular;
      const size = 8.5;
      if (index === 3) {
        const textWidth = font.widthOfTextAtSize(text, size);
        page.drawText(sanitizePdfText(text), { x: itemX + (widths[index] - textWidth) / 2, y: rowTop - 21, size, font, color: colors.dark });
      } else if (index === 4) {
        const textWidth = font.widthOfTextAtSize(text, size);
        page.drawText(sanitizePdfText(text), { x: itemX + widths[index] - textWidth - 9, y: rowTop - 21, size, font, color: colors.dark });
      } else {
        drawWrappedText(page, text, itemX + 9, rowTop - 16, widths[index] - 18, size, font, colors.dark, 2);
      }
      itemX += widths[index];
    });
    rowTop -= rowHeight;
  });
}

function tableColumnWidths(width: number) {
  return [
    width * 0.15,
    width * 0.40,
    width * 0.23,
    width * 0.08,
    width * 0.14
  ];
}

function drawFinancialSummary(page: any, x: number, top: number, width: number, height: number, snapshots: any, receipt: any, fonts: any, colors: any) {
  const y = top - height;
  const padding = 14;
  const rows = [
    ['Subtotal', money(snapshots.payment.final_amount, receipt.currency)],
    ['Desconto', money(snapshots.payment.discount_amount, receipt.currency)],
    ['Pago', money(snapshots.payment.payment_amount, receipt.currency)],
    ['Saldo', money(snapshots.payment.remaining_amount_after_payment, receipt.currency)]
  ];
  page.drawRectangle({ x, y, width, height, borderColor: colors.line, borderWidth: 1, color: rgb(1, 1, 1), borderRadius: 6 });
  let cursorY = top - padding - 4;
  rows.forEach(([label, value]) => {
    drawSummaryRow(page, label, value, x + padding, cursorY, width - padding * 2, fonts, colors);
    cursorY -= 22;
  });
  const totalHeight = 38;
  page.drawRectangle({ x: x + 1, y: y + 1, width: width - 2, height: totalHeight, borderColor: colors.line, borderWidth: 0.6, color: colors.titleSoft, borderRadius: 6 });
  page.drawText('TOTAL', { x: x + padding, y: y + 15, size: 12, font: fonts.bold, color: colors.accentDark });
  const total = money(snapshots.payment.payment_amount, receipt.currency);
  const totalSize = fitTextToWidth(total, fonts.bold, width - padding * 2 - 80, 16, 12);
  const totalWidth = fonts.bold.widthOfTextAtSize(total, totalSize);
  page.drawText(total, { x: x + width - padding - totalWidth, y: y + 12, size: totalSize, font: fonts.bold, color: colors.accentDark });
}

function drawSummaryRow(page: any, label: string, value: string, x: number, y: number, width: number, fonts: any, colors: any) {
  page.drawLine({ start: { x, y: y - 7 }, end: { x: x + width, y: y - 7 }, thickness: 0.4, color: colors.line });
  page.drawText(label, { x, y, size: 8.8, font: fonts.regular, color: colors.dark });
  const valueWidth = fonts.bold.widthOfTextAtSize(value, 8.8);
  page.drawText(value, { x: x + width - valueWidth, y, size: 8.8, font: fonts.bold, color: colors.dark });
}

function drawPaymentDetails(page: any, x: number, top: number, width: number, height: number, items: [string, string][], fonts: any, colors: any) {
  const y = top - height;
  const padding = 14;
  const columnGap = 16;
  const columnWidth = (width - padding * 2 - columnGap) / 2;
  page.drawRectangle({ x, y, width, height, borderColor: colors.line, borderWidth: 1, color: rgb(1, 1, 1), borderRadius: 6 });
  items.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const itemX = x + padding + column * (columnWidth + columnGap);
    const itemY = top - padding - row * 34 - 5;
    page.drawText(label, { x: itemX, y: itemY, size: 8, font: fonts.bold, color: colors.muted });
    drawWrappedText(page, value, itemX, itemY - 13, columnWidth, 8.8, fonts.regular, colors.dark, 1);
  });
}

function drawAdditionalInfo(page: any, x: number, top: number, width: number, height: number, text: string, fonts: any, colors: any) {
  const y = top - height;
  const padding = 14;
  page.drawRectangle({ x, y, width, height, borderColor: colors.line, borderWidth: 1, color: rgb(1, 1, 1), borderRadius: 6 });
  page.drawText('Informacoes adicionais', { x: x + padding, y: top - padding - 2, size: 10.5, font: fonts.bold, color: colors.accent });
  drawWrappedText(page, text, x + padding, top - padding - 22, width - padding * 2, 8.4, fonts.regular, colors.muted, 3);
}

function drawAuthenticityBox(page: any, x: number, top: number, width: number, height: number, receiptNumber: string, fonts: any, colors: any) {
  const y = top - height;
  const padding = 14;
  page.drawRectangle({ x, y, width, height, borderColor: colors.line, borderWidth: 1, color: rgb(1, 1, 1), borderRadius: 6 });
  page.drawCircle({ x: x + padding + 9, y: top - padding - 11, size: 10, borderColor: colors.accent, borderWidth: 1, color: colors.titleSoft });
  page.drawText('OK', { x: x + padding + 3, y: top - padding - 14, size: 6.8, font: fonts.bold, color: colors.accentDark });
  page.drawText('Documento autenticado.', { x: x + padding + 28, y: top - padding - 6, size: 10.6, font: fonts.bold, color: colors.accentDark });
  page.drawText('Codigo de validacao', { x: x + padding + 28, y: top - padding - 27, size: 8, font: fonts.bold, color: colors.muted });
  page.drawText(sanitizePdfText(receiptNumber), { x: x + padding + 28, y: top - padding - 43, size: 11.2, font: fonts.bold, color: colors.dark });
}

function drawFooter(page: any, x: number, bottom: number, width: number, height: number, fonts: any, colors: any) {
  const top = bottom + height;
  page.drawLine({ start: { x, y: top }, end: { x: x + width, y: top }, thickness: 0.8, color: colors.line });
  drawWrappedText(page, 'Documento emitido eletronicamente pelo DOZECLIN. Este comprovativo confirma o pagamento realizado e nao substitui documento fiscal quando exigido pela legislacao aplicavel.', x, top - 13, width - 110, 7.4, fonts.regular, colors.muted, 2);
  page.drawText('Pagina 1 de 1', { x: x + width - 66, y: bottom + 10, size: 8, font: fonts.regular, color: colors.muted });
}

function fitTextToWidth(text: unknown, font: any, maxWidth: number, maxSize: number, minSize: number) {
  const sanitized = sanitizePdfText(formatValue(text));
  let size = maxSize;
  while (size > minSize && font.widthOfTextAtSize(sanitized, size) > maxWidth) {
    size -= 0.5;
  }
  return size;
}

function measureWrappedTextHeight(text: unknown, maxWidth: number, size: number, font: any, maxLines = 3) {
  const lines = wrapText(text, maxWidth, size, font).slice(0, maxLines);
  return Math.max(size, lines.length * (size + 3) - 3);
}

function drawWrappedText(page: any, text: unknown, x: number, y: number, maxWidth: number, size: number, font: any, color: any, maxLines = 3) {
  const lines = wrapText(text, maxWidth, size, font).slice(0, maxLines);
  lines.forEach((line, index) => {
    page.drawText(line, { x, y: y - index * (size + 3), size, font, color });
  });
  return lines.length;
}

function wrapText(text: unknown, maxWidth: number, size: number, font: any) {
  const words = sanitizePdfText(formatValue(text)).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
      lines.push(current);
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        lines.push(...splitLongWord(word, maxWidth, size, font));
        current = '';
      } else {
        current = word;
      }
    } else if (font.widthOfTextAtSize(word, size) > maxWidth) {
      lines.push(...splitLongWord(word, maxWidth, size, font));
      current = '';
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function splitLongWord(word: string, maxWidth: number, size: number, font: any) {
  const pieces: string[] = [];
  let current = '';
  [...word].forEach((char) => {
    const next = `${current}${char}`;
    if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
      pieces.push(current);
      current = char;
    } else {
      current = next;
    }
  });
  if (current) pieces.push(current);
  return pieces;
}

function buildStoragePath(receipt: any) {
  const year = new Date(receipt.issued_at || Date.now()).getUTCFullYear();
  return `${receipt.clinic_id}/${receipt.patient_id}/${year}/${receipt.id}.pdf`;
}

async function sha256Hex(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function auditAccess(serviceClient: any, receipt: any, userId: string, mode: string) {
  const action = mode === 'download' ? 'financial.receipt_pdf_downloaded' : 'financial.receipt_pdf_viewed';
  const { error } = await serviceClient
    .schema('dozeclin')
    .from('audit_logs')
    .insert({
      clinic_id: receipt.clinic_id,
      user_id: userId,
      action,
      entity: 'financial_receipts',
      entity_id: receipt.id,
      new_data: {
        receipt_number: receipt.receipt_number,
        mode
      }
    });
  if (error) console.error('audit_receipt_pdf_access_failed', { code: error.code });
}

function formatDateTime(value: unknown) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Lisbon'
  }).format(new Date(String(value)));
}

function formatReceiptDate(value: unknown) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Lisbon'
  }).format(new Date(String(value)));
}

function formatDateAtTime(value: unknown) {
  if (!value) return '-';
  const time = formatTime(value).replace(':', 'h');
  return `${formatReceiptDate(value)} as ${time}`;
}

function formatTime(value: unknown) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Lisbon'
  }).format(new Date(String(value)));
}

function money(value: unknown, currency: string) {
  const amount = new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
  return `${amount} ${currency}`;
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function joinAddress(data: Record<string, unknown>) {
  return [data.address, data.postal_code, data.city, data.country].filter(Boolean).join(', ') || '-';
}

function taxRegimeLabel(regime: string) {
  const labels: Record<string, string> = {
    normal: 'Regime normal de IVA',
    exempt_article_9: 'Isento ao abrigo do artigo 9.º do CIVA',
    exempt_article_53: 'Regime de isenção do artigo 53.º do CIVA',
    other: 'Outro enquadramento'
  };
  return labels[regime] || labels.normal;
}

function paymentMethodLabel(method: string) {
  const labels: Record<string, string> = {
    cash: 'Dinheiro',
    bank_transfer: 'Transferência bancária',
    card: 'Cartão',
    pix: 'PIX',
    mb_way: 'MB Way',
    stripe: 'Stripe',
    paypal: 'PayPal',
    other: 'Outro'
  };
  return labels[method] || method || '-';
}

function modalityLabel(value: unknown) {
  const labels: Record<string, string> = {
    online: 'Online',
    presential: 'Presencial',
    in_person: 'Presencial',
    hybrid: 'Hibrido'
  };
  const key = String(value || '').trim();
  return labels[key] || key || '-';
}

function professionalTitleLabel(value: unknown) {
  const labels: Record<string, string> = {
    psychoanalysis: 'Psicanalista',
    psychology: 'Psicologo(a)',
    dentistry: 'Medico(a) Dentista',
    nutrition: 'Nutricionista',
    physiotherapy: 'Fisioterapeuta',
    pediatrics: 'Pediatra',
    psychiatry: 'Psiquiatra',
    multidisciplinary: 'Profissional de Saude',
    general: 'Profissional de Saude',
    other: 'Profissional'
  };
  const key = String(value || '').trim();
  return labels[key] || key || null;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function safeFileName(value: string) {
  return String(value || 'recibo').replace(/[^A-Za-z0-9_-]+/g, '-');
}

function sanitizePdfText(value: string) {
  return String(value || '').replace(/[^\u0009\u000A\u000D\u0020-\u00FF]/g, '-').slice(0, 180);
}
