'use strict';
// Ubuntu 24.04+ sets kernel.apparmor_restrict_unprivileged_userns=1, which blocks Chromium's unprivileged user-namespace
// sandbox for binaries without an AppArmor profile, and an extracted/mounted AppImage cannot use the root-owned SUID
// chrome-sandbox fallback either (Chromium aborts with exit code 133). The .deb package installs an AppArmor profile and
// keeps the sandbox enabled; only an AppImage on a host with apparmor_restrict_unprivileged_userns=1 disables it.
const fs = require('node:fs');

const APPARMOR_RESTRICT_USERNS_PATH = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns';

/**
 * Pure decision: whether `--no-sandbox` must be passed to Chromium before startup.
 * @param {{ platform: string, env: Record<string, string | undefined>, apparmorRestrictUserns: string | null | undefined }} options
 * @returns {boolean}
 */
function shouldDisableChromiumSandbox({ platform, env, apparmorRestrictUserns }) {
  if (platform !== 'linux') return false;
  if (!env?.APPIMAGE || env.APPIMAGE.trim() === '') return false;
  return String(apparmorRestrictUserns ?? '').trim() === '1';
}

/**
 * Reads `/proc/sys/kernel/apparmor_restrict_unprivileged_userns`, or returns `null` when unavailable.
 * @param {(path: string, encoding: BufferEncoding) => string} [readFileSync]
 * @returns {string | null}
 */
function readApparmorRestrictUserns(readFileSync = fs.readFileSync) {
  try {
    return readFileSync(APPARMOR_RESTRICT_USERNS_PATH, 'utf8');
  } catch {
    return null;
  }
}

module.exports = {
  APPARMOR_RESTRICT_USERNS_PATH,
  shouldDisableChromiumSandbox,
  readApparmorRestrictUserns,
};
