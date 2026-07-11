# DOZECLIN

DOZECLIN e a nova aplicacao comercial de gestao para clinicas e profissionais de saude.

Esta pasta e uma copia independente do projeto anterior da Michelly. Os arquivos legados permanecem intactos na raiz para comparacao, e a nova fundacao tecnica fica em:

- `app/`
- `assets/`
- `supabase/`
- `docs/`

## Execucao local

Por usar ES Modules no navegador, abra a aplicacao por um servidor local:

```bash
node tools/static-server.js
```

Depois acesse:

```text
http://localhost:8000/app/login.html
```

## Configurar Supabase

O ambiente de desenvolvimento utiliza o projeto Supabase compartilhado do DOZEDEV, com isolamento no schema `dozeclin`.

1. Use a URL e a anon key do projeto Supabase compartilhado do DOZEDEV.
2. Atualize `assets/js/config/constants.js`.
3. Execute manualmente a migration em `supabase/migrations/20260711160000_dozeclin_sprint1_foundation.sql`.
4. No Supabase Dashboard, exponha o schema `dozeclin` na Data API.
5. Nunca use `service_role` no frontend.

Para expor o schema:

```text
Supabase Dashboard
Project Settings
Data API
Exposed schemas
Adicionar dozeclin
```

A migration concede `usage` no schema para `anon`, `authenticated` e `service_role`, mas as tabelas operacionais ficam controladas por RLS. O frontend usa apenas a anon key.

Ambientes de producao podem futuramente usar Supabase exclusivo, PostgreSQL proprio, Supabase self-hosted ou backend Node com outro banco.

## Primeira clinica e primeiro administrador

1. Crie o utilizador em Supabase Auth.
2. Insira um registro em `dozeclin.clinics`.
3. Insira um registro em `dozeclin.profiles` com o `id` do utilizador Auth, o `clinic_id` criado e `role = 'clinic_admin'`.
4. Entre em `app/login.html`.

## Sprint 1

Implementado nesta etapa:

- Cliente Supabase modular.
- Login, logout e recuperacao de senha via Supabase Auth.
- Protecao de paginas internas.
- Layout administrativo DOZECLIN.
- Dashboard inicial.
- Modulo inicial de pacientes.
- Configuracoes basicas da clinica.
- Migration com tabelas-base e RLS inicial.
- Documentacao tecnica.

Nao implementado nesta Sprint:

- Prontuario completo.
- Anamnese migrada.
- Tarefas do paciente.
- Financeiro migrado.
- Area do paciente.
- Dados reais da Michelly.
- Deploy.

## Testes

Consulte `docs/SPRINTS.md` para o checklist. Nao ha testes automatizados nesta base ainda.
