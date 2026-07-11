# Politicas RLS DOZECLIN

As politicas da Sprint 1 estao versionadas na migration:

- `supabase/migrations/20260711160000_dozeclin_sprint1_foundation.sql`

Nenhuma politica deve depender apenas da interface. Toda tabela operacional usa `clinic_id` e RLS.

As politicas sao aplicadas no schema `dozeclin`, nao no schema `public`.

## Policies da Sprint 1

- `clinics_select_own`: permite ver a propria clinica; `super_admin` pode listar clinicas para administracao do produto.
- `clinics_update_admin`: permite que `clinic_admin` atualize somente a propria clinica.
- `clinic_settings_manage_own`: permite que `clinic_admin` gerencie configuracoes da propria clinica.
- `profiles_select_own_clinic`: permite ver o proprio perfil e perfis da propria clinica.
- `profiles_update_self_or_admin`: permite atualizar perfil proprio ou da propria clinica sem trocar `clinic_id`.
- `patients_select_staff`: permite leitura de pacientes somente por equipe ativa da propria clinica.
- `patients_insert_staff`: permite criacao de pacientes por `clinic_admin`, `reception` e `professional`.
- `patients_update_staff`: permite edicao de pacientes por `clinic_admin`, `reception` e `professional`.
- `appointments_staff_manage`: permite gestao de agenda pela equipe ativa da propria clinica.
- `medical_records_clinical_only`: restringe prontuarios a `clinic_admin`, `professional` e `supervisor`.
- `anamnesis_clinical_only`: restringe anamnese a perfis clinicos autorizados.
- `patient_tasks_staff_manage`: permite gestao de tarefas pela equipe ativa da propria clinica.
- `financial_entries_finance_only`: restringe financeiro a `clinic_admin` e `finance`.
- `audit_logs_insert_own_clinic`: permite registrar auditoria apenas na propria clinica.
- `audit_logs_select_admin`: permite leitura de auditoria por `clinic_admin` e `supervisor`.
