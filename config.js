// 1. Defina as constantes primeiro
const supabaseUrl = 'SUA URL';
const supabaseKey = 'SUA CHAVE';

// 2. Use as constantes dentro do createClient
// Certifique-se de que o script do Supabase está no seu HTML antes deste arquivo!
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// --- GESTÃO DE PACIENTES ---
        async function renderTable() {
            const tbody = document.getElementById('tabelaClientes');
            const { data: pacientes, error } = await _supabase.from('pacientes').select('*').order('nome');
            if (error) return;
            
            tbody.innerHTML = '';
            pacientes.forEach(p => {
                tbody.innerHTML += `
                    <tr>
                        <td><span class="id-label">#${p.senha_acesso || '---'}</span></td>
                        <td style="font-weight: bold; color: #d4a373;">${p.nome}</td>
                        <td>
                            <a href="detalhes-cliente.html?id=${p.id}" style="background: #7b8f80; color: white; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-size: 12px;">Prontuário</a>
                            <button class="btn-excluir" style="padding: 6px 12px;" onclick="excluirPaciente('${p.id}')">Excluir</button>
                        </td>
                    </tr>`;
            });
        }

        async function salvarPacienteSQL() {
            const nome = document.getElementById('nomeInput').value;
            const email = document.getElementById('emailInput').value;
            if(!nome || !email) return alert("Preencha nome e e-mail.");
            const senha = Math.floor(1000 + Math.random() * 9000).toString();
            await _supabase.from('pacientes').insert([{ nome, email, senha_acesso: senha, codigo_acesso: senha }]);
            document.getElementById('nomeInput').value = ''; 
            document.getElementById('emailInput').value = ''; 
            renderTable();
        }

        async function excluirPaciente(id) {
            if (confirm("Excluir permanentemente?")) {
                await _supabase.from('pacientes').delete().eq('id', id);
                renderTable();
            }
        }

        // --- GESTÃO FINANCEIRA MULTIMOEDAS ---
        async function renderFinanceiro() {
            const tbody = document.getElementById('tabelaFinanceira');
            const { data: lancamentos, error } = await _supabase.from('fluxo_caixa').select('*').order('data', { ascending: false });
            if (error) return;

            let saldos = { BRL: 0, EUR: 0, USD: 0 };
            const simbolos = { BRL: 'R$', EUR: '€', USD: '$' };
            
            tbody.innerHTML = '';
            lancamentos.forEach(l => {
                const valorNum = parseFloat(l.valor);
                const moeda = l.moeda || 'BRL'; // Fallback para registros antigos
                const isEntrada = l.tipo === 'entrada';
                
                // Soma no saldo da moeda específica
                saldos[moeda] += isEntrada ? valorNum : -valorNum;
                
                const dataFormatada = new Date(l.data).toLocaleDateString('pt-BR');
                
                tbody.innerHTML += `
                    <tr>
                        <td>${dataFormatada}</td>
                        <td>${l.descricao}</td>
                        <td><strong>${moeda}</strong></td>
                        <td class="${isEntrada ? 'valor-entrada' : 'valor-saida'}">
                            ${isEntrada ? '+' : '-'} ${simbolos[moeda]} ${valorNum.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                        </td>
                        <td><button class="btn-excluir" style="padding: 5px 10px;" onclick="excluirLancamento('${l.id}')">✕</button></td>
                    </tr>`;
            });

            // Atualiza os cards de saldo
            document.getElementById('saldoBRL').innerText = `R$ ${saldos.BRL.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
            document.getElementById('saldoEUR').innerText = `€ ${saldos.EUR.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
            document.getElementById('saldoUSD').innerText = `$ ${saldos.USD.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        }

       async function salvarLancamento() {
    const descricao =
        document.getElementById('descFinanceiro').value.trim();

    const valor =
        document.getElementById('valorFinanceiro').value;

    const moeda =
        document.getElementById('moedaFinanceiro').value;

    const tipo =
        document.getElementById('tipoFinanceiro').value;

    if (!descricao || !valor) {
        alert("Preencha descrição e valor.");
        return;
    }

    const { error } =
        await _supabase
            .from('fluxo_caixa')
            .insert([{
                descricao: descricao,
                valor: parseFloat(valor),
                moeda: moeda,
                tipo: tipo
            }]);

    if (error) {
        console.error(error);
        alert("Erro ao salvar lançamento.");
        return;
    }

    document.getElementById('descFinanceiro').value = '';
    document.getElementById('valorFinanceiro').value = '';
    document.getElementById('tipoFinanceiro').value = 'entrada';

    renderFinanceiro();
}

async function excluirLancamento(id) {

    if (!confirm("Remover registro?")) return;

    const { error } =
        await _supabase
            .from('fluxo_caixa')
            .delete()
            .eq('id', id);

    if (error) {
        console.error(error);
        alert("Erro ao excluir lançamento.");
        return;
    }

    renderFinanceiro();
}

        document.addEventListener('DOMContentLoaded', () => {
            renderTable();
            renderFinanceiro();
        });
        
        const urlParams = new URLSearchParams(window.location.search);
        const idCliente = urlParams.get('id');

        async function carregarDadosPaciente() {
    if (!idCliente) {
        console.warn("Nenhum ID recebido.");
        return;
    }

    localStorage.setItem('paciente_id', idCliente);

    try {
        const { data: paciente, error } = await _supabase
            .from('pacientes')
            .select('*')
            .eq('id', idCliente)
            .single();

        if (error || !paciente) throw error;

        const fusoPacienteSelect = document.getElementById('fusoPaciente');

        if (fusoPacienteSelect) {
            fusoPacienteSelect.value = paciente.fuso_paciente || 'Europe/Lisbon';
        }

        // Nome no painel do cliente
        const nomeCliente = document.getElementById('nomeCliente');
        if (nomeCliente) {
            nomeCliente.innerText = paciente.nome || "Paciente";
        }

        // Nome no detalhes-cliente.html
        const nomeDisplay = document.getElementById('nomeDisplay');
        if (nomeDisplay) {
            nomeDisplay.innerText = paciente.nome || "Paciente";
        }

        const infoCliente = document.getElementById('infoCliente');
        if (infoCliente) {
            infoCliente.innerText =
                `Código de acesso: ${paciente.senha_acesso || paciente.codigo_acesso || '---'}`;
        }

        const btnAnamnese = document.getElementById('btnAnamnese');
        if (btnAnamnese) {
            btnAnamnese.href = `anamnese.html?id=${idCliente}`;
        }

        // Dados pessoais do prontuário
        if (document.getElementById('email')) {
            document.getElementById('email').value = paciente.email || "";
        }

        if (document.getElementById('telefone')) {
            document.getElementById('telefone').value = paciente.telefone || "";
        }

        if (document.getElementById('nascimento')) {
            document.getElementById('nascimento').value = paciente.nascimento || "";
        }

        if (document.getElementById('idade')) {
            document.getElementById('idade').value = paciente.idade || "";
        }

        if (document.getElementById('statusPaciente')) {
            document.getElementById('statusPaciente').value =
                paciente.status || "Atendimento";
        }

        if (document.getElementById('morada')) {
            document.getElementById('morada').value = paciente.morada || "";
        }

       const linkReuniao = document.getElementById('linkReuniao');

if (linkReuniao) {
    linkReuniao.value = paciente.link_reuniao || "";
}

const btnReuniaoCliente = document.getElementById('btnReuniaoCliente');
const semLinkReuniao = document.getElementById('semLinkReuniao');

if (btnReuniaoCliente && semLinkReuniao) {

    if (paciente.link_reuniao) {

        btnReuniaoCliente.href =
            paciente.link_reuniao;

        btnReuniaoCliente.style.display =
            'inline-block';

        semLinkReuniao.style.display =
            'none';

    } else {

        btnReuniaoCliente.style.display =
            'none';

        semLinkReuniao.style.display =
            'block';
    }
}
        if (document.getElementById('historiaCliente')) {
            document.getElementById('historiaCliente').innerText =
                paciente.historia ||
                paciente.queixa_principal ||
                "Nenhuma história registrada.";
        }

        const anamneseConteudo = document.getElementById('anamneseConteudo');

if (anamneseConteudo) {
    let anamnese =
        paciente.anamnese_completa ||
        paciente.anamnese ||
        null;

    if (!anamnese) {
        anamneseConteudo.innerHTML =
            "Nenhuma anamnese registrada.";
    } else {
        if (typeof anamnese === "string") {
            try {
                anamnese = JSON.parse(anamnese);
            } catch (e) {
                anamneseConteudo.innerHTML = anamnese;
                return;
            }
        }

        anamneseConteudo.innerHTML = Object.entries(anamnese)
            .map(([campo, valor]) => `
                <p>
                    <strong>${campo.replaceAll('_', ' ')}:</strong><br>
                    ${valor || "---"}
                </p>
            `)
            .join("");
    }
}

        if (document.getElementById('notasEvolucao')) {
            document.getElementById('notasEvolucao').value =
                paciente.notas || "";
        }

        // Tarefa 7 dias
        const btnTarefa7 = document.getElementById('btnTarefa7');
        if (btnTarefa7) {
            if (paciente.liberar_7dias === true) {
                btnTarefa7.style.display = 'flex';
                btnTarefa7.href = `tarefa-7-dias.html?id=${idCliente}`;
            } else {
                btnTarefa7.style.display = 'none';
            }
        }

        const liberar7Dias = document.getElementById('liberar7Dias');
        if (liberar7Dias) {
            liberar7Dias.checked = paciente.liberar_7dias === true;
        }

        // --- PROGRESSO DO EXERCÍCIO 7 DIAS ---
const barraProgresso =
    document.getElementById('barraProgresso');

const textoProgresso =
    document.getElementById('textoProgresso');

if (barraProgresso && textoProgresso) {

    let respostas7 =
        paciente.respostas_7dias || {};

    if (typeof respostas7 === "string") {
        try {
            respostas7 = JSON.parse(respostas7);
        } catch {
            respostas7 = {};
        }
    }

    const diasRespondidos =
        Object.keys(respostas7).length;

    const percentual =
        Math.round((diasRespondidos / 7) * 100);

    barraProgresso.style.width =
        `${percentual}%`;

    textoProgresso.innerText =
        `${percentual}% concluído (${diasRespondidos}/7 dias)`;
}

        // Agenda no painel do cliente
        const elementoData = document.getElementById('dataAgendada');
        const cardAviso = document.getElementById('cardAvisoAgenda');
        const fusoAviso = document.getElementById('fusoCliente');

        if (elementoData && cardAviso) {
            if (paciente.proximo_agendamento) {
                const dataSessao = new Date(paciente.proximo_agendamento);
                const agora = new Date();

                cardAviso.style.display = 'block';

                if (dataSessao > agora) {

    const fuso =
        paciente.fuso_paciente || 'Europe/Lisbon';

    const dataFormatada =
        dataSessao.toLocaleDateString('pt-BR', {
            timeZone: fuso,
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });

    const horaFormatada =
        dataSessao.toLocaleTimeString('pt-BR', {
            timeZone: fuso,
            hour: '2-digit',
            minute: '2-digit'
        });

    elementoData.innerText =
        `${dataFormatada} às ${horaFormatada}`;

                    if (fusoAviso) {
                        fusoAviso.style.display = 'block';
                    }
                } else {
                    elementoData.innerHTML =
                        "<span style='color: #85741d; font-weight: normal; font-size: 1.1rem;'>Aguardando novo agendamento...</span>";

                    if (fusoAviso) {
                        fusoAviso.style.display = 'none';
                    }
                }
            } else {
                cardAviso.style.display = 'none';
            }
        }

        // Agenda no detalhes-cliente.html
        if (paciente.proximo_agendamento) {
            const data = new Date(paciente.proximo_agendamento);

            const agendamentoData = document.getElementById('agendamentoData');
            const agendamentoHora = document.getElementById('agendamentoHora');

            if (agendamentoData) {
                agendamentoData.value = data.toISOString().split('T')[0];
            }

            if (agendamentoHora) {
                agendamentoHora.value = data.toTimeString().slice(0, 5);
            }
        }

        // Link da pasta
        const linkPasta = document.getElementById('linkPasta');
        if (linkPasta && (paciente.link_drive_pasta || paciente.pasta_nome)) {
            linkPasta.href = paciente.link_drive_pasta || paciente.pasta_nome;
        }

        // Financeiro no painel do cliente
        const tabelaFinanceiraCliente =
            document.getElementById('tabelaFinanceiraCliente');

        if (tabelaFinanceiraCliente) {
            renderFinanceiroPacienteTabela(
                tabelaFinanceiraCliente,
                paciente.financeiro || []
            );
        }

        // Financeiro no detalhes-cliente.html
        const tabelaFinanceiroDetalhes =
            document.querySelector('#tabelaFinanceiro tbody');

        if (tabelaFinanceiroDetalhes) {
            renderFinanceiroPacienteTabela(
                tabelaFinanceiroDetalhes,
                paciente.financeiro || []
            );
        }

        const loadingOverlay =
            document.getElementById('loading-overlay');

        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }

        const conteudoPrincipal =
            document.getElementById('conteudo-principal');

        if (conteudoPrincipal) {
            conteudoPrincipal.style.display = 'block';
        }

    } catch (err) {
        console.error("Erro ao carregar dados:", err);
        alert("Erro ao carregar informações.");
    }
}

function renderFinanceiroPacienteTabela(tbody, financeiro) {
    tbody.innerHTML = "";

    if (!financeiro || financeiro.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center; padding:20px; color:#999;">
                    Nenhum registro de sessão disponível.
                </td>
            </tr>
        `;
        return;
    }

    const simbolos = {
        BRL: 'R$',
        EUR: '€',
        USD: '$'
    };

    financeiro.forEach((item, index) => {
        const status = item.status || "Pendente";
        const statusClasse =
            status.toLowerCase() === 'pago'
                ? 'status-pago'
                : 'status-pendente';

        const moeda = item.moeda || 'BRL';
        const simbolo = simbolos[moeda] || 'R$';
        const valor = parseFloat(item.valor || 0);

        tbody.innerHTML += `
            <tr>
                <td>${item.data || "---"}</td>

                <td>
                    <strong>${moeda}</strong> ${simbolo} ${valor.toLocaleString('pt-BR', {
                        minimumFractionDigits: 2
                    })}
                </td>

                <td class="${statusClasse}">
                    ${status}

                    ${
                        status.toLowerCase() !== 'pago'
                            ? `<br>
                               <button 
                                   onclick="marcarSessaoPaga(${index})"
                                   style="margin-top:6px; padding:5px 8px; border:none; border-radius:6px; background:#7b8f80; color:white; cursor:pointer; font-size:11px;">
                                   Marcar pago
                               </button>`
                            : ""
                    }
                </td>
            </tr>
        `;
    });
}

