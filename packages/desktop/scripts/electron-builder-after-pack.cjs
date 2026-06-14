/**
 * electron-builder afterPack hook.
 *
 * 1. Cleans isolated-vm directory:
 *    - Removes build/Release/ (ABI 127, compiled by system Node)
 *    - Removes .tgz/.tar archive files (contain unsigned .node binaries that
 *      Apple's notary service rejects)
 *    - Removes unused ABI prebuilds (keep only abi125 for Electron 31)
 *
 * 2. Signs all remaining .node binaries with the Developer ID certificate
 *    (required for macOS notarization).
 */
const { rm, access, readdir } = require("fs/promises");
const { join, extname } = require("path");
const { constants } = require("fs");
const { execSync } = require("child_process");

exports.default = async function (context) {
  const { appOutDir, packager } = context;
  const platform = packager.platform.nodeName;
  if (platform !== "darwin") return;

  const ivmDir = join(
    appOutDir, "Cobalt.app", "Contents", "Resources",
    "app.asar.unpacked", "node_modules", "isolated-vm"
  );
  const prebuildsDir = join(ivmDir, "prebuilds", "darwin-arm64");

  // ── 1. Remove build/Release/ (compiled for wrong ABI) ──
  const buildRelease = join(ivmDir, "build", "Release");
  try {
    await access(buildRelease, constants.F_OK);
    await rm(buildRelease, { recursive: true, force: true });
    console.log("[afterPack] Removed isolated-vm build/Release/");
  } catch {}

  // ── 2. Remove .tgz and .tar archive files ──
  try {
    const entries = await readdir(ivmDir);
    for (const entry of entries) {
      const ext = extname(entry);
      if (ext === '.tgz' || entry.endsWith('.tar')) {
        const p = join(ivmDir, entry);
        await rm(p, { recursive: true, force: true });
        console.log("[afterPack] Removed:", entry);
      }
    }
  } catch {}

  // ── 3. Keep only abi125.node in prebuilds (Electron 31) ──
  try {
    const prebuilds = await readdir(prebuildsDir);
    for (const entry of prebuilds) {
      if (entry.endsWith('.node') && !entry.includes('abi125')) {
        await rm(join(prebuildsDir, entry), { force: true });
        console.log("[afterPack] Removed unused prebuild:", entry);
      }
    }
  } catch {}

  // ── 4. Sign remaining .node binaries ──
  console.log("[afterPack] Signing .node binaries...");
  try {
    // Sign ffmpeg
    const ffmpegDir = join(
      appOutDir, "Cobalt.app", "Contents", "Resources",
      "app.asar.unpacked", "node_modules", "ffmpeg-static"
    );
    const ffmpegBin = join(ffmpegDir, "ffmpeg");
    try {
      await access(ffmpegBin, constants.F_OK);
      execSync(`codesign --force --sign "A3D0D2F6AB588511D0156428A74F1D9DD37C8144" --timestamp --options runtime "${ffmpegBin}"`, { stdio: "pipe" });
      console.log("[afterPack] Signed ffmpeg");
    } catch {}

    // Sign isolated-vm .node files
    const signRecursive = (dir) => {
      const fsSync = require("fs");
      try {
        const items = fsSync.readdirSync(dir);
        for (const item of items) {
          const full = join(dir, item);
          const stat = fsSync.statSync(full);
          if (stat.isDirectory()) {
            signRecursive(full);
          } else if (item.endsWith('.node')) {
            execSync(`codesign --force --sign "A3D0D2F6AB588511D0156428A74F1D9DD37C8144" --timestamp --options runtime "${full}"`, { stdio: "pipe" });
            console.log("[afterPack] Signed:", item);
          }
        }
      } catch {}
    };
    try { signRecursive(ivmDir); } catch {}
  } catch (e) {
    console.warn("[afterPack] Signing warning:", e.message);
  }

  console.log("[afterPack] Done.");
};
