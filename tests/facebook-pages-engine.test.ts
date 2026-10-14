import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AccountRef } from '../src/core/domain.ts';
import { PlatformFeatureNotSupportedError, PlatformNotSupportedError } from '../src/core/errors.ts';
import { openDatabase } from '../src/db/database.ts';
import { migrateDatabase } from '../src/db/migrations.ts';
import {
  addDiscoveredAccount, createConnection, createMedia, listEncryptedCredentials,
} from '../src/db/repositories.ts';
import { MetaProvider } from '../src/providers/meta/provider.ts';
import { createVault } from '../src/security/vault.ts';
import { AutomationService, classifyComment, renderReply } from '../src/services/automations.ts';
import { ConnectionService } from '../src/services/connections.ts';
import { updateSettings } from '../src/services/moderation.ts';
import { QueueReadbackError, QueueService } from '../src/services/queue.ts';
import { Scanner } from '../src/services/scanner.ts';
import { Scheduler } from '../src/services/scheduler.ts';
import { removeTempDir } from './helpers/tmp.ts';

type Db = ReturnType<typeof openDatabase>;
const PAGE_TOKEN = 'page-token-placeholder';
const PAGE_ID = 'page-1';
const ACCOUNT: AccountRef = { accountId: 'page-account', connectionId: 'fb', providerAccountId: PAGE_ID, username: 'Brand Page' };

async function withEnv(run: (db: Db, vault: ReturnType<typeof createVault>) => Promise<void> | void): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'social-fbengine-'));
  const db = openDatabase(directory);
  migrateDatabase(db);
  const vault = createVault(directory, () => listEncryptedCredentials(db));
  try { await run(db, vault); } finally { db.close(); removeTempDir(directory); }
}

function seed(db: Db, vault: ReturnType<typeof createVault>): void {
  createConnection(db, {
    id: 'fb', name: 'FB', providerCode: 'META', loginKind: 'facebook_login', graphVersion: 'v26.0', status: 'valid',
    accessToken: vault.encrypt('fb', 'user-token-placeholder'),
  });
  addDiscoveredAccount(db, {
    accountId: 'page-account', connectionId: 'fb', providerAccountId: PAGE_ID, username: 'Brand Page', platform: 'facebook',
    accountType: 'PAGE', relatedPageId: PAGE_ID, status: 'valid',
  });
  const secret = vault.encrypt('account:page-account', PAGE_TOKEN);
  db.prepare('UPDATE social_accounts SET page_token_nonce=?, page_token_ciphertext=?, page_token_tag=? WHERE account_id=?')
    .run(secret.nonce, secret.ciphertext, secret.tag, 'page-account');
  createMedia(db, { accountId: 'page-account', mediaId: 'page-1_post-1', permalink: null, publishedAt: null });
  db.prepare("UPDATE connections SET monitoring_paused=0 WHERE id='fb'").run();
  db.prepare("UPDATE social_accounts SET monitoring_paused=0 WHERE account_id='page-account'").run();
}

type Call = { url: URL; init: RequestInit };
type Responder = (call: Call, index: number) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;
function mockFetch(responder: Responder): { fetcher: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const call = { url: new URL(String(input)), init };
    calls.push(call);
    const { status = 200, body } = await responder(call, calls.length - 1);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetcher, calls };
}
const bearer = (call: Call) => (call.init.headers as Record<string, string>).authorization;
const provider = (db: Db, vault: ReturnType<typeof createVault>, fetcher: typeof fetch) =>
  new MetaProvider(db, vault, fetcher, { facebookPagesAvailable: true });

// ---------------------------------------------------------------- listMedia

test('facebook listMedia reads the Page feed with a bearer token and maps posts', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    const { fetcher, calls } = mockFetch(() => ({ body: { data: [
      { id: 'page-1_p1', created_time: '2026-10-05T10:00:00+0000', message: 'Hello post', permalink_url: 'https://www.facebook.com/p/1', is_published: true },
      { id: 'page-1_p2', created_time: '2026-10-05T11:00:00+0000', is_published: false },
      { id: 'page-1_p3', created_time: '2026-10-05T12:00:00+0000' },
    ] } }));
    const page = await provider(db, vault, fetcher).listMedia(ACCOUNT);
    assert.equal(calls.length, 1);
    const url = calls[0]!.url;
    assert.equal(url.origin, 'https://graph.facebook.com');
    assert.equal(url.pathname, '/v26.0/page-1/feed');
    assert.equal(url.searchParams.get('fields'), 'id,created_time,message,permalink_url,is_published');
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(bearer(calls[0]!), `Bearer ${PAGE_TOKEN}`);
    assert.equal(url.href.includes(PAGE_TOKEN), false);
    assert.equal(page.complete, true);
    // Unpublished posts cannot have comments and are not listed.
    assert.deepEqual(page.items.map((item) => item.mediaId), ['page-1_p1', 'page-1_p3']);
    assert.deepEqual(page.items[0], {
      mediaId: 'page-1_p1', permalink: 'https://www.facebook.com/p/1', publishedAt: '2026-10-05T10:00:00+0000',
      caption: 'Hello post', mediaType: 'POST', thumbnailUrl: undefined,
    });
  });
});

