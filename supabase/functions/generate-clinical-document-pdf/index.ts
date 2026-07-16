import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import {
  handleError,
  HttpError,
  jsonResponse,
  readJsonRequest,
  getAuthenticatedUser
} from '../_shared/first-access.ts';

const BUCKET = 'clinical-documents';
const ASSETS_BUCKET = 'document-assets';
const SIGNED_URL_TTL = 60 * 10;
const DOCUMENT_TEMPLATE_VERSION = 'clinical_document_v1';
const STAFF_ROLES = ['clinic_admin', 'supervisor', 'professional', 'reception'];
const GENERATOR_ROLES = ['clinic_admin', 'supervisor', 'professional'];

Deno.serve(async (req) => {
  try {
    const parsed = await readJsonRequest(req);
    if (parsed.response) return parsed.response;

    const { user, serviceClient } = await getAuthenticatedUser(req);
    const { document_id: documentId, mode = 'view' } = parsed.body as {
      document_id?: string;
      mode?: 'generate' | 'view' | 'download' | 'print';
    };

    if (!documentId) throw new HttpError('Informe o documento.', 400);
    if (!['generate', 'view', 'download', 'print'].includes(mode)) throw new HttpError('Modo invalido.', 400);

    let documentRow = await loadDocument(serviceClient, documentId);
    const access = await resolveAccess(serviceClient, user.id, documentRow);
    if (mode === 'generate' && !access.canGenerate) {
      throw new HttpError('Sem permissao para gerar PDF clinico.', 403);
    }

    let storagePath = documentRow.current_pdf_path as string | null;
    let pdfHash = documentRow.current_pdf_hash as string | null;

    if (!storagePath || !pdfHash) {
      if (!access.canGenerate) {
        throw new HttpError('Documento em preparacao.', 409);
      }
      assertGeneratable(documentRow);

      assertSnapshotCompleteness(documentRow);
      storagePath = buildStoragePath(documentRow);
      const qrSvg = await loadQrSvg(serviceClient, documentRow.id);
      const logoAsset = await loadClinicLogo(serviceClient, documentRow);
      const signatureImage = await loadProfessionalSignatureImage(serviceClient, documentRow);
      const pdfBytes = await buildClinicalDocumentPdf(documentRow, qrSvg, logoAsset, signatureImage);
      pdfHash = await sha256Hex(pdfBytes);

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

      const { data: finalized, error: finalizeError } = await serviceClient
        .schema('dozeclin')
        .rpc('finalize_clinical_document_pdf', {
          p_document_id: documentRow.id,
          p_pdf_storage_path: storagePath,
          p_pdf_hash: pdfHash,
          p_document_template_version: DOCUMENT_TEMPLATE_VERSION
        });

      if (finalizeError) throw finalizeError;
      documentRow = finalized;
      storagePath = finalized.current_pdf_path;
      pdfHash = finalized.current_pdf_hash;
    }

    const { data: signed, error: signedError } = await serviceClient.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL, {
        download: mode === 'download' ? `${safeFileName(documentRow.document_number)}.pdf` : undefined
      });

    if (signedError || !signed?.signedUrl) throw signedError || new Error('Falha ao gerar URL temporaria.');

    await auditPdfAccess(serviceClient, documentRow, user.id, access.audience, mode);

    return jsonResponse({
      document_id: documentRow.id,
      document_number: documentRow.document_number,
      current_pdf_hash: pdfHash,
      current_pdf_template_version: documentRow.current_pdf_template_version || DOCUMENT_TEMPLATE_VERSION,
      signed_url: signed.signedUrl,
      expires_in: SIGNED_URL_TTL,
      mode
    });
  } catch (error) {
    if (error instanceof SnapshotIncompleteError) {
      return jsonResponse({
        error: 'O documento nao possui todos os dados necessarios para gerar o PDF.',
        code: 'DOCUMENT_SNAPSHOT_INCOMPLETE',
        missing_fields: error.missingFields
      }, 409);
    }
    return handleError(error, 'generate-clinical-document-pdf');
  }
});

