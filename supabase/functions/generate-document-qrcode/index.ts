import QRCode from 'https://esm.sh/qrcode@1.5.4';
import {
  handleError,
  HttpError,
  jsonResponse,
  readJsonRequest,
  getClients
} from '../_shared/first-access.ts';
import { buildPublicAppUrl } from '../_shared/app-origin.ts';

const BUCKET = 'document-assets';
const SIGNED_URL_TTL = 60 * 10;
const CARD_SIZE = 1200;
const CARD_PADDING = 48;
const CARD_INNER_SIZE = CARD_SIZE - CARD_PADDING * 2;
const CARD_RADIUS = 56;
const HEADER_BAR_HEIGHT = 18;
const BRAND_X = 104;
const BRAND_Y = 118;
const BRAND_MARK_SIZE = 58;
const SEAL_X = 836;
const SEAL_Y = 102;
const SEAL_WIDTH = 268;
const SEAL_HEIGHT = 56;
const QR_FRAME_X = 236;
const QR_FRAME_Y = 254;
const QR_FRAME_SIZE = 728;
const QR_INNER_PADDING = 68;
const QR_SIZE = QR_FRAME_SIZE - QR_INNER_PADDING * 2;
const INFO_CARD_Y = 212;
const INFO_CARD_WIDTH = 278;
const INFO_CARD_HEIGHT = 92;
const FOOTER_CODE_WIDTH = 470;
const FOOTER_CODE_HEIGHT = 54;
const FOOTER_CODE_Y = 1084;

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  attendance_certificate: 'Declaracao de Comparecimento',
  follow_up_certificate: 'Declaracao de Acompanhamento',
  service_certificate: 'Declaracao de Atendimento',
  clinical_report: 'Relatorio Clinico',
  clinical_progress: 'Evolucao Clinica',
  referral: 'Encaminhamento',
  treatment_plan: 'Plano Terapeutico',
  consent: 'Consentimento',
  custom: 'Documento Clinico'
};

Deno.serve(async (req) => {
  try {
    const parsed = await readJsonRequest(req);
    if (parsed.response) return parsed.response;

    const { userClient, serviceClient, authHeader } = getClients(req);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new HttpError('Sessao ausente.', 401);

    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) throw new HttpError('Sessao invalida.', 401);

    const { document_id: documentId } = parsed.body as { document_id?: string };
    if (!documentId) throw new HttpError('Informe o documento.', 400);

    const { data: validation, error: validationError } = await userClient
      .schema('dozeclin')
      .rpc('enable_public_document_validation', { p_document_id: documentId });
    if (validationError) throw validationError;

    const paths = buildStoragePaths(documentId);

    if (validation?.already_enabled) {
      return handleExistingValidation(serviceClient, documentId, paths);
    }

    if (!validation?.token && !validation?.validation_url) {
      throw new HttpError('Validacao publica ja existe. Use o token emitido originalmente.', 409);
    }

    if (!validation?.token) {
      throw new HttpError('Token de validacao indisponivel para gerar o cartao.', 409);
    }

    const validationUrl = buildValidationUrl(req, validation.token);
    const validationCode = await buildValidationCode(validation.token);
    const documentInfo = await getDocumentInfo(userClient, documentId);
    const qrSvg = await buildQrSvg(validationUrl);
    const cardSvg = buildValidationCardSvg({
      qrSvg,
      validationCode,
      validationUrl,
      documentType: resolveDocumentType(documentInfo),
      issuedAt: formatIssuedAt(documentInfo?.issued_at),
      clinicName: resolveClinicName(documentInfo),
      domain: new URL(validationUrl).host
    });

    await uploadText(serviceClient, paths.qrSvg, qrSvg, 'image/svg+xml');
    await uploadText(serviceClient, paths.cardSvg, cardSvg, 'image/svg+xml');

    const signedUrls = await signValidationAssets(serviceClient, paths);

    return jsonResponse({
      document_id: documentId,
      already_enabled: false,
      validation_url: validationUrl,
      qr_signed_url: signedUrls.qrSignedUrl,
      card_svg_signed_url: signedUrls.cardSvgSignedUrl,
      validation_code: validationCode,
      expires_in: SIGNED_URL_TTL
    });
  } catch (error) {
    return handleError(error, 'generate-document-qrcode');
  }
});

async function handleExistingValidation(serviceClient: any, documentId: string, paths: ValidationAssetPaths) {
  const existingCard = await downloadTextOrNull(serviceClient, paths.cardSvg);
  if (!existingCard) {
    throw new HttpError(
      'A validacao publica ja esta ativa, mas o cartao oficial ainda nao existe. O token completo nao pode ser recuperado para recriar o cartao sem alterar a validacao.',
      409
    );
  }

  const signedUrls = await signValidationAssets(serviceClient, paths);

  return jsonResponse({
    document_id: documentId,
    already_enabled: true,
    validation_url: null,
    qr_signed_url: signedUrls.qrSignedUrl,
    card_svg_signed_url: signedUrls.cardSvgSignedUrl,
    validation_code: readValidationCode(existingCard),
    expires_in: SIGNED_URL_TTL
  });
}

