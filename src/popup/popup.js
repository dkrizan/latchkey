/* global AutoLoginCore */
'use strict';

const api = globalThis.browser || globalThis.chrome;
const AL = globalThis.AutoLoginCore;
const CONTENT_FILES = ['lib/core.js', 'content/content.js'];

const $ = (sel) => document.querySelector(sel);
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

let tab = null;
let state = null;

async function getTargetTab() {
  // ?tabId= lets tests and screenshots open the popup as a regular page.
  const forced = new URLSearchParams(location.search).get('tabId');
  if (forced) return api.tabs.get(Number(forced));
  const [active] = await api.tabs.query({ active: true, currentWindow: true });
  return active;
}

async function askContent(message) {
  try {
    return await api.tabs.sendMessage(tab.id, message);
  } catch (e) {
    return null; // content script not injected on this page
  }
}

async function injectAndAsk(message) {
  await api.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
  return askContent(message);
}

function stateBox(tone, title, text, actions = []) {
  return el(
    'div',
    { class: 'state ' + tone },
    el('span', { class: 'dot' }),
    el('div', {}, el('div', { class: 'title' }, title), text ? el('p', {}, text) : null, actions.length ? el('div', { class: 'actions' }, actions) : null)
  );
}

function check(ok, label, detail) {
  const cls = ok === null ? 'na' : ok ? 'yes' : 'no';
  const mark = ok === null ? '–' : ok ? '✓' : '✗';
  return el('li', {}, el('span', { class: 'mark ' + cls }, mark), el('span', {}, label), detail ? el('code', { title: detail }, detail) : null);
}

function openOptions(query) {
  const url = api.runtime.getURL('options/options.html') + (query ? '?' + query : '');
  api.tabs.create({ url });
  window.close();
}

function renderDiagnosis(diag) {
  const content = $('#content');
  content.replaceChildren();

  if (!diag.globallyEnabled) {
    content.append(stateBox('warn', 'All rules are paused', 'Turn the switch above back on to resume.'));
  }
  if (!diag.secure) {
    content.append(stateBox('warn', 'Not filled on plain HTTP', 'Credentials are only filled over HTTPS on non-local hosts.'));
    return;
  }

  const rulesById = new Map(state.rules.map((r) => [r.id, r]));
  const matching = diag.rules.filter((r) => r.urlMatch);
  if (!matching.length) {
    content.append(stateBox('', 'No rule for this page', 'Create one with the button below.'));
    return;
  }

  const winner = matching.find((r) => r.enabled && r.detection.ok && (r.fields.username || r.fields.password));
  if (diag.last && diag.last.state === 'blocked') {
    content.append(stateBox('warn', 'Auto-submit paused', 'Too many submits in a short time. Check the stored credentials.'));
  } else if (diag.last && ['filled', 'submitted', 'waiting'].includes(diag.last.state)) {
    const name = rulesById.get(diag.last.ruleId)?.name || 'rule';
    const verb = { filled: 'Filled', submitted: 'Filled and submitted', waiting: 'Filled, submitting…' }[diag.last.state];
    content.append(stateBox('ok', `${verb} with "${name}"`, null));
  }

  for (const r of matching) {
    const rule = rulesById.get(r.id);
    if (!rule) continue;
    const checks = [check(true, 'URL matches', rule.urlPattern)];
    const byKind = Object.fromEntries((r.detection?.checks || []).map((c) => [c.kind, c]));
    if (byKind.title) checks.push(check(byKind.title.ok, 'Title contains', rule.detect.title));
    if (byKind.selector) checks.push(check(byKind.selector.ok, 'Element exists', rule.detect.selector));
    if (!byKind.title && !byKind.selector) checks.push(check(null, 'No page detection', null));
    if (rule.username) checks.push(check(r.fields.username, 'Username field', rule.usernameSelector || 'auto'));
    if (rule.password) checks.push(check(r.fields.password, 'Password field', rule.passwordSelector || 'auto'));

    const isWinner = winner && winner.id === r.id;
    content.append(
      el(
        'div',
        { class: 'rule' + (isWinner ? ' winner' : '') },
        el(
          'div',
          { class: 'rule-head' },
          el('strong', {}, rule.name),
          !rule.enabled ? el('span', { class: 'badge' }, 'Disabled') : null,
          isWinner ? el('span', { class: 'badge accent' }, 'Active') : null,
          rule.autoSubmit ? el('span', { class: 'badge' }, 'Auto-submit') : null
        ),
        el('ul', { class: 'checks' }, checks),
        el(
          'div',
          { class: 'rule-actions' },
          el(
            'button',
            {
              class: 'btn sm' + (isWinner ? ' primary' : ''),
              disabled: !(r.fields.username || r.fields.password),
              onclick: async () => {
                const next = await askContent({ type: 'fillNow', ruleId: rule.id });
                if (next) renderDiagnosis(next);
              },
            },
            rule.autoSubmit ? 'Fill & submit' : 'Fill now'
          ),
          el('button', { class: 'btn ghost sm', onclick: () => openOptions('edit=' + encodeURIComponent(rule.id)) }, 'Edit')
        )
      )
    );
  }
}

