import { type AccountPlatform } from '../core/domain.ts';
import { PlatformNotSupportedError } from '../core/errors.ts';

/**
 * Facebook Page accounts are ON by default in the app: `loadConfig` turns the env var SOCIAL_DESK_FACEBOOK_PAGES into
 * `facebookPages` (on unless it is "0"/"false", the kill switch) and passes it to the services as
 * `facebookPagesAvailable`. This constant is only the fallback for a caller that passes no option, and it stays false:
 * a service built without the option refuses a Page account (`platform_not_supported`) and `facebook_login` discovery
 * returns linked Instagram accounts only. No code path may call an Instagram endpoint with a Page account regardless
 * of this switch. Do NOT flip this constant.
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
 * When the payload says the text already carries the composed button links (`linksInText`), keep it as-is so both
 * platforms send the same composed text without duplicating links; otherwise the historic lines are appended unchanged.
 * Returns undefined when the result would exceed the Messenger limit.
 */
export function facebookMessageText(text: string, buttons: ReadonlyArray<{ title: string; url: string }>, linksInText = false): string | undefined {
  const full = linksInText
    ? text
    : [text, ...buttons.map((button) => `${button.title}: ${button.url}`)].join('\n');
  return full.length <= FACEBOOK_MESSAGE_TEXT_MAX ? full : undefined;
}

