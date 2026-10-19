# Aplicación de escritorio de Social Desk (Electron)

Esta carpeta y `desktop/` empaquetan Social Desk como una aplicación de escritorio autónoma con Electron (`44.8.0`, Node.js `24.22.0` integrado) para **Linux** (`AppImage` y `.deb`) y **Windows** (instalador NSIS por usuario `SocialDesk-Desktop-Setup-<versión>.exe`), compilados en GitHub Actions ([`.github/workflows/desktop-installers.yml`](../../.github/workflows/desktop-installers.yml)).

> El instalador clásico de Inno Setup en [`packaging/windows/`](../windows/README.md) se mantiene sin cambios. Ambos comparten la misma carpeta de datos en Windows (`%LOCALAPPDATA%\SocialDesk`), por lo que cambiar de uno a otro conserva la base de datos y `vault.key`.

## Cómo se construye

| Comando | Qué hace |
| --- | --- |
| `npm ci` | Instala las dependencias del repositorio (Node.js ≥ 24.21.0). |
| `npm run build` | Compila la aplicación web Next.js en `.next/`. |
| `npm run desktop:icons` | Genera `build/icon.ico` (múltiples tamaños) y `build/icon.png` (512×512) a partir de `packaging/windows/lib/icon.mjs`. |
| `npm run desktop:dev` | Genera los iconos, compila `.next/` si no existe y abre la ventana de Electron en modo desarrollo. |
| `npm run desktop:dist:linux` | Genera `dist/SocialDesk-<versión>-x86_64.AppImage` y `dist/social-desk_<versión>_amd64.deb`. |
| `npm run desktop:dist:win` | Genera `dist/SocialDesk-Desktop-Setup-<versión>.exe` (NSIS por usuario, sin permisos de administrador). |

## Qué instala y cómo funciona

No se incluye un binario de Node.js separado: el proceso principal de Electron (`desktop/main.cjs`) lanza el servidor local en un proceso hijo (`desktop/server-entry.mjs` → `scripts/start.mjs` → `server.ts`) usando el propio ejecutable de Electron en modo Node (`ELECTRON_RUN_AS_NODE=1`), con soporte nativo para `node:sqlite` y los módulos N-API.

- **Sin archivo `asar` (`asar: false`):** Next.js y `tsx` requieren acceso real al sistema de archivos en `resources/app/`.
- **Poda de `node_modules` (`packaging/desktop/after-pack.cjs`):** aplica las mismas reglas que `packaging/windows/lib/payload-rules.mjs`, conservando únicamente el binario precompilado de CPU `@node-llama-cpp/<plataforma>-<arquitectura>` (`linux-x64` en Linux, `win-x64` en Windows) y descartando variantes GPU (CUDA/Vulkan), `@next/swc-*`, `sharp`/`@img`, `typescript`, mapas de código fuente y documentación.
- **Puerto local:** intenta usar `127.0.0.1:3000`; si está ocupado, elige el primer puerto libre entre `3001` y `3020`.
- **Seguridad del origen:** la ventana principal (`1280×800`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) carga `http://127.0.0.1:<puerto>`. Cualquier navegación o `window.open` hacia otro origen `http:`/`https:` se abre en el navegador del sistema (`shell.openExternal`) y se bloquea dentro de la ventana; cualquier otro esquema se rechaza.

## Dónde viven los datos

La ubicación se puede sobrescribir con la variable de entorno `SOCIAL_DESK_HOME` (útil para pruebas). Por defecto:

| Sistema | Carpeta base (`<home>`) |
| --- | --- |
| Windows | `%LOCALAPPDATA%\SocialDesk` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/SocialDesk` |
| macOS | `~/Library/Application Support/SocialDesk` |

Estructura dentro de `<home>`:

```text
<home>/
  data/                     social-automation.sqlite, vault.key, .application-owner.json, models/
  logs/                     server-YYYY-MM-DD.log (salida del servidor y eventos del shell)
  desktop-settings.json     preferencias del shell (openAtLogin, resumeMonitoringOnStart, trayHintShown)
  electron/                 perfil de Chromium y bloqueo de instancia única de Electron
