import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_PROGRESS, goTo, markCompleted } from '../app/tutorial/progress';
import { TUTORIALS } from '../app/tutorial/content';
import { APP_ID_HINT, CAPTURE_NOTE, isCapture, LOGIN_REDIRECT_NOTE, advance, clampStep, copyText, externalLinkAttrs, isSchematic, parseAppIdInput, progressSummary, resolveLink, screenshotView, SCHEMATIC_NOTE, startIndex, stepLabel, stepStatus } from '../app/tutorial/view';

const steps = TUTORIALS.instagram.steps;

test('stepLabel and clampStep keep the index inside the step list', () => {
  assert.equal(stepLabel(2, 11), 'Paso 3 de 11');
  assert.equal(clampStep(-4, 11), 0);
  assert.equal(clampStep(50, 11), 10);
  assert.equal(clampStep(3.7, 11), 3);
  assert.equal(clampStep(Number.NaN, 11), 0);
  assert.equal(clampStep(5, 0), 0);
});

test('startIndex resumes exactly where the person left, and survives content that shrank', () => {
  assert.equal(startIndex(EMPTY_PROGRESS, 'instagram', steps), 0);
  assert.equal(startIndex(goTo(EMPTY_PROGRESS, 'instagram', 6), 'instagram', steps), 6);
  assert.equal(startIndex(goTo(EMPTY_PROGRESS, 'instagram', 90), 'instagram', steps), steps.length - 1);
  assert.equal(startIndex(goTo(EMPTY_PROGRESS, 'facebook', 4), 'instagram', steps), 0);
});

test('progressSummary reports the label, completed count and percentage using only known steps', () => {
  let progress = goTo(EMPTY_PROGRESS, 'instagram', 2);
  progress = markCompleted(progress, 'instagram', steps[0]!.id);
  progress = markCompleted(progress, 'instagram', steps[1]!.id);
  progress = markCompleted(progress, 'instagram', 'removed-step');
  const summary = progressSummary(progress, 'instagram', steps, 2);
  assert.equal(summary.label, 'Paso 3 de 12');
  assert.equal(summary.completedCount, 2);
  assert.equal(summary.percent, 17);
  assert.equal(progressSummary(EMPTY_PROGRESS, 'facebook', TUTORIALS.facebook.steps, 0).percent, 0);
});

test('stepStatus distinguishes current, completed and pending steps', () => {
  const progress = markCompleted(EMPTY_PROGRESS, 'instagram', steps[0]!.id);
  assert.equal(stepStatus(progress, 'instagram', steps, 0, 3), 'completed');
  assert.equal(stepStatus(progress, 'instagram', steps, 3, 3), 'current');
  assert.equal(stepStatus(progress, 'instagram', steps, 1, 3), 'pending');
  assert.equal(stepStatus(progress, 'instagram', steps, 0, 0), 'completed', 'a completed step stays completed while viewed');
});

test('advance marks the current step as done and moves on; the last step stays in place', () => {
  const first = advance(EMPTY_PROGRESS, 'instagram', steps, 0);
  assert.deepEqual(first.platforms.instagram, { currentStep: 1, completed: [steps[0]!.id] });
  const last = advance(EMPTY_PROGRESS, 'instagram', steps, steps.length - 1);
  assert.equal(last.platforms.instagram?.currentStep, steps.length - 1);
  assert.deepEqual(last.platforms.instagram?.completed, [steps[steps.length - 1]!.id]);
});

test('screenshotView shows the image only when a file exists, otherwise a pending placeholder with the caption', () => {
  const pending = { alt: 'Alt', caption: 'Pie', pending: true as const };
  assert.deepEqual(screenshotView(pending), { kind: 'placeholder', label: 'Captura pendiente', caption: 'Pie' });
  assert.deepEqual(screenshotView({ ...pending, file: '/tutorial/instagram/x.png' }), { kind: 'image', src: '/tutorial/instagram/x.png', alt: 'Alt', caption: 'Pie' });
  assert.equal(screenshotView({ ...pending, file: 'https://evil.example/x.png' }).kind, 'placeholder');
  assert.equal(screenshotView({ ...pending, file: '/tutorial/../secret.png' }).kind, 'placeholder');
  assert.equal(screenshotView({ ...pending, file: '//evil.example/x.png' }).kind, 'placeholder');
});

