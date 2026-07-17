import {
  handleError,
  HttpError,
  jsonResponse,
  readJsonRequest,
  getClients
} from '../_shared/first-access.ts';
import { buildPublicAppUrl } from '../_shared/app-origin.ts';

Deno.serve(async (req) => {
  try {
    const parsed = await readJsonRequest(req);
    if (parsed.response) return parsed.response;

    const { userClient, authHeader } = getClients(req);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new HttpError('Sessao ausente.', 401);
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) throw new HttpError('Sessao invalida.', 401);

    const {
      document_id: documentId,
      expiration = '24_hours',
      allow_download: allowDownload = false,
      max_views: maxViews = null
    } = parsed.body as {
      document_id?: string;
      expiration?: '24_hours' | '72_hours' | '7_days';
      allow_download?: boolean;
      max_views?: number | null;
    };

    if (!documentId) throw new HttpError('Informe o documento.', 400);

    const { data, error } = await userClient
      .schema('dozeclin')
      .rpc('create_document_share_link', {
        p_document_id: documentId,
        p_expiration: expiration,
        p_allow_download: Boolean(allowDownload),
        p_max_views: maxViews
      });
    if (error) throw error;

    return jsonResponse({
      ...data,
      url: buildPublicAppUrl(req, data.url)
    });
  } catch (error) {
    return handleError(error, 'generate-document-share-link');
  }
});
