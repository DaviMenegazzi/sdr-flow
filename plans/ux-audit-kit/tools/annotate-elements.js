/**
 * Numera e mede os elementos interativos de uma tela.
 *
 * Uso com Playwright:
 *   const inspect = require('./annotate-elements.js');
 *   const data = await page.evaluate(inspect, 'main');       // seletor da raiz
 *   await page.screenshot({ path: 'tela.png', fullPage: true }); // captura já numerada
 *   await page.evaluate(() => document.querySelectorAll('.__ann').forEach(n => n.remove()));
 *
 * Devolve, por elemento: número, tag, rótulo, se é só ícone, se é controle nativo,
 * altura, largura, raio da borda, fonte, cores. Some esses dados de todas as telas
 * para medir inconsistências (quantas alturas de botão, quantos raios, quantos
 * selects nativos etc.).
 */
module.exports = function inspect(rootSel) {
  document.querySelectorAll('.__ann').forEach(n => n.remove());
  const root = document.querySelector(rootSel) || document.body;
  const els = [...root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=menuitem]')]
    .filter(e => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0;
    });
  return els.map((e, i) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    const label = (e.innerText || e.value || e.placeholder || e.getAttribute('aria-label') || e.title || '')
      .trim().replace(/\s+/g, ' ').slice(0, 48);
    const n = i + 1;
    const box = document.createElement('div');
    box.className = '__ann';
    Object.assign(box.style, {
      position: 'absolute', left: r.left + scrollX + 'px', top: r.top + scrollY + 'px', width: r.width + 'px', height: r.height + 'px',
      outline: '2px solid #ff2d95', outlineOffset: '1px', pointerEvents: 'none', zIndex: 99999, borderRadius: '4px',
    });
    const tag = document.createElement('div');
    tag.className = '__ann';
    tag.textContent = n;
    Object.assign(tag.style, {
      position: 'absolute', left: r.left + scrollX - 8 + 'px', top: r.top + scrollY - 9 + 'px', background: '#ff2d95', color: '#fff',
      font: '700 10px/14px system-ui', padding: '0 4px', borderRadius: '7px', zIndex: 100000, pointerEvents: 'none', minWidth: '14px', textAlign: 'center',
    });
    document.body.append(box, tag);
    return {
      n,
      tag: e.tagName.toLowerCase(),
      type: e.type || e.getAttribute('role') || '',
      label,
      iconOnly: !(e.innerText || '').trim() && e.tagName === 'BUTTON',
      native: e.tagName === 'SELECT' || (e.tagName === 'INPUT' && ['checkbox', 'radio', 'date', 'range'].includes(e.type)),
      h: Math.round(r.height), w: Math.round(r.width), x: Math.round(r.left), y: Math.round(r.top + scrollY),
      radius: cs.borderTopLeftRadius, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily.split(',')[0],
      bg: cs.backgroundColor, color: cs.color, border: cs.borderTopWidth + ' ' + cs.borderTopColor,
      hasTitleTooltip: e.hasAttribute('title'),
    };
  });
};