```

Desinstalar la aplicación **nunca** borra `<home>/data` ni `<home>/logs`.

## Bandeja del sistema e inicio automático

- **Cerrar la ventana no detiene el servidor:** al pulsar el botón de cerrar (`×`), la ventana se oculta en la bandeja del sistema para que el monitoreo siga funcionando en segundo plano. La primera vez se muestra una notificación explicándolo.
- **Menú de la bandeja del sistema:**
  - **Abrir Social Desk:** muestra y enfoca la ventana principal (también al hacer clic en el icono o al abrir una segunda instancia).
  - **Abrir en el navegador:** abre `http://127.0.0.1:<puerto>` en el navegador predeterminado.
  - **Iniciar con el sistema** (activado por defecto):
    - En Windows y macOS usa `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`.
    - En Linux crea o elimina `~/.config/autostart/social-desk.desktop` con `Exec=<ruta del AppImage o binario> --hidden`.
  - **Reanudar monitoreo al abrir** (desactivado por defecto): cuando está marcado, tras verificar `/api/health` llama automáticamente a `POST /api/monitor/all` (`{"action":"start"}`) con el token CSRF de la sesión.
  - **Salir:** cierra la aplicación por completo.
- **Menú de la ventana (`Archivo`):** incluye **Ocultar ventana** y **Salir** (`Ctrl+Q` / `Cmd+Q`), para poder salir siempre aunque el escritorio (por ejemplo GNOME sin extensión AppIndicator) no muestre iconos de bandeja.
- **Arranque oculto (`--hidden`):** crea la ventana en segundo plano sin mostrarla (para registrar `session-end` en Windows y cargar la URL apenas el servidor esté listo) junto con el icono de la bandeja.

## Cómo detener la aplicación

1. Desde el icono de la bandeja del sistema o el menú **Archivo → Salir** (`Ctrl+Q` / `Cmd+Q`), elige **Salir** (o envía `SIGTERM`/`SIGINT` al proceso de Electron, o apaga la sesión del sistema).
2. El proceso principal envía `{ type: 'shutdown' }` por el canal IPC al proceso hijo del servidor (`desktop/server-entry.mjs`).
3. `server-entry.mjs` emite `SIGTERM` dentro del proceso del servidor, ejecutando el cierre ordenado e idempotente de `server.ts` (cierra el servidor HTTP, cierra SQLite y libera `.application-owner.json`). Si el proceso padre muere inesperadamente, la desconexión del canal IPC dispara el mismo cierre ordenado.
4. Si el servidor no termina en 15 segundos, el proceso principal envía `SIGKILL` (`kill()` en Windows) y espera hasta 5 segundos más al evento real `exit`.

## Archivos

| Archivo | Propósito |
| --- | --- |
| `desktop/main.cjs` | Proceso principal de Electron: bloqueo de instancia única, ventana, bandeja, ciclo de vida del servidor. |
| `desktop/server-entry.mjs` | Entrada del proceso hijo del servidor: puente IPC → `SIGTERM` y carga de `scripts/start.mjs`. |
| `desktop/splash.html` | Pantalla de carga local en español («Iniciando Social Desk...») sin recursos remotos. |
| `desktop/lib/*.cjs` | Lógica pura probada sin Electron en `tests/desktop-shell.test.ts` (rutas, puertos, autostart, ajustes, navegación, cliente HTTP). |
| `packaging/desktop/run.mjs` | Punto de entrada multiplataforma para `desktop:icons`, `desktop:dev`, `desktop:dist:linux` y `desktop:dist:win`. |
| `packaging/desktop/icons.mjs` | Generador de `build/icon.ico` y `build/icon.png` (512×512). |
| `packaging/desktop/after-pack.cjs` | Hook `afterPack` de `electron-builder` que poda `node_modules` y verifica la integridad del paquete. |
| `packaging/desktop/lib/prune-rules.mjs` | Reglas de poda de `node_modules` por plataforma y arquitectura destino. |
| `electron-builder.yml` | Configuración de empaquetado para NSIS (Windows), AppImage y deb (Linux). |
