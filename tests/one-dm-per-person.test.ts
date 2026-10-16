import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/db/database.ts';
import { migrateDatabase } from '../src/db/migrations.ts';
import { addDiscoveredAccount, createComment, createConnection, createMedia } from '../src/db/repositories.ts';
import { AutomationService } from '../src/services/automations.ts';
import { QueueService } from '../src/services/queue.ts';
import { removeTempDir } from './helpers/tmp.ts';

type Db = ReturnType<typeof openDatabase>;
// Eligibility is classified against the real clock, so comments must be recent relative to it.
const NOW = Date.now();
const FRESH = new Date(NOW - 60 * 60 * 1000).toISOString();

async function withDb(run: (db: Db) => Promise<void> | void): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'one-dm-per-person-'));
  const db = openDatabase(directory);
  migrateDatabase(db);
  try { await run(db); } finally { db.close(); removeTempDir(directory); }
}

function seed(db: Db): string {
  createConnection(db, { id: 'conn', name: 't', providerCode: 'META', loginKind: 'instagram_login', graphVersion: 'v26.0', status: 'valid', accessToken: { nonce: 'n', ciphertext: 'c', tag: 't' } });
  addDiscoveredAccount(db, { accountId: 'account', connectionId: 'conn', providerAccountId: 'provider-account', username: 'brand', status: 'valid' });
  createMedia(db, { accountId: 'account', mediaId: 'media', permalink: null, publishedAt: null });
  const automations = new AutomationService(db);
  const id = automations.create({ accountId: 'account', mediaId: 'media', name: 'rea', replyText: 'Hi {{username}}' });
  automations.addKeyword('account', id, 'REA');
  automations.setEnabled('account', id, true);
  return id;
}

function comment(db: Db, commentId: string, username: string, text = 'REA'): void {
  createComment(db, { accountId: 'account', mediaId: 'media', commentId, text, username, createdAt: FRESH });
}

const count = (db: Db): number => (db.prepare(`SELECT COUNT(*) AS n FROM queue_items`).get() as { n: number }).n;

test('a person who comments the keyword twice gets one DM; another person still gets theirs', async () => {
  await withDb(async (db) => {
    const automationId = seed(db);
    comment(db, 'c1', 'fan');
    comment(db, 'c2', 'Fan', 'rea 🔥');
    comment(db, 'c3', 'other');
    const queue = new QueueService(db, {} as never, { clock: () => NOW });
    assert.deepEqual(await queue.enqueueReviewed('account', automationId, ['c1']), ['c1']);
    assert.deepEqual(await queue.enqueueReviewed('account', automationId, ['c2']), []);
    assert.deepEqual(await queue.enqueueReviewed('account', automationId, ['c3']), ['c3']);
    // The repeated comment gets a queue row (pending review lists only comments without one) but is never sent.
    assert.deepEqual(db.prepare(`SELECT comment_id, state, state_reason_code AS reason FROM queue_items ORDER BY comment_id`).all()
      .map((row) => ({ ...row })), [
      { comment_id: 'c1', state: 'SIMULATED', reason: null },
      { comment_id: 'c2', state: 'SKIPPED', reason: 'already_messaged' },
      { comment_id: 'c3', state: 'SIMULATED', reason: null },
    ]);
    assert.equal(count(db), 3);
  });
});

function failedItem(db: Db, commentId: string): string {
  db.prepare(`UPDATE queue_items SET state = 'FAILED_PERMANENT' WHERE comment_id = ?`).run(commentId);
  return (db.prepare(`SELECT queue_item_id AS id FROM queue_items WHERE comment_id = ?`).get(commentId) as { id: string }).id;
}

test('retryPrivateReply puts a FAILED_PERMANENT item back in the queue', async () => {
  await withDb(async (db) => {
    const automationId = seed(db);
    comment(db, 'c1', 'fan');
    const queue = new QueueService(db, {} as never, { clock: () => NOW });
    await queue.enqueueReviewed('account', automationId, ['c1']);
    const id = failedItem(db, 'c1');
    queue.retryPrivateReply('account', id);
    assert.equal((db.prepare(`SELECT state FROM queue_items WHERE queue_item_id = ?`).get(id) as { state: string }).state, 'QUEUED');
  });
});

