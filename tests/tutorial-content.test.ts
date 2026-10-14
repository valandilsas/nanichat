import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { ALLOWED_LINK_HOSTS, COMING_SOON_PLATFORMS, SAFETY_RULES, TUTORIALS } from '../app/tutorial/content.ts';

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

test('every help prompt is copy-paste ready: header, placeholders and the mandatory safety rules', () => {
  for (const { platform, step } of all) {
    const where = `${platform}/${step.id}`;
    assert.match(step.helpPrompt, /\[REEMPLAZA: [^\]]+\]/u, where);
    assert.match(step.helpPrompt, /Paso \d+ de \d+ del tutorial de (Instagram|Facebook)/u, where);
    assert.ok(step.helpPrompt.includes(step.title), where);
    for (const rule of SAFETY_RULES) assert.ok(step.helpPrompt.includes(rule), `${where}: ${rule.slice(0, 30)}`);
    assert.match(step.helpPrompt, /Nunca me pidas ni aceptes tokens/u, where);
    assert.match(step.helpPrompt, /documentación oficial de Meta/u, where);
    assert.match(step.helpPrompt, /un solo paso a la vez/u, where);
  }
});

test('all links are https, on an official host, without credentials, query strings or duplicates per step', () => {
  for (const { platform, step } of all) {
    const urls = step.links.map((link) => link.url);
    assert.equal(new Set(urls).size, urls.length, `${platform}/${step.id} duplicate links`);
    for (const link of step.links) {
      assert.ok(link.label.trim());
      const url = new URL(link.url);
      assert.equal(url.protocol, 'https:', link.url);
      assert.ok(ALLOWED_LINK_HOSTS.includes(url.hostname), link.url);
      assert.equal(url.username + url.password + url.search + url.hash, '', link.url);
    }
  }
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

test('links only use documentation URLs verified by the research (no /documentation/ guesses)', () => {
  for (const { platform, step } of all) {
    for (const link of step.links) {
      assert.doesNotMatch(link.url, /\/documentation\//u, `${platform}/${step.id}`);
      assert.doesNotMatch(link.url, /async\/registration/u, `${platform}/${step.id}`);
    }
  }
});

test('TikTok is announced as coming soon with no tutorial content', () => {
  assert.deepEqual(COMING_SOON_PLATFORMS.map((platform) => platform.id), ['tiktok']);
  assert.equal(Object.keys(TUTORIALS).includes('tiktok'), false);
});
