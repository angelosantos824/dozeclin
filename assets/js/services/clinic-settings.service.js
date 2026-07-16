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

const BRANDING_BUCKET = 'document-assets';
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MIME_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};

export async function getClinicSettingsConfiguration() {
  const profile = await requireOperationalClinicAdmin();

  const [clinicResult, settingsResult] = await Promise.all([
    supabase
      .from('clinics')
      .select('id, name, legal_name, email, phone, whatsapp, country, city, address, postal_code, timezone, default_currency, logo_url, primary_color, secondary_color')
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

export async function getClinicLogoSignedUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;

  const { data, error } = await supabase.storage
    .from(BRANDING_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error) throw mapSettingsError(error);
  return data?.signedUrl || null;
}

export async function uploadClinicLogo(file) {
  const profile = await requireOperationalClinicAdmin();
  validateLogoFile(file);
  const preparedFile = await prepareLogoFile(file);

  const current = await getClinicSettingsConfiguration();
  const previousPath = current.clinic?.logo_url || null;
  const extension = LOGO_MIME_EXTENSIONS[preparedFile.type];
  const logoPath = `clinic-branding/${profile.clinic_id}/logo.${extension}`;

  if (previousPath && !/^https?:\/\//i.test(previousPath)) {
    await supabase.storage.from(BRANDING_BUCKET).remove([previousPath]);
  }

  const { error: uploadError } = await supabase.storage
    .from(BRANDING_BUCKET)
    .upload(logoPath, preparedFile, {
      contentType: preparedFile.type,
      cacheControl: '3600',
      upsert: false
    });

  if (uploadError) throw mapSettingsError(uploadError);

  const { data, error } = await supabase
    .from('clinics')
    .update({ logo_url: logoPath })
    .eq('id', profile.clinic_id)
    .select('id, logo_url')
    .single();

  if (error) throw mapSettingsError(error);
  return data;
}

export async function removeClinicLogo() {
  const profile = await requireOperationalClinicAdmin();
  const current = await getClinicSettingsConfiguration();
  const previousPath = current.clinic?.logo_url || null;

  if (previousPath && !/^https?:\/\//i.test(previousPath)) {
    await supabase.storage.from(BRANDING_BUCKET).remove([previousPath]);
  }

  const { data, error } = await supabase
    .from('clinics')
    .update({ logo_url: null })
    .eq('id', profile.clinic_id)
    .select('id, logo_url')
    .single();

  if (error) throw mapSettingsError(error);
  return data;
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

function validateLogoFile(file) {
  if (!file) throw new Error('Escolha uma imagem para carregar.');
  if (!LOGO_MIME_EXTENSIONS[file.type]) {
    throw new Error('Formato invalido. Utilize PNG, JPG, JPEG ou WEBP.');
  }
  if (file.size > LOGO_MAX_BYTES) {
    throw new Error('O logotipo deve ter no maximo 2 MB.');
  }
}

async function prepareLogoFile(file) {
  if (file.type !== 'image/webp') return file;

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Nao foi possivel processar o logotipo.'));
      img.src = imageUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) {
      throw new Error('Nao foi possivel processar o logotipo.');
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Nao foi possivel converter o logotipo.'));
      }, 'image/png');
    });

    return new File([blob], file.name.replace(/\.[^.]+$/, '.png'), { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(imageUrl);
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
