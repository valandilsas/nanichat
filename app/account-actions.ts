/** Pure presentation decisions for deleting an account (see purgeAccount on the server). */

export const DELETE_ACCOUNT_HISTORY_HINT = 'Tiene envíos en su historial: ese historial está protegido y no se puede borrar';

/**
 * Only a disconnected account can be deleted. With send history the action stays visible but disabled: the server
 * refuses it (account_has_send_history) and nothing is hidden instead.
 */
export function deleteAccountAction(account: { status: string; hasSendHistory?: boolean }): { visible: boolean; disabled: boolean; hint: string | undefined } {
  if (account.status !== 'disconnected') return { visible: false, disabled: true, hint: undefined };
  if (account.hasSendHistory === true) return { visible: true, disabled: true, hint: DELETE_ACCOUNT_HISTORY_HINT };
  return { visible: true, disabled: false, hint: undefined };
}

export function deleteAccountConfirmation(name: string): { title: string; body: string; confirmLabel: string; danger: true } {
  return {
    title: `Eliminar «${name}»`,
    body: 'Se borra del todo la cuenta y todo lo guardado de ella en este equipo (publicaciones, comentarios, clasificaciones y automatizaciones). No se puede deshacer. No cambia nada en Instagram ni en Facebook.',
    confirmLabel: 'Eliminar',
    danger: true,
  };
}
