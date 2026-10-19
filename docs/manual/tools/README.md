# Herramientas de demostración del manual

Regeneran las 21 capturas de `docs/manual/images/` a partir de una instancia **DEMO** desechable con datos 100 % ficticios (proveedor falso, sin red, sin datos reales).

```bash
node docs/manual/tools/capture.mjs
```

Requisitos: Node 24 (≥ 24.21.0), una compilación al día en `.next` (`npm run build`) y Google Chrome en `/usr/bin/google-chrome` (cámbialo con `CHROME_BIN=/ruta/al/navegador`). Tarda alrededor de un minuto. Agrega `CAPTURE_DEBUG=1` para ver los registros del servidor.

## Qué hace

1. Crea carpetas de datos temporales en `/tmp` e inicia `demo-server.ts` en el puerto **3100** (modo producción; reutiliza la compilación de `.next` existente y nunca ejecuta `next build`).
2. **Fase A** (base vacía): recorre la interfaz real en el primer uso: conexión, descubrimiento y selección de cuenta (capturas 01–04).
3. **Fase B:** `seed-demo.ts` llena una segunda carpeta temporal (conexión, 60 comentarios, automatizaciones, cola con estados variados y un escaneo completo), el servidor se reinicia sobre ella y se captura el resto (05–21), incluido el paso a modo real y la vuelta a Dry Run.
4. Detiene solo los procesos que inició y borra las carpetas temporales y el perfil de Chrome.

## Capturas del tutorial integrado

```bash
node docs/manual/tools/capture-tutorial.mjs
```

Regenera **solo** las 5 capturas reales de `public/tutorial/` (`instagram/pegar-token`, `instagram/probar-descubrir`, `instagram/comprobar-revision`, `facebook/pegar-token`, `facebook/probar-seleccionar`; `.png`). Mismos requisitos que arriba (Node 24, `.next` al día, Chrome). Usa un **puerto libre aleatorio** (nunca 3000 ni 3100), carpetas de datos en `/tmp` y el servidor demo con datos ficticios; las Páginas de Facebook vienen habilitadas por defecto, así que la fase de Instagram inicia el demo con `SOCIAL_DESK_FACEBOOK_PAGES=0` y la de Facebook lo deja habilitado (`=1`) para descubrir una Página y una cuenta de Instagram ficticias («Tu Página de ejemplo», `@tu_cuenta`). Antes de cada captura dibuja en la página llamadas numeradas (contorno naranja y número) sobre el control exacto, sin cambiar ningún dato, y recorta la región relevante. Al terminar detiene sus procesos y borra carpetas temporales y el perfil de Chrome. `capture-guards.mjs` rechaza puertos reservados, carpetas fuera de `/tmp` y cualquier ruta de salida distinta de `public/tutorial/<plataforma>/<paso>.png`. Si cambia la numeración o el texto de una captura, actualiza también el pie y el texto alternativo en `app/tutorial/content.ts`. Los esquemas SVG (panel de Meta y pasos informativos) se dibujan a mano y no se regeneran con esta herramienta.

## Archivos

| Archivo | Función |
| --- | --- |
| `demo-provider.ts` | Proveedor falso; nunca toca la red. Con `facebookDiscovery` (solo el demo con las Páginas habilitadas, es decir, sin `SOCIAL_DESK_FACEBOOK_PAGES=0`) descubre además una Página y una cuenta de Instagram ficticias. |
| `demo-server.ts` | Copia de `server.ts` conectada al proveedor falso, con la importación de `.env` y la retención heredada desactivadas (como en una instalación por defecto). Se niega a arrancar si `LOCAL_SOCIAL_DATA_DIR` no está bajo `/tmp` y rechaza el puerto 3000. |
| `seed-demo.ts` | Carga los datos ficticios de la fase B. |
| `capture-tutorial.mjs` / `capture-guards.mjs` | Capturas del tutorial integrado (puerto aleatorio, solo `/tmp`) y sus guardas de seguridad. |
| `capture.mjs` | Orquesta el servidor demo y Chrome sin cabeza (protocolo DevTools) y guarda las capturas. |

> **Importante:** nunca apuntes estas herramientas a `./data` ni al puerto 3000. Si cambia la interfaz, vuelve a compilar la aplicación (`npm run build`, en una carpeta donde no corra la instancia real o a cargo de la persona dueña) y repite la captura.

## Generar el PDF

Después de regenerar las capturas, vuelve a generar el manual en PDF desde `docs/manual/manual.html`:

```bash
bash docs/manual/build-pdf.sh
```

El script usa Google Chrome sin cabeza (`CHROME=/ruta/al/navegador` para otro) y escribe `docs/manual/Manual-Social-Desk.pdf`; acepta opcionalmente otra ruta de salida como primer argumento.
