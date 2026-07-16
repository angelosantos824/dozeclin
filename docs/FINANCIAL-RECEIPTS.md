# DOZECLIN - Comprovativos de pagamento

## Natureza do documento

O PDF gerado nesta Sprint e um comprovativo interno de pagamento. O titulo do documento e:

**COMPROVATIVO DE PAGAMENTO**

Subtitulo:

**Documento interno nao fiscal**

Ele nao e fatura, fatura-recibo, recibo fiscal, ATCUD nem documento fiscal oficial. A integracao fiscal externa fica preparada por campos proprios, mas nao e emitida automaticamente pelo DOZECLIN.

## Dados incluidos

O documento inclui numero sequencial interno, data de emissao, emitente, paciente, profissional responsavel quando existe Appointment, descricao do servico, data da sessao ou pagamento, valor, moeda, metodo de pagamento, referencia da cobranca, referencia do Appointment, regime de IVA e motivo de isencao quando configurado.

O PDF nunca deve incluir diagnostico, queixa principal, motivo clinico, conteudo de sessao, anamnese, prontuario, notas internas, link de reuniao, tokens, dados bancarios ou referencias sensiveis.

## Descricao profissional

A descricao do servico e derivada da cobranca e do profissional associado ao Appointment. Para profissionais cadastrados com especialidade ou texto contendo psicanalise, a Edge Function usa:

`Sessao individual de psicanalise - modalidade online`

ou:

`Sessao individual de psicanalise - modalidade presencial`

Descricoes psicologicas ou medicas nao sao inferidas automaticamente. A clinica deve configurar especialidade, registo profissional e dados fiscais com apoio contabilistico.

## IVA

Campos configuraveis em `clinic_settings`:

- `tax_regime`: `normal`, `exempt_article_9`, `exempt_article_53`, `other`
- `vat_rate`
- `vat_exemption_reason`
- dados fiscais do emitente

No regime normal o PDF apresenta taxa, base tributavel, IVA e total. Nos regimes isentos o IVA e zero e o motivo de nao aplicacao fica visivel.

## Snapshots

Ao gerar o PDF, a Edge Function cria snapshots imutaveis em `financial_receipts`:

- `issuer_snapshot`: `legal_name`, `trade_name`, `tax_identifier`, `fiscal_address`, `fiscal_postal_code`, `fiscal_city`, `fiscal_country`, `email`, `phone`.
- `professional_snapshot`: `profile_id`, `full_name`, `display_title`, `specialty`, `professional_registration`, `tax_identifier` quando configurado.
- `patient_snapshot`: `patient_id`, `full_name`, `tax_identifier`, `email`, `address`, `postal_code`, `city`, `country`.
- `service_snapshot`: `description`, `modality`, `appointment_id`, `appointment_date`, `scheduled_start`, `clinic_timezone`, `patient_timezone_snapshot`, `expected_duration`, `currency`, `unit_price`, `discount_amount`, `final_amount`.
- `payment_snapshot`: `payment_id`, `amount`, `currency`, `payment_method`, `payment_date`, `charge_id`, `balance_before`, `balance_after`.
- `tax_snapshot`: `tax_regime`, `vat_rate`, `vat_amount`, `exemption_reason`.

Mudancas futuras em nome, morada, configuracao fiscal ou profissional nao alteram recibos antigos.

## Versionamento e reconstrucao futura

Cada recibo possui `document_template_version`, com valor inicial:

`internal_payment_receipt_v1`

Os snapshots preservam os dados variaveis usados na emissao. O campo `document_template_version` identifica as regras de renderizacao, textos, layout e calculos esperados para aquela versao. O `pdf_storage_path` preserva o documento original emitido e o `pdf_hash` valida que o arquivo armazenado nao foi substituido.

Uma reconstrucao futura nao deve consultar dados atuais da clinica, paciente ou profissional para alterar conteudo historico. Ela deve selecionar o renderer correspondente a `document_template_version` e usar exclusivamente os snapshots gravados, comparando o resultado apenas quando houver fluxo formal de auditoria/reemissao.

## Armazenamento

Bucket privado: `financial-documents`

Estrutura:

`clinic_id/patient_id/year/receipt_id.pdf`

Nao ha URL publica permanente. Acesso ocorre por signed URL temporaria retornada pela Edge Function.

## Edge Function

Funcao:

`generate-financial-receipt-pdf`

Responsabilidades:

- validar JWT;
- validar staff da clinica ou proprio paciente;
- carregar receipt, payment, charge, appointment, patient, professional e settings;
- exigir payment `confirmed` e receipt `issued`;
- gerar PDF com `pdf-lib`;
- calcular SHA-256;
- gravar no bucket privado;
- chamar `dozeclin.finalize_financial_receipt_pdf(...)`;
- retornar signed URL temporaria.

O frontend nao usa `service_role`.

## Portal do Paciente

O Portal usa `auth.uid()` e `dozeclin.current_patient_id()` no contexto. O paciente nao envia `patient_id` por URL para acessar documentos. A Edge Function bloqueia recibos de outro paciente.

## Auditoria

Eventos:

- `financial.receipt_pdf_generated`
- `financial.receipt_pdf_viewed`
- `financial.receipt_pdf_downloaded`
- `financial.external_document_linked` reservado para fluxo futuro

Auditoria nao grava conteudo completo do PDF, NIF completo, morada completa, dados bancarios, tokens ou signed URLs.

## Limitacoes

- Sem emissao fiscal oficial nesta Sprint.
- Sem ATCUD gerado pelo DOZECLIN.
- Sem reemissao/cancelamento de PDF.
- Sem nota de credito/estorno automatico quando Appointment pago e posteriormente cancelado.

## Deploy manual

1. Aplicar a migration `20260714174500_financial_receipt_pdf.sql`.
2. Deploy manual da Edge Function `generate-financial-receipt-pdf`.
3. Confirmar `verify_jwt = true` em `supabase/config.toml`.
4. Validar bucket privado e signed URLs temporarias.
5. Testar staff da clinica, staff de outra clinica, paciente correto e outro paciente.
