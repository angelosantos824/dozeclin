import {
  generateTemporaryPassword,
  handleError,
  HttpError,
  jsonResponse,
  logSafeError,
  readJsonRequest,
  getAuthenticatedUser
} from '../_shared/first-access.ts';

const STAFF_ROLES = ['clinic_admin', 'reception', 'professional', 'supervisor'];

Deno.serve(async (req) => {
  try {
    const parsed = await readJsonRequest(req);
    if (parsed.response) return parsed.response;

    const { user, serviceClient } = await getAuthenticatedUser(req);
    const { request_id: requestId } = parsed.body as { request_id?: string };

    if (!requestId) throw new HttpError('Informe a solicitacao.', 400);

    const operator = await requireClinicStaff(serviceClient, user.id);
    const { data: request, error: requestError } = await serviceClient
      .schema('dozeclin')
      .from('patient_requests')
      .select('id, clinic_id, patient_id, full_name, email, phone, interest, message, status, clinics:clinics!patient_requests_clinic_id_fkey(id, name, slug, status)')
      .eq('id', requestId)
      .eq('clinic_id', operator.clinic_id)
      .maybeSingle();

    if (requestError) throw requestError;
    if (!request) throw new HttpError('Solicitacao nao encontrada.', 404);
    if (request.patient_id || request.status === 'converted') {
      throw new HttpError('Esta solicitacao ja possui paciente criado.', 409);
    }
    if (request.status === 'closed') throw new HttpError('Esta solicitacao esta encerrada.', 409);
    if (!['trial', 'active'].includes(request.clinics?.status)) {
      throw new HttpError('A clinica nao permite criar Portal do Paciente.', 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.email || '')) {
      throw new HttpError('Email do paciente invalido.', 400);
    }

    const existingPatient = await findPatientByEmail(serviceClient, operator.clinic_id, request.email);
    if (existingPatient) throw new HttpError('Ja existe paciente com este email nesta clinica.', 409);

    const existingUser = await findAuthUserByEmail(serviceClient, request.email);
    if (existingUser) throw new HttpError('Ja existe utilizador Auth com este email.', 409);

    const temporaryPassword = generateTemporaryPassword();
    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email: request.email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: request.full_name,
        clinic_id: operator.clinic_id,
        source: 'dozeclin_patient_journey'
      }
    });

    if (createError || !created.user) throw createError || new Error('Falha ao criar utilizador Auth.');

    try {
      const { data: result, error: transactionError } = await serviceClient
        .schema('dozeclin')
        .rpc('start_patient_journey_transaction', {
          p_request_id: request.id,
          p_auth_user_id: created.user.id
        });

      if (transactionError) throw transactionError;

      const portalUrl = buildPortalUrl(req);
      const readyMessage = buildReadyMessage({
        portalUrl,
        email: request.email,
        temporaryPassword
      });

      return jsonResponse({
        patient_name: request.full_name,
        email: request.email,
        phone: request.phone,
        temporary_password: temporaryPassword,
        portal_url: portalUrl,
        whatsapp_url: buildWhatsAppUrl(request.phone, readyMessage),
        ready_message: readyMessage,
        ids: result
      });
    } catch (error) {
      const { error: deleteError } = await serviceClient.auth.admin.deleteUser(created.user.id);
      if (deleteError) {
        logSafeError('start-patient-journey', deleteError, 'auth_user_compensation_failed');
        throw new HttpError(
          'Nao foi possivel concluir o Portal. O suporte deve verificar um acesso parcial.',
          500
        );
      }
      throw error;
    }
  } catch (error) {
    return handleError(error, 'start-patient-journey');
  }
});

async function requireClinicStaff(serviceClient: any, authUserId: string) {
  const { data, error } = await serviceClient
    .schema('dozeclin')
    .from('profiles')
    .select('id, clinic_id, auth_user_id, full_name, email, role, status')
    .eq('auth_user_id', authUserId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!data || !STAFF_ROLES.includes(data.role)) {
    throw new HttpError('Apenas a equipa da clinica pode iniciar acompanhamento.', 403);
  }
  return data;
}

async function findPatientByEmail(serviceClient: any, clinicId: string, email: string) {
  const { data, error } = await serviceClient
    .schema('dozeclin')
    .from('patients')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (error) throw error;
  return data;
}

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

function buildPortalUrl(req: Request) {
  const origin = req.headers.get('Origin') || new URL(req.url).origin;
  return `${origin.replace(/\/$/, '')}/app/portal-paciente.html`;
}

function buildWhatsAppUrl(phone: string, message: string) {
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}

function buildReadyMessage(data: { portalUrl: string; email: string; temporaryPassword: string }) {
  return [
    'Ola.',
    '',
    'Foi um prazer falar com voce.',
    '',
    'Conforme combinamos,',
    '',
    'o seu Portal do Paciente ja esta disponivel.',
    '',
    'Antes da nossa primeira sessao,',
    '',
    'peco apenas que conclua tres pequenas etapas.',
    '',
    '- alterar sua senha',
    '- completar seu cadastro',
    '- preencher sua anamnese inicial',
    '',
    'Portal',
    data.portalUrl,
    '',
    'Email',
    data.email,
    '',
    'Senha temporaria',
    data.temporaryPassword,
    '',
    'Ate breve.'
  ].join('\n');
}
