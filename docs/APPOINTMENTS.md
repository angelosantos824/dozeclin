# Consultas e Agenda

## Modelo

As consultas usam `dozeclin.appointments`.

Campos principais:

- `clinic_id`
- `patient_id`
- `professional_id`
- `appointment_date`
- `start_time`
- `end_time`
- `status`
- `appointment_type`
- `notes`
- `created_by`

## Estados

- `scheduled`: Agendada
- `confirmed`: Confirmada
- `in_progress`: Em atendimento
- `completed`: Concluida
- `cancelled`: Cancelada
- `no_show`: Nao compareceu

## Tipos

- `first_visit`: Primeira consulta
- `follow_up`: Consulta de acompanhamento
- `assessment`: Avaliacao
- `return_visit`: Retorno
- `session`: Sessao
- `other`: Outro

## Validacao de conflito

A migration `20260711190000_dozeclin_sprint2_professionals_appointments.sql` cria a funcao `dozeclin.validate_appointment()` e o trigger `validate_appointment_before_write`.

O banco bloqueia:

- consulta sem clinica;
- consulta sem paciente;
- consulta sem profissional;
- hora final menor ou igual a hora inicial;
- paciente de outra clinica;
- profissional de outra clinica;
- profissional inativo;
- sobreposicao de horario para o mesmo profissional no mesmo dia;
- conclusao por perfil sem permissao.

Consultas canceladas nao bloqueiam horario.

## Interface

A pagina `app/agenda.html` permite:

- filtrar por periodo;
- filtrar por profissional;
- filtrar por paciente;
- filtrar por estado;
- criar consulta;
- editar consulta;
- confirmar;
- iniciar;
- concluir;
- cancelar;
- marcar nao comparecimento.

## Aplicacao manual

Nao aplicar automaticamente em producao. Execute a migration incremental manualmente no Supabase compartilhado do DOZEDEV.
