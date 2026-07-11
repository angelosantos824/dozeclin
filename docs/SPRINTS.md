# Sprints

## Sprint 1

Foco: fundacao tecnica.

Entregue:

- Estrutura modular.
- Autenticacao Supabase Auth.
- Protecao de paginas.
- Layout administrativo.
- Dashboard inicial.
- Pacientes inicial.
- Configuracoes da clinica.
- Migration com RLS.
- Documentacao.

Nao entregue nesta Sprint:

- Prontuario migrado.
- Anamnese migrada.
- Tarefas migradas.
- Financeiro migrado.
- Area do paciente migrada.
- Deploy.

## Checklist de testes

Marcar apenas apos executar:

- [ ] Login com email e senha.
- [ ] Logout.
- [ ] Recuperacao de senha.
- [ ] Protecao de paginas sem sessao.
- [ ] Criacao de clinica.
- [ ] Criacao de utilizador.
- [ ] Perfil com `clinic_id`.
- [ ] Dashboard com dados reais.
- [ ] Criacao de paciente.
- [ ] Edicao de paciente.
- [ ] Arquivamento de paciente.
- [ ] RLS bloqueia acesso cruzado.
- [ ] Clinica A nao ve dados da clinica B.
- [ ] Responsividade em desktop.
- [ ] Responsividade em tablet.
- [ ] Responsividade em telemovel.
- [ ] Falha de rede mostra erro visivel.

## Proxima Sprint recomendada

Migrar prontuario clinico para `medical_records`, mantendo confidencialidade e auditoria.
