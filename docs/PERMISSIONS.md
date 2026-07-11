# Permissoes

## Codigos internos

- `professionals.read`
- `professionals.create`
- `professionals.update`
- `appointments.read`
- `appointments.create`
- `appointments.update`
- `appointments.cancel`
- `appointments.complete`
- `medical_records.read`
- `medical_records.create`
- `medical_records.update`
- `medical_records.sign`
- `medical_records.cancel`

## Regras por perfil

`clinic_admin`:

- acesso completo aos profissionais;
- acesso completo a agenda da propria clinica.

`reception`:

- visualiza profissionais;
- visualiza agenda;
- cria e edita consultas;
- confirma e cancela consultas;
- nao conclui atendimento clinico.

`professional`:

- visualiza agenda da propria clinica conforme RLS;
- inicia e conclui as proprias consultas;
- nao gere profissionais.
- cria e edita rascunhos clinicos conforme RLS.
- assina e cancela registros autorizados.

`supervisor`:

- visualiza profissionais;
- visualiza agenda;
- gere consultas;
- visualiza todos os profissionais da clinica.
- gere prontuarios clinicos da propria clinica.

`finance`:

- nao gere agenda nesta Sprint;
- nao visualiza observacoes clinicas.

`patient`:

- sem acesso as paginas administrativas nesta Sprint.

## Prontuario

Na interface, as permissoes aparecem como:

- Visualizar prontuarios
- Criar registros clinicos
- Editar rascunhos clinicos
- Assinar registros clinicos
- Cancelar registros clinicos

## Convites de profissionais

O frontend nao usa `service_role` e nao cria utilizadores em Supabase Auth com anon key.

Nesta Sprint, o `clinic_admin` cria um profissional em `dozeclin.profiles` com `status = 'pending_invite'`. O acesso Auth deve ser criado futuramente por fluxo seguro administrativo.
