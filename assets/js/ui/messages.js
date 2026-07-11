export function showMessage(container, message, type = 'info') {
  if (!container) return;
  container.textContent = message;
  container.className = `message message-${type}`;
  container.hidden = false;
}

export function clearMessage(container) {
  if (!container) return;
  container.textContent = '';
  container.hidden = true;
}
