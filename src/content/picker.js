/**
 * Latchkey: element picker.
 *
 * Injected by the options page (after lib/core.js) into the page a rule targets. Moving the
 * mouse highlights the element under it and previews its selector; a click sends that
 * selector back through runtime.sendMessage({ type: 'picked', selector }); Esc sends null.
 */
/* global LatchkeyCore */
(function () {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  const AL = globalThis.LatchkeyCore;

  // A second Pick while one is running restarts it.
  if (window.__latchkeyPicker) window.__latchkeyPicker.stop();

  const CSS = `
    :host { all: initial; }
    .box, .tip { position: fixed; z-index: 2147483647; pointer-events: none; box-sizing: border-box; }
    .box { display: none; border: 2px solid #7c3aed; border-radius: 3px; background: rgba(124, 58, 237, .12); }
    .tip { left: 50%; top: 12px; transform: translateX(-50%); max-width: calc(100vw - 32px); display: flex; gap: 10px;
           align-items: baseline; padding: 8px 12px; border-radius: 10px; background: #18181b; color: #fafafa;
           font: 12px/1.4 "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
           box-shadow: 0 8px 24px -8px rgba(0, 0, 0, .5); }
    .tip b { font: 600 12px/1.4 ui-monospace, "Geist Mono", Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tip span { color: #a1a1aa; white-space: nowrap; }
  `;

  const make = (tag, cls) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  };

  const host = make('div');
  host.setAttribute('data-latchkey-picker', '');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = make('style');
  style.textContent = CSS;
  const box = make('div', 'box');
  const tip = make('div', 'tip');
  const preview = make('b');
  preview.textContent = 'Latchkey: pick an element';
  const hint = make('span');
  hint.textContent = 'Click to choose · Esc to cancel';
  tip.append(preview, hint);
  shadow.append(style, box, tip);
  document.documentElement.appendChild(host);

  // Page elements keep their own cursors, so the crosshair has to be a page-level rule.
  const cursor = make('style');
  cursor.textContent = '* { cursor: crosshair !important; }';
  document.documentElement.appendChild(cursor);

  let current = null;

  function place(el) {
    const r = el.getBoundingClientRect();
    box.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  }

  function move(e) {
    const el = e.target;
    if (!(el instanceof Element) || el === document.documentElement || el === document.body) return;
    if (el === current) return;
    current = el;
    place(el);
    preview.textContent = AL.uniqueSelector(el);
  }

  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function finish(selector) {
    stop();
    try {
      api.runtime.sendMessage({ type: 'picked', selector }).catch(() => {});
    } catch (err) {
      /* extension reloaded; ignore */
    }
  }

  function click(e) {
    swallow(e);
    finish(e.target instanceof Element ? AL.uniqueSelector(e.target) : null);
  }

  function key(e) {
    if (e.key !== 'Escape') return;
    swallow(e);
    finish(null);
  }

  // Capture on window: runs before the page's and Latchkey's own document listeners.
  const listeners = [
    ['mousemove', move],
    ['mousedown', swallow],
    ['mouseup', swallow],
    ['pointerdown', swallow],
    ['pointerup', swallow],
    ['click', click],
    ['keydown', key],
    ['scroll', () => current && place(current)],
  ];
  for (const [type, fn] of listeners) window.addEventListener(type, fn, true);

  function stop() {
    for (const [type, fn] of listeners) window.removeEventListener(type, fn, true);
    host.remove();
    cursor.remove();
    window.__latchkeyPicker = null;
  }

  window.__latchkeyPicker = { stop };
})();
