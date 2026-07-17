# DOZECLIN - Preparacao para subdominio

Data: 2026-07-17

Objetivo: preparar o DOZECLIN para operar em `https://dozeclin.dozedev.pt`, mantendo suporte local em `http://127.0.0.1:8000`, sem deploy, DNS, migrations, SQL, policies, RPCs ou secrets.

## Arquitetura encontrada

- Frontend estatico em `app/*.html`, com JavaScript modular em `assets/js`.
- Configuracao de Supabase existente em `assets/js/config/supabase.js` e constantes em `assets/js/config/constants.js`.
- Edge Functions em `supabase/functions/*`, compartilhando helpers em `supabase/functions/_shared/first-access.ts`.
- Servidor local estatico em `tools/static-server.js`, escutando `127.0.0.1:8000`.
- Assets das paginas em `app/` usam `../assets/...`, caminho adequado para `/app/*.html` em local e producao.

## URLs fixas encontradas

| Ficheiro | Linha | URL/referencia | Finalidade | Alterada? |
| --- | ---: | --- | --- | --- |
| `tools/static-server.js` | 20, 55, 56 | `http://127.0.0.1:${port}` | Servidor local | Nao, correto para dev |
| `README.md` | 37 | `http://127.0.0.1:8000/app/login.html` | Instrucao local | Nao |
| `assets/js/config/supabase.js` | 2 | CDN Supabase | Import do SDK | Nao |
| `assets/js/config/constants.js` | 40 | `https://dozedev.pt` | Website institucional | Nao |
| `assets/js/config/constants.js` | 47 | URL Supabase | Projeto Supabase | Nao, fora do escopo |
| `assets/js/pages/clinicas.js` | 285 | `window.location.origin...login.html` | Texto informativo de acesso | Nao, informativo e local ao contexto |
| `assets/js/services/patient-requests.service.js` | 118 | `https://wa.me/...` | Link WhatsApp | Nao |
| `app/agenda.html` | 162, 235 | `https://meet.google.com/...` | Placeholder de formulario | Nao |
| `docs/DOCUMENT-SIGNATURES-VALIDATION.md` | 95 | `https://app.dozedev.pt/v/TOKEN_OPACO` | Documentacao historica | Nao, risco documentado |
| `docs/DOCUMENT-SIGNATURES-VALIDATION.md` | 99 | `127.0.0.1:8000/app/verificar-documento.html` | Exemplo local | Nao |
| `supabase/migrations/*document_validation*.sql` | varias | `/app/verificar-documento.html?token=` | Retorno relativo de RPC historica | Nao, migrations/RPC fora do escopo |
| `supabase/functions/generate-document-qrcode/index.ts` | 98 | `/app/verificar-documento.html?token=` | URL publica de QR Code | Sim |
| `supabase/functions/generate-document-share-link/index.ts` | 55 | `APP_PUBLIC_URL` | Origem de link publico | Sim |
| `supabase/functions/start-patient-journey/index.ts` | 157 | `/app/portal-paciente.html` | Link do Portal do Paciente | Sim |
| `supabase/functions/_shared/first-access.ts` | 4 | `Access-Control-Allow-Origin: *` | CORS compartilhado | Nao, ponto de revisao |

## Ficheiros alterados

- `index.html`
- `assets/js/config/app-config.js`
- `assets/js/auth/auth.js`
- `assets/js/auth/guards.js`
- `assets/js/pages/login.js`
- `assets/js/pages/portal-paciente.js`
- `assets/js/pages/alterar-senha-inicial.js`
- `assets/js/ui/layout.js`
- `supabase/functions/generate-document-qrcode/index.ts`
- `supabase/functions/generate-document-share-link/index.ts`
- `supabase/functions/start-patient-journey/index.ts`

## Configuracao central criada

Criado `assets/js/config/app-config.js` com:

