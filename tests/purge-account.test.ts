import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DOMAIN_REJECTION_CODES, DomainRejectionError } from '../src/core/errors.ts';
import { openDatabase } from '../src/db/database.ts';
import { migrateDatabase } from '../src/db/migrations.ts';
import { addDiscoveredAccount, createComment, createConnection, createMedia, disconnectConnection } from '../src/db/repositories.ts';
import { accountHasSendHistory, purgeAccount } from '../src/db/account-purge.ts';
import { createApiHandler } from '../src/http/router.ts';
import { DOMAIN_REJECTION_LABELS } from '../app/automation-actions.ts';
import { removeTempDir } from './helpers/tmp.ts';

type Db = ReturnType<typeof openDatabase>;

async function withDb(run: (db: Db) => Promise<void> | void) {
  const directory = mkdtempSync(join(tmpdir(), 'purge-account-'));
  const db = openDatabase(directory);
  migrateDatabase(db);
  try { await run(db); } finally { db.close(); removeTempDir(directory); }
}

function connect(db: Db, id: string) {
  createConnection(db, {
    id, name: id, providerCode: 'META', loginKind: 'facebook_login', graphVersion: 'v26.0',
    status: 'valid', accessToken: { nonce: 'n', ciphertext: 'c', tag: 't' },
  });
}

/** Seeds one account with a row in every account-scoped table that holds cached data (no send history). */
function seedAccount(db: Db, accountId: string, connectionId: string) {
  addDiscoveredAccount(db, { accountId, connectionId, providerAccountId: `p-${accountId}`, username: `user_${accountId}`, platform: 'facebook', status: 'valid' });
  db.prepare(`UPDATE social_accounts SET page_token_nonce='n', page_token_ciphertext='c', page_token_tag='t' WHERE account_id=?`).run(accountId);
  createMedia(db, { accountId, mediaId: 'm1', permalink: null, publishedAt: null });
  createComment(db, { accountId, mediaId: 'm1', commentId: 'c1', text: 'hi', username: 'u', createdAt: null });
  db.prepare(`INSERT INTO automations (automation_id, account_id, media_id, name, created_at, updated_at) VALUES (?, ?, 'm1', 'A', 't', 't')`)
    .run(`auto-${accountId}`, accountId);
  db.prepare(`INSERT INTO automation_keywords (account_id, automation_id, keyword_id, phrase, normalized_phrase, created_at) VALUES (?, ?, 'k1', 'guia', 'guia', 't')`)
    .run(accountId, `auto-${accountId}`);
  db.prepare(`INSERT INTO checkpoints (account_id, media_id, checkpoint_key, value_json, updated_at) VALUES (?, 'm1', 'cursor', '{}', 't')`).run(accountId);
  db.prepare(`INSERT INTO scan_runs (scan_id, account_id, media_id, scan_kind, status, started_at) VALUES (?, ?, 'm1', 'backlog', 'complete', 't')`)
    .run(`scan-${accountId}`, accountId);
  db.prepare(`INSERT INTO comment_classifications (account_id, comment_id, automation_id, result, reason, observed_at) VALUES (?, 'c1', ?, 'eligible', 'r', 't')`)
    .run(accountId, `auto-${accountId}`);
  db.prepare(`INSERT INTO account_send_holds (account_id, reason_code, created_at) VALUES (?, 'x', 't')`).run(accountId);
  db.prepare(`INSERT INTO legacy_account_acknowledgements (account_id, username, counter_version, acknowledged_at) VALUES (?, 'u', 'v', 't')`).run(accountId);
  db.prepare(`INSERT INTO moderation_settings (account_id, updated_at) VALUES (?, 't')`).run(accountId);
  db.prepare(`INSERT INTO moderation_flags (flag_id, account_id, media_id, comment_id, category, source, reasons_json, state, created_at, updated_at)
    VALUES (?, ?, 'm1', 'c1', 'spam_link', 'rules', '[]', 'PENDING', 't', 't')`).run(`flag-${accountId}`, accountId);
  db.prepare(`INSERT INTO moderation_ai_settings (account_id, api_key_nonce, api_key_ciphertext, api_key_tag, updated_at) VALUES (?, 'n', 'c', 't', 't')`).run(accountId);
  db.prepare(`INSERT INTO moderation_ai_jobs (job_id, account_id, state, review_window, started_at) VALUES (?, ?, 'completed', '24h', 't')`)
    .run(`job-${accountId}`, accountId);
}

