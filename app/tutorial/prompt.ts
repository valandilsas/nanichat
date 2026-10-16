/**
 * Help-prompt generator (pure). Builds, from the data of ONE step, a Spanish prompt for any AI assistant that
 * describes exactly what the person wants to do in that step. It never names this program: steps that happen
 * inside it say «mi programa local» and describe the screen labels instead.
 */
import { SAFETY_RULES, type TutorialPlatformId, type TutorialStep } from './content';
import { resolveLink } from './view';

const PRODUCT_NAMES = /Social Desk|NaniChat/gu;
const LOCAL_PROGRAM = 'mi programa local';

const ACCOUNT_NOUN: Record<TutorialPlatformId, string> = {
  instagram: 'cuenta profesional de Instagram',
  facebook: 'Página de Facebook',
};
const PLATFORM_NAME: Record<TutorialPlatformId, string> = { instagram: 'Instagram', facebook: 'Facebook' };

/** Replaces any product name by the generic «mi programa local». */
function neutral(text: string): string {
  return text.replace(PRODUCT_NAMES, LOCAL_PROGRAM);
}

function whereLine(step: TutorialStep, appId: string | undefined): string | undefined {
  if (step.local) return `Dónde se hace: ${step.localWhere ?? `en la pestaña «Conexiones» de ${LOCAL_PROGRAM}`}, no en el sitio de Meta.`;
  const entries = step.links.map((link) => {
    const resolved = resolveLink(link, appId);
    return resolved.href ? `${resolved.label} (${resolved.href})` : `${resolved.label} (enlace directo a mi app; si no lo tengo, busca esta sección desde el panel de apps de Meta)`;
  });
  return entries.length > 0 ? `Dónde se hace: ${entries.join('; ')}.` : undefined;
}

/** `index` is zero-based. `appId` (public, optional) only turns templated links into real URLs. */
export function buildHelpPrompt(platform: TutorialPlatformId, step: TutorialStep, index: number, total: number, appId?: string): string {
  const name = PLATFORM_NAME[platform];
  const lines: string[] = [
    `Necesito ayuda con un paso concreto de la configuración de la API de Meta para ${name}. Mi objetivo general: obtener un token de acceso y los permisos necesarios para poder leer los comentarios de las publicaciones de mi ${ACCOUNT_NOUN[platform]} y responderlos por mensaje privado desde un programa propio. Mi panel de Meta está en español.`,
    `Paso en el que estoy: ${index + 1} de ${total} — «${step.title}».`,
  ];
  if (step.local) lines.push(`Este paso se hace dentro de ${LOCAL_PROGRAM}, no en el sitio de Meta: guíame por los nombres de sus botones y campos.`);
  if (!step.verified) lines.push(`Este paso NO está confirmado: ${neutral(step.verifyNote ?? 'sus detalles no se han comprobado en pantalla.')} Verifica cada nombre de menú y cada dato en la documentación oficial de Meta y dime qué no pudiste confirmar.`);
  lines.push(`Qué debo lograr en este paso: Debo ${neutral(step.goal)} ${neutral(step.summary)}`);
  if (step.helpFocus) lines.push(neutral(step.helpFocus));
  lines.push('Qué se supone que debo hacer:', ...step.instructions.map((line, position) => `${position + 1}. ${neutral(line)}`));
  const where = whereLine(step, appId);
  if (where) lines.push(where);
  lines.push(`Cómo sé que salió bien: ${neutral(step.expectedResult).replace(/^Sabrás que está bien cuando/u, 'Sé que salió bien cuando')}`);
  if (step.notes.length > 0) lines.push('Advertencias de este paso:', ...step.notes.map((note) => `- ${neutral(note)}`));
  lines.push(
    'Dónde me quedé / qué veo en pantalla: [REEMPLAZA: describe en qué pantalla estás y qué ves]',
    'Mensaje de error exacto (sin tokens ni secretos): [REEMPLAZA: pega el texto del error o escribe «ninguno»]',
    'Qué ya intenté: [REEMPLAZA: lo que hiciste]',
    'Tipo de cuenta o rol que tengo: [REEMPLAZA: por ejemplo, administrador de mi Página o dueño de mi cuenta profesional]',
    'Antes de responder, pídeme los datos que falten. Ayúdame solo con este paso, un sub-paso a la vez.',
    'Reglas que debes cumplir:',
    ...SAFETY_RULES.map((rule, position) => `${position + 1}. ${rule}`),
  );
  return lines.join('\n');
}
