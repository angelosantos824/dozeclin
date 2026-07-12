# DOZECLIN - Primeiro Acesso com Senha Temporaria

## Objetivo

A Sprint 2.7 cria um fluxo seguro para ativar administradores de clinicas sem depender de convite por email. A senha temporaria e gerada apenas em Supabase Edge Functions e exibida uma unica vez ao Super Admin.

## Migrations

Aplicar manualmente:

```text
supabase/migrations/20260711232000_dozeclin_first_access_password.sql
```

Ela adiciona a `dozeclin.profiles`:

- `must_change_password boolean not null default false`
- `password_changed_at timestamptz`
- `activated_at timestamptz`

Tambem cria RPCs usadas apenas por Edge Functions com `service_role`.

## Edge Functions

Funcoes criadas:

- `create-clinic-admin-access`
- `reset-clinic-admin-temporary-password`
- `complete-first-access-password`

Secrets necessarios no ambiente das Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

O `SUPABASE_SERVICE_ROLE_KEY` deve existir somente nos secrets das Edge Functions.

## Deploy

```bash
supabase functions deploy create-clinic-admin-access
supabase functions deploy reset-clinic-admin-temporary-password
supabase functions deploy complete-first-access-password
```

## Fluxo

1. Super Admin cria a clinica pelo painel.
2. O perfil `clinic_admin` fica `pending_invite`, sem `auth_user_id`.
3. Super Admin clica em `Criar acesso inicial`.
4. A Edge Function valida Super Admin global e acesso ao produto `dozeclin`.
5. A funcao cria o utilizador Auth, confirma email e vincula `auth_user_id` ao perfil.
6. O perfil fica `active` e `must_change_password = true`.
7. A senha temporaria aparece uma unica vez.
8. No primeiro login, o guard redireciona para `alterar-senha-inicial.html`.
9. A troca de senha chama a Edge Function segura e limpa `must_change_password`.

## Redefinicao

Use `Gerar nova senha temporaria` no painel de clinicas. A senha anterior deixa de ser valida apos a atualizacao no Supabase Auth.

## Seguranca

- Senhas nao sao armazenadas em tabelas.
- Senhas nao sao registradas em auditoria.
- O frontend nao usa Admin API.
- O frontend nao contem `service_role`.
- Campos de primeiro acesso em `profiles` sao protegidos contra update direto por usuarios autenticados comuns.
- As Edge Functions nao devem registrar payloads contendo senha.

## Configuracoes da Clinica

O botao `Guardar configuracoes` passa a registrar o listener antes do carregamento dos dados, exibe estado de carregamento e mostra mensagem de sucesso ou erro em `aria-live`.
