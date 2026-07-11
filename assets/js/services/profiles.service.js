import { supabase } from '../config/supabase.js';

const PROFILE_FIELDS = 'id, auth_user_id, clinic_id, full_name, email, phone, role, professional_registration, specialty, status, created_at, updated_at';
const PROFESSIONAL_ROLES = ['professional', 'supervisor', 'clinic_admin'];

export async function getProfileById(id) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

export async function listProfessionals(clinicId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('clinic_id', clinicId)
    .in('role', PROFESSIONAL_ROLES)
    .order('full_name', { ascending: true });

  if (error) throw error;

  return (data || []).filter((profile) => {
    return profile.role !== 'clinic_admin' || Boolean(profile.specialty);
  });
}

export async function createProfessional(clinicId, payload) {
  const { data, error } = await supabase
    .from('profiles')
    .insert([{
      ...payload,
      clinic_id: clinicId,
      role: payload.role || 'professional',
      status: 'pending_invite'
    }])
    .select(PROFILE_FIELDS)
    .single();

  if (error) throw error;
  return data;
}

export async function updateProfessional(id, payload) {
  const { data, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', id)
    .select(PROFILE_FIELDS)
    .single();

  if (error) throw error;
  return data;
}

export async function updateProfessionalStatus(id, status) {
  return updateProfessional(id, { status });
}
