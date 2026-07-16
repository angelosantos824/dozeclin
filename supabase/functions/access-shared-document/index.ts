import {
  handleError,
  HttpError,
  jsonResponse,
  readJsonRequest,
  getClients
} from '../_shared/first-access.ts';

const BUCKET = 'clinical-documents';
const SIGNED_URL_TTL = 60 * 5;

Deno.serve(async (req) => {
  try {
    const parsed = await readJsonRequest(req);
    if (parsed.response) return parsed.response;

    const { serviceClient } = getClients(req);
    const { token, mode = 'view' } = parsed.body as { token?: string; mode?: 'view' | 'download' };
    if (!token || token.length < 32) throw new HttpError('Link invalido ou expirado.', 400);
    if (!['view', 'download'].includes(mode)) throw new HttpError('Modo invalido.', 400);

    const { data, error } = await serviceClient
      .schema('dozeclin')
      .rpc('consume_document_share_link', { p_token: token });
    if (error) throw error;
    if (data?.state !== 'valid') throw new HttpError('Link invalido ou expirado.', 404);
    if (mode === 'download' && !data.allow_download) throw new HttpError('Download indisponivel para este link.', 403);

    const { data: signed, error: signedError } = await serviceClient.storage
      .from(BUCKET)
      .createSignedUrl(data.storage_path, SIGNED_URL_TTL, {
        download: mode === 'download' ? `documento-${data.document_id}.pdf` : undefined
      });
    if (signedError || !signed?.signedUrl) throw signedError || new Error('Falha ao gerar URL temporaria.');

    return jsonResponse({
      state: 'valid',
      signed_url: signed.signedUrl,
      expires_in: SIGNED_URL_TTL,
      allow_download: data.allow_download
    });
  } catch (error) {
    return handleError(error, 'access-shared-document');
  }
});
