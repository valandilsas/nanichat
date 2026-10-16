/**
 * Tutorial content (Spanish data). Edit steps here; nothing else needs to change.
 * Rules (see AGENTS.md): official https links only (host allowlist below), never real data, tokens or ids,
 * and `verified: false` for anything not backed by the repository docs (docs/GUIA-TOKEN-FACEBOOK.md, the manual).
 * Every URL below is already cited by the manual or the Facebook guide, or is a stable root; no invented deep links.
 */
export type TutorialPlatformId = 'instagram' | 'facebook';

export type TutorialLink = { label: string; url: string };
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
  helpPrompt: string;
  /** false = the from-zero details are not covered by the repository docs yet ("Paso por verificar"). */
  verified: boolean;
  /** Honest note shown with the "Paso por verificar" badge. */
  verifyNote?: string;
};

export type TutorialPlatformContent = { id: TutorialPlatformId; label: string; steps: TutorialStep[] };

export const ALLOWED_LINK_HOSTS: ReadonlyArray<string> = [
  'developers.facebook.com', 'business.facebook.com', 'www.facebook.com', 'www.instagram.com', 'help.instagram.com', 'about.meta.com',
];

export const SAFETY_RULES: ReadonlyArray<string> = [
  'Nunca me pidas ni aceptes tokens, secretos de la app, contraseñas ni códigos de verificación en este chat. Si los escribo por error, dime que los ignoras y que debo ocultarlos y regenerarlos.',
  'Si no estás seguro de un nombre de botón, permiso o pantalla de Meta, verifícalo en la documentación oficial de Meta y dime cuando algo no pudo verificarse.',
  'Guíame un solo paso a la vez y espera a que te diga que lo terminé antes de dar el siguiente.',
];

export const PLACEHOLDER_NOTE = 'Antes de pegar el prompt, reemplaza cada texto [REEMPLAZA: …] por tu información. Nunca pegues tokens, secretos de la app ni contraseñas.';

function helpPrompt(platform: string, number: number, total: number, title: string, goal: string, extra?: string): string {
  return [
    `Necesito ayuda con Social Desk, una aplicación local para responder por mensaje privado a comentarios de ${platform}.`,
    `Paso ${number} de ${total} del tutorial de ${platform}: «${title}».`,
    `Mi objetivo: ${goal}`,
    'Lo que estaba haciendo: [REEMPLAZA: describe en qué pantalla estás y qué acabas de hacer]',
    'Lo que veo o lo que me impide avanzar: [REEMPLAZA: pega aquí el texto EXACTO del error, sin tokens ni secretos]',
    ...(extra ? [extra] : []),
    'Reglas que debes cumplir:',
    ...SAFETY_RULES.map((rule, index) => `${index + 1}. ${rule}`),
    'Empieza preguntándome lo mínimo que necesites para ayudarme con este paso.',
  ].join('\n');
}