- `APP_ORIGIN`: usa protocolo, hostname e porta atuais em `localhost`/`127.0.0.1`; usa `https://dozeclin.dozedev.pt` fora de local.
- `APP_BASE_PATH`: `/app`.
- `APP_URLS`: login, dashboard, Portal do Paciente, validacao publica, plataforma, senha inicial e acesso indisponivel.
- `buildAppUrl(page, params)`: construtor central para URLs internas com query string.

A configuracao do Supabase nao foi alterada.

## Redirecionamentos ajustados

- Login pos-autenticacao: plataforma, senha inicial, Portal do Paciente e dashboard.
- Logout no layout principal, Portal do Paciente e senha inicial.
- Guardas de paginas protegidas e permissoes.
- Recuperacao de senha: redirect para `APP_URLS.login`.
- Entrada raiz `/`: `index.html` redireciona para `APP_URLS.login`.

## Edge Functions auditadas

| Edge Function | Variavel necessaria | Valor local | Valor producao | Secret no Supabase? |
| --- | --- | --- | --- | --- |
| `generate-document-qrcode` | `APP_PUBLIC_URL` | `http://127.0.0.1:8000` | `https://dozeclin.dozedev.pt` | Sim, como env/secret da Function |
| `generate-document-share-link` | `APP_PUBLIC_URL` | `http://127.0.0.1:8000` | `https://dozeclin.dozedev.pt` | Sim, como env/secret da Function |
| `start-patient-journey` | `APP_PUBLIC_URL` | `http://127.0.0.1:8000` | `https://dozeclin.dozedev.pt` | Sim, como env/secret da Function |

As tres funcoes agora aceitam `APP_PUBLIC_URL` ou origem local/producao permitida (`127.0.0.1:8000`, `localhost:8000`, `https://dozeclin.dozedev.pt`). Desde a Sprint 1.1, quando nao houver origem confiavel nem `APP_PUBLIC_URL`, a Function lanca erro claro em vez de cair silenciosamente para producao.

## QR Code e validacao publica

- `generate-document-qrcode` deixou de gerar `/v/{token}` quando `APP_PUBLIC_URL` existe.
- A URL gerada agora segue sempre `/app/verificar-documento.html?token=<TOKEN>`.
- Token, hash, RPC, Storage e validacao publica nao foram alterados.

## Supabase Auth - URLs para cadastrar depois

Site URL:

- `https://dozeclin.dozedev.pt`

Redirect URLs de producao:

- `https://dozeclin.dozedev.pt`
- `https://dozeclin.dozedev.pt/**`
- `https://dozeclin.dozedev.pt/app/login.html`
- `https://dozeclin.dozedev.pt/app/dashboard.html`
- `https://dozeclin.dozedev.pt/app/portal-paciente.html`

URLs locais:

- `http://127.0.0.1:8000/**`
- `http://localhost:8000/**`

Nenhuma alteracao foi aplicada no dashboard do Supabase.

## Caminhos de assets revisados

- HTML em `app/` usa `../assets/...` para CSS/JS.
- Links internos entre paginas em `app/` usam caminhos relativos como `agenda.html`, `financeiro.html`, etc.
- Esse padrao funciona em `http://127.0.0.1:8000/app/...` e em `https://dozeclin.dozedev.pt/app/...`.
- Nao houve conversao ampla para caminhos absolutos.

## CORS e origem

Pontos encontrados:

- `supabase/functions/_shared/first-access.ts`: `Access-Control-Allow-Origin: *`.
- `generate-document-qrcode`, `generate-document-share-link` e `start-patient-journey`: leitura de `Origin` para montar URLs.

Nesta sprint, CORS compartilhado nao foi alterado porque o pedido exigia apresentar os locais encontrados antes de mudar essa politica. Recomenda-se substituir o `*` por allowlist quando o comportamento de todas as Functions que usam `_shared/first-access.ts` for revisado em conjunto.

## Testes executados

