# DOZEDEV Platform

## Arquitetura

A Sprint 2.6 cria o schema global `dozedev` dentro do mesmo projeto Supabase usado pelo DOZECLIN. Esse schema guarda utilizadores globais, produtos, acessos por produto e auditoria administrativa da plataforma.

O schema `dozedev` nao guarda pacientes, prontuarios, anamneses, prescricoes ou conteudo clinico.

## Utilizador global

O utilizador global inicial e `admin@dozedev.pt`. A migration procura esse email em `auth.users` durante a aplicacao. Ela nao cria utilizador Auth, nao altera senha e nao armazena credenciais.

Se `admin@dozedev.pt` nao existir em `auth.users`, a migration falha com uma mensagem clara.

## Produtos

Produtos iniciais:

- DOZECLIN: `active`, schema `dozeclin`
- DOZEEAT: `development`, schema `dozeeat`
- DOZEIRON: `development`, schema `dozeiron`
- DOZEMEC: `development`, schema `dozemec`
- DOZEPLAY: `development`, schema `dozeplay`

O mesmo utilizador global recebe acesso `super_admin` ativo a todos os produtos iniciais.

## Plataforma x Utilizador Operacional

Utilizador da plataforma:

- vive em `dozedev.platform_users`;
- referencia `auth.users` por `auth_user_id`;
- nao possui `clinic_id`;
- administra produtos e clientes;
- nao recebe acesso automatico a dados clinicos.

Utilizador operacional:

- vive em `dozeclin.profiles`;
- pertence a uma clinica;
- usa `clinic_id`;
- acessa apenas dados isolados pela RLS do DOZECLIN.

## Integracao com DOZECLIN

`dozeclin.is_super_admin()` passa a delegar para `dozedev.is_platform_super_admin()`. As RPCs administrativas da Sprint 2.5 continuam usando `dozeclin.is_super_admin()`, mas agora reconhecem o Super Admin global.

As policies de pacientes, prontuarios, anamneses e outros dados clinicos nao recebem acesso global da plataforma.

## Schema exposto no Supabase

Para o frontend acessar `dozedev` via PostgREST, adicione o schema `dozedev` na configuracao de schemas expostos da API do Supabase. Essa configuracao e feita no dashboard do Supabase, nao por SQL.

Sem esse passo, a migration pode aplicar corretamente, mas as chamadas do frontend ao schema `dozedev` nao ficam disponiveis pela API.

## Adicionar Produto

A migration inclui a RPC:

```sql
dozedev.register_product(p_code, p_name, p_schema_name, p_status)
```

Apenas Super Admin global ativo pode executa-la. Ela cria ou atualiza o produto, concede acesso ao `admin@dozedev.pt` e registra auditoria.

## Conceder Acesso

A tabela `dozedev.platform_user_products` guarda os vinculos por produto. Escrita direta deve ser evitada no frontend; futuras sprints devem expor RPCs especificas para concessao e revogacao.

## Suspender Utilizador Global

Atualize `dozedev.platform_users.status` para `suspended` por fluxo administrativo seguro. Utilizadores suspensos deixam de ser reconhecidos por `current_platform_user_id()` e `is_platform_super_admin()`.

## Seguranca

- Nenhuma senha ou token e armazenado em `dozedev`.
- Funcoes globais usam `auth.uid()`.
- Nao existe comparacao `platform_users.id = auth.uid()`.
- RLS esta ativa nas tabelas globais.
- Nao ha policy `USING (true)` ou `WITH CHECK (true)`.
- Nao ha policy de DELETE fisico.
- Funcoes `SECURITY DEFINER` possuem `search_path` explicito e revokes de `public` e `anon`.

## Limitacoes

- A administracao visual de concessao/revogacao de acesso fica preparada, mas a escrita deve ser feita por RPCs seguras futuras.
- Um unico utilizador Auth global funciona automaticamente somente para produtos no mesmo projeto Supabase.
- Produtos em projetos Supabase separados exigirao autenticacao centralizada ou SSO em etapa futura.
