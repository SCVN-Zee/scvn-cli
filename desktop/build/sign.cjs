"use strict";

// Custom electron-builder macOS signing hook (`mac.sign`).
//
// Signs the app with a STABLE self-signed certificate instead of an Apple
// Developer ID. This is what makes Squirrel.Mac auto-update work WITHOUT a paid
// Apple account: Squirrel validates that an update satisfies the running app's
// code-signing designated requirement (DR). A self-signed cert produces a DR of
// `identifier "<bundleid>" and certificate root = H"<hash>"`, which is identical
// across every build signed by the same cert — so v(N+1) always satisfies v(N)'s
// DR. (Ad-hoc signing pins a per-build `cdhash`, so it can never self-update.)
//
// Why a custom hook instead of electron-builder's built-in signing:
//   1. `security find-identity -v` lists only TRUSTED identities, so an
//      untrusted self-signed cert is invisible to electron-builder's identity
//      discovery.
//   2. electron-builder's CSC_LINK keychain automation is brittle on recent
//      macOS. Calling `codesign` directly against a keychain we prepared avoids
//      both problems.
//
// Env (set by the release workflow after importing the self-signed .p12):
//   SCVN_SIGN_IDENTITY  codesign identity — the cert's 40-hex SHA-1 (the CN also
//                       works; the workflow uses the hash as it is unambiguous)
//   SCVN_SIGN_KEYCHAIN  absolute path to the unlocked keychain holding the cert
//
// This hook is only invoked when the workflow opts into self-signing; the signed
// Developer ID path (real CSC_LINK/notarization) does not set `mac.sign`.

const { execFileSync } = require("node:child_process");

exports.default = async function sign(opts) {
  const appPath = opts && opts.app;
  const identity = process.env.SCVN_SIGN_IDENTITY;
  const keychain = process.env.SCVN_SIGN_KEYCHAIN;

  if (!appPath) {
    throw new Error("scvn sign hook: electron-builder passed no app path");
  }
  if (!identity || !keychain) {
    throw new Error(
      "scvn sign hook: SCVN_SIGN_IDENTITY and SCVN_SIGN_KEYCHAIN must be set",
    );
  }

  // `--deep` signs the nested Electron helpers/frameworks with the same cert in
  // one pass. Apple discourages `--deep` for notarized production builds, but
  // this path is self-signed and never notarized, and a single-cert deep sign is
  // exactly what yields a stable, self-consistent DR.
  execFileSync(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", identity, "--keychain", keychain, appPath],
    { stdio: "inherit" },
  );

  // Fail loudly if the bundle did not end up validly signed by our cert.
  execFileSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", appPath],
    { stdio: "inherit" },
  );
};
