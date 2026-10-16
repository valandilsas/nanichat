'use strict';
// Social Desk desktop shell (Electron main process).
//
// The web app is unchanged: the shell forks the normal production server (desktop/server-entry.mjs ->
// scripts/start.mjs -> server.ts) with Electron's own binary acting as Node.js (ELECTRON_RUN_AS_NODE=1), waits for
// /api/health and shows http://127.0.0.1:<port> in a window. Closing the window keeps the app (and monitoring) running
// in the system tray; "Salir" stops the server gracefully over IPC. Pure logic lives in desktop/lib/*.cjs (tested by
// tests/desktop-*.test.ts).
const { app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, powerMonitor, shell } = require('electron');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { shouldDisableChromiumSandbox, readApparmorRestrictUserns } = require('./lib/sandbox.cjs');
const { resolveDataHome, dataPaths, serverLogName, tailLines } = require('./lib/paths.cjs');
const { choosePort, isPortFree } = require('./lib/port.cjs');
const { readSettings, writeSettings } = require('./lib/settings.cjs');
const { applyLinuxAutostart } = require('./lib/autostart.cjs');
const { navigationDecision, appOriginFor } = require('./lib/navigation.cjs');
const { waitForHealth, resumeMonitoring } = require('./lib/server-client.cjs');

const sandboxDisabledForAppImage = shouldDisableChromiumSandbox({
  platform: process.platform,
  env: process.env,
  apparmorRestrictUserns: process.platform === 'linux' ? readApparmorRestrictUserns() : null,
});
if (sandboxDisabledForAppImage) {
  app.commandLine.appendSwitch('no-sandbox');
  console.info('[desktop] Chromium sandbox disabled (--no-sandbox): running from Linux AppImage with kernel.apparmor_restrict_unprivileged_userns=1');
}

const APP_TITLE = 'Social Desk';
const APP_ID = 'com.socialdesk.app';
const HEALTH_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 15_000;
const KILL_GRACE_MS = 5_000;
const LOG_TAIL_LINES = 20;

// The application root: app.getAppPath() is resources/app in a packaged build (asar is disabled because Next.js needs
// a real file system) and the repository root when Electron is launched on the project directory; fall back to the
// parent of desktop/ when Electron is launched directly on desktop/main.cjs.
const reportedAppPath = app.getAppPath();
const appRoot = fs.existsSync(path.join(reportedAppPath, 'server.ts')) ? reportedAppPath : path.resolve(__dirname, '..');
const startHidden = process.argv.includes('--hidden');
const paths = dataPaths(resolveDataHome({ platform: process.platform, env: process.env, homedir: os.homedir() }));

// Chromium profile and the single-instance lock live under the data home too (one instance per data home).
app.setPath('userData', paths.electron);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
/** @type {import('node:child_process').ChildProcess | null} */
let serverChild = null;
let origin = null;
let logPath = null;
let serverReady = false;
let expectingServerExit = false;
let quitting = false;
/** @type {Promise<void> | null} */
let stopping = null;
let settings = readSettings(paths.settings).settings;

function appendLog(message) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `[desktop ${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch {
    // Logging must never break the shell.
  }
}

function logTail() {
  try {
    return tailLines(fs.readFileSync(logPath, 'utf8'), LOG_TAIL_LINES).join('\n');
  } catch {
    return '(no se pudo leer el registro)';
  }
}

function iconPath() {
  return path.join(appRoot, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

function updateSettings(patch) {
  settings = { ...settings, ...patch };
  try {
    writeSettings(paths.settings, settings);
  } catch (error) {
    appendLog(`could not save settings: ${error.message}`);
  }
}

/** Windows/macOS: login item. Linux: XDG autostart entry. Development runs never register themselves. */
function applyOpenAtLogin() {
  if (!app.isPackaged) {
    appendLog('development run: start-with-system setting not applied');
    return;
  }
  try {
    if (process.platform === 'linux') {
      const file = applyLinuxAutostart(settings.openAtLogin, { env: process.env, homedir: os.homedir(), execPath: process.execPath });
      appendLog(`autostart ${settings.openAtLogin ? 'written' : 'removed'}: ${file}`);
    } else {
      app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, args: ['--hidden'] });
    }
  } catch (error) {
    appendLog(`could not apply start-with-system: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Server child process