function addQueueItem(db: Db, accountId: string, state = 'SIMULATED') {
  db.prepare(`INSERT INTO queue_items (queue_item_id, account_id, comment_id, automation_id, state, dry_run, payload_json, created_at, updated_at)
    VALUES (?, ?, 'c1', ?, ?, 1, '{}', 't', 't')`).run(`q-${accountId}`, accountId, `auto-${accountId}`, state);
}

function disconnect(db: Db, connectionId: string, deleted = true) { disconnectConnection(db, connectionId, deleted); }

function tableNames(db: Db): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map((row) => row.name);
}

/** Every table that has an account_id column, generically (never a hand-kept list). */
function accountScopedTables(db: Db): string[] {
  return tableNames(db).filter((table) => (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).some((column) => column.name === 'account_id'));
}

function countsFor(db: Db, accountId: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const table of accountScopedTables(db)) {
    result[table] = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE account_id=?`).get(accountId) as { n: number }).n);
  }
  return result;
}

function rejection(fn: () => void): DomainRejectionError {
  try { fn(); } catch (error) { assert.ok(error instanceof DomainRejectionError, String(error)); return error; }
  throw new assert.AssertionError({ message: 'expected a throw' });
}

test('purge removes the account and leaves zero rows in every account-scoped table', async () => {
  await withDb((db) => {
    connect(db, 'conn');
    seedAccount(db, 'acc', 'conn');
    disconnect(db, 'conn');
    const before = countsFor(db, 'acc');
    for (const table of ['media', 'comments', 'automations', 'automation_keywords', 'checkpoints', 'scan_runs', 'comment_classifications',
      'account_send_holds', 'legacy_account_acknowledgements', 'moderation_settings', 'moderation_flags', 'moderation_ai_settings', 'moderation_ai_jobs', 'social_accounts']) {
      assert.ok((before[table] ?? 0) >= 1, `seed must populate ${table}`);
    }
    purgeAccount(db, 'acc');
    for (const [table, count] of Object.entries(countsFor(db, 'acc'))) assert.equal(count, 0, table);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
});

test('purge leaves another account untouched', async () => {
  await withDb((db) => {
    connect(db, 'conn'); connect(db, 'other');
    seedAccount(db, 'acc', 'conn');
    seedAccount(db, 'keep', 'other');
    addQueueItem(db, 'keep');
    disconnect(db, 'conn');
    const keepBefore = countsFor(db, 'keep');
    const connectionsBefore = Number((db.prepare(`SELECT COUNT(*) AS n FROM connections WHERE id='other'`).get() as { n: number }).n);
    purgeAccount(db, 'acc');
    assert.deepEqual(countsFor(db, 'keep'), keepBefore);
    assert.equal(Number((db.prepare(`SELECT COUNT(*) AS n FROM connections WHERE id='other'`).get() as { n: number }).n), connectionsBefore);
  });
});

test('purge refuses an account that is not disconnected and deletes nothing', async () => {
  await withDb((db) => {
    connect(db, 'conn');
    seedAccount(db, 'acc', 'conn');
    const before = countsFor(db, 'acc');
    for (const status of ['valid', 'unvalidated']) {
      db.prepare(`UPDATE social_accounts SET status=? WHERE account_id='acc'`).run(status);
      const error = rejection(() => purgeAccount(db, 'acc'));
      assert.equal(error.code, 'account_not_disconnected');
    }
    db.prepare(`UPDATE social_accounts SET status='valid' WHERE account_id='acc'`).run();
    assert.deepEqual(countsFor(db, 'acc'), before);
  });
});

test('purge refuses an account with send history and neither deletes nor hides anything', async () => {
  await withDb((db) => {
    connect(db, 'conn');
    seedAccount(db, 'acc', 'conn');
    addQueueItem(db, 'acc');
    disconnect(db, 'conn');
    assert.equal(accountHasSendHistory(db, 'acc'), true);
    const before = countsFor(db, 'acc');
    const status = db.prepare(`SELECT status, updated_at FROM social_accounts WHERE account_id='acc'`).get();
    const error = rejection(() => purgeAccount(db, 'acc'));
    assert.equal(error.code, 'account_has_send_history');
    assert.deepEqual(countsFor(db, 'acc'), before);
    assert.deepEqual(db.prepare(`SELECT status, updated_at FROM social_accounts WHERE account_id='acc'`).get(), status);
    assert.equal(Number((db.prepare(`SELECT COUNT(*) AS n FROM connections WHERE id='conn'`).get() as { n: number }).n), 1);
  });
});

test('every append-only history table blocks the purge', async () => {
  const insertions: Record<string, (db: Db) => void> = {
    send_attempts: (db) => { addQueueItem(db, 'acc'); },
    moderation_actions: (db) => {
      db.prepare(`INSERT INTO moderation_actions (action_id, flag_id, account_id, comment_id, action, actor, mode, outcome, created_at)
        VALUES ('act', 'flag-acc', 'acc', 'c1', 'dismiss', 'operator', 'dry_run', 'simulated', 't')`).run();
    },
  };
  for (const [name, seedHistory] of Object.entries(insertions)) {
    await withDb((db) => {
      connect(db, 'conn');
      seedAccount(db, 'acc', 'conn');
      seedHistory(db);
      disconnect(db, 'conn');
      assert.equal(rejection(() => purgeAccount(db, 'acc')).code, 'account_has_send_history', name);
    });
  }
});

test('an account without any history reports no send history', async () => {
  await withDb((db) => {
    connect(db, 'conn');
    seedAccount(db, 'acc', 'conn');
    assert.equal(accountHasSendHistory(db, 'acc'), false);
  });
});

test('the connection tombstone goes away only when it is disconnected and owns no other account', async () => {
  await withDb((db) => {
    connect(db, 'shared');
    seedAccount(db, 'a1', 'shared');
    seedAccount(db, 'a2', 'shared');
    disconnect(db, 'shared');
    assert.deepEqual(purgeAccount(db, 'a1'), { removedConnection: false });
    assert.equal(Number((db.prepare(`SELECT COUNT(*) AS n FROM connections WHERE id='shared'`).get() as { n: number }).n), 1);
    assert.deepEqual(purgeAccount(db, 'a2'), { removedConnection: true });
    assert.equal(Number((db.prepare(`SELECT COUNT(*) AS n FROM connections WHERE id='shared'`).get() as { n: number }).n), 0);
  });
});

test('purge also sweeps other user-deleted connections that own no account (no ghost records)', async () => {
  await withDb((db) => {
    // An old deleted connection whose account was already gone: a ghost left behind by an earlier removal.
    connect(db, 'ghost');
    disconnect(db, 'ghost', true);
    // A deleted connection that still owns an account must stay (its account may be adopted later).
    connect(db, 'still-owns');
    seedAccount(db, 'kept', 'still-owns');
    disconnect(db, 'still-owns', true);
    // A merely disconnected (not deleted) connection without accounts is the user's, to reconnect: it must stay.
    connect(db, 'reconnectable');
    disconnect(db, 'reconnectable', false);
    connect(db, 'victim-conn');
    seedAccount(db, 'victim', 'victim-conn');
    disconnect(db, 'victim-conn', true);

    assert.deepEqual(purgeAccount(db, 'victim'), { removedConnection: true });
    const ids = (db.prepare(`SELECT id FROM connections ORDER BY id`).all() as Array<{ id: string }>).map((row) => row.id);
    assert.deepEqual(ids, ['reconnectable', 'still-owns']);
  });
});

test('a disconnected (not deleted) tombstone is removed too, but a valid connection is kept', async () => {
  await withDb((db) => {
    connect(db, 'soft');
    seedAccount(db, 'acc', 'soft');
    disconnect(db, 'soft', false);
    assert.deepEqual(purgeAccount(db, 'acc'), { removedConnection: true });

    connect(db, 'live');
    seedAccount(db, 'acc2', 'live');
    // The account alone is disconnected while its connection is still valid.
    db.prepare(`UPDATE social_accounts SET status='disconnected' WHERE account_id='acc2'`).run();
    assert.deepEqual(purgeAccount(db, 'acc2'), { removedConnection: false });
    assert.equal((db.prepare(`SELECT status FROM connections WHERE id='live'`).get() as { status: string }).status, 'valid');
  });
});

test('purge of an unknown account is an error', async () => {
  await withDb((db) => {
    assert.throws(() => purgeAccount(db, 'missing'), /not found/i);
  });
});

test('the append-only triggers that protect history still exist', async () => {
  await withDb((db) => {
    const triggers = (db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger'`).all() as Array<{ name: string }>).map((row) => row.name);
    for (const table of ['send_attempts', 'public_reply_attempts', 'gate_events', 'gate_part_events', 'moderation_actions']) {
      assert.ok(triggers.includes(`${table}_no_update`), `${table}_no_update`);
      assert.ok(triggers.includes(`${table}_no_delete`), `${table}_no_delete`);
    }
  });
});

