import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { removeTempDir } from './helpers/tmp.ts';

const require = createRequire(import.meta.url);

type PathsModule = {
  APP_DIR_NAME: string;
  resolveDataHome(options: { platform: string; env: Record<string, string | undefined>; homedir: string }): string;
  dataPaths(home: string, platform?: string): { home: string; data: string; logs: string; settings: string; electron: string };
  serverLogName(date: Date): string;
  tailLines(text: string, count: number): string[];
};

type PortModule = {
  PREFERRED_PORT: number;
  FALLBACK_FIRST: number;
  FALLBACK_LAST: number;
  candidatePorts(): number[];
  choosePort(isFree: (port: number) => Promise<boolean>, candidates?: number[]): Promise<number | null>;
  isPortFree(port: number, host?: string): Promise<boolean>;
};

type AutostartModule = {
  AUTOSTART_FILE_NAME: string;
  autostartFilePath(options: { env: Record<string, string | undefined>; homedir: string }): string;
  autostartExecutable(options: { env: Record<string, string | undefined>; execPath: string }): string;
  quoteExecArgument(argument: string): string;
  autostartDesktopEntry(options: { executable: string }): string;
  applyLinuxAutostart(enabled: boolean, options: { env: Record<string, string | undefined>; homedir: string; execPath: string }): string;
};

type SettingsShape = {
  openAtLogin: boolean;
  resumeMonitoringOnStart: boolean;
  trayHintShown: boolean;
};

type SettingsModule = {
  DEFAULT_SETTINGS: Readonly<SettingsShape>;
  mergeSettings(raw: unknown): SettingsShape;
  readSettings(file: string): { settings: SettingsShape; existed: boolean };
  writeSettings(file: string, settings: Partial<SettingsShape>): void;
};

type NavigationModule = {
  navigationDecision(target: string, appOrigin: string): 'allow' | 'external' | 'deny';
  appOriginFor(port: number): string;
};