async function startServer() {
  serverReady = false;
  fs.mkdirSync(paths.data, { recursive: true });
  fs.mkdirSync(paths.logs, { recursive: true });
  logPath = path.join(paths.logs, serverLogName(new Date()));
  if (sandboxDisabledForAppImage) {
    appendLog('Chromium sandbox disabled (--no-sandbox): running from Linux AppImage with kernel.apparmor_restrict_unprivileged_userns=1');
  }
  const port = await choosePort((candidate) => isPortFree(candidate));
  if (port === null) {
    appendLog('no free port in 3000-3020');
    await failStartup('No hay ningún puerto libre entre 3000 y 3020. Cierra otros programas que los usen e inténtalo de nuevo.');
    return;
  }
  origin = appOriginFor(port);
  appendLog(`Social Desk ${app.getVersion()} (Electron ${process.versions.electron}) starting the server on ${origin}, data ${paths.data}`);
  const logFd = fs.openSync(logPath, 'a');
  let child;
  try {
    child = fork(path.join(appRoot, 'desktop', 'server-entry.mjs'), [], {
      cwd: appRoot,
      execPath: process.execPath,
      execArgv: [],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        PORT: String(port),
        LOCAL_SOCIAL_DATA_DIR: paths.data,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', logFd, logFd, 'ipc'],
      windowsHide: true,
    });
  } finally {
    fs.closeSync(logFd); // the child holds its own copy
  }
  serverChild = child;
  expectingServerExit = false;
  child.once('exit', (code, signal) => { void onServerExit(child, code, signal); });
  child.once('error', (error) => appendLog(`server process error: ${error.message}`));

  const ready = await waitForHealth(origin, {
    timeoutMs: HEALTH_TIMEOUT_MS,
    shouldStop: () => serverChild !== child || child.exitCode !== null || child.signalCode !== null || quitting,
  });
  if (quitting || serverChild !== child) return;
  if (!ready) {
    appendLog('the server did not become ready');
    await stopServer();
    await failStartup(`Social Desk no pudo iniciar su servidor local en ${Math.round(HEALTH_TIMEOUT_MS / 1000)} segundos.`);
    return;
  }
  serverReady = true;
  appendLog(`server ready on ${origin}`);
  refreshTrayMenu();
  if (settings.resumeMonitoringOnStart) {
    resumeMonitoring(origin)
      .then(() => appendLog('monitoring resumed (resumeMonitoringOnStart)'))
      .catch((error) => appendLog(`could not resume monitoring: ${error.message}`));
  }
  if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(origin);
  else if (!startHidden) showMainWindow();
}

async function failStartup(message) {
  await dialog.showMessageBox({
    type: 'error',
    title: APP_TITLE,
    message,
    detail: `Registro: ${logPath}\n\nÚltimas líneas:\n${logTail()}`,
    buttons: ['Salir'],
  });
  app.quit();
}

async function onServerExit(child, code, signal) {
  if (child !== serverChild) return;
  serverChild = null;
  const wasReady = serverReady;
  serverReady = false;
  appendLog(`server exited (code ${code}, signal ${signal})`);
  refreshTrayMenu();
  if (expectingServerExit || quitting || !wasReady) return; // a startup failure is reported by startServer
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: APP_TITLE,
    message: 'El servidor de Social Desk se detuvo inesperadamente.',
    detail: `Registro: ${logPath}\n\nÚltimas líneas:\n${logTail()}`,
    buttons: ['Reiniciar', 'Salir'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadFile(path.join(__dirname, 'splash.html'));
    await startServer();
  } else {
    app.quit();
  }
}