- `node --check assets/js/config/app-config.js`
- `node --check assets/js/auth/auth.js`
- `node --check assets/js/auth/guards.js`
- `node --check assets/js/pages/login.js`
- `node --check assets/js/pages/portal-paciente.js`
- `node --check assets/js/pages/alterar-senha-inicial.js`
- `node --check assets/js/ui/layout.js`
- Servidor local com `node tools/static-server.js` e verificacao HTTP:
  - `200 http://127.0.0.1:8000/app/login.html`
  - `200 http://127.0.0.1:8000/app/dashboard.html`
  - `200 http://127.0.0.1:8000/app/portal-paciente.html`
  - `200 http://127.0.0.1:8000/app/verificar-documento.html`

Nao foi possivel executar validacao com Deno: `deno` nao esta disponivel no PATH.

## Riscos restantes

- CORS compartilhado com `*` ainda precisa de decisao para producao.
- `docs/DOCUMENT-SIGNATURES-VALIDATION.md` ainda contem exemplo antigo `/v/TOKEN_OPACO`.
- Migrations historicas retornam URL relativa de validacao; nao foram alteradas por regra de escopo.
- Testes locais foram HTTP estatico/sintaxe; fluxos reais de login, logout, QR Code, PDF e Supabase dependem de credenciais/sessao/dados e nao foram executados ponta a ponta.

## Plano para publicacao

1. Revisar e aprovar este diff.
2. Definir `APP_PUBLIC_URL=https://dozeclin.dozedev.pt` nas Edge Functions aplicaveis.
3. Cadastrar URLs de Auth no Supabase.
4. Revisar CORS compartilhado com allowlist local/producao.
5. Publicar frontend no subdominio.
6. Validar login, logout, pagina protegida, Portal do Paciente, validacao publica, PDFs e QR Code em producao.
7. So depois ajustar DNS conforme planejamento de infraestrutura.

## Confirmacoes de escopo

- Nenhuma migration aplicada.
- Nenhum SQL aplicado.
- Nenhuma policy alterada.
- Nenhuma RPC alterada.
- Nenhum secret criado.
- Nenhum deploy feito.
- Nenhum DNS alterado.
- Nenhum commit feito.
- Nenhum push feito.

## Sprint 1.1 - Padronizacao de origem publica

Resumo: a revisao consolidou a configuracao de URLs do frontend, removeu duplicacao nas Edge Functions e eliminou fallback silencioso para o dominio de producao dentro das Functions. O dominio `https://dozeclin.dozedev.pt` permanece apenas na configuracao central do frontend, no helper compartilhado de origens permitidas e na documentacao.

### Ficheiros criados

- `supabase/functions/_shared/app-origin.ts`
- `assets/js/config/app-config.js`
- `index.html`
- `docs/SUBDOMAIN-PREP-AUDIT.md`

### Ficheiros alterados

- `assets/js/auth/auth.js`
- `assets/js/auth/guards.js`
- `assets/js/pages/alterar-senha-inicial.js`
- `assets/js/pages/login.js`
- `assets/js/pages/portal-paciente.js`
- `assets/js/ui/layout.js`
- `supabase/functions/generate-document-qrcode/index.ts`
- `supabase/functions/generate-document-share-link/index.ts`
- `supabase/functions/start-patient-journey/index.ts`

### Configuracao final de `app-config.js`

- Exporta `APP_ORIGIN`, `APP_BASE_PATH`, `APP_ENV`, `APP_IS_LOCAL`, `APP_IS_PRODUCTION`, `APP_URLS` e `buildAppUrl()`.
- `APP_IS_LOCAL`: `localhost` ou `127.0.0.1`.
- `APP_IS_PRODUCTION`: `dozeclin.dozedev.pt`.
- `APP_ENV`: `development`, `production` ou `unknown`.
- `APP_ORIGIN`: preserva protocolo e porta em ambiente local; usa `https://dozeclin.dozedev.pt` fora de local.
- `APP_BASE_PATH`: `/app`.
- `buildAppUrl()` remove barras iniciais, remove prefixo `app/` quando recebido, evita `/app/app`, nao aceita URL externa como origem e codifica parametros com `URLSearchParams`.
- Parametros vazios, `null` ou `undefined` nao sao adicionados.

Validacao especifica executada:

