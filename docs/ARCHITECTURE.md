# Arquitetura

## Objetivo

Transformar a copia independente do sistema anterior em uma fundacao SaaS multi-tenant chamada DOZECLIN.

O desenvolvimento usa o projeto Supabase compartilhado do DOZEDEV, com isolamento por schema PostgreSQL. Nenhuma tabela exclusiva do DOZECLIN deve ser criada no schema `public`.

## Estrutura atual

Arquivos legados preservados na raiz:

- `adm.html`
- `adm-script.js`
- `detalhes-cliente.html`
- `anamnese.html`
- `area-cliente.html`
- `tarefa-7-dias.html`
- `config.js`
- `script.js`
- `style.css`
- paginas publicas antigas

Nova fundacao:

- `app/`: paginas internas DOZECLIN.
- `assets/css/`: estilos da aplicacao.
- `assets/js/config/`: cliente Supabase e constantes.
- `assets/js/auth/`: autenticacao, guards e permissoes.
- `assets/js/services/`: acesso a dados.
- `assets/js/pages/`: controladores de pagina.
- `assets/js/ui/`: componentes utilitarios de interface.
- `supabase/migrations/`: SQL versionado.
- `docs/`: documentacao tecnica.

## Padroes

- Paginas novas usam `script type="module"`.
- O cliente Supabase e criado apenas em `assets/js/config/supabase.js`.
- O cliente usa `db.schema = "dozeclin"`.
- As paginas chamam services, nao fazem consultas diretas quando houver service.
- Dados de banco sao renderizados com `createElement` e `textContent`.
- A autorizacao real deve ficar no banco por RLS.

## Supabase compartilhado

- Auth e compartilhado com o DOZEDEV Control Center.
- Acesso ao DOZECLIN exige registro ativo em `dozeclin.profiles`.
- Um utilizador autenticado sem perfil DOZECLIN nao deve acessar dados DOZECLIN.
- O DOZECLIN nao altera tabelas do Control Center em `public`.

Producao pode evoluir para Supabase exclusivo, PostgreSQL proprio, Supabase self-hosted ou backend Node com outro banco.

## Storage futuro

Buckets previstos:

- `dozeclin-public`
- `dozeclin-private`

Documentos clinicos devem ficar separados de arquivos publicos do DOZEDEV.

## Modulos da Sprint 1

- Autenticacao.
- Dashboard.
- Pacientes.
- Configuracoes da clinica.

## Modulos preservados para Sprints posteriores

- Prontuario.
- Anamnese.
- Tarefas.
- Financeiro.
- Painel do paciente.
