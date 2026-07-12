import { supabase, supabaseDozedev } from '../config/supabase.js';
import { normalizePlatformUser } from '../services/platform.service.js';

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function sendPasswordReset(email) {
  const redirectTo = new URL('login.html', window.location.href).href;
  return supabase.auth.resetPasswordForEmail(email, { redirectTo });
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentProfile() {
  const session = await getSession();
  if (!session?.user) return null;

  const { data: platformUser, error: platformError } = await supabaseDozedev
    .from('platform_users')
    .select(`
      id,
      auth_user_id,
      email,
      full_name,
      role,
      status,
      last_login_at,
      platform_user_products:platform_user_products!platform_user_products_platform_user_id_fkey (
        access_role,
        status,
        products:products!platform_user_products_product_id_fkey (
          code,
          name,
          schema_name,
          status
        )
      )
    `)
    .eq('auth_user_id', session.user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (platformError && !isPlatformSchemaUnavailable(platformError)) throw platformError;

  const normalizedPlatformUser = platformError ? null : normalizePlatformUser(platformUser);
  if (normalizedPlatformUser?.role === 'super_admin' && normalizedPlatformUser.product_access.includes('dozeclin')) {
    return normalizedPlatformUser;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select(`
      id,
      clinic_id,
      auth_user_id,
      full_name,
      email,
      role,
      status,
      must_change_password,
      password_changed_at,
      activated_at,
      clinics:clinics!profiles_clinic_id_fkey (
        id,
        name,
        slug,
        status,
        specialty,
        plan_code,
        logo_url,
        primary_color,
        secondary_color,
        timezone
      )
    `)
    .eq('auth_user_id', session.user.id)
    .maybeSingle();

  if (error) throw error;
  return data ? { ...data, is_platform_user: false } : null;
}

function isPlatformSchemaUnavailable(error) {
  const message = String(error?.message || '').toLowerCase();
  return ['pgrst106', '42p01', '3f000'].includes(error?.code)
    || message.includes('schema')
    || message.includes('platform_users')
    || message.includes('dozedev');
}
