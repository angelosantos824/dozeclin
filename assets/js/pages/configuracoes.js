import { PERMISSIONS } from '../auth/permissions.js';
import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { getClinic, getClinicSettings, updateClinic, upsertClinicSettings } from '../services/clinics.service.js';
import { showMessage, clearMessage } from '../ui/messages.js';

const profile = await protectPage(PERMISSIONS.SETTINGS_MANAGE);

if (profile) {
  mountLayout(profile);
  await loadSettings(profile);
  document.querySelector('[data-settings-form]')?.addEventListener('submit', saveSettings);
}

async function loadSettings(profile) {
  const [clinic, settings] = await Promise.all([
    getClinic(profile.clinic_id),
    getClinicSettings(profile.clinic_id)
  ]);

  const form = document.querySelector('[data-settings-form]');
  form.name.value = clinic.name || '';
  form.legal_name.value = clinic.legal_name || '';
  form.email.value = clinic.email || '';
  form.phone.value = clinic.phone || '';
  form.whatsapp.value = clinic.whatsapp || '';
  form.country.value = clinic.country || '';
  form.city.value = clinic.city || '';
  form.address.value = clinic.address || '';
  form.postal_code.value = clinic.postal_code || '';
  form.timezone.value = clinic.timezone || 'Europe/Lisbon';
  form.default_currency.value = clinic.default_currency || 'EUR';
  form.primary_color.value = clinic.primary_color || '#176B87';
  form.secondary_color.value = clinic.secondary_color || '#64CCC5';
  form.specialty_label.value = settings?.specialty_label || 'Especialidade';
  form.professional_registration_label.value = settings?.professional_registration_label || 'Numero profissional';
  form.appointment_duration.value = settings?.appointment_duration || 50;
  form.appointment_interval.value = settings?.appointment_interval || 10;
  form.cancellation_policy.value = settings?.cancellation_policy || '';
  form.footer_text.value = settings?.footer_text || '';
  form.email_signature.value = settings?.email_signature || '';
}

async function saveSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('[data-message]');
  clearMessage(message);

  try {
    await updateClinic(profile.clinic_id, {
      name: form.name.value.trim(),
      legal_name: form.legal_name.value.trim() || null,
      email: form.email.value.trim() || null,
      phone: form.phone.value.trim() || null,
      whatsapp: form.whatsapp.value.trim() || null,
      country: form.country.value.trim() || null,
      city: form.city.value.trim() || null,
      address: form.address.value.trim() || null,
      postal_code: form.postal_code.value.trim() || null,
      timezone: form.timezone.value,
      default_currency: form.default_currency.value,
      primary_color: form.primary_color.value,
      secondary_color: form.secondary_color.value
    });

    await upsertClinicSettings({
      clinic_id: profile.clinic_id,
      specialty_label: form.specialty_label.value.trim(),
      professional_registration_label: form.professional_registration_label.value.trim(),
      appointment_duration: Number(form.appointment_duration.value || 50),
      appointment_interval: Number(form.appointment_interval.value || 10),
      cancellation_policy: form.cancellation_policy.value.trim() || null,
      default_language: 'pt-PT',
      footer_text: form.footer_text.value.trim() || null,
      email_signature: form.email_signature.value.trim() || null
    });

    showMessage(message, 'Configuracoes guardadas.', 'success');
  } catch (error) {
    showMessage(message, 'Nao foi possivel guardar as configuracoes.', 'error');
  }
}
