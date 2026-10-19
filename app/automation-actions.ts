/** Pure presentation decisions for the automation cards. */

export const REAL_MODE_PAUSED_HINT = 'Reanuda la automatización con ▶ para poder autorizar el modo real';

/** Spanish labels for the typed domain rejections (see DomainRejectionError); keys are the stable API codes. */
export const DOMAIN_REJECTION_LABELS: Record<string, string> = {
  automation_not_enabled: 'Primero reanuda la automatización con ▶ y luego autoriza el modo real.',
  account_not_validated: 'La cuenta o la conexión no está validada. Revisa Conexiones: si el token venció, genera uno nuevo y edítalo con el lápiz.',
  account_send_hold: 'Una retención de seguridad bloquea los envíos reales de esta cuenta.',
  account_not_disconnected: 'Solo se puede eliminar una cuenta desconectada.',
  account_has_send_history: 'Esta cuenta tiene envíos en su historial y ese historial está protegido: no se puede eliminar.',
};

/** Real mode can only be granted to an enabled automation; removing the permission is always available. */
export function realModeAction(row: { status: string; realEnabled: boolean }): { label: string; disabled: boolean; hint: string | undefined } {
  if (row.realEnabled) return { label: 'Quitar permiso real', disabled: false, hint: undefined };
  const paused = row.status !== 'enabled';
  return { label: 'Autorizar real', disabled: paused, hint: paused ? REAL_MODE_PAUSED_HINT : undefined };
}
