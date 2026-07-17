const hostname = window.location.hostname;
const protocol = window.location.protocol;
const port = window.location.port;

const PRODUCTION_ORIGIN = 'https://dozeclin.dozedev.pt';

export const APP_IS_LOCAL =
  hostname === 'localhost' ||
  hostname === '127.0.0.1';

export const APP_IS_PRODUCTION = hostname === 'dozeclin.dozedev.pt';

export const APP_ENV = APP_IS_LOCAL
  ? 'development'
  : APP_IS_PRODUCTION
    ? 'production'
    : 'unknown';

export const APP_ORIGIN = APP_IS_LOCAL
  ? `${protocol}//${hostname}${port ? `:${port}` : ''}`
  : PRODUCTION_ORIGIN;

export const APP_BASE_PATH = '/app';

function appUrl(page, params = {}) {
  const normalizedPage = normalizePage(page);
  const url = new URL(`${APP_ORIGIN}${APP_BASE_PATH}/${normalizedPage}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function normalizePage(page) {
  return String(page || '')
    .replace(/^\/+/, '')
    .replace(/^app\//, '');
}

export const APP_URLS = {
  root: `${APP_ORIGIN}/`,
  login: appUrl('login.html'),
  dashboard: appUrl('dashboard.html'),
  platform: appUrl('plataforma.html'),
  initialPassword: appUrl('alterar-senha-inicial.html'),
  patientPortal: appUrl('portal-paciente.html'),
  unavailableAccess: appUrl('acesso-indisponivel.html'),
  unavailable: appUrl('acesso-indisponivel.html'),
  publicDocumentValidation: appUrl('verificar-documento.html')
};

export function buildAppUrl(page, params = {}) {
  return appUrl(page, params);
}
