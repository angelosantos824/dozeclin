import {
  getAuthenticatedUser,
  handleError,
  HttpError,
  jsonResponse,
  readJsonRequest,
  validateNewPassword
} from '../_shared/first-access.ts';

Deno.serve(async (req) => {
  try {
    const parsed = await readJsonRequest(req);
    if (parsed.response) return parsed.response;

    const { user, serviceClient } = await getAuthenticatedUser(req);
    const { new_password: newPassword } = parsed.body as { new_password?: string };

    if (typeof newPassword !== 'string') throw new HttpError('Informe a nova senha.', 400);
    const passwordError = validateNewPassword(newPassword);
    if (passwordError) throw new HttpError(passwordError, 400);

    const { data: profile, error: profileError } = await serviceClient
      .schema('dozeclin')
      .from('profiles')
      .select('id, auth_user_id, must_change_password, status')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) throw new HttpError('Perfil operacional nao encontrado.', 404);
    if (!profile.must_change_password) throw new HttpError('Nao existe alteracao de senha pendente.', 400);

    const { error: updateError } = await serviceClient.auth.admin.updateUserById(user.id, {
      password: newPassword
    });
    if (updateError) throw updateError;

    const { error: rpcError } = await serviceClient
      .schema('dozeclin')
      .rpc('mark_first_access_password_changed', { p_auth_user_id: user.id });
    if (rpcError) throw rpcError;

    return jsonResponse({ success: true });
  } catch (error) {
    return handleError(error, 'complete-first-access-password');
  }
});
