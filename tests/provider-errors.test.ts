import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProviderRequestError, toProviderRequestError } from '../src/core/errors.ts';
import { openDatabase } from '../src/db/database.ts';
import { migrateDatabase } from '../src/db/migrations.ts';
import { listEncryptedCredentials } from '../src/db/repositories.ts';
import { createApiHandler } from '../src/http/router.ts';
import { createVault } from '../src/security/vault.ts';
import { ConnectionService } from '../src/services/connections.ts';
import {
  DISCOVERY_EMPTY_HINT, PROVIDER_MESSAGE_PREFIX, errorToastLabel, providerErrorMessage, validationFailureMessage,
} from '../app/provider-errors.ts';
import { removeTempDir } from './helpers/tmp.ts';

const SECRET = 'EAAB_FAKE_SECRET_TOKEN_123';

/** Mimics the provider's internal safe error plus the unsafe extras it may carry (message text, details). */
function metaLikeError(code: string, httpStatus?: number, metaCode?: number, metaSubcode?: number) {
  const error = Object.assign(new Error(`${code} ${SECRET}`), { code, httpStatus, metaCode, metaSubcode });
  (error as unknown as { details: unknown }).details = { message: `Invalid OAuth access token ${SECRET}`, fbtraceId: 'trace' };
  return error;
}

test('toProviderRequestError keeps only code and numeric fields, never message or details', () => {
  const converted = toProviderRequestError(metaLikeError('meta_api_error', 400, 190, 463));
  assert.ok(converted instanceof ProviderRequestError);
  assert.equal(converted.code, 'meta_api_error');
  assert.equal(converted.httpStatus, 400);
  assert.equal(converted.metaCode, 190);
  assert.equal(converted.metaSubcode, 463);
  assert.equal(converted.message, 'meta_api_error');
  assert.equal(JSON.stringify(converted).includes(SECRET), false);
  assert.equal(converted.stack?.includes(SECRET), false);
});

test('toProviderRequestError ignores non provider errors and unsafe codes', () => {
  assert.equal(toProviderRequestError(new Error('plain')), undefined);
  assert.equal(toProviderRequestError(Object.assign(new Error('x'), { code: 'ENOENT' })), undefined);
  assert.equal(toProviderRequestError('meta_api_error'), undefined);
  const odd = toProviderRequestError(Object.assign(new Error('x'), { code: `meta_${SECRET} bad`, metaCode: '190', httpStatus: 1.5 }));
  assert.equal(odd, undefined);
  const noNumbers = toProviderRequestError(Object.assign(new Error('x'), { code: 'meta_invalid_response', metaCode: '190' as never }));
  assert.equal(noNumbers?.metaCode, undefined);
});

function serviceWith(provider: Record<string, unknown>) {
  const directory = mkdtempSync(join(tmpdir(), 'social-provider-errors-'));
  const db = openDatabase(directory);
  migrateDatabase(db);
  const vault = createVault(directory, () => listEncryptedCredentials(db));
  const service = new ConnectionService(db, vault, provider as never);
  return { directory, db, service };
}

test('ConnectionService converts provider failures of discover and listMedia into ProviderRequestError', async () => {
  const failure = metaLikeError('meta_api_error', 400, 190);
  const { directory, db, service } = serviceWith({
    validateConnection: async () => ({ status: 'valid', observedAt: '2026-10-05T00:00:00Z', providerUserId: 'u', capabilities: [] }),
    discoverAccounts: async () => { throw failure; },
  });
  try {
    await service.create({ id: 'c1', name: 'N', loginKind: 'facebook_login', appId: 'app', graphVersion: 'v26.0', accessToken: 'user-token' });
    await service.testConnection('c1');
    await assert.rejects(service.discoverAccounts('c1'), (error: unknown) => {
      assert.ok(error instanceof ProviderRequestError);
      assert.equal(error.metaCode, 190);
      assert.equal(JSON.stringify(error).includes(SECRET), false);
      return true;
    });
  } finally { db.close(); removeTempDir(directory); }
});

test('ConnectionService keeps non provider errors unchanged and testConnection still stores invalid status', async () => {
  const { directory, db, service } = serviceWith({
    validateConnection: async () => ({ status: 'invalid', observedAt: '2026-10-05T00:00:00Z', capabilities: [], safeErrorCode: 'meta_190' }),
  });
  try {
    await service.create({ id: 'c2', name: 'N', loginKind: 'facebook_login', appId: 'app', graphVersion: 'v26.0', accessToken: 'user-token' });
    const validation = await service.testConnection('c2');
    assert.equal(validation.status, 'invalid');
    assert.equal(validation.safeErrorCode, 'meta_190');
    await assert.rejects(service.discoverAccounts('c2'), (error: unknown) => !(error instanceof ProviderRequestError) && error instanceof Error);
  } finally { db.close(); removeTempDir(directory); }
});

