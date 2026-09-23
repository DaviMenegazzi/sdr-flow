// pt-BR formatting helpers shared by every screen, so dates, phones and numbers read the same everywhere.

const LOCALE = 'pt-BR';

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const weekdayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
const longDayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

export function formatTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? timeFmt.format(date) : '—';
}

export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? dateFmt.format(date) : '—';
}

export function formatShortDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? shortDateFmt.format(date) : '—';
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? dateTimeFmt.format(date) : '—';
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Compact timestamp for lists: "14:31" today, "ontem", weekday this week, else "12/09". */
export function formatListTimestamp(value: string | number | Date | null | undefined, now = new Date()): string {
  const date = toDate(value);
  if (!date) return '';
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return timeFmt.format(date);
  if (days === 1) return 'ontem';
  if (days < 7) return weekdayFmt.format(date).replace('.', '');
  return shortDateFmt.format(date);
}

/** Day separator label for message threads: "Hoje", "Ontem", "sexta-feira, 12 de setembro". */
export function formatDayLabel(value: string | number | Date | null | undefined, now = new Date()): string {
  const date = toDate(value);
  if (!date) return '';
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  const label = longDayFmt.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function isSameDay(a: string | number | Date, b: string | number | Date): boolean {
  const da = toDate(a);
  const db = toDate(b);
  return Boolean(da && db && startOfDay(da) === startOfDay(db));
}

const relativeFmt = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/** "agora", "há 5 min", "há 3 h", "ontem", "há 4 meses". */
export function formatRelative(value: string | number | Date | null | undefined, now = new Date()): string {
  const date = toDate(value);
  if (!date) return '—';
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'agora';
  if (abs < 3600) return seconds < 0 ? `há ${Math.round(abs / 60)} min` : `em ${Math.round(abs / 60)} min`;
  if (abs < 86_400) return seconds < 0 ? `há ${Math.round(abs / 3600)} h` : `em ${Math.round(abs / 3600)} h`;
  const days = Math.round(seconds / 86_400);
  if (Math.abs(days) < 30) return relativeFmt.format(days, 'day');
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return relativeFmt.format(months, 'month');
  return relativeFmt.format(Math.round(days / 365), 'year');
}

/** Brazilian phone numbers as "+55 55 99100-0000"; anything else is returned untouched. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  const withCountry = digits.startsWith('55') && digits.length >= 12 ? digits : null;
  if (!withCountry) return value;
  const ddd = withCountry.slice(2, 4);
  const rest = withCountry.slice(4);
  if (rest.length === 9) return `+55 ${ddd} ${rest.slice(0, 5)}-${rest.slice(5)}`;
  if (rest.length === 8) return `+55 ${ddd} ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `+55 ${ddd} ${rest}`;
}

const intFmt = new Intl.NumberFormat(LOCALE);
export function formatNumber(value: number | null | undefined): string {
  return intFmt.format(value ?? 0);
}

const compactFmt = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
export function formatCompact(value: number | null | undefined): string {
  return compactFmt.format(value ?? 0);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return `${new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value ?? 0)}%`;
}

/** Costs are billed in USD; tiny amounts keep more decimals so they don't read as zero. */
export function formatUsd(value: number | null | undefined): string {
  const amount = value ?? 0;
  const digits = amount > 0 && amount < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** Seconds as "74 s" → "1 min 14 s" → "2 h 5 min". */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const secs = Math.max(0, Math.round(totalSeconds ?? 0));
  if (secs < 60) return `${secs} s`;
  const minutes = Math.floor(secs / 60);
  const rest = secs % 60;
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours} h ${mins} min` : `${hours} h`;
}

/** Milliseconds for execution steps: "12 ms", "1,2 s". */
export function formatMs(ms: number | null | undefined): string {
  const value = ms ?? 0;
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(value / 1000)} s`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}
