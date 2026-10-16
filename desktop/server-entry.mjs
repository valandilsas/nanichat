// Entry of the local server child process the desktop shell forks (Electron's own binary with ELECTRON_RUN_AS_NODE=1).
// It adds a cross-platform stop channel and then loads the normal production start script (scripts/start.mjs ->
// server.ts), so the server runs exactly as with `npm start`.
//
// Windows has no POSIX signals for a child process, so the parent asks for a stop over the IPC channel and this
// process emits SIGTERM to itself: the server's own SIGTERM handler closes the HTTP server, the database and the
// instance lock (.application-owner.json). If the parent dies, the IPC channel disconnects and the same stop runs.

let stopRequested = false;

function requestStop() {
  if (stopRequested) return;
  stopRequested = true;
  emitWhenHandled();
}

// server.ts registers its SIGTERM handler only after Next.js is prepared; a stop requested earlier waits for it.
function emitWhenHandled() {
  if (process.listenerCount('SIGTERM') > 0) {
    process.emit('SIGTERM', 'SIGTERM');
    return;
  }
  setTimeout(emitWhenHandled, 200).unref();
}

process.on('message', (message) => {
  if (message !== null && typeof message === 'object' && message.type === 'shutdown') requestStop();
});
process.on('disconnect', requestStop);
// The IPC channel must not keep this process alive on its own: a failed start still has to exit.
process.channel?.unref();

await import('../scripts/start.mjs');
