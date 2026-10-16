/**
 * Safety guards for capture-tutorial.mjs. Pure functions (no I/O), unit-tested by tests/demo-tools.test.ts.
 * The tutorial captures may only ever: use a random free port (never 3000/3100), a data dir under /tmp, and
 * write PNGs to public/tutorial/<platform>/<step-id>.png.
 */
import { join, resolve } from 'node:path';

export const RESERVED_PORTS = [3000, 3100];
export const TUTORIAL_PLATFORMS = ['instagram', 'facebook'];

/** In-app steps captured as real screenshots (platform, step id). */
export const TUTORIAL_IMAGE_STEPS = [
  ['instagram', 'pegar-token'],
  ['instagram', 'probar-descubrir'],
  ['instagram', 'comprobar-revision'],
  ['facebook', 'pegar-token'],
  ['facebook', 'probar-seleccionar'],
];

export function assertSafePort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Refusing to run: invalid port ${port}`);
  if (RESERVED_PORTS.includes(port)) throw new Error(`Refusing to run on port ${port}: reserved for the real app`);
  return port;
}

export function assertSafeDataDir(dir) {
  if (typeof dir !== 'string' || dir === '') throw new Error('Refusing to run: a data directory under /tmp is required');
  const resolved = resolve(dir);
  if (!resolved.startsWith('/tmp/')) throw new Error(`Refusing to run: the data directory must be under /tmp (got ${resolved})`);
  return resolved;
}

export function assertTutorialOutput(root, platform, stepId) {
  if (!TUTORIAL_PLATFORMS.includes(platform) || !/^[a-z0-9-]{1,48}$/u.test(String(stepId))) {
    throw new Error(`Refusing to write: invalid tutorial target ${platform}/${stepId}`);
  }
  const base = resolve(root, 'public/tutorial');
  const output = resolve(join(base, platform, `${stepId}.png`));
  if (!output.startsWith(`${base}/${platform}/`)) throw new Error('Refusing to write outside public/tutorial');
  return output;
}
