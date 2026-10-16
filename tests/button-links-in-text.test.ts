import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { composeButtonLinksText } from '../src/core/domain.ts';
import { openDatabase } from '../src/db/database.ts';
import { migrateDatabase } from '../src/db/migrations.ts';
import { addDiscoveredAccount, createComment, createConnection, createMedia, saveAccountPageToken } from '../src/db/repositories.ts';
import { createApiHandler } from '../src/http/router.ts';
import { MetaProvider } from '../src/providers/meta/provider.ts';
import { createVault } from '../src/security/vault.ts';
import {
  AutomationService, BUTTON_LINKS_TEXT_TOO_LONG_CODE, ButtonLinksTextTooLongError, renderReply,
} from '../src/services/automations.ts';
import { facebookMessageText } from '../src/services/facebook-pages-rules.ts';
import { listPendingReview } from '../src/services/pending-review.ts';
import { QueueService } from '../src/services/queue.ts';
import { removeTempDir } from './helpers/tmp.ts';

type Db = ReturnType<typeof openDatabase>;

async function withDb(run: (db: Db, directory: string) => Promise<void> | void): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'button-links-text-'));
  const db = openDatabase(directory);
  migrateDatabase(db);
  try {
    await run(db, directory);
  } finally {
    db.close();
    removeTempDir(directory);
  }
}

const BUTTONS = [
  { title: 'Ver guía', url: 'https://example.com/guia' },
  { title: 'Tienda', url: 'https://example.com/tienda' },
];

const VARS = { username: 'ana', comment: 'quiero la guia', keyword: 'guia', account: 'marca', media: 'https://instagram.com/p/1' };

test('composeButtonLinksText and renderReply compose button links only when enabled and buttons exist', () => {
  assert.equal(composeButtonLinksText('Hola ana', BUTTONS, false), 'Hola ana');
  assert.equal(composeButtonLinksText('Hola ana', BUTTONS), 'Hola ana');
  assert.equal(composeButtonLinksText('Hola ana', [], true), 'Hola ana');
  assert.equal(
    composeButtonLinksText('Hola ana', [BUTTONS[0]!], true),
    'Hola ana\n\nVer guía: https://example.com/guia',
  );
  assert.equal(
    composeButtonLinksText('Hola ana', BUTTONS, true),
    'Hola ana\n\nVer guía: https://example.com/guia\nTienda: https://example.com/tienda',
  );

  const off = renderReply('Hola {{username}}, sobre {{keyword}}', VARS, BUTTONS, undefined, false);
  assert.deepEqual(off, {
    text: 'Hola ana, sobre guia',
    buttons: BUTTONS,
  });

  const on = renderReply('Hola {{username}}, sobre {{keyword}}', VARS, BUTTONS, undefined, true);
  assert.deepEqual(on, {
    text: 'Hola ana, sobre guia\n\nVer guía: https://example.com/guia\nTienda: https://example.com/tienda',
    buttons: BUTTONS,
    linksInText: true,
  });

  const noButtons = renderReply('Hola {{username}}', VARS, [], undefined, true);
  assert.deepEqual(noButtons, { text: 'Hola ana', buttons: [] });

  const emptyUser = renderReply('Hola {{username}}, gracias', { ...VARS, username: '' }, [BUTTONS[0]!], undefined, true);
  assert.deepEqual(emptyUser, {
    text: 'Hola, gracias\n\nVer guía: https://example.com/guia',
    buttons: [BUTTONS[0]!],
    linksInText: true,
  });
});

test('migration v20 adds button_links_in_text with default 0 for existing rows and rejects newer schemas', () => {
  const directory = mkdtempSync(join(tmpdir(), 'button-links-mig-'));
  const db = openDatabase(directory);
  try {
    migrateDatabase(db, 19);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 19);
    const now = '2026-10-16T00:00:00.000Z';
    db.prepare(`INSERT INTO connections (id, name, provider_code, login_kind, graph_version, status, created_at, updated_at)
      VALUES ('c1', 'C', 'META', 'instagram_login', 'v26.0', 'valid', ?, ?)`).run(now, now);
    db.prepare(`INSERT INTO social_accounts (account_id, connection_id, provider_account_id, username, normalized_username, status,
      created_at, updated_at) VALUES ('a1', 'c1', 'p1', 'brand', 'brand', 'valid', ?, ?)`).run(now, now);
    db.prepare(`INSERT INTO media (account_id, media_id, last_seen_at) VALUES ('a1', 'm1', ?)`).run(now);
    db.prepare(`INSERT INTO automations (automation_id, account_id, media_id, scope, name, status, match_mode, reply_text,
      buttons_json, created_at, updated_at) VALUES ('auto1', 'a1', 'm1', 'media', 'Auto', 'enabled', 'contains', 'Hola', '[]', ?, ?)`)
      .run(now, now);

    migrateDatabase(db);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 20);
    const row = db.prepare(`SELECT button_links_in_text FROM automations WHERE automation_id='auto1'`)
      .get() as { button_links_in_text: number };
    assert.equal(row.button_links_in_text, 0);
    assert.throws(
      () => db.prepare(`UPDATE automations SET button_links_in_text=2 WHERE automation_id='auto1'`).run(),
      /CHECK|constraint/i,
    );

    db.exec('PRAGMA user_version = 21');
    assert.throws(() => migrateDatabase(db), /newer than supported/i);
  } finally {
    db.close();
    removeTempDir(directory);
  }
});

