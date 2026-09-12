import { describe, expect, it } from 'vitest';
import { splitSmartMessage } from '../packages/flow/src/services/sales-flow.js';

describe('splitSmartMessage emoji handling and bubble boundaries', () => {
  it('never isolates an emoji into its own bubble when following a sentence (debugger log case)', () => {
    const text = 'Sim, o Cartão Premium oferece descontos em procedimentos odontológicos para você e seus dependentes, facilitando o cuidado com a saúde bucal. 😊\n\nGostaria de saber quais tipos de serviços odontológicos você mais precisa para te ajudar melhor?';
    const bubbles = splitSmartMessage(text, 3, 180);

    expect(bubbles.length).toBeGreaterThanOrEqual(1);
    expect(bubbles.length).toBeLessThanOrEqual(3);

    // No bubble should be just an emoji or non-alphanumeric symbols
    for (const bubble of bubbles) {
      expect(/[\p{L}\p{N}]/u.test(bubble)).toBe(true);
      expect(bubble).not.toBe('😊');
    }

    // The emoji must remain attached to the first bubble
    expect(bubbles[0]).toContain('😊');
    expect(bubbles[0]).toContain('saúde bucal.');
  });

  it('handles emoji on its own line without turning it into an isolated bubble', () => {
    const text = 'Temos várias opções de cartões de desconto em saúde para você e sua família.\n\n😊\n\nPosso te explicar como funcionam as consultas com preços reduzidos?';
    const bubbles = splitSmartMessage(text, 3, 120);

    for (const bubble of bubbles) {
      expect(/[\p{L}\p{N}]/u.test(bubble)).toBe(true);
      expect(bubble).not.toBe('😊');
    }
  });

  it('keeps leading emojis attached to the following content', () => {
    const text = '😊 Olá! Tudo bem? Podemos te ajudar com informações sobre os benefícios do Vida Card.';
    const bubbles = splitSmartMessage(text, 3, 120);

    expect(bubbles.length).toBe(1);
    expect(bubbles[0]).toContain('😊 Olá!');
  });

  it('handles punctuation and emoji clusters correctly without breaking words', () => {
    const text = 'O Vida Card oferece descontos em exames e consultas! 💚 🩺\n\nSe você quiser, posso verificar os médicos disponíveis na sua região.';
    const bubbles = splitSmartMessage(text, 3, 120);

    for (const bubble of bubbles) {
      expect(/[\p{L}\p{N}]/u.test(bubble)).toBe(true);
    }
    expect(bubbles[0]).toContain('💚 🩺');
  });
});