test('facebook listMedia follows paging.next only on the fixed host and version', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    const { fetcher, calls } = mockFetch((_call, index) => index === 0
      ? { body: { data: [{ id: 'page-1_p1' }], paging: { next: 'https://graph.facebook.com/v26.0/page-1/feed?after=CURSOR1&limit=100' } } }
      : { body: { data: [{ id: 'page-1_p2' }] } });
    const page = await provider(db, vault, fetcher).listMedia(ACCOUNT);
    assert.deepEqual(page.items.map((item) => item.mediaId), ['page-1_p1', 'page-1_p2']);
    assert.equal(calls[1]!.url.searchParams.get('after'), 'CURSOR1');
    assert.equal(calls[1]!.url.origin, 'https://graph.facebook.com');

    const hostile = mockFetch(() => ({ body: { data: [{ id: 'page-1_p1' }], paging: { next: 'https://evil.example/v26.0/page-1/feed?after=X' } } }));
    const unsafe = await provider(db, vault, hostile.fetcher).listMedia(ACCOUNT);
    assert.equal(unsafe.complete, false);
    assert.equal(unsafe.stopReason, 'unsafe_or_missing_cursor');
    assert.equal(hostile.calls.length, 1);
  });
});

// ---------------------------------------------------------------- listComments / getComment

const COMMENT_FIELDS = 'id,message,created_time,from,can_reply_privately,can_comment,is_hidden,parent{id}';

test('facebook listComments uses filter=stream, maps comments without `from` and Page replies', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    const { fetcher, calls } = mockFetch(() => ({ body: { data: [
      { id: 'page-1_p1_1', message: 'info please', created_time: '2026-10-05T10:00:00+0000', can_reply_privately: true, can_comment: true, is_hidden: false },
      { id: 'page-1_p1_2', message: 'role user', created_time: '2026-10-05T10:01:00+0000', from: { name: 'Some Person', id: 'user-9' }, can_reply_privately: false },
      { id: 'page-1_p1_3', message: 'Done!', created_time: '2026-10-05T10:02:00+0000', from: { name: 'Brand Page', id: PAGE_ID }, parent: { id: 'page-1_p1_1' } },
    ], summary: { total_count: 3 } } }));
    const page = await provider(db, vault, fetcher).listComments(ACCOUNT, 'page-1_post-1');
    const url = calls[0]!.url;
    assert.equal(url.pathname, '/v26.0/page-1_post-1/comments');
    assert.equal(url.searchParams.get('filter'), 'stream');
    assert.equal(url.searchParams.get('summary'), 'true');
    assert.equal(url.searchParams.get('fields'), COMMENT_FIELDS);
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(bearer(calls[0]!), `Bearer ${PAGE_TOKEN}`);
    assert.equal(page.items.length, 3);
    const [anon, role, own] = page.items;
    assert.equal(anon!.username, undefined);
    assert.equal(anon!.authorId, undefined);
    assert.equal(anon!.canReplyPrivately, true);
    assert.equal(anon!.text, 'info please');
    assert.equal(anon!.createdAt, '2026-10-05T10:00:00+0000');
    assert.equal(role!.username, 'Some Person');
    assert.equal(role!.authorId, 'user-9');
    assert.equal(role!.canReplyPrivately, false);
    assert.equal(own!.authorId, PAGE_ID);
    assert.equal(own!.parentId, 'page-1_p1_1');
    assert.equal(own!.canReplyPrivately, undefined);
  });
});

test('facebook listComments pages with the validated cursor and refuses a media of another account', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    const { fetcher, calls } = mockFetch(() => ({ body: { data: [{ id: 'page-1_p1_1', message: 'x' }],
      paging: { next: 'https://graph.facebook.com/v26.0/page-1_post-1/comments?after=NEXT&limit=100' } } }));
    const page = await provider(db, vault, fetcher).listComments(ACCOUNT, 'page-1_post-1');
    assert.equal(page.complete, false);
    assert.equal(page.nextCursor, 'NEXT');
    await provider(db, vault, fetcher).listComments(ACCOUNT, 'page-1_post-1', 'NEXT');
    assert.equal(calls[1]!.url.searchParams.get('after'), 'NEXT');
    await assert.rejects(provider(db, vault, fetcher).listComments(ACCOUNT, 'unknown-post'), /Media does not belong/);
    assert.equal(calls.length, 2);
  });
});

test('facebook getComment re-reads one comment with the documented fields', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    db.prepare(`INSERT INTO comments (account_id, media_id, comment_id, first_seen_at, last_seen_at)
      VALUES ('page-account', 'page-1_post-1', 'page-1_p1_1', 'now', 'now')`).run();
    const { fetcher, calls } = mockFetch(() => ({ body: { id: 'page-1_p1_1', message: 'hi', created_time: '2026-10-05T10:00:00+0000', can_reply_privately: false } }));
    const comment = await provider(db, vault, fetcher).getComment(ACCOUNT, 'page-1_p1_1');
    assert.equal(calls[0]!.url.pathname, '/v26.0/page-1_p1_1');
    assert.equal(calls[0]!.url.searchParams.get('fields'), COMMENT_FIELDS);
    assert.equal(comment.canReplyPrivately, false);
    assert.equal(comment.username, undefined);
    await assert.rejects(provider(db, vault, fetcher).getComment(ACCOUNT, 'not-stored'), /Comment does not belong/);
    assert.equal(calls.length, 1);
  });
});