async function marcarSessaoPaga(index) {
    const { data: paciente, error: erroBusca } = await _supabase
        .from('pacientes')
        .select('financeiro')
        .eq('id', idCliente)
        .single();

    if (erroBusca) {
        console.error(erroBusca);
        alert("Erro ao buscar financeiro.");
        return;
    }

    const financeiroAtual = paciente.financeiro || [];

    if (!financeiroAtual[index]) {
        alert("Sessão não encontrada.");
        return;
    }

    financeiroAtual[index].status = "Pago";

    const { error } = await _supabase
        .from('pacientes')
        .update({
            financeiro: financeiroAtual
        })
        .eq('id', idCliente);

    if (error) {
        console.error(error);
        alert("Erro ao atualizar pagamento.");
        return;
    }

    carregarDadosPaciente();
}

async function addSessao() {
    if (!idCliente) {
        alert("Paciente não identificado.");
        return;
    }

    const valor = prompt("Valor da sessão:");
    if (!valor) return;

    const moeda = prompt("Moeda: BRL, EUR ou USD", "EUR");
    if (!moeda) return;

    const status = prompt("Status: Pago ou Pendente", "Pendente");
    if (!status) return;

    const hoje = new Date().toLocaleDateString('pt-BR');

    const { data: paciente, error: erroBusca } = await _supabase
        .from('pacientes')
        .select('financeiro')
        .eq('id', idCliente)
        .single();

    if (erroBusca) {
        console.error(erroBusca);
        alert("Erro ao buscar financeiro.");
        return;
    }

    const financeiroAtual = paciente.financeiro || [];

    financeiroAtual.push({
        data: hoje,
        valor: parseFloat(valor),
        moeda: moeda.toUpperCase(),
        status: status
    });

    const { error } = await _supabase
        .from('pacientes')
        .update({
            financeiro: financeiroAtual
        })
        .eq('id', idCliente);

    if (error) {
        console.error(error);
        alert("Erro ao registrar sessão.");
        return;
    }

    alert("Sessão registrada com sucesso.");
    carregarDadosPaciente();
}

