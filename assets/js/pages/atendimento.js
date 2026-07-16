import { submitPatientRequest } from '../services/patient-requests.service.js';
import { showMessage, clearMessage } from '../ui/messages.js';

const form = document.querySelector('[data-request-form]');
const message = document.querySelector('[data-message]');
const params = new URLSearchParams(window.location.search);
const clinicSlug = params.get('clinica') || params.get('clinic') || '';
const renderedAt = new Date().toISOString();

if (!clinicSlug) {
  showMessage(message, 'Link de solicitacao incompleto. Contacte a clinica.', 'error');
  form?.querySelectorAll('input, select, textarea, button').forEach((field) => {
    field.disabled = true;
  });
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage(message);

  const submit = form.querySelector('button[type="submit"]');
  const payload = {
    clinicSlug,
    fullName: form.full_name.value.trim(),
    email: form.email.value.trim().toLowerCase(),
    phone: form.phone.value.trim(),
    interest: form.interest.value,
    message: form.message.value.trim().slice(0, 1200),
    consentAccepted: form.consent.checked,
    honeypot: form.website.value,
    renderedAt
  };

  if (!payload.fullName || !payload.email || !payload.phone || !payload.interest) {
    showMessage(message, 'Preencha os campos obrigatorios.', 'error');
    return;
  }

  if (!payload.consentAccepted) {
    showMessage(message, 'Precisamos do seu consentimento para enviar a solicitacao.', 'error');
    return;
  }

  try {
    submit.disabled = true;
    submit.textContent = 'A enviar...';
    await submitPatientRequest(payload);
    form.reset();
    showMessage(message, 'Recebemos sua solicitacao. A clinica entrara em contacto em breve.', 'success');
  } catch (error) {
    showMessage(message, 'Recebemos sua solicitacao. A clinica entrara em contacto em breve.', 'success');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Solicitar atendimento';
  }
});