const pending = (alt: string, caption: string): TutorialScreenshot => ({ alt, caption, pending: true });
/** Original schematic at public/tutorial/<platform>/<step-id>.svg (not a real screenshot). */
const schematic = (platform: TutorialPlatformId, id: string, alt: string, caption: string): TutorialScreenshot => ({ file: `/tutorial/${platform}/${id}.svg`, alt, caption, pending: false });
const GRAPH_EXPLORER: TutorialLink = { label: 'Explorador de la API Graph', url: 'https://developers.facebook.com/tools/explorer/' };
const APPS_PANEL: TutorialLink = { label: 'Panel de apps de Meta', url: 'https://developers.facebook.com/apps/' };
const TOKEN_DEBUGGER: TutorialLink = { label: 'Depurador de tokens de acceso', url: 'https://developers.facebook.com/tools/debug/accesstoken/' };
const REGISTER_DOC: TutorialLink = { label: 'Guía de Meta: registrarse como desarrollador', url: 'https://developers.facebook.com/docs/development/register' };
const CREATE_APP_DOC: TutorialLink = { label: 'Guía de Meta: crear una app', url: 'https://developers.facebook.com/docs/development/create-an-app' };
const ROLES_DOC: TutorialLink = { label: 'Guía de Meta: roles de la app', url: 'https://developers.facebook.com/docs/development/build-and-test/app-roles' };
const MODES_DOC: TutorialLink = { label: 'Guía de Meta: modos de la app', url: 'https://developers.facebook.com/docs/development/build-and-test/app-modes' };
const IG_GET_STARTED: TutorialLink = { label: 'Guía de Meta: Instagram con inicio de sesión de Instagram', url: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started' };
const IG_PRIVATE_REPLIES: TutorialLink = { label: 'Guía de Meta: respuestas privadas de Instagram', url: 'https://developers.facebook.com/docs/instagram-platform/private-replies' };
const FB_PRIVATE_REPLIES: TutorialLink = { label: 'Guía de Meta: respuestas privadas de Messenger', url: 'https://developers.facebook.com/docs/messenger-platform/discovery/private-replies' };
const LONG_LIVED_DOC: TutorialLink = { label: 'Guía de Meta: tokens de larga duración', url: 'https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived' };
const PERMISSIONS_DOC: TutorialLink = { label: 'Permisos de Meta', url: 'https://developers.facebook.com/docs/permissions' };
const PORTFOLIO_LINK: TutorialLink = { label: 'Configuración comercial de Meta', url: 'https://business.facebook.com/settings' };

const SCHEMATIC_VERIFY = 'Paso por verificar: ';
const PORTFOLIO_NOTES = [
  'El portafolio comercial es opcional para empezar. La documentación de Meta no lo menciona como requisito del inicio de sesión de Instagram ni de los permisos de Páginas, y al crear la app puedes omitirlo o crearlo y vincularlo más tarde.',
  'Pasa a ser obligatorio cuando atiendes cuentas que no son tuyas (acceso avanzado: revisión de la app y Verificación de Empresa) o cuando usas el permiso business_management.',
  'Con tus propias cuentas y acceso estándar no debería hacer falta, pero confírmalo en tu panel real: esta parte es una inferencia, no una cita de Meta.',
];

const confirmAccountNotes = [
  'No uses scripts, extensiones ni herramientas automáticas en las páginas de Meta para desarrolladores: el uso intensivo o automatizado puede provocar este aviso.',
  'Social Desk nunca te pedirá tu contraseña ni los códigos de verificación de Meta.',
];

type Draft = Omit<TutorialStep, 'helpPrompt' | 'verified'> & { verified?: boolean; goal: string; extra?: string };

function build(platform: string, drafts: Draft[]): TutorialStep[] {
  return drafts.map(({ goal, extra, verified, ...step }, index) => ({
    ...step,
    verified: verified ?? true,
    helpPrompt: helpPrompt(platform, index + 1, drafts.length, step.title, goal, extra),
  }));
}

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
  links: [REGISTER_DOC, { label: 'Portal para desarrolladores de Meta', url: 'https://developers.facebook.com/' }],
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

const instagramSteps = build('Instagram', [
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
    links: [
      { label: 'Ayuda de Instagram: cuenta profesional', url: 'https://help.instagram.com/502981923235522' },
      { label: 'Ayuda de Facebook: conectar Instagram a una Página', url: 'https://www.facebook.com/business/help/connect-instagram-to-page' },
    ],
    notes: ['Este paso no requiere ningún token.', 'Los nombres de los menús son los habituales en español, pero no se han visto en pantalla: busca la opción equivalente.'],
    expectedResult: 'Sabrás que está bien cuando tu cuenta de Instagram aparezca como profesional (Business o Creator).',
    screenshot: schematic('instagram', 'requisitos', 'Esquema del camino para cambiar la cuenta de Instagram a profesional', 'Cambio a cuenta profesional (esquema por verificar).'),
    verified: false,
    verifyNote: `${SCHEMATIC_VERIFY}la necesidad de una cuenta profesional está en la documentación de Meta, pero los menús de Instagram y de la Página son inferidos; confírmalos en tu pantalla.`,
    goal: 'comprobar que mi cuenta de Instagram cumple los requisitos para conectarla.',
  },
  developerAccountSteps('instagram'),
  portfolioStep('instagram', 'tu propia cuenta'),
  {
    id: 'crear-app', title: 'Crea la app de Meta',
    summary: 'La app es el «registro» que Meta usa para darte permisos. No es una app que publiques.',
    whyItMatters: 'Los tokens y los permisos se generan desde una app. Los casos de uso no se pueden quitar una vez añadidos, así que conviene elegir bien. Una app nueva empieza en modo desarrollo: solo la usan personas con un rol en ella.',
    instructions: [
      'Abre el panel de apps de Meta y pulsa «Crear app» (o similar).',
      'Escribe un nombre (por ejemplo «Social Desk de @tu_cuenta») y tu correo de contacto.',
      'Elige el caso de uso para administrar mensajes y contenido en Instagram; Meta añade los permisos y productos por ti.',
      'Si Meta te pregunta por un portafolio comercial, mira el paso anterior: puedes omitirlo.',
      'Revisa el resumen y entra al panel de tu nueva app («Ir al panel»).',
    ],
    links: [APPS_PANEL, CREATE_APP_DOC, MODES_DOC],
    notes: ['Si te equivocas con el caso de uso, es más sencillo crear otra app.', 'La lista «Mis apps» y el botón «Crear app» se vieron así en el panel en español.'],
    expectedResult: 'Sabrás que está bien cuando veas el panel de tu app nueva con su nombre.',
    screenshot: schematic('instagram', 'crear-app', 'Esquema de la lista Mis apps con el botón Crear app resaltado', 'Lista de apps con «Crear app».'),
    goal: 'crear la app de Meta para conectar mi cuenta de Instagram.',
  },
  {
    id: 'caso-uso-instagram', title: 'Añade el caso de uso de Instagram',
    summary: 'Si al crear la app no elegiste el caso de uso de Instagram, añádelo desde el panel de la app.',
    whyItMatters: 'Ahí es donde Meta habilita el inicio de sesión de Instagram y el token que Social Desk necesita.',
    instructions: [
      'En el panel de la app pulsa «Agregar casos de uso».',
      'Marca «Administrar mensajes y contenido en Instagram» y pulsa «Guardar».',
      'Verás ese caso de uso en «Casos de uso», con el botón «Personalizar».',
    ],
    links: [IG_GET_STARTED],
    notes: ['Meta cambia el nombre y la ubicación de estas secciones; busca la equivalente.', 'Los casos de uso no se pueden quitar una vez añadidos.'],
    expectedResult: 'Sabrás que está bien cuando «Administrar mensajes y contenido en Instagram» aparezca en los casos de uso de tu app.',
    screenshot: schematic('instagram', 'caso-uso-instagram', 'Esquema del cuadro Agregar casos de uso con el caso de uso de Instagram marcado', 'Cuadro «Agregar casos de uso» (nombres observados en el panel).'),
    goal: 'añadir el caso de uso de Instagram a mi app de Meta.',
  },
  {
    id: 'permisos', title: 'Revisa los permisos',
    summary: 'La app necesita tres permisos de Instagram para leer comentarios y responder.',
    whyItMatters: 'Sin ellos, Meta rechazará la lectura de comentarios o el envío de mensajes.',
    instructions: [
      'En el caso de uso, abre la pestaña «Permisos y funciones» y pulsa «Agregar» en cada permiso.',
      'instagram_business_basic: leer el perfil y las publicaciones.',
      'instagram_business_manage_comments: leer comentarios y enviar respuestas privadas.',
      'instagram_business_manage_messages: mensajería de Instagram.',
      'Cada permiso añadido muestra el estado «Listo para la prueba».',
    ],
    links: [IG_PRIVATE_REPLIES, PERMISSIONS_DOC],
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
      'En el panel de la app, abre «Roles de la app» > «Roles» y busca «Instagram Testers» (o similar).',
      'Pulsa «Agregar», escribe el nombre de usuario de Instagram (por ejemplo @tu_cuenta) y envía la invitación.',
      'Desde esa cuenta, en la web de Instagram: Editar perfil > «Apps y sitios web» > «Invitaciones de probador», y acepta.',
      'Los roles disponibles son Administrador, Desarrollador, Probador y Analista.',
    ],
    links: [ROLES_DOC, MODES_DOC],
    notes: ['Para atender cuentas de otras personas, Meta exige revisión de la app: este tutorial solo cubre cuentas propias o que administras.'],
    expectedResult: 'Sabrás que está bien cuando tu cuenta de Instagram figure en la app sin invitaciones pendientes.',
    screenshot: schematic('instagram', 'agregar-probador', 'Esquema del camino para invitar y aceptar a una persona probadora de Instagram', 'Invitación de probador (esquema por verificar).'),
    verified: false,
    verifyNote: `${SCHEMATIC_VERIFY}el flujo de «Instagram Testers» y dónde se acepta la invitación proceden de fuentes no oficiales; confirma los nombres en tu panel y en Instagram.`,
    goal: 'agregar mi cuenta de Instagram a mi app de Meta.',
  },
  {
    id: 'generar-token', title: 'Genera el token de Instagram',
    summary: 'Meta te entrega una clave larga (el token) que da acceso a tu cuenta con los permisos aceptados.',
    whyItMatters: 'Social Desk usa ese token para leer comentarios y responder. Es como una contraseña: trátalo así.',
    instructions: [
      'En el panel de la app abre Instagram > «API setup with Instagram business login» (o similar).',
      'Pulsa «Generate token» junto a tu cuenta.',
      'Inicia sesión en Instagram si te lo pide y acepta los permisos.',
      'Copia el token. Guárdalo solo el tiempo justo para pegarlo en Social Desk.',
      'El token dura 60 días. Para renovarlo (con al menos 24 horas de antigüedad y sin haber vencido) Meta ofrece: GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=TU_TOKEN, que suma 60 días. Un token vencido no se puede renovar: genera uno nuevo.',
    ],
    links: [APPS_PANEL, IG_GET_STARTED],
    notes: ['Nunca pegues el token en un chat, un correo ni un repositorio.', 'Haz la renovación solo en tu propio equipo, nunca en una web ni un chat de terceros.'],
    expectedResult: 'Sabrás que está bien cuando tengas el token copiado (una cadena larga sin espacios) listo para pegar.',
    screenshot: schematic('instagram', 'generar-token', 'Esquema del camino para generar el token de Instagram', 'Generación del token (esquema por verificar; oculta el valor en cualquier captura).'),
    verified: false,
    verifyNote: `${SCHEMATIC_VERIFY}el nombre exacto en español de la sección «API setup with Instagram business login» no está confirmado; busca la equivalente.`,
    goal: 'generar el token de Instagram sin exponerlo.',
  },
  {
    id: 'pegar-token', title: 'Pégalo en Conexiones',
    summary: 'Guarda el token en Social Desk. Se cifra en tu equipo y no vuelve a mostrarse.',
    whyItMatters: 'Es el único lugar donde debe pegarse el token.',
    instructions: [
      'En esta pantalla, en «Nueva conexión», escribe un nombre (por ejemplo «Cuenta principal»).',
      'En «Tipo de acceso» elige «Instagram Login · token de Instagram».',
      'Deja la versión de Graph que propone la app, salvo que Meta indique otra.',
      'Pega el token en «Token de acceso · solo captura» y pulsa «Guardar conexión cifrada».',
    ],
    links: [],
    notes: ['Nunca pegues aquí el secreto de la app.'],
    expectedResult: 'Sabrás que está bien cuando veas «Conexión guardada» y la conexión aparezca en la lista como «Sin validar».',
    screenshot: schematic('instagram', 'pegar-token', 'Esquema del formulario Nueva conexión de Social Desk', 'Formulario «Nueva conexión» (sin mostrar ningún token).'),
    goal: 'guardar mi token de Instagram en Social Desk.',
  },
  {
    id: 'probar-descubrir', title: 'Prueba y selecciona tu cuenta',
    summary: 'Social Desk comprueba el token con Meta y encuentra tu cuenta.',
    whyItMatters: 'Hasta seleccionar la cuenta, la aplicación no puede vigilar comentarios.',
    instructions: [
      'En tu conexión, pulsa «Probar y descubrir».',
      'Cuando veas «Validación y descubrimiento completados», busca tu cuenta en «Cuentas descubiertas».',
      'Pulsa «Seleccionar» en la cuenta que quieres administrar.',
    ],
    links: [],
    notes: ['Si falla, la conexión aparece como «Token inválido»: revisa que el token esté completo, no haya vencido y tenga los permisos del paso 6.', 'Si tu cuenta no aparece, revisa que sea profesional, que haya aceptado la invitación de probador y que iniciaste sesión con la cuenta de Instagram correcta.'],
    expectedResult: 'Sabrás que está bien cuando tu cuenta aparezca en «Cuentas seleccionadas».',
    screenshot: schematic('instagram', 'probar-descubrir', 'Esquema de Conexiones con Probar y descubrir y Seleccionar', 'Cuenta descubierta con el botón «Seleccionar».'),
    goal: 'validar mi conexión y seleccionar mi cuenta de Instagram.',
  },
  {
    id: 'comprobar-revision', title: 'Comprueba con Revisión pendiente',
    summary: 'Haz una lectura de prueba que solo analiza comentarios y no envía nada.',
    whyItMatters: 'Confirma que la app puede leer tus publicaciones y comentarios antes de activar nada.',
    instructions: [
      'Ve a «Revisión pendiente».',
      'Elige una ventana de tiempo corta y pulsa «Iniciar análisis».',
      'Revisa el resumen: analizar es solo lectura y no envía mensajes.',
    ],
    links: [],
    notes: ['Social Desk empieza en Dry Run: nada se envía hasta que lo autorices de forma explícita.', 'Meta permite una respuesta privada por persona y solo dentro de 7 días del comentario.'],
    expectedResult: 'Sabrás que está bien cuando el análisis termine con un resumen de comentarios leídos y sin errores.',
    screenshot: pending('Resumen del análisis en Revisión pendiente', 'Resumen de un análisis terminado.'),
    goal: 'comprobar que Social Desk lee los comentarios de mi cuenta.',
  },
  confirmAccountStep('instagram'),
]);

