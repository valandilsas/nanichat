/**
 * Tutorial content (Spanish data). Edit steps here; nothing else needs to change.
 * Rules (see AGENTS.md): official https links only (host allowlist below), never real data, tokens or ids,
 * and `verified: false` for anything not backed by the repository docs (docs/GUIA-TOKEN-FACEBOOK.md, the manual)
 * or by a live observation. Links come ONLY from VERIFIED_STATIC_URLS (stable roots and canonical /documentation/
 * pages) and DEEP_LINK_PATTERNS (App-ID deep links observed working); never invent other URLs.
 * Help prompts are generated from this data by prompt.ts and never name this program.
 */
export type TutorialPlatformId = 'instagram' | 'facebook';

/** `url` may contain the `{APP_ID}` placeholder (only the DEEP_LINK_PATTERNS); it is filled with the person's App ID. */
export type TutorialLink = { label: string; url: string };
export const APP_ID_PLACEHOLDER = '{APP_ID}';
export type TutorialScreenshot = {
  /**
   * Path under public/ served by Next, `/tutorial/<platform>/<step-id>.svg` for an original schematic
   * (or .png/.jpg/.webp for a real screenshot, only after redaction and human approval); absent while pending.
   */
  file?: string;
  alt: string;
  caption: string;
  /** true exactly when there is no `file` yet ("Captura pendiente"). */
  pending: boolean;
};
export type TutorialStep = {
  id: string;
  title: string;
  summary: string;
  whyItMatters: string;
  instructions: string[];
  links: TutorialLink[];
  notes: string[];
  expectedResult: string;
  screenshot: TutorialScreenshot;
  /** What the person wants to achieve in this step, as an infinitive phrase (feeds the generated help prompt). */
  goal: string;
  /** true when the step happens inside the person's own local program instead of the Meta site. */
  local?: true;
  /** Where inside the local program the step happens (default: the «Conexiones» tab); only used with `local`. */
  localWhere?: string;
  /** Optional extra sentence for the generated help prompt. */
  helpFocus?: string;
  /** false = the from-zero details are not covered by the repository docs yet ("Paso por verificar"). */
  verified: boolean;
  /** Honest note shown with the "Paso por verificar" badge. */
  verifyNote?: string;
};

export type TutorialPlatformContent = { id: TutorialPlatformId; label: string; steps: TutorialStep[] };

export const ALLOWED_LINK_HOSTS: ReadonlyArray<string> = [
  'developers.facebook.com', 'business.facebook.com', 'www.facebook.com', 'www.instagram.com', 'help.instagram.com', 'about.meta.com',
];

/** Every non-templated link must be one of these (live-checked 2026-10-14/15: stable roots and canonical documentation). */
export const VERIFIED_STATIC_URLS: ReadonlyArray<string> = [
  'https://developers.facebook.com/apps/',
  'https://developers.facebook.com/tools/explorer/',
  'https://developers.facebook.com/tools/debug/accesstoken/',
  'https://business.facebook.com/settings',
  'https://developers.facebook.com/docs/graph-api/guides/explorer',
  'https://help.instagram.com/502981923235522',
  'https://www.facebook.com/business/help/connect-instagram-to-page',
  'https://developers.facebook.com/documentation/development/register',
  'https://developers.facebook.com/documentation/development/create-an-app',
  'https://developers.facebook.com/documentation/development/build-and-test/app-roles',
  'https://developers.facebook.com/documentation/development/build-and-test/app-modes',
  'https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived',
  'https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/',
  'https://developers.facebook.com/documentation/instagram-platform/private-replies',
  'https://developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/private-replies',
  'https://developers.facebook.com/documentation/development/permissions',
];

/** App-ID deep links observed working in the Spanish panel (2026-10-14/15). No other pattern may be used. */
export const DEEP_LINK_PATTERNS: ReadonlyArray<string> = [
  'https://developers.facebook.com/apps/{APP_ID}/dashboard/',
  'https://developers.facebook.com/apps/{APP_ID}/use_cases/',
  'https://developers.facebook.com/apps/{APP_ID}/use_cases/customize/?use_case_enum=PAGES_API&selected_tab=permissions&product_route=use_cases',
  'https://developers.facebook.com/apps/{APP_ID}/use_cases/customize/?use_case_enum=FACEBOOK_MESSAGING&selected_tab=permissions&product_route=use_cases',
];

export const SAFETY_RULES: ReadonlyArray<string> = [
  'Nunca me pidas ni aceptes tokens, secretos de la app, contraseñas ni códigos de verificación en este chat. Si los escribo por error, dime que los ignoras y que debo ocultarlos y regenerarlos.',
  'Si no estás seguro de un nombre de botón, permiso o pantalla de Meta, verifícalo en la documentación oficial de Meta y dime cuando algo no pudo verificarse.',
  'Guíame un solo paso a la vez y espera a que te diga que lo terminé antes de dar el siguiente.',
];

export const PLACEHOLDER_NOTE = 'Antes de pegar el prompt, reemplaza cada texto [REEMPLAZA: …] por tu información. Nunca pegues tokens, secretos de la app ni contraseñas.';

