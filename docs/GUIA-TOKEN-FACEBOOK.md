# Guía del token de Facebook (Páginas) — EXPERIMENTAL

Esta guía explica cómo conseguir el token que Social Desk necesita para responder por mensaje privado a los comentarios de una **Página de Facebook**. Sigue la misma lógica que el capítulo 5 del [manual de usuario](manual/Manual-Social-Desk.pdf) («Conseguir el acceso con Facebook»), pero pensada para Páginas.

> **Experimental y apagado por defecto.** La compatibilidad con Páginas de Facebook solo aparece si inicias la aplicación con `SOCIAL_DESK_FACEBOOK_PAGES=1` (ver [README](../README.md#variables-de-entorno)). Sin esa variable, «Probar y descubrir» solo lista cuentas de Instagram, exactamente como antes. Lee antes la sección [Qué está verificado y qué no](#qué-está-verificado-y-qué-no).

## Contenido

1. [Objetivo](#objetivo)
2. [Requisitos](#requisitos)
3. [Permisos](#permisos)
4. [Obtener el token con el Explorador de la API Graph](#obtener-el-token-con-el-explorador-de-la-api-graph)
5. [Convertirlo en un token de larga duración](#convertirlo-en-un-token-de-larga-duración)
6. [Pegarlo en Social Desk](#pegarlo-en-social-desk)
7. [Límites conocidos](#límites-conocidos)
8. [Qué está verificado y qué no](#qué-está-verificado-y-qué-no)
9. [Prompt para pegar a tu IA](#prompt-para-pegar-a-tu-ia)
10. [Fuentes oficiales](#fuentes-oficiales)

## Objetivo

Obtener un **token de usuario de Facebook** con los permisos de Página necesarios. Social Desk lo guarda cifrado, usa `/me/accounts` para encontrar tus Páginas (y las cuentas de Instagram vinculadas) y, al seleccionar una Página, guarda también el token de esa Página, cifrado. Con él lee las publicaciones y los comentarios de la Página y envía una **respuesta privada** al comentario.

En esta guía el token se representa como `TU_TOKEN`. **Nunca lo pegues en un chat**, ni en un correo, ni en un repositorio.

## Requisitos

- Una **Página de Facebook sobre la que tengas control total**, o al menos las tareas **Mensajes** (`MESSAGING`) y **Moderar** (`MODERATE`) sobre ella.
- Una **cuenta de desarrollador de Meta** y una **app de Meta** con la configuración básica completa (capítulo 4, paso A y B del manual).
- En la app, estos casos de uso:
  - **Administrar todos los aspectos de tu página**.
  - **Interactuar con los clientes en Messenger from Meta**.
- Tu usuario de Facebook debe poder realizar esas tareas en la Página.

## Permisos

También puedes consultar qué hace cada permiso (y cuáles usa NaniChat) en Conexiones, en la tarjeta plegable «Permisos de Facebook: qué hace cada uno». Es solo informativa.

**Obligatorios** (la aplicación los usa hoy):

| Permiso | Para qué sirve |
| --- | --- |
| `pages_show_list` | Listar tus Páginas (descubrimiento con `/me/accounts`). |
| `pages_read_engagement` | Leer las publicaciones y los comentarios de la Página. |
| `pages_read_user_content` | Leer los comentarios que escriben otras personas en la Página. |
| `pages_messaging` | Enviar la respuesta privada al comentario. |

**Opcionales o aún sin uso** (no los necesitas ahora):

| Permiso | Nota |
| --- | --- |
| `instagram_basic` | Solo si además quieres encontrar la cuenta de Instagram vinculada a la Página (permite leer el nodo de Instagram). NaniChat consulta esa cuenta pidiendo solo `id,username`: el campo `account_type` no existe en `graph.facebook.com` y pedirlo hacía fallar el descubrimiento (error corregido). Sin él, NaniChat muestra solo la Página: si Meta rechaza el listado con el campo de Instagram (error 100), la aplicación repite una sola vez la consulta sin ese campo. Si el token no tiene este permiso y Meta rechaza la consulta de la cuenta de Instagram vinculada (error 100, 10 o 200), NaniChat omite solo esa cuenta de Instagram y ofrece igualmente la Página. Comportamiento por verificar con una Página real. |
| `pages_manage_engagement` | Reservado para la futura respuesta pública. Hoy no se usa. |
| `pages_manage_metadata` | No se usa. |
| `business_management` | No se usa. Solo podría hacer falta si tu rol en la Página se otorgó mediante un Business Manager. |

> **Verifica en la documentación oficial.** Los nombres y requisitos de permisos los define Meta y cambian. Si Meta rechaza una acción por permisos, la aplicación lo muestra como `facebook_permission_denied`; revisa entonces que el token tenga los cuatro permisos obligatorios y que tengas control sobre la Página.

## Obtener el token con el Explorador de la API Graph

1. Abre el [Explorador de la API Graph](https://developers.facebook.com/tools/explorer/) con tu usuario de Facebook.
2. En el selector de **Aplicación de Meta**, elige tu app.
3. En **Permisos**, añade los cuatro obligatorios: `pages_show_list`, `pages_read_engagement`, `pages_read_user_content` y `pages_messaging`.
4. Revisa el selector **Usuario o página** y elige **Token del usuario** (obtener token de acceso de usuario). Si queda seleccionada una Página, el token que obtengas será el de esa Página.
5. Pulsa **Generate Access Token** (Generar token de acceso).
6. En el cuadro de diálogo de Facebook, **acepta los permisos y elige la Página** (o las Páginas) que quieres autorizar. Si no marcas la Página, no aparecerá al descubrir cuentas.
7. Copia el token del campo de token de acceso. **No lo pegues en ningún chat.**

**Dos tipos de token válidos.** NaniChat acepta **cualquiera** de estos:

- **Token de usuario** (recomendado): NaniChat encuentra por sí mismo todas tus Páginas con `/me/accounts`.
- **Token de una Página** directamente: si `/me/accounts` falla con el código 100, NaniChat asume que pegaste el token de una Página y la conecta usándolo; solo aparece esa Página (sin cuentas de Instagram vinculadas). El token de Página que da el Explorador es de **corta duración**, salvo que lo canjees por uno largo. *Este modo está **por verificar con una Página real**.*

Comprobación opcional en el propio Explorador: la consulta `me/accounts` debe devolver tu Página. Social Desk hace esa misma consulta por ti en «Probar y descubrir».

## Convertirlo en un token de larga duración

El token que genera el Explorador es de **corta duración** (horas). Para no repetir el proceso a cada rato, Meta permite canjearlo por uno de larga duración (unos 60 días). El punto de acceso documentado es:

```text
GET https://graph.facebook.com/{versión}/oauth/access_token
    ?grant_type=fb_exchange_token
    &client_id={ID_DE_TU_APP}
    &client_secret={SECRETO_DE_TU_APP}
    &fb_exchange_token={TU_TOKEN_CORTO}
```

> **Seguridad.** Esta llamada necesita el **secreto de la app**. **Nunca lo compartas** (ni con una IA, ni en un chat, ni en un repositorio) y ejecútala **solo en tu propio equipo**. Social Desk nunca te pedirá el secreto de la app. Si no te sientes cómodo, pídele ayuda a una persona técnica de confianza.

Con el [Depurador de tokens de acceso](https://developers.facebook.com/tools/debug/accesstoken/) puedes comprobar cuándo vence un token y qué permisos tiene, antes de pegarlo en la aplicación. Cuando venza (o Meta lo invalide, `facebook_token_invalid`), repite el proceso y actualiza la conexión.

## Pegarlo en Social Desk

1. Inicia la aplicación con `SOCIAL_DESK_FACEBOOK_PAGES=1` (por ejemplo, en PowerShell: `$env:SOCIAL_DESK_FACEBOOK_PAGES = "1"; npm start`).
2. En **Conexiones > Nueva conexión**, elige **Facebook Login · token de usuario y página vinculada**, escribe un nombre y pega el token en el campo oculto. Guarda la conexión.
3. Pulsa **Probar y descubrir**. Verás tus Páginas (con la insignia «Facebook») y, si las hay, las cuentas de Instagram vinculadas.
4. Pulsa **Seleccionar** en la Página que quieres administrar.
5. Crea una automatización para esa Página como siempre. Empieza en **Dry Run**: nada se envía hasta que lo autorices explícitamente.

## Límites conocidos

- **Comentarios de personas sin rol en tu app:** Meta los entrega **sin autor**. La variable `{{username}}` se reemplaza por un saludo limpio (sin nombre).
- **Botones de enlace:** en Facebook se envían como **texto simple** (título y dirección en líneas del mensaje).
- **Sin respuesta pública, sin moderación y sin ocultar/borrar** para Páginas todavía: la aplicación lo rechaza con `platform_feature_not_supported` y la interfaz lo indica.
- **Sin lectura verificada del mensaje:** Meta no ofrece una forma verificada de leer el mensaje enviado. La interfaz dice «Facebook no permite verificar el mensaje enviado; se confirma con la respuesta de Meta». Nunca se muestra como verificado.
- **Una respuesta privada por persona**, según Meta.
- **Ventana de 7 días** desde el comentario; después el elemento expira.
- **Otra automatización compite por la única respuesta privada.** Si otra herramienta (por ejemplo, Meta Business Suite) responde a los mismos comentarios, la que llegue primero consume la única respuesta privada. **Desactívala antes** de usar Social Desk en esa Página.
- **Resultado dudoso (`UNKNOWN_OUTCOME`):** nunca se reintenta automáticamente; lo resuelves tú a mano.

## Qué está verificado y qué no

| Función | Estado |
| --- | --- |
| Leer publicaciones y comentarios con el token de Página, incluidos los comentarios de personas sin rol (llegan **sin** `from`) | **Verificado en vivo** (2026-10-14) |
| Respuesta privada a una persona sin rol: aceptada por Meta y **entregada**, con la app en modo Live y los permisos de página en «Listo para la prueba» | **Verificado en vivo** (2026-10-14) |
| Botones de enlace | **No verificado** (por eso van como texto) |
| Lectura del mensaje enviado (readback) | **No verificado** (no se afirma) |
| Respuesta pública | **No verificado** (no disponible) |
| Ocultar o borrar comentarios | **No verificado** (no disponible) |
| Segundo comentario de la misma persona | **No verificado** |
| Webhooks | **No verificado** (la aplicación solo sondea) |
| Límites de uso (rate limits) | **No verificado** |

## Prompt para pegar a tu IA

Copia este bloque en tu asistente para que te acompañe **paso a paso**:

```text
Quiero conseguir el token de Facebook para usar una Página con Social Desk (función experimental).

Lee completa la guía docs/GUIA-TOKEN-FACEBOOK.md del repositorio de Social Desk antes de ayudarme y úsala como única fuente, junto con la documentación oficial de Meta.

Reglas:
1. Guíame UN solo paso a la vez. Espera a que te diga que lo terminé antes de dar el siguiente.
2. Nunca me pidas el token, el secreto de la app, contraseñas ni códigos de verificación en el chat. Si los escribo por error, dime que los ignoras y que debo revocarlos o regenerarlos.
3. No me pidas que pegue el token en ningún sitio que no sea el campo oculto de «Conexiones» de Social Desk.
4. Si no estás seguro de un nombre de permiso, un botón o un punto de acceso de Meta, verifícalo en la documentación oficial de Meta antes de decírmelo y dime cuando algo no pudo verificarse.
5. El canje por un token de larga duración usa el secreto de mi app: explícame cómo hacerlo en mi propio equipo sin compartirlo, o dime que se lo pida a una persona técnica de confianza.
6. No actives el modo real ni autorices envíos reales: todo empieza en Dry Run.

Empecemos: pregúntame primero si ya tengo la app de Meta creada y si tengo control total de la Página.
```

## Fuentes oficiales

- Explorador de la API Graph: [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer/)
- Depurador de tokens de acceso: [developers.facebook.com/tools/debug/accesstoken](https://developers.facebook.com/tools/debug/accesstoken/)
- Respuestas privadas (Messenger Platform): [developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/private-replies](https://developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/private-replies)
- Permisos y funciones de las apps de Meta: [developers.facebook.com/documentation/development/permissions](https://developers.facebook.com/documentation/development/permissions)
- Tokens de acceso de larga duración: [developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived)

## Cambiar de tipo de token

No edites una conexión para cambiar entre un token de Página y uno de usuario: la validación falla con «Este token pertenece a otra identidad». Elimina la conexión y crea una nueva con el token correcto.