async function loadDocument(serviceClient: any, documentId: string) {
  const { data, error } = await serviceClient
    .schema('dozeclin')
    .from('clinical_documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new HttpError('Documento nao encontrado.', 404);
  return data;
}

async function resolveAccess(serviceClient: any, authUserId: string, documentRow: any) {
  const { data: staff, error: staffError } = await serviceClient
    .schema('dozeclin')
    .from('profiles')
    .select('id, clinic_id, role, status')
    .eq('auth_user_id', authUserId)
    .eq('clinic_id', documentRow.clinic_id)
    .eq('status', 'active')
    .maybeSingle();

  if (staffError) throw staffError;
  if (staff) await assertClinicAvailable(serviceClient, documentRow.clinic_id);
  if (staff && STAFF_ROLES.includes(staff.role)) {
    return {
      audience: 'staff',
      canGenerate: GENERATOR_ROLES.includes(staff.role)
    };
  }

  const { data: portal, error: portalError } = await serviceClient
    .schema('dozeclin')
    .from('patient_portals')
    .select('id, clinic_id, patient_id, status')
    .eq('auth_user_id', authUserId)
    .eq('clinic_id', documentRow.clinic_id)
    .eq('patient_id', documentRow.patient_id)
    .eq('status', 'active')
    .maybeSingle();

  if (portalError) throw portalError;
  if (portal) await assertClinicAvailable(serviceClient, documentRow.clinic_id);
  if (
    portal
    && documentRow.visibility === 'patient'
    && documentRow.patient_access_enabled === true
    && ['issued', 'revoked'].includes(documentRow.status)
  ) {
    return { audience: 'patient', canGenerate: false };
  }

  throw new HttpError('Sem permissao para este documento.', 403);
}

async function assertClinicAvailable(serviceClient: any, clinicId: string) {
  const { data, error } = await serviceClient
    .schema('dozeclin')
    .from('clinics')
    .select('id, status')
    .eq('id', clinicId)
    .maybeSingle();

  if (error) throw error;
  if (!data || !['trial', 'active'].includes(data.status)) {
    throw new HttpError('Clinica indisponivel.', 403);
  }
}

function assertGeneratable(documentRow: any) {
  if (documentRow.status !== 'issued') throw new HttpError('Documento indisponivel para PDF.', 409);
  if (documentRow.signature_status !== 'signed') throw new HttpError('Documento precisa estar assinado.', 409);
  if (!documentRow.document_hash) throw new HttpError('Documento sem hash definitivo.', 409);
}

class SnapshotIncompleteError extends Error {
  missingFields: string[];

  constructor(missingFields: string[]) {
    super('DOCUMENT_SNAPSHOT_INCOMPLETE');
    this.missingFields = missingFields;
  }
}

function assertSnapshotCompleteness(documentRow: any) {
  if (documentRow.document_type !== 'attendance_certificate') return;

  const patient = documentRow.patient_snapshot || {};
  const professional = documentRow.professional_snapshot || {};
  const clinic = documentRow.clinic_snapshot || {};
  const content = documentRow.content_snapshot || {};
  const signature = documentRow.signature_snapshot || {};
  const missing = [
    hasAny(patient, ['full_name', 'name']) ? null : 'patient_snapshot.full_name',
    hasAny(patient, ['address']) ? null : 'patient_snapshot.address',
    hasAny(professional, ['full_name', 'name']) ? null : 'professional_snapshot.full_name',
    hasAny(professional, ['display_title', 'specialty_code', 'specialty']) ? null : 'professional_snapshot.display_title',
    hasAny(professional, ['professional_registration']) ? null : 'professional_snapshot.professional_registration',
    hasAny(clinic, ['name', 'trade_name', 'legal_name']) ? null : 'clinic_snapshot.name',
    hasAny(clinic, ['tax_number', 'tax_identifier', 'document']) ? null : 'clinic_snapshot.tax_number',
    hasAny(clinic, ['address']) ? null : 'clinic_snapshot.address',
    hasAny(clinic, ['phone']) ? null : 'clinic_snapshot.phone',
    hasAny(clinic, ['email', 'contact_email']) ? null : 'clinic_snapshot.email',
    hasAny(clinic, ['timezone']) || hasAny(content, ['timezone', 'clinic_timezone']) ? null : 'clinic_snapshot.timezone',
    hasAny(content, ['scheduled_start']) ? null : 'content_snapshot.scheduled_start',
    hasAny(content, ['scheduled_end']) ? null : 'content_snapshot.scheduled_end',
    hasAny(signature, ['signed_at']) || documentRow.signed_at ? null : 'signature_snapshot.signed_at',
    hasAny(signature, ['signer_name', 'professional_name']) ? null : 'signature_snapshot.signer_name',
    hasAny(signature, ['display_title', 'specialty_code', 'specialty']) ? null : 'signature_snapshot.display_title',
    hasAny(signature, ['professional_registration']) ? null : 'signature_snapshot.professional_registration'
  ].filter(Boolean) as string[];

  if (missing.length) throw new SnapshotIncompleteError(missing);
}

function buildStoragePath(documentRow: any) {
  return `${documentRow.clinic_id}/${documentRow.patient_id}/${documentRow.id}/v${documentRow.current_version}/document.pdf`;
}

async function loadQrSvg(serviceClient: any, documentId: string) {
  const { data, error } = await serviceClient.storage
    .from(ASSETS_BUCKET)
    .download(`${documentId}/validation-qr.svg`);
  if (error || !data) return null;
  return await data.text();
}

async function buildClinicalDocumentPdf(documentRow: any, qrSvg: string | null, logoAsset: any = null, signatureImage: any = null) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(resolveDocumentTitle(documentRow));
  pdf.setSubject('Documento clinico');
  pdf.setCreator('DOZECLIN');
  pdf.setProducer('DOZECLIN');
  pdf.setKeywords(['dozeclin', 'documento-clinico']);

  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const PAGE_WIDTH = page.getWidth();
  const PAGE_HEIGHT = page.getHeight();
  const MARGIN_X = 28;
  const MARGIN_TOP = 28;
  const MARGIN_BOTTOM = 30;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
  const FOOTER_HEIGHT = 42;
  const SECTION_GAP = 18;
  const SMALL_GAP = 10;
  const fonts = { regular, bold };
  const colors = {
    dark: rgb(0.09, 0.13, 0.20),
    muted: rgb(0.37, 0.42, 0.48),
    accent: rgb(0.03, 0.33, 0.42),
    accentSoft: rgb(0.91, 0.97, 0.98),
    gold: rgb(0.78, 0.58, 0.17),
    goldSoft: rgb(1, 0.97, 0.91),
    line: rgb(0.81, 0.89, 0.91),
    white: rgb(1, 1, 1)
  };

  const clinic = documentRow.clinic_snapshot || {};
  const patient = documentRow.patient_snapshot || {};
  const professional = documentRow.professional_snapshot || {};
  const signature = documentRow.signature_snapshot || {};
  const content = documentRow.content_snapshot || {};
  const period = resolveAppointmentPeriod(documentRow, content, patient, clinic);
  let cursorTop = PAGE_HEIGHT - MARGIN_TOP;

  await drawClinicalDocumentHeader(page, pdf, documentRow, clinic, logoAsset, {
    x: MARGIN_X,
    top: cursorTop,
    width: CONTENT_WIDTH,
    height: 138
  }, fonts, colors);
  cursorTop -= 138 + SECTION_GAP;

  drawPatientIdentification(page, {
    x: MARGIN_X,
    top: cursorTop,
    width: CONTENT_WIDTH,
    height: 102
  }, patient, fonts, colors);
  cursorTop -= 102 + SECTION_GAP;

  drawAttendanceSummary(page, {
    x: MARGIN_X,
    top: cursorTop,
    width: CONTENT_WIDTH,
    height: 68
  }, period, fonts, colors);
  cursorTop -= 68 + SECTION_GAP + 8;

  const declarationText = resolveContentText(documentRow, content, patient, professional, signature, clinic);
  const declarationHeight = measureDeclarationTextHeight(declarationText, CONTENT_WIDTH - 60, fonts) + 54;
  drawDeclarationText(page, {
    x: MARGIN_X + 18,
    top: cursorTop,
    width: CONTENT_WIDTH - 36,
    height: declarationHeight
  }, declarationText, fonts, colors);
  cursorTop -= declarationHeight + SECTION_GAP;

  const issueLocationDate = `Emitido em ${clinic.city || clinic.locality || 'Localidade'}, ${formatDateLong(documentRow.issued_at || documentRow.created_at, period.timezone)}.`;
  centerText(page, issueLocationDate, PAGE_WIDTH / 2, cursorTop - 2, 9.3, regular, colors.dark);
  cursorTop -= 48;

  await drawSignatureBlock(page, pdf, {
    x: MARGIN_X + 88,
    top: cursorTop,
    width: CONTENT_WIDTH - 176,
    height: 180
  }, documentRow, professional, signature, signatureImage, fonts, colors);

  drawClinicalFooter(page, {
    x: MARGIN_X,
    bottom: MARGIN_BOTTOM,
    width: CONTENT_WIDTH,
    height: FOOTER_HEIGHT
  }, documentRow, Boolean(qrSvg), fonts, colors);

  return await pdf.save();
}

