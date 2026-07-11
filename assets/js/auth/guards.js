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

  if (profile.role !== 'super_admin' && !profile.clinic_id) {
    redirectToLogin('Perfil sem clinica associada.');
    return null;
  }

  if (profile.role !== 'super_admin' && profile.clinics && !['trial', 'active'].includes(profile.clinics.status)) {
    const unavailableUrl = new URL('acesso-indisponivel.html', window.location.href);
    unavailableUrl.searchParams.set('status', profile.clinics.status);
    window.location.replace(unavailableUrl.toString());
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
    const permission =
      typeof options === 'string'
        ? options
        : options.permission || null;

    return await requireAuth(permission);
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
