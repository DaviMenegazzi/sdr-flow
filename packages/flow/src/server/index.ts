export { OpenAIProvider, type OpenAIConfig } from './openai.js';
export { WhatsAppMessagingService, type MessagingConnection, type ResolveConnection } from './messaging.js';
import { OpenAIProvider } from './openai.js';
import { WhatsAppMessagingService, type ResolveConnection } from './messaging.js';
import { GoogleCalendarClient, parseGoogleCalendarCredentials } from '../services/google-calendar.js';

export interface RuntimeConfig { openaiApiKey?: string; openaiModel?: string; openaiTimeoutMs?: number; whatsappSendEnabled?: boolean; metaGraphVersion?: string; googleCalendarCredentialsJson?: string }
export function runtimeConfigFromEnv(env: Record<string, string | undefined>): RuntimeConfig {
  const timeout = Number(env.OPENAI_TIMEOUT_MS || 60000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 180000) throw new Error('OPENAI_TIMEOUT_MS deve estar entre 1000 e 180000.');
  return { openaiApiKey: env.OPENAI_API_KEY, openaiModel: env.OPENAI_MODEL || 'gpt-4.1-mini', openaiTimeoutMs: timeout,
    whatsappSendEnabled: env.WHATSAPP_SEND_ENABLED === 'true', metaGraphVersion: env.META_GRAPH_VERSION || 'v21.0',
    googleCalendarCredentialsJson: env.GOOGLE_CALENDAR_CREDENTIALS_JSON };
}
export function createCalendarProvider(config: RuntimeConfig) {
  const calendarCredentials = config.googleCalendarCredentialsJson?.trim()
    ? parseGoogleCalendarCredentials(config.googleCalendarCredentialsJson)
    : null;
  return calendarCredentials ? new GoogleCalendarClient(globalThis.fetch, calendarCredentials) : undefined;
}
export function createRuntimeProviders(config: RuntimeConfig, resolve: ResolveConnection) {
  return { llm: new OpenAIProvider({ apiKey: config.openaiApiKey, model: config.openaiModel, timeoutMs: config.openaiTimeoutMs }),
    messaging: new WhatsAppMessagingService({ enabled: config.whatsappSendEnabled, graphVersion: config.metaGraphVersion }, resolve),
    calendar: createCalendarProvider(config) };
}
