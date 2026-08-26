#!/usr/bin/env bash
# Generate a STABLE self-signed macOS code-signing certificate for the
# no-Apple-Developer-ID auto-update path, then print the two GitHub secrets to
# set. Run this ONCE and reuse the same certificate forever.
#
#   ./.github/scripts/gen-selfsign-cert.sh [output.p12]
#
# Why "reuse forever": macOS auto-update (Squirrel.Mac) accepts an update only
# if it satisfies the running app's code-signing designated requirement, which
# pins THIS certificate. Signing a later release with a different cert makes
# every existing install refuse the update.
#
# Set the printed values as repository secrets
# (Settings -> Secrets and variables -> Actions):
#   SCVN_SELFSIGN_P12       base64 of the generated .p12
#   SCVN_SELFSIGN_PASSWORD  the .p12 password
#
# Keep the .p12 and password in a safe place (a password manager). Anyone with
# them can sign updates that existing installs will accept.
set -euo pipefail

OUT="${1:-scvn-selfsign.p12}"
PASS="${SCVN_SELFSIGN_PASSWORD:-$(openssl rand -hex 16)}"
CN="${SCVN_SELFSIGN_CN:-SCVN Self-Signed Updater}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = $CN
O  = Supercent VN
[v3]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/cert.cnf" >/dev/null 2>&1
openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -out "$OUT" -passout "pass:$PASS" -name "$CN" >/dev/null 2>&1

echo "Wrote $OUT (CN: $CN)"
echo
echo "Set these repository secrets:"
echo "  SCVN_SELFSIGN_PASSWORD = $PASS"
echo "  SCVN_SELFSIGN_P12      = (base64 below, paste verbatim)"
echo "-------------------- SCVN_SELFSIGN_P12 --------------------"
base64 <"$OUT"
echo "-----------------------------------------------------------"
echo "Reuse the SAME $OUT for every future release."
