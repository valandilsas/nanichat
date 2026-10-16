import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEMO_FACEBOOK_ACCOUNTS, DemoProvider } from '../docs/manual/tools/demo-provider.ts';
import { assertSafeDataDir, assertSafePort, assertTutorialOutput, TUTORIAL_IMAGE_STEPS } from '../docs/manual/tools/capture-guards.mjs';

test('demo discovery returns only Instagram accounts unless the connection is Facebook Login with pages enabled', async () => {
  const plain = await new DemoProvider({ speed: 0 }).discoverAccounts('c1');
  assert.ok(plain.every((account) => account.platform === undefined));
  const facebookOff = await new DemoProvider({ speed: 0, facebookDiscovery: () => false }).discoverAccounts('c1');
  assert.ok(facebookOff.every((account) => account.platform === undefined));
  const accounts = await new DemoProvider({ speed: 0, facebookDiscovery: (id) => id === 'c1' }).discoverAccounts('c1');
  const pages = accounts.filter((account) => account.platform === 'facebook');
  assert.ok(pages.length >= 1);
  assert.equal(pages[0]!.displayName, 'Tu Página de ejemplo');
  const linked = accounts.find((account) => account.platform === undefined && account.relatedPageId === pages[0]!.providerAccountId);
  assert.ok(linked, 'a fictitious Instagram account linked to the Page');
  assert.equal(DEMO_FACEBOOK_ACCOUNTS.length, accounts.length);
  for (const account of accounts) assert.match(JSON.stringify(account), /tu_|ejemplo|demo/iu);
});

test('capture guards refuse the real ports, non-/tmp data dirs and output outside public/tutorial', () => {
  for (const port of [3000, 3100]) assert.throws(() => assertSafePort(port), /reserved|refus/iu, String(port));
  assert.throws(() => assertSafePort(0));
  assert.throws(() => assertSafePort(70000));
  assert.doesNotThrow(() => assertSafePort(41234));
  assert.throws(() => assertSafeDataDir('/home/someone/data'), /\/tmp/u);
  assert.throws(() => assertSafeDataDir('./data'), /\/tmp/u);
  assert.throws(() => assertSafeDataDir('/tmp/../home/x'), /\/tmp/u);
  assert.throws(() => assertSafeDataDir(undefined));
  assert.doesNotThrow(() => assertSafeDataDir('/tmp/social-tutorial-a-abc'));
  const root = '/repo';
  assert.equal(assertTutorialOutput(root, 'instagram', 'pegar-token'), '/repo/public/tutorial/instagram/pegar-token.png');
  for (const [platform, id] of [['..', 'x'], ['instagram', '../../x'], ['instagram', 'a/b'], ['tiktok', 'x'], ['instagram', 'X'], ['instagram', '']] as const) {
    assert.throws(() => assertTutorialOutput(root, platform, id), /refus|invalid/iu, `${platform}/${id}`);
  }
  assert.ok(TUTORIAL_IMAGE_STEPS.length >= 5);
});

test('capture-tutorial.mjs refuses reserved ports and foreign data dirs before touching Chrome or the server', () => {
  for (const env of [{ TUTORIAL_CAPTURE_PORT: '3000' }, { TUTORIAL_CAPTURE_PORT: '3100' }, { TUTORIAL_CAPTURE_DATA_PARENT: '/home' }]) {
    const run = spawnSync(process.execPath, ['docs/manual/tools/capture-tutorial.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, ...env, CHROME_BIN: '/nonexistent' }, encoding: 'utf8', timeout: 20_000 });
    assert.notEqual(run.status, 0, JSON.stringify(env));
    assert.match(run.stderr, /refus/iu, JSON.stringify(env));
  }
});

test('capture-tutorial.mjs writes only through the output guard and never names the real ports or ./data', () => {
  const source = readFileSync(new URL('../docs/manual/tools/capture-tutorial.mjs', import.meta.url), 'utf8');
  assert.match(source, /assertTutorialOutput/u);
  assert.match(source, /assertSafePort/u);
  assert.doesNotMatch(source, /writeFileSync\((?!output)/u, 'every write goes to the guarded output path');
  assert.doesNotMatch(source, /\.\/data|join\([^)]*['"]data['"]|\bport\s*[:=]\s*3[01]00\b/u);
});