async function loadClinicLogo(serviceClient: any, documentRow: any) {
  const snapshotLogo = documentRow.clinic_snapshot?.document_logo_url
    || documentRow.clinic_snapshot?.logo_url
    || documentRow.institutional_snapshot?.document_logo_url
    || documentRow.institutional_snapshot?.logo_url
    || null;
  let logoPath = snapshotLogo;

  if (!logoPath) {
    const { data: settings } = await serviceClient
      .schema('dozeclin')
      .from('clinic_settings')
      .select('receipt_logo_url')
      .eq('clinic_id', documentRow.clinic_id)
      .maybeSingle();

    const { data: clinic } = await serviceClient
      .schema('dozeclin')
      .from('clinics')
      .select('logo_url')
      .eq('id', documentRow.clinic_id)
      .maybeSingle();

    logoPath = settings?.receipt_logo_url || clinic?.logo_url || null;
  }

  if (!logoPath) return null;

  try {
    let bytes: ArrayBuffer | null = null;
    let contentType = '';

    if (/^https?:\/\//i.test(String(logoPath))) {
      const response = await fetch(String(logoPath));
      if (!response.ok) return null;
      contentType = response.headers.get('content-type') || '';
      bytes = await response.arrayBuffer();
    } else {
      const { data, error } = await serviceClient.storage
        .from(ASSETS_BUCKET)
        .download(String(logoPath));
      if (error || !data) return null;
      contentType = data.type || '';
      bytes = await data.arrayBuffer();
    }

    const lowerPath = String(logoPath).toLowerCase();
    const kind = contentType.includes('png') || lowerPath.endsWith('.png')
      ? 'png'
      : (contentType.includes('jpeg') || contentType.includes('jpg') || lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg') ? 'jpg' : null);

    if (!kind || !bytes) return null;
    return { bytes: new Uint8Array(bytes), kind };
  } catch (_error) {
    return null;
  }
}

async function loadProfessionalSignatureImage(serviceClient: any, documentRow: any) {
  const snapshot = documentRow.signature_snapshot || {};
  const signatureId = snapshot.signature_id || documentRow.signature_id || null;
  let storagePath = snapshot.storage_path
    || snapshot.signature_storage_path
    || snapshot.signature_path
    || snapshot.image_path
    || snapshot.visual_signature_path
    || null;

  if (!storagePath && signatureId) {
    const { data } = await serviceClient
      .schema('dozeclin')
      .from('professional_signatures')
      .select('storage_path, mime_type')
      .eq('id', signatureId)
      .eq('clinic_id', documentRow.clinic_id)
      .maybeSingle();

    storagePath = data?.storage_path || null;
  }

  console.log('signature_reference_resolved', {
    document_id: documentRow.id,
    signature_id: signatureId,
    has_signature_path: Boolean(storagePath)
  });

  if (!storagePath) {
    console.warn('clinical_document_signature_image_unavailable', {
      document_id: documentRow.id,
      signature_id: signatureId
    });
    console.log('signature_image_fallback', {
      document_id: documentRow.id,
      signature_id: signatureId
    });
    return null;
  }

  try {
    console.log('signature_image_download_started', {
      document_id: documentRow.id,
      signature_id: signatureId
    });
    const { data, error } = await serviceClient.storage
      .from('professional-signatures')
      .download(String(storagePath));
    if (error || !data) {
      console.warn('clinical_document_signature_image_unavailable', {
        document_id: documentRow.id,
        signature_id: signatureId
      });
      console.log('signature_image_fallback', {
        document_id: documentRow.id,
        signature_id: signatureId
      });
      return null;
    }

    const contentType = data.type || '';
    const lowerPath = String(storagePath).toLowerCase();
    const kind = contentType.includes('png') || lowerPath.endsWith('.png')
      ? 'png'
      : (contentType.includes('jpeg') || contentType.includes('jpg') || lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg') ? 'jpg' : null);

    if (!kind) {
      console.warn('clinical_document_signature_image_unavailable', {
        document_id: documentRow.id,
        signature_id: signatureId
      });
      console.log('signature_image_fallback', {
        document_id: documentRow.id,
        signature_id: signatureId
      });
      return null;
    }
    return { bytes: new Uint8Array(await data.arrayBuffer()), kind, signatureId };
  } catch (_error) {
    console.warn('clinical_document_signature_image_unavailable', {
      document_id: documentRow.id,
      signature_id: signatureId
    });
    console.log('signature_image_fallback', {
      document_id: documentRow.id,
      signature_id: signatureId
    });
    return null;
  }
}

async function drawClinicalDocumentHeader(page: any, pdf: any, documentRow: any, clinic: any, logoAsset: any, box: any, fonts: any, colors: any) {
  const { regular, bold } = fonts;
  const { dark, muted, accent, accentSoft, gold, line, white } = colors;
  const padding = 12;
  const logoSize = 82;
  const leftWidth = box.width * 0.66;
  const rightWidth = box.width - leftWidth - 24;
  const y = box.top - box.height;
  const logoX = box.x + padding;
  const logoY = box.top - padding - logoSize;
  const textX = logoX + logoSize + 16;
  const textWidth = leftWidth - logoSize - padding * 2 - 16;
  const rightX = box.x + leftWidth + 24;

  page.drawRectangle({ x: box.x, y, width: box.width, height: box.height, color: white });
  page.drawRectangle({ x: logoX, y: logoY, width: logoSize, height: logoSize, borderRadius: 10, color: rgb(1, 0.98, 0.94), borderColor: line, borderWidth: 0.8 });
  if (logoAsset) {
    await drawPdfLogo(pdf, page, logoAsset, logoX + 8, logoY + 8, logoSize - 16, logoSize - 16);
  } else {
    centerText(page, clinicMonogram(clinic), logoX + logoSize / 2, logoY + 31, 22, bold, accent);
  }

  const clinicName = clinic.name || clinic.trade_name || clinic.legal_name || 'DOZECLIN';
  const nameSize = fitTextToWidth(clinicName, bold, textWidth, 20, 13);
  drawWrappedText(page, clinicName, textX, box.top - 10, textWidth, nameSize, bold, accent, 2);
  const title = clinic.professional_title || clinic.specialty_label || clinic.specialty || '';
  const titleLabel = translateProfessionalTitle(title);
  if (titleLabel) page.drawText(sanitizePdfText(titleLabel), { x: textX, y: box.top - 42, size: 11, font: regular, color: dark });

  drawWrappedText(page, formatAddress(clinic), textX, box.top - 62, textWidth, 8.2, regular, muted, 2);
  drawWrappedText(page, [
    clinic.phone ? `Telefone: ${clinic.phone}` : null,
    (clinic.email || clinic.contact_email) ? `Email: ${clinic.email || clinic.contact_email}` : null,
    (clinic.tax_number || clinic.tax_identifier || clinic.document) ? `NIF: ${clinic.tax_number || clinic.tax_identifier || clinic.document}` : null
  ].filter(Boolean).join('  '), textX, box.top - 96, textWidth, 8.1, regular, muted, 3);

  page.drawRectangle({ x: rightX, y: box.top - 92, width: rightWidth, height: 86, borderRadius: 8, color: accentSoft });
  centerText(page, 'DECLARAÇÃO DE', rightX + rightWidth / 2, box.top - 32, 16.5, bold, accent);
  centerText(page, 'COMPARECIMENTO', rightX + rightWidth / 2, box.top - 55, 16.5, bold, accent);
  centerText(page, `Versão documental: ${documentRow.current_version}`, rightX + rightWidth / 2, box.top - 82, 8.8, regular, muted);
  page.drawLine({ start: { x: box.x, y: y + 1 }, end: { x: box.x + box.width, y: y + 1 }, thickness: 0.8, color: gold });
}

function drawPatientIdentification(page: any, box: any, patient: any, fonts: any, colors: any) {
  const { regular, bold } = fonts;
  const { dark, muted, accent, accentSoft, line } = colors;
  const y = box.top - box.height;
  const padding = 16;
  const contentY = box.top - 50;
  const columns = [
    ['Nome', patient.full_name || patient.name || patient.patient_name || patient.initials],
    ['Documento de identificação', patient.identification_number || patient.identification_document || patient.document || patient.document_number],
    ['Endereço', formatAddress(patient)]
  ].filter(([, value]) => !isBlank(value));
  const columnWidth = (box.width - padding * 2) / Math.max(columns.length, 1);

  page.drawRectangle({ x: box.x, y, width: box.width, height: box.height, borderRadius: 8, color: accentSoft, borderColor: line, borderWidth: 0.8 });
  page.drawText('IDENTIFICAÇÃO DO PACIENTE', { x: box.x + padding, y: box.top - 24, size: 12.8, font: bold, color: accent });
  columns.forEach(([label, value], index) => {
    const x = box.x + padding + index * columnWidth;
    if (index > 0) {
      page.drawLine({ start: { x: x - 10, y: y + 20 }, end: { x: x - 10, y: box.top - 48 }, thickness: 0.7, color: line });
    }
    page.drawText(sanitizePdfText(label), { x, y: contentY, size: 8.4, font: regular, color: muted });
    drawWrappedText(page, value, x, contentY - 18, columnWidth - 18, index === 0 ? 10.7 : 9.7, index === 0 ? bold : regular, dark, index === 2 ? 2 : 1);
  });
}

function drawAttendanceSummary(page: any, box: any, period: any, fonts: any, colors: any) {
  const { regular, bold } = fonts;
  const { dark, muted, accent, goldSoft, line } = colors;
  const y = box.top - box.height;
  page.drawRectangle({ x: box.x, y, width: box.width, height: box.height, borderRadius: 8, color: goldSoft, borderColor: line, borderWidth: 0.8 });
  page.drawText('ATENDIMENTO REALIZADO', { x: box.x + 18, y: box.top - 24, size: 12.4, font: bold, color: accent });
  drawWrappedText(page, `Consulta: ${period.date}, das ${period.startTime} às ${period.endTime}`, box.x + 18, box.top - 43, box.width * 0.48, 9.6, regular, dark, 2);
  page.drawText('-', { x: box.x + box.width * 0.52, y: box.top - 45, size: 11, font: bold, color: muted });
  drawWrappedText(page, `Período considerado: das ${period.consideredStartTime} às ${period.consideredEndTime}`, box.x + box.width * 0.55, box.top - 43, box.width * 0.38, 9.6, regular, dark, 2);
}

function drawDeclarationText(page: any, box: any, text: string, fonts: any, colors: any) {
  page.drawLine({ start: { x: box.x, y: box.top }, end: { x: box.x + box.width, y: box.top }, thickness: 0.7, color: colors.line });
  centerText(page, 'DECLARAÇÃO', box.x + box.width / 2, box.top - 19, 14.2, fonts.bold, colors.accent);
  page.drawLine({ start: { x: box.x, y: box.top - 32 }, end: { x: box.x + box.width, y: box.top - 32 }, thickness: 0.7, color: colors.line });
  drawWrappedText(page, text, box.x, box.top - 60, box.width, 10.4, fonts.regular, colors.dark, 15, 16);
}

async function drawSignatureBlock(page: any, pdf: any, box: any, documentRow: any, professional: any, signature: any, signatureImage: any, fonts: any, colors: any) {
  const SIGNATURE_MAX_WIDTH = 180;
  const SIGNATURE_MAX_HEIGHT = 52;
  const top = box.top;
  const centerX = box.x + box.width / 2;
  const professionalName = signature.signer_name || signature.professional_name || professional.full_name || professional.name || 'Profissional responsavel';
  const title = translateProfessionalTitle(signature.display_title || signature.specialty_code || signature.specialty || professional.display_title || professional.specialty_code || professional.specialty) || 'Profissional';
  const registration = formatProfessionalRegistrationValue(signature, professional);
  const signedAt = formatDateTime(documentRow.signed_at || signature.signed_at);
  let renderedSignatureImage = false;

  if (signatureImage) {
    try {
      await drawPdfLogo(pdf, page, signatureImage, centerX - SIGNATURE_MAX_WIDTH / 2, top - SIGNATURE_MAX_HEIGHT, SIGNATURE_MAX_WIDTH, SIGNATURE_MAX_HEIGHT, 1);
      renderedSignatureImage = true;
      console.log('signature_image_embedded', {
        document_id: documentRow.id,
        signature_id: signatureImage.signatureId ?? signature.signature_id ?? documentRow.signature_id ?? null
      });
    } catch (_error) {
      console.warn('clinical_document_signature_image_unavailable', {
        document_id: documentRow.id,
        signature_id: signatureImage.signatureId ?? signature.signature_id ?? documentRow.signature_id ?? null
      });
      console.log('signature_image_fallback', {
        document_id: documentRow.id,
        signature_id: signatureImage.signatureId ?? signature.signature_id ?? documentRow.signature_id ?? null
      });
    }
  }

  const lineY = top - 62;
  page.drawLine({ start: { x: box.x, y: lineY }, end: { x: box.x + box.width, y: lineY }, thickness: 0.8, color: colors.muted });
  centerText(page, professionalName, centerX, lineY - 16, 10.3, fonts.bold, colors.dark);
  centerText(page, title, centerX, lineY - 30, 8.9, fonts.regular, colors.dark);
  if (registration) centerText(page, `Registo profissional: ${registration}`, centerX, lineY - 47, 8.4, fonts.regular, colors.dark);

  if (renderedSignatureImage) {
    centerText(page, 'Documento assinado eletronicamente em', centerX, lineY - 68, 8, fonts.regular, colors.muted);
    centerText(page, `${signedAt}.`, centerX, lineY - 81, 8, fonts.regular, colors.muted);
    centerText(page, 'A assinatura visual nao corresponde a uma', centerX, lineY - 101, 7.4, fonts.regular, colors.muted);
    centerText(page, 'assinatura eletronica qualificada.', centerX, lineY - 114, 7.4, fonts.regular, colors.muted);
  } else {
    centerText(page, 'Assinado eletronicamente no DOZECLIN', centerX, lineY - 68, 8, fonts.regular, colors.muted);
    centerText(page, `em ${signedAt}.`, centerX, lineY - 81, 8, fonts.regular, colors.muted);
  }
}

function drawClinicalFooter(page: any, box: any, documentRow: any, hasValidation: boolean, fonts: any, colors: any) {
  const top = box.bottom + box.height;
  page.drawLine({ start: { x: box.x, y: top }, end: { x: box.x + box.width, y: top }, thickness: 0.8, color: colors.accent });
  page.drawText('Documento emitido e assinado no DOZECLIN.', { x: box.x, y: top - 14, size: 7.5, font: fonts.regular, color: colors.muted });
  page.drawText(sanitizePdfText(`Documento: ${documentRow.document_number}`), { x: box.x, y: top - 26, size: 7.5, font: fonts.regular, color: colors.muted });
  const validation = hasValidation ? 'Validação pública ativa' : 'Validação pública não ativada';
  const width = fonts.regular.widthOfTextAtSize(validation, 7.5);
  page.drawText(validation, { x: box.x + box.width - width, y: top - 22, size: 7.5, font: fonts.regular, color: colors.muted });
}

async function drawPdfLogo(pdf: any, page: any, logoAsset: any, x: number, y: number, maxWidth: number, maxHeight: number, maxScale = Number.POSITIVE_INFINITY) {
  const image = logoAsset.kind === 'png'
    ? await pdf.embedPng(logoAsset.bytes)
    : await pdf.embedJpg(logoAsset.bytes);
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, maxScale);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: x + (maxWidth - width) / 2,
    y: y + (maxHeight - height) / 2,
    width,
    height
  });
}