test('adoption still works for an account that was not purged', async () => {
  await withDb((db) => {
    connect(db, 'old'); connect(db, 'new');
    seedAccount(db, 'acc', 'old');
    seedAccount(db, 'gone', 'old');
    disconnect(db, 'old');
    purgeAccount(db, 'gone');
    assert.throws(() => addDiscoveredAccount(db, { accountId: 'acc', connectionId: 'new', providerAccountId: 'p-acc', username: 'user_acc', platform: 'facebook', status: 'valid' }),
      (error: unknown) => (error as { code?: string }).code === 'account_adoption_required');
    addDiscoveredAccount(db, { accountId: 'acc', connectionId: 'new', providerAccountId: 'p-acc', username: 'user_acc', platform: 'facebook', status: 'valid', adopt: true });
    assert.equal((db.prepare(`SELECT connection_id FROM social_accounts WHERE account_id='acc'`).get() as { connection_id: string }).connection_id, 'new');
    assert.equal(countsFor(db, 'acc').media, 1);
  });
});

test('the new domain rejection codes exist and have Spanish labels', () => {
  for (const code of ['account_not_disconnected', 'account_has_send_history']) {
    assert.ok((DOMAIN_REJECTION_CODES as readonly string[]).includes(code), code);
  }
  assert.equal(DOMAIN_REJECTION_LABELS.account_not_disconnected, 'Solo se puede eliminar una cuenta desconectada.');
  assert.equal(DOMAIN_REJECTION_LABELS.account_has_send_history,
    'Esta cuenta tiene envíos en su historial y ese historial está protegido: no se puede eliminar.');
});

