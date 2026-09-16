// Normalized WhatsApp message types shared between the Evolution webhook parser
// (apps/api/src/webhook.ts) and the Inbox UI (apps/web/src/inbox/InboxPage.tsx), so a sticker,
// audio note or any other non-text message always renders as a labeled marker instead of an
// empty bubble or a "Nenhuma mensagem recente." card preview.

export const NORMALIZED_MESSAGE_TYPES = [
  'text',
  'audio',
  'image',
  'sticker',
  'video',
  'document',
  'contact',
  'location',
  'unknown',
] as const;

export type NormalizedMessageType = (typeof NORMALIZED_MESSAGE_TYPES)[number];

export type MediaMessageType = Exclude<NormalizedMessageType, 'text'>;

export const MESSAGE_TYPE_LABELS: Record<MediaMessageType, string> = {
  audio: '🎤 Áudio',
  image: '🖼️ Imagem',
  sticker: '🏷️ Figurinha',
  video: '🎥 Vídeo',
  document: '📄 Documento',
  location: '📍 Localização',
  contact: '👤 Contato',
  unknown: '📎 Mensagem não suportada',
};

export function isNormalizedMessageType(value: unknown): value is NormalizedMessageType {
  return typeof value === 'string' && (NORMALIZED_MESSAGE_TYPES as readonly string[]).includes(value);
}

/**
 * Inbox display text for a message: plain content for text messages, the type's marker alone for
 * media with no caption, or "marker — caption" when the media also carries text.
 */
export function messagePreview(messageType: string | null | undefined, content: string | null | undefined): string {
  const trimmedContent = content?.trim() || '';
  const type = messageType || 'text';
  if (!isNormalizedMessageType(type) || type === 'text') return trimmedContent;

  const marker = MESSAGE_TYPE_LABELS[type as MediaMessageType];
  return trimmedContent ? `${marker} — ${trimmedContent}` : marker;
}
