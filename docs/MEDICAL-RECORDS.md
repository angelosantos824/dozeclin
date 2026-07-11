# Prontuario Clinico

## Escopo Sprint 3.1

Esta etapa implementa o prontuario clinico inicial em `dozeclin.medical_records`.

Nao inclui:

- assinatura digital;
- adendos;
- anamnese funcional;
- tarefas;
- financeiro;
- portal do paciente.

## Migration

Arquivo:

`supabase/migrations/20260711210000_dozeclin_sprint3_1_medical_records.sql`

A migration complementa a tabela existente `dozeclin.medical_records` com:

- `record_type`
- `diagnosis`
- `conduct`
- `prescription`
- `record_date`
- `status`
- `created_by`
- `cancel_reason`
- `signed_at`
- `cancelled_at`

Tambem cria os tipos:

- `dozeclin.medical_record_type`
- `dozeclin.medical_record_status`

## Tipos

- `evolution`: Evolucao
- `observation`: Observacao
- `diagnosis`: Diagnostico
- `conduct`: Conduta
- `prescription`: Prescricao
- `other`: Outro

## Estados

- `draft`: Rascunho
- `signed`: Assinado
- `cancelled`: Cancelado

## Integridade

A funcao `dozeclin.validate_medical_record()` bloqueia:

- registro sem clinica;
- registro sem paciente;
- registro sem profissional;
- conteudo clinico vazio;
- paciente de outra clinica;
- profissional de outra clinica;
- edicao comum de conteudo clinico apos assinatura;
- cancelamento sem motivo.

## RLS

Policies:

- `medical_records_select_clinic`: leitura apenas por perfis clinicos da propria clinica.
- `medical_records_insert_authorized`: criacao apenas por perfil autorizado da propria clinica.
- `medical_records_update_authorized_drafts`: atualizacao apenas por perfil autorizado da propria clinica, com bloqueio de assinados pela trigger.

## Interface

O prontuario fica em:

`app/paciente-detalhes.html?id=<patient_id>`

A pagina mostra:

- dados basicos do paciente;
- lista cronologica dos registros, mais recente primeiro;
- botao Novo registro;
- visualizacao de detalhes;
- edicao de rascunhos;
- assinatura;
- cancelamento com motivo.

## Aplicacao manual

Nao aplicar automaticamente.

Execute a migration no Supabase compartilhado do DOZEDEV depois de validar em ambiente seguro.
