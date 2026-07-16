import { PERMISSIONS } from '../auth/permissions.js';
import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { showMessage, clearMessage } from '../ui/messages.js';
import {
  getClinicSettingsConfiguration,
  getClinicLogoSignedUrl,
  removeClinicLogo,
  saveClinicConfiguration,
  uploadClinicLogo
} from '../services/clinic-settings.service.js';

const profile = await protectPage(PERMISSIONS.SETTINGS_MANAGE);
const form = document.querySelector('[data-settings-form]');
const message = document.querySelector('[data-message]');
const logoFile = document.querySelector('[data-logo-file]');
const logoImage = document.querySelector('[data-logo-image]');
const logoMonogram = document.querySelector('[data-logo-monogram]');
const saveLogoButton = document.querySelector('[data-save-logo]');
const removeLogoButton = document.querySelector('[data-remove-logo]');
let currentClinic = null;

if (profile) {
  mountLayout(profile);
  bindEvents();
  await loadSettings();
}

function bindEvents() {
  form?.addEventListener('submit', saveSettings);
  logoFile?.addEventListener('change', previewSelectedLogo);
  saveLogoButton?.addEventListener('click', saveLogo);
  removeLogoButton?.addEventListener('click', removeLogo);
}

async function loadSettings() {
  try {
    const { clinic, settings } = await getClinicSettingsConfiguration();
    currentClinic = clinic;

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
    await renderLogo(clinic.logo_url);
  } catch (error) {
    console.error('Falha ao carregar configuracoes da clinica.', error);
    showMessage(message, 'Nao foi possivel carregar as configuracoes. Tente novamente.', 'error');
  }
}

function previewSelectedLogo() {
  const file = logoFile.files?.[0];
  if (!file) {
    renderLogo(currentClinic?.logo_url || null);
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  showLogoImage(objectUrl);
  logoImage.addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
}

async function renderLogo(path) {
  if (!logoMonogram || !logoImage) return;
  const fallback = (currentClinic?.name || profile?.clinics?.name || 'D').trim().charAt(0).toUpperCase() || 'D';
  logoMonogram.textContent = fallback;

  if (!path) {
    showLogoFallback();
    return;
  }

  try {
    const signedUrl = await getClinicLogoSignedUrl(path);
    if (signedUrl) showLogoImage(signedUrl);
    else showLogoFallback();
  } catch (error) {
    console.warn('Nao foi possivel carregar o logotipo da clinica.', error);
    showLogoFallback();
  }
}

function showLogoImage(src) {
  logoImage.src = src;
  logoImage.hidden = false;
  logoMonogram.hidden = true;
}

function showLogoFallback() {
  logoImage.removeAttribute('src');
  logoImage.hidden = true;
  logoMonogram.hidden = false;
}

async function saveLogo() {
  clearMessage(message);
  const file = logoFile?.files?.[0];
  if (!file) {
    showMessage(message, 'Escolha uma imagem para guardar.', 'error');
    return;
  }

  const previousText = saveLogoButton.textContent;
  try {
    saveLogoButton.disabled = true;
    removeLogoButton.disabled = true;
    saveLogoButton.textContent = 'A carregar...';
    showMessage(message, 'A carregar logotipo...', 'info');

    const saved = await uploadClinicLogo(file);
    currentClinic = { ...currentClinic, logo_url: saved.logo_url };
    logoFile.value = '';
    await renderLogo(saved.logo_url);
    showMessage(message, 'Logotipo guardado com sucesso.', 'success');
  } catch (error) {
    console.error('Falha ao guardar logotipo da clinica.', error);
    showMessage(message, error.message || 'Nao foi possivel guardar o logotipo.', 'error');
  } finally {
    saveLogoButton.disabled = false;
    removeLogoButton.disabled = false;
    saveLogoButton.textContent = previousText;
  }
}

async function removeLogo() {
  clearMessage(message);
  const previousText = removeLogoButton.textContent;

  try {
    saveLogoButton.disabled = true;
    removeLogoButton.disabled = true;
    removeLogoButton.textContent = 'A remover...';
    showMessage(message, 'A remover logotipo...', 'info');

    const saved = await removeClinicLogo();
    currentClinic = { ...currentClinic, logo_url: saved.logo_url };
    logoFile.value = '';
    await renderLogo(null);
    showMessage(message, 'Logotipo removido com sucesso.', 'success');
  } catch (error) {
    console.error('Falha ao remover logotipo da clinica.', error);
    showMessage(message, error.message || 'Nao foi possivel remover o logotipo.', 'error');
  } finally {
    saveLogoButton.disabled = false;
    removeLogoButton.disabled = false;
    removeLogoButton.textContent = previousText;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  clearMessage(message);

  const submit = form.querySelector('[data-save-settings]');
  const previousText = submit.textContent;

  try {
    submit.disabled = true;
    submit.textContent = 'A guardar...';
    showMessage(message, 'A guardar...', 'info');

    await saveClinicConfiguration(readPayload());
    showMessage(message, 'Configuracoes guardadas com sucesso.', 'success');
  } catch (error) {
    console.error('Falha ao guardar configuracoes da clinica.', error);
    showMessage(
      message,
      error.message === 'Revise os campos indicados.'
        ? 'Revise os campos indicados.'
        : 'Nao foi possivel guardar as configuracoes. Tente novamente.',
      'error'
    );
  } finally {
    submit.disabled = false;
    submit.textContent = previousText;
  }
}

function readPayload() {
  return {
    clinic: {
      name: form.name.value.trim(),
      legal_name: form.legal_name.value.trim() || null,
      email: form.email.value.trim() || null,
      phone: form.phone.value.trim() || null,
      whatsapp: form.whatsapp.value.trim() || null,
      country: form.country.value.trim() || null,
      city: form.city.value.trim() || null,
      address: form.address.value.trim() || null,
      postal_code: form.postal_code.value.trim() || null,
      timezone: form.timezone.value.trim(),
      default_currency: form.default_currency.value,
      primary_color: form.primary_color.value,
      secondary_color: form.secondary_color.value
    },
    settings: {
      specialty_label: form.specialty_label.value.trim(),
      professional_registration_label: form.professional_registration_label.value.trim(),
      appointment_duration: Number(form.appointment_duration.value || 50),
      appointment_interval: Number(form.appointment_interval.value || 10),
      cancellation_policy: form.cancellation_policy.value.trim() || null,
      footer_text: form.footer_text.value.trim() || null,
      email_signature: form.email_signature.value.trim() || null
    }
  };
}
