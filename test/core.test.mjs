import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/lib/core.js';

const AL = globalThis.LatchkeyCore;

test('parseUrlPattern accepts common patterns', () => {
  for (const p of [
    'http://localhost/*',
    'http://localhost:3000/login*',
    'http://localhost:*/*',
    'https://*.example.com/*',
    '*://127.0.0.1:8080/*',
    'https://app.example.com',
    'http://[::1]:3000/*',
    'http://localhost:3000-3999/*',
    'http://localhost:3*/*',
  ]) {
    assert.equal(AL.parseUrlPattern(p).ok, true, p);
  }
});

test('parseUrlPattern rejects invalid patterns', () => {
  for (const p of ['', 'localhost:3000', 'ftp://x.com/*', 'https://ex*ample.com/*', 'http://localhost:99999/*', 'http://localhost:4000-3000/*', 'http://localhost:0-10/*']) {
    assert.equal(AL.parseUrlPattern(p).ok, false, p);
  }
});

test('matchesUrl: ports', () => {
  assert.ok(AL.matchesUrl('http://localhost/*', 'http://localhost:3000/login'));
  assert.ok(AL.matchesUrl('http://localhost:*/*', 'http://localhost:8080/'));
  assert.ok(AL.matchesUrl('http://localhost:3000/*', 'http://localhost:3000/x'));
  assert.ok(!AL.matchesUrl('http://localhost:3000/*', 'http://localhost:3001/x'));
  assert.ok(AL.matchesUrl('https://example.com:443/*', 'https://example.com/x'));
});

test('matchesUrl: port ranges and prefixes', () => {
  assert.ok(AL.matchesUrl('http://localhost:3000-3999/*', 'http://localhost:3000/'));
  assert.ok(AL.matchesUrl('http://localhost:3000-3999/*', 'http://localhost:3999/login'));
  assert.ok(!AL.matchesUrl('http://localhost:3000-3999/*', 'http://localhost:4000/'));
  assert.ok(!AL.matchesUrl('http://localhost:3000-3999/*', 'http://localhost/'));
  assert.ok(AL.matchesUrl('http://localhost:3*/*', 'http://localhost:3100/'));
  assert.ok(AL.matchesUrl('http://localhost:3*/*', 'http://localhost:30000/'));
  assert.ok(!AL.matchesUrl('http://localhost:3*/*', 'http://localhost:8030/'));
  assert.ok(AL.matchesUrl('http://localhost:80-90/*', 'http://localhost/'), 'default port 80');
  assert.equal(AL.permissionOrigin('http://localhost:3000-3999/login*'), 'http://localhost/*');
});

test('matchesUrl: scheme and host wildcards', () => {
  assert.ok(AL.matchesUrl('*://localhost/*', 'https://localhost/'));
  assert.ok(!AL.matchesUrl('https://localhost/*', 'http://localhost/'));
  assert.ok(AL.matchesUrl('https://*.example.com/*', 'https://a.b.example.com/x'));
  assert.ok(AL.matchesUrl('https://*.example.com/*', 'https://example.com/'));
  assert.ok(!AL.matchesUrl('https://*.example.com/*', 'https://badexample.com/'));
  assert.ok(!AL.matchesUrl('https://example.com/*', 'https://example.com.evil.io/'));
});

test('matchesUrl: path glob includes query, not hash', () => {
  assert.ok(AL.matchesUrl('http://localhost/login*', 'http://localhost:3000/login?next=/x'));
  assert.ok(AL.matchesUrl('http://localhost/login', 'http://localhost/login#frag'));
  assert.ok(!AL.matchesUrl('http://localhost/login', 'http://localhost/login/extra'));
  assert.ok(AL.matchesUrl('http://localhost', 'http://localhost/anything'));
  assert.ok(!AL.matchesUrl('http://localhost/a.b', 'http://localhost/aXb'), 'dot is literal');
});

test('permissionOrigin drops port and path', () => {
  assert.equal(AL.permissionOrigin('http://localhost:3000/login*'), 'http://localhost/*');
  assert.equal(AL.permissionOrigin('https://*.example.com/app/*'), 'https://*.example.com/*');
  assert.equal(AL.permissionOrigin('nope'), null);
});

test('isLocalHost / isSecureEnough', () => {
  assert.ok(AL.isLocalHost('localhost'));
  assert.ok(AL.isLocalHost('app.localhost'));
  assert.ok(AL.isLocalHost('127.0.0.1'));
  assert.ok(!AL.isLocalHost('example.com'));
  assert.ok(AL.isSecureEnough('http://localhost:3000/'));
  assert.ok(AL.isSecureEnough('https://example.com/'));
  assert.ok(!AL.isSecureEnough('http://example.com/'));
});