const pending = (alt: string, caption: string): TutorialScreenshot => ({ alt, caption, pending: true });
/** Original schematic at public/tutorial/<platform>/<step-id>.svg (not a real screenshot). */
const schematic = (platform: TutorialPlatformId, id: string, alt: string, caption: string): TutorialScreenshot => ({ file: `/tutorial/${platform}/${id}.svg`, alt, caption, pending: false });
const GRAPH_EXPLORER: TutorialLink = { label: 'Explorador de la API Graph', url: 'https://developers.facebook.com/tools/explorer/' };
const APPS_PANEL: TutorialLink = { label: 'Panel de apps de Meta', url: 'https://developers.facebook.com/apps/' };
const TOKEN_DEBUGGER: TutorialLink = { label: 'Revisa tu token: Depurador de tokens de acceso', url: 'https://developers.facebook.com/tools/debug/accesstoken/' };
const EXPLORER_DOC: TutorialLink = { label: 'Guía de Meta: Explorador de la API Graph', url: 'https://developers.facebook.com/docs/graph-api/guides/explorer' };
const REGISTER_DOC: TutorialLink = { label: 'Guía de Meta: registrarse como desarrollador', url: 'https://developers.facebook.com/documentation/development/register' };
const CREATE_APP_DOC: TutorialLink = { label: 'Guía de Meta: crear una app', url: 'https://developers.facebook.com/documentation/development/create-an-app' };
const ROLES_DOC: TutorialLink = { label: 'Guía de Meta: roles de la app', url: 'https://developers.facebook.com/documentation/development/build-and-test/app-roles' };
const MODES_DOC: TutorialLink = { label: 'Guía de Meta: modos de la app', url: 'https://developers.facebook.com/documentation/development/build-and-test/app-modes' };
const IG_LOGIN_DOC: TutorialLink = { label: 'Documentación de Instagram API con Instagram Login', url: 'https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/' };
const IG_PRIVATE_REPLIES: TutorialLink = { label: 'Guía de Meta: respuestas privadas de Instagram', url: 'https://developers.facebook.com/documentation/instagram-platform/private-replies' };
const FB_PRIVATE_REPLIES: TutorialLink = { label: 'Guía de Meta: respuestas privadas de Messenger', url: 'https://developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/private-replies' };
const LONG_LIVED_DOC: TutorialLink = { label: 'Guía de Meta: tokens de larga duración', url: 'https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived' };
const PERMISSIONS_DOC: TutorialLink = { label: 'Guía de Meta: permisos', url: 'https://developers.facebook.com/documentation/development/permissions' };
const PORTFOLIO_LINK: TutorialLink = { label: 'Configuración comercial de Meta', url: 'https://business.facebook.com/settings' };
const IG_PRO_HELP: TutorialLink = { label: 'Ayuda de Instagram: cuenta profesional (por verificar el menú)', url: 'https://help.instagram.com/502981923235522' };
const FB_CONNECT_HELP: TutorialLink = { label: 'Ayuda de Facebook: conectar Instagram a una Página (por verificar el menú)', url: 'https://www.facebook.com/business/help/connect-instagram-to-page' };
// Deep links into the person's own app (need the «Tu ID de app» field).
const APP_DASHBOARD: TutorialLink = { label: 'Panel de tu app', url: 'https://developers.facebook.com/apps/{APP_ID}/dashboard/' };
const APP_USE_CASES: TutorialLink = { label: 'Casos de uso de tu app', url: 'https://developers.facebook.com/apps/{APP_ID}/use_cases/' };
const PAGES_PERMISSIONS: TutorialLink = { label: 'Permisos del caso de uso de Páginas', url: 'https://developers.facebook.com/apps/{APP_ID}/use_cases/customize/?use_case_enum=PAGES_API&selected_tab=permissions&product_route=use_cases' };
const MESSENGER_PERMISSIONS: TutorialLink = { label: 'Permisos del caso de uso de Messenger', url: 'https://developers.facebook.com/apps/{APP_ID}/use_cases/customize/?use_case_enum=FACEBOOK_MESSAGING&selected_tab=permissions&product_route=use_cases' };

const SCHEMATIC_VERIFY = 'Paso por verificar: ';
const PORTFOLIO_NOTES = [
  'El portafolio comercial es opcional para empezar. La documentación de Meta no lo menciona como requisito del inicio de sesión de Instagram ni de los permisos de Páginas, y al crear la app puedes omitirlo o crearlo y vincularlo más tarde.',
  'Pasa a ser obligatorio cuando atiendes cuentas que no son tuyas (acceso avanzado: revisión de la app y Verificación de Empresa) o cuando usas el permiso business_management.',
  'Con tus propias cuentas y acceso estándar no debería hacer falta, pero confírmalo en tu panel real: esta parte es una inferencia, no una cita de Meta.',
];

const confirmAccountNotes = [
  'No uses scripts, extensiones ni herramientas automáticas en las páginas de Meta para desarrolladores: el uso intensivo o automatizado puede provocar este aviso.',
  'Este programa nunca te pedirá tu contraseña ni los códigos de verificación de Meta.',
];

type Draft = Omit<TutorialStep, 'verified'> & { verified?: boolean };

function build(drafts: Draft[]): TutorialStep[] {
  return drafts.map((draft) => ({ ...draft, verified: draft.verified ?? true }));
}

const APP_ID_INSTRUCTION = 'Mira la dirección de la página en la que estás: developers.facebook.com/apps/NÚMERO/… Ese NÚMERO es el ID de tu app (no es un secreto). Cópialo y pégalo en «Tu ID de app», arriba en este tutorial, para activar los enlaces directos a tu app.';

const developerAccountSteps = (platform: TutorialPlatformId): Draft => ({
  id: 'cuenta-desarrollador', title: 'Crea tu cuenta de desarrollador de Meta',
  summary: 'Registra tu cuenta de Facebook como cuenta de desarrollador de Meta. Es lo que te permite crear apps y generar tokens.',
  whyItMatters: 'Meta solo permite crear apps a cuentas registradas como desarrolladoras. Para tener el rol de administrador o desarrollador de una app hace falta esta cuenta; las personas probadoras no la necesitan.',
  instructions: [
    'Inicia sesión en Facebook y abre la guía de registro de desarrolladores de Meta (el enlace de abajo).',
    'Acepta las Condiciones de la Plataforma.',
    'Confirma el código que Meta envía a tu teléfono y también el que envía a tu correo.',
    'Elige la ocupación que mejor te describa.',
  ],
  links: [REGISTER_DOC, APPS_PANEL],
  notes: ['No se ha confirmado si el registro tiene algún costo; revisa lo que Meta te muestre antes de aceptar.', 'Los nombres de los botones de Meta cambian con frecuencia: busca la opción equivalente.'],
  expectedResult: 'Sabrás que está bien cuando puedas abrir el panel de apps de Meta sin que te pida registrarte de nuevo.',
  screenshot: schematic(platform, 'cuenta-desarrollador', 'Esquema del registro como desarrollador de Meta en cinco pasos', 'Recorrido del registro de desarrollador (esquema por verificar).'),
  verifyNote: `${SCHEMATIC_VERIFY}el recorrido sigue la guía oficial, pero no se vio en pantalla, y el costo, si lo hay, no está confirmado.`,
  verified: false,
  goal: 'registrarme como desarrollador de Meta.',
});