- `buildAppUrl('/app/dashboard.html', { erro: 'x y', empty: '' })` gerou `http://127.0.0.1:8000/app/dashboard.html?erro=x+y`.
- `APP_URLS.login` gerou `http://127.0.0.1:8000/app/login.html` em ambiente local simulado.

### Helper compartilhado de Edge Functions

Criado `supabase/functions/_shared/app-origin.ts` com:

- `normalizeOrigin(value)`
- `isAllowedAppOrigin(origin)`
- `resolveAppOrigin(req)`
- `buildPublicAppUrl(req, path, params)`

Origens permitidas:

- `http://127.0.0.1:8000`
- `http://localhost:8000`
- `https://dozeclin.dozedev.pt`

Comportamento de `APP_PUBLIC_URL`:

- Se existir, e usado como fonte principal apos normalizacao.
- Se nao existir, apenas o header `Origin` da allowlist e aceito.
- Se nao existir `APP_PUBLIC_URL` e a origem nao for permitida, a Function lanca erro claro.
- Nao ha fallback silencioso para producao.
- Nao usa `new URL(req.url).origin` como origem da aplicacao.

Para deploy das Edge Functions, configurar:

- `APP_PUBLIC_URL=https://dozeclin.dozedev.pt`

Nenhuma chave, token ou segredo real foi incluido.

### Edge Functions atualizadas

- `generate-document-qrcode`: usa `buildPublicAppUrl(req, '/app/verificar-documento.html', { token })`.
- `generate-document-share-link`: usa `buildPublicAppUrl(req, data.url)` preservando o caminho retornado pelo fluxo atual.
- `start-patient-journey`: usa `buildPublicAppUrl(req, '/app/portal-paciente.html')`.

URLs publicas esperadas:

- Producao QR Code: `https://dozeclin.dozedev.pt/app/verificar-documento.html?token=<TOKEN>`
- Local QR Code: `http://127.0.0.1:8000/app/verificar-documento.html?token=<TOKEN>` ou `http://localhost:8000/app/verificar-documento.html?token=<TOKEN>`
- Portal do Paciente: `<APP_PUBLIC_URL>/app/portal-paciente.html`

Nao foram alterados token, hash, QR Code, Storage, PDFs, permissao, autenticacao, payload ou banco.

### `index.html`

- A raiz `/` usa `<meta http-equiv="refresh" content="0; url=/app/login.html">`.
- Mantem fallback acessivel com link para `/app/login.html`.
- Nao depende de localhost, porta ou JavaScript.

### Auditoria final de URLs fixas

| Ocorrencia | Motivo | Valida? | Local/producao | Sprint futura? |
| --- | --- | --- | --- | --- |
| `assets/js/config/app-config.js` com `https://dozeclin.dozedev.pt` | Origem central do frontend | Sim | Producao | Nao |
| `supabase/functions/_shared/app-origin.ts` com allowlist local/producao | Controle de origem das Edge Functions | Sim | Ambos | Nao |
| `tools/static-server.js` com `127.0.0.1` | Servidor local | Sim | Local | Nao |
| `README.md` com `127.0.0.1:8000/app/login.html` | Instrucao de desenvolvimento | Sim | Local | Nao |
| `docs/SUBDOMAIN-PREP-AUDIT.md` com URLs locais/producao | Auditoria e plano | Sim | Ambos | Nao |
| `docs/DOCUMENT-SIGNATURES-VALIDATION.md` com `/v/TOKEN_OPACO` | Documentacao historica antiga | Nao para fluxo atual | Producao antiga | Sim, atualizar doc em sprint documental |
| `supabase/migrations/*document_validation*.sql` com `/app/verificar-documento.html?token=` | Historico de RPC/migration | Sim como historico; nao editado | Relativo | Nao nesta sprint |
| `window.location.replace(...)` em auth/pages/layout | Redirecionamentos internos via `APP_URLS`/`buildAppUrl()` | Sim | Ambos | Nao |
| `new URL(...)` em `app-config.js` e `app-origin.ts` | Construir URLs com parser nativo | Sim | Ambos | Nao |
| `new URL(...)` em paginas como `verificar-documento.js` | Ler query string atual | Sim | Ambos | Nao |
| `Access-Control-Allow-Origin: *` em `_shared/first-access.ts` | CORS compartilhado existente | Pendente de decisao | Ambos | Sim, sprint especifica de CORS |

