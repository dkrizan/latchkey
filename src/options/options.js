/* global AutoLoginCore */
'use strict';

const api = globalThis.browser || globalThis.chrome;
const AL = globalThis.AutoLoginCore;

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
};

let state = { settings: { ...AL.DEFAULT_SETTINGS }, rules: [] };
/** origin -> boolean */
let access = {};
let editingId = null;

function isValidSelector(sel) {
  try {
    document.createDocumentFragment().querySelector(sel);
    return true;
  } catch (e) {
    return false;
  }
}

function snackbar(text) {
  const bar = $('#snackbar');
  bar.textContent = text;
  bar.classList.remove('hidden');
  clearTimeout(snackbar.t);
  snackbar.t = setTimeout(() => bar.classList.add('hidden'), 2600);
}

async function save() {
  state = await AL.saveState(api, state);
}

async function refreshAccess() {
  const origins = new Set(AL.LOCAL_ORIGINS);
  for (const r of state.rules) {
    const o = AL.permissionOrigin(r.urlPattern);
    if (o) origins.add(o);
  }
  access = {};
  await Promise.all(
    Array.from(origins).map(async (o) => {
      try {
        access[o] = await api.permissions.contains({ origins: [o] });
      } catch (e) {
        access[o] = false;
      }
    })
  );
  const localOk = AL.LOCAL_ORIGINS.every((o) => access[o]);
  $('#local-access-notice').classList.toggle('hidden', localOk);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function detectionSummary(rule) {
  const parts = [];
  if (rule.detect.title) parts.push(`title ~ "${rule.detect.title}"`);
  if (rule.detect.selector) parts.push(`has ${rule.detect.selector}`);
  if (!parts.length) return null;
  return parts.join(rule.detect.mode === 'any' ? ' or ' : ' and ');
}

function renderRules() {
  const list = $('#rules');
  list.replaceChildren();
  $('#empty').classList.toggle('hidden', state.rules.length > 0);

  state.rules.forEach((rule, index) => {
    const origin = AL.permissionOrigin(rule.urlPattern);
    const local = AL.isLocalPattern(rule.urlPattern);
    const granted = origin ? access[origin] : false;
    const detection = detectionSummary(rule);

    const toggle = el('input', {
      type: 'checkbox',
      'aria-label': `Enable ${rule.name}`,
      onchange: async (e) => {
        rule.enabled = e.target.checked;
        rule.updatedAt = Date.now();
        await save();
        renderRules();
      },
    });
    toggle.checked = rule.enabled;

    const meta = [
      el('span', { class: 'badge ' + (local ? '' : 'accent') }, local ? 'Local' : 'Remote'),
      rule.autoSubmit ? el('span', { class: 'badge accent' }, 'Auto-submit') : el('span', { class: 'badge' }, 'Fill only'),
      rule.username ? el('span', { class: 'badge' }, 'as ' + rule.username) : null,
      detection ? el('span', { class: 'badge', title: 'Page detection' }, detection) : el('span', { class: 'badge' }, 'URL only'),
    ];
    if (origin && !granted) {
      meta.push(
        el(
          'button',
          {
            class: 'badge warn',
            style: 'border:0;cursor:pointer',
            title: 'Grant access to ' + origin,
            onclick: () => requestAccess(origin),
          },
          'Access needed · Grant'
        )
      );
    }

    list.append(
      el(
        'li',
        { class: 'rule' + (rule.enabled ? '' : ' disabled'), 'data-id': rule.id },
        el('label', { class: 'switch' }, toggle, el('span')),
        el(
          'div',
          { class: 'rule-main' },
          el('div', { class: 'rule-name' }, rule.name, el('span', { class: 'muted small' }, '#' + (index + 1))),
          el('div', { class: 'rule-pattern', title: rule.urlPattern }, rule.urlPattern),
          el('div', { class: 'rule-meta' }, meta)
        ),
        el(
          'div',
          { class: 'rule-actions' },
          el('button', { class: 'btn ghost sm', title: 'Move up', 'aria-label': 'Move up', disabled: index === 0, onclick: () => move(index, -1) }, '↑'),
          el('button', { class: 'btn ghost sm', title: 'Move down', 'aria-label': 'Move down', disabled: index === state.rules.length - 1, onclick: () => move(index, 1) }, '↓'),
          el('button', { class: 'btn ghost sm', onclick: () => duplicate(rule) }, 'Duplicate'),
          el('button', { class: 'btn sm', onclick: () => openEditor(rule) }, 'Edit')
        )
      )
    );
  });
  renderTest();
}

function renderSettings() {
  $('#global-enabled').checked = state.settings.enabled;
  $('#global-label').textContent = state.settings.enabled ? 'Enabled' : 'Paused';
  $('#set-toast').checked = state.settings.showToast;
  $('#set-delay').value = state.settings.submitDelayMs;
  $('#set-attempts').value = state.settings.maxAttempts;
  $('#set-window').value = state.settings.attemptWindowSec;
}

function renderTemplates() {
  const menu = $('#template-menu');
  menu.replaceChildren(
    ...AL.TEMPLATES.map((t) =>
      el(
        'button',
        { role: 'menuitem', onclick: () => { closeMenu(); openEditor(AL.createRule({ ...t.rule, id: undefined }), true); } },
        t.label,
        el('small', {}, t.rule.urlPattern)
      )
    )
  );
}

function renderTest() {
  const url = $('#test-url').value.trim();
  const title = $('#test-title').value;
  const out = $('#test-results');
  out.replaceChildren();
  if (!url) return;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    out.append(el('li', {}, el('span', { class: 'badge danger' }, 'Invalid URL')));
    return;
  }
  if (!AL.isSecureEnough(parsed.href)) {
    out.append(el('li', {}, el('span', { class: 'badge warn' }, 'Skipped'), 'Plain HTTP on a non-local host is never filled.'));
    return;
  }
  const fakeDoc = { title, querySelector: () => null };
  let winner = null;
  for (const rule of state.rules) {
    if (!AL.matchesUrl(rule.urlPattern, parsed.href)) continue;
    const titleOnly = { ...rule, detect: { ...rule.detect, selector: '' } };
    const titleOk = AL.evaluateDetection(titleOnly, fakeDoc).ok;
    let badge;
    if (!rule.enabled) badge = el('span', { class: 'badge' }, 'Disabled');
    else if (!titleOk && rule.detect.title) badge = el('span', { class: 'badge warn' }, 'Title mismatch');
    else if (!winner) {
      winner = rule;
      badge = el('span', { class: 'badge ok' }, 'Would apply');
    } else badge = el('span', { class: 'badge' }, 'Shadowed');
    const note = rule.detect.selector ? el('span', { class: 'muted small' }, `+ needs ${rule.detect.selector}`) : null;
    out.append(el('li', {}, badge, el('span', { class: 'spacer' }, rule.name), note));
  }
  if (!out.children.length) out.append(el('li', { class: 'muted' }, 'No rule matches this URL.'));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function requestAccess(origin) {
  // Must run synchronously inside the click handler (user gesture).
  const granted = await api.permissions.request({ origins: [origin] }).catch(() => false);
  await refreshAccess();
  renderRules();
  snackbar(granted ? `Access granted to ${origin}` : 'Access was not granted.');
}

async function move(index, delta) {
  const [rule] = state.rules.splice(index, 1);
  state.rules.splice(index + delta, 0, rule);
  await save();
  renderRules();
}

async function duplicate(rule) {
  const copy = AL.createRule({ ...rule, id: undefined, name: rule.name + ' (copy)', createdAt: undefined });
  const i = state.rules.findIndex((r) => r.id === rule.id);
  state.rules.splice(i + 1, 0, copy);
  await save();
  renderRules();
  snackbar('Rule duplicated');
}

async function removeOrphanPermission(origin) {
  if (!origin || AL.LOCAL_ORIGINS.includes(origin)) return;
  const stillUsed = state.rules.some((r) => AL.permissionOrigin(r.urlPattern) === origin);
  if (!stillUsed) await api.permissions.remove({ origins: [origin] }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const form = $('#editor-form');

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
  target[last] = value;
}

function readForm() {
  const base = editingId ? state.rules.find((r) => r.id === editingId) : null;
  const rule = AL.createRule(base || { id: form.dataset.newId });
  for (const input of form.elements) {
    if (!input.name) continue;
    if (input.type === 'checkbox') setPath(rule, input.name, input.checked);
    else if (input.type === 'radio') {
      if (input.checked) setPath(rule, input.name, input.value);
    } else setPath(rule, input.name, input.name === 'password' ? input.value : input.value.trim());
  }
  return rule;
}

function fillForm(rule) {
  for (const input of form.elements) {
    if (!input.name) continue;
    const value = getPath(rule, input.name);
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (input.type === 'radio') input.checked = input.value === (value || 'all');
    else input.value = value || '';
  }
}

function renderValidation() {
  const rule = readForm();
  const result = AL.validateRule(rule, isValidSelector);
  const box = $('#validation');
  box.replaceChildren(
    ...result.errors.map((e) => el('div', { class: 'notice danger' }, e)),
    ...result.warnings.map((w) => el('div', { class: 'notice' }, w))
  );

  const derived = $('#f-url-derived');
  derived.replaceChildren();
  const parsed = AL.parseUrlPattern(rule.urlPattern);
  $('#f-url').classList.toggle('invalid', Boolean(rule.urlPattern) && !parsed.ok);
  if (parsed.ok) {
    const origin = AL.permissionOrigin(rule.urlPattern);
    const local = AL.isLocalPattern(rule.urlPattern);
    const parts = [
      el('span', { class: 'badge ' + (local ? '' : 'accent') }, local ? 'Local' : 'Remote'),
      el('span', { class: 'muted' }, local ? 'Always allowed.' : 'Needs access to'),
      local ? null : el('code', {}, origin),
      !local && access[origin] ? el('span', { class: 'badge ok' }, 'granted') : null,
      !local && !access[origin] ? el('span', { class: 'muted' }, '(you will be asked on save)') : null,
    ];
    derived.append(...parts.filter(Boolean));
  }
  return result;
}

function openEditor(rule, isNew = false) {
  editingId = isNew ? null : rule.id;
  form.dataset.newId = isNew ? rule.id : '';
  $('#editor-title').textContent = isNew ? 'New rule' : 'Edit rule';
  $('#delete-rule').classList.toggle('hidden', isNew);
  $('#f-pass').type = 'password';
  $('#toggle-pass').textContent = 'Show';
  fillForm(rule);
  form.querySelector('.advanced').open = Boolean(rule.usernameSelector || rule.passwordSelector || rule.submitSelector);
  renderValidation();
  $('#editor').showModal();
  $('#f-name').focus();
}

form.addEventListener('input', () => renderValidation());

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const rule = readForm();
  const result = AL.validateRule(rule, isValidSelector);
  if (!result.ok) {
    renderValidation();
    return;
  }
  // Ask for host access synchronously, while we still have the user gesture.
  const origin = AL.permissionOrigin(rule.urlPattern);
  const needsGrant = origin && !AL.isLocalPattern(rule.urlPattern) && !access[origin];
  const grant = needsGrant ? api.permissions.request({ origins: [origin] }).catch(() => false) : Promise.resolve(true);

  grant.then(async (granted) => {
    rule.updatedAt = Date.now();
    const previous = state.rules.find((r) => r.id === rule.id);
    const previousOrigin = previous && AL.permissionOrigin(previous.urlPattern);
    if (previous) state.rules[state.rules.indexOf(previous)] = rule;
    else state.rules.push(rule);
    await save();
    if (previousOrigin && previousOrigin !== origin) await removeOrphanPermission(previousOrigin);
    await refreshAccess();
    renderRules();
    $('#editor').close();
    snackbar(granted ? 'Rule saved' : 'Rule saved, but access to the site was not granted.');
  });
});

