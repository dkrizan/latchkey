/**
 * Bridge between the React pages and the extension: browser API, shared core
 * logic (src/lib/core.js, a classic script that sets globalThis.AutoLoginCore)
 * and a hook that keeps React state in sync with chrome.storage.
 */
import { useCallback, useEffect, useState } from 'react';
import '../../lib/core.js';

export const api = globalThis.browser || globalThis.chrome;
export const AL = globalThis.AutoLoginCore;

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
