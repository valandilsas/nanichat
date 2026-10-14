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
