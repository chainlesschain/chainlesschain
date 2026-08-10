import { describe, expect, it } from "vitest";
import {
  generatePackageManagerManifests,
  validatePackageManagerManifests,
  WINGET_MANIFEST_FILES,
} from "../../scripts/generate-package-manager-manifests.mjs";
import { nativePackageManagerContract } from "../../scripts/native-release-contract.mjs";

function manifest() {
  const artifact = (target, hash) => ({
    target,
    url: `https://example.test/${target}`,
    sha256: hash.repeat(64),
  });
  return {
    latest: {
      cliVersion: "1.2.3",
      packageManager: nativePackageManagerContract(),
      releaseNotes:
        "https://github.com/chainlesschain/chainlesschain/releases/tag/cli-v1.2.3",
      artifacts: [
        artifact("node22-macos-x64", "a"),
        artifact("node22-macos-arm64", "b"),
        artifact("node22-win-x64", "c"),
        artifact("node22-win-arm64", "d"),
      ],
    },
  };
}

describe("native package-manager metadata", () => {
  it("generates pinned Homebrew and complete WinGet manifests", () => {
    const source = manifest();
    const generated = generatePackageManagerManifests(source);
    expect(generated.homebrew).toContain('version "1.2.3"');
    expect(generated.homebrew).toContain("node22-macos-arm64");
    expect(generated.homebrew).toContain(`sha256 "${"a".repeat(64)}"`);
    expect(generated.wingetVersion).toContain("ManifestType: version");
    expect(generated.wingetVersion).toContain("DefaultLocale: en-US");
    expect(generated.wingetDefaultLocale).toContain(
      "ManifestType: defaultLocale",
    );
    expect(generated.wingetDefaultLocale).toContain(
      "ReleaseNotesUrl: https://github.com/chainlesschain/chainlesschain/releases/tag/cli-v1.2.3",
    );
    expect(generated.wingetInstaller).toContain(
      "PackageIdentifier: ChainlessChain.ChainlessChainCLI",
    );
    expect(generated.wingetInstaller).toContain("Architecture: arm64");
    expect(generated.wingetInstaller).toContain("D".repeat(64));
    expect(generated.winget).toBe(generated.wingetInstaller);
    expect(validatePackageManagerManifests(generated, source)).toEqual({
      version: "1.2.3",
      contractSchema: 2,
      generator: "chainlesschain.package-manager-manifests.v2",
      wingetFiles: { ...WINGET_MANIFEST_FILES },
      architectures: ["x64", "arm64"],
    });
  });

  it("fails instead of emitting a partial architecture set", () => {
    const partial = manifest();
    partial.latest.artifacts = partial.latest.artifacts.filter(
      (item) => item.target !== "node22-win-arm64",
    );
    expect(() => generatePackageManagerManifests(partial)).toThrow(
      /missing release artifact: node22-win-arm64/,
    );
  });

  it("rejects unsafe metadata before interpolating YAML or Ruby", () => {
    const unsafeVersion = manifest();
    unsafeVersion.latest.cliVersion = '1.2.3"\n  system "calc"';
    expect(() => generatePackageManagerManifests(unsafeVersion)).toThrow(
      /strict SemVer/,
    );

    const unsafeUrl = manifest();
    unsafeUrl.latest.artifacts[0].url =
      'https://example.test/file"\n  system "calc"';
    expect(() => generatePackageManagerManifests(unsafeUrl)).toThrow(
      /safe HTTPS URL/,
    );
  });

  it("rejects historical or future generator contracts without silently reinterpreting them", () => {
    const historical = manifest();
    historical.latest.packageManager.schema = 1;
    expect(() => generatePackageManagerManifests(historical)).toThrow(
      /package-manager contract schema mismatch/,
    );

    const future = manifest();
    future.latest.packageManager.generator =
      "chainlesschain.package-manager-manifests.v3";
    expect(() => generatePackageManagerManifests(future)).toThrow(
      /package-manager generator mismatch/,
    );

    const extended = manifest();
    extended.latest.packageManager.homebrew.tap = "attacker/tap";
    expect(() => generatePackageManagerManifests(extended)).toThrow(
      /unsupported fields/,
    );
  });

  it("rejects a locally changed WinGet architecture or digest", () => {
    const source = manifest();
    const generated = generatePackageManagerManifests(source);
    expect(() =>
      validatePackageManagerManifests(
        {
          ...generated,
          wingetInstaller: generated.wingetInstaller.replace(
            "Architecture: arm64",
            "Architecture: x86",
          ),
        },
        source,
      ),
    ).toThrow(/unexpected architecture x86/);

    expect(() =>
      validatePackageManagerManifests(
        {
          ...generated,
          wingetInstaller: generated.wingetInstaller.replace(
            "D".repeat(64),
            "E".repeat(64),
          ),
        },
        source,
      ),
    ).toThrow(/arm64 InstallerSha256 mismatch/);
  });
});