type ServerClientModule = {
  waitForHealth(
    origin: string,
    options?: {
      timeoutMs?: number;
      intervalMs?: number;
      fetchImpl?: (url: string, init?: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
      shouldStop?: () => boolean;
      now?: () => number;
    },
  ): Promise<boolean>;
  resumeMonitoring(
    origin: string,
    options?: {
      fetchImpl?: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
    },
  ): Promise<unknown>;
};

type SandboxModule = {
  APPARMOR_RESTRICT_USERNS_PATH: string;
  shouldDisableChromiumSandbox(options: {
    platform: string;
    env: Record<string, string | undefined>;
    apparmorRestrictUserns: string | null | undefined;
  }): boolean;
  readApparmorRestrictUserns(readFile?: (path: string, encoding: BufferEncoding) => string): string | null;
};

type PruneRulesModule = {
  llamaPrebuiltFor(platform: string, arch: string): string;
  esbuildPrebuiltFor(platform: string, arch: string): string;
  assertEsbuildPrebuilt(nodeModulesDir: string, platform: string, arch: string, exists?: (path: string) => boolean): string;
  isPrunedForDesktop(relativePath: string, keptLlamaPrebuilt: string, keptEsbuildPrebuilt?: string): boolean;
};

type AfterPackModule = {
  default(context: {
    electronPlatformName: string;
    arch: number;
    appOutDir: string;
    packager: { appInfo: { productFilename: string } };
  }): Promise<void>;
};

type IconsModule = {
  buildIcons(): { ico: Buffer; png: Buffer };
};

const pathsMod = require('../desktop/lib/paths.cjs') as PathsModule;
const portMod = require('../desktop/lib/port.cjs') as PortModule;
const autostartMod = require('../desktop/lib/autostart.cjs') as AutostartModule;
const settingsMod = require('../desktop/lib/settings.cjs') as SettingsModule;
const navigationMod = require('../desktop/lib/navigation.cjs') as NavigationModule;
const serverClientMod = require('../desktop/lib/server-client.cjs') as ServerClientModule;
const sandboxMod = require('../desktop/lib/sandbox.cjs') as SandboxModule;
const afterPackMod = require('../packaging/desktop/after-pack.cjs') as AfterPackModule;

async function loadMjs<T>(relativePath: string): Promise<T> {
  return import(pathToFileURL(resolve(relativePath)).href) as Promise<T>;
}

test('resolveDataHome selects the platform data directory, respects SOCIAL_DESK_HOME and matches the Windows installer path', () => {
  assert.equal(
    pathsMod.resolveDataHome({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\Ana\\AppData\\Local' }, homedir: 'C:\\Users\\Ana' }),
    'C:\\Users\\Ana\\AppData\\Local\\SocialDesk',
  );
  assert.equal(
    pathsMod.resolveDataHome({ platform: 'win32', env: {}, homedir: 'C:\\Users\\Ana' }),
    'C:\\Users\\Ana\\AppData\\Local\\SocialDesk',
  );
  assert.equal(
    pathsMod.resolveDataHome({ platform: 'linux', env: {}, homedir: '/home/ana' }),
    '/home/ana/.local/share/SocialDesk',
  );
  assert.equal(
    pathsMod.resolveDataHome({ platform: 'linux', env: { XDG_DATA_HOME: '/custom/xdg' }, homedir: '/home/ana' }),
    '/custom/xdg/SocialDesk',
  );
  assert.equal(
    pathsMod.resolveDataHome({ platform: 'linux', env: { XDG_DATA_HOME: 'relative/path' }, homedir: '/home/ana' }),
    '/home/ana/.local/share/SocialDesk',
    'relative XDG_DATA_HOME is ignored per the XDG Base Directory specification',
  );
  assert.equal(
    pathsMod.resolveDataHome({ platform: 'darwin', env: {}, homedir: '/Users/ana' }),
    '/Users/ana/Library/Application Support/SocialDesk',
  );
  assert.equal(
    pathsMod.resolveDataHome({ platform: 'linux', env: { SOCIAL_DESK_HOME: ' /tmp/sd-test-home ' }, homedir: '/home/ana' }),
    '/tmp/sd-test-home',
  );

  const subpaths = pathsMod.dataPaths('/home/ana/.local/share/SocialDesk', 'linux');
  assert.equal(subpaths.data, '/home/ana/.local/share/SocialDesk/data');
  assert.equal(subpaths.logs, '/home/ana/.local/share/SocialDesk/logs');
  assert.equal(subpaths.settings, '/home/ana/.local/share/SocialDesk/desktop-settings.json');
  assert.equal(pathsMod.serverLogName(new Date(2026, 9, 5)), 'server-2026-10-05.log');
  assert.deepEqual(pathsMod.tailLines('one\n\ntwo\r\nthree\nfour\n', 2), ['three', 'four']);
});

test('choosePort prefers 3000, falls back to the first free port in 3001-3020 and returns null when all are busy', async () => {
  const candidates = portMod.candidatePorts();
  assert.equal(candidates[0], 3000);
  assert.equal(candidates[1], 3001);
  assert.equal(candidates.at(-1), 3020);
  assert.equal(candidates.length, 21);

  assert.equal(await portMod.choosePort(async () => true), 3000);
  assert.equal(await portMod.choosePort(async (port) => port >= 3003), 3003);
  assert.equal(await portMod.choosePort(async () => false), null);

  // Real loopback socket probe: a bound server makes isPortFree return false until it closes.
  const blocker = createServer();
  await new Promise<void>((resolveListen) => blocker.listen(0, '127.0.0.1', resolveListen));
  const address = blocker.address();
  assert.ok(address && typeof address === 'object');
  assert.equal(await portMod.isPortFree(address.port, '127.0.0.1'), false);
  await new Promise<void>((resolveClose) => blocker.close(() => resolveClose()));
  assert.equal(await portMod.isPortFree(address.port, '127.0.0.1'), true);
});

test('Linux autostart writes and removes ~/.config/autostart/social-desk.desktop using APPIMAGE when set', (context) => {
  const temp = mkdtempSync(join(tmpdir(), 'social-desktop-autostart-'));
  context.after(() => removeTempDir(temp));

  assert.equal(
    autostartMod.autostartFilePath({ env: {}, homedir: '/home/ana' }),
    '/home/ana/.config/autostart/social-desk.desktop',
  );
  assert.equal(
    autostartMod.autostartFilePath({ env: { XDG_CONFIG_HOME: '/custom/cfg' }, homedir: '/home/ana' }),
    '/custom/cfg/autostart/social-desk.desktop',
  );
  assert.equal(
    autostartMod.autostartExecutable({ env: { APPIMAGE: '/home/ana/Apps/Social Desk.AppImage' }, execPath: '/tmp/.mount_sd/usr/bin/social-desk' }),
    '/home/ana/Apps/Social Desk.AppImage',
  );
  assert.equal(
    autostartMod.autostartExecutable({ env: {}, execPath: '/opt/Social Desk/social-desk' }),
    '/opt/Social Desk/social-desk',
  );

  const file = autostartMod.applyLinuxAutostart(true, {
    env: { APPIMAGE: '/home/ana/Apps/Social Desk.AppImage' },
    homedir: temp,
    execPath: '/usr/bin/social-desk',
  });
  // The module builds Linux paths with posix separators on every host, so compare the same way (Windows CI too).
  assert.equal(file, posix.join(temp, '.config', 'autostart', 'social-desk.desktop'));
  const content = readFileSync(file, 'utf8');
  assert.match(content, /^\[Desktop Entry\]\n/u);
  assert.match(content, /^Exec="\/home\/ana\/Apps\/Social Desk\.AppImage" --hidden$/mu);
  assert.match(content, /^X-GNOME-Autostart-enabled=true$/mu);

  autostartMod.applyLinuxAutostart(false, { env: {}, homedir: temp, execPath: '/usr/bin/social-desk' });
  assert.equal(existsSync(file), false);
});

test('desktop settings default to openAtLogin=true and resumeMonitoringOnStart=false, sanitize invalid values and persist atomically', (context) => {
  const temp = mkdtempSync(join(tmpdir(), 'social-desktop-settings-'));
  context.after(() => removeTempDir(temp));
  const file = join(temp, 'desktop-settings.json');

  assert.deepEqual(settingsMod.DEFAULT_SETTINGS, {
    openAtLogin: true,
    resumeMonitoringOnStart: false,
    trayHintShown: false,
  });
  assert.deepEqual(settingsMod.readSettings(file), {
    settings: { openAtLogin: true, resumeMonitoringOnStart: false, trayHintShown: false },
    existed: false,
  });
  assert.deepEqual(
    settingsMod.mergeSettings({ openAtLogin: false, resumeMonitoringOnStart: 'yes', trayHintShown: true, extra: 123 }),
    { openAtLogin: false, resumeMonitoringOnStart: false, trayHintShown: true },
  );

  settingsMod.writeSettings(file, { openAtLogin: false, resumeMonitoringOnStart: true, trayHintShown: true });
  assert.deepEqual(settingsMod.readSettings(file), {
    settings: { openAtLogin: false, resumeMonitoringOnStart: true, trayHintShown: true },
    existed: true,
  });

  writeFileSync(file, '{broken json', 'utf8');
  assert.deepEqual(settingsMod.readSettings(file), {
    settings: { openAtLogin: true, resumeMonitoringOnStart: false, trayHintShown: false },
    existed: false,
  });
});

test('navigationDecision keeps only the exact app origin in-window, sends external http(s) to the browser and denies other schemes', () => {
  const origin = navigationMod.appOriginFor(3001);
  assert.equal(origin, 'http://127.0.0.1:3001');
  assert.equal(navigationMod.navigationDecision('http://127.0.0.1:3001/', origin), 'allow');
  assert.equal(navigationMod.navigationDecision('http://127.0.0.1:3001/api/health', origin), 'allow');
  assert.equal(navigationMod.navigationDecision('http://localhost:3001/', origin), 'external');
  assert.equal(navigationMod.navigationDecision('http://127.0.0.1:3000/', origin), 'external');
  assert.equal(navigationMod.navigationDecision('https://developers.facebook.com/apps/', origin), 'external');
  assert.equal(navigationMod.navigationDecision('file:///etc/passwd', origin), 'deny');
  assert.equal(navigationMod.navigationDecision('javascript:alert(1)', origin), 'deny');
  assert.equal(navigationMod.navigationDecision('not a url', origin), 'deny');
});

test('waitForHealth polls until ready and resumeMonitoring sends the CSRF token and same-origin header', async () => {
  let attempts = 0;
  const ready = await serverClientMod.waitForHealth('http://127.0.0.1:3001', {
    timeoutMs: 1_000,
    intervalMs: 1,
    fetchImpl: async () => {
      attempts++;
      if (attempts < 3) throw new Error('ECONNREFUSED');
      return { ok: true, json: async () => ({ status: 'ok', ready: true }) };
    },
  });
  assert.equal(ready, true);
  assert.equal(attempts, 3);

  const stopped = await serverClientMod.waitForHealth('http://127.0.0.1:3001', {
    timeoutMs: 1_000,
    intervalMs: 1,
    shouldStop: () => true,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ready: true }) }),
  });
  assert.equal(stopped, false);

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  await serverClientMod.resumeMonitoring('http://127.0.0.1:3001', {
    fetchImpl: async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith('/api/session')) {
        return { ok: true, status: 200, json: async () => ({ csrfToken: 'tok-123' }) };
      }
      return { ok: true, status: 200, json: async () => ({ started: 1 }) };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, 'http://127.0.0.1:3001/api/session');
  assert.equal(calls[1]!.url, 'http://127.0.0.1:3001/api/monitor/all');
  assert.equal(calls[1]!.init?.method, 'POST');
  assert.deepEqual(calls[1]!.init?.headers, {
    origin: 'http://127.0.0.1:3001',
    'x-csrf-token': 'tok-123',
    'content-type': 'application/json',
  });
  assert.equal(calls[1]!.init?.body, JSON.stringify({ action: 'start' }));
});

