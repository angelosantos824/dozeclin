/* ==========================================
   GESTÃO ADMINISTRATIVA SQL - MICHELLY SANTOS
   ========================================== */

// 1. CARREGAR PACIENTES DO SUPABASE
// 1. Função para carregar a tabela do Supabase
async function renderTable() {
    const tbody = document.getElementById('tabelaClientes');
    if (!tbody) return;

    const { data: pacientes, error } = await _supabase
        .from('pacientes')
        .select('*')
        .order('nome', { ascending: true });

    if (error) {
        console.error("Erro ao carregar tabela:", error);
        return;
    }

    if (pacientes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#999;">Nenhum paciente cadastrado no banco.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    pacientes.forEach((p) => {
        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid #f4f1ea;">
                <td style="padding: 15px;"><strong>#${p.id}</strong></td>
                <td style="padding: 15px;">${p.nome}</td>
                <td style="padding: 15px;">${p.email}</td>
                <td style="padding: 15px;">
                    <button onclick="excluirPaciente('${p.id}')" style="background:#ff9999; border:none; padding:8px 15px; border-radius:6px; cursor:pointer; color:white;">Excluir</button>
                </td>
            </tr>
        `;
    });
}

// 2. Função para Salvar
async function salvarNovoPacienteSQL() {
    const nome = document.getElementById('nomeInput').value.trim();
    const email = document.getElementById('emailInput').value.trim();

    if (!nome || !email) {
        alert("Por favor, preencha o Nome e o E-mail!");
        return;
    }

    const { data: sessionData, error: sessionError } = await _supabase.auth.getSession();

    if (sessionError || !sessionData.session || !sessionData.session.user) {
        alert("Sessão expirada. Faça login novamente.");
        window.location.replace("index.html");
        return;
    }

    const user = sessionData.session.user;

    // Gerar ID de 4 dígitos (Senha)
    const novoId = Math.floor(1000 + Math.random() * 9000).toString();

    const { error } = await _supabase
        .from('pacientes')
        .insert([{
            id: novoId,
            nome: nome,
            email: email,
            senha_acesso: novoId,
            financeiro: [],
            notas: "",
            user_id: user.id
        }]);

    if (error) {
        alert("Erro ao salvar: " + error.message);
    } else {
        alert("✅ Paciente cadastrado!\nSenha de acesso: " + novoId);
        document.getElementById('nomeInput').value = '';
        document.getElementById('emailInput').value = '';
        renderTable();
    }
}

// 3. Função para Excluir
async function excluirPaciente(id) {
    if (confirm("Deseja realmente excluir este paciente?")) {
        const { error } = await _supabase.from('pacientes').delete().eq('id', id);
        if (error) alert("Erro ao excluir");
        else renderTable();
    }
}

// Inicializa a tabela quando a página carregar
document.addEventListener('DOMContentLoaded', renderTable);