const portfolioStep = (platform: TutorialPlatformId, own: string): Draft => ({
  id: 'portafolio-comercial', title: 'Portafolio comercial (opcional)',
  summary: `Meta puede preguntarte por un portafolio comercial al crear la app. Para ${own} puedes omitirlo.`,
  whyItMatters: 'Saber que es opcional evita crear estructuras comerciales que no necesitas, y saber cuándo sí es obligatorio evita sorpresas más adelante.',
  instructions: [
    `Cuando Meta pregunte por un portafolio comercial, elige omitirlo por ahora si la app es solo para ${own}.`,
    'Si más adelante Meta te lo exige, crea o vincula uno desde la configuración comercial de Meta (enlace de abajo) y vuelve a este tutorial.',
    'Será obligatorio si atiendes cuentas de otras personas (acceso avanzado) o usas el permiso business_management.',
  ],
  links: [PORTFOLIO_LINK, CREATE_APP_DOC],
  notes: PORTFOLIO_NOTES,
  expectedResult: 'Sabrás que está bien cuando puedas continuar con la creación de la app, con o sin portafolio.',
  screenshot: schematic(platform, 'portafolio-comercial', 'Esquema de la decisión sobre el portafolio comercial', 'Decisión sobre el portafolio comercial (esquema por verificar).'),
  verified: false,
  verifyNote: `${SCHEMATIC_VERIFY}confirma en tu panel real que, con tus propias cuentas y acceso estándar, el portafolio no es obligatorio.`,
  goal: 'decidir si necesito un portafolio comercial de Meta.',
});

const confirmAccountStep = (platform: TutorialPlatformId): Draft => ({
  id: 'confirmar-cuenta', title: 'Si Meta te pide confirmar tu cuenta',
  summary: 'Meta puede mostrar «Es necesario confirmar la cuenta» después de un uso intensivo o automatizado de sus páginas para desarrolladores.',
  whyItMatters: 'Hasta que confirmes la cuenta no podrás usar el panel de desarrolladores, y con él no puedes generar ni renovar tokens.',
  instructions: [
    'Si ves el aviso «Es necesario confirmar la cuenta» con el texto «Detectamos actividad inusual en esta cuenta de desarrollador», pulsa «Confirmar cuenta».',
    'Completa tú mismo los pasos de confirmación que Meta te pida.',
    'Espera un tiempo antes de volver a usar las páginas de desarrolladores, y evita recorrerlas con scripts o herramientas automáticas.',
  ],
  links: [APPS_PANEL],
  notes: confirmAccountNotes,
  expectedResult: 'Sabrás que está bien cuando el panel de apps de Meta vuelva a abrirse sin el aviso de confirmación.',
  screenshot: schematic(platform, 'confirmar-cuenta', 'Esquema del aviso «Es necesario confirmar la cuenta» y el botón Confirmar cuenta', 'Aviso de Meta (texto observado en el panel).'),
  goal: 'recuperar el acceso al panel de desarrolladores de Meta cuando pide confirmar la cuenta.',
});

