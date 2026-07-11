# DOZECLIN - Onboarding de Clinicas

## Objetivo

A Sprint 2.5 adiciona a gestao SaaS de clinicas cliente pelo painel Super Admin do DOZEDEV, sem expor chaves `service_role` no frontend e sem dar acesso clinico global ao `super_admin`.

## Fluxo atual

1. Um utilizador com perfil `super_admin` ativo acede a `app/clinicas.html`.
2. O Super Admin cria a clinica e informa os dados do administrador inicial.
3. A funcao `dozeclin.create_clinic_with_admin` cria a clinica, o perfil `clinic_admin` com `status = 'pending_invite'`, define `owner_profile_id` e cria `clinic_settings`.
4. Um operador autorizado cria manualmente o utilizador no Supabase Auth.
5. O operador associa o `auth.users.id` ao perfil pendente em `dozeclin.profiles.auth_user_id`.
6. O administrador da clinica passa a entrar pelo login normal.

## Associacao manual do Auth

Depois de criar o utilizador no Supabase Auth, execute uma atualizacao controlada no schema `dozeclin`:

```sql
update dozeclin.profiles
set auth_user_id = '<auth-user-id>',
    status = 'active',
    updated_at = now()
where email = '<email-do-admin>'
  and role = 'clinic_admin'
  and status = 'pending_invite';
```

## Regras de seguranca

- O frontend usa apenas a chave anon/publishable.
- O `super_admin` pode listar e administrar clinicas, mas as policies clinicas continuam presas a `current_clinic_id()`.
- Suspensao e cancelamento exigem motivo e bloqueiam usuarios operacionais da clinica no guard.
- Campos SaaS (`status`, `plan_code`, `owner_profile_id`, datas e motivo de suspensao) sao protegidos por trigger para usuarios que nao sejam `super_admin`.
- A criacao de usuarios Auth deve migrar para Edge Function ou backend seguro quando essa camada existir.

## Suspender, reativar e cancelar

- Suspender: use a acao `Suspender` em `app/clinicas.html` e informe o motivo.
- Reativar: use a acao `Reativar` em uma clinica suspensa. O status volta para `active`.
- Cancelar: use a acao `Cancelar` e informe o motivo. Os dados permanecem preservados.

Nenhum destes fluxos apaga pacientes, profissionais, consultas ou prontuarios.

## Teste de isolamento

1. Crie duas clinicas pelo painel Super Admin.
2. Crie os dois utilizadores no Supabase Auth.
3. Associe cada `auth_user_id` ao respetivo perfil `clinic_admin`.
4. Entre com o administrador da primeira clinica e crie dados operacionais de teste.
5. Entre com o administrador da segunda clinica e confirme que os dados da primeira nao aparecem.
6. Suspenda a primeira clinica no painel Super Admin.
7. Confirme que o administrador da primeira clinica e bloqueado na tela `acesso-indisponivel.html`.
8. Confirme que o Super Admin continua acessando `app/clinicas.html`.

## Exemplo para clinica psicanalista

1. Abra `app/clinicas.html` com um perfil `super_admin`.
2. Clique em `Nova clinica`.
3. Informe nome, email, cidade e documento quando existir.
4. Escolha `Psicanalise` em especialidade.
5. Escolha o plano inicial.
6. Informe nome e email do administrador.
7. Guarde a clinica.
8. Crie o utilizador no Supabase Auth e associe o `auth_user_id` ao perfil pendente.

## Limitacoes atuais

- Convite automatico por email ainda nao existe.
- A associacao do `auth_user_id` ainda e manual.
- Contagens exibidas no painel usam dados administrativos de perfis; conteudo clinico nao e listado pelo Super Admin.
- Planos sao apenas codigos internos nesta Sprint, sem cobranca automatica.

## Arquivos principais

- `supabase/migrations/20260711220000_dozeclin_sprint2_5_clinic_onboarding.sql`
- `app/clinicas.html`
- `assets/js/pages/clinicas.js`
- `assets/js/services/clinics.service.js`
- `assets/js/auth/guards.js`
