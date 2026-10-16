// Desktop app commands, called by the npm scripts (no shell syntax, so they run the same on Windows and Linux):
//   node packaging/desktop/run.mjs icons        generate build/icon.ico and build/icon.png
//   node packaging/desktop/run.mjs dev [args]   build the web app if needed, then start Electron on desktop/main.cjs
//   node packaging/desktop/run.mjs dist linux   AppImage + deb into dist/   (needs a previous `npm run build`)
//   node packaging/desktop/run.mjs dist win     NSIS installer into dist/   (needs a previous `npm run build`)
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIcons } from './icons.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

function run(command, args, options = {}) {
  process.stdout.write(`$ ${[command, ...args].join(' ')}\n`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function writeIcons() {
  const outDir = join(root, 'build');
  mkdirSync(outDir, { recursive: true });
  const { ico, png } = buildIcons();
  writeFileSync(join(outDir, 'icon.ico'), ico);
  writeFileSync(join(outDir, 'icon.png'), png);
  process.stdout.write(`build/icon.ico ${ico.length} bytes, build/icon.png (512x512) ${png.length} bytes\n`);
}

function hasNextBuild() {
  return existsSync(join(root, '.next', 'BUILD_ID'));
}

/** The Electron binary of the electron devDependency (its package exports the path). */
function electronBinary() {
  return require('electron');
}

/**
 * Linux development runs use node_modules/electron/dist/chrome-sandbox, which is not setuid root after `npm install`,
 * so Chromium aborts unless its sandbox is disabled. Packaged deb builds install chrome-sandbox setuid.
 */
function devSandboxArgs() {
  if (process.platform !== 'linux') return [];
  const helper = join(dirname(electronBinary()), 'chrome-sandbox');
  try {
    const stat = statSync(helper);
    if (stat.uid === 0 && (stat.mode & 0o4000) !== 0) return [];
  } catch {
    // Missing helper: same as unconfigured.
  }
  process.stdout.write('chrome-sandbox is not setuid root: starting Electron with --no-sandbox (development only)\n');
  return ['--no-sandbox'];
}

function dev(extraArgs) {
  writeIcons();
  if (!hasNextBuild()) {
    const npmCli = process.env.npm_execpath;
    const status = npmCli ? run(process.execPath, [npmCli, 'run', 'build']) : run('npm', ['run', 'build'], { shell: process.platform === 'win32' });
    if (status !== 0) return status;
  }
  return run(electronBinary(), [join(root, 'desktop', 'main.cjs'), ...devSandboxArgs(), ...extraArgs]);
}

function dist(target) {
  const flags = { linux: ['--linux'], win: ['--win', '--x64'] }[target];
  if (!flags) {
    process.stderr.write('usage: node packaging/desktop/run.mjs dist <linux|win>\n');
    return 2;
  }
  if (!hasNextBuild()) {
    process.stderr.write('No Next.js build found (.next/BUILD_ID). Run `npm run build` first.\n');
    return 1;
  }
  writeIcons();
  const cli = join(dirname(require.resolve('electron-builder/package.json')), 'cli.js');
  return run(process.execPath, [cli, ...flags, '--publish', 'never']);
}

const [command, ...rest] = process.argv.slice(2);
let status;
if (command === 'icons') {
  writeIcons();
  status = 0;
} else if (command === 'dev') {
  status = dev(rest);
} else if (command === 'dist') {
  status = dist(rest[0]);
} else {
  process.stderr.write('usage: node packaging/desktop/run.mjs <icons|dev|dist linux|dist win>\n');
  status = 2;
}
process.exitCode = status;