const instagramSteps = build([
  {
    id: 'requisitos', title: 'Revisa los requisitos',
    summary: 'Antes de empezar necesitas una cuenta profesional de Instagram (Business o Creator) y poder recibir códigos de verificación.',
    whyItMatters: 'La vía de inicio de sesión de Instagram necesita una cuenta profesional. No hace falta una Página de Facebook.',
    instructions: [
      'Confirma que tu cuenta de Instagram es profesional (Business o Creator). Si es personal, cámbiala: Perfil > menú > Configuración y actividad > «Tipo de cuenta y herramientas» > «Cambiar a cuenta profesional», elige una categoría y el tipo.',
      'En la web de Instagram el camino es similar: Más > Configuración > «Tipo de cuenta y herramientas». Si la cuenta era privada, pasará a ser pública.',
      'Ten a mano tu cuenta de Facebook, tu teléfono y tu correo: Meta enviará códigos de verificación.',
      'Alternativa (solo si prefieres el inicio de sesión de Facebook): vincula Instagram a una Página desde la Página, en Configuración y privacidad > Configuración > Cuentas vinculadas > Instagram > Conectar cuenta. Necesitas ser administrador de la Página.',
    ],
    links: [IG_PRO_HELP, FB_CONNECT_HELP],
    notes: ['Este paso no requiere ningún token.', 'Los nombres de los menús son los habituales en español, pero no se han visto en pantalla: busca la opción equivalente.'],
    expectedResult: 'Sabrás que está bien cuando tu cuenta de Instagram aparezca como profesional (Business o Creator).',
    screenshot: schematic('instagram', 'requisitos', 'Esquema del camino para cambiar la cuenta de Instagram a profesional', 'Cambio a cuenta profesional (esquema por verificar).'),
    verified: false,
    verifyNote: `${SCHEMATIC_VERIFY}la necesidad de una cuenta profesional está en la documentación de Meta, pero los menús de Instagram y de la Página son inferidos; confírmalos en tu pantalla.`,
    goal: 'comprobar que mi cuenta de Instagram es profesional y cumple los requisitos para conectarla.',
  },
  developerAccountSteps('instagram'),
  portfolioStep('instagram', 'tu propia cuenta'),
  {
    id: 'crear-app', title: 'Crea la app de Meta',
    summary: 'La app es el «registro» que Meta usa para darte permisos. No es una app que publiques.',
    whyItMatters: 'Los tokens y los permisos se generan desde una app. Los casos de uso no se pueden quitar una vez añadidos, así que conviene elegir bien. Una app nueva empieza en modo desarrollo: solo la usan personas con un rol en ella.',
    instructions: [
      'Abre el panel de apps de Meta y pulsa «Crear app» (o similar).',
      'Escribe un nombre (por ejemplo «Comentarios de @tu_cuenta») y tu correo de contacto.',
      'Elige el caso de uso para administrar mensajes y contenido en Instagram; Meta añade los permisos y productos por ti.',
      'Si Meta te pregunta por un portafolio comercial, mira el paso anterior: puedes omitirlo.',
      'Revisa el resumen y entra al panel de tu nueva app («Ir al panel»).',
      APP_ID_INSTRUCTION,
    ],
    links: [APPS_PANEL, APP_DASHBOARD, CREATE_APP_DOC, MODES_DOC],
    notes: ['Si te equivocas con el caso de uso, es más sencillo crear otra app.', 'La lista «Mis apps» y el botón «Crear app» se vieron así en el panel en español.'],
    expectedResult: 'Sabrás que está bien cuando veas el panel de tu app nueva con su nombre y hayas anotado su ID de app.',
    screenshot: schematic('instagram', 'crear-app', 'Esquema de la lista Mis apps con el botón Crear app resaltado', 'Lista de apps con «Crear app».'),
    goal: 'crear la app de Meta para conectar mi cuenta de Instagram.',
  },
  {
    id: 'caso-uso-instagram', title: 'Añade el caso de uso de Instagram',
    summary: 'Si al crear la app no elegiste el caso de uso de Instagram, añádelo desde el panel de la app.',
    whyItMatters: 'Ahí es donde Meta habilita el inicio de sesión de Instagram y el token que necesita tu programa.',
    instructions: [
      'Abre «Casos de uso» de tu app (enlace directo de abajo) y pulsa «Agregar casos de uso».',
      'En el cuadro hay una casilla por cada caso de uso: marca «Administrar mensajes y contenido en Instagram» y pulsa «Guardar».',
      'Verás ese caso de uso en «Casos de uso», con el botón «Personalizar».',
    ],
    links: [APPS_PANEL, APP_USE_CASES, IG_LOGIN_DOC],
    notes: ['Meta cambia el nombre y la ubicación de estas secciones; busca la equivalente.', 'Agregar un caso de uso no se puede deshacer.'],
    expectedResult: 'Sabrás que está bien cuando «Administrar mensajes y contenido en Instagram» aparezca en los casos de uso de tu app.',
    screenshot: schematic('instagram', 'caso-uso-instagram', 'Esquema del cuadro Agregar casos de uso con el caso de uso de Instagram marcado', 'Cuadro «Agregar casos de uso» (nombres observados en el panel).'),
    goal: 'añadir el caso de uso de Instagram a mi app de Meta.',
  },
  {
    id: 'permisos', title: 'Revisa los permisos',
    summary: 'La app necesita tres permisos de Instagram para leer comentarios y responder.',
    whyItMatters: 'Sin ellos, Meta rechazará la lectura de comentarios o el envío de mensajes.',
    instructions: [
      'En «Casos de uso» (enlace directo de abajo), pulsa «Personalizar» en el caso de uso de Instagram y abre la pestaña «Permisos y funciones»; pulsa «Agregar» en cada permiso.',
      'instagram_business_basic: leer el perfil y las publicaciones.',
      'instagram_business_manage_comments: leer comentarios y enviar respuestas privadas.',
      'instagram_business_manage_messages: mensajería de Instagram.',
      'Cada permiso añadido muestra el estado «Listo para la prueba».',
    ],
    links: [APPS_PANEL, APP_USE_CASES, IG_PRIVATE_REPLIES, PERMISSIONS_DOC],
    notes: ['La página oficial de respuestas privadas menciona solo los dos primeros; no está confirmado si el tercero es imprescindible, pero se pide igualmente y la app de este proyecto funciona con los tres.'],
    expectedResult: 'Sabrás que está bien cuando los tres permisos aparezcan como «Listo para la prueba».',
    screenshot: schematic('instagram', 'permisos', 'Esquema de la pestaña Permisos y funciones con tres permisos de Instagram', 'Permisos de Instagram con el botón «Agregar».'),
    goal: 'comprobar que mi app tiene los tres permisos de Instagram necesarios.',
  },
  {
    id: 'agregar-probador', title: 'Añade tu cuenta de Instagram a la app',
    summary: 'Mientras la app está en modo desarrollo, solo pueden usarla cuentas con un rol. Si tu cuenta de Instagram aún no figura, invítala como probadora.',
    whyItMatters: 'Si tu cuenta no aparece al generar el token, casi siempre es porque no tiene rol en la app o no aceptó la invitación.',
    instructions: [
      'Abre el panel de apps de Meta, entra a tu app y busca «Roles de la app» > «Roles» (menú por verificar; no hay enlace directo confirmado) y «Instagram Testers» (o similar).',
      'Pulsa «Agregar», escribe el nombre de usuario de Instagram (por ejemplo @tu_cuenta) y envía la invitación.',
      'Desde esa cuenta, en la web de Instagram: Editar perfil > «Apps y sitios web» > «Invitaciones de probador», y acepta.',
      'Los roles disponibles son Administrador, Desarrollador, Probador y Analista.',
    ],
    links: [APPS_PANEL, ROLES_DOC, MODES_DOC],
    notes: ['Para atender cuentas de otras personas, Meta exige revisión de la app: este tutorial solo cubre cuentas propias o que administras.'],
    expectedResult: 'Sabrás que está bien cuando tu cuenta de Instagram figure en la app sin invitaciones pendientes.',
    screenshot: schematic('instagram', 'agregar-probador', 'Esquema del camino para invitar y aceptar a una persona probadora de Instagram', 'Invitación de probador (esquema por verificar).'),
    verified: false,
    verifyNote: `${SCHEMATIC_VERIFY}el flujo de «Instagram Testers» y dónde se acepta la invitación proceden de fuentes no oficiales; confirma los nombres en tu panel y en Instagram.`,
    goal: 'agregar mi cuenta de Instagram como probadora de mi app de Meta y aceptar la invitación.',
  },
  {
    id: 'generar-token', title: 'Genera el token de Instagram',
    summary: 'Meta te entrega una clave larga (el token) que da acceso a tu cuenta con los permisos aceptados.',
    whyItMatters: 'Tu programa usa ese token para leer comentarios y responder. Es como una contraseña: trátalo así.',
    instructions: [
      'Abre el panel de apps de Meta, entra a tu app y busca, en el menú de Instagram, «API setup with Instagram business login» (o similar; ubicación por verificar, no hay enlace directo confirmado).',
      'Pulsa «Generate token» junto a tu cuenta.',
      'Inicia sesión en Instagram si te lo pide y acepta los permisos.',
      'Copia el token. Guárdalo solo el tiempo justo para pegarlo en tu programa.',
      'El token dura 60 días. Para renovarlo (con al menos 24 horas de antigüedad y sin haber vencido) Meta ofrece: GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=TU_TOKEN, que suma 60 días. Un token vencido no se puede renovar: genera uno nuevo.',
    ],
    links: [APPS_PANEL, IG_LOGIN_DOC],
    notes: ['Nunca pegues el token en un chat, un correo ni un repositorio.', 'Haz la renovación solo en tu propio equipo, nunca en una web ni un chat de terceros.'],
    expectedResult: 'Sabrás que está bien cuando tengas el token copiado (una cadena larga sin espacios) listo para pegar.',
    screenshot: schematic('instagram', 'generar-token', 'Esquema del camino para generar el token de Instagram', 'Generación del token (esquema por verificar; oculta el valor en cualquier captura).'),
    verified: false,
    verifyNote: `${SCHEMATIC_VERIFY}el nombre exacto en español de la sección «API setup with Instagram business login» y el botón «Generate token» no se vieron en pantalla; busca la equivalente.`,
    goal: 'generar el token de acceso de Instagram sin exponerlo.',
  },
  {
    id: 'pegar-token', title: 'Pégalo en Conexiones',
    summary: 'Guarda el token en tu programa. Se cifra en tu equipo y no vuelve a mostrarse.',
    whyItMatters: 'Es el único lugar donde debe pegarse el token.',
    local: true,
    instructions: [
      'En la pestaña «Conexiones», en «Nueva conexión», escribe un nombre (por ejemplo «Cuenta principal»).',
      'En «Tipo de acceso» elige «Instagram Login · token de Instagram».',
      'Deja la versión de Graph que propone el programa, salvo que Meta indique otra.',
      'Pega el token en «Token de acceso · solo captura» y pulsa «Guardar conexión cifrada».',
    ],
    links: [],
    notes: ['Nunca pegues aquí el secreto de la app.'],
    expectedResult: 'Sabrás que está bien cuando veas «Conexión guardada» y la conexión aparezca en la lista como «Sin validar».',
    screenshot: schematic('instagram', 'pegar-token', 'Esquema del formulario Nueva conexión del programa', 'Formulario «Nueva conexión» (sin mostrar ningún token).'),
    goal: 'guardar mi token de Instagram en mi programa local, en el formulario «Nueva conexión».',
  },
  {
    id: 'probar-descubrir', title: 'Prueba y selecciona tu cuenta',
    summary: 'Tu programa comprueba el token con Meta y encuentra tu cuenta.',
    whyItMatters: 'Hasta seleccionar la cuenta, el programa no puede vigilar comentarios.',
    local: true,
    instructions: [
      'En tu conexión, pulsa «Probar y descubrir».',
      'Cuando veas «Validación y descubrimiento completados», busca tu cuenta en «Cuentas descubiertas».',
      'Pulsa «Seleccionar» en la cuenta que quieres administrar.',
    ],
    links: [],
    notes: ['Si falla, la conexión aparece como «Token inválido»: revisa que el token esté completo, no haya vencido y tenga los permisos del paso 6.', 'Si tu cuenta no aparece, revisa que sea profesional, que haya aceptado la invitación de probador y que iniciaste sesión con la cuenta de Instagram correcta.'],
    expectedResult: 'Sabrás que está bien cuando tu cuenta aparezca en «Cuentas seleccionadas».',
    screenshot: schematic('instagram', 'probar-descubrir', 'Esquema de Conexiones con Probar y descubrir y Seleccionar', 'Cuenta descubierta con el botón «Seleccionar».'),
    goal: 'validar mi conexión con el botón «Probar y descubrir» y seleccionar mi cuenta de Instagram.',
  },
  {
    id: 'comprobar-revision', title: 'Comprueba con Revisión pendiente',
    summary: 'Haz una lectura de prueba que solo analiza comentarios y no envía nada.',
    whyItMatters: 'Confirma que el programa puede leer tus publicaciones y comentarios antes de activar nada.',
    local: true,
    localWhere: 'en la pantalla «Revisión pendiente» de mi programa local',
    instructions: [
      'Ve a «Revisión pendiente».',
      'Elige una ventana de tiempo corta y pulsa «Iniciar análisis».',
      'Revisa el resumen: analizar es solo lectura y no envía mensajes.',
    ],
    links: [],
    notes: ['El programa empieza en Dry Run: nada se envía hasta que lo autorices de forma explícita.', 'Meta permite una respuesta privada por persona y solo dentro de 7 días del comentario.'],
    expectedResult: 'Sabrás que está bien cuando el análisis termine con un resumen de comentarios leídos y sin errores.',
    screenshot: pending('Resumen del análisis terminado en la pantalla Revisión pendiente del programa', 'Resumen de un análisis terminado.'),
    goal: 'comprobar con «Revisión pendiente» que mi programa lee los comentarios de mi cuenta sin enviar nada.',
  },
  confirmAccountStep('instagram'),
]);