function measureDeclarationTextHeight(text: string, width: number, fonts: any) {
  return wrapText(text, width, 10.4, fonts.regular).length * 16;
}

function drawWrappedText(page: any, text: unknown, x: number, y: number, maxWidth: number, size: number, font: any, color: any, maxLines = 3, lineHeight = size + 3) {
  const lines = wrapText(text, maxWidth, size, font).slice(0, maxLines);
  lines.forEach((line, index) => {
    if (!line) return;
    page.drawText(line, { x, y: y - index * lineHeight, size, font, color });
  });
  return lines.length;
}

function wrapText(text: unknown, maxWidth: number, size: number, font: any) {
  return sanitizePdfText(formatValue(text))
    .split(/\n+/)
    .flatMap((paragraph, paragraphIndex, paragraphs) => {
      const lines: string[] = [];
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      let current = '';
      words.forEach((word) => {
        const next = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = next;
        }
      });
      if (current) lines.push(current);
      if (paragraphIndex < paragraphs.length - 1) lines.push('');
      return lines;
    });
}

function centerText(page: any, text: unknown, centerX: number, y: number, size: number, font: any, color: any) {
  const value = sanitizePdfText(formatValue(text));
  const width = font.widthOfTextAtSize(value, size);
  page.drawText(value, { x: centerX - width / 2, y, size, font, color });
}

