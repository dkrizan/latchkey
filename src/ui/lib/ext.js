/**
 * Bridge between the React pages and the extension: browser API, shared core
 * logic (src/lib/core.js, a classic script that sets globalThis.LatchkeyCore)
 * and a hook that keeps React state in sync with chrome.storage.
 */
import { useCallback, useEffect, useState } from 'react';
import '../../lib/core.js';

export const api = globalThis.browser || globalThis.chrome;
export const AL = globalThis.LatchkeyCore;

/**
 * Runs the element picker in the tab a rule targets and resolves with the selector the user
 * clicked, or null when they cancelled. Call it from a click handler: granting access to the
 * site needs the user gesture. `access` is the origin -> granted map from useHostAccess.
 */
export async function pickElement(urlPattern, access) {
  const origin = AL.permissionOrigin(urlPattern);
  if (!origin) throw new Error('Enter the URL first.');
  if (!access[origin] && !(await api.permissions.request({ origins: [origin] }).catch(() => false))) {
    throw new Error('Latchkey needs access to the site to pick elements.');
  }

  const tabs = await api.tabs.query({ url: origin });
  const matching = tabs.filter((t) => AL.matchesUrl(urlPattern, t.url));
  const tab = matching.find((t) => t.active) || matching[0] || tabs.find((t) => t.active) || tabs[0];
  if (!tab) throw new Error(`Open ${origin.slice(origin.indexOf('//') + 2, -2)} in another tab first.`);

  const me = await api.tabs.getCurrent();
  const picked = new Promise((resolve) => {
    const done = (selector) => {
      api.runtime.onMessage.removeListener(onMessage);
      api.tabs.onRemoved.removeListener(onRemoved);
      api.tabs.onUpdated.removeListener(onUpdated);
      resolve(selector);
    };
    const onMessage = (msg, sender) => {
      if (msg && msg.type === 'picked' && sender.tab && sender.tab.id === tab.id) done(msg.selector);
    };
    const onRemoved = (tabId) => tabId === tab.id && done(null);
    const onUpdated = (tabId, info) => tabId === tab.id && info.status === 'loading' && done(null);
    api.runtime.onMessage.addListener(onMessage);
    api.tabs.onRemoved.addListener(onRemoved);
    api.tabs.onUpdated.addListener(onUpdated);
  });

  await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/core.js', 'content/picker.js'] });
  await api.tabs.update(tab.id, { active: true });
  if (me && me.windowId !== tab.windowId) await api.windows.update(tab.windowId, { focused: true });
  const selector = await picked;
  if (me) {
    await api.tabs.update(me.id, { active: true }).catch(() => {});
    if (me.windowId !== tab.windowId) await api.windows.update(me.windowId, { focused: true }).catch(() => {});
  }
  return selector;
}

export function isValidSelector(sel) {
  try {
    document.createDocumentFragment().querySelector(sel);
    return true;
  } catch {
    return false;
  }
}

/** Live extension state: { settings, rules } plus a save() that persists a new state. */
export function useExtensionState() {
  const [state, setState] = useState(null);

  useEffect(() => {
    let alive = true;
    AL.loadState(api).then((s) => alive && setState(s));
    const onChange = (changes, area) => {
      if (area === 'local' && changes[AL.STORAGE_KEY]) setState(AL.normalizeState(changes[AL.STORAGE_KEY].newValue));
    };
    api.storage.onChanged.addListener(onChange);
    return () => {
      alive = false;
      api.storage.onChanged.removeListener(onChange);
    };
  }, []);

  const save = useCallback(async (next) => {
    const saved = await AL.saveState(api, next);
    setState(saved);
    return saved;
  }, []);

  return [state, save];
}

/** origin -> granted, for the local origins and every origin a rule needs. */
export function useHostAccess(rules) {
  const [access, setAccess] = useState({});
  const key = (rules || []).map((r) => r.urlPattern).join('|');

  const refresh = useCallback(async () => {
    const origins = new Set(AL.LOCAL_ORIGINS);
    for (const r of rules || []) {
      const o = AL.permissionOrigin(r.urlPattern);
      if (o) origins.add(o);
    }
    const entries = await Promise.all(
      [...origins].map(async (o) => [o, await api.permissions.contains({ origins: [o] }).catch(() => false)])
    );
    setAccess(Object.fromEntries(entries));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    refresh();
    const on = () => refresh();
    api.permissions.onAdded?.addListener(on);
    api.permissions.onRemoved?.addListener(on);
    return () => {
      api.permissions.onAdded?.removeListener(on);
      api.permissions.onRemoved?.removeListener(on);
    };
  }, [refresh]);

  return [access, refresh];
}

export function detectionSummary(rule) {
  const parts = [];
  if (rule.detect.title) parts.push(`title ~ "${rule.detect.title}"`);
  if (rule.detect.selector) parts.push(rule.detect.selector);
  if (!parts.length) return null;
  return parts.join(rule.detect.mode === 'any' ? ' or ' : ' + ');
}