/** Graceful stop over IPC (works the same on Windows); force-kills the process if it is still alive after 15 s. */
function stopServer() {
  const child = serverChild;
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  expectingServerExit = true;
  return new Promise((resolve) => {
    let settled = false;
    let killTimer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(stopTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve();
    };
    const forceKillAndWait = (reason) => {
      appendLog(reason);
      try {
        if (process.platform === 'win32') child.kill();
        else child.kill('SIGKILL');
      } catch {
        // Process may have just exited.
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        finish();
        return;
      }
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          appendLog(`server process (pid ${child.pid}) did not exit within ${KILL_GRACE_MS / 1000} s after force kill`);
        }
        finish();
      }, KILL_GRACE_MS);
    };
    const stopTimer = setTimeout(() => {
      forceKillAndWait(`server did not stop within ${STOP_TIMEOUT_MS / 1000} s; force-killing it`);
    }, STOP_TIMEOUT_MS);
    child.once('exit', finish);
    try {
      child.send({ type: 'shutdown' });
      appendLog('shutdown requested');
    } catch (error) {
      clearTimeout(stopTimer);
      forceKillAndWait(`could not send shutdown (${error.message}); force-killing the server`);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Windows, application menu and tray

function applicationMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Ocultar ventana',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.hide();
              showTrayHintOnce();
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Salir',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
  ]);
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: APP_TITLE,
    icon: iconPath(),
    show: false,
    backgroundColor: '#f8fafc',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.on('page-title-updated', (event) => event.preventDefault());
  // The API only accepts its own origin, so the window never leaves it: other http(s) targets go to the system
  // browser, anything else is refused.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const decision = origin ? navigationDecision(url, origin) : 'deny';
    if (decision === 'external') void shell.openExternal(url);
    else if (decision === 'allow') void win.loadURL(url);
    return { action: 'deny' };
  });
  const guardNavigation = (event, url) => {
    const decision = origin ? navigationDecision(url, origin) : 'deny';
    if (decision === 'allow') return;
    event.preventDefault();
    if (decision === 'external') void shell.openExternal(url);
  };
  win.webContents.on('will-navigate', guardNavigation);
  win.webContents.on('will-redirect', guardNavigation);
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
    showTrayHintOnce();
  });
  // Windows: the session is ending (log off / shutdown); ask the server to stop while there is still time.
  win.on('session-end', () => {
    quitting = true;
    try { serverChild?.send({ type: 'shutdown' }); } catch { /* already gone */ }
  });
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  if (serverReady && origin) void win.loadURL(origin);
  else void win.loadFile(path.join(__dirname, 'splash.html'));
  return win;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showTrayHintOnce() {
  if (settings.trayHintShown) return;
  updateSettings({ trayHintShown: true });
  if (!Notification.isSupported()) return;
  new Notification({
    title: 'Social Desk sigue funcionando',
    body: 'Cerraste la ventana, pero Social Desk sigue abierto en la bandeja del sistema para seguir monitoreando. Para cerrarlo del todo, usa «Salir» en el icono de la bandeja o en el menú Archivo.',
    icon: iconPath(),
  }).show();
}

function trayImage() {
  const image = nativeImage.createFromPath(iconPath());
  if (image.isEmpty() || process.platform === 'win32') return image;
  return image.resize({ width: 32, height: 32 });
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Abrir Social Desk', click: showMainWindow },
    { label: 'Abrir en el navegador', enabled: serverReady, click: () => { if (origin) void shell.openExternal(origin); } },
    {
      label: 'Iniciar con el sistema',
      type: 'checkbox',
      checked: settings.openAtLogin,
      click: (item) => { updateSettings({ openAtLogin: item.checked }); applyOpenAtLogin(); },
    },
    {
      label: 'Reanudar monitoreo al abrir',
      type: 'checkbox',
      checked: settings.resumeMonitoringOnStart,
      click: (item) => updateSettings({ resumeMonitoringOnStart: item.checked }),
    },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]);
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(trayMenu());
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip(APP_TITLE);
  tray.setContextMenu(trayMenu());
  tray.on('click', showMainWindow);
}

// ---------------------------------------------------------------------------------------------------------------
// Lifecycle

function main() {
  app.on('second-instance', () => { void app.whenReady().then(showMainWindow); });
  // Closing every window keeps the app in the tray; only "Salir" (or an OS quit) ends it.
  app.on('window-all-closed', () => {});
  app.on('activate', showMainWindow); // macOS dock click
  app.on('before-quit', (event) => {
    quitting = true;
    if (!serverChild) return;
    event.preventDefault();
    // Dropping the window's keep-alive connections lets the HTTP server close at once.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    if (!stopping) stopping = stopServer().finally(() => { serverChild = null; app.quit(); });
  });
  app.on('will-quit', () => {
    if (tray && !tray.isDestroyed()) tray.destroy();
  });
  process.on('SIGTERM', () => app.quit());
  process.on('SIGINT', () => app.quit());

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(applicationMenu());
    const { existed } = readSettings(paths.settings);
    if (!existed) {
      updateSettings({});
      applyOpenAtLogin();
    }
    // Linux/macOS shutdown: stop the server before the session ends.
    powerMonitor.on('shutdown', (event) => {
      event.preventDefault();
      app.quit();
    });
    createTray();
    // Create the window at startup even when --hidden so Windows session-end is always registered and showing it
    // later is instant.
    mainWindow = createMainWindow();
    if (!startHidden) showMainWindow();
    await startServer();
  }).catch((error) => {
    appendLog(`startup error: ${error.stack ?? error.message}`);
    dialog.showErrorBox(APP_TITLE, `Social Desk no pudo iniciar: ${error.message}`);
    app.quit();
  });
}

if (app.requestSingleInstanceLock()) {
  main();
} else {
  app.quit(); // another instance is running: it receives 'second-instance' and shows its window
}