function seedAccount(db: Db): void {
  createConnection(db, {
    id: 'conn', name: 'c', providerCode: 'META', loginKind: 'instagram_login', graphVersion: 'v26.0',
    status: 'valid', accessToken: { nonce: 'n', ciphertext: 'c', tag: 't' },
  });
  addDiscoveredAccount(db, { accountId: 'acc', connectionId: 'conn', providerAccountId: 'p', username: 'brand', status: 'valid' });
  db.prepare(`UPDATE connections SET monitoring_paused=0 WHERE id='conn'`).run();
  db.prepare(`UPDATE social_accounts SET monitoring_paused=0 WHERE account_id='acc'`).run();
  createMedia(db, { accountId: 'acc', mediaId: 'm', permalink: 'https://instagram.com/p/m', publishedAt: null });
}

async function withApi(run: (ctx: {
  db: Db;
  call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
}) => Promise<void>): Promise<void> {
  await withDb(async (db) => {
    seedAccount(db);
    const handler = createApiHandler({ database: db, csrfToken: 'csrf', automations: new AutomationService(db) });
    const server = createServer((req, res) => { void handler(req, res); });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const call = (method: string, path: string, body?: unknown) => new Promise<{ status: number; body: any }>((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
      const req = request(new URL(path, origin), {
        method,
        headers: {
          connection: 'close',
          origin,
          'x-csrf-token': 'csrf',
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        },
      }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null }));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
    try {
      await run({ db, call });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
}

test('API POST/PUT/GET /api/automations handles buttonLinksInText strictly, keeps omitted value on PUT, and bumps version', async () => {
  await withApi(async ({ db, call }) => {
    const base = {
      accountId: 'acc',
      mediaId: 'm',
      name: 'Auto',
      replyText: 'Hola {{username}}',
      matchMode: 'contains',
      keywords: ['guia'],
      buttons: BUTTONS,
    };

    // Omitted on POST defaults to false
    const createdDefault = await call('POST', '/api/automations', base);
    assert.equal(createdDefault.status, 201);
    const id1 = createdDefault.body.automationId as string;

    // Explicit true on POST
    const createdTrue = await call('POST', '/api/automations', { ...base, name: 'Auto 2', buttonLinksInText: true });
    assert.equal(createdTrue.status, 201);
    const id2 = createdTrue.body.automationId as string;

    // Non-boolean rejected on POST
    for (const bad of ['true', 1, null, {}]) {
      const res = await call('POST', '/api/automations', { ...base, name: 'Bad', buttonLinksInText: bad });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'invalid_request');
    }

    const listed1 = await call('GET', '/api/automations?accountId=acc');
    assert.equal(listed1.status, 200);
    const map1 = new Map<string, any>(listed1.body.automations.map((a: any) => [a.automationId, a]));
    assert.equal(map1.get(id1).buttonLinksInText, false);
    assert.equal(map1.get(id2).buttonLinksInText, true);

    // Omitted on PUT keeps stored true value
    const vBefore = (db.prepare(`SELECT version FROM automations WHERE automation_id=?`).get(id2) as { version: number }).version;
    const putOmitted = await call('PUT', `/api/automations/${id2}`, { ...base, name: 'Auto 2 edited' });
    assert.equal(putOmitted.status, 200);
    const vAfterOmitted = (db.prepare(`SELECT version, button_links_in_text FROM automations WHERE automation_id=?`).get(id2) as {
      version: number; button_links_in_text: number;
    });
    assert.equal(vAfterOmitted.button_links_in_text, 1);
    assert.ok(vAfterOmitted.version > vBefore);

    // Explicit false on PUT flips it to false and bumps version
    const putFalse = await call('PUT', `/api/automations/${id2}`, { ...base, name: 'Auto 2 edited', buttonLinksInText: false });
    assert.equal(putFalse.status, 200);
    const vAfterFalse = (db.prepare(`SELECT version, button_links_in_text FROM automations WHERE automation_id=?`).get(id2) as {
      version: number; button_links_in_text: number;
    });
    assert.equal(vAfterFalse.button_links_in_text, 0);
    assert.ok(vAfterFalse.version > vAfterOmitted.version);

    // Non-boolean rejected on PUT
    const putBad = await call('PUT', `/api/automations/${id2}`, { ...base, buttonLinksInText: 'no' });
    assert.equal(putBad.status, 400);
    assert.equal(putBad.body.error, 'invalid_request');
  });
});

test('validation rejects composed text exceeding the limit with button_links_text_too_long on create and update', async () => {
  await withApi(async ({ call }) => {
    // 960 characters fit the 1000-char limit alone; with the 2 button links the composed text exceeds the limits.
    const longReply = `Hola {{username}} ${'x'.repeat(950)}`;
    const base = {
      accountId: 'acc',
      mediaId: 'm',
      name: 'Boundary',
      replyText: longReply,
      matchMode: 'contains',
      keywords: ['guia'],
      buttons: BUTTONS,
    };

    // Allowed when buttonLinksInText is false
    const okCreate = await call('POST', '/api/automations', { ...base, buttonLinksInText: false });
    assert.equal(okCreate.status, 201);
    const autoId = okCreate.body.automationId as string;

    // Rejected with button_links_text_too_long when buttonLinksInText is true on POST
    const badCreate = await call('POST', '/api/automations', { ...base, buttonLinksInText: true });
    assert.equal(badCreate.status, 400);
    assert.equal(badCreate.body.error, BUTTON_LINKS_TEXT_TOO_LONG_CODE);

    // Rejected with button_links_text_too_long when enabling buttonLinksInText on PUT
    const badUpdate = await call('PUT', `/api/automations/${autoId}`, { ...base, buttonLinksInText: true });
    assert.equal(badUpdate.status, 400);
    assert.equal(badUpdate.body.error, BUTTON_LINKS_TEXT_TOO_LONG_CODE);

    // Direct renderReply throws ButtonLinksTextTooLongError
    assert.throws(
      () => renderReply(longReply, VARS, BUTTONS, undefined, true),
      (err: unknown) => err instanceof ButtonLinksTextTooLongError && err.code === BUTTON_LINKS_TEXT_TOO_LONG_CODE,
    );
  });
});

test('QueueService and providers: sent and simulated payload text contains button links only when enabled (Instagram & Facebook)', async () => {
  await withDb(async (db, directory) => {
    seedAccount(db);
    const service = new AutomationService(db);
    const autoOff = service.create({
      accountId: 'acc', mediaId: 'm', name: 'Off', replyText: 'Hola {{username}}', buttons: BUTTONS, buttonLinksInText: false,
    });
    service.addKeyword('acc', autoOff, 'offkw');
    service.setEnabled('acc', autoOff, true);
    service.setRealEnabled('acc', autoOff, true, true);

    const autoOn = service.create({
      accountId: 'acc', mediaId: 'm', name: 'On', replyText: 'Hola {{username}}', buttons: BUTTONS, buttonLinksInText: true,
    });
    service.addKeyword('acc', autoOn, 'onkw');
    service.setEnabled('acc', autoOn, true);
    service.setRealEnabled('acc', autoOn, true, true);

    const freshIso = new Date(Date.now() - 60_000).toISOString();
    createComment(db, { accountId: 'acc', mediaId: 'm', commentId: 'c-sim-off', text: 'offkw', username: 'u1', createdAt: freshIso });
    createComment(db, { accountId: 'acc', mediaId: 'm', commentId: 'c-sim-on', text: 'onkw', username: 'u2', createdAt: freshIso });
    createComment(db, { accountId: 'acc', mediaId: 'm', commentId: 'c-real-off', text: 'offkw', username: 'u3', createdAt: freshIso });
    createComment(db, { accountId: 'acc', mediaId: 'm', commentId: 'c-real-on', text: 'onkw', username: 'u4', createdAt: freshIso });

    // Record complete backlog scan classifications for pending review check as well
    db.prepare(`INSERT INTO scan_runs (scan_id, account_id, media_id, scan_kind, status, started_at, finished_at)
      VALUES ('s1', 'acc', 'm', 'backlog', 'complete', ?, ?)`).run(freshIso, freshIso);
    for (const [cid, aid, kw] of [
      ['c-sim-off', autoOff, 'offkw'],
      ['c-sim-on', autoOn, 'onkw'],
      ['c-real-off', autoOff, 'offkw'],
      ['c-real-on', autoOn, 'onkw'],
    ] as const) {
      db.prepare(`INSERT INTO comment_classifications (account_id, comment_id, automation_id, result, reason, matched_keywords_json, observed_at, scan_id)
        VALUES ('acc', ?, ?, 'eligible', 'eligible', ?, ?, 's1')`).run(cid, aid, JSON.stringify([kw]), freshIso);
    }

    // Pending review previews match composed text
    const pending = listPendingReview(db, 'acc', { limit: 10, offset: 0, now: Date.now() });
    const pendingOff = pending.items.find((i) => i.commentId === 'c-sim-off')!;
    const pendingOn = pending.items.find((i) => i.commentId === 'c-sim-on')!;
    assert.equal(pendingOff.previewText, 'Hola u1');
    assert.equal(pendingOn.previewText, 'Hola u2\n\nVer guía: https://example.com/guia\nTienda: https://example.com/tienda');

    const sentPayloads = new Map<string, { text: string; buttons: Array<{ title: string; url: string }> }>();
    const fakeProvider = {
      async getComment(_account: unknown, commentId: string) {
        const row = db.prepare(`SELECT text, username, created_at FROM comments WHERE account_id='acc' AND comment_id=?`).get(commentId) as {
          text: string; username: string; created_at: string;
        };
        return { commentId, text: row.text, username: row.username, createdAt: row.created_at };
      },
      async sendPrivateReply(_account: unknown, commentId: string, payload: { text: string; buttons: Array<{ title: string; url: string }> }) {
        sentPayloads.set(commentId, payload);
        return { outcome: 'accepted' as const, messageId: `msg-${commentId}` };
      },
      async readMessage(_account: unknown, messageId: string) {
        return { messageId, observedAt: new Date().toISOString() };
      },
    };

    const queue = new QueueService(db, fakeProvider as never, { sendSpacingMs: 0 });
    // Dry run = true initially -> SIMULATED items
    await queue.enqueueReviewed('acc', autoOff, ['c-sim-off']);
    await queue.enqueueReviewed('acc', autoOn, ['c-sim-on']);

    const simOff = JSON.parse((db.prepare(`SELECT payload_json FROM queue_items WHERE comment_id='c-sim-off'`).get() as { payload_json: string }).payload_json);
    const simOn = JSON.parse((db.prepare(`SELECT payload_json FROM queue_items WHERE comment_id='c-sim-on'`).get() as { payload_json: string }).payload_json);
    assert.equal(simOff.text, 'Hola u1');
    assert.equal(simOn.text, 'Hola u2\n\nVer guía: https://example.com/guia\nTienda: https://example.com/tienda');
    assert.deepEqual(simOn.buttons, BUTTONS);

    // Real mode -> QUEUED and SENT through fake provider
    queue.setDryRun(false, true);
    await queue.enqueueReviewed('acc', autoOff, ['c-real-off']);
    await queue.enqueueReviewed('acc', autoOn, ['c-real-on']);
    await queue.processOne('acc');
    await queue.processOne('acc');

    assert.deepEqual(sentPayloads.get('c-real-off') && {
      text: sentPayloads.get('c-real-off')!.text,
      buttons: sentPayloads.get('c-real-off')!.buttons,
    }, {
      text: 'Hola u3',
      buttons: BUTTONS,
    });
    assert.deepEqual(sentPayloads.get('c-real-on') && {
      text: sentPayloads.get('c-real-on')!.text,
      buttons: sentPayloads.get('c-real-on')!.buttons,
    }, {
      text: 'Hola u4\n\nVer guía: https://example.com/guia\nTienda: https://example.com/tienda',
      buttons: BUTTONS,
    });

    // Provider-level check for both Instagram and Facebook paths with composed payload
    const vault = createVault(directory, () => []);
    createConnection(db, {
      id: 'fb-conn', name: 'FB', providerCode: 'META', loginKind: 'facebook_login', graphVersion: 'v26.0',
      status: 'valid', accessToken: vault.encrypt('fb-conn', 'user-tok'),
    });
    addDiscoveredAccount(db, {
      accountId: 'fb-acc', connectionId: 'fb-conn', providerAccountId: 'page-1', username: 'Brand Page',
      platform: 'facebook', accountType: 'PAGE', relatedPageId: 'page-1', status: 'valid',
    });
    saveAccountPageToken(db, 'fb-acc', vault.encrypt('account:fb-acc', 'page-tok'));
    createMedia(db, { accountId: 'fb-acc', mediaId: 'page-1_p1', permalink: null, publishedAt: null });
    createComment(db, { accountId: 'fb-acc', mediaId: 'page-1_p1', commentId: 'fb-c1', text: 'onkw', username: 'fbuser', createdAt: freshIso });
    const igTok = vault.encrypt('conn', 'ig-tok');
    db.prepare(`UPDATE connections SET access_token_nonce=?, access_token_ciphertext=?, access_token_tag=? WHERE id='conn'`)
      .run(igTok.nonce, igTok.ciphertext, igTok.tag);

    const postedBodies: any[] = [];
    const meta = new MetaProvider(db, vault, (async (_url: string | URL | Request, init?: RequestInit) => {
      postedBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ recipient_id: 'r1', message_id: 'm1' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch, { facebookPagesAvailable: true });

    const composedPayload = renderReply('Hola {{username}}', { ...VARS, username: 'fbuser' }, BUTTONS, undefined, true);
    const igRes = await meta.sendPrivateReply(
      { accountId: 'acc', connectionId: 'conn', providerAccountId: 'p', username: 'brand' },
      'c-real-on',
      composedPayload,
    );
    assert.equal(igRes.outcome, 'accepted');
    assert.deepEqual(postedBodies[0].message, {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: 'Hola fbuser\n\nVer guía: https://example.com/guia\nTienda: https://example.com/tienda',
          buttons: [
            { type: 'web_url', title: 'Ver guía', url: 'https://example.com/guia' },
            { type: 'web_url', title: 'Tienda', url: 'https://example.com/tienda' },
          ],
        },
      },
    });

    const fbRes = await meta.sendPrivateReply(
      { accountId: 'fb-acc', connectionId: 'fb-conn', providerAccountId: 'page-1', username: 'Brand Page', platform: 'facebook' },
      'fb-c1',
      composedPayload,
    );
    assert.equal(fbRes.outcome, 'accepted');
    assert.deepEqual(postedBodies[1].message, {
      text: 'Hola fbuser\n\nVer guía: https://example.com/guia\nTienda: https://example.com/tienda',
    });
  });
});

test('UI (app/page.tsx) wires the buttonLinksInText checkbox, help text, preview and error label', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /Incluir también los enlaces en el texto/u);
  assert.match(page, /Instagram no muestra los botones en computador; así quien abra el mensaje desde la web también ve los enlaces\./u);
  assert.match(page, /button_links_text_too_long/u);
  assert.match(page, /El texto con los enlaces de los botones supera el máximo de Instagram/u);
  assert.match(page, /composeButtonLinksText/u);
});

