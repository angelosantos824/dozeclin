export function showMessage(container, message, type = 'info') {
  if (!container) return;
  container.textContent = message;
  container.className = `message message-${type}`;
  container.setAttribute('role', type === 'error' ? 'alert' : 'status');
  container.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  container.hidden = false;
}

export function clearMessage(container) {
  if (!container) return;
  container.textContent = '';
  container.removeAttribute('role');
  container.hidden = true;
}
