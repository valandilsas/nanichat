import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FACEBOOK_PERMISSIONS, PERMISSIONS_CAVEAT, PERMISSIONS_LINK, PERMISSIONS_NOTE, PERMISSIONS_TITLE, USAGE_LABELS, USAGE_ORDER, filterPermissions,
} from '../app/permissions-info.ts';
import { PermissionsInfoSection } from '../app/PermissionsInfoSection.tsx';

test('permission names are unique, snake_case and every entry has a Spanish description', () => {
  const names = FACEBOOK_PERMISSIONS.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, 18);
  for (const entry of FACEBOOK_PERMISSIONS) {
    assert.match(entry.name, /^[a-z_]+$/u);
    assert.ok(USAGE_ORDER.includes(entry.usage), entry.name);
    assert.ok(entry.description.trim().length > 20, entry.name);
    assert.equal(typeof entry.confirmed, 'boolean');
  }
});

test('entries are ordered by usage group and alphabetically inside each group', () => {
  const rank = (usage: string) => USAGE_ORDER.indexOf(usage as never);
  for (let index = 1; index < FACEBOOK_PERMISSIONS.length; index += 1) {
    const previous = FACEBOOK_PERMISSIONS[index - 1];
    const current = FACEBOOK_PERMISSIONS[index];
    assert.ok(rank(previous.usage) <= rank(current.usage), `${previous.name} -> ${current.name}`);
    if (previous.usage === current.usage) assert.ok(previous.name < current.name, `${previous.name} < ${current.name}`);
  }
  assert.deepEqual(USAGE_ORDER, ['required', 'recommended', 'optional', 'unused']);
  assert.deepEqual(USAGE_ORDER.map((usage) => USAGE_LABELS[usage]), ['Requerido', 'Recomendado', 'Opcional', 'No lo usa']);
});

test('the required permissions are exactly the four Facebook features need', () => {
  const required = FACEBOOK_PERMISSIONS.filter((entry) => entry.usage === 'required').map((entry) => entry.name).sort();
  assert.deepEqual(required, ['pages_messaging', 'pages_read_engagement', 'pages_read_user_content', 'pages_show_list']);
});

test('only paid_marketing_messages and the pages_manage_metadata dependency are unconfirmed', () => {
  const unconfirmed = FACEBOOK_PERMISSIONS.filter((entry) => !entry.confirmed).map((entry) => entry.name).sort();
  assert.deepEqual(unconfirmed, ['pages_manage_metadata', 'paid_marketing_messages']);
  const paid = FACEBOOK_PERMISSIONS.find((entry) => entry.name === 'paid_marketing_messages');
  assert.match(paid?.description ?? '', /Descripción no confirmada en la documentación de Meta/u);
});

test('filterPermissions ignores case and accents, matches name or description and returns all for an empty query', () => {
  assert.equal(filterPermissions(FACEBOOK_PERMISSIONS, '').length, FACEBOOK_PERMISSIONS.length);
  assert.equal(filterPermissions(FACEBOOK_PERMISSIONS, '   ').length, FACEBOOK_PERMISSIONS.length);
  assert.deepEqual(filterPermissions(FACEBOOK_PERMISSIONS, 'PAGES_SHOW').map((entry) => entry.name), ['pages_show_list']);
  const byDescription = filterPermissions(FACEBOOK_PERMISSIONS, 'ESTADISTICAS').map((entry) => entry.name);
  assert.ok(byDescription.includes('read_insights'));
  assert.ok(byDescription.includes('instagram_manage_insights'));
  assert.deepEqual(filterPermissions(FACEBOOK_PERMISSIONS, 'zzz-nope'), []);
  assert.equal(FACEBOOK_PERMISSIONS.length, 18, 'the input list is not mutated');
});

test('the official link is the verified Meta permissions reference', () => {
  assert.equal(PERMISSIONS_LINK, 'https://developers.facebook.com/documentation/development/permissions');
});

test('the collapsed card renders the title and no rows', () => {
  const markup = renderToStaticMarkup(createElement(PermissionsInfoSection));
  assert.ok(markup.includes(PERMISSIONS_TITLE));
  assert.equal(PERMISSIONS_TITLE, 'Permisos de Facebook: qué hace cada uno');
  assert.match(markup, /aria-expanded="false"/u);
  assert.match(markup, /aria-controls="fb-permissions-panel"/u);
  assert.doesNotMatch(markup, /pages_show_list/u);
  assert.doesNotMatch(markup, /developers\.facebook\.com/u);
});

test('the expanded card lists every permission, the notes and the external link', () => {
  const markup = renderToStaticMarkup(createElement(PermissionsInfoSection, { initialOpen: true }));
  assert.match(markup, /aria-expanded="true"/u);
  for (const entry of FACEBOOK_PERMISSIONS) assert.ok(markup.includes(`>${entry.name}</`), entry.name);
  for (const label of Object.values(USAGE_LABELS)) assert.ok(markup.includes(label), label);
  assert.ok(markup.includes('Referencia oficial de permisos de Meta'));
  assert.match(markup, /href="https:\/\/developers\.facebook\.com\/documentation\/development\/permissions"/u);
  assert.match(markup, /target="_blank"/u);
  assert.match(markup, /rel="noopener noreferrer"/u);
  assert.ok(markup.includes(PERMISSIONS_NOTE));
  assert.ok(markup.includes(PERMISSIONS_CAVEAT));
  assert.ok(markup.includes('Tu asistente de Meta mostraba 22 opciones; aquí están las que se conocen. Si ves otras, no las marques.'));
  assert.equal((markup.match(/tutorial-unverified">por verificar/gu) ?? []).length, 2);
  assert.match(markup, /type="search"/u);
});

test('the component filters through the pure helper and Conexiones mounts it after the tutorial', () => {
  const source = readFileSync(new URL('../app/PermissionsInfoSection.tsx', import.meta.url), 'utf8');
  assert.match(source, /filterPermissions\(FACEBOOK_PERMISSIONS, query\)/u);
  assert.match(source, /No hay permisos que coincidan/u);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|fetch\(|api\(/u);
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /<TutorialSection api=\{api\} confirm=\{confirm\} \/>\s*<PermissionsInfoSection \/>/u);
});