test('renderReply marks the payload only when links were appended and caps the composed text at 640 characters', () => {
  const vars = { username: 'ana', comment: 'c', keyword: 'k', account: 'a', media: 'm' };
  const off = renderReply('Hola {{username}}', vars, BUTTONS, undefined, false);
  assert.deepEqual(Object.keys(off).sort(), ['buttons', 'text']);
  const on = renderReply('Hola {{username}}', vars, BUTTONS, undefined, true);
  assert.equal(on.linksInText, true);
  const noButtons = renderReply('Hola {{username}}', vars, [], undefined, true);
  assert.deepEqual(Object.keys(noButtons).sort(), ['buttons', 'text']);
  // 600 characters alone is valid; with the appended links it exceeds Meta's 640-character button-template limit.
  assert.doesNotThrow(() => renderReply('x'.repeat(600), vars, BUTTONS, undefined, false));
  assert.throws(() => renderReply('x'.repeat(600), vars, BUTTONS, undefined, true),
    (err: unknown) => err instanceof ButtonLinksTextTooLongError && err.code === BUTTON_LINKS_TEXT_TOO_LONG_CODE);
});

test('facebookMessageText keeps the historic append when off, even if the text already ends with the same lines', () => {
  const buttons = [{ title: 'Ver', url: 'https://x.com/' }];
  assert.equal(facebookMessageText('Hola\n\nVer: https://x.com/', buttons), 'Hola\n\nVer: https://x.com/\nVer: https://x.com/');
  assert.equal(facebookMessageText('Hola', buttons), 'Hola\nVer: https://x.com/');
  assert.equal(facebookMessageText('Hola\n\nVer: https://x.com/', buttons, true), 'Hola\n\nVer: https://x.com/');
});
