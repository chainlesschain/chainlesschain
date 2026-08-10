#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  assertNativePackageManagerContract,
  assertStrictSemver,
  NATIVE_PACKAGE_MANAGER_CONTRACT,
  WINGET_MANIFEST_FILES,
  WINGET_MANIFEST_VERSION,
  WINGET_PACKAGE_IDENTIFIER,
} from "./native-release-contract.mjs";

export {
  NATIVE_PACKAGE_MANAGER_CONTRACT,
  WINGET_MANIFEST_FILES,
  WINGET_MANIFEST_VERSION,
  WINGET_PACKAGE_IDENTIFIER,
};

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_HTTPS_URL_PATTERN =
  /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/u;

function assertExact(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${expected}, received ${actual ?? "missing"}`,
    );
  }
}

function assertHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    parsed = null;
  }
  if (
    typeof value !== "string" ||
    !SAFE_HTTPS_URL_PATTERN.test(value) ||
    parsed?.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash
  ) {
    throw new Error(`${label} must be a safe HTTPS URL`);
  }
  return value;
}

function assertReleaseArtifact(artifact, target) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error(`release artifact ${target} must be an object`);
  }
  assertExact(artifact.target, target, "release artifact target");
  assertHttpsUrl(artifact.url, `${target} URL`);
  if (!SHA256_PATTERN.test(String(artifact.sha256 || ""))) {
    throw new Error(`${target} sha256 must be 64 lowercase hexadecimal bytes`);
  }
  return artifact;
}

function artifactFor(manifest, target) {
  const artifact = manifest.latest.artifacts.find(
    (item) => item.target === target,
  );
  if (!artifact) throw new Error(`missing release artifact: ${target}`);
  return assertReleaseArtifact(artifact, target);
}

function parseSingleYaml(text, label) {
  let documents = 0;
  let value;
  yaml.safeLoadAll(text, (document) => {
    documents += 1;
    value = document;
  });
  if (documents !== 1 || !value || typeof value !== "object") {
    throw new Error(`${label} must contain exactly one YAML object`);
  }
  return value;
}

function assertManifestIdentity(document, version, type, label) {
  assertExact(
    document.PackageIdentifier,
    WINGET_PACKAGE_IDENTIFIER,
    `${label} PackageIdentifier`,
  );
  assertExact(document.PackageVersion, version, `${label} PackageVersion`);
  assertExact(document.ManifestType, type, `${label} ManifestType`);
  assertExact(
    document.ManifestVersion,
    WINGET_MANIFEST_VERSION,
    `${label} ManifestVersion`,
  );
}

export function validatePackageManagerManifests(generated, manifest) {
  const version = manifest?.latest?.cliVersion;
  assertStrictSemver(version, "manifest.latest.cliVersion");
  assertNativePackageManagerContract(manifest?.latest?.packageManager);
  const macX64 = artifactFor(manifest, "node22-macos-x64");
  const macArm64 = artifactFor(manifest, "node22-macos-arm64");
  const winX64 = artifactFor(manifest, "node22-win-x64");
  const winArm64 = artifactFor(manifest, "node22-win-arm64");
  const versionDocument = parseSingleYaml(
    generated.wingetVersion,
    "WinGet version manifest",
  );
  const localeDocument = parseSingleYaml(
    generated.wingetDefaultLocale,
    "WinGet defaultLocale manifest",
  );
  const installerDocument = parseSingleYaml(
    generated.wingetInstaller,
    "WinGet installer manifest",
  );

  assertManifestIdentity(
    versionDocument,
    version,
    "version",
    "WinGet version manifest",
  );
  assertExact(versionDocument.DefaultLocale, "en-US", "WinGet DefaultLocale");
  assertManifestIdentity(
    localeDocument,
    version,
    "defaultLocale",
    "WinGet defaultLocale manifest",
  );
  assertExact(localeDocument.PackageLocale, "en-US", "WinGet PackageLocale");
  for (const field of [
    "Publisher",
    "PackageName",
    "License",
    "ShortDescription",
  ]) {
    if (typeof localeDocument[field] !== "string" || !localeDocument[field]) {
      throw new Error(`WinGet defaultLocale manifest requires ${field}`);
    }
  }
  for (const field of [
    "PublisherUrl",
    "PublisherSupportUrl",
    "PackageUrl",
    "LicenseUrl",
    "ReleaseNotesUrl",
  ]) {
    assertHttpsUrl(localeDocument[field], `WinGet ${field}`);
  }

  assertManifestIdentity(
    installerDocument,
    version,
    "installer",
    "WinGet installer manifest",
  );
  assertExact(
    installerDocument.InstallerType,
    "portable",
    "WinGet InstallerType",
  );
  if (
    !Array.isArray(installerDocument.Commands) ||
    installerDocument.Commands.join(",") !== "chainlesschain,cc"
  ) {
    throw new Error("WinGet Commands must be exactly chainlesschain and cc");
  }
  const installers = Array.isArray(installerDocument.Installers)
    ? installerDocument.Installers
    : [];
  const expectedInstallers = new Map([
    ["x64", winX64],
    ["arm64", winArm64],
  ]);
  if (installers.length !== expectedInstallers.size) {
    throw new Error("WinGet installer manifest requires exactly x64 and arm64");
  }
  for (const installer of installers) {
    const expected = expectedInstallers.get(installer.Architecture);
    if (!expected) {
      throw new Error(
        `WinGet installer has unexpected architecture ${installer.Architecture}`,
      );
    }
    assertExact(
      installer.InstallerUrl,
      expected.url,
      `${installer.Architecture} InstallerUrl`,
    );
    assertExact(
      installer.InstallerSha256,
      expected.sha256.toUpperCase(),
      `${installer.Architecture} InstallerSha256`,
    );
    expectedInstallers.delete(installer.Architecture);
  }
  if (expectedInstallers.size !== 0) {
    throw new Error("WinGet installer manifest has a duplicate architecture");
  }

  if (
    typeof generated.homebrew !== "string" ||
    !generated.homebrew.includes(`version "${version}"`) ||
    !generated.homebrew.includes(`url "${macX64.url}"`) ||
    !generated.homebrew.includes(`url "${macArm64.url}"`) ||
    !generated.homebrew.includes(`sha256 "${macX64.sha256}"`) ||
    !generated.homebrew.includes(`sha256 "${macArm64.sha256}"`)
  ) {
    throw new Error("Homebrew formula does not bind both macOS artifacts");
  }
  return {
    version,
    contractSchema: NATIVE_PACKAGE_MANAGER_CONTRACT.schema,
    generator: NATIVE_PACKAGE_MANAGER_CONTRACT.generator,
    wingetFiles: { ...WINGET_MANIFEST_FILES },
    architectures: ["x64", "arm64"],
  };
}

export function generatePackageManagerManifests(manifest) {
  const version = manifest?.latest?.cliVersion;
  assertStrictSemver(version, "manifest.latest.cliVersion");
  assertNativePackageManagerContract(manifest?.latest?.packageManager);
  const macX64 = artifactFor(manifest, "node22-macos-x64");
  const macArm64 = artifactFor(manifest, "node22-macos-arm64");
  const winX64 = artifactFor(manifest, "node22-win-x64");
  const winArm64 = artifactFor(manifest, "node22-win-arm64");
  const releaseNotesUrl = assertHttpsUrl(
    manifest.latest.releaseNotes ||
      `https://github.com/chainlesschain/chainlesschain/releases/tag/cli-v${version}`,
    "release notes URL",
  );
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
    artifact = Dir["chainlesschain-node22-macos-*"].first
    bin.install artifact => "chainlesschain"
    bin.install_symlink "chainlesschain" => "cc"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/chainlesschain --version")
  end