// ---------------------------------------------------------------- private reply send

function storeComment(db: Db, commentId: string): void {
  db.prepare(`INSERT OR IGNORE INTO comments (account_id, media_id, comment_id, first_seen_at, last_seen_at)
    VALUES ('page-account', 'page-1_post-1', ?, 'now', 'now')`).run(commentId);
}

test('facebook sendPrivateReply posts the verified JSON shape with a bearer header and parses the response', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    storeComment(db, 'page-1_p1_1');
    const { fetcher, calls } = mockFetch(() => ({ body: { recipient_id: 'psid-1', message_id: 'm_abc' } }));
    const result = await provider(db, vault, fetcher).sendPrivateReply(ACCOUNT, 'page-1_p1_1', { text: 'Hola, gracias', buttons: [] });
    assert.equal(result.outcome, 'accepted');
    assert.equal(result.messageId, 'm_abc');
    assert.equal(result.recipientId, 'psid-1');
    const call = calls[0]!;
    assert.equal(call.init.method, 'POST');
    assert.equal(call.url.origin, 'https://graph.facebook.com');
    assert.equal(call.url.pathname, '/v26.0/page-1/messages');
    assert.equal(call.url.search, '');
    assert.equal(bearer(call), `Bearer ${PAGE_TOKEN}`);
    assert.deepEqual(JSON.parse(String(call.init.body)), { recipient: { comment_id: 'page-1_p1_1' }, message: { text: 'Hola, gracias' } });
  });
});

test('facebook sendPrivateReply renders URL buttons as plain text lines and never sends templates', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    storeComment(db, 'page-1_p1_1');
    const { fetcher, calls } = mockFetch(() => ({ body: { recipient_id: 'psid-1', message_id: 'm_abc' } }));
    const result = await provider(db, vault, fetcher).sendPrivateReply(ACCOUNT, 'page-1_p1_1', {
      text: 'Here is the guide',
      buttons: [{ title: 'Guide', url: 'https://example.com/guide' }, { title: 'Shop', url: 'https://example.com/shop' }],
    });
    assert.equal(result.outcome, 'accepted');
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.deepEqual(body.message, { text: 'Here is the guide\nGuide: https://example.com/guide\nShop: https://example.com/shop' });
    assert.equal('attachment' in body.message, false);
  });
});

test('facebook sendPrivateReply fails closed on postback buttons, quick replies, oversize text and foreign comments', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    storeComment(db, 'page-1_p1_1');
    const { fetcher, calls } = mockFetch(() => ({ body: { message_id: 'm_x' } }));
    const fb = provider(db, vault, fetcher);
    const postback = await fb.sendPrivateReply(ACCOUNT, 'page-1_p1_1', { text: 'x', buttons: [], postbackButtons: [{ title: 'Go', payload: 'gate:a:0' }] });
    assert.deepEqual([postback.outcome, postback.safeErrorCode], ['definitive_rejection', 'invalid_reply_payload']);
    const quick = await fb.sendPrivateReply(ACCOUNT, 'page-1_p1_1', { text: 'x', buttons: [], quickReplies: [{ title: 'Go', payload: 'gate:a:0' }] });
    assert.equal(quick.outcome, 'definitive_rejection');
    const huge = await fb.sendPrivateReply(ACCOUNT, 'page-1_p1_1', {
      text: 'x'.repeat(1000), buttons: [{ title: 'Long', url: `https://example.com/${'a'.repeat(1500)}` }],
    });
    assert.deepEqual([huge.outcome, huge.safeErrorCode], ['definitive_rejection', 'invalid_reply_payload']);
    const foreign = await fb.sendPrivateReply(ACCOUNT, 'not-stored', { text: 'x', buttons: [] });
    assert.deepEqual([foreign.outcome, foreign.safeErrorCode], ['definitive_rejection', 'comment_not_owned']);
    assert.equal(calls.length, 0);
  });
});

test('facebook sendPrivateReply: accepted without message_id is ambiguous, never a success', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    storeComment(db, 'page-1_p1_1');
    const { fetcher } = mockFetch(() => ({ body: { recipient_id: 'psid-1' } }));
    const result = await provider(db, vault, fetcher).sendPrivateReply(ACCOUNT, 'page-1_p1_1', { text: 'x', buttons: [] });
    assert.deepEqual([result.outcome, result.messageId, result.safeErrorCode], ['ambiguous', undefined, 'meta_missing_message_id']);
  });
});

