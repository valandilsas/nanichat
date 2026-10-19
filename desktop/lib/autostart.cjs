'use strict';
// Linux "start with the system": an XDG autostart entry (~/.config/autostart/social-desk.desktop).
// Windows and macOS use app.setLoginItemSettings instead (see desktop/main.cjs).
const fs = require('node:fs');
const path = require('node:path');

const AUTOSTART_FILE_NAME = 'social-desk.desktop';

/** `${XDG_CONFIG_HOME:-~/.config}/autostart/social-desk.desktop` (relative XDG values are ignored, per the spec). */
function autostartFilePath({ env, homedir }) {
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  const base = xdgConfigHome && path.posix.isAbsolute(xdgConfigHome) ? xdgConfigHome : path.posix.join(homedir, '.config');
  return path.posix.join(base, 'autostart', AUTOSTART_FILE_NAME);
}

/** The program to launch: the AppImage file when running from one (its mount point changes every run), else the binary. */
function autostartExecutable({ env, execPath }) {
  return env.APPIMAGE?.trim() || execPath;
}

/** Quotes one Exec argument per the Desktop Entry spec when it contains reserved characters. */
function quoteExecArgument(argument) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/u.test(argument)) return argument;
  return `"${argument.replace(/(["`$\\])/gu, '\\$1')}"`;
}

function autostartDesktopEntry({ executable }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=NaniChat',
    'Comment=NaniChat (se abre en la bandeja del sistema)',
    `Exec=${quoteExecArgument(executable)} --hidden`,
    'Icon=social-desk',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** Writes or removes the autostart entry. Returns the file path it acted on. */
function applyLinuxAutostart(enabled, { env, homedir, execPath }) {
  const file = autostartFilePath({ env, homedir });
  if (enabled) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, autostartDesktopEntry({ executable: autostartExecutable({ env, execPath }) }), 'utf8');
  } else {
    fs.rmSync(file, { force: true });
  }
  return file;
}

module.exports = { AUTOSTART_FILE_NAME, autostartFilePath, autostartExecutable, quoteExecArgument, autostartDesktopEntry, applyLinuxAutostart };