function fitTextToWidth(text: unknown, font: any, maxWidth: number, maxSize: number, minSize: number) {
  let size = maxSize;
  const value = sanitizePdfText(formatValue(text));
  while (size > minSize && font.widthOfTextAtSize(value, size) > maxWidth) size -= 0.5;
  return size;
}

function clinicMonogram(clinic: Record<string, unknown>) {
  return String(clinic.name || clinic.trade_name || clinic.legal_name || 'D').trim().charAt(0).toUpperCase() || 'D';
}

async function sha256Hex(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function auditPdfAccess(serviceClient: any, documentRow: any, userId: string, audience: 'staff' | 'patient', mode: string) {
  if (mode === 'generate') return;
  const actionMode = mode === 'print' ? 'printed' : mode === 'download' ? 'downloaded' : 'viewed';
  const action = `documents.pdf_${actionMode}_${audience}`;
  const eventType = `pdf_${actionMode}_${audience}`;

  await serviceClient.schema('dozeclin').from('document_events').insert({
    clinic_id: documentRow.clinic_id,
    document_id: documentRow.id,
    event_type: eventType,
    actor_auth_user_id: userId,
    metadata: { mode, audience }
  });

  await serviceClient.schema('dozeclin').from('audit_logs').insert({
    clinic_id: documentRow.clinic_id,
    user_id: userId,
    action,
    entity: 'clinical_documents',
    entity_id: documentRow.id,
    new_data: {
      document_number: documentRow.document_number,
      mode,
      audience
    }
  });
}

function resolveDocumentTitle(documentRow: any) {
  const labels: Record<string, string> = {
    attendance_certificate: 'Declaração de Comparecimento',
    follow_up_certificate: 'Declaração de Acompanhamento',
    service_certificate: 'Declaração de Atendimento',
    clinical_report: 'Relatório Clínico',
    clinical_progress: 'Evolução Clínica',
    referral: 'Encaminhamento',
    treatment_plan: 'Plano Terapêutico',
    consent: 'Consentimento',
    custom: documentRow.title || 'Documento Clínico'
  };
  return labels[documentRow.document_type] || documentRow.title || 'Documento Clínico';
}

function resolveContentText(
  documentRow: any,
  content: Record<string, unknown>,
  patient: Record<string, unknown>,
  professional: Record<string, unknown>,
  signature: Record<string, unknown>,
  clinic: Record<string, unknown>
) {
  if (documentRow.document_type === 'attendance_certificate') {
    return buildAttendanceCertificateText(documentRow, content, patient, professional, signature, clinic);
  }

  const narrative = content.text || content.description || content.summary || content.notes;
  if (!isBlank(narrative)) return formatValue(narrative);

  return 'Documento emitido conforme as informações clínicas registadas no DOZECLIN.';
}

function buildAttendanceCertificateText(
  documentRow: any,
  content: Record<string, unknown>,
  patient: Record<string, unknown>,
  professional: Record<string, unknown>,
  signature: Record<string, unknown>,
  clinic: Record<string, unknown>
) {
  const period = resolveAppointmentPeriod(documentRow, content, patient, clinic);

  return [
    `Declaramos, para os devidos fins, que o paciente acima identificado compareceu ao atendimento realizado no dia ${period.date}, com início às ${period.startTime} e término às ${period.endTime}.`,
    'Para efeitos de deslocamento, organização e permanência relacionada ao atendimento, considera-se também o período de 1 hora anterior ao início da consulta e 1 hora posterior ao seu término.',
    'A presente declaração é emitida a pedido do interessado para fins de comprovação de comparecimento.'
  ].join('\n\n');
}

function buildHeaderLines(
  clinic: Record<string, unknown>,
  professional: Record<string, unknown>,
  signature: Record<string, unknown>
) {
  const phone = professional.phone || professional.professional_phone || clinic.phone;
  const email = professional.email || professional.professional_email || clinic.email || clinic.contact_email;
  return [
    formatProfessionalRegistration(signature, professional),
    clinic.name || clinic.trade_name || clinic.legal_name,
    formatAddress(clinic),
    clinic.tax_number || clinic.tax_identifier || clinic.document ? `NIF: ${clinic.tax_number || clinic.tax_identifier || clinic.document}` : null,
    phone ? `Telefone: ${phone}` : null,
    email ? `Email: ${email}` : null
  ].filter((line) => !isBlank(line)).map((line) => formatValue(line));
}

function drawQrSvg(page: any, svg: string | null, x: number, y: number, size: number, color: any) {
  if (!svg) {
    page.drawText('Validação pública ainda não ativada', { x, y: y + 28, size: 7, color });
    return;
  }
  const path = svg.match(/<path[^>]+d="([^"]+)"/i)?.[1];
  const viewBox = svg.match(/viewBox="[^"]*0\s+0\s+([\d.]+)\s+([\d.]+)"/i);
  if (!path || !viewBox) {
    page.drawText('QR disponível', { x, y: y + 28, size: 7, color });
    return;
  }
  const sourceSize = Math.max(Number(viewBox[1]), Number(viewBox[2])) || 320;
  page.drawSvgPath(path, {
    x,
    y,
    scale: size / sourceSize,
    color: rgb(0.08, 0.10, 0.12)
  });
}

