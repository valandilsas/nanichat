import type { AccountPlatform } from '../core/domain.ts';
import { PlatformNotSupportedError } from '../core/errors.ts';

/**
 * CENTRAL SWITCH — Facebook Page accounts ship DORMANT. While this is false, `facebook_login` discovery returns exactly
 * what it returned before (linked Instagram accounts only) and every service refuses a Page account
 * (`platform_not_supported`). The Page comment engine (read, private reply, owner detection) exists behind it but has
 * not been verified end to end in a real environment. No code path may call an Instagram endpoint with a Page account
 * regardless of this switch. Do NOT flip this constant: the opt-in is the EXPERIMENTAL env var SOCIAL_DESK_FACEBOOK_PAGES=1
 * (parsed in src/core/config.ts and passed to the services as `facebookPagesAvailable`).
 */
export const FACEBOOK_PAGES_AVAILABLE = false;

/** Effective switch. `override` exists ONLY for tests (the provider takes it as an option); production never passes it. */
export function facebookPagesAvailable(override?: boolean): boolean {
  return override ?? FACEBOOK_PAGES_AVAILABLE;
}

/** Safe code returned when an operation is not implemented for the account's platform. */
export const PLATFORM_NOT_SUPPORTED_CODE = 'platform_not_supported';

/** `account_type` stored for Facebook Page accounts. */
export const FACEBOOK_PAGE_ACCOUNT_TYPE = 'PAGE';

/** Throws `platform_not_supported` for a Page account while Facebook Pages are not enabled (switch off, no test override). */
export function assertPlatformEnabled(platform: AccountPlatform | string | undefined, override?: boolean): void {
  if (platform === 'facebook' && !facebookPagesAvailable(override)) throw new PlatformNotSupportedError();
  if (platform !== undefined && platform !== 'instagram' && platform !== 'facebook') throw new PlatformNotSupportedError();
}

/** Safe code for features the Facebook implementation does not provide (hide, delete, public reply, readback). */
export const PLATFORM_FEATURE_NOT_SUPPORTED_CODE = 'platform_feature_not_supported';

/** Event code recorded instead of a message readback: Meta gives no verified way to read a Facebook message back. */
export const FACEBOOK_READBACK_NOT_AVAILABLE_CODE = 'readback_not_available_facebook';

/** Messenger text limit (characters); a private reply with URL buttons rendered as text lines must fit. */
export const FACEBOOK_MESSAGE_TEXT_MAX = 2000;

/**
 * Facebook buttons are NOT verified, so URL buttons travel as plain text lines (`<title>: <https url>`) after the text.
 * Returns undefined when the result would exceed the Messenger text limit.
 */
export function facebookMessageText(text: string, buttons: ReadonlyArray<{ title: string; url: string }>): string | undefined {
  const full = [text, ...buttons.map((button) => `${button.title}: ${button.url}`)].join('\n');
  return full.length <= FACEBOOK_MESSAGE_TEXT_MAX ? full : undefined;
}
