import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DELETE_ACCOUNT_HISTORY_HINT, deleteAccountAction, deleteAccountConfirmation } from '../app/account-actions.ts';

test('deleteAccountAction: only disconnected accounts get the action', () => {
  assert.deepEqual(deleteAccountAction({ status: 'valid', hasSendHistory: false }), { visible: false, disabled: true, hint: undefined });
  assert.deepEqual(deleteAccountAction({ status: 'unvalidated' }), { visible: false, disabled: true, hint: undefined });
  assert.deepEqual(deleteAccountAction({ status: 'disconnected', hasSendHistory: false }), { visible: true, disabled: false, hint: undefined });
  assert.deepEqual(deleteAccountAction({ status: 'disconnected' }), { visible: true, disabled: false, hint: undefined });
});

test('deleteAccountAction: a disconnected account with send history is disabled with the protection hint', () => {
  assert.deepEqual(deleteAccountAction({ status: 'disconnected', hasSendHistory: true }),
    { visible: true, disabled: true, hint: 'Tiene envíos en su historial: ese historial está protegido y no se puede borrar' });
  assert.equal(DELETE_ACCOUNT_HISTORY_HINT, 'Tiene envíos en su historial: ese historial está protegido y no se puede borrar');
});

test('deleteAccountConfirmation uses the agreed Spanish copy and the danger style', () => {
  assert.deepEqual(deleteAccountConfirmation('@tu_cuenta'), {
    title: 'Eliminar «@tu_cuenta»',
    body: 'Se borra del todo la cuenta y todo lo guardado de ella en este equipo (publicaciones, comentarios, clasificaciones y automatizaciones). No se puede deshacer. No cambia nada en Instagram ni en Facebook.',
    confirmLabel: 'Eliminar',
    danger: true,
  });
});

test('page.tsx renders the delete-account action through the helper', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /deleteAccountAction\(/);
  assert.match(page, /deleteAccountConfirmation\(/);
  assert.match(page, /\/api\/accounts\/\$\{[^}]+\}\/delete/);
  assert.match(page, /Cuenta eliminada\./);
});
