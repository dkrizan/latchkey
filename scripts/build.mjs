#!/usr/bin/env node
/**
 * Builds browser-specific bundles:
 *
 *   dist/chrome/   + dist/latchkey-chrome-<version>.zip
 *   dist/firefox/  + dist/latchkey-firefox-<version>.zip
 *
 * Steps:
 *   1. Vite builds the React pages (options.html, popup.html) into build/ui.
 *   2. The plain scripts (background, content script, core) and icons are copied as-is,
 *      except that the toast logo is inlined into the content script.
 *      They must stay classic scripts: the content script and the Firefox background
 *      page cannot be ES modules.
 *   3. A manifest is written per browser. The only differences are the background
 *      declaration and Firefox's browser_specific_settings.
 *
 * The version comes from $VERSION (set by the release workflow), else the latest v* tag,
 * else package.json's 0.0.0 placeholder.
 *
 * Usage: node scripts/build.mjs [--no-zip]
 */
import { build } from 'vite';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastReleased } from './next-version.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const src = join(root, 'src');
const dist = join(root, 'dist');
const zip = !process.argv.includes('--no-zip');
const version = process.env.VERSION || lastReleased() || pkg.version;

await build({ configFile: join(root, 'vite.config.js'), logLevel: 'warn' });

const base = {
  manifest_version: 3,
  name: 'Latchkey',
  short_name: 'Latchkey',
  version,
  description: 'Fill and submit login forms automatically, based on your own URL and page-detection rules.',
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  action: {
    default_title: 'Latchkey',
    default_popup: 'popup.html',
    default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
  },
  options_ui: { page: 'options.html', open_in_tab: true },
  permissions: ['storage', 'scripting', 'activeTab'],
  host_permissions: ['*://localhost/*', '*://127.0.0.1/*'],
  optional_host_permissions: ['*://*/*'],
};

const targets = {
  chrome: {
    ...base,
    minimum_chrome_version: '110',
    background: { service_worker: 'background.js' },
  },
  firefox: {
    ...base,
    background: { scripts: ['lib/core.js', 'background.js'] },
    browser_specific_settings: {
      gecko: {
        id: 'latchkey@dkrizan.github.io',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const [name, manifest] of Object.entries(targets)) {
  const out = join(dist, name);
  cpSync(join(root, 'build/ui'), out, { recursive: true });
  for (const entry of ['background.js', 'content', 'lib', 'icons']) {
    cpSync(join(src, entry), join(out, entry), { recursive: true });
  }
  // The toast lives in the page, so its logo has to travel inside the content script.
  const content = join(out, 'content/content.js');
  const icon = 'data:image/png;base64,' + readFileSync(join(src, 'icons/icon-32.png')).toString('base64');
  writeFileSync(content, readFileSync(content, 'utf8').replace('__LATCHKEY_ICON__', icon));
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (zip) {
    const file = join(dist, `latchkey-${name}-${version}.zip`);
    if (existsSync(file)) rmSync(file);
    execFileSync('zip', ['-qr', file, '.'], { cwd: out });
    console.log('built', file);
  } else {
    console.log('built', out);
  }
}
