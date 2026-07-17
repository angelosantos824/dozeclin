import { getCurrentProfile, signOut } from '../auth/auth.js';
import { APP_URLS } from '../config/app-config.js';
import { supabase } from '../config/supabase.js';
import { showMessage, clearMessage } from '../ui/messages.js';

const profile = await getCurrentProfile();
const form = document.querySelector('[data-initial-password-form]');
const message = document.querySelector('[data-message]');

if (!profile) {
  window.location.replace(APP_URLS.login);
} else if (profile.is_platform_user || !profile.must_change_password) {
  window.location.replace(profile.role === 'patient' ? APP_URLS.patientPortal : APP_URLS.dashboard);
}

form?.addEventListener('submit', changePassword);
document.querySelector('[data-toggle-password]')?.addEventListener('change', togglePasswordVisibility);
document.querySelector('[data-logout]')?.addEventListener('click', async () => {
  await signOut();
  window.location.replace(APP_URLS.login);
});

async function changePassword(event) {
  event.preventDefault();
  clearMessage(message);

  const password = form.password.value;
  const confirmation = form.confirm_password.value;
  const submit = form.querySelector('button[type="submit"]');
  const validationError = validatePassword(password, confirmation);

  if (validationError) {
    showMessage(message, validationError, 'error');
    return;
  }

  try {
    submit.disabled = true;
    submit.textContent = 'A guardar...';

    const { error } = await supabase.functions.invoke('complete-first-access-password', {
      body: { new_password: password }
    });

    if (error) throw await mapFunctionError(error);

    form.password.value = '';
    form.confirm_password.value = '';
    showMessage(message, 'Senha alterada com sucesso.', 'success');
    window.location.replace(profile.role === 'patient' ? APP_URLS.patientPortal : APP_URLS.dashboard);
  } catch (error) {
    console.error('Falha ao alterar senha inicial.', { message: error.message });
    showMessage(message, error.message || 'Nao foi possivel alterar a senha. Tente novamente.', 'error');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Definir nova senha';
  }
}

async function mapFunctionError(error) {
  if (error?.context instanceof Response) {
    try {
      const payload = await error.context.json();
      if (typeof payload?.error === 'string') return new Error(payload.error);
    } catch (_parseError) {
      return new Error('Nao foi possivel alterar a senha. Tente novamente.');
    }
  }

  return new Error(error?.message || 'Nao foi possivel alterar a senha. Tente novamente.');
}

function validatePassword(password, confirmation) {
  if (password !== confirmation) return 'A confirmacao deve ser igual a nova senha.';
  if (password.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (!/[A-Z]/.test(password)) return 'A senha deve conter uma letra maiuscula.';
  if (!/[a-z]/.test(password)) return 'A senha deve conter uma letra minuscula.';
  if (!/[0-9]/.test(password)) return 'A senha deve conter um numero.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'A senha deve conter um simbolo.';
  return null;
}

function togglePasswordVisibility(event) {
  const type = event.currentTarget.checked ? 'text' : 'password';
  form.password.type = type;
  form.confirm_password.type = type;
}
