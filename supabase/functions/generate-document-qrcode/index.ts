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

Deno.serve(async (req) => {
  try {
    const parsed = await readJsonRequest(req);
    if (parsed.response) return parsed.response;

    const { userClient, serviceClient, authHeader } = getClients(req);

const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  

if (!token) {
  throw new HttpError('Sessao ausente.', 401);
}

const { data: authData, error: authError } =
  await userClient.auth.getUser(token);

if (authError) {
  console.error('AUTH_GET_USER_ERROR', {
    message: authError.message,
    status: authError.status,
    name: authError.name,
    tokenPrefix: token.substring(0, 20)
  });

  throw new HttpError('Sessao invalida.', 401);
}

if (!authData.user) {
  throw new HttpError('Utilizador nao encontrado.', 401);
}

    const { document_id: documentId } = parsed.body as { document_id?: string };
    if (!documentId) throw new HttpError('Informe o documento.', 400);

    const { data: validation, error: validationError } = await userClient
      .schema('dozeclin')
      .rpc('enable_public_document_validation', { p_document_id: documentId });
    if (validationError) throw validationError;

    const storagePath = `${documentId}/validation-qr.svg`;

    if (validation?.already_enabled) {
      const { error: existingError } = await serviceClient.storage
        .from(BUCKET)
        .download(storagePath);
      if (existingError) {
        throw new HttpError(
          'A validacao publica esta ativa, mas o QR original nao foi encontrado. Revogue e gere uma nova validacao por um fluxo administrativo seguro.',
          409
        );
      }

      const { data: signed, error: signedError } = await serviceClient.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, SIGNED_URL_TTL);
      if (signedError || !signed?.signedUrl) throw signedError || new Error('Falha ao gerar URL temporaria.');

      return jsonResponse({
        document_id: documentId,
        already_enabled: true,
        qr_signed_url: signed.signedUrl,
        expires_in: SIGNED_URL_TTL
      });
    }

    if (!validation?.token && !validation?.validation_url) {
      throw new HttpError('Validacao publica ja existe. Use o token emitido originalmente.', 409);
    }

    const validationUrl = buildValidationUrl(req, validation.token);
    const svg = await QRCode.toString(validationUrl, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320
    });

    const { error: uploadError } = await serviceClient.storage
      .from(BUCKET)
      .upload(storagePath, new Blob([svg], { type: 'image/svg+xml' }), {
        contentType: 'image/svg+xml',
        cacheControl: '300',
        upsert: true
      });
    if (uploadError) throw uploadError;

    const { data: signed, error: signedError } = await serviceClient.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL);
    if (signedError || !signed?.signedUrl) throw signedError || new Error('Falha ao gerar URL temporaria.');

    return jsonResponse({
      document_id: documentId,
      validation_url: validationUrl,
      qr_storage_path: storagePath,
      qr_signed_url: signed.signedUrl,
      expires_in: SIGNED_URL_TTL
    });
  } catch (error) {
    return handleError(error, 'generate-document-qrcode');
  }
});

function buildValidationUrl(req: Request, token: string) {
  return buildPublicAppUrl(req, '/app/verificar-documento.html', { token });
}
