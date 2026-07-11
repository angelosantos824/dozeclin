import { DEFAULT_LOCALE } from '../config/constants.js';

export function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(DEFAULT_LOCALE).format(new Date(value));
}

export function formatCurrency(value, currency = 'EUR') {
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: 'currency',
    currency
  }).format(Number(value || 0));
}
