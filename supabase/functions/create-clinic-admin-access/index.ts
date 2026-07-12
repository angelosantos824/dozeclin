import {
  generateTemporaryPassword,
  handleError,
  HttpError,
  jsonResponse,
  logSafeError,
  readJsonRequest,
  requireDozeclinSuperAdmin
} from '../_shared/first-access.ts';

Deno.serve(async (req) => {
  try {
    const parsed = await readJsonRequest(req);
    if (parsed.response) return parsed.response;

    const { serviceClient } = await requireDozeclinSuperAdmin(req);
    const { profile_id: profileId } = parsed.body as { profile_id?: string };

    if (!profileId) throw new HttpError('Informe o perfil pendente.', 400);

    const { data: profile, error: profileError } = await serviceClient
      .schema('dozeclin')
      .from('profiles')
      .select('id, clinic_id, auth_user_id, full_name, email, role, status, clinics:clinics!profiles_clinic_id_fkey(id, name, status)')
      .eq('id', profileId)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) throw new HttpError('Perfil pendente nao encontrado.', 404);
    if (profile.role !== 'clinic_admin') throw new HttpError('O perfil nao e administrador da clinica.', 400);
    if (profile.status !== 'pending_invite') throw new HttpError('O perfil nao esta pendente de acesso inicial.', 400);
    if (profile.auth_user_id) throw new HttpError('Este administrador ja possui acesso Auth.', 409);
    if (!profile.clinics || profile.clinics.status === 'cancelled') {
      throw new HttpError('A clinica nao permite criar acesso inicial.', 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email || '')) {
      throw new HttpError('Email do administrador invalido.', 400);
    }

    const existingUser = await findAuthUserByEmail(serviceClient, profile.email);
    if (existingUser) throw new HttpError('Ja existe um utilizador Auth com este email.', 409);

    const temporaryPassword = generateTemporaryPassword();
    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email: profile.email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: profile.full_name,
        clinic_id: profile.clinic_id,
        source: 'dozeclin_first_access'
      }
    });

    if (createError || !created.user) throw createError || new Error('Falha ao criar utilizador Auth.');

    try {
      const { error: rpcError } = await serviceClient
        .schema('dozeclin')
        .rpc('activate_clinic_admin_first_access', {
          p_profile_id: profile.id,
          p_auth_user_id: created.user.id
        });

      if (rpcError) throw rpcError;
    } catch (error) {
      const { error: deleteError } = await serviceClient.auth.admin.deleteUser(created.user.id);
      if (deleteError) {
        logSafeError('create-clinic-admin-access', deleteError, 'auth_user_compensation_failed');
        throw new HttpError(
          'Nao foi possivel concluir o acesso inicial. O suporte deve verificar um acesso parcial.',
          500
        );
      }
      throw error;
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
    return handleError(error, 'create-clinic-admin-access');
  }
});

async function findAuthUserByEmail(serviceClient: any, email: string) {
  const normalizedEmail = email.toLowerCase();
  const perPage = 200;
  let page = 1;

  while (true) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data?.users || [];
    const existingUser = users.find((item: any) => item.email?.toLowerCase() === normalizedEmail);
    if (existingUser) return existingUser;
    if (users.length < perPage) return null;

    page += 1;
  }
}