test('shouldDisableChromiumSandbox only disables the sandbox for a Linux AppImage when kernel.apparmor_restrict_unprivileged_userns reads 1', () => {
  assert.equal(sandboxMod.APPARMOR_RESTRICT_USERNS_PATH, '/proc/sys/kernel/apparmor_restrict_unprivileged_userns');

  // Linux AppImage on Ubuntu 24.04+ with apparmor_restrict_unprivileged_userns=1 -> disable sandbox.
  assert.equal(
    sandboxMod.shouldDisableChromiumSandbox({
      platform: 'linux',
      env: { APPIMAGE: '/home/ana/Apps/SocialDesk-0.2.1-x86_64.AppImage' },
      apparmorRestrictUserns: '1\n',
    }),
    true,
  );

  // .deb installation (no APPIMAGE env var) keeps the sandbox enabled because it installs an AppArmor profile.
  assert.equal(
    sandboxMod.shouldDisableChromiumSandbox({
      platform: 'linux',
      env: {},
      apparmorRestrictUserns: '1\n',
    }),
    false,
  );
  assert.equal(
    sandboxMod.shouldDisableChromiumSandbox({
      platform: 'linux',
      env: { APPIMAGE: '   ' },
      apparmorRestrictUserns: '1',
    }),
    false,
  );

  // Hosts without the AppArmor restriction (0 or sysctl absent) and non-Linux platforms keep the sandbox enabled.
  assert.equal(
    sandboxMod.shouldDisableChromiumSandbox({
      platform: 'linux',
      env: { APPIMAGE: '/home/ana/Apps/SocialDesk.AppImage' },
      apparmorRestrictUserns: '0\n',
    }),
    false,
  );
  assert.equal(
    sandboxMod.shouldDisableChromiumSandbox({
      platform: 'linux',
      env: { APPIMAGE: '/home/ana/Apps/SocialDesk.AppImage' },
      apparmorRestrictUserns: null,
    }),
    false,
  );
  assert.equal(
    sandboxMod.shouldDisableChromiumSandbox({
      platform: 'win32',
      env: { APPIMAGE: 'C:\\SocialDesk.exe' },
      apparmorRestrictUserns: '1',
    }),
    false,
  );

  assert.equal(sandboxMod.readApparmorRestrictUserns(() => '1\n'), '1\n');
  assert.equal(
    sandboxMod.readApparmorRestrictUserns(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }),
    null,
  );
});

