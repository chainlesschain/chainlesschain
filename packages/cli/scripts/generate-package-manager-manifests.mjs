#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function artifactFor(manifest, target) {
  const artifact = manifest.latest.artifacts.find(
    (item) => item.target === target,
  );
  if (!artifact) throw new Error(`missing release artifact: ${target}`);
  return artifact;
}

export function generatePackageManagerManifests(manifest) {
  const version = manifest?.latest?.cliVersion;
  if (!version) throw new Error("manifest.latest.cliVersion is required");
  const macX64 = artifactFor(manifest, "node20-macos-x64");
  const macArm64 = artifactFor(manifest, "node20-macos-arm64");
  const winX64 = artifactFor(manifest, "node20-win-x64");
  const winArm64 = artifactFor(manifest, "node20-win-arm64");
  const homebrew = `class Chainlesschain < Formula
  desc "Local-first AI coding agent and collaboration CLI"
  homepage "https://github.com/chainlesschain/chainlesschain"
  license "MIT"
  version "${version}"

  on_macos do
    on_intel do
      url "${macX64.url}", using: :nounzip
      sha256 "${macX64.sha256}"
    end
    on_arm do
      url "${macArm64.url}", using: :nounzip
      sha256 "${macArm64.sha256}"
    end
  end

  def install
    artifact = Dir["chainlesschain-node20-macos-*"].first
    bin.install artifact => "chainlesschain"
    bin.install_symlink "chainlesschain" => "cc"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/chainlesschain --version")
  end
end
`;
  const winget = `PackageIdentifier: ChainlessChain.ChainlessChainCLI
PackageVersion: ${version}
InstallerType: portable
Commands:
  - chainlesschain
  - cc
Installers:
  - Architecture: x64
    InstallerUrl: ${winX64.url}
    InstallerSha256: ${winX64.sha256.toUpperCase()}
  - Architecture: arm64
    InstallerUrl: ${winArm64.url}
    InstallerSha256: ${winArm64.sha256.toUpperCase()}
ManifestType: installer
ManifestVersion: 1.9.0
`;
  return { homebrew, winget };
}

function main() {
  const [manifestPath, outputDir] = process.argv.slice(2);
  if (!manifestPath || !outputDir) {
    throw new Error(
      "usage: generate-package-manager-manifests.mjs <update-manifest.json> <output-dir>",
    );
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(manifestPath), "utf8"),
  );
  const generated = generatePackageManagerManifests(manifest);
  fs.mkdirSync(path.resolve(outputDir), { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "chainlesschain.rb"),
    generated.homebrew,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "ChainlessChain.ChainlessChainCLI.installer.yaml"),
    generated.winget,
    "utf8",
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `package-manager manifest generation failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}
