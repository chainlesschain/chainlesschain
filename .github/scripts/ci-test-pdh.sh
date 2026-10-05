#!/usr/bin/env bash
set -euo pipefail

# Keep npm outside the workspace: desktop installs can carry Electron bindings.
# Require the exact checkout before copying source into a fresh runner scratch tree.
: "${PDH_EXPECTED_SHA:?PDH_EXPECTED_SHA is required}"
: "${PDH_EVIDENCE_DIR:?PDH_EVIDENCE_DIR is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
test "$(git rev-parse HEAD)" = "$PDH_EXPECTED_SHA"
PDH_SCRATCH=$(mktemp -d "${RUNNER_TEMP}/pdh-native.XXXXXX")
mkdir -p "$PDH_SCRATCH/packages/personal-data-hub" "$PDH_SCRATCH/packages/cli" \
  "$PDH_SCRATCH/scripts/android" "$PDH_SCRATCH/docs/internal" "$PDH_EVIDENCE_DIR"
cp -r packages/personal-data-hub/lib packages/personal-data-hub/__tests__ \
  packages/personal-data-hub/package.json packages/personal-data-hub/vitest.config.js \
  "$PDH_SCRATCH/packages/personal-data-hub/"
cp -r packages/cli/src "$PDH_SCRATCH/packages/cli/"
cp packages/cli/package.json "$PDH_SCRATCH/packages/cli/"
cp scripts/android/pdh-sqlite-leaf-salvage.js "$PDH_SCRATCH/scripts/android/"
cp docs/internal/pdh-app-data-catalog.json "$PDH_SCRATCH/docs/internal/"
# The ADB bridge imports the process broker, whose plugin discovery uses semver.
# Install that CLI dependency at the shared scratch root so sibling CLI sources
# can resolve it. Installing all CLI dependencies would require unreleased children.
node - "$PDH_SCRATCH" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const cli = JSON.parse(fs.readFileSync(path.join(root, 'packages/cli/package.json'), 'utf8'));
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
  private: true,
  dependencies: { semver: cli.dependencies.semver },
}));
NODE
npm install --prefix "$PDH_SCRATCH" --legacy-peer-deps --no-audit --no-fund --loglevel=warn
cd "$PDH_SCRATCH/packages/personal-data-hub"

# Prove cross-package imports resolve without any source-workspace node_modules.
node --input-type=module -e "await import('../cli/src/lib/knowledge-graph.js'); await import('../cli/src/lib/bm25-search.js'); await import('../cli/src/lib/host-adb-bridge.js')"

# Install the manifest's SQLCipher range (^12.5.0), without an Electron rebuild.
# Legacy peer resolution avoids optional Vitest browser peer placement failures.
npm install --legacy-peer-deps --no-audit --no-fund --loglevel=warn
# External SQLite adapters also need the plain driver (normally workspace-hoisted).
npm install --legacy-peer-deps --no-save --no-audit --no-fund better-sqlite3@11.10.0

# Opening both databases is mandatory: the PDH config otherwise excludes vault
# tests on ABI failure, and adapter tests can skip if the plain driver is absent.
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('./package.json');
const drivers = {};
for (const name of ['better-sqlite3-multiple-ciphers', 'better-sqlite3']) {
  const Database = require(name);
  const db = new Database(':memory:');
  try {
    if (db.prepare('SELECT 1 AS ok').get().ok !== 1) throw new Error(`${name}: query failed`);
  } finally {
    db.close();
  }
  drivers[name] = require(`${name}/package.json`).version;
}
const evidence = {
  commit: process.env.PDH_EXPECTED_SHA,
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  abi: process.versions.modules,
  packageVersion: manifest.version,
  declaredCipherRange: manifest.optionalDependencies['better-sqlite3-multiple-ciphers'],
  drivers,
};
const json = JSON.stringify(evidence, null, 2);
fs.writeFileSync(path.join(process.env.PDH_EVIDENCE_DIR, 'native-identity.json'), json + '\n');
console.log(json);
NODE

VITEST_ARGS=()
if [[ "${RUNNER_OS:-}" == "Windows" ]]; then
  # Bound native filesystem contention while retaining every test file.
  VITEST_ARGS+=(--pool=forks --maxWorkers=2)
fi
npx vitest run --reporter=default --reporter=json \
  --outputFile.json="$PDH_EVIDENCE_DIR/vitest-results.json" "${VITEST_ARGS[@]}"
