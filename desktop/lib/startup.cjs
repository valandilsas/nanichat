'use strict';
// Pure decisions about the server start-up outcome (tested by tests/desktop-shell.test.ts).

const LOCK_REFUSAL_TEXT = 'Application data directory is already running';

/**
 * Decides how startServer must continue once waitForHealth returned.
 * - 'ready': the server answered /api/health.
 * - 'aborted': the user is quitting, or a newer child replaced this one (the newer start owns the outcome).
 * - 'failed': everything else, including a server that exited by itself before becoming ready. In that case
 *   onServerExit already cleared the child reference (so childReplaced looks true), which must NOT be read as an abort.
 */
function startupOutcome({ ready, quitting, childReplaced, childExitedOnItsOwn }) {
  if (quitting) return 'aborted';
  if (ready) return 'ready';
  if (childReplaced && !childExitedOnItsOwn) return 'aborted';
  return 'failed';
}

/** True when the server log tail shows the application lock refusing a second instance on the same data folder. */
function isLockRefusal(logTail) {
  return typeof logTail === 'string' && logTail.includes(LOCK_REFUSAL_TEXT);
}

/** Spanish message for the start-up failure dialog. */
function startupFailureMessage({ lockRefused, timeoutSeconds }) {
  if (lockRefused) {
    return 'NaniChat (u otra versión de la aplicación) ya está abierto con la misma carpeta de datos. '
      + 'Ciérralo y vuelve a intentarlo: en la versión clásica usa Menú Inicio > NaniChat > Detener NaniChat; '
      + 'en esta versión usa el icono de la bandeja o Archivo > Salir.';
  }
  return `NaniChat no pudo iniciar su servidor local en ${timeoutSeconds} segundos.`;
}

module.exports = { startupOutcome, isLockRefusal, startupFailureMessage, LOCK_REFUSAL_TEXT };
