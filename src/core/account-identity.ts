import type { AccountPlatform } from './domain.ts';

/**
 * Identity used for the unique `normalized_username` index. Instagram keeps its lowercased username; Pages are
 * namespaced by Page ID so a Page name can never collide with (or impersonate) an Instagram username.
 */
export function normalizedAccountIdentity(platform: AccountPlatform, providerAccountId: string, username: string): string {
  if (platform === 'facebook') return `facebook:${providerAccountId}`;
  return username.normalize('NFC').trim().replace(/^@/u, '').toLocaleLowerCase('und');
}
