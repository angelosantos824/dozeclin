import { supabase } from '../config/supabase.js';
import { getCurrentProfile } from '../auth/auth.js';

const CLINIC_FIELDS = [
  'id',
  'name',
  'legal_name',
  'slug',
  'document',
  'email',
  'phone',
  'whatsapp',
  'country',
  'city',
  'address',
  'postal_code',
  'timezone',
  'default_currency',
  'logo_url',
  'primary_color',
  'secondary_color',
  'status',
  'specialty',
  'plan_code',
  'owner_profile_id',
  'activated_at',
  'suspended_at',
  'suspension_reason',
  'created_at',
  'updated_at'
].join(', ');

export async function listClinics(filters = {}) {
  await requireSuperAdmin();

  let query = supabase
    .from('clinics')
    .select(CLINIC_FIELDS)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.planCode) query = query.eq('plan_code', filters.planCode);
  if (filters.specialty) query = query.eq('specialty', filters.specialty);

  const { data: clinics, error } = await query;
  if (error) throw error;

  const admins = await Promise.all((clinics || []).map((clinic) => getClinicAdmin(clinic.id)));

  return (clinics || []).map((clinic, index) => ({
    ...clinic,
    owner: admins[index],
    users_count: null,
    active_users_count: null
  }));
}

export async function getClinic(clinicId) {
  const { data, error } = await supabase
    .from('clinics')
    .select(CLINIC_FIELDS)
    .eq('id', clinicId)
    .single();

  if (error) throw error;
  return data;
}

export async function updateClinic(clinicId, payload) {
  const { data, error } = await supabase
    .from('clinics')
    .update(payload)
    .eq('id', clinicId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function createClinic(data) {
  return createClinicWithAdmin(data);
}

export async function createClinicWithAdmin(data) {
  await requireSuperAdmin();

  const { data: created, error } = await supabase.rpc('create_clinic_with_admin', {
    p_name: data.name,
    p_legal_name: data.legal_name || null,
    p_slug: data.slug || null,
    p_document: data.document || null,
    p_email: data.email || null,
    p_phone: data.phone || null,
    p_whatsapp: data.whatsapp || null,
    p_country: data.country || 'Portugal',
    p_city: data.city || null,
    p_address: data.address || null,
    p_postal_code: data.postal_code || null,
    p_timezone: data.timezone || 'Europe/Lisbon',
    p_default_currency: data.default_currency || 'EUR',
    p_specialty: data.specialty || 'psychoanalysis',
    p_plan_code: data.plan_code || 'basic',
    p_primary_color: data.primary_color || '#7c3aed',
    p_secondary_color: data.secondary_color || '#a855f7',
    p_admin_full_name: data.admin_full_name,
    p_admin_email: data.admin_email,
    p_admin_phone: data.admin_phone || null
  });

  if (error) throw error;
  return created;
}

export async function createClinicAdminAccess(profileId) {
  await requireSuperAdmin();

  const { data, error } = await supabase.functions.invoke('create-clinic-admin-access', {
    body: { profile_id: profileId }
  });

  if (error) throw await mapFunctionError(error);
  return data;
}

export async function resetClinicAdminTemporaryPassword(profileId) {
  await requireSuperAdmin();

  const { data, error } = await supabase.functions.invoke('reset-clinic-admin-temporary-password', {
    body: { profile_id: profileId }
  });

  if (error) throw await mapFunctionError(error);
  return data;
}

export async function getClinicAdmin(clinicId) {
  await requireSuperAdmin();

  const { data, error } = await supabase.rpc('get_clinic_primary_admin', {
    p_clinic_id: clinicId
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data;
}

export async function suspendClinic(clinicId, reason) {
  return updateClinicStatus(clinicId, 'suspended', reason);
}

export async function reactivateClinic(clinicId) {
  return updateClinicStatus(clinicId, 'active', null);
}

export async function cancelClinic(clinicId, reason) {
  return updateClinicStatus(clinicId, 'cancelled', reason);
}

export async function updateClinicPlan(clinicId, planCode) {
  await requireSuperAdmin();

  const { data, error } = await supabase.rpc('update_clinic_plan', {
    p_clinic_id: clinicId,
    p_plan_code: planCode
  });

  if (error) throw error;
  return data;
}

async function updateClinicStatus(clinicId, status, reason) {
  await requireSuperAdmin();

  const { data, error } = await supabase.rpc('update_clinic_status', {
    p_clinic_id: clinicId,
    p_status: status,
    p_reason: reason || null
  });

  if (error) throw error;
  return data;
}

async function requireSuperAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_platform_user || profile.role !== 'super_admin' || profile.status !== 'active') {
    throw new Error('Apenas administradores do produto podem executar esta acao.');
  }
  return profile;
}

async function mapFunctionError(error) {
  let message = null;

  if (error?.context instanceof Response) {
    try {
      const payload = await error.context.json();
      message = typeof payload?.error === 'string' ? payload.error : null;
    } catch (_parseError) {
      message = null;
    }
  } else if (typeof error?.context?.error === 'string') {
    message = error.context.error;
  }

  return new Error(message || error?.message || 'Nao foi possivel executar a operacao.');
}

export async function getClinicSettings(clinicId) {
  const { data, error } = await supabase
    .from('clinic_settings')
    .select('*')
    .eq('clinic_id', clinicId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function upsertClinicSettings(payload) {
  const { data, error } = await supabase
    .from('clinic_settings')
    .upsert(payload, { onConflict: 'clinic_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}
