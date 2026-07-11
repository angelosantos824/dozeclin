export function openModal(modal) {
  if (!modal) return;
  modal.hidden = false;
  modal.querySelector('input, select, textarea, button')?.focus();
}

export function closeModal(modal) {
  if (!modal) return;
  modal.hidden = true;
}