test('retryPrivateReply refuses anything but FAILED_PERMANENT, another account, an old comment and a person already messaged', async () => {
  await withDb(async (db) => {
    const automationId = seed(db);
    comment(db, 'c1', 'fan');
    comment(db, 'c2', 'fan');
    comment(db, 'old', 'other');
    db.prepare(`UPDATE comments SET created_at = ? WHERE comment_id = 'old'`).run(new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString());
    const queue = new QueueService(db, {} as never, { clock: () => NOW });
    await queue.enqueueReviewed('account', automationId, ['c1']);
    const live = (db.prepare(`SELECT queue_item_id AS id FROM queue_items WHERE comment_id = 'c1'`).get() as { id: string }).id;
    const code = (run: () => void): string | undefined => { try { run(); return undefined; } catch (error) { return (error as { code?: string }).code; } };

    for (const state of ['SENT', 'UNKNOWN_OUTCOME', 'SIMULATED']) {
      db.prepare(`UPDATE queue_items SET state = ? WHERE queue_item_id = ?`).run(state, live);
      assert.equal(code(() => queue.retryPrivateReply('account', live)), 'private_reply_not_failed', state);
    }
    assert.equal(code(() => queue.retryPrivateReply('another-account', live)), 'queue_item_not_found');

    // c1 is live (SENT); a failed item of the same person must not produce a second DM.
    db.prepare(`UPDATE queue_items SET state = 'SENT' WHERE queue_item_id = ?`).run(live);
    db.prepare(`INSERT INTO queue_items (queue_item_id, account_id, comment_id, automation_id, state, dry_run, payload_json, created_at, updated_at)
      VALUES ('q-c2', 'account', 'c2', ?, 'FAILED_PERMANENT', 1, '{}', ?, ?)`).run(automationId, new Date(NOW).toISOString(), new Date(NOW).toISOString());
    db.prepare(`UPDATE queue_items SET dry_run = 1 WHERE queue_item_id = ?`).run(live);
    assert.equal(code(() => queue.retryPrivateReply('account', 'q-c2')), 'already_messaged');

    db.prepare(`INSERT INTO queue_items (queue_item_id, account_id, comment_id, automation_id, state, dry_run, payload_json, created_at, updated_at)
      VALUES ('q-old', 'account', 'old', ?, 'FAILED_PERMANENT', 1, '{}', ?, ?)`).run(automationId, new Date(NOW).toISOString(), new Date(NOW).toISOString());
    assert.equal(code(() => queue.retryPrivateReply('account', 'q-old')), 'private_reply_window_elapsed');
  });
});

test('both comments in one batch: only the first is queued', async () => {
  await withDb(async (db) => {
    const automationId = seed(db);
    comment(db, 'c1', 'fan');
    comment(db, 'c2', 'fan');
    const queue = new QueueService(db, {} as never, { clock: () => NOW });
    assert.deepEqual(await queue.enqueueReviewed('account', automationId, ['c1', 'c2']), ['c1']);
  });
});

test('a permanently failed, expired or skipped item does not block a later comment of the same person', async () => {
  for (const state of ['FAILED_PERMANENT', 'EXPIRED', 'SKIPPED']) {
    await withDb(async (db) => {
      const automationId = seed(db);
      comment(db, 'c1', 'fan');
      comment(db, 'c2', 'fan');
      const queue = new QueueService(db, {} as never, { clock: () => NOW });
      await queue.enqueueReviewed('account', automationId, ['c1']);
      db.prepare(`UPDATE queue_items SET state = ? WHERE comment_id = 'c1'`).run(state);
      assert.deepEqual(await queue.enqueueReviewed('account', automationId, ['c2']), ['c2'], state);
    });
  }
});

test('a simulated (Dry Run) item never blocks the real DM of the same person', async () => {
  await withDb(async (db) => {
    const automationId = seed(db);
    db.prepare(`UPDATE automations SET real_enabled = 1 WHERE automation_id = ?`).run(automationId);
    comment(db, 'c1', 'fan');
    comment(db, 'c2', 'fan');
    const queue = new QueueService(db, {} as never, { clock: () => NOW });
    assert.deepEqual(await queue.enqueueReviewed('account', automationId, ['c1']), ['c1']);
    assert.equal((db.prepare(`SELECT state FROM queue_items WHERE comment_id = 'c1'`).get() as { state: string }).state, 'SIMULATED');
    queue.setDryRun(false, true);
    assert.deepEqual(await queue.enqueueReviewed('account', automationId, ['c2']), ['c2']);
    assert.equal((db.prepare(`SELECT state FROM queue_items WHERE comment_id = 'c2'`).get() as { state: string }).state, 'QUEUED');
  });
});