const ERROR_TABLE: Array<{ status: number; code: number; subcode?: number; expect: string; outcome: 'definitive_rejection' | 'ambiguous'; rateLimited?: boolean }> = [
  { status: 400, code: 100, subcode: 2534025, expect: 'comment_not_valid_for_private_reply', outcome: 'definitive_rejection' },
  { status: 400, code: 10, subcode: 2534022, expect: 'private_reply_window_closed', outcome: 'definitive_rejection' },
  { status: 400, code: 10, subcode: 2018278, expect: 'private_reply_window_closed', outcome: 'definitive_rejection' },
  { status: 403, code: 200, expect: 'facebook_permission_denied', outcome: 'definitive_rejection' },
  { status: 400, code: 551, expect: 'recipient_cannot_receive_messages', outcome: 'definitive_rejection' },
  { status: 400, code: 613, subcode: 2534040, expect: 'facebook_rate_limited', outcome: 'definitive_rejection', rateLimited: true },
  { status: 400, code: 4, expect: 'facebook_rate_limited', outcome: 'definitive_rejection', rateLimited: true },
  { status: 400, code: 17, expect: 'facebook_rate_limited', outcome: 'definitive_rejection', rateLimited: true },
  { status: 400, code: 32, expect: 'facebook_rate_limited', outcome: 'definitive_rejection', rateLimited: true },
  { status: 400, code: 80001, expect: 'facebook_rate_limited', outcome: 'definitive_rejection', rateLimited: true },
  { status: 401, code: 190, expect: 'facebook_token_invalid', outcome: 'definitive_rejection' },
  { status: 400, code: 1234, expect: 'meta_1234', outcome: 'definitive_rejection' },
  { status: 500, code: 2, expect: 'meta_2', outcome: 'ambiguous' },
];
for (const row of ERROR_TABLE) {
  test(`facebook sendPrivateReply maps Meta error ${row.code}${row.subcode ? `/${row.subcode}` : ''} (HTTP ${row.status}) to ${row.expect}`, async () => {
    await withEnv(async (db, vault) => {
      seed(db, vault);
      storeComment(db, 'page-1_p1_1');
      const { fetcher } = mockFetch(() => ({ status: row.status, body: { error: { message: `secret ${PAGE_TOKEN}`, code: row.code, ...(row.subcode ? { error_subcode: row.subcode } : {}) } } }));
      const result = await provider(db, vault, fetcher).sendPrivateReply(ACCOUNT, 'page-1_p1_1', { text: 'x', buttons: [] });
      assert.equal(result.outcome, row.outcome);
      assert.equal(result.safeErrorCode, row.expect);
      assert.equal(result.rateLimited, row.rateLimited);
      assert.equal(JSON.stringify(result).includes(PAGE_TOKEN), false);
    });
  });
}

test('facebook sendPrivateReply: a network failure is ambiguous', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    storeComment(db, 'page-1_p1_1');
    const fetcher: typeof fetch = async () => { throw new Error('socket hang up'); };
    const result = await provider(db, vault, fetcher).sendPrivateReply(ACCOUNT, 'page-1_p1_1', { text: 'x', buttons: [] });
    assert.equal(result.outcome, 'ambiguous');
  });
});

// ---------------------------------------------------------------- switch + unsupported features

test('with the switch off the provider refuses every operation for a facebook account without any request', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    storeComment(db, 'page-1_p1_1');
    const { fetcher, calls } = mockFetch(() => ({ body: {} }));
    const off = new MetaProvider(db, vault, fetcher);
    const refused = (error: unknown) => error instanceof PlatformNotSupportedError;
    await assert.rejects(off.listMedia(ACCOUNT), refused);
    await assert.rejects(off.listComments(ACCOUNT, 'page-1_post-1'), refused);
    await assert.rejects(off.getComment(ACCOUNT, 'page-1_p1_1'), refused);
    await assert.rejects(off.sendPrivateReply(ACCOUNT, 'page-1_p1_1', { text: 'x', buttons: [] }), refused);
    await assert.rejects(off.readMessage(ACCOUNT, 'm_1'), refused);
    await assert.rejects(off.replyToComment(ACCOUNT, 'page-1_p1_1', 'thanks'), refused);
    await assert.rejects(off.setCommentHidden(ACCOUNT, 'page-1_p1_1', true), refused);
    await assert.rejects(off.deleteComment(ACCOUNT, 'page-1_p1_1'), refused);
    assert.equal(calls.length, 0);
  });
});

test('hide, delete, public reply and message readback are refused with a typed error for Facebook, without a request', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    storeComment(db, 'page-1_p1_1');
    const { fetcher, calls } = mockFetch(() => ({ body: {} }));
    const fb = provider(db, vault, fetcher);
    assert.deepEqual(await fb.replyToComment(ACCOUNT, 'page-1_p1_1', 'thanks'), { outcome: 'definitive_rejection', safeErrorCode: 'platform_feature_not_supported' });
    assert.deepEqual(await fb.setCommentHidden(ACCOUNT, 'page-1_p1_1', true), { status: 'rejected', safeErrorCode: 'platform_feature_not_supported' });
    assert.deepEqual(await fb.deleteComment(ACCOUNT, 'page-1_p1_1'), { status: 'rejected', safeErrorCode: 'platform_feature_not_supported' });
    await assert.rejects(fb.readMessage(ACCOUNT, 'm_1'), (error: unknown) =>
      error instanceof PlatformFeatureNotSupportedError && error.code === 'platform_feature_not_supported');
    assert.equal(calls.length, 0);
  });
});

