'use strict';
// Desktop shell settings persisted in <home>/desktop-settings.json.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = Object.freeze({
  openAtLogin: true,
  resumeMonitoringOnStart: false,
  trayHintShown: false,
});

/** Keeps only known keys with boolean values; anything missing or invalid falls back to the default. */
function mergeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const merged = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    merged[key] = typeof source[key] === 'boolean' ? source[key] : fallback;
  }
  return merged;
}

/** @returns {{ settings: object, existed: boolean }} `existed` is false on first run (or an unreadable file). */
function readSettings(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { settings: mergeSettings({}), existed: false };
  }
  try {
    return { settings: mergeSettings(JSON.parse(text)), existed: true };
  } catch {
    return { settings: mergeSettings({}), existed: false };
  }
}

/** Atomic write (temp file + rename) so a crash never leaves a half-written file. */
function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(mergeSettings(settings), null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

module.exports = { DEFAULT_SETTINGS, mergeSettings, readSettings, writeSettings };
