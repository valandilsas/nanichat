'use strict';
// What the main window does with a navigation or window.open target.
// The app must keep exactly its own origin (the API checks Origin == http://<Host>), so anything else leaves the app:
// http/https URLs open in the system browser, every other scheme is refused.

/** @returns {'allow' | 'external' | 'deny'} */
function navigationDecision(target, appOrigin) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return 'deny';
  }
  if (url.origin === appOrigin) return 'allow';
  if (url.protocol === 'http:' || url.protocol === 'https:') return 'external';
  return 'deny';
}

function appOriginFor(port) {
  return `http://127.0.0.1:${port}`;
}

module.exports = { navigationDecision, appOriginFor };
