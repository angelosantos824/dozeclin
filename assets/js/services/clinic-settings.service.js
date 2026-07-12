import { getCurrentProfile } from '../auth/auth.js';
import { supabase } from '../config/supabase.js';

const CLINIC_BASIC_FIELDS = [
  'name',
  'legal_name',
  'email',
  'phone',
  'whatsapp',
  'country',
  'city',
  'address',
  'postal_code',
  'timezone',
  'default_currency',
  'primary_color',
  'secondary_color'
];

export async function getClinicSettingsConfiguration() {
  const profile = await requireOperationalClinicAdmin();

  const [clinicResult, settingsResult] = await Promise.all([
    supabase
      .from('clinics')
      .select('id, name, legal_name, email, phone, whatsapp, country, city, address, postal_code, timezone, default_currency, primary_color, secondary_color')
      .eq('id', profile.clinic_id)
      .single(),
    supabase
      .from('clinic_settings')
      .select('*')
      .eq('clinic_id', profile.clinic_id)
      .maybeSingle()
  ]);

  if (clinicResult.error) throw mapSettingsError(clinicResult.error);
  if (settingsResult.error) throw mapSettingsError(settingsResult.error);

  return {
    clinic: clinicResult.data,
    settings: settingsResult.data,
    profile
  };
}

export async function updateClinicBasicData(data) {
  const profile = await requireOperationalClinicAdmin();
  const payload = pick(data, CLINIC_BASIC_FIELDS);

  const { data: saved, error } = await supabase
    .from('clinics')
    .update(payload)
    .eq('id', profile.clinic_id)
    .select()
    .single();

  if (error) throw mapSettingsError(error);
  return saved;
}

export async function updateClinicSettings(data) {
  const profile = await requireOperationalClinicAdmin();
  const payload = {
    clinic_id: profile.clinic_id,
    specialty_label: data.specialty_label || null,
    professional_registration_label: data.professional_registration_label || null,
    appointment_duration: Number(data.appointment_duration || 50),
    appointment_interval: Number(data.appointment_interval || 10),
    cancellation_policy: data.cancellation_policy || null,
    default_language: 'pt-PT',
    footer_text: data.footer_text || null,
    email_signature: data.email_signature || null
  };

  const { data: saved, error } = await supabase
    .from('clinic_settings')
    .upsert(payload, { onConflict: 'clinic_id' })
    .select()
    .single();

  if (error) throw mapSettingsError(error);
  return saved;
}

export async function saveClinicConfiguration(data) {
  validateConfiguration(data);
  await requireOperationalClinicAdmin();

  const { data: saved, error } = await supabase.rpc('save_clinic_configuration', {
    p_clinic: pick(data.clinic, CLINIC_BASIC_FIELDS),
    p_settings: {
      specialty_label: data.settings.specialty_label || null,
      professional_registration_label: data.settings.professional_registration_label || null,
      appointment_duration: Number(data.settings.appointment_duration || 50),
      appointment_interval: Number(data.settings.appointment_interval || 10),
      cancellation_policy: data.settings.cancellation_policy || null,
      footer_text: data.settings.footer_text || null,
      email_signature: data.settings.email_signature || null
    }
  });

  if (error) throw mapSettingsError(error);
  return saved;
}

function validateConfiguration(data) {
  if (!data.clinic.name) throw new Error('Revise os campos indicados.');
  if (!data.clinic.timezone) throw new Error('Revise os campos indicados.');
  if (data.clinic.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.clinic.email)) {
    throw new Error('Revise os campos indicados.');
  }
}

async function requireOperationalClinicAdmin() {
  const profile = await getCurrentProfile();

  if (!profile || profile.is_platform_user || !profile.clinic_id || profile.role !== 'clinic_admin') {
    throw new Error('Perfil operacional da clinica nao encontrado.');
  }

  return profile;
}

function pick(source, fields) {
  return fields.reduce((payload, field) => {
    payload[field] = source[field] ?? null;
    return payload;
  }, {});
}

function mapSettingsError(error) {
  console.error('Falha tecnica ao guardar configuracoes da clinica.', error);
  return new Error('Nao foi possivel guardar as configuracoes. Tente novamente.');
}
