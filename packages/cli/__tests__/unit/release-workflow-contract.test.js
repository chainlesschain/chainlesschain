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

  it("runs the complete MCP recovery authority matrix in the strict gate", () => {
    const text = workflow("cli-strict-sandbox.yml");
    const jobsStart = text.indexOf("\njobs:");
    expect(jobsStart).toBeGreaterThan(0);
    const triggers = text.slice(0, jobsStart);
    const jobs = text.slice(jobsStart);

    for (const source of [
      "packages/cli/src/lib/mcp-call-ledger-store.js",
      "packages/cli/src/lib/mcp-call-ledger.js",
      "packages/cli/src/lib/mcp-host-recovery-runtime.js",
      "packages/cli/src/lib/mcp-ledger-recovery-admission.js",
      "packages/cli/src/lib/mcp-recovery-adjudication.js",
      "packages/cli/src/lib/cowork-task-runner.js",
      "packages/cli/src/commands/session.js",
      "packages/cli/src/commands/session-mcp-recovery.js",
      "packages/cli/src/runtime/agent-core.js",
      "packages/cli/src/repl/agent-repl.js",
      "packages/cli/src/gateways/ws/session-protocol.js",
      "packages/cli/src/gateways/ws/ws-agent-handler.js",
    ]) {
      expect(triggers).toContain(`- "${source}"`);
    }

    for (const testFile of [
      "__tests__/unit/mcp-call-ledger.test.js",
      "__tests__/unit/mcp-call-ledger-store.test.js",
      "__tests__/unit/mcp-host-recovery-runtime.test.js",
      "__tests__/unit/mcp-ledger-recovery-admission.test.js",
      "__tests__/unit/mcp-recovery-adjudication.test.js",
      "__tests__/unit/mcp-recovery-adjudication-store.test.js",
      "__tests__/unit/session-mcp-recovery.test.js",
      "__tests__/unit/agent-core-mcp-ledger.test.js",
      "__tests__/unit/agent-repl.test.js",
      "__tests__/unit/headless-runner-mcp-ledger.test.js",
      "__tests__/unit/cowork-task-runner.test.js",
      "__tests__/unit/ws-runtime-events.test.js",
      "__tests__/integration/ws-bridge-side-effect-resume.test.js",
      "__tests__/integration/parity-mcp-invoke.test.js",
    ]) {
      expect(triggers).toContain(`packages/cli/${testFile}`);
      expect(jobs).toContain(testFile);
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
    expect(text).toContain("PUBLISHED_AT=$(git show -s --format=%cI");
    expect(text).toContain("sbom.metadata.timestamp = publishedAt");
    expect(text).toContain("sbom.serialNumber = `urn:uuid:");
    expect(text).toContain(
      'gh release edit "$TAG" --draft=false --latest=false',
    );
    expect(text).not.toContain("--clobber");

    const versionedStart = text.indexOf(
      "- name: Publish only after every platform and signature succeeds",
    );
    const stableStart = text.indexOf(
      "- name: Promote signed manifest to isolated stable channel",
    );
    const versioned = text.slice(versionedStart, stableStart);
    const stable = text.slice(stableStart);

    expect(versioned).toContain(
      "Existing versioned release lacks one complete signed manifest pair",
    );
    expect(versioned).toContain("cosign verify-blob");
    expect(versioned).toContain('result.action!=="idempotent"');
    expect(versioned).toContain(
      'cmp -s "native-assets/$asset" "$VERSIONED_ASSET_DIR/$asset"',
    );
    expect(versioned.indexOf("gh release download")).toBeLessThan(
      versioned.indexOf('cmp -s "native-assets/$asset"'),
    );
    expect(versioned.indexOf("cosign verify-blob")).toBeLessThan(
      versioned.indexOf("verify-stable-channel-promotion.mjs"),
    );
    expect(
      versioned.indexOf("verify-stable-channel-promotion.mjs"),
    ).toBeLessThan(versioned.indexOf('gh release upload "$TAG"'));

    expect(stable).toContain(
      "Stable channel has a manifest without its signature bundle",
    );
    expect(stable).toContain(
      'gh release delete-asset "$CHANNEL_TAG" chainlesschain-update.json --yes',
    );
    expect(stable).toContain('PROMOTION_ACTION" = "idempotent"');
    expect(stable).toContain(
      'cmp -s "native-assets/$asset" "$CHANNEL_ASSET_DIR/$asset"',
    );
    expect(stable.indexOf("cosign verify-blob")).toBeLessThan(
      stable.indexOf('cmp -s "native-assets/$asset"'),
    );
    expect(stable.indexOf("verify-stable-channel-promotion.mjs")).toBeLessThan(
      stable.indexOf('gh release upload "$CHANNEL_TAG"'),
    );
    expect(
      stable.lastIndexOf(
        "native-assets/chainlesschain-update.json.sigstore.json",
      ),
    ).toBeLessThan(
      stable.lastIndexOf("native-assets/chainlesschain-update.json"),
    );
  });
});
