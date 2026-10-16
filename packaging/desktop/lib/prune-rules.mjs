// Desktop (Electron) variant of the Windows payload prune rules (packaging/windows/lib/payload-rules.mjs, which stays
// the single source of truth): same rules, except that the node-llama-cpp CPU prebuilt kept is the one of the target
// platform and architecture instead of always win-x64.
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { isExcludedFromNextBuild, isPrunedFromNodeModules } from '../../windows/lib/payload-rules.mjs';

export { isExcludedFromNextBuild };

const LLAMA_PLATFORM = Object.freeze({ win32: 'win', linux: 'linux', darwin: 'mac' });

/** The `@node-llama-cpp/<name>` CPU prebuilt for an Electron platform/arch (e.g. linux + x64 -> linux-x64). */
export function llamaPrebuiltFor(platform, arch) {
  const prefix = LLAMA_PLATFORM[platform];
  if (!prefix) throw new Error(`unsupported platform ${platform}`);
  if (platform === 'darwin' && arch === 'arm64') return 'mac-arm64-metal'; // the only macOS arm64 build
  return `${prefix}-${arch}`;
}

/** The `@esbuild/<name>` native binary package for an Electron platform/arch (e.g. win32 + x64 -> win32-x64). */
export function esbuildPrebuiltFor(platform, arch) {
  if (!LLAMA_PLATFORM[platform]) throw new Error(`unsupported platform ${platform}`);
  if (!arch) throw new Error(`unsupported arch ${arch}`);
  return `${platform}-${arch}`;
}

/**
 * Throws when `node_modules/@esbuild/<platform>-<arch>` is missing from the packaged app (`tsx` cannot load without it).
 * @param {string} nodeModulesDir
 * @param {string} platform
 * @param {string} arch
 * @param {(path: string) => boolean} [exists]
 */
export function assertEsbuildPrebuilt(nodeModulesDir, platform, arch, exists = existsSync) {
  const pkg = esbuildPrebuiltFor(platform, arch);
  const target = join(nodeModulesDir, '@esbuild', pkg);
  if (!exists(target)) {
    throw new Error(
      `afterPack: @esbuild/${pkg} is missing from packaged node_modules (${target}); tsx cannot load without the ${pkg} esbuild binary`,
    );
  }
  return pkg;
}

/** @param {string} relativePath path relative to node_modules, platform separator */
export function isPrunedForDesktop(relativePath, keptLlamaPrebuilt, keptEsbuildPrebuilt) {
  const [first, second] = relativePath.split(sep);
  if (first === '@node-llama-cpp' && second !== undefined) return second !== keptLlamaPrebuilt;
  if (keptEsbuildPrebuilt && first === '@esbuild' && second !== undefined) return second !== keptEsbuildPrebuilt;
  return isPrunedFromNodeModules(relativePath);
}
