# DOZECLIN

DOZECLIN e um SaaS de gestao para clinicas e profissionais de saude, integrado ao ecossistema DOZEDEV. A aplicacao usa autenticacao Supabase, isolamento multiempresa, Super Admin global, onboarding de clinicas, primeiro acesso com senha temporaria e modulos operacionais para pacientes, agenda, profissionais, prontuario clinico e configuracoes.

## Arquitetura

- `app/`: paginas HTML da aplicacao.
- `assets/css/`: estilos compartilhados e por modulo.
- `assets/js/auth/`: autenticacao, guards e permissoes.
- `assets/js/config/`: constantes e cliente Supabase.
- `assets/js/pages/`: controladores das paginas.
- `assets/js/services/`: camada de acesso a dados.
- `assets/js/ui/`: componentes e utilitarios de interface.
- `docs/`: documentacao tecnica.
- `supabase/functions/`: Edge Functions.
- `supabase/migrations/`: SQL versionado.
- `supabase/policies/`: notas de policies.
- `tools/`: ferramentas locais.

## Desenvolvimento local

Instale as dependencias:

```bash
npm install
```

Inicie o servidor estatico local:

```bash
node tools/static-server.js
```

Acesse:

```text
http://127.0.0.1:8000/app/login.html
```

## Supabase

O frontend usa apenas a anon key configurada em `assets/js/config/constants.js`. Nunca versione `.env`, `service_role`, JWTs, tokens ou segredos operacionais.

Migrations ficam em `supabase/migrations/` e devem ser revisadas antes de qualquer aplicacao. Para usar a CLI:

```bash
npx supabase migration list
npx supabase db push
```

Edge Functions ficam em `supabase/functions/`. O deploy deve ser feito somente em fluxo controlado:

```bash
npx supabase functions deploy create-clinic-admin-access
npx supabase functions deploy complete-first-access-password
npx supabase functions deploy reset-clinic-admin-temporary-password
```

## Fluxos principais

- Super Admin global acessa a DOZEDEV Platform e administra clinicas.
- Clinicas possuem dados isolados por `clinic_id` e RLS.
- Administrador da clinica recebe acesso inicial com senha temporaria.
- Primeiro acesso exige troca obrigatoria de senha.
- Usuarios operacionais acessam os modulos permitidos da propria clinica.
- Financeiro clinico documentado em `docs/FINANCIAL.md`.
- Assinaturas, validacao publica e rastreabilidade documental em `docs/DOCUMENT-SIGNATURES-VALIDATION.md`.

## Fluxo basico de desenvolvimento

1. Atualize codigo em `app/`, `assets/`, `docs/`, `supabase/` ou `tools/`.
2. Rode o servidor local com `node tools/static-server.js`.
3. Valide login e navegacao pelos modulos afetados.
4. Use `node --check` nos JavaScripts alterados.
5. Revise `git status` e `git diff` antes de abrir revisao.

Consulte `docs/SPRINTS.md` para checklists por Sprint.