Nao restam ocorrencias de `http://localhost:3000` no codigo auditado.

### Testes realizados na Sprint 1.1

Sintaxe JavaScript:

- `node --check assets/js/config/app-config.js`
- `node --check assets/js/auth/auth.js`
- `node --check assets/js/auth/guards.js`
- `node --check assets/js/pages/alterar-senha-inicial.js`
- `node --check assets/js/pages/login.js`
- `node --check assets/js/pages/portal-paciente.js`
- `node --check assets/js/ui/layout.js`

Servidor local e assets:

- `200 http://127.0.0.1:8000/`
- `200 http://127.0.0.1:8000/app/login.html`
- `200 http://127.0.0.1:8000/app/dashboard.html`
- `200 http://127.0.0.1:8000/app/portal-paciente.html`
- `200 http://127.0.0.1:8000/app/verificar-documento.html`
- CSS/JS referenciados nessas paginas responderam `200`.
- A raiz contem refresh para `/app/login.html`.

Limitacoes:

- `deno` nao esta disponivel no PATH; nao foi possivel executar `deno check`.
- A ferramenta de navegador integrada nao expos o executor `node_repl` nesta sessao; a verificacao de console foi substituida por validacao HTTP de paginas/assets e revisao estatica de imports.
- Fluxos reais com sessao Supabase, login/logout autenticado, protecao de paginas e QR Code ponta a ponta dependem de credenciais/dados e nao foram executados.

Revisao estatica manual das Edge Functions:

- Imports para `../_shared/app-origin.ts` conferidos nas tres Functions.
- Export usado: `buildPublicAppUrl`.
- Funcoes duplicadas locais `resolveAppOrigin()` e `isAllowedAppOrigin()` removidas das tres Functions.
- Nao ha imports nao utilizados introduzidos.

### Verificacao do diff

- `git status --short`: mostra alteracoes pendentes e ficheiros novos; nenhum commit feito.
- `git diff --stat`: executado; mostrou alteracoes nos ficheiros rastreados ja existentes.
- `git diff --check`: sem erros de whitespace, conflitos ou marcadores de merge. Apenas avisos LF -> CRLF esperados no Windows.

### Riscos restantes

- CORS compartilhado ainda usa `Access-Control-Allow-Origin: *` e deve ser revisto numa sprint especifica.
- `docs/DOCUMENT-SIGNATURES-VALIDATION.md` contem exemplo antigo `/v/TOKEN_OPACO`.
- Deno nao disponivel impede validacao TypeScript local completa das Edge Functions.
- Deploy das Functions exigira configurar `APP_PUBLIC_URL=https://dozeclin.dozedev.pt`.

### Proximos passos para deploy

1. Revisar este diff.
2. Configurar `APP_PUBLIC_URL=https://dozeclin.dozedev.pt` nas Edge Functions antes do deploy.
3. Cadastrar URLs de Auth no Supabase conforme a secao anterior.
4. Planejar sprint separada para CORS com allowlist.
5. Fazer deploy controlado do frontend e das Edge Functions.
6. Validar login, logout, paginas protegidas, Portal do Paciente, validacao publica, PDFs e QR Code em producao.
7. Ajustar DNS apenas depois da validacao tecnica.

### Confirmacoes adicionais da Sprint 1.1

- Nenhuma migration aplicada.
- Nenhum SQL aplicado.
- Nenhuma policy alterada.
- Nenhuma RPC alterada.
- Nenhum trigger alterado.
- Nenhum secret criado.
- Nenhuma configuracao do Supabase alterada.
- Nenhum deploy realizado.
- Nenhum DNS alterado.
- Nenhum commit realizado.
- Nenhum push realizado.
- Nenhuma alteracao feita no DOZEDEV Admin.
- Nenhuma alteracao feita no projeto usedoze.
