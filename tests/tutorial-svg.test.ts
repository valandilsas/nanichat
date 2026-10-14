import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { TUTORIALS } from '../app/tutorial/content.ts';

const publicDir = new URL('../public/tutorial/', import.meta.url);
const all = Object.values(TUTORIALS).flatMap((platform) => platform.steps.map((step) => ({ platform: platform.id, step })));
const withSvg = all.filter(({ step }) => step.screenshot.file);
const readSvg = (file: string) => readFileSync(new URL(`../public${file}`, import.meta.url), 'utf8');

/** Tiny well-formedness check: balanced, properly nested tags; no DOCTYPE/ENTITY tricks. */
export function checkWellFormed(xml: string): string | null {
  if (/<!DOCTYPE|<!ENTITY|<\?(?!xml )/iu.test(xml)) return 'doctype, entity or processing instruction';
  const body = xml.replace(/<!--[\s\S]*?-->/gu, '').replace(/<\?xml[^>]*\?>/u, '');
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/gu;
  let cursor = 0;
  for (const match of body.matchAll(tag)) {
    const between = body.slice(cursor, match.index);
    if (/[<>]/u.test(between.replace(/&(amp|lt|gt|quot|apos);/gu, ''))) return `stray angle bracket near ${match.index}`;
    if (/&(?!(amp|lt|gt|quot|apos|#\d+);)/u.test(between)) return `bad entity near ${match.index}`;
    cursor = match.index! + match[0].length;
    const [, closing, name, , selfClosing] = match;
    if (closing) { if (stack.pop() !== name) return `mismatched </${name}>`; } else if (!selfClosing) stack.push(name!);
  }
  if (/[<>]/u.test(body.slice(cursor))) return 'trailing garbage';
  return stack.length ? `unclosed <${stack.at(-1)}>` : null;
}

test('the well-formedness helper accepts valid markup and rejects broken markup', () => {
  assert.equal(checkWellFormed('<svg a="1"><g><rect x="1"/></g><text>a &amp; b</text></svg>'), null);
  assert.ok(checkWellFormed('<svg><g></svg>'));
  assert.ok(checkWellFormed('<svg><text>a & b</text></svg>'));
  assert.ok(checkWellFormed('<svg><rect></svg></rect>'));
  assert.ok(checkWellFormed('<svg><text>a < b</text></svg>'));
  assert.ok(checkWellFormed('<!DOCTYPE svg><svg/>'));
});

test('illustrations exist for most steps and only the planned steps stay pending', () => {
  assert.ok(withSvg.length >= 18, `only ${withSvg.length} steps have an illustration`);
  const pending = all.filter(({ step }) => !step.screenshot.file).map(({ platform, step }) => `${platform}/${step.id}`).sort();
  assert.deepEqual(pending, ['facebook/activar-paginas', 'facebook/limitaciones', 'facebook/requisitos', 'instagram/comprobar-revision']);
});

test('every SVG is well-formed, self-contained, accessible, labelled and free of personal data', () => {
  for (const { platform, step } of withSvg) {
    const where = `${platform}/${step.id}`;
    const svg = readSvg(step.screenshot.file!);
    assert.equal(checkWellFormed(svg), null, where);
    assert.ok(svg.startsWith('<svg '), where);
    assert.match(svg, /viewBox="0 0 800 450"/u, where);
    assert.match(svg, /<title id="[^"]+">[^<]+<\/title>/u, `${where}: <title>`);
    assert.match(svg, /<desc id="[^"]+">[^<]+<\/desc>/u, `${where}: <desc>`);
    assert.match(svg, /role="img"/u, where);
    assert.match(svg, /font-family="system-ui/u, where);
    assert.match(svg, /Esquema ilustrativo — tu pantalla puede verse distinta/u, `${where}: footer note`);
    assert.match(svg, /<rect [^>]*width="800" height="450"/u, `${where}: own solid background`);
    if (!step.verified) assert.match(svg, /Esquema por verificar/u, `${where}: unverified step needs the badge`);
    const noNamespace = svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u, '');
    assert.doesNotMatch(noNamespace, /<script|<image|<foreignObject|<iframe|<style|<use\b|<a\b/iu, where);
    assert.doesNotMatch(noNamespace, /\bhref\s*=|xlink:|\son[a-z]+\s*=|javascript:|data:|@import/iu, where);
    assert.doesNotMatch(noNamespace, /https?:|\/\/|url\((?!#)/iu, where);
    assert.doesNotMatch(svg, /\d{9,}/u, `${where}: no long numeric ids`);
    assert.doesNotMatch(svg, /\b(EAA|IGQ|IGAA)[A-Za-z0-9]{8,}/u, where);
    assert.doesNotMatch(svg, /[\w.+-]+@[\w-]+\.[\w.]+/u, `${where}: no emails`);
    assert.doesNotMatch(svg, /[A-Za-z0-9_-]{40,}/u, where);
    assert.doesNotMatch(svg, /\/home\/|C:\\/u, where);
    assert.ok(svg.length < 40_000, `${where}: stays small`);
  }
});

test('public/tutorial contains only referenced SVG files (no orphans, no other formats)', () => {
  assert.ok(existsSync(publicDir));
  const referenced = new Set(withSvg.map(({ step }) => step.screenshot.file));
  for (const platform of readdirSync(publicDir)) {
    for (const file of readdirSync(new URL(`${platform}/`, publicDir))) {
      assert.match(file, /\.svg$/u, `${platform}/${file}`);
      assert.ok(referenced.has(`/tutorial/${platform}/${file}`), `orphan ${platform}/${file}`);
    }
  }
});