test('desktop prune rules, esbuild guard and afterPack enforce target platform binaries and generate valid icons', async (context) => {
  const { llamaPrebuiltFor, esbuildPrebuiltFor, assertEsbuildPrebuilt, isPrunedForDesktop } = await loadMjs<PruneRulesModule>(
    'packaging/desktop/lib/prune-rules.mjs',
  );
  assert.equal(llamaPrebuiltFor('linux', 'x64'), 'linux-x64');
  assert.equal(llamaPrebuiltFor('win32', 'x64'), 'win-x64');
  assert.equal(llamaPrebuiltFor('darwin', 'arm64'), 'mac-arm64-metal');

  assert.equal(esbuildPrebuiltFor('linux', 'x64'), 'linux-x64');
  assert.equal(esbuildPrebuiltFor('win32', 'x64'), 'win32-x64');
  assert.equal(esbuildPrebuiltFor('darwin', 'arm64'), 'darwin-arm64');
  assert.throws(() => esbuildPrebuiltFor('freebsd', 'x64'), /unsupported platform freebsd/u);

  assert.equal(assertEsbuildPrebuilt('/fake/node_modules', 'win32', 'x64', (p) => p.endsWith(join('@esbuild', 'win32-x64'))), 'win32-x64');
  assert.throws(
    () => assertEsbuildPrebuilt('/fake/node_modules', 'win32', 'x64', () => false),
    /afterPack: @esbuild\/win32-x64 is missing from packaged node_modules/u,
  );

  assert.equal(isPrunedForDesktop(join('@node-llama-cpp', 'linux-x64'), 'linux-x64', 'linux-x64'), false);
  assert.equal(isPrunedForDesktop(join('@node-llama-cpp', 'linux-x64-cuda'), 'linux-x64', 'linux-x64'), true);
  assert.equal(isPrunedForDesktop(join('@node-llama-cpp', 'linux-x64-vulkan'), 'linux-x64', 'linux-x64'), true);
  assert.equal(isPrunedForDesktop(join('@node-llama-cpp', 'win-x64'), 'linux-x64', 'linux-x64'), true);
  assert.equal(isPrunedForDesktop(join('@esbuild', 'linux-x64'), 'linux-x64', 'linux-x64'), false);
  assert.equal(isPrunedForDesktop(join('@esbuild', 'win32-x64'), 'linux-x64', 'linux-x64'), true);
  assert.equal(isPrunedForDesktop(join('node-llama-cpp', 'llama', 'gitRelease.bundle'), 'linux-x64'), true);
  assert.equal(isPrunedForDesktop('typescript', 'linux-x64'), true);

  // Real execution of afterPack against a synthetic appOutDir: succeeds when @esbuild/<platform>-<arch> is present
  // and throws when cross-packaging without the target platform @esbuild binary.
  const temp = mkdtempSync(join(tmpdir(), 'social-desktop-afterpack-'));
  context.after(() => removeTempDir(temp));

  const linuxOut = join(temp, 'linux-unpacked');
  const linuxApp = join(linuxOut, 'resources', 'app');
  mkdirSync(join(linuxApp, '.next'), { recursive: true });
  writeFileSync(join(linuxApp, '.next', 'BUILD_ID'), 'test-build-id\n', 'utf8');
  mkdirSync(join(linuxApp, 'node_modules', '@esbuild', 'linux-x64'), { recursive: true });
  mkdirSync(join(linuxApp, 'node_modules', '@esbuild', 'win32-x64'), { recursive: true });
  mkdirSync(join(linuxApp, 'node_modules', '@node-llama-cpp', 'linux-x64'), { recursive: true });
  mkdirSync(join(linuxApp, 'node_modules', '@node-llama-cpp', 'win-x64'), { recursive: true });
  mkdirSync(join(linuxApp, 'node_modules', 'typescript'), { recursive: true });

  await afterPackMod.default({
    electronPlatformName: 'linux',
    arch: 1, // x64
    appOutDir: linuxOut,
    packager: { appInfo: { productFilename: 'Social Desk' } },
  });
  assert.equal(existsSync(join(linuxApp, 'node_modules', '@esbuild', 'linux-x64')), true);
  assert.equal(existsSync(join(linuxApp, 'node_modules', '@esbuild', 'win32-x64')), false);
  assert.equal(existsSync(join(linuxApp, 'node_modules', '@node-llama-cpp', 'linux-x64')), true);
  assert.equal(existsSync(join(linuxApp, 'node_modules', '@node-llama-cpp', 'win-x64')), false);
  assert.equal(existsSync(join(linuxApp, 'node_modules', 'typescript')), false);

  const winOut = join(temp, 'win-unpacked');
  const winApp = join(winOut, 'resources', 'app');
  mkdirSync(join(winApp, '.next'), { recursive: true });
  writeFileSync(join(winApp, '.next', 'BUILD_ID'), 'test-build-id\n', 'utf8');
  mkdirSync(join(winApp, 'node_modules', '@node-llama-cpp', 'win-x64'), { recursive: true });
  mkdirSync(join(winApp, 'node_modules', '@esbuild', 'linux-x64'), { recursive: true });

  await assert.rejects(
    () =>
      afterPackMod.default({
        electronPlatformName: 'win32',
        arch: 1, // x64
        appOutDir: winOut,
        packager: { appInfo: { productFilename: 'Social Desk' } },
      }),
    /afterPack: @esbuild\/win32-x64 is missing from packaged node_modules/u,
  );

  const { buildIcons } = await loadMjs<IconsModule>('packaging/desktop/icons.mjs');
  const { ico, png } = buildIcons();
  assert.equal(ico.readUInt16LE(2), 1, 'ICO type 1');
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 512, 'PNG width 512');
  assert.equal(png.readUInt32BE(20), 512, 'PNG height 512');
});
