import { describe, it, expect } from 'vitest';
import { MESSAGE_TYPE_LABELS, messagePreview, isNormalizedMessageType } from '../packages/shared/src/index.js';

describe('message-types (plan item 6: media markers, never an empty bubble)', () => {
  it('returns plain content for text messages, defaulting to text when the type is missing', () => {
    expect(messagePreview('text', 'Olá!')).toBe('Olá!');
    expect(messagePreview(null, 'Olá!')).toBe('Olá!');
    expect(messagePreview(undefined, 'Olá!')).toBe('Olá!');
  });

  it('returns the marker alone for media with no caption', () => {
    expect(messagePreview('audio', '')).toBe('🎤 Áudio');
    expect(messagePreview('image', null)).toBe('🖼️ Imagem');
    expect(messagePreview('sticker', undefined)).toBe('🏷️ Figurinha');
    expect(messagePreview('video', '')).toBe('🎥 Vídeo');
    expect(messagePreview('document', '')).toBe('📄 Documento');
    expect(messagePreview('location', '')).toBe('📍 Localização');
    expect(messagePreview('contact', '')).toBe('👤 Contato');
    expect(messagePreview('unknown', '')).toBe('📎 Mensagem não suportada');
  });

  it('combines marker and caption when the media also carries text', () => {
    expect(messagePreview('image', 'Olha só')).toBe(`${MESSAGE_TYPE_LABELS.image} — Olha só`);
  });

  it('never returns an empty string for a media type with no caption', () => {
    for (const type of Object.keys(MESSAGE_TYPE_LABELS)) {
      expect(messagePreview(type, '').length).toBeGreaterThan(0);
      expect(messagePreview(type, null).length).toBeGreaterThan(0);
    }
  });

  it('treats an unrecognized type string as plain text rather than throwing', () => {
    expect(messagePreview('reaction', 'hmm')).toBe('hmm');
  });

  it('isNormalizedMessageType recognizes exactly the known set', () => {
    expect(isNormalizedMessageType('sticker')).toBe(true);
    expect(isNormalizedMessageType('text')).toBe(true);
    expect(isNormalizedMessageType('reaction')).toBe(false);
    expect(isNormalizedMessageType(42)).toBe(false);
  });
});
