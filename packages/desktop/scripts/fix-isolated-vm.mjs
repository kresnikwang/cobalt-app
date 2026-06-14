/**
 * Fix isolated-vm native module for Electron 31 (ABI 125).
 *
 * Problem: pnpm install compiles isolated-vm against system Node.js (ABI 127),
 * creating `build/Release/isolated_vm.node`. node-gyp-build loads this first,
 * skipping the correct prebuild `isolated-vm.abi125.node` for Electron 31.
 *
 * Fix: Delete `build/Release/` so node-gyp-build falls through to prebuilds.
 *
 * Searches both packages/desktop/node_modules and root node_modules (pnpm hoisting).
 */
import { rm, access, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CWD = process.env.INIT_CWD || process.cwd();

/**
 * @param {string} ivmDir - path to isolated-vm directory
 * @returns {Promise<'fixed'|'skipped'|'missing'>}
 */
async function fixOne(ivmDir) {
  const buildRelease = join(ivmDir, 'build', 'Release');
  const prebuildAbi125 = join(ivmDir, 'prebuilds', 'darwin-arm64', 'isolated-vm.abi125.node');

  // Check if build/Release exists
  let hasBuild;
  try {
    await access(buildRelease, constants.F_OK);
    hasBuild = true;
  } catch {
    hasBuild = false;
  }

  if (!hasBuild) {
    return 'missing';
  }

  // Verify prebuild exists
  try {
    await access(prebuildAbi125, constants.F_OK);
  } catch {
    console.error(`[fix-isolated-vm] ERROR: ABI 125 prebuild not found at ${prebuildAbi125}`);
    return 'missing';
  }

  // Remove build/Release
  await rm(buildRelease, { recursive: true, force: true });
  console.log(`[fix-isolated-vm] Removed ${buildRelease} -> will use prebuild abi125`);
  return 'fixed';
}

/**
 * Find all isolated-vm installations in the project tree
 */
async function findIvmDirs() {
  const dirs = [];

  // 1. Desktop package local
  const desktopLocal = join(__dirname, '..', 'node_modules', 'isolated-vm');
  try { await access(desktopLocal, constants.F_OK); dirs.push(desktopLocal); } catch {}

  // 2. Root node_modules (pnpm hoisting)
  const rootNm = join(__dirname, '..', '..', '..', 'node_modules', 'isolated-vm');
  try { await access(rootNm, constants.F_OK); dirs.push(rootNm); } catch {}

  // 3. Also check .pnpm store for the exact version
  const pnpmDir = join(__dirname, '..', '..', '..', 'node_modules', '.pnpm');
  try {
    const entries = await readdir(pnpmDir);
    for (const entry of entries) {
      if (entry.startsWith('isolated-vm@') || entry.startsWith('isolated-vm+')) {
        const p = join(pnpmDir, entry, 'node_modules', 'isolated-vm');
        try { await access(p, constants.F_OK); dirs.push(p); } catch {}
      }
    }
  } catch {}

  return [...new Set(dirs)];
}

async function main() {
  const dirs = await findIvmDirs();
  console.log(`[fix-isolated-vm] Found ${dirs.length} isolated-vm installation(s)`);

  let fixedCount = 0;
  for (const dir of dirs) {
    const result = await fixOne(dir);
    if (result === 'fixed') fixedCount++;
  }

  if (fixedCount === 0) {
    console.log('[fix-isolated-vm] Nothing to fix (all clean)');
  } else {
    console.log(`[fix-isolated-vm] Fixed ${fixedCount} installation(s)`);
  }

  // If called as afterPack hook by electron-builder
  if (process.argv.includes('--after-pack')) {
    const contextArg = process.argv[process.argv.indexOf('--after-pack') + 1];
    if (contextArg) {
      const appOutDir = JSON.parse(contextArg).appOutDir;
      const unpackedIvm = join(appOutDir, '..', 'mac-arm64', 'Cobalt.app', 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'isolated-vm');
      try {
        await access(unpackedIvm, constants.F_OK);
        const result = await fixOne(unpackedIvm);
        console.log(`[fix-isolated-vm] AfterPack: ${result} for ${unpackedIvm}`);
      } catch {
        console.log(`[fix-isolated-vm] AfterPack: no unpacked isolated-vm at ${unpackedIvm}`);
      }
    }
  }
}

main().catch((e) => {
  console.error('[fix-isolated-vm] Unexpected error:', e);
  process.exit(1);
});
