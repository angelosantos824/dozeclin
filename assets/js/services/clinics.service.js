import { supabase } from '../config/supabase.js';

export async function getClinic(clinicId) {
  const { data, error } = await supabase
    .from('clinics')
    .select('id, name, legal_name, slug, document, email, phone, whatsapp, country, city, address, postal_code, timezone, default_currency, logo_url, primary_color, secondary_color, status')
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
