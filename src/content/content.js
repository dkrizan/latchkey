/**
 * AutoLogin Rules: content script.
 *
 * Injected only on origins that an enabled rule targets (see background.js), or
 * on demand through the popup's "Fill now" button (activeTab).
 *
 * Flow: find the first enabled rule whose URL pattern and detection conditions
 * match, locate the fields, fill them, and optionally submit after a short,
 * cancellable delay. A per-tab attempt counter stops submit loops when the
 * stored credentials are wrong.
 */
/* global AutoLoginCore */
(function () {
  'use strict';

  if (window.__autoLoginRulesLoaded) return;
  window.__autoLoginRulesLoaded = true;

  const api = globalThis.browser || globalThis.chrome;
  const AL = globalThis.AutoLoginCore;
  const LOG = '[AutoLogin Rules]';

  let state = null;
  const handled = new WeakSet();
  const lastResult = { ruleId: null, state: 'idle', message: '' };
  let pendingSubmit = null;

  // ---------------------------------------------------------------------------
  // Attempt guard (sessionStorage is per tab and per origin)
  // ---------------------------------------------------------------------------

  function attemptsKey(rule) {
    return '__autologin_attempts:' + rule.id;
  }

  function recentAttempts(rule) {
    const windowMs = state.settings.attemptWindowSec * 1000;
    let list = [];
    try {
      list = JSON.parse(sessionStorage.getItem(attemptsKey(rule)) || '[]');
    } catch (e) {
      list = [];
    }
    const now = Date.now();
    return list.filter((t) => now - t < windowMs);
  }

  function recordAttempt(rule) {
    const list = recentAttempts(rule);
    list.push(Date.now());
    try {
      sessionStorage.setItem(attemptsKey(rule), JSON.stringify(list));
    } catch (e) {
      /* storage may be blocked; the guard then only lives in memory for this page */
    }
  }

  function resetAttempts(rule) {
    try {
      sessionStorage.removeItem(attemptsKey(rule));
    } catch (e) {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------------
  // Toast (Shadow DOM so page styles cannot leak in or out)
  // ---------------------------------------------------------------------------

  const TOAST_CSS = `
        :host { all: initial; }
        .t { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; max-width: 360px;
             font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a;
             background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px;
             box-shadow: 0 8px 24px rgba(15, 23, 42, .15); display: flex; gap: 10px; align-items: center; }
        .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: #6366f1; }
        .ok .dot { background: #16a34a; } .warn .dot { background: #d97706; }
        .body { flex: 1; } .title { font-weight: 600; } .sub { color: #475569; }
        button { font: inherit; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a;
                 border-radius: 6px; padding: 3px 10px; cursor: pointer; }
        button:hover { background: #eef2ff; border-color: #6366f1; }
        @media (prefers-color-scheme: dark) {
          .t { background: #1e293b; color: #e2e8f0; border-color: #334155; }
          .sub { color: #94a3b8; } button { background: #0f172a; color: #e2e8f0; border-color: #475569; }
        }
  `;

  let toastHost = null;

  function toast(opts) {
    if (!state || !state.settings.showToast) return { close() {} };
    if (toastHost) toastHost.remove();
    toastHost = document.createElement('div');
    toastHost.setAttribute('data-autologin-rules', '');
    const shadow = toastHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = TOAST_CSS;
    const make = (tag, cls) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      return n;
    };
    const box = make('div', 't' + (opts.tone ? ' ' + opts.tone : ''));
    box.setAttribute('role', 'status');
    const body = make('div', 'body');
    body.append(make('div', 'title'), make('div', 'sub'));
    box.append(make('span', 'dot'), body);
    shadow.append(style, box);
    const root = shadow.querySelector('.t');
    shadow.querySelector('.title').textContent = opts.title;
    shadow.querySelector('.sub').textContent = opts.sub || '';
    if (opts.action) {
      const btn = document.createElement('button');
      btn.textContent = opts.action.label;
      btn.addEventListener('click', opts.action.onClick);
      root.appendChild(btn);
    }
    document.documentElement.appendChild(toastHost);
    const host = toastHost;
    const close = () => host.remove();
    if (opts.autoCloseMs) setTimeout(close, opts.autoCloseMs);
    return { close, setSub: (s) => (shadow.querySelector('.sub').textContent = s) };
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
    const attempts = recentAttempts(rule);
    if (attempts.length >= state.settings.maxAttempts) {
      report(rule, 'blocked', 'Too many attempts');
      toast({
        tone: 'warn',
        title: 'Auto-submit paused',
        sub: `"${rule.name}" already submitted ${attempts.length}× in the last ${state.settings.attemptWindowSec}s. Check the stored credentials.`,
        action: {
          label: 'Submit anyway',
          onClick: () => {
            resetAttempts(rule);
            recordAttempt(rule);
            submit(rule, fields);
          },
        },
      });
      return;
    }

    const delay = Math.max(0, Number(state.settings.submitDelayMs) || 0);
    report(rule, 'waiting', 'Submitting');
    const t = toast({
      title: `Filled "${rule.name}"`,
      sub: delay ? `Submitting in ${(delay / 1000).toFixed(1)}s. Press Esc to cancel.` : 'Submitting...',
      action: { label: 'Cancel', onClick: () => onCancel() },
    });
    const onCancel = () => {
      cancelPendingSubmit();
      report(rule, 'filled', 'Submit cancelled');
      toast({ title: `Filled "${rule.name}"`, sub: 'Auto-submit cancelled.', autoCloseMs: 2500 });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    const dueAt = Date.now() + delay;
    const ticker = setInterval(() => {
      const left = Math.max(0, dueAt - Date.now());
      t.setSub && t.setSub(`Submitting in ${(left / 1000).toFixed(1)}s. Press Esc to cancel.`);
    }, 100);
    pendingSubmit = {
      toast: t,
      onKey,
      ticker,
      timer: setTimeout(() => {
        cancelPendingSubmit();
        recordAttempt(rule);
        report(rule, 'submitted', 'Submitted');
        submit(rule, fields);
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

      fill(rule, fields);
      console.info(LOG, `filled using rule "${rule.name}"`);

      if (rule.autoSubmit) {
        scheduleSubmit(rule, fields);
      } else {
        report(rule, 'filled', 'Filled');
        toast({ tone: 'ok', title: `Filled "${rule.name}"`, sub: 'Auto-submit is off for this rule.', autoCloseMs: 2500 });
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
        attempts: recentAttempts(rule).length,
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
    // SPAs render the login form late or navigate to it without a reload.
    new MutationObserver(scheduleRun).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', scheduleRun);
    window.addEventListener('hashchange', scheduleRun);
  });
})();
