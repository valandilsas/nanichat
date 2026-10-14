import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AccountRef, ConnectionValidation, DiscoveredAccount } from '../src/core/domain.ts';
import { AccountAdoptionRequiredError, PlatformNotSupportedError, RepositoryConflictError } from '../src/core/errors.ts';
import { openDatabase } from '../src/db/database.ts';
import { migrateDatabase } from '../src/db/migrations.ts';
import {
  addDiscoveredAccount, createConnection, createMedia, getAccountSummary, listAccountSummaries, listEncryptedCredentials,
} from '../src/db/repositories.ts';
import { createApiHandler } from '../src/http/router.ts';
import { MetaProvider } from '../src/providers/meta/provider.ts';
import { createVault } from '../src/security/vault.ts';
import { ConnectionService } from '../src/services/connections.ts';
import { FACEBOOK_PAGES_AVAILABLE, facebookPagesAvailable } from '../src/services/facebook-pages-rules.ts';
import { Scanner } from '../src/services/scanner.ts';
import { Scheduler } from '../src/services/scheduler.ts';
import { QueueService } from '../src/services/queue.ts';
import { removeTempDir } from './helpers/tmp.ts';

async function withEnv(run: (directory: string, db: ReturnType<typeof openDatabase>) => Promise<void> | void): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'social-fbpages-'));
  const db = openDatabase(directory);
  migrateDatabase(db);
  try { await run(directory, db); } finally { db.close(); removeTempDir(directory); }
}

// ---------------------------------------------------------------- T1: migration v19

test('migration v19 backfills existing accounts as instagram and constrains the platform column', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'social-fbpages-mig-'));
  const db = openDatabase(directory);
  try {
    migrateDatabase(db, 18);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 18);
    const now = '2026-10-01T00:00:00Z';
    db.prepare(`INSERT INTO connections (id, name, provider_code, login_kind, graph_version, status, created_at, updated_at)
      VALUES ('c1', 'C', 'META', 'facebook_login', 'v26.0', 'valid', ?, ?)`).run(now, now);
    db.prepare(`INSERT INTO social_accounts (account_id, connection_id, provider_account_id, username, normalized_username, status,
      created_at, updated_at) VALUES ('a1', 'c1', 'p1', 'Brand', 'brand', 'valid', ?, ?)`).run(now, now);
    migrateDatabase(db);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 19);
    assert.equal((db.prepare("SELECT platform FROM social_accounts WHERE account_id='a1'").get() as { platform: string }).platform, 'instagram');
    assert.throws(() => db.prepare("UPDATE social_accounts SET platform='tiktok' WHERE account_id='a1'").run(), /CHECK|constraint/i);
    db.prepare("UPDATE social_accounts SET platform='facebook' WHERE account_id='a1'").run();
    assert.equal(getAccountSummary(db, 'a1').platform, 'facebook');
  } finally { db.close(); removeTempDir(directory); }
});

test('a database newer than the supported schema is still rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'social-fbpages-new-'));
  const db = openDatabase(directory);
  try {
    migrateDatabase(db);
    db.exec('PRAGMA user_version = 20');
    assert.throws(() => migrateDatabase(db), /newer than supported/i);
  } finally { db.close(); removeTempDir(directory); }
});

// ---------------------------------------------------------------- T1/T2: repositories and rules

test('the Facebook Pages switch ships off and only an explicit test override changes it', () => {
  assert.equal(FACEBOOK_PAGES_AVAILABLE, false);
  assert.equal(facebookPagesAvailable(), false);
  assert.equal(facebookPagesAvailable(true), true);
});

test('addDiscoveredAccount defaults to instagram and namespaces the normalized username of Pages', async () => {
  await withEnv((_directory, db) => {
    createConnection(db, { id: 'c1', name: 'C', providerCode: 'META', loginKind: 'facebook_login', graphVersion: 'v26.0', status: 'valid' });
    addDiscoveredAccount(db, { accountId: 'ig', connectionId: 'c1', providerAccountId: 'ig-1', username: 'Brand Page', status: 'valid' });
    addDiscoveredAccount(db, {
      accountId: 'pg', connectionId: 'c1', providerAccountId: 'page-1', username: 'Brand Page', platform: 'facebook',
      accountType: 'PAGE', relatedPageId: 'page-1', status: 'valid',
    });
    assert.equal(getAccountSummary(db, 'ig').platform, 'instagram');
    assert.equal(getAccountSummary(db, 'pg').platform, 'facebook');
    const rows = db.prepare('SELECT account_id, normalized_username FROM social_accounts ORDER BY account_id').all() as Array<{ account_id: string; normalized_username: string }>;
    assert.deepEqual(rows.map((row) => ({ ...row })), [
      { account_id: 'ig', normalized_username: 'brand page' },
      { account_id: 'pg', normalized_username: 'facebook:page-1' },
    ]);
    assert.deepEqual(listAccountSummaries(db, 'c1').map((row) => row.platform), ['instagram', 'facebook']);
  });
});

