import { requirePlatformSuperAdmin } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';
import { appendEmptyRow, clearChildren, createCell } from '../ui/table.js';
import { showMessage } from '../ui/messages.js';
import { listPlatformProducts } from '../services/platform.service.js';

const PRODUCT_STATUS_LABELS = {
  active: 'Ativo',
  inactive: 'Inativo',
  development: 'Em desenvolvimento'
};

const profile = await requirePlatformSuperAdmin();
let products = [];

if (profile) {
  mountLayout(profile);
  await loadProducts();
}

async function loadProducts() {
  const message = document.querySelector('[data-page-message]');
  showMessage(message, 'A carregar produtos...', 'info');

  try {
    products = await listPlatformProducts();
    renderMetrics();
    renderProducts();
    showMessage(message, `${products.length} produto(s) registados.`, 'success');
  } catch (error) {
    console.error(error);
    showMessage(message, 'Nao foi possivel carregar os produtos da plataforma.', 'error');
  }
}

function renderMetrics() {
  setMetric('products', products.length);
  setMetric('active', products.filter((product) => product.status === 'active').length);
  setMetric('development', products.filter((product) => product.status === 'development').length);
  setMetric('access', profile.product_access?.length || 0);
}

function setMetric(name, value) {
  const element = document.querySelector(`[data-metric-${name}]`);
  if (element) element.textContent = value;
}

function renderProducts() {
  const tbody = document.querySelector('[data-products-table]');
  clearChildren(tbody);

  if (!products.length) {
    appendEmptyRow(tbody, 5, 'Nenhum produto registado.');
    return;
  }

  products.forEach((product) => {
    const row = document.createElement('tr');
    row.append(
      createProductCell(product),
      createCell(product.schema_name),
      createStatusCell(product.status),
      createAccessCell(product),
      createShortcutCell(product)
    );
    tbody.appendChild(row);
  });
}

function createProductCell(product) {
  const cell = document.createElement('td');
  const name = document.createElement('strong');
  name.textContent = product.name;
  const description = document.createElement('small');
  description.className = 'muted';
  description.textContent = product.description || product.code;
  cell.append(name, description);
  return cell;
}

function createStatusCell(status) {
  const cell = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `status-badge status-${status}`;
  badge.textContent = PRODUCT_STATUS_LABELS[status] || status;
  cell.appendChild(badge);
  return cell;
}

function createAccessCell(product) {
  const cell = document.createElement('td');
  cell.textContent = profile.product_access?.includes(product.code) ? 'Concedido' : 'Sem acesso';
  return cell;
}

function createShortcutCell(product) {
  const cell = document.createElement('td');

  if (product.code !== 'dozeclin' || !profile.product_access?.includes('dozeclin')) {
    cell.textContent = '-';
    return cell;
  }

  const link = document.createElement('a');
  link.className = 'icon-button';
  link.href = 'clinicas.html';
  link.textContent = 'Clinicas';
  cell.appendChild(link);
  return cell;
}
