'use strict';
// Port selection for the local server: 3000, else the first free port of 3001-3020 (same rule as the Windows launcher).
const net = require('node:net');

const PREFERRED_PORT = 3000;
const FALLBACK_FIRST = 3001;
const FALLBACK_LAST = 3020;

function candidatePorts() {
  const ports = [PREFERRED_PORT];
  for (let port = FALLBACK_FIRST; port <= FALLBACK_LAST; port++) ports.push(port);
  return ports;
}

/**
 * @param {(port: number) => Promise<boolean>} isFree injectable probe
 * @returns {Promise<number | null>} the first free candidate, or null when all of them are busy
 */
async function choosePort(isFree, candidates = candidatePorts()) {
  for (const port of candidates) {
    if (await isFree(port)) return port;
  }
  return null;
}

/** True when nothing listens on host:port (the server binds 127.0.0.1). */
function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

module.exports = { PREFERRED_PORT, FALLBACK_FIRST, FALLBACK_LAST, candidatePorts, choosePort, isPortFree };
