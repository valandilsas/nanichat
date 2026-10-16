import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DOMAIN_REJECTION_CODES, DomainRejectionError } from '../src/core/errors.ts';
import { createApiHandler } from '../src/http/router.ts';
import { openDatabase } from '../src/db/database.ts';
import { migrateDatabase } from '../src/db/migrations.ts';
import { addDiscoveredAccount, createConnection, createMedia } from '../src/db/repositories.ts';
import { AutomationService } from '../src/services/automations.ts';
import { DOMAIN_REJECTION_LABELS, realModeAction } from '../app/automation-actions.ts';
import { removeTempDir } from './helpers/tmp.ts';

type Db = ReturnType<typeof openDatabase>;

async function withDb(run: (db: Db) => Promise<void> | void) {
  const directory = mkdtempSync(join(tmpdir(), 'domain-rejections-'));
  const db = openDatabase(directory);
  migrateDatabase(db);
  try { await run(db); } finally { db.close(); removeTempDir(directory); }
}

function seed(db: Db) {
  createConnection(db, {
    id: 'conn', name: 'test', providerCode: 'META', loginKind: 'instagram_login', graphVersion: 'v26.0',
    status: 'valid', accessToken: { nonce: 'n', ciphertext: 'c', tag: 't' },
  });
  addDiscoveredAccount(db, { accountId: 'acc', connectionId: 'conn', providerAccountId: 'p', username: 'brand', status: 'valid' });
  createMedia(db, { accountId: 'acc', mediaId: 'media', permalink: null, publishedAt: null });
  const service = new AutomationService(db);
  const id = service.create({ accountId: 'acc', mediaId: 'media', name: 'a', replyText: 'Hi' });
  service.addKeyword('acc', id, 'guide');
  return { service, id };
}

function rejection(fn: () => void): DomainRejectionError {
  try { fn(); } catch (error) { assert.ok(error instanceof DomainRejectionError, String(error)); return error; }
  throw new assert.AssertionError({ message: 'expected a throw' });
}

test('real mode on a paused automation throws automation_not_enabled and keeps the message', async () => {
  await withDb((db) => {
    const { service, id } = seed(db);
    const error = rejection(() => service.setRealEnabled('acc', id, true, true));
    assert.equal(error.code, 'automation_not_enabled');
    assert.match(error.message, /Only an enabled automation can change real-reply mode/);
  });
});

test('real mode on an unvalidated account or connection throws account_not_validated', async () => {
  await withDb((db) => {
    const { service, id } = seed(db);
    service.setEnabled('acc', id, true);
    db.prepare(`UPDATE connections SET status='invalid' WHERE id='conn'`).run();
    const error = rejection(() => service.setRealEnabled('acc', id, true, true));
    assert.equal(error.code, 'account_not_validated');
    assert.match(error.message, /validated account and connection/);
  });
});

test('real mode under a safety hold throws account_send_hold', async () => {
  await withDb((db) => {
    const { service, id } = seed(db);
    service.setEnabled('acc', id, true);
    service.setAccountSendHold('acc', 'legacy_sender_lock_uncertain');
    const error = rejection(() => service.setRealEnabled('acc', id, true, true));
    assert.equal(error.code, 'account_send_hold');
    assert.match(error.message, /safety hold/i);
  });
});

test('real mode still requires explicit confirmation and that rejection stays a plain error', async () => {
  await withDb((db) => {
    const { service, id } = seed(db);
    service.setEnabled('acc', id, true);
    assert.throws(() => service.setRealEnabled('acc', id, true, false), (error: unknown) => {
      return error instanceof Error && !(error instanceof DomainRejectionError) && /Explicit confirmation/.test(error.message);
    });
  });
});

async function withApi(run: (ctx: { service: AutomationService; id: string; db: Db; patch: (path: string, body: unknown) => Promise<{ status: number; raw: string }> }) => Promise<void>) {
  await withDb(async (db) => {
    const { service, id } = seed(db);
    const handler = createApiHandler({ database: db, csrfToken: 'csrf', automations: service } as never);
    const server = createServer((req, res) => { void handler(req, res); });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const patch = (path: string, body: unknown) => new Promise<{ status: number; raw: string }>((resolve, reject) => {
      const req = request(new URL(path, origin), { method: 'PATCH', headers: { origin, 'x-csrf-token': 'csrf', 'content-type': 'application/json' } }, (res) => {
        let raw = ''; res.setEncoding('utf8'); res.on('data', (c) => { raw += c; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, raw }));
      });
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
    try { await run({ service, id, db, patch }); } finally { server.close(); }
  });
}

test('API: PATCH /real maps each domain rejection to 409 with only the stable code', async () => {
  await withApi(async ({ service, id, db, patch }) => {
    const body = { accountId: 'acc', enabled: true, confirmed: true };
    const paused = await patch(`/api/automations/${id}/real`, body);
    assert.equal(paused.status, 409);
    assert.equal(paused.raw, JSON.stringify({ error: 'automation_not_enabled' }));
    service.setEnabled('acc', id, true);
    service.setAccountSendHold('acc', 'legacy_sender_lock_uncertain');
    const held = await patch(`/api/automations/${id}/real`, body);
    assert.equal(held.status, 409);
    assert.equal(held.raw, JSON.stringify({ error: 'account_send_hold' }));
    service.clearAccountSendHold('acc', 'legacy_sender_lock_uncertain');
    db.prepare(`UPDATE connections SET status='invalid' WHERE id='conn'`).run();
    const invalid = await patch(`/api/automations/${id}/real`, body);
    assert.equal(invalid.raw, JSON.stringify({ error: 'account_not_validated' }));
    const unconfirmed = await patch(`/api/automations/${id}/real`, { accountId: 'acc', enabled: true });
    assert.equal(unconfirmed.raw, JSON.stringify({ error: 'operation_rejected' }));
  });
});

test('realModeAction: paused automations cannot be authorized but real can always be removed', () => {
  assert.deepEqual(realModeAction({ status: 'disabled', realEnabled: false }),
    { label: 'Autorizar real', disabled: true, hint: 'Reanuda la automatización con ▶ para poder autorizar el modo real' });
  assert.deepEqual(realModeAction({ status: 'enabled', realEnabled: false }), { label: 'Autorizar real', disabled: false, hint: undefined });
  assert.deepEqual(realModeAction({ status: 'enabled', realEnabled: true }), { label: 'Quitar permiso real', disabled: false, hint: undefined });
  assert.deepEqual(realModeAction({ status: 'disabled', realEnabled: true }), { label: 'Quitar permiso real', disabled: false, hint: undefined });
});

test('every domain rejection code has a Spanish label', () => {
  for (const code of DOMAIN_REJECTION_CODES) {
    assert.ok(DOMAIN_REJECTION_LABELS[code] && DOMAIN_REJECTION_LABELS[code].length > 20, code);
  }
});

test('page.tsx renders the real-mode button through the helper and the label map', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /realModeAction\(row\)/);
  assert.match(page, /\.\.\.DOMAIN_REJECTION_LABELS/);
});
