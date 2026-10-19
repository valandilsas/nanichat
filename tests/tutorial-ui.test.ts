import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TutorialSection } from '../app/tutorial/TutorialSection';

const markup = renderToStaticMarkup(createElement(TutorialSection, { api: async () => ({}), confirm: async () => true }));

test('the Tutorial block renders Instagram and Facebook cards and a visibly disabled TikTok card', () => {
  assert.match(markup, /<h3 id="tutorial-title">Tutorial<\/h3>/u);
  assert.match(markup, /Abrir el tutorial de Instagram/u);
  assert.match(markup, /Abrir el tutorial de Facebook/u);
  assert.match(markup, /Próximamente/u);
  const tiktok = markup.slice(markup.lastIndexOf('<div class="tutorial-card disabled"'));
  assert.match(tiktok, /aria-disabled="true"/u);
  assert.doesNotMatch(tiktok, /<button/u, 'TikTok is not a focusable control');
  assert.doesNotMatch(markup, /Abrir el tutorial de TikTok/u);
});

test('Facebook is listed first and a subtle notice says one Facebook token also manages Instagram', () => {
  assert.ok(markup.indexOf('Abrir el tutorial de Facebook') < markup.indexOf('Abrir el tutorial de Instagram'));
  const notice = /<p class="hint tutorial-note"[^>]*>([^<]*)<\/p>/u.exec(markup)?.[1] ?? '';
  assert.match(notice, /token de Facebook/u);
  assert.match(notice, /Instagram/u);
  assert.match(notice, /Página/u);
  assert.ok(markup.indexOf('tutorial-note') > markup.indexOf('Abrir el tutorial de Instagram'), 'the notice sits below the cards');
});

test('the cards stay disabled until the saved progress has loaded', () => {
  const buttons = markup.match(/<button[^>]*tutorial-card[^>]*>/gu) ?? [];
  assert.equal(buttons.length, 2);
  for (const button of buttons) assert.match(button, /disabled/u);
});

test('the component source keeps the accessibility and safety contracts', () => {
  const source = readFileSync(new URL('../app/tutorial/TutorialSection.tsx', import.meta.url), 'utf8');
  assert.match(source, /aria-expanded=\{promptOpen\}/u);
  assert.match(source, /aria-controls="tutorial-help-panel"/u);
  assert.match(source, /role="progressbar"/u);
  assert.match(source, /Copiar prompt/u);
  assert.match(source, /Reiniciar progreso/u);
  assert.match(source, /externalLinkAttrs\(\)/u);
  assert.match(source, /Paso por verificar/u);
  assert.match(source, /Marcar como hecho/u);
});

test('Conexiones mounts the tutorial block and page.tsx stays a thin integration', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /<TutorialSection api=\{api\} confirm=\{confirm\} \/>/u);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/u);
});

test('the component source wires the App ID field, the login note, disabled deep links and the generated prompt', () => {
  const source = readFileSync(new URL('../app/tutorial/TutorialSection.tsx', import.meta.url), 'utf8');
  assert.match(source, /Tu ID de app/u);
  assert.match(source, /parseAppIdInput/u);
  assert.match(source, /setAppId\(progressRef\.current/u);
  assert.match(source, /resolveLink\(link, progress\.appId\)/u);
  assert.match(source, /aria-disabled="true"/u);
  assert.match(source, /LOGIN_REDIRECT_NOTE/u);
  assert.match(source, /buildHelpPrompt\(platform, step, index, steps\.length, progress\.appId\)/u);
  assert.doesNotMatch(source, /helpPrompt/u);
});
