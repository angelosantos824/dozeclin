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

## Proxima Sprint recomendada apos validacao

Evoluir prontuario com adendos e assinatura digital, ou iniciar a reconstrucao da anamnese somente com autorizacao.

## Sprint 2

Foco: profissionais, agenda e consultas.

Entregue:

- Gestao de profissionais em `app/profissionais.html`.
- Criacao de profissional com `status = pending_invite`.
- Agenda em `app/agenda.html`.
- Criacao e edicao de consultas.
- Alteracao de estados de consulta.
- Dashboard com consultas reais e proximas consultas.
- Migration incremental com validacao de conflito no banco.
- Permissoes finas para profissionais e agenda.

Nao entregue nesta Sprint:

- Criacao automatica de utilizador Auth para profissional.
- Prontuario funcional.
- Anamnese funcional.
- Tarefas.
- Financeiro completo.
- Portal do paciente.

Checklist Sprint 2:

- [ ] clinic_admin visualiza profissionais.
- [ ] clinic_admin cria profissional pendente.
- [ ] profissional de outra clinica nao aparece.
- [ ] criacao de consulta valida.
- [ ] conflito de horario e bloqueado.
- [ ] consulta cancelada deixa de bloquear horario.
- [ ] filtro por data.
- [ ] filtro por profissional.
- [ ] filtro por estado.
- [ ] mudanca de Agendada para Confirmada.
- [ ] mudanca de Confirmada para Em atendimento.
- [ ] mudanca de Em atendimento para Concluida.
- [ ] recepcao nao conclui consulta.
- [ ] utilizador sem permissao e bloqueado.
- [ ] dashboard mostra consultas reais.
- [ ] responsividade.
- [ ] ausencia de erros no console.
- [ ] ausencia de innerHTML inseguro.
- [ ] ausencia de service_role no frontend.
- [ ] ausencia de acesso cruzado entre clinicas.

## Sprint 3.1

Foco: prontuario clinico inicial.

Entregue:

- Tabela `dozeclin.medical_records` complementada por migration incremental.
- Service `records.service.js`.
- Pagina `app/paciente-detalhes.html` com secao Prontuario.
- Criacao de registro em rascunho.
- Edicao de rascunho.
- Visualizacao detalhada.
- Assinatura sem assinatura digital.
- Cancelamento com motivo.
- Bloqueio de edicao comum de registros assinados.

Checklist Sprint 3.1:

- [ ] Utilizador autenticado abre perfil de paciente.
- [ ] Aba/secao Prontuario aparece.
- [ ] Registro em rascunho e criado.
- [ ] Registro aparece no paciente correto.
- [ ] Mais recente aparece primeiro.
- [ ] Paciente de outra clinica nao abre.
- [ ] Prontuario de outra clinica nao consulta.
- [ ] `clinic_id` nao pode ser falsificado pelo frontend.
- [ ] Rascunho pode ser editado por autorizado.
- [ ] Assinado nao pode ser editado normalmente.
- [ ] Cancelado continua no historico.
- [ ] Sem erros no console.
- [ ] Sem imports quebrados.
- [ ] Navegacao anterior continua funcionando.
- [ ] Interface sem codigos tecnicos em ingles.