const facebookSteps = build('Facebook', [
  {
    id: 'requisitos', title: 'Revisa los requisitos',
    summary: 'Necesitas una Página de Facebook sobre la que tengas control total.',
    whyItMatters: 'Sin control sobre la Página, Meta rechazará los permisos de lectura y mensajes. Las tareas necesarias son Moderar y Mensajes.',
    instructions: [
      'Confirma que administras la Página con control total, o al menos con las tareas Mensajes y Moderar.',
      'Ten a mano tu teléfono y tu correo: Meta envía códigos de verificación.',
    ],
    links: [],
    notes: ['La compatibilidad con Páginas es experimental y está apagada por defecto (ver el paso 9).', 'Con un token de usuario, los datos de los comentarios pueden llegar vacíos: Social Desk usa el token de la Página, que descubre solo.'],
    expectedResult: 'Sabrás que está bien cuando puedas administrar la Página con tu usuario de Facebook.',
    screenshot: pending('Roles de la Página de Facebook', 'Acceso a la Página con control total.'),
    goal: 'comprobar que puedo usar mi Página de Facebook con Social Desk.',
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
    ],
    links: [APPS_PANEL, CREATE_APP_DOC, MODES_DOC],
    notes: ['Los casos de uso no se pueden quitar una vez añadidos.'],
    expectedResult: 'Sabrás que está bien cuando veas el panel de tu app nueva.',
    screenshot: schematic('facebook', 'crear-app', 'Esquema de la lista Mis apps con el botón Crear app resaltado', 'Lista de apps con «Crear app».'),
    goal: 'crear la app de Meta para conectar mi Página de Facebook.',
  },
  {
    id: 'casos-uso-paginas', title: 'Añade los casos de uso de Páginas y Messenger',
    summary: 'La app necesita dos casos de uso para administrar la Página y enviar mensajes.',
    whyItMatters: 'Sin ellos, Meta no ofrece los permisos de Página que Social Desk usa.',
    instructions: [
      'En el panel de la app pulsa «Agregar casos de uso».',
      'Marca «Administrar todos los aspectos de tu página» y «Interactuar con los clientes en Messenger from Meta», y pulsa «Guardar».',
    ],
    links: [APPS_PANEL],
    notes: ['Los nombres exactos pueden variar según la versión del panel de Meta.'],
    expectedResult: 'Sabrás que está bien cuando ambos casos de uso aparezcan en tu app.',
    screenshot: schematic('facebook', 'casos-uso-paginas', 'Esquema del cuadro Agregar casos de uso con los dos casos de uso de Páginas y Messenger marcados', 'Cuadro «Agregar casos de uso» (nombres observados en el panel).'),
    goal: 'añadir los casos de uso de Páginas y Messenger a mi app.',
  },
  {
    id: 'permisos', title: 'Revisa los permisos necesarios',
    summary: 'Social Desk necesita cuatro permisos de Página. Otros dos son opcionales.',
    whyItMatters: 'Sin los cuatro obligatorios, la Página no aparecerá o Meta rechazará la acción (facebook_permission_denied).',
    instructions: [
      'En los casos de uso, abre «Permisos y funciones» y pulsa «Agregar» en cada permiso; el estado pasa a «Listo para la prueba».',
      'Obligatorios: pages_show_list (listar tus Páginas).',
      'Obligatorios: pages_read_engagement (leer publicaciones y comentarios).',
      'Obligatorios: pages_read_user_content (leer comentarios de otras personas).',
      'Obligatorios: pages_messaging (enviar la respuesta privada; depende de pages_manage_metadata y pages_show_list).',
      'Opcional: instagram_basic, solo si además quieres encontrar la cuenta de Instagram vinculada a la Página; sin él NaniChat muestra solo la Página (comportamiento por verificar con una Página real).',
      'Opcionales o aún sin uso: pages_manage_engagement (respuesta pública) y pages_manage_metadata.',
    ],
    links: [PERMISSIONS_DOC, FB_PRIVATE_REPLIES],
    notes: ['Los nombres y requisitos de permisos los define Meta y cambian: verifícalos en su documentación.'],
    expectedResult: 'Sabrás que está bien cuando los permisos aparezcan como «Listo para la prueba» en tu app.',
    screenshot: schematic('facebook', 'permisos', 'Esquema de la pestaña Permisos y funciones con los cuatro permisos de Página', 'Permisos de Página con el botón «Agregar».'),
    goal: 'entender qué permisos de Página debo pedir.',
  },
  {
    id: 'generar-token-usuario', title: 'Genera el token de usuario en el Explorador',
    summary: 'Con el Explorador de la API Graph generas un token de usuario y eliges tu Página.',
    whyItMatters: 'Social Desk usa ese token para encontrar tu Página. Si no marcas la Página en el diálogo, no aparecerá.',
    instructions: [
      'Abre el Explorador de la API Graph con tu usuario de Facebook.',
      'En «App de Meta», elige tu app.',
      'Revisa el selector «Usuario o página»: elige «Token del usuario» (obtener token de acceso de usuario). Si queda en una Página, el token será el de esa Página.',
      'En «Permisos», con «Agregar un permiso», añade los cuatro obligatorios del paso anterior.',
      'Pulsa «Generate Access Token».',
      'En el diálogo de Facebook, acepta los permisos y elige la Página (o Páginas) que quieres autorizar.',
      'Copia el token. No lo pegues en ningún chat.',
    ],
    links: [GRAPH_EXPLORER, { label: 'Guía de Meta: Explorador de la API Graph', url: 'https://developers.facebook.com/docs/graph-api/guides/explorer' }],
    notes: [
      'Comprobación opcional: la consulta me/accounts debe devolver tu Página.',
      'Social Desk acepta DOS tipos de token. El token de usuario (recomendado) le permite encontrar todas tus Páginas por sí mismo.',
      'También acepta directamente el token de UNA Página (si en «Usuario o página» eliges la Página): conecta solo esa Página. El token de Página del Explorador es de corta duración salvo que lo canjees por uno largo. Modo por verificar con una Página real.',
    ],
    expectedResult: 'Sabrás que está bien cuando el Explorador muestre un token y me/accounts liste tu Página.',
    screenshot: schematic('facebook', 'generar-token-usuario', 'Esquema del Explorador de la API Graph con la app, el tipo de token y los permisos resaltados', 'Explorador de la API Graph (etiquetas observadas; oculta el token en cualquier captura).'),
    goal: 'generar un token de usuario de Facebook con los permisos de Página.',
  },
  {
    id: 'token-larga-duracion', title: 'Convierte el token en uno de larga duración',
    summary: 'El token del Explorador dura horas. Meta permite canjearlo por uno de unos 60 días.',
    whyItMatters: 'Así no tienes que repetir el proceso a cada rato.',
    instructions: [
      'El canje es una llamada GET a /oauth/access_token con grant_type=fb_exchange_token, client_id=ID_DE_TU_APP, client_secret=SECRETO_DE_TU_APP y fb_exchange_token=TU_TOKEN_CORTO.',
      'Hazlo solo en tu propio equipo. Si no te sientes cómodo, pide ayuda a una persona técnica de confianza.',
      'Con el Depurador de tokens puedes ver cuándo vence un token y qué permisos tiene.',
      'Después, la consulta /me/accounts entrega tokens de Página que no tienen fecha de vencimiento.',
    ],
    links: [LONG_LIVED_DOC, TOKEN_DEBUGGER],
    notes: ['El secreto de la app NUNCA se comparte: ni con una IA, ni en un chat, ni en un repositorio. Social Desk nunca te lo pedirá.'],
    expectedResult: 'Sabrás que está bien cuando el Depurador indique que el token vence en unos 60 días.',
    screenshot: schematic('facebook', 'token-larga-duracion', 'Esquema del canje de un token de usuario corto por uno de larga duración', 'Canje del token (esquema por verificar).'),
    verified: false,
    verifyNote: `${SCHEMATIC_VERIFY}el procedimiento sigue la guía oficial, pero no se vio en pantalla; confirma las pantallas y los plazos con el Depurador de tokens.`,
    goal: 'obtener un token de larga duración sin exponer el secreto de mi app.',
    extra: 'Importante: nunca compartiré contigo el secreto de mi app; explícame cómo hacer el canje en mi propio equipo.',
  },
  {
    id: 'activar-paginas', title: 'Activa la compatibilidad con Páginas',
    summary: 'La función es experimental: hay que iniciar Social Desk con la variable SOCIAL_DESK_FACEBOOK_PAGES=1.',
    whyItMatters: 'Sin ella, «Probar y descubrir» solo lista cuentas de Instagram.',
    instructions: [
      'Detén Social Desk y vuelve a iniciarlo con SOCIAL_DESK_FACEBOOK_PAGES=1.',
      'En PowerShell: $env:SOCIAL_DESK_FACEBOOK_PAGES = "1"; npm start',
      'Abre de nuevo Social Desk en tu navegador.',
    ],
    links: [],
    notes: ['Esto reinicia la aplicación: el Monitoreo se apaga en cada arranque.'],
    expectedResult: 'Sabrás que está bien cuando, al probar la conexión del siguiente paso, aparezcan Páginas con la insignia «Facebook».',
    screenshot: pending('Terminal con la variable de entorno', 'Inicio con la variable activada.'),
    goal: 'iniciar Social Desk con la compatibilidad de Páginas de Facebook activada.',
  },
  {
    id: 'pegar-token', title: 'Pégalo en Conexiones como Facebook Login',
    summary: 'Guarda el token en Social Desk. Se cifra en tu equipo y no vuelve a mostrarse.',
    whyItMatters: 'Es el único lugar donde debe pegarse el token.',
    instructions: [
      'En esta pantalla, en «Nueva conexión», escribe un nombre.',
      'En «Tipo de acceso» elige «Facebook Login · token de usuario y página vinculada».',
      'Pega el token en «Token de acceso · solo captura» y pulsa «Guardar conexión cifrada».',
    ],
    links: [],
    notes: ['Nunca pegues aquí el secreto de la app.'],
    expectedResult: 'Sabrás que está bien cuando veas «Conexión guardada» y la conexión aparezca como «Sin validar».',
    screenshot: schematic('facebook', 'pegar-token', 'Esquema del formulario Nueva conexión con el tipo de acceso Facebook Login', 'Formulario «Nueva conexión» (sin mostrar ningún token).'),
    goal: 'guardar mi token de Facebook en Social Desk.',
  },
  {
    id: 'probar-seleccionar', title: 'Prueba y selecciona tu Página',
    summary: 'Social Desk encuentra tus Páginas con el token y te deja elegir cuál administrar.',
    whyItMatters: 'Al seleccionar la Página, Social Desk guarda también su token, cifrado, para leer y responder.',
    instructions: [
      'En tu conexión, pulsa «Probar y descubrir».',
      'Busca tu Página (con la insignia «Facebook») en «Cuentas descubiertas».',
      'Pulsa «Seleccionar» en la Página que quieres administrar.',
      'Crea una automatización para esa Página. Empieza en Dry Run: nada se envía hasta que lo autorices.',
    ],
    links: [],
    notes: ['Si tu Página no aparece, revisa que la marcaste en el diálogo del paso 7 y que el token tiene los cuatro permisos.', 'Si un permiso de Página no está en la Página (tareas Moderar y Mensajes), Meta devolverá datos vacíos o rechazará la acción.'],
    expectedResult: 'Sabrás que está bien cuando tu Página aparezca en «Cuentas seleccionadas».',
    screenshot: schematic('facebook', 'probar-seleccionar', 'Esquema de Conexiones con Probar y descubrir y Seleccionar para una Página', 'Página descubierta con el botón «Seleccionar».'),
    goal: 'validar mi conexión y seleccionar mi Página de Facebook.',
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
      'Si otra herramienta responde a los mismos comentarios, desactívala antes de usar Social Desk en esa Página.',
    ],
    links: [FB_PRIVATE_REPLIES],
    notes: ['Facebook no permite verificar el mensaje enviado: se confirma con la respuesta de Meta.'],
    expectedResult: 'Sabrás que está bien cuando entiendas qué hace y qué no hace Social Desk con tu Página.',
    screenshot: pending('Sin captura necesaria', 'Este paso es informativo.'),
    goal: 'entender las limitaciones de Social Desk con Páginas de Facebook.',
  },
  confirmAccountStep('facebook'),
]);

export const TUTORIALS: Record<TutorialPlatformId, TutorialPlatformContent> = {
  instagram: { id: 'instagram', label: 'Instagram', steps: instagramSteps },
  facebook: { id: 'facebook', label: 'Facebook', steps: facebookSteps },
};

/** TikTok is announced only: no steps, no content. */
export const COMING_SOON_PLATFORMS: ReadonlyArray<{ id: 'tiktok'; label: string }> = [{ id: 'tiktok', label: 'TikTok' }];
