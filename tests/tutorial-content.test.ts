import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { ALLOWED_LINK_HOSTS, APP_ID_PLACEHOLDER, COMING_SOON_PLATFORMS, DEEP_LINK_PATTERNS, TUTORIALS, VERIFIED_STATIC_URLS } from '../app/tutorial/content.ts';

const all = Object.values(TUTORIALS).flatMap((platform) => platform.steps.map((step) => ({ platform: platform.id, step })));

test('both platforms have the planned number of ordered steps', () => {
  assert.equal(TUTORIALS.instagram.steps.length, 12);
  assert.equal(TUTORIALS.facebook.steps.length, 13);
});

test('every step has a unique valid id, a title, instructions and the required fields', () => {
  for (const platform of Object.values(TUTORIALS)) {
    const ids = platform.steps.map((step) => step.id);
    assert.equal(new Set(ids).size, ids.length, `${platform.id} ids are unique`);
  }
  for (const { platform, step } of all) {
    const where = `${platform}/${step.id}`;
    assert.match(step.id, /^[a-z0-9-]{1,48}$/u, where);
    assert.ok(step.title.trim() && step.summary.trim() && step.whyItMatters.trim(), where);
    assert.ok(step.instructions.length >= 1 && step.instructions.every((line) => line.trim()), where);
    assert.match(step.expectedResult, /^Sabrás que está bien cuando/u, where);
    assert.equal(step.screenshot.pending, step.screenshot.file === undefined, `${where}: pending means no file`);
    if (step.screenshot.file) {
      assert.equal(step.screenshot.file, `/tutorial/${platform}/${step.id}.svg`, where);
      assert.ok(existsSync(new URL(`../public${step.screenshot.file}`, import.meta.url)), `${where}: file exists under public/`);
    }
    assert.ok(step.screenshot.alt.trim() && step.screenshot.caption.trim(), where);
    assert.equal(typeof step.verified, 'boolean', where);
    if (!step.verified) assert.match(step.verifyNote ?? '', /^Paso por verificar/u, where);
  }
});

test('steps carry the data the prompt generator needs and no static help prompt', () => {
  for (const { platform, step } of all) {
    const where = `${platform}/${step.id}`;
    assert.ok(step.goal.trim().endsWith('.'), `${where}: goal is a sentence`);
    assert.equal('helpPrompt' in step, false, where);
  }
});

const DUMMY_APP_ID = '1234567890123';
const fill = (url: string) => url.split(APP_ID_PLACEHOLDER).join(DUMMY_APP_ID);

test('all links are https, on an official host, without credentials or fragments, and unique per step', () => {
  for (const { platform, step } of all) {
    const urls = step.links.map((link) => link.url);
    assert.equal(new Set(urls).size, urls.length, `${platform}/${step.id} duplicate links`);
    for (const link of step.links) {
      assert.ok(link.label.trim());
      const url = new URL(fill(link.url));
      assert.equal(url.protocol, 'https:', link.url);
      assert.ok(ALLOWED_LINK_HOSTS.includes(url.hostname), link.url);
      assert.equal(url.username + url.password + url.hash, '', link.url);
      // Query strings only exist on the observed deep links.
      if (url.search) assert.ok(DEEP_LINK_PATTERNS.includes(link.url), `${link.url} has a query but is not a known deep link`);
    }
  }
});

test('links are limited to the verified roots, canonical /documentation/ pages and the observed App-ID deep links', () => {
  assert.equal(DEEP_LINK_PATTERNS.length, 4);
  for (const pattern of DEEP_LINK_PATTERNS) assert.ok(pattern.startsWith(`https://developers.facebook.com/apps/${APP_ID_PLACEHOLDER}/`), pattern);
  for (const { platform, step } of all) {
    for (const link of step.links) {
      const where = `${platform}/${step.id}: ${link.url}`;
      if (link.url.includes(APP_ID_PLACEHOLDER)) assert.ok(DEEP_LINK_PATTERNS.includes(link.url), where);
      else assert.ok(VERIFIED_STATIC_URLS.includes(link.url), where);
      // Meta moved its docs: only the explorer guide is still served from /docs/.
      if (link.url.includes('/docs/')) assert.equal(link.url, 'https://developers.facebook.com/docs/graph-api/guides/explorer', where);
      assert.doesNotMatch(link.url, /async\/registration|get-started/u, where);
    }
  }
  for (const url of VERIFIED_STATIC_URLS) assert.ok(all.some(({ step }) => step.links.some((link) => link.url === url)), `${url} is used by some step`);
  for (const url of DEEP_LINK_PATTERNS) assert.ok(all.some(({ step }) => step.links.some((link) => link.url === url)), `${url} is used by some step`);
});

test('a step with an App-ID deep link also offers the root panel link as fallback', () => {
  const withDeep = all.filter(({ step }) => step.links.some((link) => link.url.includes(APP_ID_PLACEHOLDER)));
  assert.ok(withDeep.length >= 4);
  for (const { platform, step } of withDeep) assert.ok(step.links.some((link) => link.url === 'https://developers.facebook.com/apps/'), `${platform}/${step.id}`);
});

test('help-site links are labelled as unverified menus', () => {
  const helpLinks = all.flatMap(({ step }) => step.links).filter((link) => /help\.instagram\.com|facebook\.com\/business\/help/u.test(link.url));
  assert.ok(helpLinks.length >= 2);
  for (const link of helpLinks) assert.match(link.label, /por verificar el menú/u);
});

