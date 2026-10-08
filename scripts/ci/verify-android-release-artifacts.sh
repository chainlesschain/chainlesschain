#!/usr/bin/env bash
set -Eeuo pipefail

ANDROID_PROJECT_ROOT=${1:?Pass the Android project directory}
DIAGNOSTICS_ROOT=${2:?Pass the diagnostics directory}
SCRIPT_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
mkdir -p "$DIAGNOSTICS_ROOT"
DIAGNOSTICS_ROOT=$(cd -- "$DIAGNOSTICS_ROOT" && pwd -P)
STAGE=initialization

sanitize_diagnostics() {
  node - "$DIAGNOSTICS_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const sanitized = path.join(root, 'sanitized');
fs.mkdirSync(sanitized, { recursive: true });
const secrets = ['KEYSTORE_PASSWORD', 'KEY_ALIAS'].map(key => process.env[key]).filter(Boolean);
for (const name of fs.readdirSync(root)) {
  const file = path.join(root, name);
  if (!fs.statSync(file).isFile()) continue;
  let text = fs.readFileSync(file, 'utf8');
  for (const secret of secrets) text = text.split(secret).join('***');
  fs.writeFileSync(path.join(sanitized, name), text);
}
NODE
}

on_error() {
  local status=$? line=$1
  trap - ERR
  printf '::error::Android release verification failed at stage %s (line %s, exit %s)\n' "$STAGE" "$line" "$status"
  printf 'stage=%s\nline=%s\nexit=%s\n' "$STAGE" "$line" "$status" > "$DIAGNOSTICS_ROOT/failure.txt"
  sanitize_diagnostics || true
  exit "$status"
}
trap 'on_error "$LINENO"' ERR

cd -- "$ANDROID_PROJECT_ROOT"
STAGE=release-signing-mode
test "${SIGNING_TYPE:-}" = release
STAGE=bundle-manifest
EXPECTED_BUNDLE=$(awk '$1 ~ /^[0-9a-f]+$/ && length($1) == 64 && $2 == "cc-cli.tgz" { print $1 }' binaries-manifest.txt)
test "${#EXPECTED_BUNDLE}" -eq 64

STAGE=apksigner-tool-discovery
APKSIGNER=$(find -L "${ANDROID_HOME:?}/build-tools" -name apksigner -type f -executable | sort -V | tail -n 1)
test -n "$APKSIGNER"
test -x "$APKSIGNER"
printf 'tool=%s\n' "$APKSIGNER" > "$DIAGNOSTICS_ROOT/tool.txt"

STAGE=release-certificate-export
keytool -exportcert -rfc -keystore keystore.jks -alias "${KEY_ALIAS:?}" \
  -storepass:env KEYSTORE_PASSWORD > "$DIAGNOSTICS_ROOT/release-certificate.pem" 2> "$DIAGNOSTICS_ROOT/certificate-export.txt"
EXPECTED_CERT=$(openssl x509 -in "$DIAGNOSTICS_ROOT/release-certificate.pem" -outform DER | sha256sum | cut -d ' ' -f1)
test "${#EXPECTED_CERT}" -eq 64

for name in app-arm64-v8a-release.apk app-armeabi-v7a-release.apk app-universal-release.apk; do
  apk="app/build/outputs/apk/release/$name"
  STAGE="apk-presence:$name"
  test -s "$apk"
  STAGE="apk-signature:$name"
  "$APKSIGNER" verify --verbose --print-certs "$apk" > "$DIAGNOSTICS_ROOT/$name-signature.txt" 2>&1
  STAGE="apk-certificate:$name"
  node "$SCRIPT_ROOT/../verify-android-release-signature.cjs" "$DIAGNOSTICS_ROOT/$name-signature.txt" "$EXPECTED_CERT" > "$DIAGNOSTICS_ROOT/$name-signers.json"
  STAGE="apk-bundle:$name"
  ACTUAL_BUNDLE=$(unzip -p "$apk" assets/local-terminal/cc-cli.tgz | sha256sum | cut -d ' ' -f1)
  test "$ACTUAL_BUNDLE" = "$EXPECTED_BUNDLE"
  printf 'bundle-sha256=%s\n' "$ACTUAL_BUNDLE" > "$DIAGNOSTICS_ROOT/$name-bundle.txt"
  echo "Verified release signature, certificate identity and pinned CLI bundle: $name"
done

aab=app/build/outputs/bundle/release/app-release.aab
STAGE="aab-presence"
test -s "$aab"
STAGE="aab-signature"
jarsigner -verify -strict -keystore keystore.jks -storepass:env KEYSTORE_PASSWORD \
  "$aab" "$KEY_ALIAS" > "$DIAGNOSTICS_ROOT/aab-signature.txt" 2>&1
grep -q 'jar verified\.' "$DIAGNOSTICS_ROOT/aab-signature.txt"
STAGE="aab-certificate"
keytool -printcert -jarfile "$aab" -rfc > "$DIAGNOSTICS_ROOT/aab-certificate.pem" 2> "$DIAGNOSTICS_ROOT/aab-certificate-export.txt"
ACTUAL_CERT=$(openssl x509 -in "$DIAGNOSTICS_ROOT/aab-certificate.pem" -outform DER | sha256sum | cut -d ' ' -f1)
test "$ACTUAL_CERT" = "$EXPECTED_CERT"
STAGE="aab-bundle"
ACTUAL_BUNDLE=$(unzip -p "$aab" base/assets/local-terminal/cc-cli.tgz | sha256sum | cut -d ' ' -f1)
test "$ACTUAL_BUNDLE" = "$EXPECTED_BUNDLE"
printf 'bundle-sha256=%s\n' "$ACTUAL_BUNDLE" > "$DIAGNOSTICS_ROOT/aab-bundle.txt"
STAGE=complete
printf 'stage=complete\n' > "$DIAGNOSTICS_ROOT/result.txt"
sanitize_diagnostics
echo 'Verified release signature, certificate identity and pinned CLI bundle: app-release.aab'
