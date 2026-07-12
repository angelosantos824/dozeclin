import { getCurrentProfile } from './auth.js';
import { hasPermission } from './permissions.js';
import { canAccessProduct } from '../services/platform.service.js';

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

  if (profile.is_platform_user) {
    if (!requiredPermission) {
      window.location.replace('plataforma.html');
      return null;
    }

    if (requiredPermission && !hasPermission(profile, requiredPermission)) {
      window.location.replace('plataforma.html?erro=sem-permissao');
      return null;
    }

    return profile;
  }

  if (profile.must_change_password && !isCurrentPage('alterar-senha-inicial.html')) {
    window.location.replace('alterar-senha-inicial.html');
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

function isCurrentPage(pageName) {
  return window.location.pathname.split('/').pop() === pageName;
}

export async function requirePlatformUser() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirectToLogin();
    return null;
  }

  if (!profile.is_platform_user || profile.status !== 'active') {
    window.location.replace('dashboard.html?erro=sem-permissao');
    return null;
  }

  return profile;
}

export async function requirePlatformSuperAdmin() {
  const profile = await requirePlatformUser();
  if (!profile) return null;

  if (profile.role !== 'super_admin') {
    window.location.replace('dashboard.html?erro=sem-permissao');
    return null;
  }

  return profile;
}

export async function requireProductAccess(productCode) {
  const profile = await requirePlatformUser();
  if (!profile) return null;

  try {
    const allowed = await canAccessProduct(productCode);
    if (!allowed) {
      window.location.replace('plataforma.html?erro=produto-sem-acesso');
      return null;
    }
  } catch (error) {
    console.error('Falha ao validar acesso ao produto.', error);
    window.location.replace('plataforma.html?erro=produto-indisponivel');
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
