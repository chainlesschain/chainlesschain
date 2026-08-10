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

function literalRunBlocks(text) {
  const lines = text.split(/\r?\n/u);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*(.*?)\s*$/u.exec(lines[index]);
    if (!match) continue;
    if (!/^[|>][+-]?\d*$/u.test(match[2])) {
      blocks.push(match[2]);
      continue;
    }
    const indent = match[1].length;
    const block = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      const lineIndent = /^\s*/u.exec(line)[0].length;
      if (line.trim() && lineIndent <= indent) {
        index -= 1;
        break;
      }
      block.push(line);
    }
    blocks.push(block.join("\n"));
  }
  return blocks;
}

function expectExternalActionsPinned(text) {
  const actions = [...text.matchAll(/^\s*(?:-\s+)?uses:\s+([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
  expect(actions.length).toBeGreaterThan(0);
  for (const action of actions) {
    if (action.startsWith("./")) continue;
    expect(action, `unpinned action: ${action}`).toMatch(/@[0-9a-f]{40}$/u);
  }
}

function occurrences(text, needle) {
  return text.split(needle).length - 1;
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
    expect(cliPublish).toContain("for ATTEMPT in {1..30}; do");
    expect(cliPublish).toContain(
      "Registry has not exposed chainlesschain@$PKG_VER yet",
    );
    expect(cliPublish).toContain('test -n "$REGISTRY_TARBALL"');
    expect(cliPublish.indexOf("npm-release-artifact.mjs verify")).toBeLessThan(
      cliPublish.indexOf('npm publish "$TARBALL"'),
    );
    expect(cliPublish.indexOf('npm publish "$TARBALL"')).toBeLessThan(
      cliPublish.indexOf("for ATTEMPT in {1..30}; do"),
    );
    expect(cliPublish.indexOf("for ATTEMPT in {1..30}; do")).toBeLessThan(
      cliPublish.lastIndexOf("npm-release-artifact.mjs verify"),
    );
    expect(text).toContain("Verify published CLI npm provenance");
    expect(text).toContain(
      "npm audit signatures --include-attestations --json",
    );
    expect(text).toContain("verify-npm-release-provenance.mjs");
    expect(text).toContain("chainlesschain-npm-readback-${{ github.sha }}");
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
    expect(product).toContain("npm audit signatures --include-attestations");
    expect(product).toContain("verify-npm-release-provenance.mjs");
    expect(product).toContain("cli-npm-provenance.json");
    expect(product).not.toContain("Registry gitHead does not match");
    expect(product).not.toContain(
      'npm view "chainlesschain@${VERSION}" gitHead',
    );
    expect(product).toContain(
      "needs: [create-release, verify-cli-release, update-changelog]",
    );
    expect(product).not.toContain("publish-cli:");
    expect(product).not.toContain("- name: Publish CLI to npm");
    expect(product).not.toContain("skip_tests");
  });

  it("revalidates public npm bytes against the immutable attested run", () => {
    const readback = workflow("cli-npm-release-readback.yml");
    expect(readback).toContain("workflow_dispatch:");
    expect(readback).toContain("pull_request:");
    expect(readback).toContain("actions: read");
    expect(readback).toContain(
      'if [ "${{ github.event_name }}" = "pull_request" ]',
    );
    expect(readback).toContain("npm view chainlesschain version");
    expect(readback).toContain(
      "npm audit signatures --include-attestations --json",
    );
    expect(readback).toContain("verify-npm-release-provenance.mjs");
    expect(readback).toContain("actions/download-artifact@v6");
    expect(readback).toContain(
      "run-id: ${{ steps.provenance.outputs.run_id }}",
    );
    expect(readback).toContain("verify-npm-registry-readback.mjs");
    expect(readback).toContain('CC_RELEASE_COMMIT="$TAG_SHA"');
    expect(readback).toContain("chainlesschain-npm-readback.json");
    expect(readback).not.toContain("NPM_TOKEN");
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

  it("runs the materialized MCP capsule live chain in the strict gate", () => {
    const text = workflow("cli-strict-sandbox.yml");
    const jobsStart = text.indexOf("\njobs:");
    expect(jobsStart).toBeGreaterThan(0);
    const triggers = text.slice(0, jobsStart);
    const pullRequestStart = triggers.indexOf("\n  pull_request:");
    const dispatchStart = triggers.indexOf("\n  workflow_dispatch:");
    expect(pullRequestStart).toBeGreaterThan(0);
    expect(dispatchStart).toBeGreaterThan(pullRequestStart);
    const pushTriggers = triggers.slice(0, pullRequestStart);
    const pullRequestTriggers = triggers.slice(pullRequestStart, dispatchStart);

    for (const source of [
      "packages/cli/__tests__/integration/mcp-materialized-capsule-sandbox-live.test.js",
      "packages/cli/__tests__/fixtures/mcp-materialized-capsule-live-server.cjs",
      "packages/cli/__tests__/fixtures/mcp-materialized-capsule-child-contract.cjs",
    ]) {
      expect(pushTriggers.split(`- "${source}"`).length - 1).toBe(1);
      expect(pullRequestTriggers.split(`- "${source}"`).length - 1).toBe(1);
    }

    const strictJobStart = text.indexOf("\n  strict-platform:", jobsStart);
    expect(strictJobStart).toBeGreaterThan(jobsStart);
    const strictJob = text.slice(strictJobStart);
    expect(strictJob).toContain("os: [ubuntu-24.04, macos-15, windows-latest]");
    const stepStart = strictJob.indexOf(
      "\n      - name: Run native ProcessExecutionBroker strict boundary",
    );
    expect(stepStart).toBeGreaterThan(0);
    const nextStepStart = strictJob.indexOf("\n      - name:", stepStart + 1);
    expect(nextStepStart).toBeGreaterThan(stepStart);
    const liveStep = strictJob.slice(stepStart, nextStepStart);
    expect(liveStep).toContain("id: strict-native-boundary");
    expect(liveStep).toContain("working-directory: packages/cli");
    expect(liveStep).toContain('CC_SANDBOX_LIVE: "1"');
    expect(liveStep).not.toMatch(/^\s+if:/m);
    expect(liveStep).toContain(
      "__tests__/integration/mcp-materialized-capsule-sandbox-live.test.js",
    );
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
      "node22-linux-x64",
      "node22-linux-arm64",
      "node22-win-x64",
      "node22-win-arm64",
      "node22-macos-x64",
      "node22-macos-arm64",
    ]) {
      expect(text).toContain(target);
    }
    for (const runner of [
      "ubuntu-latest",
      "ubuntu-24.04-arm",
      "windows-latest",
      "windows-11-arm",
      "macos-15-intel",
      "macos-15",
    ]) {
      expect(text).toContain(`os: ${runner}`);
    }
    expect(text).toContain("Verify real native target host");
    expect(text).toContain("Require a published pkg base binary");
    expect(text).toContain("--node-range node22");
    expect(text).toContain("--force-fetch");
    expect(text).not.toContain("node20-");
    expect(text).toContain("Smoke-test executable on its matching real host");
    expect(text).toContain('["status", "--json"]');
    expect(text).not.toContain("host smoke test skipped");
    expect(text).toContain("verify-release-gates.mjs");
    expect(text).toContain("signtool.exe");
    expect(text).toContain("codesign --verify");
    expect(text).toContain("xcrun notarytool submit");
    expect(text).toContain('result.status !== "Accepted"');
    expect(text).toContain("spctl --assess --type execute");
    expect(text).toContain("CLI_MACOS_NOTARY_APPLE_ID");
    expect(text).toContain("CLI_MACOS_NOTARY_TEAM_ID");
    expect(text).toContain("CLI_MACOS_NOTARY_APP_PASSWORD");
    expect(text).toContain("codesign+notarized+sigstore");
    expect(text).toContain("cosign sign-blob --yes");
    expect(
      occurrences(
        text,
        "sigstore/cosign-installer@398d4b0eeef1380460a10c8013a76f728fb906ac",
      ),
    ).toBe(3);
    expect(text).not.toContain(
      "sigstore/cosign-installer@f713795cb21599bc4e5c4b58cbad1da852d7eeb9",
    );
    expect(text).toContain("CLI_UPDATE_ED25519_PRIVATE_KEY_B64");
    expect(text).toContain("assertNativeReleaseIdentity");
    expect(text).toContain(
      "native stable release tags must use x.y.z without prerelease/build metadata",
    );
    expect(text).toContain('test "$(git rev-list -n 1 "$TAG")"');
    expect(text).not.toContain("releases/latest");
    expect(text).toContain("releases/download/cli-stable");
    expect(text).toContain("group: cli-native-release-stable");
    expect(text).toContain(
      "blocked-pending-signing-and-public-distribution-evidence",
    );
    expect(text).not.toContain("blocked-pending-native-host-matrix");
    expect(text).toMatch(
      /build:\s*\n\s*needs: \[release-readiness, exact-sha-gate\]/,
    );
    expect(text).toMatch(
      /publish-versioned:\s*\n\s*needs: \[release-readiness, exact-sha-gate, build\]/,
    );
    expect(text).toContain("verify-stable-channel-promotion.mjs");
    expect(text).toContain("PUBLISHED_AT=$(git show -s --format=%cI");
    expect(text).toContain("create-native-release-sbom.mjs");
    expect(text).toContain(
      "cmp native-assets/chainlesschain-cli-sbom.cdx.json",
    );
    expect(text).toContain("CC_RELEASE_SBOM_LOCK_SHA256");
    expect(text).toContain("CC_RELEASE_SBOM_RUNTIME_REFS_SHA256");
    expect(text).toContain("npm ci --workspace packages/cli");
    expect(text).not.toContain("npm install --package-lock-only");
    expect(text).toContain("ChainlessChain.ChainlessChainCLI.yaml");
    expect(text).toContain(
      "ChainlessChain.ChainlessChainCLI.locale.en-US.yaml",
    );
    expect(text).toContain("ChainlessChain.ChainlessChainCLI.installer.yaml");
    expect(text).toContain(
      'gh release edit "$TAG" --draft=false --latest=false',
    );
    expect(text).toContain("RELEASE_REF_PROTECTED");
    expect(text).toContain("environment: native-production");
    expect(text).toContain("CLI_WINDOWS_SIGNING_CERT_SHA256");
    expect(text).toContain("CLI_WINDOWS_TIMESTAMP_SUBJECT");
    expect(text).toContain("CLI_MACOS_TEAM_IDENTIFIER");
    expect(text).toContain("CLI_MACOS_DEVELOPER_ID_AUTHORITY");
    expect(text).toContain("CLI_MACOS_DESIGNATED_REQUIREMENT");
    expect(text).toContain(
      'test "$MAC_NOTARY_TEAM_ID" = "$MAC_TEAM_IDENTIFIER"',
    );
    expect(text).toContain("--certificate-github-workflow-repository");
    expect(text).toContain("--certificate-github-workflow-ref");
    expect(text).toContain("--certificate-github-workflow-sha");
    expect(text).toContain("--certificate-github-workflow-trigger push");
    const nativeCosignVerifyCount = occurrences(text, "cosign verify-blob");
    expect(nativeCosignVerifyCount).toBe(2);
    for (const flag of [
      "--certificate-github-workflow-repository",
      "--certificate-github-workflow-ref",
      "--certificate-github-workflow-sha",
      "--certificate-github-workflow-trigger push",
    ]) {
      expect(occurrences(text, flag), flag).toBe(nativeCosignVerifyCount);
    }
    expect(literalRunBlocks(text).join("\n")).not.toContain(
      "${{ github.ref_name }}",
    );
    expect(text).toMatch(
      /versioned-public-readback-gate:[\s\S]*needs: publish-versioned[\s\S]*uses: \.\/\.github\/workflows\/cli-native-release-readback\.yml[\s\S]*verify_stable: false/u,
    );
    expect(text).toMatch(
      /promote-stable:[\s\S]*needs: versioned-public-readback-gate/u,
    );
    expect(text).toMatch(
      /stable-public-readback-gate:[\s\S]*needs: promote-stable[\s\S]*uses: \.\/\.github\/workflows\/cli-native-release-readback\.yml[\s\S]*verify_stable: true/u,
    );
    expect(text).toContain("stable-readback-failure-containment:");
    expect(text).toContain(
      "needs.promote-stable.outputs.mutation_started == 'true'",
    );
    expect(text).toContain(
      "needs.stable-public-readback-gate.result != 'success'",
    );
    expect(text).toContain(
      "Stable activation/readback failed; the active cli-stable manifest was withdrawn.",
    );
    const containment = text.slice(
      text.indexOf("  stable-readback-failure-containment:"),
    );
    expect(containment).toContain(
      "cli-stable changed outside this transaction; refusing to withdraw another release pointer",
    );
    expect(containment).toContain(
      '"$RUNNER_TEMP/containment-versioned/chainlesschain-update.json"',
    );
    expect(containment.indexOf("cmp -s")).toBeLessThan(
      containment.indexOf(
        'gh release delete-asset "$CHANNEL_TAG" chainlesschain-update.json --yes',
      ),
    );
    const versionedGate = text.indexOf("versioned-public-readback-gate:");
    const stablePromotionJob = text.indexOf("promote-stable:");
    const stableGate = text.indexOf("stable-public-readback-gate:");
    expect(versionedGate).toBeGreaterThan(text.indexOf("publish-versioned:"));
    expect(stablePromotionJob).toBeGreaterThan(versionedGate);
    expect(stableGate).toBeGreaterThan(stablePromotionJob);
    expectExternalActionsPinned(text);
    expect(text).not.toContain("--clobber");

    const versionedStart = text.indexOf(
      "- name: Publish only after every platform and signature succeeds",
    );
    const stableStart = text.indexOf(
      "- name: Authenticate the previous stable pointer and plan promotion",
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
      "Existing stable channel lacks one complete signed manifest pair",
    );
    expect(stable).toContain(
      "Stable channel lookup failed without an authoritative not-found response",
    );
    expect(stable).toContain("HTTP 404");
    expect(stable).toContain("--signing-identity");
    expect(stable).toContain(
      'git fetch --no-tags --force "https://github.com/$OLD_REPOSITORY.git" "$OLD_REF"',
    );
    expect(stable).toContain(
      'REMOTE_OLD_COMMIT=$(git rev-parse "FETCH_HEAD^{commit}")',
    );
    expect(stable).toContain('--certificate-identity "$OLD_IDENTITY"');
    expect(stable).toContain(
      '--certificate-github-workflow-repository "$OLD_REPOSITORY"',
    );
    expect(stable).toContain('--certificate-github-workflow-ref "$OLD_REF"');
    expect(stable).toContain('--certificate-github-workflow-sha "$OLD_COMMIT"');
    expect(stable).not.toContain("recoverable interrupted promotion");
    expect(stable).toContain(
      'gh release delete-asset "$CHANNEL_TAG" chainlesschain-update.json --yes',
    );
    expect(stable).toContain(
      'echo "mutation_started=true" >> "$GITHUB_OUTPUT"',
    );
    expect(stable.indexOf('echo "mutation_started=true"')).toBeLessThan(
      stable.indexOf('gh release create "$CHANNEL_TAG"'),
    );
    expect(stable.indexOf('echo "mutation_started=true"')).toBeLessThan(
      stable.indexOf(
        'gh release delete-asset "$CHANNEL_TAG" chainlesschain-update.json --yes',
      ),
    );
    expect(stable).toContain('PROMOTION_ACTION" = "idempotent"');
    expect(stable).toContain(
      'cmp -s "native-assets/$asset" "$CHANNEL_ASSET_DIR/$asset"',
    );
    expect(stable.indexOf("cosign verify-blob")).toBeLessThan(
      stable.indexOf('cmp -s "native-assets/$asset"'),
    );
    expect(stable.indexOf("REMOTE_OLD_COMMIT=")).toBeLessThan(
      stable.indexOf("cosign verify-blob"),
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

  it("keeps native public readback exact-SHA, anonymous, and fail-closed", () => {
    const text = workflow("cli-native-release-readback.yml");
    expect(text).toContain("workflow_dispatch:");
    expect(text).toContain("workflow_call:");
    expect(text).toContain("pull_request:");
    expect(text).toContain("expected_sha:");
    expect(text).toContain(
      "EXPECTED_REPOSITORY: chainlesschain/chainlesschain",
    );
    expect(text).toContain("CALLER_WORKFLOW_REF: ${{ github.workflow_ref }}");
    expect(text).toContain("CALLER_WORKFLOW_SHA: ${{ github.workflow_sha }}");
    expect(text).toContain("JOB_CONTEXT: ${{ toJSON(job) }}");
    expect(text).toContain("const readbackPrefix =");
    expect(text).toContain("const releasePrefix =");
    expect(text).toContain(
      'job.workflow_file_path !== ".github/workflows/cli-native-release-readback.yml"',
    );
    expect(text).toContain(
      "job.workflow_ref !== `${readbackPrefix}${env.REF}`",
    );
    expect(text).toContain("job.workflow_sha !== env.SHA");
    expect(text).not.toContain("${{ job.workflow_ref }}");
    expect(text).not.toContain("ref: ${{ needs.identity.outputs.commit }}");
    expect(text).toContain('env.EVENT_NAME === "push"');
    expect(text).toContain('env.REF_PROTECTED !== "true"');
    expect(text).toContain(
      "env.CALLER_WORKFLOW_REF !== `${releasePrefix}${env.REF}`",
    );
    expect(text).toContain('[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]');
    expect(text).toContain(
      'TAG_SHA=$(git rev-parse "refs/tags/$RELEASE_TAG^{commit}")',
    );
    expect(text).toContain('test "$TAG_SHA" = "$EXPECTED_SHA"');
    expect(text).toContain("release.target_commitish !== commit");
    expect(text).toContain(
      '"https://api.github.com/repos/$GITHUB_REPOSITORY/releases/tags/$RELEASE_TAG"',
    );
    expect(text).toContain("download_public_metadata cli-stable");
    for (const artifactName of [
      "cli-native-readback-core-${{ needs.identity.outputs.verify_stable }}-${{ needs.identity.outputs.commit }}",
      "cli-native-winget-validation-${{ needs.identity.outputs.verify_stable }}-${{ needs.identity.outputs.commit }}",
      "cli-native-platform-readback-${{ matrix.target }}-${{ needs.identity.outputs.verify_stable }}-${{ needs.identity.outputs.commit }}",
      "cli-native-platform-readback-*-${{ needs.identity.outputs.verify_stable }}-${{ needs.identity.outputs.commit }}",
      "cli-native-public-readback-${{ needs.identity.outputs.verify_stable }}-${{ needs.identity.outputs.commit }}",
    ]) {
      expect(text).toContain(artifactName);
    }
    expect(
      occurrences(
        text,
        "cli-native-readback-core-${{ needs.identity.outputs.verify_stable }}-${{ needs.identity.outputs.commit }}",
      ),
    ).toBe(2);
    expect(
      occurrences(
        text,
        "cli-native-winget-validation-${{ needs.identity.outputs.verify_stable }}-${{ needs.identity.outputs.commit }}",
      ),
    ).toBe(2);
    expect(text).not.toContain("GH_TOKEN:");
    expect(text).not.toContain(
      'gh api "repos/$GITHUB_REPOSITORY/releases/tags/',
    );
    expect(text).toContain("browser_download_url !== expected");
    expect(text).toContain("download-public-release-file.mjs");
    expect(text).toContain('--certificate-identity "$IDENTITY"');
    expect(text).toContain("https://token.actions.githubusercontent.com");
    expect(text).toContain("--certificate-github-workflow-repository");
    expect(text).toContain("--certificate-github-workflow-ref");
    expect(text).toContain("--certificate-github-workflow-sha");
    expect(text).toContain("--certificate-github-workflow-trigger push");
    const readbackCosignVerifyCount = occurrences(text, "cosign verify-blob");
    expect(readbackCosignVerifyCount).toBe(1);
    for (const flag of [
      "--certificate-github-workflow-repository",
      "--certificate-github-workflow-ref",
      "--certificate-github-workflow-sha",
      "--certificate-github-workflow-trigger push",
    ]) {
      expect(occurrences(text, flag), flag).toBe(readbackCosignVerifyCount);
    }
    expect(text).toContain("verify-native-release-readback.mjs");
    expect(text).toContain("Get-AuthenticodeSignature");
    expect(text).toContain("SignerCertificate.Subject -cne");
    expect(text).toContain("TimeStamperCertificate.Subject -cne");
    expect(text).toContain("codesign --verify --strict");
    expect(text).toContain("spctl --assess --type execute");
    expect(text).toContain('test "$TEAM" = "$MAC_TEAM_IDENTIFIER"');
    expect(text).toContain('test "$AUTHORITY" = "$MAC_DEVELOPER_ID_AUTHORITY"');
    expect(text).toContain(
      'test "$REQUIREMENT" = "$MAC_DESIGNATED_REQUIREMENT"',
    );
    expect(text).toContain("winget validate --manifest");
    expect(text).toContain("validatorVersion");
    const wingetJob = text.slice(
      text.indexOf("  winget-official-validation:"),
      text.indexOf("\n  platform-signature-readback:"),
    );
    expect(wingetJob).toContain("runs-on: windows-2025");
    expect(wingetJob).toContain("Get-Command winget.exe");
    expect(wingetJob).toContain('.readFileSync("winget-version.txt", "utf8")');
    expect(text).toContain(
      "sigstore/cosign-installer@398d4b0eeef1380460a10c8013a76f728fb906ac",
    );
    expect(text).not.toContain(
      "sigstore/cosign-installer@f713795cb21599bc4e5c4b58cbad1da852d7eeb9",
    );
    expect(text).toContain(
      "actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a",
    );
    expect(text).not.toContain(
      "actions/attest-build-provenance@43d14bc2b83dec42d39ecae14e916627a18bb661",
    );
    expect(text).toContain("create-native-release-sbom.mjs");
    expect(text).toContain("CC_NATIVE_RELEASE_REBUILT_SBOM");
    expect(text).toContain("record.artifact !== target.artifact");
    expect(text).toContain("const coreEvidenceSha256 = crypto");
    expect(text).toContain(
      'fs.readFileSync(\n            "readback/cli-native-public-readback.json"',
    );
    expect(text).toContain("coreEvidenceSha256,");
    expect(text).toContain("targets: core.targets,");
    expect(text).toContain("packageManagerAssets: core.packageManagerAssets,");
    expect(text.indexOf("targets: core.targets,")).toBeLessThan(
      text.indexOf("actions/attest-build-provenance@"),
    );
    expect(text).toContain("releaseEligible: false");
    expect(text).toContain(
      "does not claim signed install/upgrade/rollback or Homebrew/WinGet catalog publication",
    );
    expect(literalRunBlocks(text).join("\n")).not.toContain(
      "${{ github.ref_name }}",
    );
    expectExternalActionsPinned(text);
    expect(text).not.toContain("--clobber");

    const downloader = fs.readFileSync(
      path.join(
        repositoryRoot,
        "packages",
        "cli",
        "scripts",
        "download-public-release-file.mjs",
      ),
      "utf8",
    );
    expect(downloader).toContain("release-assets.githubusercontent.com");
    expect(downloader).toContain("resolvePublicRedirect(");
    expect(downloader).toContain("validatePublicDownloadUrl(");
    expect(downloader).toContain("maximumBytes");

    const cliCi = workflow("cli-ci.yml");
    const readbackPath =
      '- ".github/workflows/cli-native-release-readback.yml"';
    expect(cliCi.split(readbackPath)).toHaveLength(3);
  });

  it("collects six-target native host evidence without granting release authority", () => {
    const text = workflow("cli-native-validation.yml");
    const setupAction = fs.readFileSync(
      path.join(
        repositoryRoot,
        ".github",
        "actions",
        "setup-node-deps",
        "action.yml",
      ),
      "utf8",
    );
    for (const target of [
      "node22-linux-x64",
      "node22-linux-arm64",
      "node22-win-x64",
      "node22-win-arm64",
      "node22-macos-x64",
      "node22-macos-arm64",
    ]) {
      expect(text).toContain(target);
    }
    for (const runner of [
      "ubuntu-latest",
      "ubuntu-24.04-arm",
      "windows-latest",
      "windows-11-arm",
      "macos-15-intel",
      "macos-15",
    ]) {
      expect(text).toContain(`os: ${runner}`);
    }
    expect(text).toContain("workflow_dispatch:");
    expect(text).not.toMatch(/push:\s*\n\s*tags:/u);
    expect(text).toContain("Verify exact source and matching native host");
    expect(text).toContain(
      "install-command: npm ci --workspace packages/cli --include-workspace-root=false --legacy-peer-deps --ignore-scripts",
    );
    expect(text).toContain("install-workspace: packages/cli");
    expect(setupAction).toContain("INSTALL_WORKSPACE");
    expect(setupAction).toContain('--workspace "$INSTALL_WORKSPACE"');
    expect(text).toContain("Require a published pkg base binary");
    expect(text).toContain("--node-range node22");
    expect(text).toContain("--force-fetch");
    expect(text).not.toContain("node20-");
    expect(text).toContain(
      "Execute binary version and status on the matching host",
    );
    expect(text).toContain('["status", "--json"]');
    expect(text).toContain("native-installers-transaction.test.js");
    expect(text).toContain("packer-pack-update-applier.test.js");
    expect(text).toContain("chainlesschain.cli-native-validation.v1");
    expect(text).toContain("Aggregate six-target native validation evidence");
    expect(text).toContain("releaseEligible: false");
    expect(text).toContain("signed: false");
    expect(text).not.toContain("CLI_NATIVE_RELEASE_IMPLEMENTATION_STATUS");
    expect(text).not.toContain("gh release");
    expect(text).not.toContain("contents: write");
    expect(text).not.toContain("id-token: write");
    for (const rollupBinary of [
      "@rollup/rollup-linux-x64-gnu",
      "@rollup/rollup-linux-arm64-gnu",
      "@rollup/rollup-win32-x64-msvc",
      "@rollup/rollup-win32-arm64-msvc",
      "@rollup/rollup-darwin-x64",
      "@rollup/rollup-darwin-arm64",
    ]) {
      expect(setupAction).toContain(rollupBinary);
    }
  });
});