test('ConnectionService.listMedia, Scanner and Scheduler refuse a facebook account when off and work when on', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    const { fetcher } = mockFetch((call) => call.url.pathname.endsWith('/feed')
      ? { body: { data: [{ id: 'page-1_p9', created_time: '2026-10-05T10:00:00+0000', message: 'Post nine' }] } }
      : { body: { data: [] } });
    const meta = provider(db, vault, fetcher);
    const off = new ConnectionService(db, vault, meta as never);
    await assert.rejects(off.listMedia('page-account'), (error: unknown) => error instanceof PlatformNotSupportedError);
    const on = new ConnectionService(db, vault, meta as never, { facebookPagesAvailable: true });
    const media = await on.listMedia('page-account');
    assert.deepEqual(media.map((item: { mediaId: string }) => item.mediaId).sort(), ['page-1_p9', 'page-1_post-1'].sort());
    const stored = db.prepare("SELECT media_type FROM media WHERE media_id='page-1_p9'").get() as { media_type: string };
    assert.equal(stored.media_type, 'POST');

    await assert.rejects(new Scanner(db, meta).scanMedia(ACCOUNT, 'page-1_post-1', { kind: 'backlog' }), (error: unknown) => error instanceof PlatformNotSupportedError);
    const report = await new Scanner(db, meta, { facebookPagesAvailable: true }).scanMedia(ACCOUNT, 'page-1_post-1', { kind: 'backlog' });
    assert.equal(report.status, 'complete');

    const queue = new QueueService(db, meta);
    const scheduler = new Scheduler(db, new Scanner(db, meta), queue);
    assert.throws(() => scheduler.start('page-account'), (error: unknown) => error instanceof PlatformNotSupportedError);
    const enabled = new Scheduler(db, new Scanner(db, meta, { facebookPagesAvailable: true }), queue, { facebookPagesAvailable: true });
    enabled.start('page-account');
    assert.equal((db.prepare("SELECT monitoring_paused AS p FROM social_accounts WHERE account_id='page-account'").get() as { p: number }).p, 0);
    enabled.stopAll();
  });
});

// ---------------------------------------------------------------- classification and owner detection

const NOW = Date.parse('2026-10-06T12:00:00Z');
const FRESH = '2026-10-06T11:00:00Z';

test('classifyComment (facebook): authors without a username are eligible; the Page itself and blocked private replies are not', () => {
  const base = { commentId: 'c', text: 'guide please', createdAt: FRESH };
  const classify = (comment: Record<string, unknown>, replied = false) =>
    classifyComment({ ...base, ...comment } as never, ['guide'], 'Brand Page', NOW, 'contains', replied, PAGE_ID);
  assert.deepEqual([classify({}).eligible, classify({}).reason], [true, 'eligible']);
  assert.equal(classify({ authorId: 'user-9', username: 'Some Person' }).eligible, true);
  assert.deepEqual([classify({ authorId: PAGE_ID }).eligible, classify({ authorId: PAGE_ID }).reason], [false, 'own_authored']);
  assert.equal(classify({ canReplyPrivately: false }).reason, 'private_reply_unavailable');
  assert.equal(classify({ canReplyPrivately: true }).eligible, true);
  assert.equal(classify({}, true).reason, 'owner_replied');
  assert.equal(classify({ parentId: 'x' }).reason, 'reply_thread');
  // Instagram behavior is untouched: no username still means missing_author.
  assert.equal(classifyComment({ ...base } as never, ['guide'], 'brand', NOW).reason, 'missing_author');
});

function stream(...pages: Array<Array<Record<string, unknown>>>) {
  let index = 0;
  return { async listComments() {
    const page = pages[Math.min(index++, pages.length - 1)]!;
    const last = index >= pages.length;
    return { items: page, complete: last, nextCursor: last ? undefined : `cursor-${index}` };
  } } as never;
}
const ROOT = { commentId: 'root', text: 'guide please', createdAt: FRESH, canReplyPrivately: true };
const PAGE_REPLY = { commentId: 'r1', text: 'Sent!', createdAt: FRESH, parentId: 'root', authorId: PAGE_ID, username: 'Totally Different Name' };
const classificationOf = (db: Db, commentId: string) => {
  const row = db.prepare('SELECT result, reason FROM comment_classifications WHERE account_id=? AND comment_id=?').get('page-account', commentId) as { result: string; reason: string } | undefined;
  return row ? { ...row } : undefined;
};

function seedAutomation(db: Db): string {
  const automations = new AutomationService(db);
  const id = automations.create({ accountId: 'page-account', mediaId: 'page-1_post-1', name: 'lead', replyText: 'Hola {{username}}, gracias' });
  automations.addKeyword('page-account', id, 'guide');
  automations.setEnabled('page-account', id, true);
  return id;
}

