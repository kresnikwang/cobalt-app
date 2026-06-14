/**
 * electron-builder afterPack hook.
 * Removes the wrong isolated-vm binary (ABI 127) from the packaged app,
 * so node-gyp-build falls through to the correct prebuild (ABI 125).
 */
const { rm, access } = require("fs/promises");
const { join } = require("path");
const { constants } = require("fs");

exports.default = async function (context) {
  const { appOutDir, packager } = context;
  const platform = packager.platform.nodeName; // "darwin"

  if (platform !== "darwin") return;

  const ivmDir = join(
    appOutDir,
    "Cobalt.app",
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "isolated-vm"
  );
  const buildRelease = join(ivmDir, "build", "Release");

  try {
    await access(buildRelease, constants.F_OK);
    await rm(buildRelease, { recursive: true, force: true });
    console.log("[afterPack] Removed isolated-vm build/Release/ (ABI 127) from packaged app");
  } catch {
    console.log("[afterPack] No isolated-vm build/Release/ in packaged app — already clean");
  }
};