test('the Instagram documentation link has its section label and the token debugger is offered for Facebook tokens', () => {
  const links = all.flatMap(({ step }) => step.links);
  assert.ok(links.some((link) => link.url === 'https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/' && link.label === 'Documentación de Instagram API con Instagram Login'));
  const explorerStep = TUTORIALS.facebook.steps.find((step) => step.id === 'generar-token-usuario')!;
  assert.ok(explorerStep.links.some((link) => link.url === 'https://developers.facebook.com/tools/debug/accesstoken/' && /Revisa tu token/u.test(link.label)));
});

test('content carries no real-looking tokens, long numeric ids, emails or secrets', () => {
  const text = JSON.stringify(TUTORIALS);
  assert.doesNotMatch(text, /\b(EAA|IGQ|IGAA)[A-Za-z0-9]{8,}/u);
  // Official help-article URLs carry a numeric document id; everything else must have no long numbers.
  assert.doesNotMatch(text.replace(/https:\/\/[^"\s]+/gu, ''), /\b\d{10,}\b/u);
  assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[\w.]+/u);
  assert.doesNotMatch(text, /[A-Za-z0-9_-]{40,}/u);
  assert.doesNotMatch(text, /\/home\/|C:\\\\Users/u);
});

test('unverified steps are honestly flagged and verified ones exist too', () => {
  const unverified = all.filter(({ step }) => !step.verified).map(({ platform, step }) => `${platform}/${step.id}`);
  assert.ok(unverified.includes('instagram/portafolio-comercial'));
  assert.ok(unverified.includes('facebook/portafolio-comercial'));
  assert.ok(all.some(({ step }) => step.verified));
});

test('the troubleshooting step for the observed account-confirmation notice exists on both platforms', () => {
  for (const platform of ['instagram', 'facebook'] as const) {
    const step = TUTORIALS[platform].steps.at(-1)!;
    assert.equal(step.id, 'confirmar-cuenta', platform);
    const text = JSON.stringify(step);
    assert.match(text, /Es necesario confirmar la cuenta/u);
    assert.match(text, /Confirmar cuenta/u);
    assert.match(text, /actividad inusual/u);
    assert.match(text, /automatizad/u, 'warns against automated browsing');
  }
});

test('portfolio steps explain that the portfolio is optional and when it becomes mandatory', () => {
  for (const platform of ['instagram', 'facebook'] as const) {
    const step = TUTORIALS[platform].steps.find((item) => item.id === 'portafolio-comercial')!;
    const text = JSON.stringify(step);
    assert.match(text, /opcional/u);
    assert.match(text, /Verificación de Empresa|verificación de empresa/u);
    assert.match(text, /business_management/u);
    assert.match(text, /acceso estándar|Acceso estándar/u);
    assert.ok(step.links.some((link) => link.url === 'https://business.facebook.com/settings'));
    assert.equal(step.verified, false);
  }
});

test('steps from the research that rest on inferences or unknown labels are flagged as unverified', () => {
  const unverified = new Set(all.filter(({ step }) => !step.verified).map(({ platform, step }) => `${platform}/${step.id}`));
  for (const id of ['instagram/requisitos', 'instagram/agregar-probador', 'instagram/generar-token', 'facebook/portafolio-comercial']) assert.ok(unverified.has(id), id);
});

test('the Facebook steps carry the live-observed Explorer, pop-up, selector and identity facts', () => {
  const token = JSON.stringify(TUTORIALS.facebook.steps.find((step) => step.id === 'generar-token-usuario'));
  for (const text of ['App de Meta', 'Usuario o página', 'Obtener token de acceso de usuario', 'Agregar un permiso', 'opciones seleccionadas', 'Generate Access Token', 'ventana aparte', 'ventanas emergentes', 'Token del usuario', 'alrededor de una hora']) assert.ok(token.includes(text), text);
  const paste = JSON.stringify(TUTORIALS.facebook.steps.find((step) => step.id === 'pegar-token'));
  assert.match(paste, /connection_identity_mismatch/u);
  assert.match(paste, /elimina la conexión y crea una nueva/u);
  const discover = JSON.stringify(TUTORIALS.facebook.steps.find((step) => step.id === 'probar-seleccionar'));
  assert.match(discover, /instagram_basic/u);
  const cases = JSON.stringify(TUTORIALS.facebook.steps.find((step) => step.id === 'casos-uso-paginas'));
  for (const text of ['Administrar todos los aspectos de tu página', 'Interactuar con los clientes en Messenger from Meta', 'Mensajes comerciales', 'casilla', 'Guardar', 'no se puede deshacer']) assert.ok(cases.includes(text), text);
  const perms = JSON.stringify(TUTORIALS.facebook.steps.find((step) => step.id === 'permisos'));
  for (const text of ['Listo para la prueba', 'Acciones', 'pages_read_user_content', 'pages_manage_engagement', 'pages_messaging']) assert.ok(perms.includes(text), text);
});

test('the first-hand Explorer steps are verified while unobserved ones stay flagged', () => {
  const byId = (platform: 'instagram' | 'facebook', id: string) => TUTORIALS[platform].steps.find((step) => step.id === id)!;
  assert.equal(byId('facebook', 'generar-token-usuario').verified, true);
  for (const [platform, id] of [['instagram', 'cuenta-desarrollador'], ['facebook', 'cuenta-desarrollador'], ['instagram', 'portafolio-comercial'], ['instagram', 'agregar-probador'], ['instagram', 'generar-token'], ['facebook', 'token-larga-duracion']] as const) {
    assert.equal(byId(platform, id).verified, false, `${platform}/${id}`);
  }
});

test('TikTok is announced as coming soon with no tutorial content', () => {
  assert.deepEqual(COMING_SOON_PLATFORMS.map((platform) => platform.id), ['tiktok']);
  assert.equal(Object.keys(TUTORIALS).includes('tiktok'), false);
});
