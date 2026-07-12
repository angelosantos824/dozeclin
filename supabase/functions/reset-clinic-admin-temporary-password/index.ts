import {
  generateTemporaryPassword,
  handleError,
  HttpError,
  jsonResponse,
  readJsonRequest,
  requireDozeclinSuperAdmin
} from '../_shared/first-access.ts';

Deno.serve(async (req) => {
  try {
    const parsed = await readJsonRequest(req);
    if (parsed.response) return parsed.response;

    const { serviceClient } = await requireDozeclinSuperAdmin(req);
    const { profile_id: profileId } = parsed.body as { profile_id?: string };

    if (!profileId) throw new HttpError('Informe o perfil do administrador.', 400);

    const { data: profile, error: profileError } = await serviceClient
      .schema('dozeclin')
      .from('profiles')
      .select('id, clinic_id, auth_user_id, full_name, email, role, status, clinics:clinics!profiles_clinic_id_fkey(id, name, status)')
      .eq('id', profileId)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) throw new HttpError('Administrador nao encontrado.', 404);
    if (profile.role !== 'clinic_admin' || !profile.auth_user_id) {
      throw new HttpError('Administrador sem acesso Auth ativo.', 400);
    }
    if (!profile.clinics || profile.clinics.status === 'cancelled') {
      throw new HttpError('A clinica nao permite redefinir acesso.', 400);
    }

    const temporaryPassword = generateTemporaryPassword();
    const { error: rpcError } = await serviceClient
      .schema('dozeclin')
      .rpc('mark_temporary_password_reset', { p_profile_id: profile.id });
    if (rpcError) throw rpcError;

    const { error: updateError } = await serviceClient.auth.admin.updateUserById(profile.auth_user_id, {
      password: temporaryPassword
    });
    if (updateError) {
      throw new HttpError('Senha temporaria marcada para troca, mas nao foi possivel atualizar o Auth.', 500);
    }

    return jsonResponse({
      clinic_name: profile.clinics.name,
      admin_name: profile.full_name,
      email: profile.email,
      temporary_password: temporaryPassword,
      must_change_password: true,
      one_time_display: true
    });
  } catch (error) {
    return handleError(error, 'reset-clinic-admin-temporary-password');
  }
});
