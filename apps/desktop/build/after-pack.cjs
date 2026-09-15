/**
 * electron-builder afterPack hook.
 *
 * The app ships UNSIGNED (no Apple Developer certificate / no notarization).
 * On Apple Silicon, a *completely* unsigned app is rejected by macOS as
 * "damaged and can't be opened". A valid **ad-hoc** signature (codesign --sign -)
 * satisfies the arm64 code-signing requirement while remaining unsigned in the
 * Developer-ID sense, so the app runs (Gatekeeper shows the normal
 * "unidentified developer" prompt; right-click > Open, or `xattr -cr`).
 *
 * This runs on the macOS build only; other platforms are untouched.
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename; // e.g. "PVE Console"
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  // Ad-hoc sign every nested binary and the app itself.
  execFileSync("codesign", ["--deep", "--force", "--sign", "-", appPath], {
    stdio: "inherit",
  });

  // Fail the build if the ad-hoc signature is not valid.
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
    stdio: "inherit",
  });

  console.log(`  • ad-hoc signed and verified ${appName}.app`);
};
