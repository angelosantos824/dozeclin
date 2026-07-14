export function openModal(modal) {
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  modal.querySelector('input, select, textarea, button')?.focus();
}

export function closeModal(modal) {
  if (!modal) return;
  modal.hidden = true;
  if (!document.querySelector('.modal:not([hidden])')) {
    document.body.classList.remove('modal-open');
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeModal(document.querySelector('.modal:not([hidden])'));
});