/** The content script is not running on this page: explain why, offer a fix. */
async function renderInactive() {
  const content = $('#content');
  content.replaceChildren();
  const matching = state.rules.filter((r) => AL.matchesUrl(r.urlPattern, tab.url));

  if (!/^https?:/.test(tab.url || '')) {
    content.append(stateBox('', 'Not available on this page', 'Browser pages and extension stores cannot be scripted.'));
    $('#add-for-site').disabled = true;
    return;
  }
  if (!matching.length) {
    content.append(stateBox('', 'No rule for this page', 'Create one with the button below.'));
    return;
  }

  const rule = matching.find((r) => r.enabled) || matching[0];
  const origin = AL.permissionOrigin(rule.urlPattern);
  const granted = await api.permissions.contains({ origins: [origin] }).catch(() => false);

  const fillOnce = el(
    'button',
    {
      class: 'btn sm',
      onclick: async () => {
        const diag = await injectAndAsk({ type: 'fillNow', ruleId: rule.id });
        if (diag) renderDiagnosis(diag);
      },
    },
    'Fill once'
  );

  if (!granted) {
    content.append(
      stateBox('warn', `"${rule.name}" needs access to this site`, `Grant access to ${origin} so the rule runs automatically.`, [
        el(
          'button',
          {
            class: 'btn sm primary',
            onclick: () => {
              api.permissions
                .request({ origins: [origin] })
                .then((ok) => ok && api.tabs.reload(tab.id))
                .finally(() => window.close());
            },
          },
          'Grant access'
        ),
        fillOnce,
      ])
    );
  } else {
    content.append(
      stateBox('warn', 'Reload to activate', `"${rule.name}" was added after this tab was opened.`, [
        el('button', { class: 'btn sm primary', onclick: () => api.tabs.reload(tab.id).then(() => window.close()) }, 'Reload tab'),
        fillOnce,
      ])
    );
  }
}

async function render() {
  state = await AL.loadState(api);
  $('#global-enabled').checked = state.settings.enabled;

  let url = null;
  try {
    url = new URL(tab.url);
  } catch (e) {
    /* e.g. about:blank */
  }
  $('#site-host').textContent = url ? url.host + url.pathname : tab.url || 'Unknown page';
  $('#site-title').textContent = tab.title || '';

  const diag = await askContent({ type: 'diagnose' });
  if (diag && !diag.error) renderDiagnosis(diag);
  else await renderInactive();
}

$('#global-enabled').addEventListener('change', async (e) => {
  state.settings.enabled = e.target.checked;
  await AL.saveState(api, state);
  render();
});
$('#open-options').addEventListener('click', () => {
  api.runtime.openOptionsPage();
  window.close();
});
$('#add-for-site').addEventListener('click', () => openOptions('new=' + encodeURIComponent(tab.url)));

(async function init() {
  tab = await getTargetTab();
  await render();
})();
