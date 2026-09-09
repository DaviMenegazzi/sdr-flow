export interface GoogleCalendarCredentials {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  access_token?: string;
}

export interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
}

type GoogleErrorPayload = { error?: { message?: string } | string };

function errorMessage(payload: GoogleErrorPayload | null, status: number): string {
  if (typeof payload?.error === 'string') return payload.error;
  return payload?.error?.message || `Google Calendar: HTTP ${status}`;
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

export class GoogleCalendarClient {
  private accessToken = '';

  constructor(
    private readonly fetchFn: typeof globalThis.fetch,
    private readonly credentials: GoogleCalendarCredentials,
  ) {}

  private async resolveAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    if (this.credentials.access_token?.trim()) {
      this.accessToken = this.credentials.access_token.trim();
      return this.accessToken;
    }
    if (!this.credentials.refresh_token?.trim() || !this.credentials.client_id?.trim() || !this.credentials.client_secret?.trim()) {
      throw new Error('Credenciais Google não configuradas. Informe access_token ou client_id, client_secret e refresh_token.');
    }

    const response = await this.fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.credentials.client_id,
        client_secret: this.credentials.client_secret,
        refresh_token: this.credentials.refresh_token,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const payload = await readJson<{ access_token?: string; error?: string }>(response);
    if (!response.ok || !payload?.access_token) {
      throw new Error(typeof payload?.error === 'string' ? payload.error : `Falha ao renovar token Google: HTTP ${response.status}`);
    }
    this.accessToken = payload.access_token;
    return this.accessToken;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T | null> {
    const token = await this.resolveAccessToken();
    const response = await this.fetchFn(`https://www.googleapis.com/calendar/v3${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    if (response.status === 204) return null;
    const payload = await readJson<T & GoogleErrorPayload>(response);
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    return payload;
  }

  async getCalendarName(calendarId: string): Promise<string> {
    const payload = await this.request<{ summary?: string }>(`/calendars/${encodeURIComponent(calendarId)}`);
    return payload?.summary || calendarId;
  }

  async listEvents(calendarId: string, timeMin: string, timeMax: string): Promise<GoogleCalendarEvent[]> {
    const query = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    const payload = await this.request<{ items?: GoogleCalendarEvent[] }>(
      `/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
    );
    return payload?.items || [];
  }

  async createEvent(calendarId: string, event: GoogleCalendarEvent): Promise<GoogleCalendarEvent> {
    const payload = await this.request<GoogleCalendarEvent>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    });
    if (!payload?.id) throw new Error('Google Calendar não retornou o ID do evento criado.');
    return payload;
  }

  async updateEvent(calendarId: string, eventId: string, patch: GoogleCalendarEvent): Promise<GoogleCalendarEvent> {
    const payload = await this.request<GoogleCalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
    if (!payload?.id) throw new Error('Google Calendar não confirmou o reagendamento.');
    return payload;
  }

  async cancelEvent(calendarId: string, eventId: string): Promise<void> {
    await this.request<never>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
    );
  }
}

export function parseGoogleCalendarCredentials(raw: unknown): GoogleCalendarCredentials {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as GoogleCalendarCredentials;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Credenciais Google inválidas — JSON malformado.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Credenciais Google inválidas — informe um objeto JSON.');
  }
  return parsed as GoogleCalendarCredentials;
}

