#!/usr/bin/env bash
set -euo pipefail

# Build the standalone dependency tree that is copied beside the embedded CLI.
# Internal packages are installed from the exact checkout so CI can validate a
# coordinated version bump before those immutable versions reach npm.
repo_root="${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)}"
cli_dir="$repo_root/packages/cli"
retry_script="$repo_root/.github/scripts/ci-npm-retry.sh"
workspace_packages=(
  "$repo_root/packages/core-config"
  "$repo_root/packages/core-db"
  "$repo_root/packages/core-env"
  "$repo_root/packages/core-infra"
  "$repo_root/packages/core-mtc"
  "$repo_root/packages/core-multisig"
  "$repo_root/packages/personal-data-hub"
  "$repo_root/packages/session-core"
  "$repo_root/packages/shared-logger"
)

# Fail closed when the CLI's direct internal dependency set or an exact version
# diverges from the checked-out workspace packages. This prevents a missing
# package from silently falling back to an older registry release.
node --input-type=module - "$repo_root" "${workspace_packages[@]}" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const [, , repoRoot, ...workspaceDirectories] = process.argv;
const cliManifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "packages", "cli", "package.json"), "utf8"),
);
const expectedNames = Object.keys(cliManifest.dependencies)
  .filter((name) => name.startsWith("@chainlesschain/"))
  .sort();
const workspaceManifests = workspaceDirectories.map((directory) => ({
  directory,
  manifest: JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  ),
}));
const actualNames = workspaceManifests
  .map(({ manifest }) => manifest.name)
  .sort();

if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
  throw new Error(
    `CLI internal dependency set mismatch: expected ${expectedNames.join(", ")}; got ${actualNames.join(", ")}`,
  );
}

for (const { manifest } of workspaceManifests) {
  const expectedVersion = cliManifest.dependencies[manifest.name];
  if (expectedVersion !== manifest.version) {
    throw new Error(
      `${manifest.name} must match the CLI's exact version: expected ${expectedVersion}; got ${manifest.version}`,
    );
  }
}
NODE

(
  cd "$cli_dir"
  bash "$retry_script" npm install \
    "${workspace_packages[@]}" \
    --install-links \
    --no-package-lock \
    --no-save \
    --omit=dev \
    --workspaces=false \
    --legacy-peer-deps
)

# The packaged Resources tree cannot rely on links back to the monorepo.
node --input-type=module - "$cli_dir" "${workspace_packages[@]}" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const [, , cliDirectory, ...workspaceDirectories] = process.argv;
for (const directory of workspaceDirectories) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  const installedDirectory = path.join(
    cliDirectory,
    "node_modules",
    ...manifest.name.split("/"),
  );
  const installedManifest = JSON.parse(
    fs.readFileSync(path.join(installedDirectory, "package.json"), "utf8"),
  );
  if (installedManifest.version !== manifest.version) {
    throw new Error(
      `${manifest.name} install mismatch: expected ${manifest.version}; got ${installedManifest.version}`,
    );
  }
  if (fs.lstatSync(installedDirectory).isSymbolicLink()) {
    throw new Error(`${manifest.name} must be copied, not symlinked`);
  }
}
NODE
