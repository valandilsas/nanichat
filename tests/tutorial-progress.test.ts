import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  EMPTY_PROGRESS, TUTORIAL_PROGRESS_KEY, goTo, isCompleted, isValidAppId, markCompleted, parseStoredProgress, percentComplete, resetPlatform, setAppId, validateProgress,
} from '../app/tutorial/progress.ts';
import { createApiHandler } from '../src/http/router.ts';
import { openDatabase } from '../src/db/database.ts';
import { migrateDatabase } from '../src/db/migrations.ts';
import { removeTempDir } from './helpers/tmp.ts';

test('empty progress and the storage key are stable', () => {
  assert.equal(TUTORIAL_PROGRESS_KEY, 'tutorial_progress');
  assert.deepEqual(EMPTY_PROGRESS, { version: 1, platforms: {} });
});

test('validateProgress accepts a well-formed document and returns a normalized copy', () => {
  const input = { version: 1, platforms: { instagram: { currentStep: 2, completed: ['a-1', 'b-2'] }, facebook: { currentStep: 0, completed: [] } } };
  const result = validateProgress(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.deepEqual(validateProgress({ version: 1, platforms: {} }), EMPTY_PROGRESS);
  assert.deepEqual(validateProgress({ version: 1 }), EMPTY_PROGRESS);
});

test('validateProgress rejects anything outside the strict shape', () => {
  const bad: unknown[] = [
    null, 'x', [], 7,
    { version: 2, platforms: {} },
    { platforms: {} },
    { version: 1, platforms: [] },
    { version: 1, platforms: {}, extra: true },
    { version: 1, platforms: { tiktok: { currentStep: 0, completed: [] } } },
    { version: 1, platforms: { instagram: { currentStep: 0, completed: [], extra: 1 } } },
    { version: 1, platforms: { instagram: { currentStep: -1, completed: [] } } },
    { version: 1, platforms: { instagram: { currentStep: 1.5, completed: [] } } },
    { version: 1, platforms: { instagram: { currentStep: 100, completed: [] } } },
    { version: 1, platforms: { instagram: { currentStep: '1', completed: [] } } },
    { version: 1, platforms: { instagram: { currentStep: 0, completed: 'a' } } },
    { version: 1, platforms: { instagram: { currentStep: 0, completed: ['Bad Id'] } } },
    { version: 1, platforms: { instagram: { currentStep: 0, completed: ['a'.repeat(49)] } } },
    { version: 1, platforms: { instagram: { currentStep: 0, completed: [''] } } },
    { version: 1, platforms: { instagram: { currentStep: 0, completed: ['a', 'a'] } } },
    { version: 1, platforms: { instagram: { currentStep: 0, completed: Array.from({ length: 41 }, (_, i) => `s-${i}`) } } },
    { version: 1, platforms: { instagram: { currentStep: 0, completed: [1] } } },
  ];
  for (const value of bad) assert.throws(() => validateProgress(value), TypeError, JSON.stringify(value));
});

const DUMMY_APP_ID = '1234567890123';

test('appId is optional, digits only (8-20), and validated like the rest of the document', () => {
  assert.equal(validateProgress({ version: 1, appId: DUMMY_APP_ID, platforms: {} }).appId, DUMMY_APP_ID);
  assert.equal(validateProgress({ version: 1, appId: '12345678', platforms: {} }).appId, '12345678');
  assert.equal(validateProgress({ version: 1, appId: '1'.repeat(20), platforms: {} }).appId, '1'.repeat(20));
  assert.equal('appId' in validateProgress({ version: 1, platforms: {} }), false);
  for (const appId of ['1234567', '1'.repeat(21), 'abc12345678', '123 45678', ' 12345678', '12345678\n', '', 12345678, null, {}, '１２３４５６７８']) {
    assert.throws(() => validateProgress({ version: 1, appId, platforms: {} }), TypeError, JSON.stringify(appId));
  }
  assert.equal(isValidAppId(DUMMY_APP_ID), true);
  assert.equal(isValidAppId('12'), false);
  assert.equal(isValidAppId(5), false);
});

test('setAppId stores or clears the id, rejects invalid values, and every other helper keeps it', () => {
  const withId = setAppId(EMPTY_PROGRESS, DUMMY_APP_ID);
  assert.equal(withId.appId, DUMMY_APP_ID);
  assert.deepEqual(EMPTY_PROGRESS, { version: 1, platforms: {} }, 'input is not mutated');
  assert.throws(() => setAppId(EMPTY_PROGRESS, 'nope'), TypeError);
  assert.deepEqual(setAppId(withId, ''), EMPTY_PROGRESS);
  assert.equal(goTo(withId, 'facebook', 2).appId, DUMMY_APP_ID);
  assert.equal(markCompleted(withId, 'instagram', 'a-1').appId, DUMMY_APP_ID);
  assert.equal(resetPlatform(markCompleted(withId, 'instagram', 'a-1'), 'instagram').appId, DUMMY_APP_ID);
  assert.deepEqual(parseStoredProgress(JSON.stringify(withId)), withId);
  assert.deepEqual(parseStoredProgress(JSON.stringify({ version: 1, appId: 'bad', platforms: {} })), EMPTY_PROGRESS);
});

test('validateProgress ignores prototype pollution keys without touching Object.prototype', () => {
  const polluted = JSON.parse('{"version":1,"platforms":{"__proto__":{"currentStep":0,"completed":[]}}}');
  assert.throws(() => validateProgress(polluted), TypeError);
  assert.equal(({} as Record<string, unknown>).currentStep, undefined);
});

test('parseStoredProgress never throws: corrupt, missing or invalid storage falls back to empty progress', () => {
  assert.deepEqual(parseStoredProgress(undefined), EMPTY_PROGRESS);
  assert.deepEqual(parseStoredProgress(null), EMPTY_PROGRESS);
  assert.deepEqual(parseStoredProgress('{not json'), EMPTY_PROGRESS);
  assert.deepEqual(parseStoredProgress('{"version":9}'), EMPTY_PROGRESS);
  assert.deepEqual(parseStoredProgress(JSON.stringify({ version: 1, platforms: { instagram: { currentStep: 3, completed: ['x'] } } })),
    { version: 1, platforms: { instagram: { currentStep: 3, completed: ['x'] } } });
});

test('goTo, markCompleted, resetPlatform and percentComplete are pure and idempotent', () => {
  const start = EMPTY_PROGRESS;
  const moved = goTo(start, 'instagram', 4);
  assert.deepEqual(moved.platforms.instagram, { currentStep: 4, completed: [] });
  assert.deepEqual(start, { version: 1, platforms: {} }, 'input is not mutated');
  assert.equal(goTo(moved, 'instagram', -3).platforms.instagram?.currentStep, 0);
  assert.equal(goTo(moved, 'instagram', 500).platforms.instagram?.currentStep, 99);

  const done = markCompleted(markCompleted(moved, 'instagram', 'step-1'), 'instagram', 'step-1');
  assert.deepEqual(done.platforms.instagram?.completed, ['step-1']);
  assert.equal(done.platforms.instagram?.currentStep, 4);
  assert.equal(isCompleted(done, 'instagram', 'step-1'), true);
  assert.equal(isCompleted(done, 'facebook', 'step-1'), false);
  assert.throws(() => markCompleted(done, 'instagram', 'Not Valid'), TypeError);
  assert.equal(markCompleted(done, 'instagram', 'step-2').platforms.facebook, undefined);

  assert.equal(percentComplete(done, 'instagram', 4), 25);
  assert.equal(percentComplete(done, 'facebook', 4), 0);
  assert.equal(percentComplete(done, 'instagram', 0), 0);
  const stale = markCompleted(done, 'instagram', 'removed-step');
  assert.equal(percentComplete(stale, 'instagram', 2, ['step-1', 'step-2']), 50, 'counts only ids that still exist when given');

  assert.deepEqual(resetPlatform(done, 'instagram'), EMPTY_PROGRESS);
});

async function listen(handler: ReturnType<typeof createApiHandler>): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => { void handler(req, res); });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}
function call(origin: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(new URL(path, origin), { method: options.method ?? 'GET', headers: options.headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

test('GET/PUT /api/tutorial-progress persist validated progress in app_state and guard mutations', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'local-social-tutorial-'));
  const database = openDatabase(directory);
  migrateDatabase(database);
  const { server, origin } = await listen(createApiHandler({ database, csrfToken: 'test-csrf' } as never));
  context.after(() => { server.close(); database.close(); removeTempDir(directory); });
  const good = { origin, 'content-type': 'application/json', 'x-csrf-token': 'test-csrf' };

  const empty = await call(origin, '/api/tutorial-progress');
  assert.equal(empty.status, 200);
  assert.deepEqual(JSON.parse(empty.body), { progress: EMPTY_PROGRESS });

  const payload = { version: 1, platforms: { facebook: { currentStep: 3, completed: ['requisitos', 'cuenta-desarrollador'] } } };
  const saved = await call(origin, '/api/tutorial-progress', { method: 'PUT', headers: good, body: JSON.stringify(payload) });
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(saved.body), { progress: payload });
  assert.deepEqual(JSON.parse((await call(origin, '/api/tutorial-progress')).body), { progress: payload });
  const row = database.prepare(`SELECT state_value FROM app_state WHERE state_key='tutorial_progress'`).get() as { state_value: string };
  assert.deepEqual(JSON.parse(row.state_value), payload);

  const withAppId = { version: 1, appId: DUMMY_APP_ID, platforms: { facebook: { currentStep: 1, completed: [] } } };
  const savedWithId = await call(origin, '/api/tutorial-progress', { method: 'PUT', headers: good, body: JSON.stringify(withAppId) });
  assert.equal(savedWithId.status, 200);
  assert.deepEqual(JSON.parse((await call(origin, '/api/tutorial-progress')).body), { progress: withAppId });
  const badId = await call(origin, '/api/tutorial-progress', { method: 'PUT', headers: good, body: JSON.stringify({ ...withAppId, appId: 'EAAB-not-an-id' }) });
  assert.equal(badId.status, 400);
  assert.deepEqual(JSON.parse((await call(origin, '/api/tutorial-progress')).body), { progress: withAppId }, 'an invalid id changes nothing');
  await call(origin, '/api/tutorial-progress', { method: 'PUT', headers: good, body: JSON.stringify(payload) });

  for (const body of ['{"version":1,"platforms":{"tiktok":{"currentStep":0,"completed":[]}}}', '{"version":1,"platforms":{},"x":1}', '[]', '{"version":1,"platforms":{"instagram":{"currentStep":-1,"completed":[]}}}']) {
    const rejected = await call(origin, '/api/tutorial-progress', { method: 'PUT', headers: good, body });
    assert.equal(rejected.status, 400, body);
    assert.deepEqual(JSON.parse(rejected.body), { error: 'invalid_request' });
  }
  assert.deepEqual(JSON.parse((await call(origin, '/api/tutorial-progress')).body), { progress: payload }, 'rejected writes change nothing');

  assert.equal((await call(origin, '/api/tutorial-progress', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })).status, 403);
  assert.equal((await call(origin, '/api/tutorial-progress', { method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(payload) })).status, 403);
  assert.equal((await call(origin, '/api/tutorial-progress', { method: 'PUT', headers: { origin, 'content-type': 'text/plain', 'x-csrf-token': 'test-csrf' }, body: '{}' })).status, 415);
  assert.equal((await call(origin, '/api/tutorial-progress', { method: 'POST', headers: good, body: '{}' })).status, 405);
  assert.equal((await call(origin, '/api/tutorial-progress', { method: 'DELETE', headers: { ...good, 'content-length': '2' }, body: '{}' })).status, 405);

  database.prepare(`UPDATE app_state SET state_value='{corrupt' WHERE state_key='tutorial_progress'`).run();
  const corrupt = await call(origin, '/api/tutorial-progress');
  assert.equal(corrupt.status, 200);
  assert.deepEqual(JSON.parse(corrupt.body), { progress: EMPTY_PROGRESS });
});
