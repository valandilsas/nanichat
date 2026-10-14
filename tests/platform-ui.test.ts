import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FACEBOOK_BUTTONS_NOTE, FACEBOOK_LOGIN_HELP, FACEBOOK_MODERATION_UNAVAILABLE, FACEBOOK_PUBLIC_REPLY_UNAVAILABLE,
  FACEBOOK_READBACK_NOTE, FACEBOOK_USERNAME_FALLBACK_NOTE, PLATFORM_ERROR_LABELS, accountHandle, connectionsSubtitle, hasFacebookAccount,
  accountHandleOrFallback, navGroupLabel, platformBadge, platformOf, readbackHint, sentTargetLabel, viewPostLabel,
} from '../app/platform.ts';

const ig = { accountId: 'a1', username: 'tu_cuenta' };
const fb = { accountId: 'a2', username: 'Mi Pagina', platform: 'facebook' };

test('platformOf defaults to instagram and only trusts the two known values', () => {
  assert.equal(platformOf(ig), 'instagram');
  assert.equal(platformOf({ ...ig, platform: 'instagram' }), 'instagram');
  assert.equal(platformOf(fb), 'facebook');
  assert.equal(platformOf({ ...ig, platform: 'tiktok' }), 'instagram');
  assert.equal(platformOf(undefined), 'instagram');
});

test('Instagram-only installs keep today\'s look: no badge, same labels and handle', () => {
  assert.equal(hasFacebookAccount([ig]), false);
  assert.equal(platformBadge(ig, [ig]), null);
  assert.equal(navGroupLabel([ig]), 'Instagram');
  assert.equal(navGroupLabel([]), 'Instagram');
  assert.equal(accountHandle(ig), '@tu_cuenta');
  assert.equal(accountHandleOrFallback(ig), '@tu_cuenta');
  assert.equal(accountHandleOrFallback(undefined), '@Cuenta');
  assert.equal(accountHandleOrFallback(fb), 'Mi Pagina');
  assert.equal(viewPostLabel('instagram'), 'Ver en Instagram');
  assert.equal(sentTargetLabel([ig]), 'Instagram');
  assert.equal(connectionsSubtitle([ig]), 'Conecte su token de Meta y elija la cuenta de Instagram que desea administrar.');
});

test('with a Facebook Page present every account gets a platform badge and neutral wording', () => {
  assert.equal(hasFacebookAccount([ig, fb]), true);
  assert.equal(platformBadge(ig, [ig, fb]), 'Instagram');
  assert.equal(platformBadge(fb, [ig, fb]), 'Facebook');
  assert.equal(platformBadge(fb, [fb]), 'Facebook');
  assert.equal(navGroupLabel([ig, fb]), 'Instagram y Facebook');
  assert.equal(accountHandle(fb), 'Mi Pagina');
  assert.equal(viewPostLabel('facebook'), 'Ver en Facebook');
  assert.equal(sentTargetLabel([ig, fb]), 'Instagram y Facebook');
  assert.match(connectionsSubtitle([ig, fb]), /Página de Facebook/u);
});

test('Facebook copy is honest about public reply, moderation, buttons, username and readback', () => {
  assert.equal(FACEBOOK_PUBLIC_REPLY_UNAVAILABLE, 'La respuesta pública aún no está disponible para Facebook');
  assert.match(FACEBOOK_MODERATION_UNAVAILABLE.title, /Moderación/u);
  assert.match(FACEBOOK_MODERATION_UNAVAILABLE.detail, /Facebook/u);
  assert.match(FACEBOOK_BUTTONS_NOTE, /en Facebook los botones de enlace se envían como texto/iu);
  assert.match(FACEBOOK_USERNAME_FALLBACK_NOTE, /\{\{username\}\}/u);
  assert.equal(FACEBOOK_READBACK_NOTE, 'Facebook no permite verificar el mensaje enviado; se confirma con la respuesta de Meta');
  assert.equal(readbackHint('readback_not_available_facebook'), ` (${FACEBOOK_READBACK_NOTE})`);
  assert.equal(readbackHint('unknown_code'), '');
  assert.doesNotMatch(FACEBOOK_READBACK_NOTE, /verificado|confirmada/iu);
});

test('the Facebook Login help points to the guide and states the experimental opt-in', () => {
  const text = FACEBOOK_LOGIN_HELP.lines.join(' ');
  assert.equal(FACEBOOK_LOGIN_HELP.guide, 'docs/GUIA-TOKEN-FACEBOOK.md');
  assert.match(text, /token de usuario/u);
  assert.match(text, /Instagram vinculadas/u);
  assert.match(text, /experimental/iu);
  assert.match(text, /SOCIAL_DESK_FACEBOOK_PAGES=1/u);
});

test('every new Facebook error code has a Spanish label', () => {
  for (const code of [
    'platform_not_supported', 'platform_feature_not_supported', 'private_reply_unavailable', 'readback_not_available_for_platform',
    'comment_not_valid_for_private_reply', 'private_reply_window_closed', 'facebook_permission_denied',
    'recipient_cannot_receive_messages', 'facebook_rate_limited', 'facebook_token_invalid',
  ]) {
    assert.ok(PLATFORM_ERROR_LABELS[code] && PLATFORM_ERROR_LABELS[code]!.length > 10, code);
  }
});

test('every label key is a code that exists in src (guards against typos)', () => {
  const source = ['src/core/errors.ts', 'src/providers/meta/provider.ts', 'src/services/queue.ts', 'src/services/automations.ts', 'src/services/facebook-pages-rules.ts']
    .map((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
  for (const code of Object.keys(PLATFORM_ERROR_LABELS)) assert.ok(source.includes(`'${code}'`), `${code} not found in src`);
});

test('page.tsx wires the platform helpers into the Facebook-specific places (no browser available: structural check)', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  for (const needle of [
    'FACEBOOK_LOGIN_HELP.lines', 'unavailable={isFacebook}', 'FACEBOOK_MODERATION_UNAVAILABLE.title', 'FACEBOOK_BUTTONS_NOTE',
    'FACEBOOK_USERNAME_FALLBACK_NOTE', 'FACEBOOK_READBACK_CODE', '...PLATFORM_ERROR_LABELS', 'viewPostLabel(', 'navGroupLabel(',
  ]) assert.ok(page.includes(needle), needle);
  // The retired Instagram-only read-back controls must not render for Pages.
  assert.match(page, /platformOf\(accounts\.find\(\(account\) => account\.accountId === item\.accountId\)\) !== 'facebook' && <ConversationInspector/u);
  assert.equal(page.includes('const READBACK_HINTS'), false, 'read-back hints live in app/platform.ts');
});
