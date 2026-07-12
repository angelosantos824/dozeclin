import { supabaseDozedev } from '../config/supabase.js';

export async function getCurrentPlatformUser() {
  const { data: sessionData, error: sessionError } = await supabaseDozedev.auth.getSession();
  if (sessionError) throw sessionError;
  const authUserId = sessionData.session?.user?.id;
  if (!authUserId) return null;

  const { data, error } = await supabaseDozedev
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
    .eq('auth_user_id', authUserId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return normalizePlatformUser(data);
}

export async function isPlatformSuperAdmin() {
  const { data, error } = await supabaseDozedev.rpc('is_platform_super_admin');
  if (error) throw error;
  return Boolean(data);
}

export async function canAccessProduct(productCode) {
  const { data, error } = await supabaseDozedev.rpc('can_access_product', {
    p_product_code: productCode
  });

  if (error) throw error;
  return Boolean(data);
}

export async function listPlatformProducts() {
  const { data, error } = await supabaseDozedev
    .from('products')
    .select('id, code, name, description, schema_name, status, created_at, updated_at')
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function listPlatformUsers() {
  const { data, error } = await supabaseDozedev
    .from('platform_users')
    .select('id, auth_user_id, email, full_name, role, status, last_login_at, created_at, updated_at')
    .order('email', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function grantProductAccess() {
  throw new Error('Concessao de acesso sera implementada por RPC segura em sprint futura.');
}

export async function revokeProductAccess() {
  throw new Error('Revogacao de acesso sera implementada por RPC segura em sprint futura.');
}

export function normalizePlatformUser(user) {
  if (!user) return null;

  const links = user.platform_user_products || [];
  const productAccess = links
    .filter((link) => (
      link.status === 'active'
      && link.products
      && ['active', 'development'].includes(link.products.status)
    ))
    .map((link) => link.products.code);

  return {
    id: user.id,
    platform_user_id: user.id,
    auth_user_id: user.auth_user_id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    status: user.status,
    is_platform_user: true,
    clinic_id: null,
    clinics: null,
    product_access: productAccess,
    product_links: links
  };
}
