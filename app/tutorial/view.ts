/** Pure presentation helpers for the tutorial (no React, no DOM). */
import { APP_ID_PLACEHOLDER, type TutorialLink, type TutorialScreenshot, type TutorialStep } from './content';
import { type TutorialPlatform, type TutorialProgress, goTo, isValidAppId, markCompleted, percentComplete } from './progress';

export type StepStatus = 'completed' | 'current' | 'pending';

export function stepLabel(index: number, total: number): string {
  return `Paso ${index + 1} de ${total}`;
}

export function clampStep(index: number, total: number): number {
  if (total <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(total - 1, Math.max(0, Math.trunc(index)));
}

/** Where to resume: the saved step, kept inside the current content. */
export function startIndex(progress: TutorialProgress, platform: TutorialPlatform, steps: ReadonlyArray<TutorialStep>): number {
  return clampStep(progress.platforms[platform]?.currentStep ?? 0, steps.length);
}

export function progressSummary(progress: TutorialProgress, platform: TutorialPlatform, steps: ReadonlyArray<TutorialStep>, index: number): { label: string; completedCount: number; percent: number } {
  const ids = steps.map((step) => step.id);
  const completed = progress.platforms[platform]?.completed ?? [];
  return {
    label: stepLabel(clampStep(index, steps.length), steps.length),
    completedCount: completed.filter((id) => ids.includes(id)).length,
    percent: percentComplete(progress, platform, steps.length, ids),
  };
}

export function stepStatus(progress: TutorialProgress, platform: TutorialPlatform, steps: ReadonlyArray<TutorialStep>, index: number, currentIndex: number): StepStatus {
  const step = steps[index];
  if (step && progress.platforms[platform]?.completed.includes(step.id)) return 'completed';
  return index === currentIndex ? 'current' : 'pending';
}

/** "Siguiente": marks the visible step as done and moves forward (the last step stays in place). */
export function advance(progress: TutorialProgress, platform: TutorialPlatform, steps: ReadonlyArray<TutorialStep>, index: number): TutorialProgress {
  const current = clampStep(index, steps.length);
  const step = steps[current];
  const done = step ? markCompleted(progress, platform, step.id) : progress;
  return goTo(done, platform, clampStep(current + 1, steps.length));
}

export type ScreenshotView =
  | { kind: 'image'; src: string; alt: string; caption: string }
  | { kind: 'placeholder'; label: string; caption: string };

export const SCHEMATIC_NOTE = 'Esquema ilustrativo, no es una captura real. Tu pantalla puede verse distinta.';

/** True for the original SVG schematics (as opposed to a real, redacted screenshot). */
export function isSchematic(src: string): boolean {
  return src.endsWith('.svg');
}

/** Only a same-site absolute path under /tutorial/ may be shown as an image; anything else keeps the placeholder. */
export function screenshotView(screenshot: TutorialScreenshot): ScreenshotView {
  const file = screenshot.file;
  const safe = typeof file === 'string' && /^\/tutorial\/[a-z0-9/_-]+\.(png|jpg|jpeg|webp|svg)$/u.test(file) && !file.includes('..') && !file.includes('//');
  return safe
    ? { kind: 'image', src: file, alt: screenshot.alt, caption: screenshot.caption }
    : { kind: 'placeholder', label: 'Captura pendiente', caption: screenshot.caption };
}

export const APP_ID_HINT = 'Pega tu ID de app arriba para activar este enlace directo';
export const LOGIN_REDIRECT_NOTE = 'Si no has iniciado sesión, Meta te pedirá entrar y luego te devolverá a esta misma página.';

export type ResolvedLink = { label: string; href: string | null; hint?: string };

/** Fills the `{APP_ID}` placeholder; a templated link without a valid app id is disabled (href null) with a hint. */
export function resolveLink(link: TutorialLink, appId: string | undefined): ResolvedLink {
  if (!link.url.includes(APP_ID_PLACEHOLDER)) return { label: link.label, href: link.url };
  if (!isValidAppId(appId)) return { label: link.label, href: null, hint: APP_ID_HINT };
  return { label: link.label, href: link.url.split(APP_ID_PLACEHOLDER).join(appId) };
}

export type AppIdInput = { kind: 'empty' } | { kind: 'valid'; value: string } | { kind: 'invalid' };

/** Interprets what the person typed in the «Tu ID de app» field. */
export function parseAppIdInput(text: string): AppIdInput {
  const value = text.trim();
  if (value === '') return { kind: 'empty' };
  return isValidAppId(value) ? { kind: 'valid', value } : { kind: 'invalid' };
}

export function externalLinkAttrs(): { target: '_blank'; rel: 'noopener noreferrer' } {
  return { target: '_blank', rel: 'noopener noreferrer' };
}

export type CopyDeps = {
  clipboard?: { writeText(value: string): Promise<void> };
  /** Synchronous textarea + execCommand path; returns whether it worked. */
  fallback?: (value: string) => boolean;
};

/** Copies text; never throws. Returns false when no method worked. */
export async function copyText(value: string, deps: CopyDeps): Promise<boolean> {
  if (deps.clipboard) {
    try { await deps.clipboard.writeText(value); return true; } catch { /* fall through to the fallback */ }
  }
  if (deps.fallback) {
    try { return deps.fallback(value) === true; } catch { return false; }
  }
  return false;
}

/** Browser-only fallback for copyText (used when navigator.clipboard is unavailable or denied). */
export function execCommandCopy(value: string): boolean {
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try { return document.execCommand('copy'); } finally { document.body.removeChild(area); }
}
