/** Platform-aware presentation helpers. Instagram-only installs render exactly as before; Facebook copy appears only for Pages. */
export type Platform = 'instagram' | 'facebook';

type AccountLike = { platform?: string | null; username?: string };

export function platformOf(account: AccountLike | undefined | null): Platform {
  return account?.platform === 'facebook' ? 'facebook' : 'instagram';
}

export function hasFacebookAccount(accounts: ReadonlyArray<AccountLike>): boolean {
  return accounts.some((account) => platformOf(account) === 'facebook');
}

/** Badge text, or null while no Facebook account exists (so Instagram-only screens look as they always did). */
export function platformBadge(account: AccountLike, accounts: ReadonlyArray<AccountLike>): 'Instagram' | 'Facebook' | null {
  if (!hasFacebookAccount(accounts)) return null;
  return platformOf(account) === 'facebook' ? 'Facebook' : 'Instagram';
}

/** Instagram accounts are shown as @username; a Facebook Page is shown by its name (a Page has no @handle here). */
export function accountHandle(account: AccountLike & { username: string }): string {
  return platformOf(account) === 'facebook' ? account.username : `@${account.username}`;
}

/** Same as accountHandle, with today's '@Cuenta' fallback while the account is not loaded yet. */
export function accountHandleOrFallback(account: (AccountLike & { username: string }) | undefined): string {
  return account ? accountHandle(account) : '@Cuenta';
}

export function navGroupLabel(accounts: ReadonlyArray<AccountLike>): string {
  return hasFacebookAccount(accounts) ? 'Instagram y Facebook' : 'Instagram';
}

/** Where private replies go, for sentences like "mensajes privados reales a …". */
export function sentTargetLabel(accounts: ReadonlyArray<AccountLike>): string {
  return hasFacebookAccount(accounts) ? 'Instagram y Facebook' : 'Instagram';
}

export function connectionsSubtitle(accounts: ReadonlyArray<AccountLike>): string {
  return hasFacebookAccount(accounts)
    ? 'Conecte su token de Meta y elija la cuenta de Instagram o la Página de Facebook que desea administrar.'
    : 'Conecte su token de Meta y elija la cuenta de Instagram que desea administrar.';
}

export function viewPostLabel(platform: Platform): string {
  return platform === 'facebook' ? 'Ver en Facebook' : 'Ver en Instagram';
}

export const FACEBOOK_PUBLIC_REPLY_UNAVAILABLE = 'La respuesta pública aún no está disponible para Facebook';

export const FACEBOOK_MODERATION_UNAVAILABLE = {
  title: 'Moderación aún no está disponible para Facebook',
  detail: 'Ocultar o borrar comentarios todavía no funciona en Páginas de Facebook. Elija una cuenta de Instagram para usar Moderación; las respuestas privadas de Facebook siguen funcionando en Automatizaciones.',
} as const;

export const FACEBOOK_BUTTONS_NOTE = 'En Facebook los botones de enlace se envían como texto: el mensaje incluye el título y la dirección de cada botón.';

export const FACEBOOK_USERNAME_FALLBACK_NOTE = 'En Facebook, si quien comenta no tiene un rol en su aplicación, Meta no envía su nombre: {{username}} se reemplaza por un saludo limpio, sin nombre.';

export const FACEBOOK_LOGIN_HELP = {
  guide: 'docs/GUIA-TOKEN-FACEBOOK.md',
  lines: [
    'Facebook Login usa un token de usuario para encontrar sus Páginas de Facebook y las cuentas de Instagram vinculadas.',
    'La compatibilidad con Páginas de Facebook está habilitada por defecto; algunas partes no están verificadas (por ejemplo, la lectura de Instagram con Facebook Login). Si inició la aplicación con SOCIAL_DESK_FACEBOOK_PAGES=0, las Páginas no aparecen.',
  ],
} as const;

export const FACEBOOK_READBACK_CODE = 'readback_not_available_facebook';
export const FACEBOOK_READBACK_NOTE = 'Facebook no permite verificar el mensaje enviado; se confirma con la respuesta de Meta';

const READBACK_HINTS: Record<string, string> = {
  meta_readback_sender_mismatch: 'El remitente no coincide con la cuenta',
  meta_readback_id_mismatch: 'El mensaje leído tiene otro ID',
  meta_readback_no_recipient: 'No se encontró destinatario',
  [FACEBOOK_READBACK_CODE]: FACEBOOK_READBACK_NOTE,
};

export function readbackHint(code?: string): string {
  const hint = code ? READBACK_HINTS[code] : undefined;
  return hint ? ` (${hint})` : '';
}

/** Spanish labels for the platform / Facebook error codes that can reach the UI. */
export const PLATFORM_ERROR_LABELS: Record<string, string> = {
  platform_not_supported: 'Esta cuenta es de una plataforma que no está habilitada: la aplicación se inició con SOCIAL_DESK_FACEBOOK_PAGES=0, que apaga las Páginas de Facebook. Quite esa variable y reinicie para usarlas.',
  platform_feature_not_supported: 'Esta función aún no está disponible para cuentas de Facebook.',
  private_reply_unavailable: 'Meta indica que este comentario no admite respuesta privada.',
  readback_not_available_for_platform: 'Facebook no permite verificar el mensaje enviado; se confirma con la respuesta de Meta.',
  comment_not_valid_for_private_reply: 'Meta no acepta una respuesta privada a este comentario (por ejemplo, ya tiene una o no es un comentario principal).',
  private_reply_window_closed: 'La ventana para responder en privado a este comentario ya se cerró.',
  facebook_permission_denied: 'Meta rechazó la acción por permisos: revise que el token tenga los permisos de la Página y que usted tenga control total sobre ella.',
  recipient_cannot_receive_messages: 'Esta persona no puede recibir mensajes de la Página.',
  facebook_rate_limited: 'Meta limitó temporalmente las solicitudes de la Página; se reintentará más tarde.',
  facebook_token_invalid: 'El token de Facebook ya no es válido: genere uno nuevo y actualice la conexión.',
};
