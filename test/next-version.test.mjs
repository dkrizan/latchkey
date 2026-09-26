import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion } from '../scripts/next-version.mjs';

test('nextVersion bumps by Conventional Commit type', () => {
  assert.equal(nextVersion(null, ['feat: anything']), '0.1.0', 'first release');
  assert.equal(nextVersion('0.4.2', ['fix: typo', 'chore: deps']), '0.4.3');
  assert.equal(nextVersion('0.4.2', ['docs: readme', 'feat(editor): AND/OR toggle (#9)']), '0.5.0');
  assert.equal(nextVersion('0.4.2', ['fix: storage\n\nBREAKING CHANGE: rules move to a new key']), '1.0.0');
  assert.equal(nextVersion('0.4.2', ['feature: not a real type']), '0.4.3', 'only exact types count');
  assert.equal(nextVersion('0.4.2', ['fix: mention BREAKING CHANGE: inline']), '0.4.3', 'footer must start a line');
});
