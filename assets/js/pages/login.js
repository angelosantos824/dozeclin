import { getCurrentProfile, signIn, sendPasswordReset } from '../auth/auth.js';
import { isSupabaseConfigured } from '../config/supabase.js';
import { showMessage, clearMessage } from '../ui/messages.js';

const form = document.querySelector('[data-login-form]');
const resetButton = document.querySelector('[data-reset-password]');
const message = document.querySelector('[data-message]');

if (!isSupabaseConfigured()) {
  showMessage(message, 'Configure o Supabase do DOZECLIN antes de entrar.', 'warning');
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage(message);

  const formData = new FormData(form);
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '').trim();

  if (!email || !password) {
    showMessage(message, 'Preencha email e senha.', 'error');
    return;
  }

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'A entrar...';

  try {
    const { error } = await signIn(email, password);
    if (error) throw error;
    const profile = await getCurrentProfile();
    if (profile?.is_platform_user) {
      window.location.replace('plataforma.html');
      return;
    }
    if (profile?.must_change_password) {
      window.location.replace('alterar-senha-inicial.html');
      return;
    }
    window.location.replace(profile?.role === 'patient' ? 'portal-paciente.html' : 'dashboard.html');
  } catch (error) {
    showMessage(message, 'Acesso negado. Verifique os dados informados.', 'error');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Entrar';
  }
});

resetButton?.addEventListener('click', async () => {
  clearMessage(message);
  const email = String(new FormData(form).get('email') || '').trim();

  if (!email) {
    showMessage(message, 'Informe o email para recuperar a senha.', 'error');
    return;
  }

  try {
    const { error } = await sendPasswordReset(email);
    if (error) throw error;
    showMessage(message, 'Enviamos as instrucoes para o email informado.', 'success');
  } catch (error) {
    showMessage(message, 'Nao foi possivel enviar a recuperacao de senha.', 'error');
  }
});
