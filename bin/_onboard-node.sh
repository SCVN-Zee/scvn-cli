#!/usr/bin/env bash
#
# bin/_onboard-node.sh — guided Node install for a no-Node Mac (scvn's tier-3 fallback).
#
# Runs ONLY when bin/scvn finds neither a bundled nor a system Node >= 20 (rare: cross-arch bundle
# or clean machine). On success prints the absolute installed node path to STDOUT (exit 0) so the
# wrapper can exec it; all diagnostics go to STDERR. Never installs unattended: under -y or a
# non-TTY it only instructs and exits 1. Verifies the .pkg checksum BEFORE sudo.
#
# No `set -e` here — failures of the conditional probes are handled explicitly.
set -uo pipefail

# MUST equal PINNED_NODE_VERSION in src/services/node-dist.ts (a drift-guard test enforces this).
VER="24.16.0"

instruct() {
  printf 'scvn: Node >= 20 is required and was not found.\n' >&2
  printf 'scvn: install the macOS LTS from https://nodejs.org/  (or: brew install node), then re-run.\n' >&2
}

# Detect -y / --yes anywhere in the forwarded args.
auto_yes=0
for a in "$@"; do
  case "$a" in
    -y|--yes) auto_yes=1 ;;
  esac
done

# Cannot safely sudo-install unattended: instruct and fail.
if [ "$auto_yes" -eq 1 ] || [ ! -t 0 ]; then
  instruct
  exit 1
fi

printf 'scvn: Node >= 20 was not found. Download + install the official Node v%s now? [y/N] ' "$VER" >&2
read -r reply
case "$reply" in
  y|Y|yes|YES) ;;
  *) instruct; exit 1 ;;
esac

pkg="node-v${VER}.pkg"
base="https://nodejs.org/dist/v${VER}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf 'scvn: downloading %s/%s …\n' "$base" "$pkg" >&2
if ! curl -fSL "$base/$pkg" -o "$tmp/$pkg"; then
  printf 'scvn: download failed.\n' >&2
  instruct
  exit 1
fi

# Verify against the official checksum BEFORE sudo. Refuse to install if a hash can't be obtained.
expected="$(curl -fsSL "$base/SHASUMS256.txt" 2>/dev/null | grep "  ${pkg}\$" | awk '{print $1}')"
if ! printf '%s' "$expected" | grep -Eq '^[0-9a-f]{64}$'; then
  printf 'scvn: could not obtain a checksum for %s — refusing to install unverified.\n' "$pkg" >&2
  exit 1
fi
actual="$(shasum -a 256 "$tmp/$pkg" | awk '{print $1}')"
if [ "$actual" != "$expected" ]; then
  printf 'scvn: checksum mismatch for %s — refusing to install.\n' "$pkg" >&2
  exit 1
fi

printf 'scvn: installing (you may be prompted for your password) …\n' >&2
if ! sudo installer -pkg "$tmp/$pkg" -target /; then
  printf 'scvn: the installer failed or was cancelled.\n' >&2
  exit 1
fi

# The official pkg installs node to /usr/local/bin/node.
if [ -x /usr/local/bin/node ]; then
  printf '/usr/local/bin/node\n'
  exit 0
fi
if command -v node >/dev/null 2>&1; then
  command -v node
  exit 0
fi
printf 'scvn: install completed but node was not found — open a new terminal and re-run.\n' >&2
exit 1