end
`;
  const wingetVersion = `PackageIdentifier: ${WINGET_PACKAGE_IDENTIFIER}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${WINGET_MANIFEST_VERSION}
`;
  const wingetDefaultLocale = `PackageIdentifier: ${WINGET_PACKAGE_IDENTIFIER}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: ChainlessChain
PublisherUrl: https://github.com/chainlesschain
PublisherSupportUrl: https://github.com/chainlesschain/chainlesschain/issues
Author: ChainlessChain Team
PackageName: ChainlessChain CLI
PackageUrl: https://github.com/chainlesschain/chainlesschain
License: MIT
LicenseUrl: https://github.com/chainlesschain/chainlesschain/blob/main/LICENSE
ShortDescription: Local-first AI coding agent and collaboration CLI
Tags:
  - ai
  - cli
  - coding-agent
  - local-first
ReleaseNotesUrl: ${releaseNotesUrl}
ManifestType: defaultLocale
ManifestVersion: ${WINGET_MANIFEST_VERSION}
`;
  const wingetInstaller = `PackageIdentifier: ${WINGET_PACKAGE_IDENTIFIER}
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
ManifestVersion: ${WINGET_MANIFEST_VERSION}
`;
  const generated = {
    contract: {
      schema: NATIVE_PACKAGE_MANAGER_CONTRACT.schema,
      generator: NATIVE_PACKAGE_MANAGER_CONTRACT.generator,
    },
    homebrew,
    wingetVersion,
    wingetDefaultLocale,
    wingetInstaller,
    // Keep the old property as a read-only compatibility view for callers that
    // only inspected the installer manifest before the complete set existed.
    winget: wingetInstaller,
  };
  validatePackageManagerManifests(generated, manifest);
  return generated;
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
    path.join(outputDir, WINGET_MANIFEST_FILES.version),
    generated.wingetVersion,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, WINGET_MANIFEST_FILES.defaultLocale),
    generated.wingetDefaultLocale,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, WINGET_MANIFEST_FILES.installer),
    generated.wingetInstaller,
    "utf8",
  );
  process.stdout.write(
    `generated Homebrew formula and validated WinGet manifest set for ${manifest.latest.cliVersion}\n`,
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
