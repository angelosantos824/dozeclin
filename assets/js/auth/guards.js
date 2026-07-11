import { getCurrentProfile } from './auth.js';
import { hasPermission } from './permissions.js';

export async function requireAuth(requiredPermission = null) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirectToLogin();
    return null;
  }

  if (profile.status !== 'active') {
    redirectToLogin('Utilizador inativo.');
    return null;
  }

  if (profile.clinics && !['trial', 'active'].includes(profile.clinics.status)) {
    redirectToLogin('Clinica inativa.');
    return null;
  }

  if (requiredPermission && !hasPermission(profile, requiredPermission)) {
    window.location.replace('dashboard.html?erro=sem-permissao');
    return null;
  }

  return profile;
}

export async function protectPage(options = {}) {
  try {
    return await requireAuth(options.permission || null);
  } catch (error) {
    console.error('Falha ao validar sessao.', error);
    redirectToLogin('Sessao invalida.');
    return null;
  }
}

function redirectToLogin(message = '') {
  const loginUrl = new URL('login.html', window.location.href);
  if (message) loginUrl.searchParams.set('erro', message);
  window.location.replace(loginUrl.toString());
}
