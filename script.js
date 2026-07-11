/* ==========================================
   SISTEMA GERAL - MICHELLY SANTOS
========================================== */

/* LOGIN */
async function executarLogin(event) {
    if (event) event.preventDefault();

    const userField = document.getElementById('loginUser');
    const passField = document.getElementById('loginPass');

    if (!userField || !passField) {
        alert("Campos de login não encontrados.");
        return;
    }

    const user = userField.value.trim();
    const pass = passField.value.trim();

    if (!user || !pass) {
        alert("Preencha e-mail e senha.");
        return;
    }

    try {
        const { data: authData, error: authError } = await _supabase.auth.signInWithPassword({
            email: user,
            password: pass
        });

        if (!authError && authData.user) {
            window.location.replace("adm.html");
            return;
        }

        const { data: paciente, error: dbError } = await _supabase
            .from('pacientes')
            .select('*')
            .eq('email', user)
            .single();

        if (!dbError && paciente && paciente.senha_acesso === pass) {
            window.location.replace("area-cliente.html?id=" + paciente.id);
            return;
        }

        alert("Acesso negado. Verifique e-mail e senha.");
    } catch (err) {
        console.error("Erro no login:", err);
        alert("Erro técnico ao conectar.");
    }
}

/* MODAL LOGIN */
function abrirLogin() {
    const modal = document.getElementById('loginModal');
    if (modal) modal.style.display = "flex";
}

function fecharLogin() {
    const modal = document.getElementById('loginModal');
    if (modal) modal.style.display = "none";
}

/* MODAL NOTÍCIA */
function abrirNoticia(titulo, texto) {
    const modal = document.getElementById('noticiaModal');
    const tituloEl = document.getElementById('noticiaTitulo');
    const textoEl = document.getElementById('noticiaTexto');

    if (!modal || !tituloEl || !textoEl) return;

    tituloEl.innerText = titulo;
    textoEl.innerText = texto;
    modal.style.display = "flex";
}

function fecharNoticia() {
    const modal = document.getElementById('noticiaModal');
    if (modal) modal.style.display = "none";
}

/* POPUP */
function fecharPopup() {
    const popup = document.getElementById('popupCta');
    if (popup) {
        popup.style.display = "none";
        sessionStorage.setItem('popupExibido', 'true');
    }
}

/* INICIALIZAÇÃO */
document.addEventListener('DOMContentLoaded', () => {
    const loginHeader = document.getElementById('openLogin');
    const loginFooter = document.getElementById('openLoginFooter');
    const closeLogin = document.getElementById('closeLogin');
    const popup = document.getElementById('popupCta');

    if (loginHeader) {
        loginHeader.addEventListener('click', (e) => {
            e.preventDefault();
            abrirLogin();
        });
    }

    if (loginFooter) {
        loginFooter.addEventListener('click', (e) => {
            e.preventDefault();
            abrirLogin();
        });
    }

    if (closeLogin) {
        closeLogin.addEventListener('click', fecharLogin);
    }

    document.querySelectorAll('.reveal').forEach((el) => {
        el.classList.add('visible');
    });

    if (popup && !sessionStorage.getItem('popupExibido')) {
        setTimeout(() => {
            popup.style.display = "flex";
        }, 3000);
    }

    window.addEventListener('click', (event) => {
        const loginModal = document.getElementById('loginModal');
        const noticiaModal = document.getElementById('noticiaModal');
        const popupCta = document.getElementById('popupCta');

        if (event.target === loginModal) fecharLogin();
        if (event.target === noticiaModal) fecharNoticia();
        if (event.target === popupCta) fecharPopup();
    });
});

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.reveal').forEach((el) => {
        el.classList.add('visible');
    });
});