async function salvarTudo() {
    if (!idCliente) {
        alert("Paciente não identificado.");
        return;
    }

    let proximoAgendamento = null;

    const data = document.getElementById('agendamentoData')?.value;
    const hora = document.getElementById('agendamentoHora')?.value;

    if (data && hora) {
        proximoAgendamento = `${data}T${hora}:00`;
    }

    const liberar7Dias =
        document.getElementById('liberar7Dias')?.checked || false;

    const { error } = await _supabase
        .from('pacientes')
        .update({
            proximo_agendamento: proximoAgendamento,
            liberar_7dias: liberar7Dias,
            link_reuniao: document.getElementById('linkReuniao')?.value || null,
            fuso_paciente: document.getElementById('fusoPaciente')?.value || 'Europe/Lisbon'
        })
        .eq('id', idCliente);

    if (error) {
        console.error(error);
        alert("Erro ao salvar prontuário.");
        return;
    }

    alert("Prontuário salvo com sucesso.");
    carregarDadosPaciente();
}

let pacienteData = null;

async function carregarExercicio7Dias() {
    const progressoTexto = document.getElementById('progresso-texto');

    if (!progressoTexto) return;

    if (!idCliente) {
        alert("Acesso inválido.");
        return;
    }

    const { data, error } = await _supabase
        .from('pacientes')
        .select('*')
        .eq('id', idCliente)
        .single();

    if (error || !data) {
        console.error(error);
        progressoTexto.innerText = "Erro ao carregar exercício.";
        return;
    }

    pacienteData = data;

    if (data.liberar_7dias !== true) {
        progressoTexto.innerText = "Exercício ainda não liberado.";
        return;
    }

    if (!data.data_inicio_7dias) {
        await _supabase
            .from('pacientes')
            .update({
                data_inicio_7dias: new Date().toISOString()
            })
            .eq('id', idCliente);

        location.reload();
        return;
    }

    const inicio = new Date(data.data_inicio_7dias);
    inicio.setHours(0, 0, 0, 0);

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const diffTempo = hoje.getTime() - inicio.getTime();
    const diffDias = Math.floor(diffTempo / (1000 * 60 * 60 * 24)) + 1;

    const diaAtual = diffDias > 7 ? 7 : diffDias;

    progressoTexto.innerText =
        `Você está no DIA ${diaAtual} da sua jornada.`;

    let respostas = data.respostas_7dias || {};

    if (typeof respostas === "string") {
        try {
            respostas = JSON.parse(respostas);
        } catch {
            respostas = {};
        }
    }

    const blocos = [1, 2, 3, 5, 7];

    blocos.forEach(num => {
        const bloco = document.getElementById(`bloco-${num}`);
        if (!bloco) return;

        if (num <= diaAtual) {
            bloco.style.display = 'block';

            if (respostas[`dia_${num}`]) {
                const btn = document.getElementById(`btn-${num}`);

                if (btn) {
                    btn.innerText = "✅ Resposta Salva";
                    btn.disabled = true;
                }

                if (num === 2) {
                    const sentia = document.getElementById('dia-2-sentia');
                    const queria = document.getElementById('dia-2-queria');

                    if (sentia) {
                        sentia.value = respostas.dia_2.sentia || "";
                        sentia.disabled = true;
                    }

                    if (queria) {
                        queria.value = respostas.dia_2.queria || "";
                        queria.disabled = true;
                    }
                } else {
                    const campo = document.getElementById(`dia-${num}`);

                    if (campo) {
                        campo.value = respostas[`dia_${num}`];
                        campo.disabled = true;
                    }
                }
            }
        }
    });
}