const facebookSteps = build([
  {
    id: 'requisitos', title: 'Revisa los requisitos',
    summary: 'Necesitas una Página de Facebook sobre la que tengas control total.',
    whyItMatters: 'Sin control sobre la Página, Meta rechazará los permisos de lectura y mensajes. Las tareas necesarias son Moderar y Mensajes.',
    instructions: [
      'Confirma que administras la Página con control total, o al menos con las tareas Mensajes y Moderar.',
      'Ten a mano tu teléfono y tu correo: Meta envía códigos de verificación.',
    ],
    links: [],
    notes: ['La compatibilidad con Páginas es experimental y está apagada por defecto (ver el paso 9).', 'Con un token de usuario, los datos de los comentarios pueden llegar vacíos: el programa usa el token de la Página, que descubre solo.'],
    expectedResult: 'Sabrás que está bien cuando puedas administrar la Página con tu usuario de Facebook.',
    screenshot: pending('Pantalla de roles y acceso de la Página de Facebook con control total', 'Acceso a la Página con control total.'),
    goal: 'comprobar que administro mi Página de Facebook con control total, o al menos con las tareas Mensajes y Moderar.',
  },
  developerAccountSteps('facebook'),
  portfolioStep('facebook', 'tu propia Página'),
  {
    id: 'crear-app', title: 'Crea la app de Meta',
    summary: 'La app es el «registro» que Meta usa para darte permisos. No es una app que publiques.',
    whyItMatters: 'Los tokens y los permisos se generan desde una app. Una app nueva empieza en modo desarrollo: solo la usan personas con un rol en ella.',
    instructions: [
      'Abre el panel de apps de Meta y pulsa «Crear app» (o similar).',
      'Escribe un nombre y tu correo de contacto.',
      'Elige el caso de uso o los casos de uso que necesites (en el siguiente paso se detallan los de Páginas y Messenger).',
      'Si Meta pregunta por un portafolio comercial, puedes omitirlo (paso anterior).',
      'Revisa el resumen y entra al panel de la nueva app («Ir al panel»).',
      APP_ID_INSTRUCTION,
    ],
    links: [APPS_PANEL, APP_DASHBOARD, CREATE_APP_DOC, MODES_DOC],
    notes: ['Agregar un caso de uso no se puede deshacer.'],
    expectedResult: 'Sabrás que está bien cuando veas el panel de tu app nueva y hayas anotado su ID de app.',
    screenshot: schematic('facebook', 'crear-app', 'Esquema de la lista Mis apps con el botón Crear app resaltado', 'Lista de apps con «Crear app».'),
    goal: 'crear la app de Meta para conectar mi Página de Facebook.',
  },
  {
    id: 'casos-uso-paginas', title: 'Añade los casos de uso de Páginas y Messenger',
    summary: 'La app necesita dos casos de uso para administrar la Página y enviar mensajes.',
    whyItMatters: 'Sin ellos, Meta no ofrece los permisos de Página que el programa usa.',
    instructions: [
      'Abre «Casos de uso» de tu app (enlace directo de abajo) y pulsa «Agregar casos de uso».',
      'En el cuadro hay una casilla por cada caso de uso. Marca «Administrar todos los aspectos de tu página».',
      'Para Messenger, usa el filtro «Mensajes comerciales» y marca «Interactuar con los clientes en Messenger from Meta».',
      'Pulsa «Guardar».',
    ],
    links: [APPS_PANEL, APP_USE_CASES],
    notes: ['Agregar un caso de uso no se puede deshacer: marca solo estos dos.', 'Los nombres exactos se vieron en el panel en español y pueden variar según la versión del panel de Meta.'],
    expectedResult: 'Sabrás que está bien cuando ambos casos de uso aparezcan en tu app.',
    screenshot: schematic('facebook', 'casos-uso-paginas', 'Esquema del cuadro Agregar casos de uso con los dos casos de uso de Páginas y Messenger marcados', 'Cuadro «Agregar casos de uso» (nombres observados en el panel).'),
    goal: 'añadir a mi app de Meta los casos de uso de Páginas y de Messenger.',
  },
  {
    id: 'permisos', title: 'Revisa los permisos necesarios',
    summary: 'Se necesitan cuatro permisos de Página. Otros dos son opcionales.',
    whyItMatters: 'Sin los cuatro obligatorios, la Página no aparecerá o Meta rechazará la acción (facebook_permission_denied).',
    instructions: [
      'Abre los permisos del caso de uso de Páginas (enlace directo de abajo). En la pestaña de permisos pulsa «Agregar» en cada permiso; el estado pasa a «Listo para la prueba» y aparece el botón «Acciones».',
      'En el caso de uso de Páginas se agregan pages_read_user_content (leer comentarios de otras personas) y pages_manage_engagement (opcional: respuesta pública).',
      'Abre los permisos del caso de uso de Messenger (segundo enlace directo) y agrega pages_messaging (enviar la respuesta privada; depende de pages_manage_metadata y pages_show_list).',
      'Obligatorios en total: pages_show_list (listar tus Páginas), pages_read_engagement (leer publicaciones y comentarios), pages_read_user_content y pages_messaging. Si no ves pages_show_list o pages_read_engagement en una pestaña, búscalos en la otra: no se observó en cuál aparecen.',
      'Opcional: instagram_basic, solo si además quieres encontrar la cuenta de Instagram vinculada a la Página; sin él el programa muestra solo la Página (comportamiento por verificar con una Página real).',
      'Opcionales o aún sin uso: pages_manage_engagement (respuesta pública) y pages_manage_metadata.',
    ],
    links: [APPS_PANEL, PAGES_PERMISSIONS, MESSENGER_PERMISSIONS, PERMISSIONS_DOC, FB_PRIVATE_REPLIES],
    notes: ['Los nombres y requisitos de permisos los define Meta y cambian: verifícalos en su documentación.', 'Agregar un permiso desde el caso de uso no equivale a aprobarlo para otras personas: mientras la app esté en modo desarrollo solo funciona con cuentas que tengan un rol en ella.'],
    expectedResult: 'Sabrás que está bien cuando los permisos aparezcan como «Listo para la prueba» en tu app.',
    screenshot: schematic('facebook', 'permisos', 'Esquema de la pestaña Permisos y funciones con los cuatro permisos de Página', 'Permisos de Página con el botón «Agregar».'),
    goal: 'agregar a mi app los permisos de Página que hacen falta (los cuatro obligatorios) desde los casos de uso de Páginas y de Messenger.',
  },
  {
    id: 'generar-token-usuario', title: 'Genera el token de usuario en el Explorador',
    summary: 'Con el Explorador de la API Graph generas un token de usuario y eliges tu Página. Ese token dura alrededor de una hora.',
    whyItMatters: 'Tu programa usa ese token para encontrar tu Página. Si no marcas la Página en el diálogo, no aparecerá.',
    instructions: [
      'Abre el Explorador de la API Graph (enlace de abajo) con tu usuario de Facebook.',
      'En «App de Meta», elige tu app.',
      'En «Usuario o página», elige «Obtener token de acceso de usuario».',
      'Abre la pestaña «Permissions». Con «Agregar un permiso» añade los cuatro obligatorios del paso anterior; el menú muestra «N opciones seleccionadas».',
      'Pulsa el botón azul «Generate Access Token».',
      'Facebook abre un diálogo de permisos en una ventana aparte (emergente). Si no la ves, el navegador pudo bloquearla: permite las ventanas emergentes para developers.facebook.com, busca la ventana y vuelve a pulsar el botón.',
      'En esa ventana, acepta los permisos y elige la Página (o Páginas) que quieres autorizar.',
      'Al aceptar, el campo del token se actualiza. Antes de copiarlo, mira «Usuario o página»: debe decir «Token del usuario». Si muestra el nombre de una Página, el token que ves es el de esa Página: vuelve a elegir «Token del usuario».',
      'Copia el token. No lo pegues en ningún chat.',
    ],
    links: [GRAPH_EXPLORER, TOKEN_DEBUGGER, EXPLORER_DOC],
    notes: [
      'Comprobación opcional: la consulta me/accounts debe devolver tu Página.',
      'Tu programa acepta DOS tipos de token. El token de usuario (recomendado) le permite encontrar todas tus Páginas por sí mismo.',
      'También acepta directamente el token de UNA Página (si en «Usuario o página» eliges la Página): conecta solo esa Página. Modo por verificar con una Página real.',
      'Una conexión queda atada a la identidad de su primer token: no puedes cambiar después un token de Página por uno de usuario editando la conexión.',
    ],
    expectedResult: 'Sabrás que está bien cuando el Explorador muestre un token con «Token del usuario» en el selector y me/accounts liste tu Página.',
    screenshot: schematic('facebook', 'generar-token-usuario', 'Esquema del Explorador de la API Graph con la app, el tipo de token y los permisos resaltados', 'Explorador de la API Graph (etiquetas observadas; oculta el token en cualquier captura).'),
    goal: 'generar en el Explorador de la API Graph un token de usuario de Facebook con los permisos de Página y copiar el token de usuario, no el de una Página.',
  },
  {
    id: 'token-larga-duracion', title: 'Convierte el token en uno de larga duración',
    summary: 'El token del Explorador dura alrededor de una hora. Meta permite canjearlo por uno de unos 60 días.',
    whyItMatters: 'Así no tienes que repetir el proceso a cada rato.',
    instructions: [
      'El canje es una llamada GET a /oauth/access_token con grant_type=fb_exchange_token, client_id=ID_DE_TU_APP, client_secret=SECRETO_DE_TU_APP y fb_exchange_token=TU_TOKEN_CORTO.',
      'Hazlo solo en tu propio equipo. Si no te sientes cómodo, pide ayuda a una persona técnica de confianza.',
      'Con el Depurador de tokens puedes ver cuándo vence un token y qué permisos tiene.',
      'Después, la consulta /me/accounts entrega tokens de Página que no tienen fecha de vencimiento.',
    ],
    links: [LONG_LIVED_DOC, TOKEN_DEBUGGER],
    notes: ['El secreto de la app NUNCA se comparte: ni con una IA, ni en un chat, ni en un repositorio. Este programa nunca te lo pedirá.'],
    expectedResult: 'Sabrás que está bien cuando el Depurador indique que el token vence en unos 60 días.',
    screenshot: schematic('facebook', 'token-larga-duracion', 'Esquema del canje de un token de usuario corto por uno de larga duración', 'Canje del token (esquema por verificar).'),
    verified: false,
    verifyNote: `${SCHEMATIC_VERIFY}el procedimiento sigue la guía oficial, pero no se vio en pantalla; confirma las pantallas y los plazos con el Depurador de tokens.`,
    goal: 'obtener un token de larga duración sin exponer el secreto de mi app.',
    helpFocus: 'Importante: nunca compartiré contigo el secreto de mi app; explícame cómo hacer el canje en mi propio equipo.',
  },
  {
    id: 'activar-paginas', title: 'Activa la compatibilidad con Páginas',
    summary: 'La función es experimental: hay que iniciar el programa con la variable SOCIAL_DESK_FACEBOOK_PAGES=1.',
    whyItMatters: 'Sin ella, «Probar y descubrir» solo lista cuentas de Instagram.',
    local: true,
    localWhere: 'en la terminal desde la que inicio mi programa local',
    instructions: [
      'Detén el programa y vuelve a iniciarlo con SOCIAL_DESK_FACEBOOK_PAGES=1.',
      'En PowerShell: $env:SOCIAL_DESK_FACEBOOK_PAGES = "1"; npm start',
      'Abre de nuevo el programa en tu navegador.',
    ],
    links: [],
    notes: ['Esto reinicia la aplicación: el Monitoreo se apaga en cada arranque.'],
    expectedResult: 'Sabrás que está bien cuando, al probar la conexión del siguiente paso, aparezcan Páginas con la insignia «Facebook».',
    screenshot: pending('Terminal de PowerShell con la variable de entorno SOCIAL_DESK_FACEBOOK_PAGES activada antes de iniciar el programa', 'Inicio con la variable activada.'),
    goal: 'iniciar mi programa local con la compatibilidad de Páginas de Facebook activada mediante una variable de entorno.',
  },
  {
    id: 'pegar-token', title: 'Pégalo en Conexiones como Facebook Login',
    summary: 'Guarda el token de usuario en tu programa. Se cifra en tu equipo y no vuelve a mostrarse.',
    whyItMatters: 'Es el único lugar donde debe pegarse el token.',
    local: true,
    instructions: [
      'En la pestaña «Conexiones», en «Nueva conexión», escribe un nombre.',
      'En «Tipo de acceso» elige «Facebook Login · token de usuario y página vinculada».',
      'Pega el token de USUARIO del paso anterior en «Token de acceso · solo captura» y pulsa «Guardar conexión cifrada».',
    ],
    links: [],
    notes: [
      'Nunca pegues aquí el secreto de la app.',
      'Una conexión queda atada a la identidad de su primer token. Si guardaste un token de Página y quieres usar uno de usuario, al editarla verás el error connection_identity_mismatch: elimina la conexión y crea una nueva.',
    ],
    expectedResult: 'Sabrás que está bien cuando veas «Conexión guardada» y la conexión aparezca como «Sin validar».',
    screenshot: schematic('facebook', 'pegar-token', 'Esquema del formulario Nueva conexión con el tipo de acceso Facebook Login', 'Formulario «Nueva conexión» (sin mostrar ningún token).'),
    goal: 'guardar mi token de usuario de Facebook en mi programa local, en el formulario «Nueva conexión».',
  },
  {
    id: 'probar-seleccionar', title: 'Prueba y selecciona tu Página',
    summary: 'Tu programa encuentra tus Páginas con el token y te deja elegir cuál administrar.',
    whyItMatters: 'Al seleccionar la Página, el programa guarda también su token, cifrado, para leer y responder.',
    local: true,
    instructions: [
      'En tu conexión, pulsa «Probar y descubrir».',
      'Se listan todas tus Páginas (con la insignia «Facebook») en «Cuentas descubiertas». Si el token incluye el permiso instagram_basic, también aparece la cuenta de Instagram vinculada.',
      'Pulsa «Seleccionar» en la Página que quieres administrar.',
      'Crea una automatización para esa Página. Empieza en Dry Run: nada se envía hasta que lo autorices.',
    ],
    links: [],
    notes: ['Si tu Página no aparece, revisa que la marcaste en el diálogo del paso 7 y que el token tiene los cuatro permisos.', 'Si un permiso de Página no está en la Página (tareas Moderar y Mensajes), Meta devolverá datos vacíos o rechazará la acción.'],
    expectedResult: 'Sabrás que está bien cuando tu Página aparezca en «Cuentas seleccionadas».',
    screenshot: schematic('facebook', 'probar-seleccionar', 'Esquema de Conexiones con Probar y descubrir y Seleccionar para una Página', 'Página descubierta con el botón «Seleccionar».'),
    goal: 'validar mi conexión con el botón «Probar y descubrir» y seleccionar mi Página de Facebook.',
  },
  {
    id: 'limitaciones', title: 'Conoce las limitaciones',
    summary: 'Facebook funciona distinto de Instagram en varios puntos. Conviene saberlo antes de activar nada.',
    whyItMatters: 'Evita sorpresas y respuestas duplicadas.',
        instructions: [
      'Los comentarios de personas sin rol en tu app llegan sin nombre: {{username}} se reemplaza por un saludo sin nombre.',
      'Los botones de enlace se envían como texto simple.',
      'Todavía no hay respuesta pública, moderación ni ocultar o borrar para Páginas.',
      'Meta permite una respuesta privada por persona y dentro de 7 días del comentario.',
      'Si otra herramienta responde a los mismos comentarios, desactívala antes de usar este programa en esa Página.',
    ],
    links: [FB_PRIVATE_REPLIES],
    notes: ['Facebook no permite verificar el mensaje enviado: se confirma con la respuesta de Meta.'],
    expectedResult: 'Sabrás que está bien cuando entiendas qué hace y qué no hace el programa con tu Página.',
    screenshot: pending('Sin captura necesaria: este paso es informativo', 'Este paso es informativo.'),
    goal: 'entender las limitaciones de mi programa local con las Páginas de Facebook.',
  },
  confirmAccountStep('facebook'),
]);

export const TUTORIALS: Record<TutorialPlatformId, TutorialPlatformContent> = {
  instagram: { id: 'instagram', label: 'Instagram', steps: instagramSteps },
  facebook: { id: 'facebook', label: 'Facebook', steps: facebookSteps },
};

/** TikTok is announced only: no steps, no content. */
export const COMING_SOON_PLATFORMS: ReadonlyArray<{ id: 'tiktok'; label: string }> = [{ id: 'tiktok', label: 'TikTok' }];
