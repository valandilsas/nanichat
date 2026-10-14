/**
 * Tutorial progress: pure helpers shared by the browser and the local API.
 * No imports on purpose, so the same file runs under Next.js and under tsx.
 * Stored as JSON in app_state under TUTORIAL_PROGRESS_KEY.
 */
export type TutorialPlatform = 'instagram' | 'facebook';
export type PlatformProgress = { currentStep: number; completed: string[] };
export type TutorialProgress = { version: 1; platforms: Partial<Record<TutorialPlatform, PlatformProgress>> };

export const TUTORIAL_PROGRESS_KEY = 'tutorial_progress';
export const TUTORIAL_PLATFORMS: ReadonlyArray<TutorialPlatform> = ['instagram', 'facebook'];
export const MAX_STEP_INDEX = 99;
export const MAX_COMPLETED = 40;
const STEP_ID = /^[a-z0-9-]{1,48}$/u;

export const EMPTY_PROGRESS: TutorialProgress = Object.freeze({ version: 1, platforms: Object.freeze({}) }) as TutorialProgress;

export function isValidStepId(value: unknown): value is string {
  return typeof value === 'string' && STEP_ID.test(value);
}

function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an object');
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlyArray<string>): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError('Unknown field');
}

function validatePlatform(value: unknown): PlatformProgress {
  const entry = plainObject(value);
  onlyKeys(entry, ['currentStep', 'completed']);
  const step = entry.currentStep;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 0 || step > MAX_STEP_INDEX) throw new TypeError('Invalid step');
  const completed = entry.completed;
  if (!Array.isArray(completed) || completed.length > MAX_COMPLETED) throw new TypeError('Invalid completed list');
  const ids: string[] = [];
  for (const id of completed) {
    if (!isValidStepId(id) || ids.includes(id)) throw new TypeError('Invalid step id');
    ids.push(id);
  }
  return { currentStep: step, completed: ids };
}

/** Strict validation: throws TypeError on any deviation, returns a fresh normalized copy. */
export function validateProgress(value: unknown): TutorialProgress {
  const root = plainObject(value);
  onlyKeys(root, ['version', 'platforms']);
  if (root.version !== 1) throw new TypeError('Unsupported version');
  const platforms: TutorialProgress['platforms'] = {};
  if (root.platforms !== undefined) {
    const raw = plainObject(root.platforms);
    for (const key of Object.keys(raw)) {
      if (!(TUTORIAL_PLATFORMS as ReadonlyArray<string>).includes(key)) throw new TypeError('Unknown platform');
      platforms[key as TutorialPlatform] = validatePlatform(raw[key]);
    }
  }
  return { version: 1, platforms };
}

/** Reads a stored value; anything missing, corrupt or invalid becomes empty progress. Never throws. */
export function parseStoredProgress(stored: string | null | undefined): TutorialProgress {
  if (typeof stored !== 'string' || !stored) return { version: 1, platforms: {} };
  try { return validateProgress(JSON.parse(stored)); } catch { return { version: 1, platforms: {} }; }
}

function entryOf(progress: TutorialProgress, platform: TutorialPlatform): PlatformProgress {
  const entry = progress.platforms[platform];
  return entry ? { currentStep: entry.currentStep, completed: [...entry.completed] } : { currentStep: 0, completed: [] };
}

function withEntry(progress: TutorialProgress, platform: TutorialPlatform, entry: PlatformProgress): TutorialProgress {
  return { version: 1, platforms: { ...progress.platforms, [platform]: entry } };
}

export function goTo(progress: TutorialProgress, platform: TutorialPlatform, index: number): TutorialProgress {
  const entry = entryOf(progress, platform);
  entry.currentStep = Math.min(MAX_STEP_INDEX, Math.max(0, Math.trunc(Number.isFinite(index) ? index : 0)));
  return withEntry(progress, platform, entry);
}

export function markCompleted(progress: TutorialProgress, platform: TutorialPlatform, stepId: string): TutorialProgress {
  if (!isValidStepId(stepId)) throw new TypeError('Invalid step id');
  const entry = entryOf(progress, platform);
  if (!entry.completed.includes(stepId) && entry.completed.length < MAX_COMPLETED) entry.completed.push(stepId);
  return withEntry(progress, platform, entry);
}

export function isCompleted(progress: TutorialProgress, platform: TutorialPlatform, stepId: string): boolean {
  return progress.platforms[platform]?.completed.includes(stepId) ?? false;
}

export function resetPlatform(progress: TutorialProgress, platform: TutorialPlatform): TutorialProgress {
  const platforms = { ...progress.platforms };
  delete platforms[platform];
  return { version: 1, platforms };
}

/** Whole-number percentage of completed steps; when knownIds is given, ids no longer in the content are ignored. */
export function percentComplete(progress: TutorialProgress, platform: TutorialPlatform, totalSteps: number, knownIds?: ReadonlyArray<string>): number {
  if (totalSteps <= 0) return 0;
  const completed = progress.platforms[platform]?.completed ?? [];
  const count = knownIds ? completed.filter((id) => knownIds.includes(id)).length : completed.length;
  return Math.min(100, Math.round((count / totalSteps) * 100));
}
