import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/core/config.ts';
import { openDatabase } from '../src/db/database.ts';
import { migrateDatabase } from '../src/db/migrations.ts';
import { createConnection, listEncryptedCredentials } from '../src/db/repositories.ts';
import { MetaProvider } from '../src/providers/meta/provider.ts';
import { createVault } from '../src/security/vault.ts';
import { FACEBOOK_PAGES_AVAILABLE, facebookPagesAvailable } from '../src/services/facebook-pages-rules.ts';
import { removeTempDir } from './helpers/tmp.ts';

test('SOCIAL_DESK_FACEBOOK_PAGES: only "1" or "true" (any case, trimmed) enables Facebook Pages', () => {
  assert.equal(loadConfig({}, '/app').facebookPages, false);
  for (const on of ['1', 'true', 'TRUE', 'True', ' 1 ', ' true\n']) {
    assert.equal(loadConfig({ SOCIAL_DESK_FACEBOOK_PAGES: on }, '/app').facebookPages, true, on);
  }
  for (const off of ['', '0', 'false', 'yes', 'on', 'si', '2', 'truee', 'enable']) {
    assert.equal(loadConfig({ SOCIAL_DESK_FACEBOOK_PAGES: off }, '/app').facebookPages, false, off);
  }
});

test('the env opt-in never touches the constant default', () => {
  loadConfig({ SOCIAL_DESK_FACEBOOK_PAGES: '1' }, '/app');
  assert.equal(FACEBOOK_PAGES_AVAILABLE, false);
  assert.equal(facebookPagesAvailable(), false);
});

test('server.ts hands the opt-in to the provider, connections, scanner, scheduler and queue', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'server.ts'), 'utf8');
  assert.match(source, /config\.facebookPages/u);
  for (const service of ['new MetaProvider(', 'new QueueService(', 'new Scanner(', 'new ConnectionService(', 'createScheduler(']) {
    const line = source.split('\n').find((candidate) => candidate.includes(service));
    assert.ok(line && /facebookPagesAvailable|facebookPages/u.test(line), `${service} must receive the Facebook Pages option`);
  }
});

test('with the env flag on, a mock Page flows through discovery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'social-fboptin-'));
  const db = openDatabase(directory);
  try {
    migrateDatabase(db);
    const vault = createVault(directory, () => listEncryptedCredentials(db));
    createConnection(db, {
      id: 'fb', name: 'FB', providerCode: 'META', loginKind: 'facebook_login', graphVersion: 'v26.0', status: 'valid',
      accessToken: vault.encrypt('fb', 'user-token'),
    });
    const fetcher = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me/accounts')) {
        return new Response(JSON.stringify({ data: [{ id: 'page-1', name: 'Mock Page', access_token: 'page-token', tasks: ['MANAGE', 'MODERATE'] }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'page-1' }), { status: 200 });
    }) as typeof fetch;
    const enabled = loadConfig({ SOCIAL_DESK_FACEBOOK_PAGES: 'TRUE' }, '/app').facebookPages;
    const found = await new MetaProvider(db, vault, fetcher, { facebookPagesAvailable: enabled }).discoverAccounts('fb');
    assert.deepEqual(found.map((account) => [account.providerAccountId, account.platform]), [['page-1', 'facebook']]);
    const off = await new MetaProvider(db, vault, fetcher, { facebookPagesAvailable: loadConfig({}, '/app').facebookPages }).discoverAccounts('fb');
    assert.deepEqual(off, []);
  } finally { db.close(); removeTempDir(directory); }
});
