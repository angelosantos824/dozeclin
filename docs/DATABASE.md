# Banco de Dados

## Migration principal

`supabase/migrations/20260711160000_dozeclin_sprint1_foundation.sql`

Ela cria:

- `dozeclin.clinics`
- `dozeclin.clinic_settings`
- `dozeclin.profiles`
- `dozeclin.patients`
- `dozeclin.appointments`
- `dozeclin.medical_records`
- `dozeclin.anamnesis_forms`
- `dozeclin.patient_tasks`
- `dozeclin.financial_entries`
- `dozeclin.audit_logs`

Tambem cria tipos isolados em `dozeclin`, como `dozeclin.user_role`, `dozeclin.clinic_status` e `dozeclin.patient_status`.

## Relacionamentos principais

- `dozeclin.profiles.id` referencia `auth.users.id`.
- `dozeclin.profiles.clinic_id` referencia `dozeclin.clinics.id`.
- Registros operacionais usam `clinic_id`.
- `dozeclin.patients.clinic_id` isola pacientes por clinica.
- `dozeclin.appointments`, `dozeclin.medical_records`, `dozeclin.anamnesis_forms`, `dozeclin.patient_tasks` e `dozeclin.financial_entries` vinculam paciente e clinica.

## Schema e Data API

O schema `dozeclin` precisa ser adicionado manualmente em:

```text
Supabase Dashboard
Project Settings
Data API
Exposed schemas
Adicionar dozeclin
```

Grants da migration:

- `grant usage on schema dozeclin to anon, authenticated, service_role`
- privilegios minimos de tabela para `authenticated`, sempre controlados por RLS
- privilegios completos para `service_role`, apenas para uso administrativo fora do frontend

## Estados

Clinicas:

- `trial`
- `active`
- `suspended`
- `cancelled`

Pacientes:

- `active`
- `inactive`
- `discharged`
- `archived`

Consultas:

- `scheduled`
- `confirmed`
- `in_progress`
- `completed`
- `cancelled`
- `no_show`

Tarefas:

- `pending`
- `in_progress`
- `completed`
- `cancelled`

## Observacoes

- A Sprint 1 nao migra dados reais.
- `dozeclin.patients.access_code` existe para compatibilidade operacional, mas nao deve ser autenticacao definitiva.
- Exclusao definitiva de pacientes nao foi exposta na nova interface.
- Nenhuma tabela DOZECLIN deve ser criada em `public`.
- Tabelas do DOZEDEV Control Center em `public` nao devem ser alteradas.
