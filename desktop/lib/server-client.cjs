'use strict';
// HTTP calls the desktop shell makes to its own local server. `fetchImpl` is injectable for tests.

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls GET /api/health until it answers { ready: true }, the timeout expires, or `shouldStop()` returns true
 * (for example because the server process already exited).
 * @returns {Promise<boolean>}
 */
async function waitForHealth(origin, { timeoutMs = 90_000, intervalMs = 500, fetchImpl = fetch, shouldStop = () => false, now = Date.now } = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (shouldStop()) return false;
    try {
      const response = await fetchImpl(`${origin}/api/health`, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) {
        const body = await response.json();
        if (body && body.ready === true) return true;
      }
    } catch {
      // Not listening yet.
    }
    await delay(intervalMs);
  }
  return false;
}

/**
 * Resumes monitoring for every account (the server pauses it on purpose at every start).
 * Mutating requests need Origin == http://<Host> and the session CSRF token.
 */
async function resumeMonitoring(origin, { fetchImpl = fetch } = {}) {
  const session = await fetchImpl(`${origin}/api/session`);
  if (!session.ok) throw new Error(`GET /api/session answered ${session.status}`);
  const { csrfToken } = await session.json();
  if (typeof csrfToken !== 'string' || csrfToken === '') throw new Error('GET /api/session returned no csrfToken');
  const response = await fetchImpl(`${origin}/api/monitor/all`, {
    method: 'POST',
    headers: { origin, 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start' }),
  });
  if (!response.ok) throw new Error(`POST /api/monitor/all answered ${response.status}`);
  return response.json();
}

module.exports = { waitForHealth, resumeMonitoring };
