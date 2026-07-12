import { signOut } from '../auth/auth.js';
import { APP_NAME } from '../config/constants.js';

const NAV_ITEMS = [
  ['plataforma.html', 'Painel da Plataforma', ['super_admin'], 'platform'],
  ['dashboard.html', 'Painel'],
  ['clinicas.html', 'Clinicas', ['super_admin'], 'platform'],
  ['pacientes.html', 'Pacientes'],
  ['agenda.html', 'Agenda'],
  ['anamnese.html', 'Anamnese'],
  ['tarefas.html', 'Tarefas'],
  ['financeiro.html', 'Financeiro'],
  ['profissionais.html', 'Profissionais'],
  ['configuracoes.html', 'Configuracoes']
];

export function mountLayout(profile) {
  const shell = document.querySelector('[data-app-shell]');
  const sidebar = document.querySelector('[data-sidebar]');
  const topbar = document.querySelector('[data-topbar]');
  const mobileToggle = document.querySelector('[data-menu-toggle]');

  if (!shell || !sidebar || !topbar) return;

  buildSidebar(sidebar, profile);
  buildTopbar(topbar, profile);

  mobileToggle?.addEventListener('click', () => {
    shell.classList.toggle('sidebar-open');
  });
}

function buildSidebar(sidebar, profile) {
  const brand = document.createElement('a');
  brand.href = profile?.is_platform_user ? 'plataforma.html' : 'dashboard.html';
  brand.className = 'brand';

  const mark = document.createElement('span');
  mark.className = 'brand-mark';
  mark.textContent = 'D';

  const text = document.createElement('span');
  text.textContent = APP_NAME;

  brand.append(mark, text);
  sidebar.appendChild(brand);

  const nav = document.createElement('nav');
  nav.className = 'side-nav';

  const currentPage = window.location.pathname.split('/').pop();
  NAV_ITEMS.forEach(([href, label, roles, scope]) => {
    if (scope === 'platform' && !profile?.is_platform_user) return;
    if (!scope && profile?.is_platform_user) return;
    if (roles && !roles.includes(profile?.role)) return;
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    if (href === currentPage) link.className = 'active';
    nav.appendChild(link);
  });

  sidebar.appendChild(nav);

  const ecosystem = document.createElement('p');
  ecosystem.className = 'ecosystem';
  ecosystem.textContent = 'Ecossistema DOZEDEV';
  sidebar.appendChild(ecosystem);
}

function buildTopbar(topbar, profile) {
  const clinicBox = document.createElement('div');
  const clinicName = document.createElement('strong');
  clinicName.textContent = profile?.is_platform_user
    ? 'DOZEDEV Platform'
    : profile?.clinics?.name || 'Clinica';
  const userName = document.createElement('span');
  userName.textContent = profile?.full_name || profile?.email || 'Utilizador';
  clinicBox.append(clinicName, userName);

  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'button button-secondary';
  logout.textContent = 'Sair';
  logout.addEventListener('click', async () => {
    await signOut();
    window.location.replace('login.html');
  });

  topbar.append(clinicBox, logout);
}