// ---------------------------------------------------------------- T2: safety

function seedFacebookAccount(db: ReturnType<typeof openDatabase>, vault: ReturnType<typeof createVault>) {
  createConnection(db, {
    id: 'fb', name: 'FB', providerCode: 'META', loginKind: 'facebook_login', graphVersion: 'v26.0', status: 'valid',
    accessToken: vault.encrypt('fb', 'user-token'),
  });
  addDiscoveredAccount(db, {
    accountId: 'page-account', connectionId: 'fb', providerAccountId: 'page-1', username: 'Brand Page', platform: 'facebook',
    accountType: 'PAGE', relatedPageId: 'page-1', status: 'valid',
  });
  const secret = vault.encrypt('account:page-account', 'page-token');
  db.prepare('UPDATE social_accounts SET page_token_nonce=?, page_token_ciphertext=?, page_token_tag=? WHERE account_id=?')
    .run(secret.nonce, secret.ciphertext, secret.tag, 'page-account');
  createMedia(db, { accountId: 'page-account', mediaId: 'post-1', permalink: null, publishedAt: null });
  db.prepare(`INSERT INTO comments (account_id, media_id, comment_id, text, username, created_at, first_seen_at, last_seen_at)
    VALUES ('page-account', 'post-1', 'c-1', 'hi', 'u', NULL, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`).run();
  return { accountId: 'page-account', connectionId: 'fb', providerAccountId: 'page-1', username: 'Brand Page' } satisfies AccountRef;
}

test('MetaProvider refuses every endpoint for a facebook account without any network call while the switch is off', async () => {
  await withEnv(async (directory, db) => {
    const vault = createVault(directory, () => listEncryptedCredentials(db));
    const account = seedFacebookAccount(db, vault);
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls += 1; return Response.json({}); };
    // No override: the shipped default (FACEBOOK_PAGES_AVAILABLE = false). Tanda 2 asserts the enabled behavior.
    const provider = new MetaProvider(db, vault, fetcher);
    const refused = (error: unknown) => error instanceof PlatformNotSupportedError && error.code === 'platform_not_supported';
    await assert.rejects(provider.listMedia(account), refused);
    await assert.rejects(provider.listComments(account, 'post-1'), refused);
    await assert.rejects(provider.getComment(account, 'c-1'), refused);
    await assert.rejects(provider.sendPrivateReply(account, 'c-1', { text: 'hello', buttons: [] }), refused);
    await assert.rejects(provider.readMessage(account, 'm-1'), refused);
    await assert.rejects(provider.replyToComment(account, 'c-1', 'thanks'), refused);
    await assert.rejects(provider.setCommentHidden(account, 'c-1', true), refused);
    await assert.rejects(provider.deleteComment(account, 'c-1'), refused);
    assert.equal(calls, 0);
  });
});

test('ConnectionService.listMedia and Scanner.scanMedia refuse a facebook account before touching the provider', async () => {
  await withEnv(async (directory, db) => {
    const vault = createVault(directory, () => listEncryptedCredentials(db));
    const account = seedFacebookAccount(db, vault);
    const touched: string[] = [];
    const provider = new Proxy({}, { get: (_t, name) => async () => { touched.push(String(name)); throw new Error('provider must not be called'); } });
    const service = new ConnectionService(db, vault, provider as never);
    await assert.rejects(service.listMedia(account.accountId), (error: unknown) => error instanceof PlatformNotSupportedError);
    const scanner = new Scanner(db, provider as never);
    await assert.rejects(scanner.scanMedia(account, 'post-1', { kind: 'backlog' }), (error: unknown) => error instanceof PlatformNotSupportedError);
    assert.deepEqual(touched, []);
  });
});