for (const order of ['root-first', 'reply-first'] as const) {
  test(`scanner (facebook): a Page-authored reply in the stream blocks the root by author id, not username (${order})`, async () => {
    await withEnv(async (db, vault) => {
      seed(db, vault);
      seedAutomation(db);
      const source = order === 'root-first' ? stream([ROOT], [PAGE_REPLY]) : stream([PAGE_REPLY], [ROOT]);
      const report = await new Scanner(db, source, { facebookPagesAvailable: true })
        .scanMedia(ACCOUNT, 'page-1_post-1', { kind: 'backlog', cutoffAt: '2026-10-05T00:00:00Z', now: NOW });
      assert.equal(report.status, 'complete');
      assert.deepEqual(classificationOf(db, 'root'), { result: 'review', reason: 'owner_replied' });
    });
  });
}

test('scanner (facebook): non-role comment is eligible, a reply by another user does not block, Page top-level never eligible', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    seedAutomation(db);
    await new Scanner(db, stream([
      ROOT,
      { commentId: 'other-reply', text: 'me too', createdAt: FRESH, parentId: 'root', authorId: 'user-9' },
      { commentId: 'page-top', text: 'guide here', createdAt: FRESH, authorId: PAGE_ID },
      { commentId: 'blocked', text: 'guide please', createdAt: FRESH, canReplyPrivately: false },
    ]), { facebookPagesAvailable: true }).scanMedia(ACCOUNT, 'page-1_post-1', { kind: 'backlog', cutoffAt: '2026-10-05T00:00:00Z', now: NOW });
    assert.deepEqual(classificationOf(db, 'root'), { result: 'eligible', reason: 'eligible' });
    assert.deepEqual(classificationOf(db, 'page-top'), { result: 'review', reason: 'own_authored' });
    assert.deepEqual(classificationOf(db, 'blocked'), { result: 'review', reason: 'private_reply_unavailable' });
    const stored = db.prepare("SELECT username, author_igsid FROM comments WHERE comment_id='root'").get() as { username: string | null; author_igsid: string | null };
    assert.deepEqual({ ...stored }, { username: null, author_igsid: null });
  });
});

test('scanner (facebook) does not create moderation flags (hide/delete is not available yet)', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    seedAutomation(db);
    updateSettings(db, 'page-account', { enabled: true, blockedTerms: ['spam'], detectLinks: true, detectPhones: true,
      detectMentions: true, detectEmoji: false, autoHideEnabled: false, autoHideCategories: [] }, false);
    await new Scanner(db, stream([{ commentId: 'spam', text: 'spam http://spam.example buy now', createdAt: FRESH }]), { facebookPagesAvailable: true })
      .scanMedia(ACCOUNT, 'page-1_post-1', { kind: 'backlog', cutoffAt: '2026-10-05T00:00:00Z', now: NOW });
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM moderation_flags').get() as { n: number }).n, 0);
  });
});

// ---------------------------------------------------------------- username fallback

test('renderReply tidies an empty {{username}} and leaves present usernames untouched', () => {
  const vars = (username: string) => ({ username, comment: 'c', keyword: 'k', account: 'a', media: 'm' });
  assert.equal(renderReply('Hola {{username}}, gracias', vars(''), []).text, 'Hola, gracias');
  assert.equal(renderReply('Hola {{username}}!', vars(''), []).text, 'Hola!');
  assert.equal(renderReply('{{username}}, gracias por escribir', vars(''), []).text, 'gracias por escribir');
  assert.equal(renderReply('Hola {{username}} gracias', vars('   '), []).text, 'Hola gracias');
  assert.equal(renderReply('Hola {{username}}, gracias', vars('ana'), []).text, 'Hola ana, gracias');
  assert.equal(renderReply('Pedido {{keyword}} para {{username}}.', vars(''), []).text, 'Pedido k para.');
});

// ---------------------------------------------------------------- end to end: scan -> queue -> send

const nowIso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function e2eProvider(db: Db, vault: ReturnType<typeof createVault>, send: Responder) {
  const comments = new Map<string, Record<string, unknown>>();
  const { fetcher, calls } = mockFetch((call, index) => {
    const path = call.url.pathname;
    if (path.endsWith('/messages')) return send(call, index);
    if (path.endsWith('/comments')) return { body: { data: [...comments.values()] } };
    const id = decodeURIComponent(path.split('/').pop()!);
    return { body: comments.get(id) ?? { error: { code: 100, message: 'x' } } };
  });
  return { meta: provider(db, vault, fetcher), calls, comments };
}

async function enqueueFresh(db: Db, meta: MetaProvider, comments: Map<string, Record<string, unknown>>, queue: QueueService): Promise<string> {
  comments.set('page-1_post-1_1', { id: 'page-1_post-1_1', message: 'guide please', created_time: nowIso(-3_600_000), can_reply_privately: true, can_comment: true });
  const automationId = seedAutomation(db);
  db.prepare('UPDATE automations SET monitoring_started_at=? WHERE automation_id=?').run(nowIso(-86_400_000), automationId);
  // Authorized before enqueueing: it bumps the automation version, which the frozen payload must match.
  new AutomationService(db).setRealEnabled('page-account', automationId, true, true);
  const report = await new Scanner(db, meta, { facebookPagesAvailable: true })
    .scanMedia(ACCOUNT, 'page-1_post-1', { kind: 'monitor', cutoffAt: nowIso(-86_400_000), monitoringAutomationId: automationId });
  assert.deepEqual(report.candidates.filter((c) => c.eligible).map((c) => c.commentId), ['page-1_post-1_1']);
  const inserted = await queue.enqueueReviewed('page-account', automationId, ['page-1_post-1_1']);
  assert.deepEqual(inserted, ['page-1_post-1_1']);
  const payload = db.prepare('SELECT payload_json FROM queue_items WHERE comment_id=?').get('page-1_post-1_1') as { payload_json: string };
  assert.equal(JSON.parse(payload.payload_json).text, 'Hola, gracias');
  return automationId;
}