async function callApi(error: Error) {
  const directory = mkdtempSync(join(tmpdir(), 'social-provider-router-'));
  const db = openDatabase(directory);
  migrateDatabase(db);
  const handler = createApiHandler({
    database: db, csrfToken: 'tok',
    connections: { discoverAccounts: async () => { throw error; } },
  } as never);
  const server: Server = createServer((req, res) => { void handler(req, res); });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    return await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(new URL('/api/connections/c1/discover', origin), {
        method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-csrf-token': 'tok' },
      }, (res) => { let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body })); });
      req.on('error', reject);
      req.end('{}');
    });
  } finally { server.close(); db.close(); removeTempDir(directory); }
}

test('router maps ProviderRequestError to 502 with an allowlisted body', async () => {
  const error = new ProviderRequestError('meta_api_error', { httpStatus: 400, metaCode: 190, metaSubcode: 463 });
  Object.assign(error, { details: { message: SECRET }, token: SECRET, extra: 'x' });
  const result = await callApi(error);
  assert.equal(result.status, 502);
  assert.deepEqual(JSON.parse(result.body), { error: 'meta_api_error', httpStatus: 400, metaCode: 190, metaSubcode: 463 });
  assert.equal(result.body.includes(SECRET), false);
});

test('router omits absent numeric fields and keeps other errors as operation_rejected', async () => {
  const bare = await callApi(new ProviderRequestError('meta_invalid_response'));
  assert.equal(bare.status, 502);
  assert.deepEqual(JSON.parse(bare.body), { error: 'meta_invalid_response' });
  const other = await callApi(new Error(`boom ${SECRET}`));
  assert.equal(other.status, 409);
  assert.deepEqual(JSON.parse(other.body), { error: 'operation_rejected' });
});

test('providerErrorMessage gives a clear Spanish message per Meta code', () => {
  assert.equal(providerErrorMessage({ metaCode: 190 }), 'El token venció o no es válido. Genera uno nuevo en el Explorador de la API Graph y edita la conexión.');
  const perm = 'Falta un permiso o la app no puede acceder. Revisa que el token incluya pages_show_list, pages_read_engagement, pages_read_user_content y pages_messaging.';
  for (const metaCode of [10, 200, 230, 299]) assert.equal(providerErrorMessage({ metaCode }), perm);
  assert.equal(providerErrorMessage({ metaCode: 100 }), 'Meta no pudo listar tus Páginas con este token. Si pegaste el token de una Página, NaniChat intentó usarlo directamente; si aun así falla, genera un token de usuario: en el Explorador elige «Token del usuario» en el selector Usuario o página.');
  const limited = 'Meta limitó las solicitudes. Espera unos minutos y vuelve a intentarlo.';
  for (const metaCode of [4, 17, 32, 613, 80001]) assert.equal(providerErrorMessage({ metaCode }), limited);
  assert.equal(providerErrorMessage({ httpStatus: 429 }), limited);
  assert.equal(providerErrorMessage({ httpStatus: 500, metaCode: 2, metaSubcode: 1357 }),
    'Meta respondió con un error (código 2, subcódigo 1357, HTTP 500). Si se repite, revisa el tutorial de Conexiones.');
  assert.equal(providerErrorMessage({ code: 'meta_invalid_response' }),
    'Meta respondió con un error (meta_invalid_response). Si se repite, revisa el tutorial de Conexiones.');
});

test('validationFailureMessage reads the stored safe error code of a failed connection test', () => {
  assert.equal(validationFailureMessage('meta_190'), providerErrorMessage({ metaCode: 190 }));
  assert.equal(validationFailureMessage('meta_190_463'), providerErrorMessage({ metaCode: 190 }));
  assert.equal(validationFailureMessage('meta_10'), providerErrorMessage({ metaCode: 10 }));
  assert.equal(validationFailureMessage('meta_invalid_identity'), providerErrorMessage({ code: 'meta_invalid_identity' }));
  assert.equal(validationFailureMessage(undefined), providerErrorMessage({}));
});

test('errorToastLabel shows provider messages and falls back to the generic label', () => {
  const generic = (code: string) => `generic:${code}`;
  assert.equal(errorToastLabel(`${PROVIDER_MESSAGE_PREFIX}Hola`, generic), 'Hola');
  assert.equal(errorToastLabel('operation_rejected', generic), 'generic:operation_rejected');
});

test('discovery with zero candidates has a dedicated Spanish hint', () => {
  assert.equal(DISCOVERY_EMPTY_HINT, 'Meta no devolvió ninguna Página ni cuenta para este token. Revisa que sea un token de usuario con pages_show_list y que elegiste la Página al aceptar el diálogo de Facebook.');
});

test('page wires the provider error helpers into api(), the toast and the discovery list', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /throw apiErrorFromBody\(response\.status, data\)/u);
  assert.match(page, /errorToastLabel\(error, safeErrorLabel\)/u);
  assert.match(page, /validationFailureMessage\(tested\.validation\?\.safeErrorCode\)/u);
  assert.match(page, /DISCOVERY_EMPTY_HINT/u);
});

test('connection_identity_mismatch gets a specific Spanish message telling the user to create a new connection', () => {
  const message = validationFailureMessage('connection_identity_mismatch');
  assert.match(message, /otra identidad/);
  assert.match(message, /Elimina la conexión y crea una nueva/);
  assert.equal(message.includes('Meta respondió'), false);
});
