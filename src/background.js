/**
 * AutoLogin Rules: background (service worker in Chrome, event page in Firefox).
 *
 * Responsibilities:
 *  - Register the content script only on origins that some enabled rule targets
 *    AND that the user granted access to. Nothing runs anywhere else.
 *  - Keep that registration in sync when rules, settings or permissions change.
 *  - Show a per-tab badge reflecting what the content script did.
 */
/* global AutoLoginCore */
if (typeof importScripts === 'function' && !globalThis.AutoLoginCore) {
  importScripts('lib/core.js');
}

const api = globalThis.browser || globalThis.chrome;
const AL = globalThis.AutoLoginCore;
const SCRIPT_ID = 'autologin-rules-content';
const CONTENT_FILES = ['lib/core.js', 'content/content.js'];

async function hasOrigin(origin) {
  try {
    return await api.permissions.contains({ origins: [origin] });
  } catch (e) {
    return false;
  }
}

/** Compute the set of match patterns the content script should run on. */
async function computeMatches() {
  const { settings, rules } = await AL.loadState(api);
  if (!settings.enabled) return [];
  const matches = new Set();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const origin = AL.permissionOrigin(rule.urlPattern);
    // Local origins are declared in host_permissions; remote ones are optional
    // and only present after the user granted them from the options page.
    if (origin && (await hasOrigin(origin))) matches.add(origin);
  }
  return Array.from(matches);
}

let syncing = Promise.resolve();

function syncContentScripts() {
  // Serialize syncs; rapid storage writes would otherwise race on register/unregister.
  syncing = syncing.then(doSync, doSync);
  return syncing;
}

async function doSync() {
  try {
    const existing = await api.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length) await api.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch (e) {
    // Nothing registered yet.
  }

  const matches = await computeMatches();
  if (matches.length === 0) return { matches };

  const script = {
    id: SCRIPT_ID,
    matches,
    js: CONTENT_FILES,
    runAt: 'document_idle',
    allFrames: false,
    persistAcrossSessions: false,
  };
  try {
    await api.scripting.registerContentScripts([script]);
  } catch (e) {
    // Older Firefox versions do not know persistAcrossSessions.
    delete script.persistAcrossSessions;
    await api.scripting.registerContentScripts([script]);
  }
  return { matches };
}

// --- Badge -------------------------------------------------------------------

const BADGES = {
  filled: { text: '✓', color: '#16a34a' },
  submitted: { text: '✓', color: '#16a34a' },
  blocked: { text: '!', color: '#d97706' },
  waiting: { text: '…', color: '#6366f1' },
  idle: { text: '', color: '#6366f1' },
};

function setBadge(tabId, state) {
  const badge = BADGES[state] || BADGES.idle;
  if (tabId == null) return;
  api.action.setBadgeText({ tabId, text: badge.text }).catch(() => {});
  api.action.setBadgeBackgroundColor({ tabId, color: badge.color }).catch(() => {});
}

// --- Events ------------------------------------------------------------------

api.runtime.onInstalled.addListener(async (details) => {
  await syncContentScripts();
  if (details.reason === 'install') {
    api.runtime.openOptionsPage();
  }
});

api.runtime.onStartup.addListener(() => {
  syncContentScripts();
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[AL.STORAGE_KEY]) syncContentScripts();
});

if (api.permissions.onAdded) api.permissions.onAdded.addListener(() => syncContentScripts());
if (api.permissions.onRemoved) api.permissions.onRemoved.addListener(() => syncContentScripts());

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'status' && sender.tab) {
    setBadge(sender.tab.id, msg.state);
    return false;
  }

  if (msg.type === 'sync') {
    syncContentScripts().then(
      (res) => sendResponse({ ok: true, matches: res && res.matches }),
      (err) => sendResponse({ ok: false, error: String(err) })
    );
    return true;
  }

  if (msg.type === 'getRegistered') {
    api.scripting
      .getRegisteredContentScripts({ ids: [SCRIPT_ID] })
      .then((list) => sendResponse({ ok: true, scripts: list }), (err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});

// A fresh service worker (e.g. after the browser killed an idle one) must not assume
// that its registrations survived when persistAcrossSessions is false.
syncContentScripts();
