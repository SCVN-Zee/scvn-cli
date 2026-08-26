#!/usr/bin/env bash
# Tiered macOS build + sign + publish for the release workflows.
#
# Usage: build-sign-publish.sh <stable|beta>
#
# Signing tiers, in precedence order (first satisfied wins):
#   1. Apple Developer ID   (CSC_LINK set)          -> signed + notarized.
#        No first-run Gatekeeper friction; auto-update works.
#   2. Self-signed          (SCVN_SELFSIGN_P12 set) -> signed with a STABLE
#        self-signed cert. Auto-update works because Squirrel.Mac only requires
#        that an update satisfy the running app's code-signing designated
#        requirement (which pins this cert), NOT that it be Apple-notarized.
#        First run still shows "unidentified developer" (right-click -> Open).
#   3. Ad-hoc               (neither)               -> valid ad-hoc signature
#        (no "damaged" error) but CANNOT auto-update: ad-hoc pins a per-build
#        cdhash, so no later build can satisfy the prior build's requirement.
#
# Emits the step output `signed=true|false` (true for tiers 1 and 2). The caller
# keeps the electron-updater manifest + blockmaps only when signed=true, so an
# ad-hoc release never advertises an update it cannot install.
#
# Note on the empty-string trap: GitHub injects unset secrets as "" (defined but
# empty), so every gate below uses `[ -n ... ]`, never `[ -z ... ]` on a
# possibly-unset name.
set -euo pipefail

CHANNEL="${1:?usage: build-sign-publish.sh <stable|beta>}"
case "$CHANNEL" in
  stable) BASE="desktop:publish" ;;
  beta) BASE="desktop:publish:beta" ;;
  *) echo "::error::unknown channel '$CHANNEL' (expected stable|beta)"; exit 1 ;;
esac

emit_signed() { echo "signed=$1" >>"${GITHUB_OUTPUT:-/dev/stdout}"; }

if [ -n "${CSC_LINK:-}" ]; then
  echo "Signing mode: Apple Developer ID (signed + notarized)."
  emit_signed true
  npm run "$BASE"

elif [ -n "${SCVN_SELFSIGN_P12:-}" ]; then
  echo "Signing mode: self-signed (auto-update works; not notarized; first run needs right-click -> Open)."
  : "${SCVN_SELFSIGN_PASSWORD:?SCVN_SELFSIGN_PASSWORD is required alongside SCVN_SELFSIGN_P12}"

  KC="${RUNNER_TEMP:-/tmp}/scvn-selfsign.keychain-db"
  KCPASS="$(openssl rand -hex 20)"
  P12="${RUNNER_TEMP:-/tmp}/scvn-selfsign.p12"

  printf '%s' "$SCVN_SELFSIGN_P12" | base64 --decode >"$P12"
  security create-keychain -p "$KCPASS" "$KC"
  security set-keychain-settings -lut 21600 "$KC"
  security unlock-keychain -p "$KCPASS" "$KC"
  security import "$P12" -k "$KC" -P "$SCVN_SELFSIGN_PASSWORD" -T /usr/bin/codesign
  # Allow codesign to use the private key non-interactively.
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KCPASS" "$KC" >/dev/null
  # Make the identity resolvable to codesign via the user search list.
  security list-keychains -d user -s "$KC" $(security list-keychains -d user | sed 's/["[:space:]]//g')
  rm -f "$P12"

  # Reference the identity by its 40-hex SHA-1 (unambiguous; the cert is
  # untrusted so `find-identity -v` would hide it — omit -v).
  SCVN_SIGN_IDENTITY="$(security find-identity -p codesigning "$KC" \
    | sed -n 's/^[[:space:]]*[0-9][0-9]*) \([0-9A-F]\{40\}\) ".*/\1/p' | head -1)"
  if [ -z "$SCVN_SIGN_IDENTITY" ]; then
    echo "::error::no code-signing identity found in the imported .p12"
    exit 1
  fi
  export SCVN_SIGN_IDENTITY SCVN_SIGN_KEYCHAIN="$KC"

  # We sign via the custom mac.sign hook against the keychain above, NOT via
  # CSC_LINK. The workflow still injects CSC_LINK/APPLE_* for tier-1 detection,
  # and GitHub passes unset secrets as "" (defined-but-empty). electron-builder
  # treats an empty CSC_LINK as an explicit cert PATH and aborts ("<cwd> not a
  # file"), so clear the whole Apple/CSC env before building.
  unset CSC_LINK CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID 2>/dev/null || true
  export CSC_IDENTITY_AUTO_DISCOVERY=false

  emit_signed true
  npm run "$BASE:selfsigned"

else
  echo "Signing mode: ad-hoc (valid signature, but cannot auto-update)."
  # electron-builder treats a defined-but-empty CSC_LINK as an explicit cert
  # path; clear the partial signing env so it behaves like a clean ad-hoc build.
  unset CSC_LINK CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID 2>/dev/null || true
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  emit_signed false
  npm run "$BASE:adhoc"
fi
