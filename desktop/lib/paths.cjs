'use strict';
// Where the desktop app keeps user data. Pure: platform, environment and home directory are passed in.
// The Windows location is the same one the Inno Setup installer uses (packaging/windows), so existing users keep
// their database and vault key when they switch to the desktop app.
const path = require('node:path');

const APP_DIR_NAME = 'SocialDesk';

/**
 * @param {{ platform: string, env: Record<string, string | undefined>, homedir: string }} options
 * @returns {string} absolute data home (contains data/, logs/ and desktop-settings.json)
 */
function resolveDataHome({ platform, env, homedir }) {
  const override = env.SOCIAL_DESK_HOME?.trim();
  if (override) return pathFor(platform).resolve(override);
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || path.win32.join(homedir, 'AppData', 'Local');
    return path.win32.join(localAppData, APP_DIR_NAME);
  }
  if (platform === 'darwin') return path.posix.join(homedir, 'Library', 'Application Support', APP_DIR_NAME);
  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  // The XDG spec says relative values are invalid and must be ignored.
  const base = xdgDataHome && path.posix.isAbsolute(xdgDataHome) ? xdgDataHome : path.posix.join(homedir, '.local', 'share');
  return path.posix.join(base, APP_DIR_NAME);
}

/** @param {string} home @param {string} [platform] */
function dataPaths(home, platform = process.platform) {
  const p = pathFor(platform);
  return {
    home,
    data: p.join(home, 'data'),
    logs: p.join(home, 'logs'),
    settings: p.join(home, 'desktop-settings.json'),
    electron: p.join(home, 'electron'),
  };
}

/** `server-YYYY-MM-DD.log` in local time, like the Windows launcher's server log. */
function serverLogName(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `server-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`;
}

/** Last `count` non-empty lines of a log text. */
function tailLines(text, count) {
  return text.split(/\r?\n/u).filter((line) => line.trim() !== '').slice(-count);
}

function pathFor(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

module.exports = { APP_DIR_NAME, resolveDataHome, dataPaths, serverLogName, tailLines };