function formatHeaderName(name: unknown, title: unknown) {
  if (isBlank(name) && isBlank(title)) return '';
  if (isBlank(title)) return formatValue(name);
  if (isBlank(name)) return formatValue(title);
  return `${formatValue(name)} - ${formatValue(title)}`;
}

function formatAddress(source: Record<string, unknown>) {
  return [
    source.address,
    source.address_number || source.number,
    source.address_complement || source.complement,
    source.neighborhood,
    source.postal_code,
    source.city || source.locality,
    source.district || source.state,
    source.country
  ].filter((line) => !isBlank(line)).map((line) => formatValue(line)).join(', ');
}

function formatDateTime(value: unknown) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Lisbon'
  }).format(new Date(String(value)));
}

function resolveAppointmentPeriod(
  documentRow: any,
  content: Record<string, unknown>,
  patient: Record<string, unknown>,
  clinic: Record<string, unknown>
) {
  const timezone = formatValue(
    content.clinic_timezone
      || content.timezone
      || clinic.timezone
      || patient.timezone
      || 'Europe/Lisbon'
  );
  const start = content.scheduled_start ? new Date(String(content.scheduled_start)) : null;
  const end = content.scheduled_end ? new Date(String(content.scheduled_end)) : null;
  const consideredStart = start ? new Date(start.getTime() - 60 * 60 * 1000) : null;
  const consideredEnd = end ? new Date(end.getTime() + 60 * 60 * 1000) : null;

  return {
    date: start ? formatDate(start, timezone) : '-',
    startTime: start ? formatTime(start, timezone) : '-',
    endTime: end ? formatTime(end, timezone) : '-',
    consideredStartTime: consideredStart ? formatTime(consideredStart, timezone) : '-',
    consideredEndTime: consideredEnd ? formatTime(consideredEnd, timezone) : '-'
  };
}

function formatDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'long',
    timeZone
  }).format(value);
}

function formatDateLong(value: unknown, timeZone = 'Europe/Lisbon') {
  if (!value) return '-';
  return formatDate(new Date(String(value)), timeZone);
}

function formatTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone
  }).format(value).replace(':', 'h');
}

function translateProfessionalTitle(value: unknown) {
  const raw = formatValue(value).trim();
  if (!raw || raw === '-') return '';
  const normalized = raw.toLowerCase();
  const labels: Record<string, string> = {
    psychoanalysis: 'Psicanalista',
    psychology: 'Psicólogo(a)',
    dentistry: 'Médico(a) Dentista',
    nutrition: 'Nutricionista',
    physiotherapy: 'Fisioterapeuta',
    pediatrics: 'Pediatra',
    psychiatry: 'Psiquiatra',
    multidisciplinary: 'Profissional de Saúde',
    general: 'Profissional de Saúde',
    other: 'Profissional'
  };
  if (labels[normalized]) return labels[normalized];
  if (/^[a-z_]+$/.test(raw)) return 'Profissional';
  return raw;
}

function formatProfessionalRegistration(signature: Record<string, unknown>, professional: Record<string, unknown>) {
  const value = formatProfessionalRegistrationValue(signature, professional);
  return value ? `Registo profissional: ${value}` : '';
}

function formatProfessionalRegistrationValue(signature: Record<string, unknown>, professional: Record<string, unknown>) {
  const registration = signature.professional_registration || professional.professional_registration;
  const body = signature.professional_registration_body || professional.professional_registration_body;
  if (isBlank(registration)) return '';
  return [body, registration].filter((item) => !isBlank(item)).map(formatValue).join(' ');
}

function resolveValidationText(qrSvg: string | null, documentHash: unknown) {
  if (!qrSvg) return 'Validação pública ainda não ativada.';
  return `Valide a autenticidade deste documento através do QR Code. Código de autenticidade: ${String(documentHash || '').slice(0, 16)}`;
}

function isBlank(value: unknown) {
  return value === null || value === undefined || value === '';
}

function hasAny(source: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => !isBlank(source?.[key]));
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (typeof value === 'object') return '';
  return String(value);
}

function safeFileName(value: string) {
  return String(value || 'documento').replace(/[^A-Za-z0-9_-]+/g, '-');
}

function sanitizePdfText(value: string) {
  return String(value || '').replace(/[^\u0009\u000A\u000D\u0020-\u00FF]/g, '-').slice(0, 2400);
}
