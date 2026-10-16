/** Pure presentation of provider (Meta) failures. Inputs are codes and numbers only; Meta's message text never reaches the UI. */
export type ProviderErrorInfo = { code?: string; httpStatus?: number; metaCode?: number; metaSubcode?: number };

/** Prefix that marks an error-state string as an already-translated provider message. */
export const PROVIDER_MESSAGE_PREFIX = 'provider_message:';

export const DISCOVERY_EMPTY_HINT = 'Meta no devolvió ninguna Página ni cuenta para este token. Revisa que sea un token de usuario con pages_show_list y que elegiste la Página al aceptar el diálogo de Facebook.';

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001]);

export function providerErrorMessage(info: ProviderErrorInfo): string {
  const { metaCode, httpStatus } = info;
  if (metaCode === 190) return 'El token venció o no es válido. Genera uno nuevo en el Explorador de la API Graph y edita la conexión.';
  if (metaCode !== undefined && (metaCode === 10 || (metaCode >= 200 && metaCode <= 299))) {
    return 'Falta un permiso o la app no puede acceder. Revisa que el token incluya pages_show_list, pages_read_engagement, pages_read_user_content y pages_messaging.';
  }
  if (metaCode === 100) return 'Meta no pudo listar tus Páginas con este token. Si pegaste el token de una Página, NaniChat intentó usarlo directamente; si aun así falla, genera un token de usuario: en el Explorador elige «Token del usuario» en el selector Usuario o página.';
  if ((metaCode !== undefined && RATE_LIMIT_CODES.has(metaCode)) || httpStatus === 429) {
    return 'Meta limitó las solicitudes. Espera unos minutos y vuelve a intentarlo.';
  }
  const parts: string[] = [];
  if (metaCode !== undefined) parts.push(`código ${metaCode}`);
  if (info.metaSubcode !== undefined) parts.push(`subcódigo ${info.metaSubcode}`);
  if (httpStatus !== undefined) parts.push(`HTTP ${httpStatus}`);
  if (!parts.length && info.code) parts.push(info.code);
  const detail = parts.length ? ` (${parts.join(', ')})` : '';
  return `Meta respondió con un error${detail}. Si se repite, revisa el tutorial de Conexiones.`;
}

/** Message for a stored failed-validation code such as `meta_190`, `meta_190_463` or `meta_invalid_identity`. */
export const IDENTITY_MISMATCH_MESSAGE = 'Este token pertenece a otra identidad (por ejemplo, cambiaste de un token de Página a uno de usuario). Elimina la conexión y crea una nueva con el token correcto.';

export function validationFailureMessage(safeErrorCode: string | undefined): string {
  if (safeErrorCode === 'connection_identity_mismatch') return IDENTITY_MISMATCH_MESSAGE;
  const numeric = safeErrorCode?.match(/^meta_(\d{1,9})(?:_(\d{1,9}))?$/u);
  if (numeric) {
    return providerErrorMessage({ metaCode: Number(numeric[1]), ...(numeric[2] ? { metaSubcode: Number(numeric[2]) } : {}) });
  }
  return providerErrorMessage({ ...(safeErrorCode ? { code: safeErrorCode } : {}) });
}

/** Error carried by the UI's api(): keeps the provider fields from the 502 body. */
export class ProviderApiError extends Error {
  constructor(code: string, readonly info: ProviderErrorInfo) { super(code); this.name = 'ProviderApiError'; }
}

function finite(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }

/** Builds the UI error for a failed response body; provider failures (HTTP 502 with a meta_* code) keep their numbers. */
export function apiErrorFromBody(status: number, data: unknown): Error {
  const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const code = typeof body.error === 'string' ? body.error : 'request_failed';
  if (status === 502 && code.startsWith('meta_')) {
    return new ProviderApiError(code, { code, httpStatus: finite(body.httpStatus), metaCode: finite(body.metaCode), metaSubcode: finite(body.metaSubcode) });
  }
  return new Error(code);
}

/** Value to store in the page's error state for a caught failure. */
export function errorStateFor(cause: unknown): string {
  if (cause instanceof ProviderApiError) return `${PROVIDER_MESSAGE_PREFIX}${providerErrorMessage(cause.info)}`;
  return cause instanceof Error ? cause.message : 'operation_failed';
}

export function errorToastLabel(error: string, genericLabel: (code: string) => string): string {
  return error.startsWith(PROVIDER_MESSAGE_PREFIX) ? error.slice(PROVIDER_MESSAGE_PREFIX.length) : genericLabel(error);
}
