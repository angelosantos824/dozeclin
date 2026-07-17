import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

const MAX_JSON_BODY_BYTES = 16 * 1024;

export async function readJsonRequest(req: Request) {
  if (req.method === 'OPTIONS') {
    return { response: new Response('ok', { headers: corsHeaders }), body: null };
  }

  if (req.method !== 'POST') {
    throw new HttpError('Metodo nao permitido.', 405);
  }

  const contentType = req.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new HttpError('Envie os dados em formato JSON.', 415);
  }

  const contentLength = Number(req.headers.get('Content-Length') || 0);
  if (contentLength > MAX_JSON_BODY_BYTES) {
    throw new HttpError('Solicitação demasiado grande.', 413);
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).length > MAX_JSON_BODY_BYTES) {
    throw new HttpError('Solicitação demasiado grande.', 413);
  }

  try {
    return { response: null, body: rawBody ? JSON.parse(rawBody) : {} };
  } catch (_error) {
    throw new HttpError('Dados da solicitação inválidos.', 400);
  }
}

export function getClients(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error('Secrets Supabase incompletos.');
  }

  const authHeader = req.headers.get('Authorization') || '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  return { userClient, serviceClient, authHeader };
}

export async function getAuthenticatedUser(req: Request) {
  const { userClient, serviceClient, authHeader } = getClients(req);
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError('Sessao ausente.', 401);

  const { data, error } = await userClient.auth.getUser(token);

if (error) {
  console.error('AUTH_GET_USER_ERROR', {
    message: error.message,
    status: error.status,
    name: error.name
  });

  throw new HttpError(
    `Sessao invalida: ${error.message}`,
    error.status || 401
  );
}

if (!data.user) {
  throw new HttpError('Utilizador não encontrado.', 401);
}

  return { user: data.user, serviceClient };
}

export async function requireDozeclinSuperAdmin(req: Request) {
  const { user, serviceClient } = await getAuthenticatedUser(req);

  const { data: platformUser, error: userError } = await serviceClient
    .schema('dozedev')
    .from('platform_users')
    .select('id, role, status')
    .eq('auth_user_id', user.id)
    .eq('role', 'super_admin')
    .eq('status', 'active')
    .maybeSingle();

  if (userError) throw userError;
  if (!platformUser) throw new HttpError('Apenas Super Admin global pode executar esta acao.', 403);

  const { data: productAccess, error: accessError } = await serviceClient
    .schema('dozedev')
    .from('platform_user_products')
    .select('status, access_role, products:products!platform_user_products_product_id_fkey(code, status)')
    .eq('platform_user_id', platformUser.id);

  if (accessError) throw accessError;

  const canAccessDozeclin = (productAccess || []).some((link: any) => (
    link.status === 'active'
    && link.products?.code === 'dozeclin'
    && ['active', 'development'].includes(link.products?.status)
  ));

  if (!canAccessDozeclin) throw new HttpError('Sem acesso ativo ao produto DOZECLIN.', 403);

  return { user, serviceClient, platformUser };
}

export function generateTemporaryPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%*-_=+?';
  const all = `${upper}${lower}${digits}${symbols}`;
  const chars = [
    randomChar(upper),
    randomChar(lower),
    randomChar(digits),
    randomChar(symbols)
  ];

  while (chars.length < 16) chars.push(randomChar(all));

  return shuffle(chars).join('');
}

function randomChar(source: string) {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return source[bytes[0] % source.length];
}

function shuffle(values: string[]) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const swapIndex = bytes[0] % (index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function validateNewPassword(password: string) {
  if (password.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (!/[A-Z]/.test(password)) return 'A senha deve conter uma letra maiuscula.';
  if (!/[a-z]/.test(password)) return 'A senha deve conter uma letra minuscula.';
  if (!/[0-9]/.test(password)) return 'A senha deve conter um numero.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'A senha deve conter um simbolo.';
  return null;
}

export class HttpError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function handleError(error: unknown, functionName = 'unknown') {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.message }, error.status);
  }

  logSafeError(functionName, error);
  return jsonResponse({ error: 'Nao foi possivel concluir a operacao.' }, 500);
}

export function logSafeError(functionName: string, error: unknown, code?: string) {
  const err = error as { name?: unknown; status?: unknown; code?: unknown };
  console.error('edge_function_error', {
    function: functionName,
    name: typeof err?.name === 'string' ? err.name : 'Error',
    status: typeof err?.status === 'number' ? err.status : undefined,
    code: code || (typeof err?.code === 'string' ? err.code : undefined)
  });
}
