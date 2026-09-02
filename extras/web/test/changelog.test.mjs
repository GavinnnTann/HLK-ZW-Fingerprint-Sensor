// changelog.js integrity — run with: node --test test/
//
// The release notes are hand-maintained data, so these tests guard the shape
// the "What's new" tab renders: newest first, no duplicate or missing versions,
// and only kinds the tab knows how to label.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CHANGELOG, LATEST } from '../src/changelog.js';

const KINDS = new Set(['added', 'changed', 'fixed', 'note']);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const cmp = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

test('every entry has a semver version, a title and at least one change', () => {
  for (const rel of CHANGELOG) {
    assert.match(rel.version, /^\d+\.\d+\.\d+$/, `bad version: ${rel.version}`);
    assert.ok(rel.title, `${rel.version} has no title`);
    assert.ok(rel.changes.length > 0, `${rel.version} has no changes`);
  }
});

test('entries are newest first, with no duplicate versions', () => {
  const versions = CHANGELOG.map((r) => r.version);
  assert.equal(new Set(versions).size, versions.length, 'duplicate version');
  for (let i = 1; i < versions.length; i++) {
    assert.ok(cmp(versions[i - 1], versions[i]) > 0,
      `${versions[i - 1]} should sort above ${versions[i]}`);
  }
  assert.equal(LATEST, CHANGELOG[0]);
});

test('dates are ISO days, or null for an untagged version', () => {
  for (const rel of CHANGELOG) {
    if (rel.date === null) continue;
    assert.match(rel.date, /^\d{4}-\d{2}-\d{2}$/, `bad date on ${rel.version}`);
    assert.ok(!Number.isNaN(Date.parse(rel.date)), `unparseable date on ${rel.version}`);
  }
});

test('every change is a [kind, text] pair the tab can label', () => {
  for (const rel of CHANGELOG) {
    for (const change of rel.changes) {
      assert.equal(change.length, 2, `${rel.version}: not a [kind, text] pair`);
      const [kind, text] = change;
      assert.ok(KINDS.has(kind), `${rel.version}: unknown kind "${kind}"`);
      assert.ok(typeof text === 'string' && text.length > 0, `${rel.version}: empty text`);
    }
  }
});

// The header chip reads package.json via __APP_VERSION__, and the tab marks the
// matching entry "you are here". A bumped version with no entry loses that
// marker and ships a changelog that never mentions the running build.
test('package.json version has a changelog entry', () => {
  const versions = CHANGELOG.map((r) => r.version);
  assert.ok(versions.includes(pkg.version),
    `package.json is ${pkg.version}, which has no CHANGELOG entry (have: ${versions.join(', ')})`);
});
