/**
 * Latchkey: content script.
 *
 * Injected only on origins that an enabled rule targets (see background.js), or
 * on demand through the popup's "Fill now" button (activeTab).
 *
 * Flow: find the first enabled rule whose URL pattern and detection conditions
 * match, locate the fields, fill them, and optionally submit after a short,
 * cancellable delay. A per-tab failed-login counter stops submit loops when the
 * stored credentials are wrong.
 */
/* global LatchkeyCore */
(function () {
  'use strict';

  if (window.__latchkeyLoaded) return;
  window.__latchkeyLoaded = true;

  const api = globalThis.browser || globalThis.chrome;
  const AL = globalThis.LatchkeyCore;
  const LOG = '[Latchkey]';

  let state = null;
  const handled = new WeakSet();
  const lastResult = { ruleId: null, state: 'idle', message: '' };
  let pendingSubmit = null;

  // ---------------------------------------------------------------------------
  // Failed-login guard (sessionStorage is per tab and per origin)
  //
  // Each auto-submit stays pending until Latchkey sees what happened (AL.attemptVerdict):
  // moving past the login clears the failures, the form coming back quickly counts as one.
  // ---------------------------------------------------------------------------

  function attemptsKey(rule) {
    return '__latchkey_attempts:' + rule.id;
  }

  function readAttempts(rule) {
    try {
      const data = JSON.parse(sessionStorage.getItem(attemptsKey(rule)) || 'null');
      if (data && Array.isArray(data.failures)) return data;
    } catch (e) {
      /* unreadable: start over */
    }
    return { pendingAt: null, failures: [] };
  }

  function writeAttempts(rule, data) {
    try {
      sessionStorage.setItem(attemptsKey(rule), JSON.stringify(data));
    } catch (e) {
      /* storage may be blocked; the guard then does not survive a reload */
    }
  }

  function resetAttempts(rule) {
    try {
      sessionStorage.removeItem(attemptsKey(rule));
    } catch (e) {
      /* ignore */
    }
  }

  function recentFailures(rule) {
    const windowMs = state.settings.attemptWindowSec * 1000;
    const now = Date.now();
    return readAttempts(rule).failures.filter((t) => now - t < windowMs);
  }

  function markPending(rule) {
    writeAttempts(rule, { pendingAt: Date.now(), failures: recentFailures(rule) });
  }

  /** Applies a verdict from AL.attemptVerdict to the rule's pending auto-submit. */
  function settle(rule, verdict) {
    const { pendingAt } = readAttempts(rule);
    if (pendingAt == null || verdict === 'pending') return;
    if (verdict === 'success') return resetAttempts(rule);
    const failures = recentFailures(rule);
    if (verdict === 'failure') failures.push(pendingAt);
    writeAttempts(rule, { pendingAt: null, failures });
  }

  function loginFormShown(rule) {
    if (!AL.evaluateDetection(rule, document).ok) return false;
    const fields = AL.findFields(rule, document);
    return Boolean(fields.password || fields.username);
  }

  const goneSince = new Map(); // rule id -> when its login fields were first seen missing on this page

  /** Looks for signs that pending auto-submits succeeded. Returns true while any is still undecided. */
  function checkPending() {
    if (!state) return false;
    let undecided = false;
    const now = Date.now();
    for (const rule of state.rules) {
      const { pendingAt } = readAttempts(rule);
      if (pendingAt == null) continue;
      const shown = loginFormShown(rule);
      // Only start the clock once the page has loaded, so a slow first render doesn't look like success.
      if (shown) goneSince.delete(rule.id);
      else if (!goneSince.has(rule.id) && document.readyState === 'complete') goneSince.set(rule.id, now);
      const verdict = AL.attemptVerdict({
        elapsed: now - pendingAt,
        urlMatches: AL.matchesUrl(rule.urlPattern, location.href),
        formShown: false,
        formGoneFor: goneSince.has(rule.id) ? now - goneSince.get(rule.id) : 0,
      });
      settle(rule, verdict);
      if (verdict === 'pending') undecided = true;
    }
    return undecided;
  }

  let pendingWatch = null;
  function watchPending() {
    if (pendingWatch || !checkPending()) return;
    const stopAt = Date.now() + 20000; // still undecided by then: the next page load decides
    pendingWatch = setInterval(() => {
      if (!checkPending() || Date.now() > stopAt) {
        clearInterval(pendingWatch);
        pendingWatch = null;
      }
    }, 500);
  }

  // ---------------------------------------------------------------------------
  // Toast (Shadow DOM so page styles cannot leak in or out)
  // ---------------------------------------------------------------------------

  const TOAST_CSS = `
    :host { all: initial; }
    .t { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; width: 360px; box-sizing: border-box;
         font: 13px/1.45 "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #09090b;
         background: rgba(255, 255, 255, .92); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
         border: 1px solid #e4e4e7; border-radius: 14px; padding: 12px 12px 13px; overflow: hidden;
         box-shadow: 0 14px 40px -12px rgba(79, 70, 229, .35), 0 2px 6px rgba(9, 9, 11, .06);
         display: flex; gap: 11px; align-items: center; animation: in .45s cubic-bezier(.34, 1.56, .64, 1); }
    @keyframes in { from { opacity: 0; transform: translateY(16px) scale(.94); } }
    @keyframes pan { from { background-position: 0% 50%; } to { background-position: 100% 50%; } }
    @keyframes drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    .grad { background-image: linear-gradient(120deg, #2563eb, #7c3aed 50%, #db2777); background-size: 200% 100%;
            animation: pan 3s ease-in-out infinite alternate; }
    .logo { width: 28px; height: 28px; border-radius: 50%; flex: none; box-shadow: 0 2px 8px -2px rgba(124, 58, 237, .5); }
    .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; transform-origin: left; }
    .body { flex: 1; min-width: 0; } .title { font-weight: 600; letter-spacing: -.01em;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { color: #71717a; font-variant-numeric: tabular-nums; } .sub b { color: #3f3f46; font-weight: 600; }
    .warn { border-color: #fcd34d; } .warn .title { color: #d97706; }
    button { font: inherit; font-weight: 500; border: 1px solid #e4e4e7; background: #fff; color: #09090b;
             border-radius: 8px; padding: 5px 10px; cursor: pointer; white-space: nowrap; display: inline-flex;
             align-items: center; gap: 6px; transition: transform .15s, background .15s; }
    button:hover { background: #f4f4f5; } button:active { transform: scale(.96); }
    kbd { font-family: inherit; font-size: 11px; font-weight: 500; line-height: 1; background: #f4f4f5; color: #71717a;
          border-radius: 4px; padding: 3px 5px; margin-right: -4px; }
    @media (prefers-color-scheme: dark) {
      .t { background: rgba(24, 24, 27, .9); color: #fafafa; border-color: #27272a;
           box-shadow: 0 14px 40px -12px rgba(124, 58, 237, .45); }
      .sub { color: #a1a1aa; } .sub b { color: #e4e4e7; }
      .warn { border-color: #78350f; } .warn .title { color: #fbbf24; }
      button { background: #18181b; color: #fafafa; border-color: #3f3f46; }
      button:hover { background: #27272a; } kbd { background: #27272a; color: #a1a1aa; }
    }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  `;

  // scripts/build.mjs replaces this with a data: URI of icons/icon-32.png. Pages can't load
  // extension files unless they are web-accessible, which would let any site detect Latchkey.
  const ICON = '__LATCHKEY_ICON__';

  let toastHost = null;

  /** Renders lines from AL.toastLines: strings, and `{ strong }` parts in bold. */
  function renderLines(el, lines) {
    el.replaceChildren(
      ...lines.map((parts) => {
        const line = document.createElement('div');
        line.className = 'sub';
        for (const part of parts) {
          if (typeof part === 'string') {
            line.append(part);
          } else {
            const b = document.createElement('b');
            b.textContent = part.strong;
            line.append(b);
          }
        }
        return line;
      })
    );
  }

  /**
   * @param {object} opts
   * @param {string} opts.title
   * @param {Array} opts.lines        Status lines, see AL.toastLines.
   * @param {string} [opts.tone]      'warn' for the amber variant.
   * @param {{label: string, kbd?: string, onClick: Function}} [opts.action]
   * @param {number} [opts.progressMs]  Draining countdown bar.
   * @param {number} [opts.autoCloseMs]
   */
  function toast(opts) {
    if (!state || !state.settings.showToast) return { close() {}, setLines() {} };
    if (toastHost) toastHost.remove();
    toastHost = document.createElement('div');
    toastHost.setAttribute('data-latchkey', '');
    const shadow = toastHost.attachShadow({ mode: 'closed' });
    const make = (tag, cls) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      return n;
    };
    const style = make('style');
    style.textContent = TOAST_CSS;
    const box = make('div', 't' + (opts.tone ? ' ' + opts.tone : ''));
    box.setAttribute('role', 'status');
    const logo = make('img', 'logo');
    logo.src = ICON;
    logo.alt = '';
    const title = make('div', 'title');
    title.textContent = opts.title;
    const lines = make('div');
    renderLines(lines, opts.lines);
    const body = make('div', 'body');
    body.append(title, lines);
    box.append(logo, body);
    if (opts.action) {
      const btn = make('button');
      btn.append(opts.action.label);
      if (opts.action.kbd) {
        const kbd = make('kbd');
        kbd.textContent = opts.action.kbd;
        btn.append(kbd);
      }
      btn.addEventListener('click', opts.action.onClick);
      box.append(btn);
    }
    if (opts.progressMs) {
      const bar = make('div', 'bar grad');
      bar.style.animation = `pan 3s ease-in-out infinite alternate, drain ${opts.progressMs}ms linear forwards`;
      box.append(bar);
    }
    shadow.append(style, box);
    document.documentElement.appendChild(toastHost);
    const host = toastHost;
    const close = () => host.remove();
    if (opts.autoCloseMs) setTimeout(close, opts.autoCloseMs);
    return { close, setLines: (l) => renderLines(lines, l) };
  }

  // ---------------------------------------------------------------------------
  // Core
  // ---------------------------------------------------------------------------

  function report(rule, s, message) {
    lastResult.ruleId = rule ? rule.id : null;
    lastResult.state = s;
    lastResult.message = message || '';
    try {
      api.runtime.sendMessage({ type: 'status', state: s }).catch(() => {});
    } catch (e) {
      /* extension reloaded; ignore */
    }
  }

  function candidateRules() {
    if (!state || !state.settings.enabled) return [];
    if (!AL.isSecureEnough(location.href)) return [];
    return state.rules.filter((r) => r.enabled && AL.matchesUrl(r.urlPattern, location.href));
  }

  function fill(rule, fields) {
    if (fields.username && rule.username) AL.setInputValue(fields.username, rule.username);
    if (fields.password && rule.password) AL.setInputValue(fields.password, rule.password);
  }

  function cancelPendingSubmit() {
    if (pendingSubmit) {
      clearTimeout(pendingSubmit.timer);
      clearInterval(pendingSubmit.ticker);
      pendingSubmit.toast.close();
      document.removeEventListener('keydown', pendingSubmit.onKey, true);
      pendingSubmit = null;
    }
  }

  async function waitForEnabled(el, timeoutMs) {
    const started = Date.now();
    while (el.disabled || el.getAttribute('aria-disabled') === 'true') {
      if (Date.now() - started > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return true;
  }

  async function submit(rule, fields) {
    const button = AL.findSubmit(rule, document, fields);
    if (button) {
      await waitForEnabled(button, 3000);
      button.click();
      return;
    }
    const form = (fields.password && fields.password.form) || (fields.username && fields.username.form);
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }
    const target = fields.password || fields.username;
    if (target) {
      target.focus();
      for (const type of ['keydown', 'keypress', 'keyup']) {
        target.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
    }
  }

  function scheduleSubmit(rule, fields) {
    if (recentFailures(rule).length >= state.settings.maxAttempts) {
      report(rule, 'blocked', 'Too many attempts');
      toast({
        tone: 'warn',
        title: 'Auto-submit paused',
        lines: [['Too many attempts. Check the password.']],
        action: {
          label: 'Submit anyway',
          onClick: () => {
            resetAttempts(rule);
            markPending(rule);
            submit(rule, fields);
            watchPending();
          },
        },
      });
      return;
    }

    const delay = Math.max(0, Number(state.settings.submitDelayMs) || 0);
    report(rule, 'waiting', 'Submitting');
    const t = toast({
      title: rule.name,
      lines: AL.toastLines(rule, fields, 'countdown', delay || null),
      progressMs: delay,
      action: { label: 'Cancel', kbd: 'esc', onClick: () => onCancel() },
    });
    const onCancel = () => {
      cancelPendingSubmit();
      report(rule, 'filled', 'Submit cancelled');
      toast({ title: rule.name, lines: AL.toastLines(rule, fields, 'cancelled'), autoCloseMs: 3000 });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    const dueAt = Date.now() + delay;
    const ticker = setInterval(() => {
      const left = Math.max(0, dueAt - Date.now());
      t.setLines(AL.toastLines(rule, fields, 'countdown', left));
    }, 100);
    pendingSubmit = {
      toast: t,
      onKey,
      ticker,
      timer: setTimeout(() => {
        cancelPendingSubmit();
        markPending(rule);
        report(rule, 'submitted', 'Submitted');
        submit(rule, fields);
        watchPending();
      }, delay),
    };
  }

  /**
   * @param {object} [opts]
   * @param {string} [opts.ruleId]  Only consider this rule (manual fill from the popup).
   * @param {boolean} [opts.force]  Ignore the "already handled" marker.
   */
  function run(opts = {}) {
    if (pendingSubmit && !opts.force) return lastResult;
    let rules = candidateRules();
    if (opts.ruleId) rules = rules.filter((r) => r.id === opts.ruleId);

    for (const rule of rules) {
      const detection = AL.evaluateDetection(rule, document);
      if (!detection.ok) continue;

      const fields = AL.findFields(rule, document);
      const anchor = fields.password || fields.username;
      if (!anchor) continue;
      if (handled.has(anchor) && !opts.force) return lastResult;
      handled.add(anchor);

      if (opts.force) {
        cancelPendingSubmit();
        resetAttempts(rule);
      }

      // The login form is back: decide what the last auto-submit amounted to.
      const { pendingAt } = readAttempts(rule);
      if (pendingAt != null) {
        settle(rule, AL.attemptVerdict({ elapsed: Date.now() - pendingAt, urlMatches: true, formShown: true, formGoneFor: 0 }));
      }

      fill(rule, fields);
      console.info(LOG, `filled using rule "${rule.name}"`);

      if (rule.autoSubmit) {
        scheduleSubmit(rule, fields);
      } else {
        report(rule, 'filled', 'Filled');
        toast({ title: rule.name, lines: AL.toastLines(rule, fields, 'filled'), autoCloseMs: 3000 });
      }
      return lastResult;
    }
    return lastResult;
  }

  /** Per-rule diagnostics for the popup. */
  function diagnose() {
    const secure = AL.isSecureEnough(location.href);
    const rules = (state ? state.rules : []).map((rule) => {
      const urlMatch = AL.matchesUrl(rule.urlPattern, location.href);
      if (!urlMatch) return { id: rule.id, urlMatch };
      const detection = AL.evaluateDetection(rule, document);
      const fields = AL.findFields(rule, document);
      return {
        id: rule.id,
        urlMatch,
        enabled: rule.enabled,
        detection,
        fields: { username: Boolean(fields.username), password: Boolean(fields.password) },
        attempts: recentFailures(rule).length,
      };
    });
    return {
      url: location.href,
      title: document.title,
      secure,
      globallyEnabled: state ? state.settings.enabled : false,
      last: lastResult,
      rules,
    };
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  let debounce = null;
  function scheduleRun() {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      run();
    }, 150);
  }

  async function reloadState() {
    state = await AL.loadState(api);
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    const reply = async () => {
      if (!state) await reloadState();
      if (msg.type === 'diagnose') return diagnose();
      if (msg.type === 'fillNow') {
        run({ ruleId: msg.ruleId, force: true });
        return diagnose();
      }
      return null;
    };
    reply().then(sendResponse, (err) => sendResponse({ error: String(err) }));
    return true;
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[AL.STORAGE_KEY]) reloadState().then(scheduleRun);
  });

  reloadState().then(() => {
    run();
    watchPending(); // an auto-submit from the previous page may have succeeded
    // SPAs render the login form late or navigate to it without a reload.
    new MutationObserver(scheduleRun).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', scheduleRun);
    window.addEventListener('hashchange', scheduleRun);
  });
})();
