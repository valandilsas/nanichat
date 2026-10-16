export class RepositoryConflictError extends Error {
  constructor(message = 'The account is already actively managed by another connection') {
    super(message);
    this.name = 'RepositoryConflictError';
  }
}

/**
 * The account already exists under a disconnected or deleted connection. It can be adopted by the new connection,
 * but only after an explicit confirmation; the caller must repeat the selection with adoption allowed.
 */
export class AccountAdoptionRequiredError extends RepositoryConflictError {
  readonly code = 'account_adoption_required';
  constructor() {
    super('This account is already managed under a disconnected connection; adoption must be confirmed');
    this.name = 'AccountAdoptionRequiredError';
  }
}

/**
 * A user-actionable business rule refused the operation. Carries ONLY a stable code (the router returns it as the
 * 409 body); the English message stays for logs and tests and is never sent to the browser.
 */
export const DOMAIN_REJECTION_CODES = ['automation_not_enabled', 'account_not_validated', 'account_send_hold'] as const;
export type DomainRejectionCode = typeof DOMAIN_REJECTION_CODES[number];

export class DomainRejectionError extends Error {
  constructor(readonly code: DomainRejectionCode, message: string) {
    super(message);
    this.name = 'DomainRejectionError';
  }
}

export class VaultKeyMissingError extends Error {
  constructor() {
    super('Vault key is missing while encrypted credentials exist; restore the key before continuing');
    this.name = 'VaultKeyMissingError';
  }
}

export class VaultKeyInvalidError extends Error {
  constructor() {
    super('Vault key is invalid; refusing to replace or discard encrypted credentials');
    this.name = 'VaultKeyInvalidError';
  }
}

export class InvalidConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConfigurationError';
  }
}

/** The operation targets an Instagram endpoint but the account is a Facebook Page (inert until the Page engine exists). */
export class PlatformNotSupportedError extends Error {
  readonly code = 'platform_not_supported';
  constructor() {
    super('This operation is not supported for the account platform');
    this.name = 'PlatformNotSupportedError';
  }
}

/** The account's platform has no implementation of this feature yet (Facebook: hide, delete, public reply, readback). */
export class PlatformFeatureNotSupportedError extends Error {
  readonly code = 'platform_feature_not_supported';
  constructor(readonly feature: string) {
    super(`This feature is not supported for the account platform: ${feature}`);
    this.name = 'PlatformFeatureNotSupportedError';
  }
}

/**
 * A provider (Meta) request failed. Carries ONLY a stable code and numeric diagnostics; Meta's message text, trace ids,
 * URLs and tokens are never copied here (invariant 8), so it is safe to return to the browser.
 */
export class ProviderRequestError extends Error {
  readonly httpStatus?: number;
  readonly metaCode?: number;
  readonly metaSubcode?: number;
  constructor(readonly code: string, fields: { httpStatus?: number; metaCode?: number; metaSubcode?: number } = {}) {
    super(code);
    this.name = 'ProviderRequestError';
    if (fields.httpStatus !== undefined) this.httpStatus = fields.httpStatus;
    if (fields.metaCode !== undefined) this.metaCode = fields.metaCode;
    if (fields.metaSubcode !== undefined) this.metaSubcode = fields.metaSubcode;
  }
}

const SAFE_PROVIDER_CODE = /^meta_[a-z0-9_]{1,60}$/u;

function safeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) < 1e9 ? value : undefined;
}

/** Converts a provider failure (any error with a `meta_*` string code) into a secret-free error; undefined otherwise. */
export function toProviderRequestError(error: unknown): ProviderRequestError | undefined {
  if (error instanceof ProviderRequestError) return error;
  if (!(error instanceof Error)) return undefined;
  const source = error as Error & { code?: unknown; httpStatus?: unknown; metaCode?: unknown; metaSubcode?: unknown };
  if (typeof source.code !== 'string' || !SAFE_PROVIDER_CODE.test(source.code)) return undefined;
  return new ProviderRequestError(source.code, {
    httpStatus: safeInteger(source.httpStatus),
    metaCode: safeInteger(source.metaCode),
    metaSubcode: safeInteger(source.metaSubcode),
  });
}
