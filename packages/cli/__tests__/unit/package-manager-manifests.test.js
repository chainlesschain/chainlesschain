import { describe, expect, it } from "vitest";
import { generatePackageManagerManifests } from "../../scripts/generate-package-manager-manifests.mjs";

function manifest() {
  const artifact = (target, hash) => ({
    target,
    url: `https://example.test/${target}`,
    sha256: hash.repeat(64),
  });
  return {
    latest: {
      cliVersion: "1.2.3",
      artifacts: [
        artifact("node20-macos-x64", "a"),
        artifact("node20-macos-arm64", "b"),
        artifact("node20-win-x64", "c"),
        artifact("node20-win-arm64", "d"),
      ],
    },
  };
}

describe("native package-manager metadata", () => {
  it("generates pinned Homebrew and WinGet manifests", () => {
    const generated = generatePackageManagerManifests(manifest());
    expect(generated.homebrew).toContain('version "1.2.3"');
    expect(generated.homebrew).toContain("node20-macos-arm64");
    expect(generated.homebrew).toContain(`sha256 "${"a".repeat(64)}"`);
    expect(generated.winget).toContain(
      "PackageIdentifier: ChainlessChain.ChainlessChainCLI",
    );
    expect(generated.winget).toContain("Architecture: arm64");
    expect(generated.winget).toContain("D".repeat(64));
  });

  it("fails instead of emitting a partial architecture set", () => {
    const partial = manifest();
    partial.latest.artifacts = partial.latest.artifacts.filter(
      (item) => item.target !== "node20-win-arm64",
    );
    expect(() => generatePackageManagerManifests(partial)).toThrow(
      /missing release artifact: node20-win-arm64/,
    );
  });
});
