import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
    expect(text).toContain('- "v-npm-*"');
    expect(text).not.toContain('- "v*"');
    expect(text).not.toContain('- "v-packages-*"');
    expect(text).toContain("verify-release-gates.mjs");
    expect(text).toContain("Verify immutable npm tag identity");
    expect(text).toContain('EXPECTED_REF="refs/tags/v-npm-${VERSION//./-}"');
    expect(text).toContain('[ "$GITHUB_REF" != "$EXPECTED_REF" ]');
    expect(text).toContain("CC_RELEASE_GATE_WAIT_MS");
    expect(text).toContain("npm-release-artifact.mjs create");
    expect(text).toContain('npm publish "$TARBALL"');
    expect(text).toContain("--provenance --access public");
    expect(text).toContain('npm pack "chainlesschain@$PKG_VER"');
    expect(text).toContain(
      "differs from exact-SHA package version $COMMITTED_VERSION",
    );
    expect(text).toMatch(/dry-run:[\s\S]*permissions:\s*\n\s*contents: read/);

    const packageJobStart = text.indexOf("  package-cli:");
    const packageJob = text.slice(
      packageJobStart,
      text.indexOf("\n  dry-run:", packageJobStart),
    );
    const beforePack = packageJob.slice(
      0,
      packageJob.indexOf("npm pack --json"),
    );
    const packageCommands = beforePack
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    const cliPackage = JSON.parse(
      fs.readFileSync(
        path.join(repositoryRoot, "packages", "cli", "package.json"),
        "utf8",
      ),
    );
    const prepublishCommands = cliPackage.scripts.prepublishOnly
      .split(/\s*&&\s*/u)
      .filter(Boolean);
    expect(prepublishCommands).toContain("npm run build:web-panel");
    for (const command of prepublishCommands) {
      if (command === "npm run build:web-panel") continue;
      expect(packageCommands).toContain(command);
    }
    expect(packageCommands).toContain("npm run build:web-panel:force");
    expect(packageCommands).not.toContain("npm run build:web-panel");
    expect(packageJob.indexOf("npm run build:web-panel:force")).toBeLessThan(
      packageJob.indexOf("npm pack --json"),
    );
    expect(packageJob.indexOf("npm pack --json")).toBeLessThan(
      packageJob.indexOf("npm-release-artifact.mjs create"),
    );
    expect(packageJob).toContain("PACK_METADATA=$(mktemp)");
    expect(packageJob).toContain('readFileSync(process.argv[1], "utf8")');
    expect(packageJob).not.toContain("JSON.parse(process.argv[1])");

    const cliPublish = text.slice(
      text.indexOf('- name: "Publish chainlesschain (CLI)"'),
      text.indexOf("      - name: Publish summary"),
    );
    expect(cliPublish).toContain('find "$GITHUB_WORKSPACE/release-artifacts"');
    expect(cliPublish).not.toContain("TARBALL=$(find release-artifacts");
    expect(cliPublish.indexOf("npm-release-artifact.mjs verify")).toBeLessThan(
      cliPublish.indexOf('npm publish "$TARBALL"'),
    );
  });

  it("runs both authoritative workflows for npm and native release tags", () => {
    for (const name of ["cli-ci.yml", "cli-strict-sandbox.yml"]) {
      const text = workflow(name);
      expect(text).toContain('- "v*"');
      expect(text).toContain('- "cli-v*"');
    }
  });

  it("keeps generic workspace publishing outside the CLI release authority", () => {
    const generic = workflow("workspace-npm-publish.yml");
    const detector = fs.readFileSync(
      path.join(
        repositoryRoot,
        "scripts",
        "ci",
        "detect-publishable-packages.mjs",
      ),
      "utf8",
    );

    expect(generic).toContain("name: Publish workspace packages to npm");
    expect(generic).toContain('- "v-packages-*"');
    expect(generic).toContain('- "v[0-9]*.*.*"');
    expect(generic).not.toContain('- "v*"');
    expect(generic).toContain('[ "$pkg_dir" = "cli" ]');
    expect(generic).toContain('[ "$PKG_NAME" = "chainlesschain" ]');
    expect(detector).toContain(
      'const PROTECTED_PACKAGE_NAMES = new Set(["chainlesschain"]);',
    );
    expect(detector).toContain(
      'const PROTECTED_PACKAGE_DIRS = new Set(["cli"]);',
    );
    expect(detector).toContain(
      "must use the dedicated exact-SHA CLI release workflow",
    );
  });

  it("makes product releases consume, never create, an authorized CLI release", () => {
    const product = workflow("release.yml");
    expect(product).toContain("verify-cli-release:");
    expect(product).toContain("Verify authorized CLI release precondition");
    expect(product).toContain('TAG="v-npm-${VERSION//./-}"');
    expect(product).toContain('git show "${TAG}:packages/cli/package.json"');
    expect(product).toContain('git checkout --detach "$TAG_SHA"');
    expect(product).toContain('GITHUB_SHA="$TAG_SHA"');
    expect(product).toContain("verify-release-gates.mjs");
    expect(product).toContain("Registry gitHead does not match");
    expect(product).toContain(
      "needs: [create-release, verify-cli-release, update-changelog]",
    );
    expect(product).not.toContain("publish-cli:");
    expect(product).not.toContain("- name: Publish CLI to npm");
    expect(product).not.toContain("skip_tests");
  });

  it("keeps local generic publish scripts outside the CLI authority", () => {
    for (const name of ["npm-publish.js", "npm-publish.mjs"]) {
      const source = fs.readFileSync(
        path.join(repositoryRoot, "scripts", name),
        "utf8",
      );
      const order = source.match(/const publishOrder = \[([\s\S]*?)\];/u)?.[1];
      expect(order, name).toBeTypeOf("string");
      expect(order, name).not.toMatch(/["']cli["']/u);
      expect(source, name).toContain("protected-cli-package");
      expect(source, name).toContain("v-npm exact-SHA workflow");
    }
  });

  it("excludes the CLI from generic tag detection and rejects explicit selection", () => {
    const tempRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "cc-generic-publish-")),
    );

    try {
      const scriptDir = path.join(tempRoot, "scripts", "ci");
      const cliDir = path.join(tempRoot, "packages", "cli");
      const coreDir = path.join(tempRoot, "packages", "core-env");
      fs.mkdirSync(scriptDir, { recursive: true });
      fs.mkdirSync(cliDir, { recursive: true });
      fs.mkdirSync(coreDir, { recursive: true });
      fs.copyFileSync(
        path.join(
          repositoryRoot,
          "scripts",
          "ci",
          "detect-publishable-packages.mjs",
        ),
        path.join(scriptDir, "detect-publishable-packages.mjs"),
      );
      fs.writeFileSync(
        path.join(cliDir, "package.json"),
        JSON.stringify({ name: "chainlesschain", version: "9.9.9" }),
      );
      fs.writeFileSync(
        path.join(coreDir, "package.json"),
        JSON.stringify({ name: "@chainlesschain/core-env", version: "9.9.9" }),
      );

      const script = path.join(scriptDir, "detect-publishable-packages.mjs");
      const tagRun = spawnSync(process.execPath, [script], {
        cwd: tempRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REF: "refs/tags/v-packages-smoke",
          GITHUB_OUTPUT: path.join(tempRoot, "tag-output.txt"),
        },
      });
      expect(tagRun.status, tagRun.stderr).toBe(0);
      expect(
        fs.readFileSync(path.join(tempRoot, ".publish-order.txt"), "utf8"),
      ).toBe("core-env\n");
      expect(tagRun.stdout).not.toContain("chainlesschain@9.9.9");

      const explicitRun = spawnSync(process.execPath, [script], {
        cwd: tempRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REF: "refs/heads/main",
          GITHUB_OUTPUT: path.join(tempRoot, "manual-output.txt"),
          INPUT_VERSION: "chainlesschain@9.9.9",
        },
      });
      expect(explicitRun.status).toBe(1);
      expect(explicitRun.stderr).toContain(
        "must use the dedicated exact-SHA CLI release workflow",
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
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

  it("runs the session resource budget authority in the strict gate", () => {
    const text = workflow("cli-strict-sandbox.yml");
    const jobsStart = text.indexOf("\njobs:");
    expect(jobsStart).toBeGreaterThan(0);
    const triggers = text.slice(0, jobsStart);
    const jobs = text.slice(jobsStart);
    const pullRequestStart = triggers.indexOf("\n  pull_request:");
    const dispatchStart = triggers.indexOf("\n  workflow_dispatch:");
    expect(pullRequestStart).toBeGreaterThan(0);
    expect(dispatchStart).toBeGreaterThan(pullRequestStart);
    const pushTriggers = triggers.slice(0, pullRequestStart);
    const pullRequestTriggers = triggers.slice(pullRequestStart, dispatchStart);

    for (const source of [
      "packages/cli/src/lib/session-resource-budget.js",
      "packages/cli/src/lib/cost-budget.js",
      "packages/cli/src/lib/llm-pricing.js",
      "packages/cli/src/lib/sub-agent-context.js",
      "packages/cli/src/lib/sub-agent-registry.js",
      "packages/cli/src/lib/agent-team/team-runner.js",
      "packages/cli/src/harness/background-task-manager.js",
      "packages/cli/src/runtime/agent-core.js",
    ]) {
      expect(pushTriggers).toContain(`- "${source}"`);
      expect(pullRequestTriggers).toContain(`- "${source}"`);
    }

    for (const testFile of [
      "__tests__/unit/session-resource-budget.test.js",
      "__tests__/unit/sub-agent-session-budget.test.js",
      "__tests__/unit/background-task-manager.test.js",
      "__tests__/unit/background-task-session-budget.test.js",
      "__tests__/unit/sub-agent-registry.test.js",
      "__tests__/unit/team-runner-session-budget.test.js",
      "__tests__/unit/agent-core.test.js",
    ]) {
      expect(pushTriggers).toContain(`packages/cli/${testFile}`);
      expect(pullRequestTriggers).toContain(`packages/cli/${testFile}`);
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