test('the scheduler never starts or ticks a facebook account', async () => {
  await withEnv(async (directory, db) => {
    const vault = createVault(directory, () => listEncryptedCredentials(db));
    const account = seedFacebookAccount(db, vault);
    const touched: string[] = [];
    const provider = new Proxy({}, { get: (_t, name) => async () => { touched.push(String(name)); throw new Error('provider must not be called'); } });
    const scheduler = new Scheduler(db, new Scanner(db, provider as never), new QueueService(db, provider as never));
    assert.throws(() => scheduler.start(account.accountId), (error: unknown) => error instanceof PlatformNotSupportedError);
    scheduler.startAll();
    assert.equal((db.prepare('SELECT monitoring_paused AS p FROM social_accounts WHERE account_id=?').get(account.accountId) as { p: number }).p, 1);
    // Even if a row were forced active, a tick must skip it.
    db.prepare('UPDATE social_accounts SET monitoring_paused=0 WHERE account_id=?').run(account.accountId);
    db.prepare(`INSERT INTO automations (automation_id, account_id, media_id, name, status, match_mode, reply_text, monitoring_started_at, created_at, updated_at)
      VALUES ('auto-1', ?, 'post-1', 'A', 'enabled', 'contains', 'hello', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`)
      .run(account.accountId);
    await scheduler.tick();
    assert.deepEqual(touched, []);
  });
});

// ---------------------------------------------------------------- T3: discovery

function discoveryFetcher(calls: URL[]): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith('/me/accounts')) {
      return Response.json({ data: [
        { id: 'page-1', name: 'Linked Page', access_token: 'token-one', tasks: ['MODERATE', 'MANAGE'], instagram_business_account: { id: 'ig-1' } },
        { id: 'page-2', name: 'Plain Page', access_token: 'token-two', tasks: ['MANAGE'] },
      ] });
    }
    return Response.json({ id: 'ig-1', username: 'linked_ig', account_type: 'BUSINESS' });
  };
}

async function discoveryState(directory: string, db: ReturnType<typeof openDatabase>) {
  const vault = createVault(directory, () => listEncryptedCredentials(db));
  createConnection(db, {
    id: 'fb', name: 'FB', providerCode: 'META', loginKind: 'facebook_login', graphVersion: 'v26.0', status: 'valid',
    accessToken: vault.encrypt('fb', 'user-token'),
  });
  return vault;
}

test('with the switch off, facebook_login discovery is unchanged: only linked Instagram accounts, no platform field', async () => {
  await withEnv(async (directory, db) => {
    const vault = await discoveryState(directory, db);
    const calls: URL[] = [];
    const provider = new MetaProvider(db, vault, discoveryFetcher(calls));
    const found = await provider.discoverAccounts('fb');
    assert.deepEqual(found.map((a) => a.providerAccountId), ['ig-1']);
    assert.equal('platform' in found[0]!, false);
    assert.deepEqual(calls.map((u) => u.pathname), ['/v26.0/me/accounts', '/v26.0/ig-1']);
  });
});

test('with the switch on, Pages are also discovered (with and without a linked Instagram account) and share the page token', async () => {
  await withEnv(async (directory, db) => {
    const vault = await discoveryState(directory, db);
    const calls: URL[] = [];
    const provider = new MetaProvider(db, vault, discoveryFetcher(calls), { facebookPagesAvailable: true });
    const found = await provider.discoverAccounts('fb');
    assert.deepEqual(found.map((a) => [a.providerAccountId, a.platform ?? 'instagram']), [
      ['ig-1', 'instagram'], ['page-1', 'facebook'], ['page-2', 'facebook'],
    ]);
    const page = found[1]!;
    assert.equal(page.username, 'Linked Page');
    assert.equal(page.accountType, 'PAGE');
    assert.equal(page.relatedPageId, 'page-1');
    assert.deepEqual(page.capabilities, ['identity_read', 'page_task:MANAGE', 'page_task:MODERATE']);
    assert.equal(JSON.stringify(found).includes('token-'), false);
    assert.equal(await provider.credentialForSelectedAccount('fb', found[0]!), 'token-one');
    assert.equal(await provider.credentialForSelectedAccount('fb', page), 'token-one');
    assert.equal(await provider.credentialForSelectedAccount('fb', found[2]!), 'token-two');
    assert.deepEqual(calls.map((u) => u.pathname), ['/v26.0/me/accounts', '/v26.0/ig-1']);
  });
});

// ---------------------------------------------------------------- T3: selection, conflicts, adoption, DTO

class FakeProvider {
  readonly discovered = new Map<string, DiscoveredAccount[]>();
  readonly credentials = new Map<string, string>();
  async validateConnection(): Promise<ConnectionValidation> {
    return { status: 'valid', observedAt: '2026-10-05T00:00:00Z', providerUserId: 'user-1', username: 'owner', capabilities: ['identity_read'] };
  }
  async discoverAccounts(connectionId: string) { return this.discovered.get(connectionId) ?? []; }
  async credentialForSelectedAccount(connectionId: string, account: DiscoveredAccount) {
    return this.credentials.get(`${connectionId}:${account.providerAccountId}`);
  }
}