test('screenshotView accepts .svg schematics under /tutorial/ and flags them so the UI can label them', () => {
  const base = { alt: 'Alt', caption: 'Pie', pending: false as const };
  assert.deepEqual(screenshotView({ ...base, file: '/tutorial/facebook/crear-app.svg' }), { kind: 'image', src: '/tutorial/facebook/crear-app.svg', alt: 'Alt', caption: 'Pie' });
  assert.equal(isSchematic('/tutorial/facebook/crear-app.svg'), true);
  assert.equal(isSchematic('/tutorial/facebook/crear-app.png'), false);
  assert.match(SCHEMATIC_NOTE, /^Esquema ilustrativo, no es una captura real/u);
  for (const bad of ['/tutorial/x.svg?a=1', '/tutorial/x.svg#a', '/tutorial/x.SVG', '/tutorial/a b.svg', '/other/x.svg', 'tutorial/x.svg', '/tutorial/x.svgz', '/tutorial/../x.svg']) {
    assert.equal(screenshotView({ ...base, file: bad }).kind, 'placeholder', bad);
  }
});

test('external links open in a new tab without opener or referrer', () => {
  assert.deepEqual(externalLinkAttrs(), { target: '_blank', rel: 'noopener noreferrer' });
});

test('copyText uses the async clipboard when it works', async () => {
  const written: string[] = [];
  const result = await copyText('hola', { clipboard: { writeText: async (value: string) => { written.push(value); } } });
  assert.equal(result, true);
  assert.deepEqual(written, ['hola']);
});

test('copyText falls back to the textarea path when the clipboard is missing or rejects', async () => {
  const calls: string[] = [];
  const fallback = (value: string) => { calls.push(value); return true; };
  assert.equal(await copyText('a', { fallback }), true);
  assert.equal(await copyText('b', { clipboard: { writeText: async () => { throw new Error('denied'); } }, fallback }), true);
  assert.deepEqual(calls, ['a', 'b']);
});

test('copyText reports failure instead of throwing when nothing can copy', async () => {
  assert.equal(await copyText('x', {}), false);
  assert.equal(await copyText('x', { fallback: () => { throw new Error('boom'); } }), false);
  assert.equal(await copyText('x', { fallback: () => false }), false);
});

test('resolveLink substitutes the app id into templated links and disables them while it is missing', () => {
  const fixed = { label: 'Panel de apps de Meta', url: 'https://developers.facebook.com/apps/' };
  const templated = { label: 'Panel de tu app', url: 'https://developers.facebook.com/apps/{APP_ID}/dashboard/' };
  assert.deepEqual(resolveLink(fixed, undefined), { label: fixed.label, href: fixed.url });
  assert.deepEqual(resolveLink(fixed, '1234567890123'), { label: fixed.label, href: fixed.url });
  assert.deepEqual(resolveLink(templated, '1234567890123'), { label: templated.label, href: 'https://developers.facebook.com/apps/1234567890123/dashboard/' });
  assert.deepEqual(resolveLink(templated, undefined), { label: templated.label, href: null, hint: APP_ID_HINT });
  assert.deepEqual(resolveLink(templated, ''), { label: templated.label, href: null, hint: APP_ID_HINT });
  assert.equal(resolveLink(templated, '12ab/../x').href, null, 'an invalid id never reaches a URL');
  assert.equal(APP_ID_HINT, 'Pega tu ID de app arriba para activar este enlace directo');
  assert.match(LOGIN_REDIRECT_NOTE, /^Si no has iniciado sesión, Meta te pedirá entrar y luego te devolverá a esta misma página\.$/u);
});

test('parseAppIdInput trims, accepts 8-20 digits, treats blank as clearing and flags the rest', () => {
  assert.deepEqual(parseAppIdInput('  1234567890123 '), { kind: 'valid', value: '1234567890123' });
  assert.deepEqual(parseAppIdInput(''), { kind: 'empty' });
  assert.deepEqual(parseAppIdInput('   '), { kind: 'empty' });
  for (const bad of ['123', 'abc', '1234567x', '1'.repeat(21), 'https://developers.facebook.com/apps/1234567890123/']) assert.deepEqual(parseAppIdInput(bad), { kind: 'invalid' }, bad);
});

test('real in-app captures (png/jpg/webp) are told apart from schematics and carry their own note', () => {
  assert.equal(CAPTURE_NOTE, 'Captura de ejemplo con datos ficticios de tu programa');
  for (const file of ['/tutorial/instagram/pegar-token.png', '/tutorial/facebook/probar-seleccionar.jpg', '/tutorial/x/y.webp']) {
    assert.equal(isCapture(file), true, file);
    assert.equal(isSchematic(file), false, file);
  }
  assert.equal(isCapture('/tutorial/facebook/crear-app.svg'), false);
  assert.doesNotMatch(CAPTURE_NOTE, /Esquema/u);
});