async function salvarDia(num) {
    const btn = document.getElementById(`btn-${num}`);

    if (btn) {
        btn.innerText = "Salvando...";
    }

    let valor;

    if (num === 2) {
        valor = {
            sentia: document.getElementById('dia-2-sentia').value,
            queria: document.getElementById('dia-2-queria').value
        };
    } else {
        valor = document.getElementById(`dia-${num}`).value;
    }

    if (!valor || (num === 2 && (!valor.sentia || !valor.queria))) {
        alert("Por favor, preencha o campo antes de salvar.");

        if (btn) {
            btn.innerText = "Salvar Resposta";
        }

        return;
    }

    let respostasAtuais = pacienteData?.respostas_7dias || {};

    if (typeof respostasAtuais === "string") {
        try {
            respostasAtuais = JSON.parse(respostasAtuais);
        } catch {
            respostasAtuais = {};
        }
    }

    const novasRespostas = {
        ...respostasAtuais,
        [`dia_${num}`]: valor
    };

    const { error } = await _supabase
        .from('pacientes')
        .update({
            respostas_7dias: novasRespostas
        })
        .eq('id', idCliente);

    if (error) {
        console.error(error);
        alert("Erro ao salvar.");

        if (btn) {
            btn.innerText = "Tentar novamente";
        }

        return;
    }

            alert("Sua reflexão foi salva com sucesso.");
            location.reload();
    }

        document.addEventListener('DOMContentLoaded', carregarExercicio7Dias);

        function deslogar() {
            localStorage.removeItem('paciente_id');
            window.location.href = "index.html";
        }

        carregarDadosPaciente();