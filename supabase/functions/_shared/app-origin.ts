const ALLOWED_APP_ORIGINS = new Set([
  'http://127.0.0.1:8000',
  'http://localhost:8000',
  'https://dozeclin.dozedev.pt'
]);

export function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function isAllowedAppOrigin(origin: string): boolean {
  return ALLOWED_APP_ORIGINS.has(normalizeOrigin(origin));
}

export function resolveAppOrigin(req: Request): string {
  const configured = Deno.env.get('APP_PUBLIC_URL')?.trim();

  if (configured) {
    return normalizeOrigin(configured);
  }

  const requestOrigin = req.headers.get('Origin')?.trim();

  if (requestOrigin && isAllowedAppOrigin(requestOrigin)) {
    return normalizeOrigin(requestOrigin);
  }

  throw new Error('APP_PUBLIC_URL nao configurada e origem da aplicacao nao permitida.');
}

export function buildPublicAppUrl(
  req: Request,
  path: string,
  params: Record<string, string> = {}
): string {
  const origin = resolveAppOrigin(req);
  const normalizedPath = normalizePath(path);
  const url = new URL(`${origin}${normalizedPath}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function normalizePath(path: string): string {
  return `/${String(path || '').replace(/^\/+/, '')}`;
}