async function withApi(run: (ctx: { db: Db; post: (path: string, body: unknown, headers?: Record<string, string>) => Promise<{ status: number; raw: string }> }) => Promise<void>) {
  await withDb(async (db) => {
    const handler = createApiHandler({ database: db, csrfToken: 'csrf' } as never);
    const server = createServer((req, res) => { void handler(req, res); });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = (path: string, body: unknown, headers: Record<string, string> = { origin, 'x-csrf-token': 'csrf' }) => new Promise<{ status: number; raw: string }>((resolve, reject) => {
      const req = request(new URL(path, origin), { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
        let raw = ''; res.setEncoding('utf8'); res.on('data', (c) => { raw += c; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, raw }));
      });
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
    try { await run({ db, post }); } finally { server.close(); }
  });
}

test('API: POST /api/accounts/:id/delete requires confirmation, CSRF and an existing account', async () => {
  await withApi(async ({ db, post }) => {
    connect(db, 'conn');
    seedAccount(db, 'acc', 'conn');
    disconnect(db, 'conn');
    const unconfirmed = await post('/api/accounts/acc/delete', {});
    assert.equal(unconfirmed.status, 400);
    assert.equal(unconfirmed.raw, JSON.stringify({ error: 'confirmation_required' }));
    const falsy = await post('/api/accounts/acc/delete', { confirmed: 'yes' });
    assert.equal(falsy.status, 400);
    const noCsrf = await post('/api/accounts/acc/delete', { confirmed: true }, {});
    assert.equal(noCsrf.status, 403);
    const unknown = await post('/api/accounts/missing/delete', { confirmed: true });
    assert.equal(unknown.status, 404);
    assert.equal(countsFor(db, 'acc').social_accounts, 1);
  });
});

test('API: delete returns the exact allowlisted body and removes the account', async () => {
  await withApi(async ({ db, post }) => {
    connect(db, 'conn');
    seedAccount(db, 'acc', 'conn');
    disconnect(db, 'conn');
    const done = await post('/api/accounts/acc/delete', { confirmed: true });
    assert.equal(done.status, 200);
    assert.equal(done.raw, JSON.stringify({ deleted: true, removedConnection: true }));
    assert.equal(countsFor(db, 'acc').social_accounts, 0);
    assert.equal((await post('/api/accounts/acc/delete', { confirmed: true })).status, 404);
  });
});

test('API: refusals map to 409 with only the stable code', async () => {
  await withApi(async ({ db, post }) => {
    connect(db, 'conn');
    seedAccount(db, 'acc', 'conn');
    const active = await post('/api/accounts/acc/delete', { confirmed: true });
    assert.equal(active.status, 409);
    assert.equal(active.raw, JSON.stringify({ error: 'account_not_disconnected' }));
    addQueueItem(db, 'acc');
    disconnect(db, 'conn');
    const sent = await post('/api/accounts/acc/delete', { confirmed: true });
    assert.equal(sent.status, 409);
    assert.equal(sent.raw, JSON.stringify({ error: 'account_has_send_history' }));
    assert.equal(countsFor(db, 'acc').queue_items, 1);
  });
});

test('API: account list exposes a boolean hasSendHistory only', async () => {
  await withApi(async ({ db }) => {
    connect(db, 'conn');
    seedAccount(db, 'acc', 'conn');
    addQueueItem(db, 'acc');
    const handler = createApiHandler({ database: db, csrfToken: 'csrf' } as never);
    const server = createServer((req, res) => { void handler(req, res); });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const body = await new Promise<{ accounts: Array<Record<string, unknown>> }>((resolve, reject) => {
        request(new URL('/api/accounts', origin), { method: 'GET' }, (res) => {
          let raw = ''; res.setEncoding('utf8'); res.on('data', (c) => { raw += c; }); res.on('end', () => resolve(JSON.parse(raw)));
        }).on('error', reject).end();
      });
      assert.equal(body.accounts[0]!.hasSendHistory, true);
      assert.ok(!JSON.stringify(body).includes('page_token'));
    } finally { server.close(); }
  });
});

test('the router wires the delete endpoint through purgeAccount', () => {
  const router = readFileSync(new URL('../src/http/router.ts', import.meta.url), 'utf8');
  assert.match(router, /purgeAccount\(/);
  assert.match(router, /\/api\/accounts\//);
});
