import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RefreshButton } from '../app/components/RefreshButton.tsx';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('RefreshButton is an accessible icon-only button', () => {
  const html = renderToStaticMarkup(createElement(RefreshButton, { loading: false, onRefresh: () => {} }));
  assert.match(html, /aria-label="Actualizar datos"/);
  assert.match(html, /title="Actualizar datos"/);
  assert.match(html, /lucide-refresh-cw/);
  assert.match(html, /type="button"/);
  assert.doesNotMatch(html, /disabled/);
  assert.doesNotMatch(html, /spinning/);
  assert.doesNotMatch(html, />Actualizar</);
});

test('RefreshButton spins, is busy and disabled while refreshing', () => {
  const html = renderToStaticMarkup(createElement(RefreshButton, { loading: true, onRefresh: () => {} }));
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled/);
  assert.match(html, /spinning/);
});

test('the topbar hosts the global refresh button after the page actions', () => {
  const topbar = page.slice(page.indexOf('<header className="topbar">'), page.indexOf('</header>'));
  assert.match(topbar, /<RefreshButton loading=\{loading\} onRefresh=\{\(\) => void refresh\(\)\} \/>/);
  assert.ok(topbar.indexOf('topbar-actions') < topbar.indexOf('<RefreshButton'));
});

test('the footer keeps the privacy text but no longer has an Actualizar button', () => {
  const footer = page.slice(page.indexOf('<footer className="footer-note">'), page.indexOf('</footer>'));
  assert.match(footer, /Solo en este equipo · Datos y credenciales permanecen en el servidor local\./);
  assert.doesNotMatch(footer, /button/);
  assert.doesNotMatch(footer, /Actualizar/);
});

test('Resumen no longer renders its own refresh action; Publicaciones keeps its own', () => {
  assert.doesNotMatch(page, /<span className="btn-label">Actualizar datos<\/span>/);
  assert.match(page, /aria-label="Actualizar publicaciones"/);
});

test('CSS spins the icon and disables the spin under prefers-reduced-motion', () => {
  assert.match(css, /@keyframes refresh-spin/);
  assert.match(css, /\.refresh-button \.spinning\s*\{[^}]*animation:\s*refresh-spin/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.refresh-button \.spinning\s*\{\s*animation:\s*none/);
  assert.match(css, /\.refresh-button\s*\{[^}]*width:\s*36px[^}]*height:\s*36px/);
});
