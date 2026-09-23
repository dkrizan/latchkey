/**
 * End-to-end test: loads dist/chrome into Chromium, runs it against the demo
 * React apps and captures the screenshots used in the README.
 *
 * Usage: npm run build && node test/e2e.mjs [--screenshots]
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, stats } from './demo-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extPath = join(root, 'dist/chrome');
const shots = process.argv.includes('--screenshots');
const docs = join(root, 'docs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stop = start();
const profile = mkdtempSync(join(tmpdir(), 'autologin-e2e-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1100, height: 820 },
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log('  ✓', name);
  } catch (e) {
    failures++;
    console.log('  ✗', name, '\n    ', e.message.split('\n')[0]);
  }
}

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const extUrl = (p) => `chrome-extension://${extId}/${p}`;

  // The options page opens itself on install; reuse it as our control page.
  await sleep(500);
  const control = context.pages().find((p) => p.url().includes('options.html')) || (await context.newPage());
  if (!control.url().includes('options.html')) await control.goto(extUrl('options/options.html'));

  const setState = async (state) => {
    await control.evaluate(async (s) => {
      await chrome.storage.local.set({ autologin: s });
      await chrome.runtime.sendMessage({ type: 'sync' });
    }, state);
    await sleep(200);
  };

  const acme = {
    id: 'acme',
    name: 'Acme Console (local)',
    enabled: true,
    urlPattern: 'http://localhost/login*',
    detect: { title: 'acme console', selector: '', mode: 'all' },
    username: 'demo@acme.test',
    password: 'secret',
    autoSubmit: true,
  };
  const baseSettings = { enabled: true, showToast: true, submitDelayMs: 300, maxAttempts: 2, attemptWindowSec: 60 };

  console.log('AutoLogin Rules e2e');

  await step('content script is registered only for granted origins', async () => {
    await setState({ settings: baseSettings, rules: [acme, { ...acme, id: 'remote', urlPattern: 'https://staging.example.com/*' }] });
    const res = await control.evaluate(() => chrome.runtime.sendMessage({ type: 'getRegistered' }));
    assert.deepEqual(res.scripts[0].matches, ['http://localhost/*']);
  });

  await step('fills a React form and submits it', async () => {
    await setState({ settings: baseSettings, rules: [acme] });
    const page = await context.newPage();
    await page.goto('http://localhost:4100/login');
    await page.waitForSelector('[data-testid="welcome"]', { timeout: 8000 });
    assert.match(await page.textContent('[data-testid="welcome"]'), /demo@acme\.test/);
    await page.close();
  });

  await step('page detection: same host, different app is left alone', async () => {
    const before = stats.submits[4200];
    const page = await context.newPage();
    await page.goto('http://localhost:4200/login');
    await page.waitForSelector('#email');
    await sleep(1500);
    assert.equal(await page.inputValue('#email'), '');
    assert.equal(stats.submits[4200], before);
    await page.close();
  });

  await step('fill-only rule fills without submitting', async () => {
    await setState({ settings: baseSettings, rules: [{ ...acme, autoSubmit: false }] });
    const before = stats.submits[4100];
    const page = await context.newPage();
    await page.goto('http://localhost:4100/login');
    await page.waitForFunction(() => document.querySelector('#password')?.value === 'secret', null, { timeout: 5000 });
    assert.equal(await page.inputValue('#email'), 'demo@acme.test');
    assert.equal(await page.isEnabled('[data-testid="submit"]'), true, 'React state updated');
    await sleep(800);
    assert.equal(stats.submits[4100], before);
    if (shots) {
      const tabId = await control.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost:4100/*' }))[0].id);
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 360, height: 600 });
      await popup.goto(extUrl(`popup/popup.html?tabId=${tabId}`));
      await popup.waitForSelector('.rule');
      await popup.locator('body').screenshot({ path: join(docs, 'popup.png') });
      await popup.emulateMedia({ colorScheme: 'dark' });
      await popup.locator('body').screenshot({ path: join(docs, 'popup-dark.png') });
      await popup.close();
    }
    await page.close();
  });

  await step('Esc cancels a pending auto-submit', async () => {
    await setState({ settings: { ...baseSettings, submitDelayMs: 4000 }, rules: [acme] });
    const before = stats.submits[4100];
    const page = await context.newPage();
    await page.goto('http://localhost:4100/login');
    await page.waitForFunction(() => document.querySelector('#password')?.value === 'secret');
    await sleep(400);
    if (shots) await page.screenshot({ path: join(docs, 'toast-countdown.png') });
    await page.keyboard.press('Escape');
    await sleep(4500);
    assert.equal(stats.submits[4100], before);
    await page.close();
  });

  await step('loop protection stops after maxAttempts with wrong password', async () => {
    await setState({ settings: baseSettings, rules: [{ ...acme, password: 'wrong' }] });
    const before = stats.submits[4100];
    const page = await context.newPage();
    await page.goto('http://localhost:4100/login');
    await sleep(6000);
    assert.equal(stats.submits[4100] - before, 2);
    assert.equal(await page.isVisible('[data-testid="error"]'), true);
    if (shots) await page.screenshot({ path: join(docs, 'toast-paused.png') });
    await page.close();
  });

  await step('global pause disables everything', async () => {
    await setState({ settings: { ...baseSettings, enabled: false }, rules: [acme] });
    const res = await control.evaluate(() => chrome.runtime.sendMessage({ type: 'getRegistered' }));
    assert.equal(res.scripts.length, 0);
  });

  await step('options page renders rules and validates the editor', async () => {
    await setState({
      settings: baseSettings,
      rules: [
        { ...acme, detect: { title: 'acme console', selector: '[data-testid="submit"]', mode: 'all' } },
        {
          id: 'api',
          name: 'Acme API docs (local)',
          urlPattern: 'http://localhost:8080/login*',
          detect: { title: '', selector: 'input[type="password"]', mode: 'all' },
          username: 'admin',
          password: 'admin',
          autoSubmit: false,
        },
        {
          id: 'staging',
          name: 'Staging',
          urlPattern: 'https://staging.example.com/*',
          detect: { title: 'staging', selector: '', mode: 'all' },
          username: 'qa@example.com',
          password: 'x',
          autoSubmit: false,
        },
        {
          id: 'old',
          name: 'Old prototype',
          enabled: false,
          urlPattern: 'http://127.0.0.1:5173/*',
          detect: { title: '', selector: '', mode: 'all' },
          username: 'test',
          password: 'test',
          autoSubmit: true,
        },
      ],
    });
    await control.reload();
    await control.waitForSelector('.rule');
    assert.equal(await control.locator('.rule').count(), 4);
    assert.equal(await control.locator('.rule .badge.warn').count(), 1, 'remote rule asks for access');

    await control.fill('#test-url', 'http://localhost:4100/login?next=/projects');
    await control.fill('#test-title', 'Acme Console');
    await control.waitForSelector('.test-results .badge.ok');

    if (shots) {
      await control.evaluate(() => window.scrollTo(0, 0));
      await control.locator('#test-title').blur();
      await control.screenshot({ path: join(docs, 'options.png'), fullPage: true });
      await control.emulateMedia({ colorScheme: 'dark' });
      await control.screenshot({ path: join(docs, 'options-dark.png'), fullPage: true });
      await control.emulateMedia({ colorScheme: 'light' });
    }

    await control.locator('.rule', { hasText: 'Staging' }).getByRole('button', { name: 'Edit' }).click();
    await control.waitForSelector('dialog[open]');
    await control.fill('#f-url', 'http://staging.example.com/*');
    assert.match(await control.textContent('#validation'), /Plain HTTP is only allowed for localhost/);
    await control.fill('#f-url', 'https://staging.example.com/*');
    await control.$eval('input[name="autoSubmit"]', (el) => { el.checked = !el.checked; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.match(await control.textContent('#validation'), /lock the account/);
    await control.$eval('input[name="autoSubmit"]', (el) => { el.checked = !el.checked; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await control.click('#cancel-edit');

    if (shots) {
      await control.locator('.rule', { hasText: 'Acme Console' }).getByRole('button', { name: 'Edit' }).click();
      await control.waitForSelector('dialog[open]');
      await control.click('.advanced summary');
      await control.setViewportSize({ width: 1100, height: 1180 });
      await sleep(200);
      await control.screenshot({ path: join(docs, 'editor.png') });
      await control.click('#cancel-edit');
      await control.setViewportSize({ width: 1100, height: 820 });
    }
  });

  await step('popup deep link creates a prefilled rule', async () => {
    await control.goto(extUrl('options/options.html?new=' + encodeURIComponent('http://localhost:4200/login')));
    await control.waitForSelector('dialog[open]');
    assert.equal(await control.inputValue('#f-url'), 'http://localhost:4200/login*');
    await control.fill('#f-name', 'Other App');
    await control.fill('#f-user', 'someone');
    await control.click('#save-rule');
    await control.waitForSelector('dialog:not([open])', { state: 'attached' });
    const saved = await control.evaluate(async () => (await chrome.storage.local.get('autologin')).autologin.rules.map((r) => r.name));
    assert.ok(saved.includes('Other App'));
  });
} finally {
  await context.close();
  stop();
  rmSync(profile, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
