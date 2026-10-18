# AGENTS.md — guía para agentes de IA que trabajan en este repositorio

Este archivo orienta a asistentes de programación (Claude Code, Codex, Cursor, etc.) y a personas que modifican el código. Si solo quieres **instalar** la aplicación, lee [docs/INSTALACION-CON-IA.md](docs/INSTALACION-CON-IA.md).

El código, los comentarios y las pruebas están en inglés. La interfaz y la documentación están en español.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm install` | Instala dependencias (requiere Node ≥ 24.21.0). |
| `npm run dev` | Servidor en modo desarrollo (`tsx server.ts`, Next.js con recarga en caliente). |
| `npm run build` | Compila la interfaz (`next build`) en `.next`. |
| `npm start` | Servidor en modo producción (`node scripts/start.mjs`: pone `NODE_ENV=production` y carga `server.ts` con la API de `tsx`; funciona en PowerShell, `cmd`, macOS y Linux). Requiere `npm run build` previo. |
| `npm test` | Todas las pruebas (`node --import tsx --test --test-timeout=120000 --test-force-exit tests/*.test.ts`). Las opciones de `node` van siempre antes del patrón de archivos: después de él se ignoran sin aviso, así que `npm test -- --opcion` no sirve. |
| `npm run typecheck` | `tsc --noEmit`. |
| `node packaging/windows/fetch-node.mjs` y `node packaging/windows/build-payload.mjs` | Arman el instalador de Windows (los ejecuta el flujo `.github/workflows/windows-installer.yml` en Windows; ver [packaging/windows/README.md](packaging/windows/README.md)). |
| `curl http://127.0.0.1:3000/api/health` | Verificación de salud: `{"status":"ok","ready":true}`. |

Variables de entorno: `PORT` (por defecto `3000`), `LOCAL_SOCIAL_DATA_DIR` (por defecto `./data`) y cuatro opcionales que activan funciones desactivadas por defecto: `SOCIAL_DESK_IMPORT_ENV_PATH` (importación de `.env`), `SOCIAL_DESK_LEGACY_ACCOUNTS_DIR` y `SOCIAL_DESK_LEGACY_HOLD_USERNAMES` (retención heredada) y `SOCIAL_DESK_FACEBOOK_PAGES` (`1`/`true`; Páginas de Facebook, **EXPERIMENTAL**, apagada por defecto; ver [docs/GUIA-TOKEN-FACEBOOK.md](docs/GUIA-TOKEN-FACEBOOK.md)). Tabla completa en [README.md](README.md#variables-de-entorno). Lo específico de una instalación vive en esas variables.

`tsx` está en `dependencies` y la configuración de Next.js es `next.config.mjs`: el instalador de Windows instala solo dependencias de producción y no incluye el compilador SWC.

`node-llama-cpp` (motor del modelo local) va en `dependencies` con versión exacta y se importa con `import()` dinámico dentro de `src/services/moderation-ai-local.ts`, para que un binario nativo que no carga no impida arrancar. Las pruebas inyectan un módulo falso y las descargas usan un `fetch` falso.

Los scripts de `package.json` funcionan en Windows, macOS y Linux (sin sintaxis de una terminal concreta: `VAR=valor`, `$(...)`, `&&`). `tests/start-script.test.ts` lo comprueba.

## Mapa de la arquitectura

```text
server.ts                    Punto de entrada: bloqueo de instancia, base de datos, migraciones, bóveda,
                             servicios, router de la API y Next.js en un único servidor HTTP en 127.0.0.1.
scripts/start.mjs            Arranque de producción portable (NODE_ENV=production + tsx en el mismo proceso).
src/core/                    config.ts (variables de entorno), application-lock.ts (una instancia por carpeta,
                             sonda de plataforma inyectable: kill(pid, 0) en todos los sistemas, /proc en Linux),
                             domain.ts (tipos compartidos), errors.ts.
src/db/                      database.ts (SQLite, WAL, foreign keys), migrations.ts (esquema v1..v19),
                             repositories.ts (consultas compartidas).
src/security/                vault.ts (AES-256-GCM, vault.key), redact.ts (borra secretos de textos),
                             env-import.ts (importación explícita del .env de SOCIAL_DESK_IMPORT_ENV_PATH).
src/providers/meta/          provider.ts: único punto que habla con la Graph API de Meta.
src/services/                connections, automations (clasificación y plantillas), scanner (lectura de comentarios),
                             backlog (Revisión pendiente), pending-review, queue (cola, envío, read-back,
                             respuesta pública), public-reply (variantes), scheduler (Monitoreo), legacy-interlock (opcional),
                             follow-gate + follow-gate-rules («Pedir que me sigan», RETIRADO: código inactivo detrás de
                             FOLLOW_GATE_AVAILABLE = false), resource-attachment (adjunto del recurso, RETIRADO e inactivo),
                             moderation-rules (clasificación pura de comentarios para moderar) + moderation (marcas,
                             ocultar/mostrar/borrar con intención durable, acciones masivas y auto-ocultar solo en modo real),
                             moderation-ai + moderation-ai-gemini + moderation-ai-prompt + moderation-ai-engine (revisión con IA:
                             desactivada por defecto, key de Gemini cifrada, lotes que solo crean marcas, nunca llaman a Meta),
                             moderation-ai-local (motor local: node-llama-cpp importado con import() dinámico, solo CPU,
                             gramática JSON Schema) + moderation-ai-local-model (catálogo GGUF fijado por commit/SHA-256 y
                             descarga única verificada a <LOCAL_SOCIAL_DATA_DIR>/models).
src/http/router.ts           API JSON /api/*: guardas de host, origen y CSRF; DTOs con campos permitidos.
app/tutorial/                Tutorial integrado de Conexiones: content.ts (datos en español), progress.ts (validación pura,
                             clave app_state `tutorial_progress`), view.ts y TutorialSection.tsx.
app/                         Interfaz Next.js (page.tsx) y funciones puras de presentación con pruebas propias.
tests/                       Pruebas node:test (bases de datos temporales, proveedores simulados).
docs/                        Documentación; docs/manual tiene el manual PDF y sus herramientas de captura.
```

Detalle completo en [docs/REFERENCIA-TECNICA.md](docs/REFERENCIA-TECNICA.md).

## Comportamiento actual del producto

Así funciona el código hoy. Si la tarea pide cambiarlo, cámbialo.

1. **Dry Run por defecto.** Una base de datos nueva arranca con Dry Run activo y el Monitoreo apagado; el Monitoreo se apaga en cada arranque. Desactivar Dry Run y autorizar envíos reales («Autorizar real») usan confirmación explícita (`confirmed: true`). En Dry Run el proveedor no se llama para enviar: los elementos quedan `SIMULATED` y son inertes.
2. **Escanear lee y clasifica.** El escaneo y la Revisión pendiente leen y clasifican. Encolar comentarios antiguos es una acción separada, explícita y confirmada, que acepta clasificaciones `eligible` de un escaneo **completo** de esa cuenta y automatización; si un solo ID falla, se rechaza toda la solicitud.
3. **Privado primero, público después.** La respuesta pública se programa cuando la privada fue **aceptada** (`SENT` con ID de mensaje), en la misma transacción. El resultado de la respuesta pública no cambia el estado de la privada ni la reenvía.
4. **Una respuesta privada por comentario.** Índices únicos en `queue_items` (`account_id, comment_id`).
5. **Intención antes del POST (idempotencia).** Antes de cada envío se relee y revalida el comentario y, después, se confirma en la base una intención inmutable (`intent_recorded`, estado `SENDING`); solo entonces se hace el POST. Las tablas de intentos (`send_attempts`, `public_reply_attempts`) son de solo inserción (triggers que bloquean UPDATE y DELETE).
6. **`UNKNOWN_OUTCOME` queda para una persona.** Un resultado ambiguo (timeout, error de red, 5xx, respuesta sin ID, reinicio con un envío en curso) se queda así hasta que una persona lo resuelva. El código no lo reintenta solo.
7. **Todo está acotado por cuenta.** Cada consulta y cada endpoint que actúa sobre una cola, automatización o publicación comprueba que pertenece a la cuenta indicada (`accountId`).
8. **Los secretos van cifrados.** Los tokens se guardan cifrados y no aparecen en DTOs, respuestas de la API, registros, errores ni eventos. Las respuestas usan listas de campos permitidos; `redactSecrets` limpia cualquier texto que pueda contener un token. `vault.key` cifra las credenciales ya guardadas.
9. **Solo local.** El servidor escucha en `127.0.0.1`, rechaza hosts distintos de `127.0.0.1`/`localhost` (421) y exige mismo origen + token CSRF + JSON en las escrituras.
10. **Migraciones hacia adelante.** Cada migración nueva usa el `PRAGMA user_version` siguiente. Las bases con versión mayor a la soportada se rechazan.
11. **Ventanas de Meta.** Respuesta privada: menos de 7 días desde el comentario (límite conservador). Respuesta pública: dentro de las 24 horas posteriores a la privada aceptada. (El recurso del follow gate, hoy retirado, tampoco se pudo enviar dentro de esas 24 horas: ver el punto 16.)
12. **Follow gate: el recurso se envía como máximo una vez por sesión.** Transiciones con estado esperado, intención durable (`resource_intent_recorded`, estado `RESOURCE_SENDING`) antes del POST, a lo sumo un evento `resource_accepted` por sesión (índice único) y `gate_events` de solo inserción. Un resultado ambiguo queda `UNKNOWN_OUTCOME`; solo el límite de uso de Meta (429 / códigos 4, 17, 32, 613) reintenta el envío, como máximo 3 veces y dentro de la ventana. La sesión se crea en la misma transacción que marca `SENT` el primer mensaje; en Dry Run no hay sesiones ni llamadas.
13. **El follow gate no comprueba el seguimiento.** Meta no permite comprobarlo (error 230 «User consent is required»). El toque del botón es lo único que se detecta.
14. **Adjunto del recurso: cada parte se envía como máximo una vez.** Una sesión con adjunto envía primero el adjunto y luego (≥ 1 s después) el texto con botones; cada parte tiene su intención durable antes del POST y a lo sumo un `accepted` en `gate_part_events` (solo inserción, índice único). Un adjunto aceptado u omitido no se reenvía (ni si el texto falla); un adjunto con resultado ambiguo deja la sesión `UNKNOWN_OUTCOME` y el texto no se envía; un adjunto rechazado se omite y el texto sí se envía (`attachment_failed`). Las sesiones sin adjunto no cambian. La aplicación no descarga la URL del adjunto.
15. **Botones interactivos experimentales retirados.** La API rechaza `interactiveMode` distinto de `none` (o títulos) con `interactive_mode_retired`, el encolado ignora un modo heredado y la cola omite (`SKIPPED`) un payload congelado con respuestas rápidas o con botones postback fuera del follow gate. Esos botones no hacen nada al tocarlos.
16. **«Pedir que me sigan» y el adjunto del recurso están retirados.** Con esta aplicación (solo sondeo), Meta rechazó en vivo el envío posterior al toque (HTTP 403, código 10, subcódigo 2534022, «outside of allowed window»): quien tocaba el botón no recibía nada. Un único interruptor, `FOLLOW_GATE_AVAILABLE = false` en `src/services/follow-gate-rules.ts`, apaga todo: la API rechaza la opción (`follow_gate_retired`) y los adjuntos (`attachment_retired`) y un `PUT` limpia lo guardado; el encolado ignora filas con la opción o un adjunto (mensaje normal, sin sesión); la cola omite (`SKIPPED`, `follow_gate_retired`) un payload congelado con la opción antes de llamar al proveedor; el motor cancela (`CANCELLED`, `follow_gate_retired`) las sesiones `AWAITING_TAP` sin llamar a Meta y no toca las cerradas; la interfaz no muestra la opción. La opción `followGateAvailable` de los servicios existe para las pruebas del código inactivo. Los puntos 12-14 describen ese código inactivo.
17. **Adopción de cuentas huérfanas.** Una cuenta que ya existe bajo otra conexión pasa a una conexión nueva si la dueña actual está `disconnected` (incluye las eliminadas) y la coincidencia es única; con dueña activa o coincidencia ambigua se rechaza. Seleccionar sin `confirmed: true` responde `account_adoption_required` y no cambia nada. La adopción actualiza `connection_id` y los datos de descubrimiento en una transacción; conserva `account_id`, historial, cola y automatizaciones, y no requiere migración.
18. **Páginas de Facebook.** La constante `FACEBOOK_PAGES_AVAILABLE = false` está en `src/services/facebook-pages-rules.ts`. El interruptor es la variable de entorno EXPERIMENTAL `SOCIAL_DESK_FACEBOOK_PAGES` (`1`/`true`), que `loadConfig` convierte en `facebookPages` y `server.ts` pasa a los servicios como la opción `facebookPagesAvailable` (las pruebas la usan igual). Apagada por defecto: sin la variable (o con cualquier otro valor), el proveedor, el escáner, el Monitoreo, la cola y `listMedia` responden `platform_not_supported` ante una cuenta con `platform = 'facebook'` y la cola no la procesa. El `normalized_username` de una Página va con espacio de nombres (`facebook:<ID de la Página>`) para no colisionar con Instagram. Ningún endpoint de Instagram se ejecuta contra una Página, con la variable encendida o apagada. La interfaz muestra la plataforma de cada cuenta, deshabilita la respuesta pública y la Moderación para Facebook y no ofrece «Verificar lectura» para sus mensajes: Meta no permite esa verificación.
19. **Motor de comentarios de Páginas.** Lectura de publicaciones (`/{page-id}/feed`) y comentarios (`filter=stream`), respuesta privada por `POST /{page-id}/messages` con `recipient.comment_id` (JSON, token solo en la cabecera `Authorization`). Los comentarios de personas sin rol en la app llegan **sin `from`**: no hay autor ni usuario, y `{{username}}` se renderiza vacío y ordenado («Hola {{username}}, gracias» → «Hola, gracias»). La Página es el autor cuyo `from.id` es el ID de la Página (su comentario raíz no es elegible; su respuesta en el hilo, o `can_reply_privately: false`, marca el comentario como ya respondido y se omite sin intención ni POST). Los botones URL se envían como líneas de texto `<título>: <https url>`. La confirmación de Facebook es la aceptación de Meta con `message_id`; se registra un evento `readback` con `readback_not_available_facebook` y `verifyReadback` responde `readback_not_available_for_platform`. Ocultar, borrar y la respuesta pública se rechazan con `platform_feature_not_supported` (la respuesta pública pasa a `SKIPPED`). Los puntos 3-6 siguen igual (un `UNKNOWN_OUTCOME` no se reintenta; un 190 invalida la conexión).

## Pruebas

- Las pruebas viven en `tests/` junto al cambio de comportamiento. Usan bases de datos temporales y proveedores simulados.
- El comportamiento por sistema operativo se prueba con una sonda simulada (`tests/application-lock-platform.test.ts`): macOS y Windows nativo no están verificados en un equipo real. Las comparaciones de rutas usan `path.join`/`resolve`.
- `tests/server.test.ts` levanta el servidor en **modo desarrollo** en un puerto libre aleatorio. Si hay un `npm run dev` corriendo en la misma carpeta, Next.js lo rechaza (`Another next dev server is already running in this directory.`).
- Si cambias la interfaz, las capturas del manual se regeneran con `node docs/manual/tools/capture.mjs` (ver [docs/manual/tools/README.md](docs/manual/tools/README.md)), que necesita una compilación al día.

## Tutorial integrado

- El contenido del tutorial son **datos en español** en `app/tutorial/content.ts`.
- Los enlaces https salen de `ALLOWED_LINK_HOSTS`, `VERIFIED_STATIC_URLS` (raíces estables y páginas canónicas `/documentation/…`) o `DEEP_LINK_PATTERNS` (enlaces con `{APP_ID}` observados en vivo; se activan con el campo opcional «Tu ID de app», 8-20 dígitos). Lo no confirmado (roles, secreto de la app) va en texto «por verificar» con `verified: false`.
- Los prompts de ayuda los genera `buildHelpPrompt` (`app/tutorial/prompt.ts`) a partir de los datos del paso, con marcadores `[REEMPLAZA: …]`. Los pasos que ocurren dentro del programa dicen «mi programa local» y describen sus etiquetas; `tests/tutorial-prompt.test.ts` lo comprueba. Marcadores de ejemplo: `TU_TOKEN`, `ID_DE_TU_APP`, `@tu_cuenta`.
- Imágenes: los pasos de dentro del programa usan capturas (`public/tutorial/<plataforma>/<paso>.png`) generadas con `node docs/manual/tools/capture-tutorial.mjs` sobre el servidor demo (datos ficticios, proveedor falso, sin red, puerto aleatorio distinto de 3000 y 3100, datos bajo `/tmp`) y con llamadas numeradas; la interfaz las rotula «Captura de ejemplo con datos ficticios de tu programa». Los pasos del panel de Meta y los informativos usan esquemas SVG en `public/tutorial/<plataforma>/<paso>.svg` («Esquema ilustrativo»; «Esquema por verificar» si la pantalla no se observó).

## Documentación

El comportamiento visible y los datos técnicos (puerto, variables, estados, cadencias, esquema) están en [README.md](README.md), [docs/REFERENCIA-TECNICA.md](docs/REFERENCIA-TECNICA.md) y, si afecta la instalación, [docs/INSTALACION-CON-IA.md](docs/INSTALACION-CON-IA.md). La documentación está en español; los identificadores de código se mantienen en inglés.
