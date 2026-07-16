# Assinaturas, validacao publica e rastreabilidade documental

## Documento e PDF

`clinical_documents` e a fonte de estado, conteudo, snapshots, numeracao e visibilidade. O PDF e apenas uma representacao imutavel de uma versao especifica.

Campos preparados para a representacao atual:

- `current_pdf_path`
- `current_pdf_hash`
- `current_pdf_generated_at`
- `current_pdf_template_version`

Signed URLs nunca sao armazenadas. O frontend nao controla caminho de storage.

## Numeracao

`clinical_document_sequences` gera numeros amigaveis no banco com lock transacional por `clinic_id`, prefixo e ano.

Exemplos:

- `DEC-2026-000001`
- `REL-2026-000001`
- `ENC-2026-000001`
- `EVO-2026-000001`
- `PLA-2026-000001`
- `CON-2026-000001`
- `DOC-2026-000001`

Numeros nao sao reutilizados para documentos cancelados, revogados ou arquivados.

## Tipos, estados e visibilidade

Tipos controlados por `clinical_document_type`:

- `attendance_certificate`
- `follow_up_certificate`
- `service_certificate`
- `clinical_report`
- `clinical_progress`
- `referral`
- `treatment_plan`
- `consent`
- `custom`

Estados documentais: `draft`, `issued`, `revoked`, `cancelled`, `archived`.

Estados de assinatura: `unsigned`, `signed`, `revoked`.

Visibilidade: `internal`, `patient`, `public_validation_only`.

`visibility = patient` indica que o documento pode ser liberado ao paciente, mas o acesso real depende de `patient_access_enabled`.

## Templates

`document_templates` guarda:

- `template_code`
- `template_name`
- `template_version`
- `document_type`
- `status`
- `schema_definition`
- `renderer_key`
- `required_patient_fields`

Documentos emitidos preservam `template_code`, `template_name` e `template_version`. Um template novo nao altera documentos antigos.

## Assinaturas

`professional_signatures` suporta `owner_type`:

- `professional`: assinatura ou carimbo do profissional.
- `clinic`: assinatura institucional, carimbo, selo ou logotipo.

Tipos institucionais:

- `clinic_signature`
- `clinic_stamp`
- `clinic_seal`
- `clinic_logo`

Assets usados em documento entram em snapshot. Alterar o asset atual nao modifica documentos antigos.

## Snapshots e minimizacao

`clinic_snapshot` guarda dados institucionais minimos. `professional_snapshot` guarda nome, titulo configurado, especialidade, registro e hash da assinatura. `patient_snapshot` guarda por padrao apenas `patient_id` interno e iniciais.

Nao guardar por padrao telefone, email, morada completa, NIF, WhatsApp, dados financeiros ou diagnostico fora do conteudo autorizado do template.

## QR e validacao publica

O QR usa token opaco, aleatorio e armazenado somente como hash. Em producao, a URL preferida e:

`https://app.dozedev.pt/v/TOKEN_OPACO`

Localmente:

`http://127.0.0.1:8000/app/verificar-documento.html?token=TOKEN_OPACO`

A pagina publica mostra apenas tipo, numero, clinica, profissional, atividade, iniciais do paciente, data, versao, estado e hash parcial.

## Compartilhamento temporario

`document_public_links` guarda token apenas como hash, expiracao, limite de visualizacoes e permissao de download. Links de conteudo sao bloqueados para `visibility = internal` e exigem PDF emitido.

## Arquivamento

`archive_clinical_document` arquiva documentos `issued`, `revoked` ou `cancelled`. Rascunhos nao podem ser arquivados. O estado anterior fica em `archived_previous_status`. Esta Sprint nao implementa restauracao.

## Agenda e Prontuario

`create_document_from_appointment` cria rascunho a partir de Appointment concluido quando exigido pelo tipo documental. O fluxo nao gera documento final automaticamente ao concluir Appointment.

Na pagina de paciente/prontuario, o botao "Gerar documento" cria draft para revisao.

## Portal do Paciente

O Portal lista somente documentos do proprio paciente com:

- `visibility = patient`
- `patient_access_enabled = true`
- `status in ('issued', 'revoked', 'archived')`

Rascunhos, internos, cancelados, evolucoes clinicas internas, anotacoes e auditoria nao sao exibidos.

## RLS, auditoria e storage

Tabelas novas usam RLS e isolamento por `clinic_id`. `clinical_document_sequences` nao e consultavel diretamente pelo frontend. Eventos de acesso guardam apenas metadata sanitizada, sem token, signed URL, conteudo clinico ou dados pessoais desnecessarios.

Buckets privados:

- `professional-signatures`
- `clinical-documents`
- `document-assets`

## Permissoes

- `documents.read`
- `documents.create`
- `documents.edit`
- `documents.issue`
- `documents.sign`
- `documents.export`
- `documents.share`
- `documents.public_validation`
- `documents.revoke`
- `documents.archive`
- `documents.release_to_patient`
- `signatures.read`
- `signatures.manage`

## Limitacoes

- Nao implementa assinatura qualificada, certificado digital, Chave Movel Digital, blockchain, ATCUD ou reconhecimento juridico automatico.
- O renderer PDF clinico fica preparado por `template_code` e `template_version`, mas nao foi implementado como gerador completo nesta revisao.
- Restauracao de documento arquivado foi deliberadamente adiada para preservar integridade.