function partsAt(date: Date, timezone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function dateInTimezone(date: Date, timezone: string): string {
  const parts = partsAt(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`Data inválida: ${date}`);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function resolveCalendarDate(value: string, now: Date, timezone: string, daysAhead: number): string {
  const normalized = normalizeText(value);
  const today = dateInTimezone(now, timezone);
  if (!normalized || normalized === 'hoje' || normalized === 'today') return today;
  if (normalized === 'amanha' || normalized === 'tomorrow') return addDays(today, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;

  const weekdayNames: Record<string, number> = {
    domingo: 0, sunday: 0,
    segunda: 1, 'segunda-feira': 1, monday: 1,
    terca: 2, 'terca-feira': 2, tuesday: 2,
    quarta: 3, 'quarta-feira': 3, wednesday: 3,
    quinta: 4, 'quinta-feira': 4, thursday: 4,
    sexta: 5, 'sexta-feira': 5, friday: 5,
    sabado: 6, saturday: 6,
  };
  const desiredWeekday = Object.entries(weekdayNames).find(([name]) => normalized.includes(name))?.[1];
  if (desiredWeekday !== undefined) {
    const currentName = partsAt(now, timezone).weekday || 'Sun';
    const currentWeekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[currentName] ?? 0;
    const delta = (desiredWeekday - currentWeekday + 7) % 7;
    if (delta > daysAhead) throw new Error(`A data solicitada excede o limite de ${daysAhead} dias.`);
    return addDays(today, delta);
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return dateInTimezone(parsed, timezone);
  throw new Error(`Não foi possível resolver a data “${value}”. Use AAAA-MM-DD, hoje, amanhã ou um dia da semana.`);
}

export function zonedDateTime(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (!year || !month || !day || hour === undefined || minute === undefined) {
    throw new Error(`Data ou horário inválido: ${date} ${time}`);
  }
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = new Date(desiredAsUtc);
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = partsAt(candidate, timezone);
    const representedAsUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    candidate = new Date(candidate.getTime() + desiredAsUtc - representedAsUtc);
  }
  return candidate;
}

export function calendarWindow(date: string, period: string, timezone: string): { start: Date; end: Date } {
  const normalized = normalizeText(period);
  let start = '08:00';
  let end = '18:00';
  if (normalized.includes('manha') || normalized.includes('morning')) {
    start = '08:00'; end = '12:00';
  } else if (normalized.includes('tarde') || normalized.includes('afternoon')) {
    start = '12:00'; end = '18:00';
  } else if (normalized.includes('noite') || normalized.includes('evening')) {
    start = '18:00'; end = '22:00';
  }
  return { start: zonedDateTime(date, start, timezone), end: zonedDateTime(date, end, timezone) };
}

function eventInstant(value: { dateTime?: string; date?: string } | undefined, timezone: string, endOfDay = false): Date | null {
  if (value?.dateTime) {
    const parsed = new Date(value.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value?.date) return zonedDateTime(value.date, endOfDay ? '23:59' : '00:00', timezone);
  return null;
}

export interface CalendarSlot {
  label: string;
  start: string;
  end: string;
}

export function availableSlots(
  events: GoogleCalendarEvent[],
  window: { start: Date; end: Date },
  durationMinutes: number,
  timezone: string,
): CalendarSlot[] {
  const durationMs = durationMinutes * 60_000;
  const busy = events.map(event => ({
    start: eventInstant(event.start, timezone),
    end: eventInstant(event.end, timezone, true),
  })).filter((slot): slot is { start: Date; end: Date } => Boolean(slot.start && slot.end));
  const formatter = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const slots: CalendarSlot[] = [];
  for (let cursor = window.start.getTime(); cursor + durationMs <= window.end.getTime(); cursor += durationMs) {
    const end = cursor + durationMs;
    const overlaps = busy.some(slot => cursor < slot.end.getTime() && end > slot.start.getTime());
    if (!overlaps) {
      const startDate = new Date(cursor);
      slots.push({ label: formatter.format(startDate), start: startDate.toISOString(), end: new Date(end).toISOString() });
    }
  }
  return slots;
}

export function endFromStart(start: string, durationMinutes: number): string {
  const parsed = new Date(start);
  if (Number.isNaN(parsed.getTime())) throw new Error('O início precisa estar em formato ISO 8601 com data e horário.');
  return new Date(parsed.getTime() + durationMinutes * 60_000).toISOString();
}