function goLive(_db: Db, _automationId: string, queue: QueueService): void {
  queue.setDryRun(false, true);
}

test('end to end (facebook): scan -> enqueue -> real send records the intent BEFORE the POST and confirms by message_id only', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    let intentAtPost = false;
    const { meta, calls, comments } = e2eProvider(db, vault, () => {
      intentAtPost = (db.prepare("SELECT COUNT(*) AS n FROM send_attempts WHERE event_type='intent_recorded'").get() as { n: number }).n === 1
        && (db.prepare("SELECT state FROM queue_items").get() as { state: string }).state === 'SENDING';
      return { body: { recipient_id: 'psid-1', message_id: 'm_ok' } };
    });
    const queue = new QueueService(db, meta, { sendSpacingMs: 0, facebookPagesAvailable: true });
    const automationId = await enqueueFresh(db, meta, comments, queue);
    // Dry Run is on by default: nothing is sent.
    assert.equal(await queue.processOne('page-account'), null);
    assert.equal(calls.some((call) => call.url.pathname.endsWith('/messages')), false);
    goLive(db, automationId, queue);
    db.prepare("UPDATE queue_items SET state='QUEUED', dry_run=0").run();
    assert.ok(await queue.processOne('page-account'));
    assert.equal(intentAtPost, true);
    const item = db.prepare('SELECT state, payload_json FROM queue_items').get() as { state: string; payload_json: string };
    assert.equal(item.state, 'SENT');
    assert.equal(JSON.parse(item.payload_json).accepted_message_id, 'm_ok');
    const sends = calls.filter((call) => call.url.pathname.endsWith('/messages'));
    assert.equal(sends.length, 1);
    assert.deepEqual(JSON.parse(String(sends[0]!.init.body)), { recipient: { comment_id: 'page-1_post-1_1' }, message: { text: 'Hola, gracias' } });
    // No message readback exists for Facebook: no GET of the message, and the event says so explicitly.
    assert.equal(calls.some((call) => call.url.pathname.includes('m_ok')), false);
    const readback = db.prepare("SELECT safe_error_code, details_json FROM send_attempts WHERE event_type='readback'").all() as Array<{ safe_error_code: string; details_json: string }>;
    assert.equal(readback.length, 1);
    assert.equal(readback[0]!.safe_error_code, 'readback_not_available_facebook');
    assert.deepEqual(JSON.parse(readback[0]!.details_json), { observed: false, skipped: true, reason: 'facebook_has_no_message_readback' });
    // Re-verification is refused instead of pretending.
    const queueItemId = (db.prepare('SELECT queue_item_id AS id FROM queue_items').get() as { id: string }).id;
    await assert.rejects(queue.verifyReadback('page-account', queueItemId), (error: unknown) =>
      error instanceof QueueReadbackError && error.status === 409 && error.code === 'readback_not_available_for_platform');
    // One private reply per comment: a second enqueue is a no-op.
    assert.deepEqual(await queue.enqueueReviewed('page-account', automationId, ['page-1_post-1_1']), []);
  });
});

test('end to end (facebook): an ambiguous POST becomes UNKNOWN_OUTCOME and is never retried', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    const { meta, calls, comments } = e2eProvider(db, vault, () => ({ status: 500, body: { error: { code: 2, message: 'boom' } } }));
    const queue = new QueueService(db, meta, { sendSpacingMs: 0, facebookPagesAvailable: true });
    const automationId = await enqueueFresh(db, meta, comments, queue);
    goLive(db, automationId, queue);
    db.prepare("UPDATE queue_items SET state='QUEUED', dry_run=0").run();
    await queue.processOne('page-account');
    assert.equal((db.prepare('SELECT state FROM queue_items').get() as { state: string }).state, 'UNKNOWN_OUTCOME');
    assert.equal(await queue.processOne('page-account'), null);
    assert.equal(calls.filter((call) => call.url.pathname.endsWith('/messages')).length, 1);
  });
});