$('#cancel-edit').addEventListener('click', () => $('#editor').close());

$('#delete-rule').addEventListener('click', async () => {
  const rule = state.rules.find((r) => r.id === editingId);
  if (!rule) return;
  // eslint-disable-next-line no-alert
  if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
  state.rules = state.rules.filter((r) => r.id !== rule.id);
  await save();
  await removeOrphanPermission(AL.permissionOrigin(rule.urlPattern));
  await refreshAccess();
  renderRules();
  $('#editor').close();
  snackbar('Rule deleted');
});

$('#toggle-pass').addEventListener('click', () => {
  const input = $('#f-pass');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('#toggle-pass').textContent = show ? 'Hide' : 'Show';
  $('#toggle-pass').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

// ---------------------------------------------------------------------------
// Toolbar, settings, import/export
// ---------------------------------------------------------------------------

function closeMenu() {
  $('#template-menu').classList.add('hidden');
  $('#template-btn').setAttribute('aria-expanded', 'false');
}

$('#template-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('#template-menu');
  const open = menu.classList.toggle('hidden') === false;
  $('#template-btn').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', closeMenu);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());

$('#add-rule').addEventListener('click', () => openEditor(AL.createRule({ urlPattern: 'http://localhost:3000/login*' }), true));

$('#global-enabled').addEventListener('change', async (e) => {
  state.settings.enabled = e.target.checked;
  await save();
  renderSettings();
});
$('#set-toast').addEventListener('change', async (e) => {
  state.settings.showToast = e.target.checked;
  await save();
});
for (const [id, key, min, max] of [
  ['#set-delay', 'submitDelayMs', 0, 10000],
  ['#set-attempts', 'maxAttempts', 1, 20],
  ['#set-window', 'attemptWindowSec', 5, 3600],
]) {
  $(id).addEventListener('change', async (e) => {
    const n = Math.min(max, Math.max(min, Math.round(Number(e.target.value) || 0)));
    state.settings[key] = n;
    e.target.value = n;
    await save();
    snackbar('Saved');
  });
}

$('#grant-local').addEventListener('click', () => {
  api.permissions
    .request({ origins: AL.LOCAL_ORIGINS.slice() })
    .catch(() => false)
    .then(async () => {
      await refreshAccess();
      renderRules();
    });
});

$('#export').addEventListener('click', () => {
  const blob = new Blob([AL.exportState(state)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `autologin-rules-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  snackbar('Exported (contains plain-text passwords)');
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const before = state.rules.length;
    state = AL.importState(await file.text(), state);
    await save();
    await refreshAccess();
    renderSettings();
    renderRules();
    snackbar(`Imported ${state.rules.length - before} rule(s). Grant access for remote ones.`);
  } catch (err) {
    snackbar('Import failed: ' + err.message);
  }
});

$('#test-url').addEventListener('input', renderTest);
$('#test-title').addEventListener('input', renderTest);

api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes[AL.STORAGE_KEY]) return;
  state = AL.normalizeState(changes[AL.STORAGE_KEY].newValue);
  renderSettings();
  renderRules();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function init() {
  $('#version').textContent = 'v' + api.runtime.getManifest().version;
  state = await AL.loadState(api);
  await refreshAccess();
  renderSettings();
  renderTemplates();
  renderRules();

  // Deep links from the popup: ?new=<url> or ?edit=<ruleId>
  const params = new URLSearchParams(location.search);
  if (params.get('edit')) {
    const rule = state.rules.find((r) => r.id === params.get('edit'));
    if (rule) openEditor(rule);
  } else if (params.get('new')) {
    try {
      const u = new URL(params.get('new'));
      const path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') + '*' : '/*';
      openEditor(
        AL.createRule({
          name: u.hostname,
          urlPattern: `${u.protocol}//${u.host}${path}`,
          detect: { title: '', selector: 'input[type="password"]', mode: 'all' },
        }),
        true
      );
    } catch (e) {
      /* ignore malformed deep link */
    }
  }
  if (params.has('new') || params.has('edit')) history.replaceState(null, '', location.pathname);
})();
