export function clearChildren(element) {
  while (element?.firstChild) {
    element.removeChild(element.firstChild);
  }
}

export function createCell(text, tag = 'td') {
  const cell = document.createElement(tag);
  cell.textContent = text ?? '-';
  return cell;
}

export function appendEmptyRow(tbody, columns, message) {
  const row = document.createElement('tr');
  const cell = createCell(message);
  cell.colSpan = columns;
  cell.className = 'empty-row';
  row.appendChild(cell);
  tbody.appendChild(row);
}