function buildStoragePaths(documentId: string): ValidationAssetPaths {
  return {
    qrSvg: `${documentId}/validation-qr.svg`,
    cardSvg: `${documentId}/validation-card.svg`
  };
}

async function getDocumentInfo(userClient: any, documentId: string) {
  const { data, error } = await userClient
    .schema('dozeclin')
    .from('clinical_documents')
    .select('document_type, issued_at, clinics:clinics!clinical_documents_clinic_id_fkey(name, legal_name)')
    .eq('id', documentId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function resolveDocumentType(documentInfo: any) {
  return DOCUMENT_TYPE_LABELS[documentInfo?.document_type]
    || 'Documento Clinico';
}

function resolveClinicName(documentInfo: any) {
  const clinic = Array.isArray(documentInfo?.clinics)
    ? documentInfo.clinics[0]
    : documentInfo?.clinics;

  return clinic?.name || clinic?.legal_name || 'Clinica DOZECLIN';
}

function formatIssuedAt(value: string | null | undefined) {
  if (!value) return 'Nao informada';
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Lisbon'
  }).format(new Date(value));
}

async function buildQrSvg(validationUrl: string) {
  return QRCode.toString(validationUrl, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 640
  });
}

async function buildValidationCode(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
    .toUpperCase();

  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

function buildValidationCardSvg(data: {
  qrSvg: string;
  validationCode: string;
  validationUrl: string;
  documentType: string;
  issuedAt: string;
  clinicName: string;
  domain: string;
}) {
  const qrDataUri = svgToDataUri(data.qrSvg);
  const qrImageX = QR_FRAME_X + QR_INNER_PADDING;
  const qrImageY = QR_FRAME_Y + QR_INNER_PADDING;
  const rightInfoX = CARD_SIZE - CARD_PADDING - INFO_CARD_WIDTH;
  const codeX = (CARD_SIZE - FOOTER_CODE_WIDTH) / 2;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_SIZE}" height="${CARD_SIZE}" viewBox="0 0 ${CARD_SIZE} ${CARD_SIZE}" role="img" aria-labelledby="title desc" data-validation-code="${escapeXml(data.validationCode)}">
  <title id="title">DOZECLIN - Validacao Oficial de Documento</title>
  <desc id="desc">Cartao publico de validacao de autenticidade de documento clinico.</desc>
  <defs>
    <filter id="softShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#4c1d95" flood-opacity="0.10"/>
    </filter>
  </defs>
  <rect width="${CARD_SIZE}" height="${CARD_SIZE}" fill="#ffffff"/>
  <rect x="${CARD_PADDING}" y="${CARD_PADDING}" width="${CARD_INNER_SIZE}" height="${CARD_INNER_SIZE}" rx="${CARD_RADIUS}" fill="#ffffff" stroke="#ede9fe" stroke-width="4" filter="url(#softShadow)"/>
  <rect x="${CARD_PADDING}" y="${CARD_PADDING}" width="${CARD_INNER_SIZE}" height="${HEADER_BAR_HEIGHT}" rx="9" fill="#7c3aed"/>
  ${brandLogoSvg(BRAND_X, BRAND_Y, BRAND_MARK_SIZE)}
  <text x="184" y="116" fill="#1f2937" font-family="Inter, Arial, sans-serif" font-size="52" font-weight="900" letter-spacing="0">DOZECLIN</text>
  <text x="184" y="155" fill="#6b7280" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="0">${escapeXml(truncate(data.clinicName, 34))}</text>
  <rect x="${SEAL_X}" y="${SEAL_Y}" width="${SEAL_WIDTH}" height="${SEAL_HEIGHT}" rx="28" fill="#f5f3ff" stroke="#ddd6fe" stroke-width="2"/>
  <path d="M876 135l12 12 28-31" fill="none" stroke="#7c3aed" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="928" y="138" fill="#7c3aed" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="900" letter-spacing="0">Documento Oficial</text>
  <text x="600" y="212" text-anchor="middle" fill="#6b7280" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="0">Validacao Oficial de Documento</text>
  <rect x="${QR_FRAME_X}" y="${QR_FRAME_Y}" width="${QR_FRAME_SIZE}" height="${QR_FRAME_SIZE}" rx="42" fill="#f8fafc" stroke="#ddd6fe" stroke-width="3"/>
  <rect x="${qrImageX - 18}" y="${qrImageY - 18}" width="${QR_SIZE + 36}" height="${QR_SIZE + 36}" rx="28" fill="#ffffff" stroke="#ede9fe" stroke-width="2"/>
  <image href="${qrDataUri}" x="${qrImageX}" y="${qrImageY}" width="${QR_SIZE}" height="${QR_SIZE}" preserveAspectRatio="xMidYMid meet"/>
  <text x="600" y="1002" text-anchor="middle" fill="#1f2937" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800" letter-spacing="0">Escaneie para confirmar a autenticidade</text>
  <text x="600" y="1046" text-anchor="middle" fill="#6b7280" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="500" letter-spacing="0">Esta validacao nao apresenta conteudo clinico publicamente.</text>
  <g>
    <rect x="96" y="${INFO_CARD_Y}" width="${INFO_CARD_WIDTH}" height="${INFO_CARD_HEIGHT}" rx="20" fill="#f5f3ff"/>
    ${documentIconSvg(122, 235)}
    <text x="164" y="244" fill="#6b7280" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" letter-spacing="0">DOCUMENTO</text>
    <text x="122" y="282" fill="#1f2937" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="900" letter-spacing="0">${escapeXml(truncate(data.documentType, 20))}</text>
  </g>
  <g>
    <rect x="${rightInfoX}" y="${INFO_CARD_Y}" width="${INFO_CARD_WIDTH}" height="${INFO_CARD_HEIGHT}" rx="20" fill="#f5f3ff"/>
    ${calendarIconSvg(rightInfoX + 26, 235)}
    <text x="${rightInfoX + 68}" y="244" fill="#6b7280" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" letter-spacing="0">EMISSAO</text>
    <text x="${rightInfoX + 26}" y="282" fill="#1f2937" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="900" letter-spacing="0">${escapeXml(data.issuedAt)}</text>
  </g>
  <g>
    <rect x="${codeX}" y="${FOOTER_CODE_Y}" width="${FOOTER_CODE_WIDTH}" height="${FOOTER_CODE_HEIGHT}" rx="27" fill="#7c3aed"/>
    <text x="600" y="1120" text-anchor="middle" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="800" letter-spacing="1.5">CODIGO ${escapeXml(data.validationCode)}</text>
  </g>
  <text x="600" y="1172" text-anchor="middle" fill="#6b7280" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="0">${escapeXml(data.domain)}</text>
</svg>`;
}

function svgToDataUri(svg: string) {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function escapeXml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function uploadText(serviceClient: any, path: string, content: string, contentType: string) {
  const { error } = await serviceClient.storage
    .from(BUCKET)
    .upload(path, new Blob([content], { type: contentType }), {
      contentType,
      cacheControl: '300',
      upsert: true
    });

  if (error) throw error;
}

async function downloadTextOrNull(serviceClient: any, path: string) {
  const { data, error } = await serviceClient.storage
    .from(BUCKET)
    .download(path);

  if (error || !data) return null;
  return data.text();
}

async function signValidationAssets(serviceClient: any, paths: ValidationAssetPaths) {
  return {
    qrSignedUrl: await signedUrlOrNull(serviceClient, paths.qrSvg),
    cardSvgSignedUrl: await signedUrlOrNull(serviceClient, paths.cardSvg)
  };
}

async function signedUrlOrNull(serviceClient: any, path: string) {
  const { data, error } = await serviceClient.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function readValidationCode(svg: string) {
  return svg.match(/data-validation-code="([^"]+)"/)?.[1] || null;
}

function buildValidationUrl(req: Request, token: string) {
  return buildPublicAppUrl(req, '/app/verificar-documento.html', { token });
}

type ValidationAssetPaths = {
  qrSvg: string;
  cardSvg: string;
};

function brandLogoSvg(x: number, y: number, size: number) {
  const r = size / 2;
  return `
  <g aria-hidden="true">
    <rect x="${x - r}" y="${y - r}" width="${size}" height="${size}" rx="16" fill="#7c3aed"/>
    <path d="M${x - 10} ${y - 18}h9c18 0 31 11 31 29 0 18-13 29-31 29h-9z" fill="#ffffff" opacity="0.96"/>
    <path d="M${x - 1} ${y - 3}h11c6 0 10 4 10 11s-4 11-10 11H${x - 1}z" fill="#7c3aed"/>
    <circle cx="${x - 17}" cy="${y + 18}" r="8" fill="#a855f7"/>
  </g>`;
}

function documentIconSvg(x: number, y: number) {
  return `
  <g aria-hidden="true" fill="none" stroke="#7c3aed" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${x + 4} ${y - 16}h18l10 10v26H${x + 4}z"/>
    <path d="M${x + 22} ${y - 16}v10h10"/>
    <path d="M${x + 11} ${y + 3}h15"/>
    <path d="M${x + 11} ${y + 12}h11"/>
  </g>`;
}

function calendarIconSvg(x: number, y: number) {
  return `
  <g aria-hidden="true" fill="none" stroke="#7c3aed" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <rect x="${x + 2}" y="${y - 15}" width="32" height="32" rx="6"/>
    <path d="M${x + 9} ${y - 21}v10"/>
    <path d="M${x + 27} ${y - 21}v10"/>
    <path d="M${x + 2} ${y - 4}h32"/>
    <path d="M${x + 11} ${y + 6}h4"/>
    <path d="M${x + 21} ${y + 6}h4"/>
  </g>`;
}
