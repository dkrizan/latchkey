#!/usr/bin/env node
/**
 * Records docs/demo.gif: the rules page with a short, scripted walkthrough.
 * Needs a fresh build (dist/chrome) and ffmpeg on the PATH.
 *
 * Usage: npm run build && node scripts/record-demo.mjs
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extPath = join(root, 'dist/chrome');
const out = join(root, 'docs/demo.gif');
const size = { width: 900, height: 600 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rules = [
  {
    id: 'acme',
    name: 'Acme Console (local)',
    urlPattern: 'http://localhost/login*',
    detect: { title: 'acme console', selector: '[data-testid="submit"]', mode: 'all' },
    username: 'demo@acme.test',
    password: 'secret',
    autoSubmit: true,
  },
  { id: 'api', name: 'Acme API docs (local)', urlPattern: 'http://localhost:8080/login*', username: 'admin', password: 'admin' },
  { id: 'staging', name: 'Staging', urlPattern: 'https://staging.example.com/*', detect: { title: 'staging' }, username: 'qa@example.com', password: 'x' },
  { id: 'old', name: 'Old prototype', enabled: false, urlPattern: 'http://127.0.0.1:5173/*', username: 'test', password: 'test', autoSubmit: true },
];

// Headless recordings have no cursor, so draw one that follows the mouse. Also freeze the
// drifting backdrop: it changes every pixel of every frame and would bloat the GIF.
function prepareRecording() {
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '.animate-float-a, .animate-float-b { animation: none !important; }';
    document.head.append(style);
    const c = document.createElement('div');
    c.style.cssText =
      'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;z-index:2147483647;pointer-events:none;' +
      'background:rgba(20,20,30,.35);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);transition:transform .12s;transform:translate(-99px,-99px)';
    document.documentElement.append(c);
    let x = -99, y = -99, s = 1;
    const place = () => (c.style.transform = `translate(${x}px,${y}px) scale(${s})`);
    addEventListener('mousemove', (e) => ((x = e.clientX), (y = e.clientY), place()), true);
    addEventListener('mousedown', () => ((s = 0.7), place()), true);
    addEventListener('mouseup', () => ((s = 1), place()), true);
  });
}

const profile = mkdtempSync(join(tmpdir(), 'latchkey-demo-'));
const frames = mkdtempSync(join(tmpdir(), 'latchkey-frames-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: size,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const url = `chrome-extension://${new URL(sw.url()).host}/options.html`;

  // Seed the rules on the page the extension opens on install, then record a fresh page.
  await sleep(500);
  const seed = context.pages().find((p) => p.url().includes('options.html')) || (await context.newPage());
  if (!seed.url().includes('options.html')) await seed.goto(url);
  await seed.evaluate(
    (state) => chrome.storage.local.set({ autologin: state }),
    { settings: { enabled: true, showToast: true, submitDelayMs: 800, maxAttempts: 2, attemptWindowSec: 60 }, rules }
  );

  await context.addInitScript(prepareRecording);
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('[data-testid="rule"]');
  await seed.close();
  await page.mouse.move(size.width / 2, size.height - 40);
  await sleep(900); // entrance animation

  // Playwright's video capture pads new-headless frames, so grab screenshots in a loop instead.
  const shots = [];
  let recording = true;
  const recorder = (async () => {
    while (recording) {
      const file = join(frames, `${String(shots.length).padStart(5, '0')}.jpg`);
      const t = Date.now();
      await page.screenshot({ path: file, type: 'jpeg', quality: 92, caret: 'initial' });
      shots.push({ file, t });
    }
  })();

  const moveTo = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
    await sleep(200);
  };
  const click = async (locator, pause = 600) => {
    await moveTo(locator);
    await page.mouse.down();
    await sleep(80);
    await page.mouse.up();
    await sleep(pause);
  };
  const row = (name) => page.locator('[data-testid="rule"]', { hasText: name });
  const menu = (name) => page.getByRole('button', { name: `More actions for ${name}`, exact: true });
  const item = (name) => page.getByRole('menuitem', { name });

  // The editor comes first: the toasts from the list actions would cover its footer.
  await sleep(800);
  await click(row('Acme Console (local)').getByTestId('edit-rule'), 1100);
  await click(page.locator('#f-url'), 1400);
  await click(page.getByRole('radio', { name: 'OR' }), 800);
  await click(page.locator('#cancel-edit'), 900);

  await click(menu('Acme Console (local)'));
  await click(item('Move down'), 900);
  await click(row('Old prototype').getByRole('switch'), 900);
  await click(menu('Acme API docs (local)'));
  await click(item('Duplicate'), 900);
  await click(menu('Acme API docs (local) (copy)'));
  await click(item('Delete'), 700);
  await click(page.getByRole('button', { name: 'Delete', exact: true }), 1000);

  await click(page.locator('#global-enabled'), 1300);
  await click(page.getByRole('button', { name: 'Resume' }), 1300);

  recording = false;
  await recorder;

  // Each screenshot is shown until the next one was taken.
  const list = join(frames, 'frames.txt');
  const lines = shots.map((s, i) => `file '${s.file}'\nduration ${((shots[i + 1]?.t ?? s.t + 100) - s.t) / 1000}`);
  writeFileSync(list, [...lines, `file '${shots.at(-1).file}'`].join('\n'));
  const filters =
    'fps=12,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', filters, '-loop', '0', out]);
  console.log(`recorded ${out} from ${shots.length} frames`);
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(frames, { recursive: true, force: true });
}
