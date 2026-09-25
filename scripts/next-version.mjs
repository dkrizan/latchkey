#!/usr/bin/env node
/**
 * Prints the next release version, worked out from the Conventional Commits since
 * the last v* tag: a BREAKING CHANGE footer bumps major, feat bumps minor, anything
 * else bumps patch. The first release is 0.1.0. Releases live in git tags only.
 *
 * Usage: node scripts/next-version.mjs
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function nextVersion(last, messages) {
  if (!last) return '0.1.0';
  const [major, minor, patch] = last.split('.').map(Number);
  if (messages.some((m) => /^BREAKING[ -]CHANGE:/m.test(m))) return `${major + 1}.0.0`;
  if (messages.some((m) => /^feat(\([^)]+\))?:/.test(m))) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Version of the latest v* tag reachable from HEAD, or null before the first release. */
export function lastReleased() {
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return tag.trim().slice(1);
  } catch (e) {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const last = lastReleased();
  const log = execFileSync('git', ['log', '--format=%B%x00', last ? `v${last}..HEAD` : 'HEAD'], { encoding: 'utf8' });
  const messages = log.split('\0').map((m) => m.trim()).filter(Boolean);
  console.log(nextVersion(last, messages));
}
