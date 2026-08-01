import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");

function workflow(name) {
  return fs.readFileSync(
    path.join(repositoryRoot, ".github", "workflows", name),
    "utf8",
  );
}

describe("CLI release workflow contracts", () => {
  it("gates npm production on exact-SHA matrices and one immutable tarball", () => {
    const text = workflow("npm-publish.yml");
    expect(text).not.toContain("skip_tests");
    expect(text).toContain("verify-release-gates.mjs");
    expect(text).toContain("CC_RELEASE_GATE_WAIT_MS");
    expect(text).toContain("npm-release-artifact.mjs create");
    expect(text).toContain('npm publish "$TARBALL"');
    expect(text).toContain("--provenance --access public");
    expect(text).toContain('npm pack "chainlesschain@$PKG_VER"');
    expect(text).toContain(
      "differs from exact-SHA package version $COMMITTED_VERSION",
    );
    expect(text).toMatch(/dry-run:[\s\S]*permissions:\s*\n\s*contents: read/);
  });

  it("runs both authoritative workflows for npm and native release tags", () => {
    for (const name of ["cli-ci.yml", "cli-strict-sandbox.yml"]) {
      const text = workflow(name);
      expect(text).toContain('- "v*"');
      expect(text).toContain('- "cli-v*"');
    }
  });

  it("requires all six signed native targets before publishing", () => {
    const text = workflow("cli-native-release.yml");
    for (const target of [
      "node20-linux-x64",
      "node20-linux-arm64",
      "node20-win-x64",
      "node20-win-arm64",
      "node20-macos-x64",
      "node20-macos-arm64",
    ]) {
      expect(text).toContain(target);
    }
    expect(text).toContain("verify-release-gates.mjs");
    expect(text).toContain("signtool.exe");
    expect(text).toContain("codesign --verify");
    expect(text).toContain("cosign sign-blob --yes");
    expect(text).toContain("CLI_UPDATE_ED25519_PRIVATE_KEY_B64");
    expect(text).toContain('test "$TAG" = "cli-v$VERSION"');
    expect(text).toContain('test "$(git rev-list -n 1 "$TAG")"');
    expect(text).not.toContain("releases/latest");
    expect(text).toContain("releases/download/cli-stable");
    expect(text).toContain("group: cli-native-release-stable");
    expect(text).toContain("blocked-pending-native-host-matrix");
    expect(text).toMatch(
      /publish:\s*\n\s*needs: \[release-readiness, exact-sha-gate, build\]/,
    );
    expect(text).toContain("verify-stable-channel-promotion.mjs");
    expect(text).toContain(
      'gh release edit "$TAG" --draft=false --latest=false',
    );
    expect(text).toContain("Stable channel has only one half");
    expect(
      text.lastIndexOf("chainlesschain-update.json.sigstore.json --clobber"),
    ).toBeLessThan(text.lastIndexOf("chainlesschain-update.json --clobber"));
  });
});
