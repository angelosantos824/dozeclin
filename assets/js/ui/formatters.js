import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from '../config/constants.js';

export function formatDate(value) {
  if (!value) return '-';
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return '-';

  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: DEFAULT_TIMEZONE
  }).format(new Date(year, month - 1, day));
}

export function formatTime(value) {
  if (!value) return '-';
  return String(value).slice(0, 5);
}

export function todayDateInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateTimeLocalInput(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function formatDateTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: DEFAULT_TIMEZONE
  }).format(new Date(value));
}

export function formatDateTimeInTimezone(value, timezone = DEFAULT_TIMEZONE) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone || DEFAULT_TIMEZONE
  }).format(new Date(value));
}

export function formatTimeInTimezone(value, timezone = DEFAULT_TIMEZONE) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone || DEFAULT_TIMEZONE
  }).format(new Date(value));
}

export function toLocalDateInput(value, timezone = DEFAULT_TIMEZONE) {
  if (!value) return todayDateInput();
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone || DEFAULT_TIMEZONE
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function toLocalTimeInput(value, timezone = DEFAULT_TIMEZONE) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone || DEFAULT_TIMEZONE
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('hour')}:${get('minute')}`;
}

export function formatCurrency(value, currency = 'EUR') {
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: 'currency',
    currency
  }).format(Number(value || 0));
}
