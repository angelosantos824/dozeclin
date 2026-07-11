# Multi-Tenant e Seguranca

## Padrao escolhido

O padrao adotado e `clinic_id`.

Cada registro operacional deve pertencer a uma clinica. A interface nunca deve permitir troca manual de `clinic_id`.

As tabelas ficam no schema `dozeclin`, dentro do Supabase compartilhado do DOZEDEV.

## RLS

Todas as tabelas clinicas da migration ativam Row Level Security.

Funcoes auxiliares:

- `dozeclin.current_profile_role()`
- `dozeclin.current_clinic_id()`
- `dozeclin.has_role(...)`
- `dozeclin.is_clinic_staff(target_clinic_id)`
- `dozeclin.can_access_clinical_records(target_clinic_id)`

## Regras iniciais

- Utilizadores acessam dados da propria clinica.
- `clinic_admin` administra configuracoes da propria clinica.
- `reception` pode gerir dados basicos de pacientes, mas nao prontuarios.
- `finance` acessa financeiro, nao conteudo clinico confidencial.
- `professional`, `supervisor` e `clinic_admin` acessam conteudo clinico.
- `super_admin` nao recebe acesso clinico irrestrito automatico nas policies operacionais.

## Auth compartilhado

Supabase Auth e compartilhado com o DOZEDEV Control Center. A autorizacao do DOZECLIN exige:

- linha em `dozeclin.profiles`;
- `id` igual ao `auth.users.id`;
- `clinic_id` valido;
- `role` permitido;
- `status = 'active'`.

Um utilizador do Control Center sem perfil em `dozeclin.profiles` nao acessa o DOZECLIN.

## Teste de isolamento

1. Crie duas clinicas.
2. Crie um `clinic_admin` para cada uma.
3. Crie pacientes em cada clinica.
4. Entre com o admin da clinica A.
5. Confirme que apenas pacientes da clinica A aparecem.
6. Tente consultar diretamente um paciente da clinica B via Supabase client autenticado.
7. O banco deve negar ou retornar vazio.
