'use strict';
// electron-builder afterPack hook: prunes the packaged production node_modules with the same rules as the Windows
// installer payload (see packaging/desktop/lib/prune-rules.mjs) before the AppImage/deb/NSIS targets are built.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// electron-builder's Arch enum (builder-util): ia32 = 0, x64 = 1, armv7l = 2, arm64 = 3, universal = 4.
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

function measure(target) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory()) return stat.size;
  let bytes = 0;
  for (const entry of fs.readdirSync(target)) bytes += measure(path.join(target, entry));
  return bytes;
}

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH_NAMES[context.arch] ?? String(context.arch);
  const { llamaPrebuiltFor, esbuildPrebuiltFor, assertEsbuildPrebuilt, isPrunedForDesktop } = await import(
    pathToFileURL(path.join(__dirname, 'lib', 'prune-rules.mjs')).href
  );
  const appDir = platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app')
    : path.join(context.appOutDir, 'resources', 'app');
  const nodeModules = path.join(appDir, 'node_modules');
  if (!fs.existsSync(nodeModules)) throw new Error(`afterPack: ${nodeModules} not found (is asar disabled?)`);

  const kept = llamaPrebuiltFor(platform, arch);
  const keptEsbuild = esbuildPrebuiltFor(platform, arch);
  let removedBytes = 0;
  let removedEntries = 0;
  const stack = [nodeModules];
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (isPrunedForDesktop(path.relative(nodeModules, full), kept, keptEsbuild)) {
        removedBytes += measure(full);
        removedEntries++;
        fs.rmSync(full, { recursive: true, force: true });
      } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push(full);
      }
    }
  }
  console.log(`  • afterPack pruned ${removedEntries} node_modules entries (${(removedBytes / 1024 / 1024).toFixed(1)} MB), kept @node-llama-cpp/${kept}`);

  const buildId = path.join(appDir, '.next', 'BUILD_ID');
  if (!fs.existsSync(buildId)) throw new Error(`afterPack: ${buildId} not found (did Next.js build get packaged?)`);
  for (const forbidden of ['@types', 'electron', 'electron-builder', 'typescript', '@typescript']) {
    if (fs.existsSync(path.join(nodeModules, forbidden))) {
      throw new Error(`afterPack: ${forbidden} must not be present in packaged node_modules`);
    }
  }

  const prebuilt = path.join(nodeModules, '@node-llama-cpp', kept);
  if (!fs.existsSync(prebuilt)) {
    const message = `afterPack: @node-llama-cpp/${kept} is missing; the local AI engine will not work in this build`;
    // npm installs only the prebuilts matching the build machine, so a cross-build (e.g. Windows on Linux) lacks it.
    if (process.platform === platform) throw new Error(message);
    console.warn(`  • WARNING ${message} (cross-build from ${process.platform}; build on ${platform} for a release)`);
  }

  try {
    assertEsbuildPrebuilt(nodeModules, platform, arch);
  } catch (error) {
    if (process.platform !== platform) {
      fs.rmSync(context.appOutDir, { recursive: true, force: true });
    }
    throw error;
  }
};