test('end to end (facebook): can_reply_privately turned false before sending skips the item with no intent and no POST', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    const { meta, calls, comments } = e2eProvider(db, vault, () => ({ body: { message_id: 'm_no' } }));
    const queue = new QueueService(db, meta, { sendSpacingMs: 0, facebookPagesAvailable: true });
    const automationId = await enqueueFresh(db, meta, comments, queue);
    goLive(db, automationId, queue);
    db.prepare("UPDATE queue_items SET state='QUEUED', dry_run=0").run();
    comments.set('page-1_post-1_1', { ...comments.get('page-1_post-1_1')!, can_reply_privately: false });
    await queue.processOne('page-account');
    const item = db.prepare('SELECT state, state_reason_code FROM queue_items').get() as { state: string; state_reason_code: string };
    assert.deepEqual({ ...item }, { state: 'SKIPPED', state_reason_code: 'private_reply_unavailable' });
    assert.equal(calls.some((call) => call.url.pathname.endsWith('/messages')), false);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM send_attempts WHERE event_type='intent_recorded'").get() as { n: number }).n, 0);
  });
});

test('end to end (facebook): a stored Page reply skips the item at the pre-send recheck (no intent, no POST)', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    const { meta, calls, comments } = e2eProvider(db, vault, () => ({ body: { message_id: 'm_no' } }));
    const queue = new QueueService(db, meta, { sendSpacingMs: 0, facebookPagesAvailable: true });
    const automationId = await enqueueFresh(db, meta, comments, queue);
    goLive(db, automationId, queue);
    db.prepare("UPDATE queue_items SET state='QUEUED', dry_run=0").run();
    db.prepare(`INSERT INTO comments (account_id, media_id, comment_id, text, username, created_at, parent_id, first_seen_at, last_seen_at, author_igsid)
      VALUES ('page-account', 'page-1_post-1', 'page-1_post-1_2', 'Sent!', 'Whatever', ?, 'page-1_post-1_1', 'now', 'now', ?)`).run(nowIso(-60_000), PAGE_ID);
    await queue.processOne('page-account');
    const item = db.prepare('SELECT state, state_reason_code FROM queue_items').get() as { state: string; state_reason_code: string };
    assert.deepEqual({ ...item }, { state: 'SKIPPED', state_reason_code: 'owner_replied' });
    assert.equal(calls.some((call) => call.url.pathname.endsWith('/messages')), false);
  });
});

test('end to end (facebook): Meta error 190 on send fails the item definitively and invalidates the connection', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    const { meta, comments } = e2eProvider(db, vault, () => ({ status: 401, body: { error: { code: 190, message: 'expired' } } }));
    const queue = new QueueService(db, meta, { sendSpacingMs: 0, facebookPagesAvailable: true });
    const automationId = await enqueueFresh(db, meta, comments, queue);
    goLive(db, automationId, queue);
    db.prepare("UPDATE queue_items SET state='QUEUED', dry_run=0").run();
    await queue.processOne('page-account');
    const item = db.prepare(`SELECT state FROM queue_items`).get() as { state: string };
    assert.equal(item.state, 'FAILED_PERMANENT');
    assert.equal((db.prepare("SELECT status FROM connections WHERE id='fb'").get() as { status: string }).status, 'invalid');
    assert.equal((db.prepare("SELECT status FROM social_accounts WHERE account_id='page-account'").get() as { status: string }).status, 'unvalidated');
  });
});

test('end to end (facebook): rate limiting is retryable and the window error is a definitive failure', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    let reply: { status: number; body: unknown } = { status: 400, body: { error: { code: 613, error_subcode: 2534040, message: 'slow down' } } };
    const { meta, comments } = e2eProvider(db, vault, () => reply);
    const queue = new QueueService(db, meta, { sendSpacingMs: 0, facebookPagesAvailable: true });
    const automationId = await enqueueFresh(db, meta, comments, queue);
    goLive(db, automationId, queue);
    db.prepare("UPDATE queue_items SET state='QUEUED', dry_run=0").run();
    await queue.processOne('page-account');
    assert.equal((db.prepare('SELECT state FROM queue_items').get() as { state: string }).state, 'FAILED_RETRYABLE');
    reply = { status: 400, body: { error: { code: 10, error_subcode: 2534022, message: 'window' } } };
    db.prepare("UPDATE queue_items SET next_attempt_at=NULL").run();
    await queue.processOne('page-account');
    const row = db.prepare("SELECT state FROM queue_items").get() as { state: string };
    const code = db.prepare("SELECT safe_error_code FROM send_attempts WHERE event_type='definitive_rejection'").get() as { safe_error_code: string };
    assert.equal(row.state, 'FAILED_PERMANENT');
    assert.equal(code.safe_error_code, 'private_reply_window_closed');
  });
});

test('the switch off keeps queued facebook items untouched: no provider call is made', async () => {
  await withEnv(async (db, vault) => {
    seed(db, vault);
    const { meta, calls, comments } = e2eProvider(db, vault, () => ({ body: { message_id: 'm_no' } }));
    const on = new QueueService(db, meta, { sendSpacingMs: 0, facebookPagesAvailable: true });
    const automationId = await enqueueFresh(db, meta, comments, on);
    goLive(db, automationId, on);
    db.prepare("UPDATE queue_items SET state='QUEUED', dry_run=0").run();
    const before = calls.length;
    const off = new QueueService(db, meta, { sendSpacingMs: 0 });
    assert.equal(await off.processOne('page-account'), null);
    assert.equal(calls.length, before);
    assert.equal((db.prepare('SELECT state FROM queue_items').get() as { state: string }).state, 'QUEUED');
  });
});
