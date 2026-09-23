/**
 * AutoLogin Rules: shared core.
 *
 * Loaded as a classic script in every context (background, content script,
 * popup, options) and exposed as `globalThis.AutoLoginCore`. Everything here
 * is pure logic except the storage helpers, which take the extension API
 * object as a parameter so the module stays testable in Node.
 */
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'autologin';

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    showToast: true,
    submitDelayMs: 800,
    maxAttempts: 2,
    attemptWindowSec: 60,
  });

  /** Origins the extension always has access to (declared in host_permissions). */
  const LOCAL_ORIGINS = Object.freeze(['*://localhost/*', '*://127.0.0.1/*']);

  // ---------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------

  function generateId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID();
    }
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function createRule(partial = {}) {
    const detect = Object.assign({ title: '', selector: '', mode: 'all' }, partial.detect || {});
    return {
      id: partial.id || generateId(),
      name: partial.name || 'New rule',
      enabled: partial.enabled !== false,
      urlPattern: partial.urlPattern || '',
      detect,
      username: partial.username || '',
      password: partial.password || '',
      usernameSelector: partial.usernameSelector || '',
      passwordSelector: partial.passwordSelector || '',
      submitSelector: partial.submitSelector || '',
      autoSubmit: Boolean(partial.autoSubmit),
      createdAt: partial.createdAt || Date.now(),
      updatedAt: partial.updatedAt || Date.now(),
    };
  }

  /** Built-in templates offered in the options page. */
  const TEMPLATES = Object.freeze([
    {
      key: 'local-app',
      label: 'Local dev app (auto-submit)',
      rule: {
        name: 'My local app',
        urlPattern: 'http://localhost:3000/login*',
        detect: { title: 'my app', selector: 'input[type="password"]', mode: 'all' },
        autoSubmit: true,
      },
    },
    {
      key: 'any-local',
      label: 'Any localhost login form',
      rule: {
        name: 'Localhost login',
        urlPattern: 'http://localhost/*',
        detect: { title: '', selector: 'input[type="password"]', mode: 'all' },
        autoSubmit: false,
      },
    },
    {
      key: 'remote-site',
      label: 'Remote site (staging, internal tool...)',
      rule: {
        name: 'Staging',
        urlPattern: 'https://staging.example.com/*',
        detect: { title: '', selector: 'input[type="password"]', mode: 'all' },
        autoSubmit: false,
      },
    },
  ]);

  // ---------------------------------------------------------------------------
  // URL patterns
  //
  //   <scheme>://<host>[:<port>]<path>
  //
  //   scheme  http | https | *          (* = http or https)
  //   host    example.com | *.example.com | * | localhost | 127.0.0.1
  //   port    3000 | 3000-3999 | 3* | *   (omitted = any port)
  //   path    glob, * matches anything  (omitted = /*), matched against path + query
  // ---------------------------------------------------------------------------

  const PATTERN_RE = /^(\*|https?):\/\/(\*|(?:\*\.)?[a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\*|\d{1,5}-\d{1,5}|\d{1,5}\*?))?(\/.*)?$/i;

  function parseUrlPattern(pattern) {
    const input = String(pattern || '').trim();
    if (!input) return { ok: false, error: 'URL pattern is required.' };
    const m = PATTERN_RE.exec(input);
    if (!m) {
      return {
        ok: false,
        error: 'Invalid pattern. Expected e.g. "http://localhost:3000-3999/login*" or "https://*.example.com/*".',
      };
    }
    const [, scheme, host, rawPort, path] = m;
    const port = parsePort(rawPort);
    if (!port) return { ok: false, error: 'Port must be 1–65535, a range like 3000-3999, a prefix like 3*, or *.' };
    if (host !== '*' && host.indexOf('*', 1) !== -1) {
      return { ok: false, error: 'A wildcard is only allowed at the start of the host ("*.example.com").' };
    }
    return {
      ok: true,
      scheme: scheme.toLowerCase(),
      host: host.toLowerCase(),
      port,
      path: path || '/*',
    };
  }

  const inPortRange = (n) => n >= 1 && n <= 65535;

  /** Port spec → { raw, test(portNumber) } or null when invalid. */
  function parsePort(raw) {
    if (!raw || raw === '*') return { raw: '*', test: () => true };
    if (raw.includes('-')) {
      const [from, to] = raw.split('-').map(Number);
      if (!inPortRange(from) || !inPortRange(to) || from > to) return null;
      return { raw, test: (n) => n >= from && n <= to };
    }
    if (raw.endsWith('*')) {
      const prefix = raw.slice(0, -1);
      return { raw, test: (n) => String(n).startsWith(prefix) };
    }
    const n = Number(raw);
    if (!inPortRange(n)) return null;
    return { raw, test: (p) => p === n };
  }

  function escapeRe(s) {
    return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }

  function globToRe(glob) {
    return glob.split('*').map(escapeRe).join('.*');
  }

  /** RegExp for scheme, host and path. The port is captured and checked separately. */
  function patternToRegExp(pattern) {
    const p = parseUrlPattern(pattern);
    if (!p.ok) return null;
    const scheme = p.scheme === '*' ? 'https?' : p.scheme;
    let host;
    if (p.host === '*') host = '[^/:]+';
    else if (p.host.startsWith('*.')) host = '(?:[^/:]+\\.)?' + escapeRe(p.host.slice(2));
    else host = escapeRe(p.host);
    return new RegExp('^' + scheme + ':\\/\\/' + host + '(?::(\\d+))?' + globToRe(p.path) + '$', 'i');
  }

  function matchesUrl(pattern, url) {
    const p = parseUrlPattern(pattern);
    if (!p.ok) return false;
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return false;
    }
    const m = patternToRegExp(pattern).exec(u.protocol + '//' + u.host + u.pathname + u.search);
    if (!m) return false;
    // URL drops default ports, so fall back to 80 / 443.
    const port = m[1] ? Number(m[1]) : u.protocol === 'https:' ? 443 : 80;
    return p.port.test(port);
  }

  /** Browser match pattern for the permission a rule needs (ports and paths are dropped). */
  function permissionOrigin(pattern) {
    const p = parseUrlPattern(pattern);
    if (!p.ok) return null;
    return p.scheme + '://' + p.host + '/*';
  }

  function isLocalHost(host) {
    const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
    return (
      h === 'localhost' ||
      h.endsWith('.localhost') ||
      h === '127.0.0.1' ||
      h === '[::1]' ||
      h === '::1'
    );
  }

  function isLocalPattern(pattern) {
    const p = parseUrlPattern(pattern);
    return p.ok && isLocalHost(p.host);
  }

  /** Plain HTTP is only acceptable for local hosts. */
  function isSecureEnough(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || isLocalHost(u.hostname);
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  function parseTitleMatcher(title) {
    const t = String(title || '').trim();
    if (!t) return null;
    const m = /^\/(.+)\/([a-z]*)$/.exec(t);
    if (m) {
      try {
        const re = new RegExp(m[1], m[2]);
        return (s) => re.test(s);
      } catch (e) {
        return { error: 'Invalid title regular expression: ' + e.message };
      }
    }
    const needle = t.toLowerCase();
    return (s) => String(s).toLowerCase().includes(needle);
  }

  function validateRule(rule, isValidSelector) {
    const errors = [];
    const warnings = [];
    if (!String(rule.name || '').trim()) errors.push('Name is required.');

    const p = parseUrlPattern(rule.urlPattern);
    if (!p.ok) errors.push(p.error);

    const tm = parseTitleMatcher(rule.detect && rule.detect.title);
    if (tm && tm.error) errors.push(tm.error);

    if (typeof isValidSelector === 'function') {
      const selectors = [
        ['Detection selector', rule.detect && rule.detect.selector],
        ['Username selector', rule.usernameSelector],
        ['Password selector', rule.passwordSelector],
        ['Submit selector', rule.submitSelector],
      ];
      for (const [label, sel] of selectors) {
        if (sel && !isValidSelector(sel)) errors.push(label + ' is not a valid CSS selector.');
      }
    }

    if (!rule.username && !rule.password) errors.push('Enter a username, a password, or both.');

    if (p.ok) {
      const local = isLocalHost(p.host);
      if (!local && p.scheme === 'http') {
        errors.push('Plain HTTP is only allowed for localhost. Use https:// for remote sites.');
      }
      if (!local && p.scheme === '*') {
        warnings.push('Credentials will only be filled over HTTPS on non-local hosts.');
      }
      if (p.host === '*') {
        warnings.push('This rule matches every website. Add detection conditions to narrow it down.');
      }
      if (!local && rule.autoSubmit) {
        warnings.push('Auto-submit on a remote site can lock the account after failed attempts.');
      }
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  // ---------------------------------------------------------------------------
  // Detection and form discovery (DOM; used by the content script)
  // ---------------------------------------------------------------------------

  function safeQuery(doc, selector) {
    try {
      return doc.querySelector(selector);
    } catch (e) {
      return null;
    }
  }

  function evaluateDetection(rule, doc) {
    const d = rule.detect || {};
    const checks = [];
    const tm = parseTitleMatcher(d.title);
    if (tm && typeof tm === 'function') {
      checks.push({ kind: 'title', expected: d.title, ok: tm(doc.title || '') });
    }
    if (d.selector) {
      checks.push({ kind: 'selector', expected: d.selector, ok: Boolean(safeQuery(doc, d.selector)) });
    }
    if (checks.length === 0) return { ok: true, checks };
    const ok = d.mode === 'any' ? checks.some((c) => c.ok) : checks.every((c) => c.ok);
    return { ok, checks };
  }

  function isVisible(el) {
    if (!el || el.disabled) return false;
    if (el.type === 'hidden') return false;
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    if (view) {
      const style = view.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
    }
    return true;
  }

  const USERNAME_HINT = /user|email|e-mail|login|account|name/i;

  function findUsernameField(doc, passwordEl) {
    const scope = (passwordEl && passwordEl.form) || doc;
    const inputs = Array.from(
      scope.querySelectorAll('input:not([type]), input[type="text"], input[type="email"], input[type="tel"]')
    ).filter(isVisible);
    if (inputs.length === 0) return null;

    const byAutocomplete = inputs.find((i) => /username|email/i.test(i.getAttribute('autocomplete') || ''));
    if (byAutocomplete) return byAutocomplete;

    const byHint = inputs.find((i) => USERNAME_HINT.test((i.name || '') + ' ' + (i.id || '')));
    if (byHint) return byHint;

    if (passwordEl) {
      // Last text-like input that precedes the password field in document order.
      const before = inputs.filter(
        (i) => i.compareDocumentPosition(passwordEl) & 4 /* DOCUMENT_POSITION_FOLLOWING */
      );
      if (before.length) return before[before.length - 1];
    }
    return inputs[0];
  }

  function findFields(rule, doc) {
    let password = null;
    if (rule.password) {
      password = rule.passwordSelector
        ? safeQuery(doc, rule.passwordSelector)
        : Array.from(doc.querySelectorAll('input[type="password"]')).find(isVisible) || null;
    }
    let username = null;
    if (rule.username) {
      username = rule.usernameSelector ? safeQuery(doc, rule.usernameSelector) : findUsernameField(doc, password);
    }
    return { username, password };
  }

  function findSubmit(rule, doc, fields) {
    if (rule.submitSelector) return safeQuery(doc, rule.submitSelector);
    const form = (fields.password && fields.password.form) || (fields.username && fields.username.form);
    if (!form) return null;
    return (
      form.querySelector('button[type="submit"], input[type="submit"]') ||
      form.querySelector('button:not([type])')
    );
  }

  /**
   * Set an input value so that frameworks (React, Vue, Angular, Formik...) notice it.
   * React tracks the value through the prototype setter, so assigning `el.value`
   * directly would be ignored by its synthetic event system.
   */
  function setInputValue(el, value) {
    const view = el.ownerDocument.defaultView;
    const proto = el instanceof view.HTMLTextAreaElement ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new view.Event('input', { bubbles: true }));
    el.dispatchEvent(new view.Event('change', { bubbles: true }));
    el.blur();
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  function normalizeState(raw) {
    const state = raw && typeof raw === 'object' ? raw : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      settings: Object.assign({}, DEFAULT_SETTINGS, state.settings || {}),
      rules: Array.isArray(state.rules) ? state.rules.map(createRule) : [],
    };
  }

  async function loadState(api) {
    const data = await api.storage.local.get(STORAGE_KEY);
    return normalizeState(data[STORAGE_KEY]);
  }

  async function saveState(api, state) {
    const normalized = normalizeState(state);
    await api.storage.local.set({ [STORAGE_KEY]: normalized });
    return normalized;
  }

  function exportState(state) {
    return JSON.stringify(
      { app: 'autologin-rules', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), rules: state.rules, settings: state.settings },
      null,
      2
    );
  }

  function importState(json, current) {
    const data = JSON.parse(json);
    if (!data || !Array.isArray(data.rules)) throw new Error('File does not contain a "rules" array.');
    const existing = new Set(current.rules.map((r) => r.id));
    const incoming = data.rules.map((r) => createRule(Object.assign({}, r, existing.has(r.id) ? { id: generateId() } : {})));
    return normalizeState({
      settings: Object.assign({}, current.settings, data.settings || {}),
      rules: current.rules.concat(incoming),
    });
  }

  root.AutoLoginCore = {
    SCHEMA_VERSION,
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    LOCAL_ORIGINS,
    TEMPLATES,
    createRule,
    parseUrlPattern,
    patternToRegExp,
    matchesUrl,
    permissionOrigin,
    isLocalHost,
    isLocalPattern,
    isSecureEnough,
    parseTitleMatcher,
    validateRule,
    evaluateDetection,
    findFields,
    findSubmit,
    setInputValue,
    normalizeState,
    loadState,
    saveState,
    exportState,
    importState,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
