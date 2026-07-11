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

## Ajustes Sprint 2

- `profiles_insert_admin`: permite que `clinic_admin` crie profissionais ou supervisores da propria clinica com convite pendente.
- `profiles_update_self_or_admin`: permite que `clinic_admin` atualize profissionais da propria clinica sem trocar `clinic_id`.
- `appointments_staff_manage`: restringe profissional as proprias consultas e mantem `clinic_admin`, `reception` e `supervisor` na propria clinica.
- `dozeclin.validate_appointment()`: bloqueia paciente/profissional de outra clinica, horarios invalidos, conflitos e conclusao por perfil sem permissao.

## Ajustes Sprint 3.1

- `medical_records_select_clinic`: leitura de prontuarios apenas por perfis clinicos da propria clinica.
- `medical_records_insert_authorized`: criacao apenas por perfil clinico autorizado da propria clinica.
- `medical_records_update_authorized_drafts`: atualizacao comum apenas de rascunhos por perfil clinico autorizado.
- `medical_records_sign_authorized`: transicao controlada de rascunho para assinado.
- `medical_records_cancel_authorized`: cancelamento controlado de rascunhos ou assinados.
- `dozeclin.validate_medical_record()`: valida clinica, paciente, profissional, conteudo obrigatorio, autoria pela sessao, datas de auditoria e imutabilidade de registros assinados/cancelados.
