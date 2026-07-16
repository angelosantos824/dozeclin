# DOZECLIN Sprint 3.3 - Agenda Inteligente

## Arquitetura

O `Appointment` passa a ser o centro operacional da jornada clinica. A agenda, sessoes online ou presenciais, prontuario, dashboard e portal do paciente leem o mesmo registro em `dozeclin.appointments`.

Estruturas reaproveitadas:

- `dozeclin.appointments`
- `dozeclin.patients`
- `dozeclin.profiles`
- `dozeclin.medical_records`
- `dozeclin.clinic_settings`
- `dozeclin.patient_portals`
- `dozeclin.patient_onboarding`
- `dozeclin.audit_logs`

Expansoes adicionadas por migration incremental:

- timestamps reais `scheduled_start` e `scheduled_end`;
- timezones IANA `clinic_timezone` e `patient_timezone_snapshot`;
- campos de sessao online, modalidade, duracao, sala e notas;
- marcos de estado (`confirmed_at`, `checked_in_at`, `started_at`, `completed_at`, `cancelled_at`, `archived_at`);
- vinculo `appointments.medical_record_id`;
- constraints, indices, triggers, RPCs e policies especificas.

## Estados

Estados internos:

- `scheduled`
- `confirmed`
- `checked_in`
- `in_progress`
- `completed`
- `rescheduled`
- `cancelled_by_patient`
- `cancelled_by_clinic`
- `no_show`
- `archived`

Labels de interface ficam em `assets/js/config/constants.js`.

Fluxo principal:

`scheduled -> confirmed -> checked_in -> in_progress -> completed -> archived`

Fluxos alternativos:

- `scheduled|confirmed -> rescheduled`
- `scheduled|confirmed -> cancelled_by_patient`
- `scheduled|confirmed -> cancelled_by_clinic`
- `scheduled|confirmed -> no_show`

Estados finais nao retornam.

## Timezone

A profissional agenda no horario da clinica usando timezone IANA. A RPC recebe data, hora e `clinic_timezone`, e o banco converte para `timestamptz`.

O timezone do paciente e salvo como snapshot em `patient_timezone_snapshot`. Alterar o timezone atual do paciente muda somente a apresentacao no portal; nao altera `scheduled_start`.

Timezones comuns expostos no frontend:

- `Europe/Lisbon`
- `America/Manaus`
- `America/Sao_Paulo`
- `America/New_York`
- `America/Chicago`
- `America/Denver`
- `America/Los_Angeles`
- `America/Phoenix`
- `America/Toronto`
- `Europe/Madrid`
- `Europe/London`

## Sessoes Online

Nao ha integracao com Google Meet nesta sprint. O sistema armazena:

- `meeting_url`
- `meeting_provider`

Para modalidade `online`, o link e obrigatorio.

## RPCs

Criacao e atualizacao:

- `dozeclin.create_appointment(...)`
- `dozeclin.update_appointment_details(...)`

Transicoes:

- `dozeclin.confirm_appointment(uuid)`
- `dozeclin.check_in_appointment(uuid)`
- `dozeclin.start_appointment(uuid)`
- `dozeclin.complete_appointment(uuid)`
- `dozeclin.mark_appointment_no_show(uuid)`
- `dozeclin.cancel_appointment_by_patient(uuid)`
- `dozeclin.cancel_appointment_by_clinic(uuid)`
- `dozeclin.reschedule_appointment(uuid)`
- `dozeclin.archive_appointment(uuid)`

Portal:

- `dozeclin.update_patient_timezone(text)`
- `dozeclin.get_patient_portal_context()`, expandida com proxima sessao e historico.

## Prontuario

Ao concluir um Appointment, `dozeclin.change_appointment_status` cria automaticamente um `medical_records` em `draft`, se ainda nao existir.

Protecoes:

- `medical_records.appointment_id` passa a ser obrigatorio para novos registros;
- `appointments.medical_record_id` aponta para o rascunho criado;
- indice unico impede duplicar prontuario para o mesmo Appointment.

Conteudo clinico real continua sendo editado pelo fluxo de prontuario. A auditoria nao registra conteudo clinico.

## RLS E Seguranca

As mudancas de status ocorrem somente por RPC. O trigger `dozeclin.protect_appointment_status` bloqueia update direto de `status`.

Policies finais de `appointments`:

- leitura por staff da propria clinica ou paciente dono;
- insert/update apenas via contexto interno de RPC;
- grants diretos de `insert` e `update` em `appointments` sao revogados para `authenticated`.

Nao ha `service_role` no frontend. Nao ha `auth.admin` no frontend.

## Auditoria

A migration registra:

- `appointment.created`
- `appointment.updated`
- `appointment.confirmed`
- `appointment.checked_in`
- `appointment.started`
- `appointment.completed`
- `appointment.cancelled`
- `appointment.rescheduled`
- `appointment.no_show`
- `appointment.archived`
- `medical_record.created_from_appointment`

Os logs gravam metadados operacionais, nunca conteudo clinico.

## Interface

Arquivos alterados:

- `app/agenda.html`
- `assets/js/pages/agenda.js`
- `assets/js/services/appointments.service.js`
- `app/portal-paciente.html`
- `assets/js/pages/portal-paciente.js`
- `assets/js/services/patient-portal.service.js`
- `app/paciente-detalhes.html`
- `assets/js/pages/paciente-detalhes.js`
- `assets/js/services/records.service.js`
- `app/dashboard.html`
- `assets/js/pages/dashboard.js`
- `assets/js/config/constants.js`
- `assets/js/ui/formatters.js`
- `assets/css/agenda.css`
- `assets/css/journey.css`

## Testes Recomendados

Executar:

- `node --check assets/js/services/appointments.service.js`
- `node --check assets/js/pages/agenda.js`
- `node --check assets/js/pages/dashboard.js`
- `node --check assets/js/pages/paciente-detalhes.js`
- `node --check assets/js/pages/portal-paciente.js`
- `node --check assets/js/services/patient-portal.service.js`
- `node --check assets/js/services/records.service.js`

Validar manualmente:

- conflito de agenda por profissional;
- sessao online com e sem link;
- Portugal, Manaus, Brasilia, Texas, Nova York e Los Angeles;
- mudanca de horario de verao;
- mudanca de timezone do paciente;
- virada de data;
- criacao de Appointment;
- fluxo completo ate `completed`;
- criacao automatica do rascunho;
- portal do paciente e botao de entrada;
- dashboard;
- auditoria.

## Limitacoes

- Google Meet ainda nao e integrado por API.
- Solicitacao de remarcacao, confirmacao de presenca e cancelamento pelo paciente aparecem no portal como comandos preparados, ainda sem workflow operacional.
- Financeiro permanece para sprint futura.