const PAGE: DiscoveredAccount = {
  providerAccountId: 'page-1', username: 'Brand Page', platform: 'facebook', accountType: 'PAGE', relatedPageId: 'page-1',
  capabilities: ['identity_read', 'page_task:MANAGE'],
};

async function serviceEnv(directory: string, db: ReturnType<typeof openDatabase>) {
  const vault = createVault(directory, () => listEncryptedCredentials(db));
  const provider = new FakeProvider();
  const service = new ConnectionService(db, vault, provider as never);
  const connect = async (id: string, accounts: DiscoveredAccount[]) => {
    await service.create({ id, name: `Name ${id}`, loginKind: 'facebook_login', graphVersion: 'v26.0', accessToken: `token-${id}` });
    await service.testConnection(id);
    provider.discovered.set(id, accounts);
    return service.discoverAccounts(id);
  };
  return { vault, provider, service, connect };
}

test('selecting a Page persists platform, namespaced identity and the page token; the Instagram twin can coexist', async () => {
  await withEnv(async (directory, db) => {
    const env = await serviceEnv(directory, db);
    const ig: DiscoveredAccount = { providerAccountId: 'ig-1', username: 'Brand Page', capabilities: ['identity_read'] };
    const [first, second] = await env.connect('c1', [ig, PAGE]);
    assert.equal(second!.platform, 'facebook');
    assert.equal(first!.platform, undefined);
    env.provider.credentials.set('c1:page-1', 'page-token');
    env.provider.credentials.set('c1:ig-1', 'page-token');
    const instagram = await env.service.selectAccount('c1', first!);
    const page = await env.service.selectAccount('c1', second!);
    assert.equal(instagram.platform, 'instagram');
    assert.equal(page.platform, 'facebook');
    assert.equal((db.prepare('SELECT normalized_username AS n FROM social_accounts WHERE account_id=?').get(page.accountId) as { n: string }).n, 'facebook:page-1');
    const stored = listEncryptedCredentials(db).find((item) => item.contextId === `account:${page.accountId}`);
    assert.ok(stored);
    assert.equal(env.vault.decrypt(stored.contextId, stored.secret), 'page-token');
  });
});

test('Page accounts keep the conflict and orphan-adoption rules with platform-neutral messages', async () => {
  await withEnv(async (directory, db) => {
    const env = await serviceEnv(directory, db);
    const [candidate] = await env.connect('old', [PAGE]);
    const original = await env.service.selectAccount('old', candidate!);
    const [again] = await env.connect('other', [PAGE]);
    await assert.rejects(env.service.selectAccount('other', again!), (error: unknown) =>
      error instanceof RepositoryConflictError && !(error instanceof AccountAdoptionRequiredError) && !/instagram/i.test(error.message));
    await env.service.disconnect('old');
    await assert.rejects(env.service.selectAccount('other', again!), (error: unknown) => error instanceof AccountAdoptionRequiredError);
    env.provider.credentials.set('other:page-1', 'fresh-page-token');
    const adopted = await env.service.selectAccount('other', again!, { adopt: true });
    assert.equal(adopted.accountId, original.accountId);
    assert.equal(adopted.platform, 'facebook');
    assert.equal(adopted.connectionId, 'other');
  });
});

test('GET /api/accounts exposes platform and nothing secret', async (context) => {
  await withEnv(async (directory, db) => {
    const vault = createVault(directory, () => listEncryptedCredentials(db));
    seedFacebookAccount(db, vault);
    addDiscoveredAccount(db, { accountId: 'ig', connectionId: 'fb', providerAccountId: 'ig-1', username: 'brand_ig', status: 'valid' });
    const handler = createApiHandler({ database: db, csrfToken: 'csrf' } as never);
    const server = createServer((req, res) => { void handler(req, res); });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    context.after(() => { server.close(); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const body = await new Promise<string>((resolve, reject) => {
      const req = request(new URL('/api/accounts', `http://127.0.0.1:${address.port}`), (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      });
      req.on('error', reject);
      req.end();
    });
    const accounts = JSON.parse(body).accounts as Array<{ accountId: string; platform: string }>;
    assert.deepEqual(Object.fromEntries(accounts.map((a) => [a.accountId, a.platform])), { ig: 'instagram', 'page-account': 'facebook' });
    assert.equal(body.includes('page-token'), false);
  });
});
