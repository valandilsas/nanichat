// Informational catalogue of the Meta permissions offered when generating a Facebook token.
// Pure data and helpers: no network, no storage. Keep it in sync with docs/GUIA-TOKEN-FACEBOOK.md.

export type PermissionUsage = 'required' | 'recommended' | 'optional' | 'unused';

export interface PermissionInfo {
  name: string;
  usage: PermissionUsage;
  description: string;
  /** False when the description or the dependency is not backed by Meta's documentation (shown as "por verificar"). */
  confirmed: boolean;
}

export const USAGE_ORDER: ReadonlyArray<PermissionUsage> = ['required', 'recommended', 'optional', 'unused'];
export const USAGE_LABELS: Readonly<Record<PermissionUsage, string>> = {
  required: 'Requerido',
  recommended: 'Recomendado',
  optional: 'Opcional',
  unused: 'No lo usa',
};

export const PERMISSIONS_TITLE = 'Permisos de Facebook: qué hace cada uno';
export const PERMISSIONS_NOTE = 'Marca solo los permisos que necesitas: cada permiso extra da más acceso del necesario. Esta lista aplica al generar el token en el Explorador de la API Graph o en el asistente «Generar token» de un usuario del sistema.';
export const PERMISSIONS_COUNT_NOTE = 'Tu asistente de Meta mostraba 22 opciones; aquí están las que se conocen. Si ves otras, no las marques.';
export const PERMISSIONS_CAVEAT = 'Las descripciones resumen la documentación de Meta; el panel de Meta puede mostrar nombres o permisos distintos.';
export const PERMISSIONS_LINK = 'https://developers.facebook.com/documentation/development/permissions';
export const PERMISSIONS_LINK_LABEL = 'Referencia oficial de permisos de Meta';

export const FACEBOOK_PERMISSIONS: ReadonlyArray<PermissionInfo> = [
  { name: 'pages_messaging', usage: 'required', confirmed: true, description: 'Permite gestionar las conversaciones de la Página con los clientes en Messenger; es lo que permite enviar la respuesta privada a un comentario.' },
  { name: 'pages_read_engagement', usage: 'required', confirmed: true, description: 'Permite leer el contenido de la Página (publicaciones, fotos, videos), los nombres e identificadores de seguidores, la foto de perfil y metadatos de la Página.' },
  { name: 'pages_read_user_content', usage: 'required', confirmed: true, description: 'Permite leer el contenido que otras personas publican en la Página, como comentarios y calificaciones.' },
  { name: 'pages_show_list', usage: 'required', confirmed: true, description: 'Permite ver la lista de Páginas que administras y confirmar que administras una Página concreta.' },
  { name: 'pages_manage_metadata', usage: 'recommended', confirmed: false, description: 'Permite suscribirse a los webhooks de la Página y cambiar su configuración; Meta lo señala como dependencia de pages_messaging (por verificar en tu panel).' },
  { name: 'instagram_basic', usage: 'optional', confirmed: true, description: 'Permite leer el perfil y los medios de una cuenta de Instagram vinculada (nombre de usuario, ID); hace falta para que NaniChat encuentre la cuenta de Instagram vinculada a tu Página.' },
  { name: 'instagram_manage_comments', usage: 'optional', confirmed: true, description: 'Permite crear, ocultar y eliminar comentarios de una cuenta de Instagram vinculada y leer comentarios; se usa si conectas Instagram a través de Facebook.' },
  { name: 'instagram_manage_messages', usage: 'optional', confirmed: true, description: 'Permite leer y responder los mensajes directos de Instagram; se usa para la respuesta privada de Instagram si conectas Instagram a través de Facebook.' },
  { name: 'pages_manage_engagement', usage: 'optional', confirmed: true, description: 'Permite crear, editar y eliminar comentarios en las publicaciones de la Página y dar «me gusta»; serviría para la respuesta pública, que NaniChat todavía no hace en Facebook.' },
  { name: 'business_management', usage: 'unused', confirmed: true, description: 'Permite leer y escribir con la API de Business Manager (por ejemplo, administrar cuentas publicitarias).' },
  { name: 'instagram_content_publish', usage: 'unused', confirmed: true, description: 'Permite crear y publicar fotos y videos en el feed de Instagram de una empresa.' },
  { name: 'instagram_manage_contents', usage: 'unused', confirmed: true, description: 'Permite eliminar publicaciones, historias o reels de una cuenta de Instagram vinculada a una Página.' },
  { name: 'instagram_manage_insights', usage: 'unused', confirmed: true, description: 'Permite obtener estadísticas de una cuenta de Instagram vinculada y leer perfil y medios de otros perfiles de empresa.' },
  { name: 'instagram_shopping_tag_products', usage: 'unused', confirmed: true, description: 'Permite etiquetar medios de Instagram con productos y administrar esas etiquetas.' },
  { name: 'pages_manage_posts', usage: 'unused', confirmed: true, description: 'Permite crear, editar y eliminar publicaciones, fotos y videos en una Página.' },
  { name: 'pages_utility_messaging', usage: 'unused', confirmed: true, description: 'Permite gestionar las plantillas de mensajes de utilidad de una Página y enviarlos por Messenger.' },
  { name: 'paid_marketing_messages', usage: 'unused', confirmed: false, description: 'Descripción no confirmada en la documentación de Meta (parece relacionado con mensajes de marketing de pago en Messenger).' },
  { name: 'read_insights', usage: 'unused', confirmed: true, description: 'Permite leer estadísticas de Páginas, apps y dominios web que posees.' },
];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Case- and accent-insensitive filter over name and description; an empty query returns everything. */
export function filterPermissions(list: ReadonlyArray<PermissionInfo>, query: string): PermissionInfo[] {
  const needle = normalize(query);
  if (!needle) return [...list];
  return list.filter((entry) => normalize(entry.name).includes(needle) || normalize(entry.description).includes(needle));
}
