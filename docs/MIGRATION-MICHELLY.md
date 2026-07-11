# Migracao Michelly para DOZECLIN

Esta Sprint nao migra dados reais.

## 1. Criar a clinica Michelly

Criar um registro em `clinics` com os dados comerciais autorizados da implantacao.
No ambiente compartilhado, a tabela correta e `dozeclin.clinics`.

## 2. Associar utilizadores

Criar utilizadores em Supabase Auth e registros correspondentes em `dozeclin.profiles`, todos com o `clinic_id` da clinica Michelly.

## 3. Migrar pacientes

Mapear `pacientes` legado para `dozeclin.patients`:

- `nome` para `full_name`
- `email` para `email`
- `telefone` para `phone`
- `nascimento` para `birth_date`
- `morada` para `address`
- campos de estado para `status`

Validar duplicidades antes da importacao.

## 4. Migrar prontuarios

Campos como `notas`, `historia` e evolucoes devem virar registros em `dozeclin.medical_records`, com `clinic_id`, `patient_id` e `professional_id`.

## 5. Migrar anamneses

`anamnese_completa` deve virar `dozeclin.anamnesis_forms.answers` em JSONB.

## 6. Migrar tarefas

Dados de `liberar_7dias`, `data_inicio_7dias` e `respostas_7dias` devem virar `dozeclin.patient_tasks`.

## 7. Migrar financeiro

Dados de `fluxo_caixa` e `pacientes.financeiro` devem virar `dozeclin.financial_entries`.

## 8. Validar contagens

Comparar:

- total de pacientes ativos;
- total de prontuarios;
- total de anamneses;
- total de tarefas;
- total financeiro por moeda.

## 9. Rollback

Como a migracao deve ser feita no schema `dozeclin` do Supabase compartilhado do DOZEDEV, rollback consiste em pausar o acesso ao DOZECLIN, remover ou ignorar os dados importados no schema `dozeclin` e manter o sistema original funcionando sem alteracao.

## 10. Transicao

O projeto original da Michelly deve continuar operacional ate a validacao completa da primeira implantacao DOZECLIN.
