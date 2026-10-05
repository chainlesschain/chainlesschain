#!/usr/bin/env bash
set -euo pipefail

# Keep npm outside the workspace: desktop installs can carry Electron bindings.
# Require the exact checkout before copying source into a fresh runner scratch tree.
: "${PDH_EXPECTED_SHA:?PDH_EXPECTED_SHA is required}"
: "${PDH_EVIDENCE_DIR:?PDH_EVIDENCE_DIR is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
test "$(git rev-parse HEAD)" = "$PDH_EXPECTED_SHA"
PDH_SCRATCH=$(mktemp -d "${RUNNER_TEMP}/pdh-native.XXXXXX")
mkdir -p "$PDH_EVIDENCE_DIR"
# Archive tracked source only: never copy workspace node_modules or Electron
# bindings. Include the real CLI executable and its exact local child candidates,
# plus the Python sidecar needed by the cross-package integration suites.
git archive HEAD \
  packages/cli packages/personal-data-hub packages/personal-data-hub-bridge \
  packages/context-memory-kernel packages/core-config packages/core-db \
  packages/core-env packages/core-infra packages/core-mtc packages/core-multisig \
  packages/session-core packages/shared-logger \
  scripts/android/pdh-sqlite-leaf-salvage.js docs/internal/pdh-app-data-catalog.json \
  .github/scripts/ci-install-cli-production-deps.sh .github/scripts/ci-npm-retry.sh \
  | tar -x -C "$PDH_SCRATCH"
# This existing installer validates exact child versions, supplies every internal
# dependency from this checkout, and rejects symlinks back into the source tree.
GITHUB_WORKSPACE="$PDH_SCRATCH" bash "$PDH_SCRATCH/.github/scripts/ci-install-cli-production-deps.sh"
(
  cd "$PDH_SCRATCH/packages/personal-data-hub-bridge"
  python -c "import forensics_bridge.ipc_server; print('Python sidecar import OK')"
)
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

# These suites must execute, not silently skip because the scratch layout lost
# its CLI binary, Python bridge, or native dependencies.
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const report = JSON.parse(fs.readFileSync(path.join(process.env.PDH_EVIDENCE_DIR, 'vitest-results.json'), 'utf8'));
for (const suite of [
  'e2e/local-data-adapters-cli.e2e.test.js',
  'sidecar-supervisor.test.js',
  'sidecar-contacts-cross-validate.test.js',
  'vault-derivation.test.js',
  'registry-derivation.test.js',
  'integration/derivation-projections.test.js',
]) {
  const result = report.testResults.find((entry) => entry.name.replaceAll('\\', '/').endsWith('/__tests__/' + suite));
  if (!result || !result.assertionResults.length || result.assertionResults.some((test) => test.status !== 'passed')) {
    throw new Error(`Required PDH release suite did not execute completely: ${suite}`);
  }
  console.log(`Required PDH release suite passed: ${suite} (${result.assertionResults.length} tests)`);
}
NODE