test('parseTitleMatcher: substring and regex', () => {
  const sub = AL.parseTitleMatcher('My App');
  assert.ok(sub('Login | my app'));
  assert.ok(!sub('Other'));
  const re = AL.parseTitleMatcher('/^Login/i');
  assert.ok(re('login - x'));
  assert.ok(!re('x login'));
  assert.ok(AL.parseTitleMatcher('/[/').error);
  assert.equal(AL.parseTitleMatcher(''), null);
});

test('evaluateDetection: all / any / none', () => {
  const doc = { title: 'My App', querySelector: (s) => (s === '#ok' ? {} : null) };
  const rule = (detect) => AL.createRule({ detect });
  assert.equal(AL.evaluateDetection(rule({}), doc).ok, true);
  assert.equal(AL.evaluateDetection(rule({ title: 'my app', selector: '#ok' }), doc).ok, true);
  assert.equal(AL.evaluateDetection(rule({ title: 'my app', selector: '#nope' }), doc).ok, false);
  assert.equal(AL.evaluateDetection(rule({ title: 'other', selector: '#ok', mode: 'any' }), doc).ok, true);
  assert.equal(AL.evaluateDetection(rule({ title: 'other', selector: '#nope', mode: 'any' }), doc).ok, false);
});

test('validateRule', () => {
  const ok = AL.validateRule(AL.createRule({ name: 'x', urlPattern: 'http://localhost/*', username: 'a' }));
  assert.equal(ok.ok, true);

  const http = AL.validateRule(AL.createRule({ name: 'x', urlPattern: 'http://example.com/*', username: 'a' }));
  assert.equal(http.ok, false);

  const noCreds = AL.validateRule(AL.createRule({ name: 'x', urlPattern: 'http://localhost/*' }));
  assert.equal(noCreds.ok, false);

  const remoteAuto = AL.validateRule(AL.createRule({ name: 'x', urlPattern: 'https://example.com/*', username: 'a', autoSubmit: true }));
  assert.equal(remoteAuto.ok, true);
  assert.equal(remoteAuto.warnings.length, 1);

  const everything = AL.validateRule(AL.createRule({ name: 'x', urlPattern: 'https://*/*', password: 'p' }));
  assert.ok(everything.warnings.some((w) => w.includes('every website')));

  const badSel = AL.validateRule(AL.createRule({ name: 'x', urlPattern: 'http://localhost/*', username: 'a', usernameSelector: '[[' }), (s) => !s.includes('[['));
  assert.equal(badSel.ok, false);
});

test('normalizeState fills defaults', () => {
  const s = AL.normalizeState({ rules: [{ name: 'a', urlPattern: 'http://localhost/*' }] });
  assert.equal(s.settings.maxAttempts, AL.DEFAULT_SETTINGS.maxAttempts);
  assert.equal(s.rules[0].detect.mode, 'all');
  assert.ok(s.rules[0].id);
});

test('export / import round trip, ids de-duplicated', () => {
  const state = AL.normalizeState({ rules: [{ id: 'same', name: 'a', urlPattern: 'http://localhost/*', username: 'u' }] });
  const json = AL.exportState(state);
  const merged = AL.importState(json, state);
  assert.equal(merged.rules.length, 2);
  assert.notEqual(merged.rules[0].id, merged.rules[1].id);
  assert.throws(() => AL.importState('{"x":1}', state));
});

test('storage helpers use the given api', async () => {
  const store = {};
  const api = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([].concat(keys).map((k) => [k, store[k]])),
        set: async (obj) => Object.assign(store, obj),
        remove: async (k) => delete store[k],
      },
    },
  };
  const empty = await AL.loadState(api);
  assert.deepEqual(empty.rules, []);
  await AL.saveState(api, { rules: [{ name: 'r', urlPattern: 'http://localhost/*' }] });
  const loaded = await AL.loadState(api);
  assert.equal(loaded.rules[0].name, 'r');
  assert.ok(store.latchkey);

  // State saved under the pre-rename key moves to the new one.
  for (const k of Object.keys(store)) delete store[k];
  store.autologin = { rules: [{ name: 'old', urlPattern: 'http://localhost/*' }] };
  assert.equal((await AL.loadState(api)).rules[0].name, 'old');
  assert.deepEqual(Object.keys(store), ['latchkey']);
});

test('templates are valid once credentials are added', () => {
  for (const t of AL.TEMPLATES) {
    const r = AL.createRule({ ...t.rule, username: 'u', password: 'p' });
    assert.equal(AL.validateRule(r).ok, true, t.key);
  }
});
