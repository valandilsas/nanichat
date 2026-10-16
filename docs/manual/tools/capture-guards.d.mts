export const RESERVED_PORTS: number[];
export const TUTORIAL_PLATFORMS: string[];
export const TUTORIAL_IMAGE_STEPS: Array<[string, string]>;
export function assertSafePort(port: number): number;
export function assertSafeDataDir(dir: string | undefined): string;
export function assertTutorialOutput(root: string, platform: string, stepId: string): string;
