import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  createDeliveryFlow,
  DELIVERY_ACTION,
  restoreDeliveryFlow,
} from "../../src/lib/delivery-coordinator.js";
import {
  createGitHubDeliveryProductionAdapter,
  DELIVERY_FIXER_ALLOWED_TOOLS,
  validateGitHubDeliveryProductionConfig,
} from "../../src/lib/delivery-production-adapter.js";
import {
  runDeliveryProductionAction,
  writeDeliveryProductionState,
} from "../../src/lib/delivery-production-runner.js";

const HEAD = "a".repeat(40);
const NEXT = "d".repeat(40);
const BASE = "b".repeat(40);
const MERGE = "f".repeat(40);
const INITIAL_DIFF = "initial diff\n";
const FIXED_DIFF = "fixed diff\n";
const DIGEST = `sha256:${crypto.createHash("sha256").update(INITIAL_DIFF).digest("hex")}`;
const NOW = "2026-08-10T00:00:00.000Z";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function flowConfig() {
  return {
    flowId: "production-provider-lifecycle",
    commitSha: HEAD,
    diff: {
      baseCommitSha: BASE,
      headCommitSha: HEAD,
      digest: DIGEST,
      changedFiles: ["src/widget.js"],
    },
    environment: {
      os: "linux",
      arch: "x64",
      runtime: "node",
      runtimeVersion: "22.12.0",
      dependencyDigest: DIGEST,
    },
    requiredGates: [{ id: "cli-ci", always: true, matrix: ["local"] }],
    analysis: {
      confidence: 1,
      dependencyGraphComplete: true,
      languageServicesComplete: true,
      testHistoryComplete: true,
      classifications: [
        {
          path: "src/widget.js",
          language: "javascript",
          ecosystem: "npm",
          confidence: 1,
        },
      ],
    },
    unverified: [],
    sideEffects: [],
    policy: {
      maxRounds: 2,
      maxNoProgressRounds: 1,
      autoMergeEnabled: true,
    },
  };
}

function providerConfig() {
  return {
    github: { repo: "chainlesschain/chainlesschain" },
    gates: [
      {
        id: "cli-ci",
        executions: [{ id: "local", file: "gate-bin", args: ["--ci"] }],
      },
    ],
    preview: {
      port: 9222,
      screenshotPath: ".evidence/preview.png",
      reload: true,
    },
    review: { baseRef: "main" },
    fix: {
      baseRef: "main",
      baseCommitSha: BASE,
      allowedPaths: ["src/widget.js"],
    },
    pullRequest: {
      base: "main",
      title: "Deliver reviewed change",
      body: "Production delivery",
    },
    ci: { requiredChecks: ["ci/local"] },
    merge: { enabled: true, method: "squash" },
  };
}

function createFixWorktree(prefix = "cc-delivery-fix-worktree-") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  fs.mkdirSync(path.join(directory, "src"));
  fs.writeFileSync(path.join(directory, "src", "widget.js"), "export {};\n");
  return fs.realpathSync(directory);
}

function success(stdout = "") {
  return { status: 0, stdout, stderr: "" };
}

function createProcessDouble(repository) {
  return vi.fn((file, args, options) => {
    expect(options).toMatchObject({ shell: false, scope: "delivery" });
    if (file === "gate-bin") {
      expect(args).toEqual(["--ci"]);
      return success("gate passed");
    }
    if (file === "git") {
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        if (args[2] === `${BASE}^{commit}`) return success(`${BASE}\n`);
        if (args[2] === `${NEXT}^`) return success(`${HEAD}\n`);
        throw new Error(`unexpected rev-parse target: ${args[2]}`);
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return success(`${options.cwd}\n`);
      }
      if (args[0] === "rev-parse") return success(`${repository.head}\n`);
      if (args[0] === "status") {
        return success(
          repository.modified
            ? ` M ${repository.changedPath || "src/widget.js"}\n`
            : "",
        );
      }
      if (args[0] === "ls-files") return success("");
      if (args[0] === "add") return success();
      if (args[0] === "commit") {
        repository.head = NEXT;
        repository.modified = false;
        return success("committed");
      }
      if (args[0] === "diff" && args.includes("--binary")) {
        return success(
          args.includes(`${BASE}...${NEXT}`) ? FIXED_DIFF : INITIAL_DIFF,
        );
      }
      if (args[0] === "diff" && args.includes("--name-only")) {
        const hasRange = args.some(
          (item) =>
            item === `${BASE}...${HEAD}` || item === `${BASE}...${NEXT}`,
        );
        const isFixCommitRange = args.includes(`${HEAD}...${NEXT}`);
        return success(
          hasRange || isFixCommitRange
            ? "src/widget.js\0"
            : repository.modified
              ? `${repository.changedPath || "src/widget.js"}\0`
              : "",
        );
      }
      if (args[0] === "branch") return success("feature/delivery\n");
      if (args[0] === "push") {
        repository.remoteHead = repository.head;
        return success("pushed");
      }
    }
    if (file === "gh") {
      if (args[0] === "api") {
        return success(
          JSON.stringify({
            required_status_checks: { contexts: ["ci/local"] },
            required_pull_request_reviews: {},
            enforce_admins: { enabled: true },
          }),
        );
      }
      if (args[0] === "pr" && args[1] === "list") {
        return success(repository.pr ? JSON.stringify([repository.pr]) : "[]");
      }
      if (args[0] === "pr" && args[1] === "create") {
        repository.pr = {
          number: 42,
          state: "OPEN",
          isDraft: false,
          baseRefName: "main",
          headRefName: "feature/delivery",
          headRefOid: repository.remoteHead,
          url: "https://example.invalid/pr/42",
          reviewDecision: "APPROVED",
          reviewRequests: [],
          mergeStateStatus: "CLEAN",
          statusCheckRollup: [
            {
              name: "ci/local",
              status: "COMPLETED",
              conclusion: "SUCCESS",
            },
          ],
          mergeCommit: null,
        };
        return success(repository.pr.url);
      }
      if (args[0] === "pr" && args[1] === "view") {
        return success(JSON.stringify(repository.pr));
      }
      if (args[0] === "pr" && args[1] === "merge") {
        expect(args).toContain("--match-head-commit");
        expect(args).toContain(NEXT);
        repository.pr = {
          ...repository.pr,
          state: "MERGED",
          mergeCommit: { oid: MERGE },
        };
        return success("merged");
      }
    }
    throw new Error(`unexpected process: ${file} ${args.join(" ")}`);
  });
}

describe("GitHubDeliveryProductionAdapter", () => {
  it("requires a complete secret-free production policy", () => {
    expect(validateGitHubDeliveryProductionConfig(providerConfig())).toEqual({
      valid: true,
      reason: "ok",
      unmet: [],
    });
    expect(
      validateGitHubDeliveryProductionConfig({
        ...providerConfig(),
        pullRequest: {
          ...providerConfig().pullRequest,
          body: "Bearer definitely-a-secret-token",
        },
        fix: {
          ...providerConfig().fix,
          allowedPaths: ["C:/outside/widget.js"],
        },
      }),
    ).toMatchObject({
      valid: false,
      unmet: expect.arrayContaining([
        "raw-secret-detected",
        "fix-allowed-paths-invalid",
      ]),
    });
    for (const invalidPath of [
      "src/widget.js:secret",
      "src\\widget.js",
      "src/CON.txt",
      "src/trailing. ",
    ]) {
      expect(
        validateGitHubDeliveryProductionConfig({
          ...providerConfig(),
          fix: {
            ...providerConfig().fix,
            allowedPaths: [invalidPath],
          },
        }),
      ).toMatchObject({
        valid: false,
        unmet: expect.arrayContaining(["fix-allowed-paths-invalid"]),
      });
    }
  });

  it("maps all nine actions through an exact-head production lifecycle", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-delivery-production-adapter-"),
    );
    temporaryDirectories.push(directory);
    const worktree = path.join(directory, "worktree");
    const captureDirectory = path.join(directory, "captures");
    fs.mkdirSync(worktree);
    fs.mkdirSync(path.join(worktree, "src"));
    fs.writeFileSync(path.join(worktree, "src", "widget.js"), "export {};\n");
    fs.mkdirSync(captureDirectory);
    const statePath = path.join(directory, "delivery.json");
    writeDeliveryProductionState(
      statePath,
      createDeliveryFlow(flowConfig(), { now: NOW }),
    );

    const repository = {
      head: HEAD,
      remoteHead: null,
      modified: false,
      pr: null,
    };
    const runProcess = createProcessDouble(repository);
    const capturePreview = vi.fn(async ({ screenshotPath }) => {
      fs.writeFileSync(screenshotPath, Buffer.from("preview-image"));
      return {
        ok: true,
        url: "http://127.0.0.1:4173/",
        title: "Preview",
        html: "<main>ready</main>",
        htmlTruncated: false,
        console: [],
        network: [],
        screenshotPath,
        screenshotRef: path.basename(screenshotPath),
      };
    });
    let reviewRuns = 0;
    const runReview = vi.fn(async () => {
      reviewRuns += 1;
      return {
        isError: false,
        report: {
          findings:
            reviewRuns === 1
              ? [
                  {
                    path: "src/widget.js",
                    line: 4,
                    title: "Null access",
                    severity: "High",
                    confidence: 0.99,
                    category: "correctness",
                    failure_scenario: "Null input crashes",
                    evidence: "value.member",
                  },
                ]
              : [],
        },
      };
    });
    const runFix = vi.fn(async () => {
      repository.modified = true;
      return { isError: false };
    });
    const artifactStore = new ArtifactStore({
      dir: path.join(directory, "artifacts"),
      now: () => Date.parse(NOW),
    });
    const artifactGet = vi.spyOn(artifactStore, "get");
    const artifactIntegrity = vi.spyOn(artifactStore, "verifyIntegrity");
    const adapter = createGitHubDeliveryProductionAdapter(
      { cwd: worktree, config: providerConfig() },
      {
        runProcess,
        capturePreview,
        runReview,
        runFix,
        artifactStore,
        tmpdir: () => captureDirectory,
      },
    );

    const actions = [
      DELIVERY_ACTION.RUN_GATES,
      DELIVERY_ACTION.RUN_PREVIEW,
      DELIVERY_ACTION.RUN_REVIEW,
      DELIVERY_ACTION.APPLY_FIX,
      DELIVERY_ACTION.RUN_GATES,
      DELIVERY_ACTION.RUN_PREVIEW,
      DELIVERY_ACTION.RUN_REVIEW,
      DELIVERY_ACTION.CREATE_PR,
      DELIVERY_ACTION.REFRESH_CI,
      DELIVERY_ACTION.PUBLISH_EVIDENCE,
      DELIVERY_ACTION.MERGE,
      DELIVERY_ACTION.ARCHIVE,
    ];
    let state;
    for (const action of actions) {
      state = await runDeliveryProductionAction({
        statePath,
        action,
        adapter,
      });
    }

    expect(state).toMatchObject({
      status: "completed",
      phase: "completed",
      round: 1,
      commitSha: NEXT,
      pr: { number: 42, headCommitSha: NEXT, ciCommitSha: NEXT },
      merge: {
        merged: true,
        headCommitSha: NEXT,
        mergeCommitSha: MERGE,
      },
      archive: {
        archived: true,
        preservedUncommitted: true,
        preservedUnpushed: true,
        workspaceDisposition: "retained",
      },
    });
    expect(
      restoreDeliveryFlow(JSON.parse(fs.readFileSync(statePath, "utf8"))),
    ).toMatchObject({ status: "completed", pendingEffect: null });
    expect(runReview).toHaveBeenCalledTimes(2);
    expect(runFix).toHaveBeenCalledTimes(1);
    expect(runFix).toHaveBeenCalledWith(
      expect.objectContaining({
        fix: true,
        single: true,
        paths: ["src/widget.js"],
        allowedPaths: ["src/widget.js"],
        failureContext: expect.any(Array),
        reviewContext: expect.any(Object),
      }),
    );
    const fixerOptions = runFix.mock.calls[0][0];
    expect(fixerOptions.allowedTools).toBe(DELIVERY_FIXER_ALLOWED_TOOLS);
    expect(fixerOptions.allowedTools).toEqual([
      "read_file",
      "list_dir",
      "write_file",
      "edit_file",
      "edit_file_hashed",
    ]);
    expect(fixerOptions.allowedTools).not.toEqual(
      expect.arrayContaining([
        "run_shell",
        "run_code",
        "git",
        "spawn_sub_agent",
        "run_skill",
      ]),
    );
    expect(Object.isFrozen(fixerOptions.allowedTools)).toBe(true);
    expect(fixerOptions.exactToolNames).toBe(true);
    expect(fixerOptions.hermeticExecution).toBe(true);
    expect(fixerOptions).toMatchObject({
      useRegisteredMcp: false,
      strictMcpConfig: true,
      ide: false,
      pdh: false,
      jetbrains: false,
    });
    expect(fixerOptions.fileMutationScope).toEqual({
      exact: true,
      worktreeRoot: fs.realpathSync(worktree),
      allowedPaths: ["src/widget.js"],
    });
    expect(Object.isFrozen(fixerOptions.fileMutationScope)).toBe(true);
    expect(Object.isFrozen(fixerOptions.fileMutationScope.allowedPaths)).toBe(
      true,
    );
    expect(capturePreview).toHaveBeenCalledTimes(2);
    for (const [options] of capturePreview.mock.calls) {
      expect(path.relative(worktree, options.screenshotPath)).toMatch(/^\.\./u);
    }
    expect(
      runProcess.mock.calls.filter(([file]) => file === "gate-bin"),
    ).toHaveLength(2);
    expect(
      runProcess.mock.calls.filter(
        ([file, args]) => file === "gh" && args[0] === "api",
      ),
    ).toHaveLength(2);
    expect(repository.pr).toMatchObject({ state: "MERGED" });
    expect(state.evidence.artifact).toMatchObject({
      immutable: true,
      recordDigest: state.evidence.record.recordDigest,
    });
    expect(
      artifactStore.verifyIntegrity(state.evidence.artifact),
    ).toMatchObject({
      ok: true,
    });
    expect(artifactGet).toHaveBeenCalledWith(state.evidence.artifact.id);
    expect(artifactIntegrity.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("fails closed before a gate command when the local head is stale", async () => {
    const repository = {
      head: NEXT,
      remoteHead: null,
      modified: false,
      pr: null,
    };
    const runProcess = createProcessDouble(repository);
    const adapter = createGitHubDeliveryProductionAdapter(
      { cwd: process.cwd(), config: providerConfig() },
      { runProcess },
    );

    await expect(
      adapter.runGates({
        commitSha: HEAD,
        gateSelection: { selectedGateIds: ["cli-ci"] },
        requiredGates: [{ id: "cli-ci", matrix: ["local"] }],
      }),
    ).resolves.toMatchObject({
      ok: false,
      commitSha: NEXT,
      error: expect.stringContaining("exact-head mismatch"),
    });
    expect(runProcess).not.toHaveBeenCalledWith(
      "gate-bin",
      expect.anything(),
      expect.anything(),
    );
  });

  it("fails closed before a gate command when the exact diff digest is forged", async () => {
    const repository = {
      head: HEAD,
      remoteHead: null,
      modified: false,
      pr: null,
    };
    const runProcess = createProcessDouble(repository);
    const adapter = createGitHubDeliveryProductionAdapter(
      { cwd: process.cwd(), config: providerConfig() },
      { runProcess },
    );

    await expect(
      adapter.runGates(
        {
          commitSha: HEAD,
          baseCommitSha: BASE,
          diffDigest: `sha256:${"0".repeat(64)}`,
          changedFiles: ["src/widget.js"],
          gateSelection: { selectedGateIds: ["cli-ci"] },
          requiredGates: [{ id: "cli-ci", matrix: ["local"] }],
        },
        { effect: { id: `sha256:${"7".repeat(64)}` } },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("diff digest"),
    });
    expect(
      runProcess.mock.calls.filter(([file]) => file === "gate-bin"),
    ).toHaveLength(0);
  });

  it("binds the fixer base to coordinator state and leaves out-of-scope edits untouched", async () => {
    const worktree = createFixWorktree();
    const repository = {
      head: HEAD,
      remoteHead: null,
      modified: false,
      changedPath: "README.md",
      pr: null,
    };
    const runProcess = createProcessDouble(repository);
    const runFix = vi.fn(async (options) => {
      expect(options).toMatchObject({
        fix: true,
        single: true,
        paths: ["src/widget.js"],
        failureContext: [{ message: "gate failed" }],
      });
      repository.modified = true;
      return { isError: false };
    });
    const adapter = createGitHubDeliveryProductionAdapter(
      { cwd: worktree, config: providerConfig() },
      { runProcess, runFix },
    );

    await expect(
      adapter.applyFix(
        {
          commitSha: HEAD,
          baseCommitSha: BASE,
          diffDigest: DIGEST,
          changedFiles: ["src/widget.js"],
          failures: [{ message: "gate failed" }],
          review: { findings: [] },
        },
        { effect: { id: `sha256:${"6".repeat(64)}` } },
      ),
    ).rejects.toThrow(/outside its explicit allowlist: README\.md/);
    expect(repository).toMatchObject({ head: HEAD, modified: true });
    expect(
      runProcess.mock.calls.filter(
        ([file, args]) => file === "git" && args[0] === "add",
      ),
    ).toHaveLength(0);

    const wrongBaseAdapter = createGitHubDeliveryProductionAdapter(
      { cwd: worktree, config: providerConfig() },
      { runProcess, runFix },
    );
    repository.modified = false;
    await expect(
      wrongBaseAdapter.applyFix(
        {
          commitSha: HEAD,
          baseCommitSha: "e".repeat(40),
          diffDigest: DIGEST,
          changedFiles: ["src/widget.js"],
        },
        { effect: { id: `sha256:${"5".repeat(64)}` } },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining(
        "does not match the coordinator diff base",
      ),
    });
    expect(runFix).toHaveBeenCalledTimes(1);
  });

  it("rejects a fixer that changes HEAD outside the owned commit transaction", async () => {
    const worktree = createFixWorktree();
    const repository = {
      head: HEAD,
      remoteHead: null,
      modified: false,
      pr: null,
    };
    const runProcess = createProcessDouble(repository);
    const runFix = vi.fn(async () => {
      repository.head = NEXT;
      return { isError: false };
    });
    const adapter = createGitHubDeliveryProductionAdapter(
      { cwd: worktree, config: providerConfig() },
      { runProcess, runFix },
    );

    await expect(
      adapter.applyFix(
        {
          commitSha: HEAD,
          baseCommitSha: BASE,
          diffDigest: DIGEST,
          changedFiles: ["src/widget.js"],
          failures: [],
          review: { findings: [] },
        },
        { effect: { id: `sha256:${"4".repeat(64)}` } },
      ),
    ).rejects.toThrow(/changed worktree.*identity outside/);
    expect(
      runProcess.mock.calls.filter(
        ([file, args]) => file === "git" && args[0] === "add",
      ),
    ).toHaveLength(0);
  });

  it("refuses a hard-linked allowed file before invoking the fixer", async () => {
    const worktree = createFixWorktree();
    const target = path.join(worktree, "src", "widget.js");
    const outside = path.join(path.dirname(worktree), "outside-widget.js");
    fs.writeFileSync(outside, "outside\n");
    fs.unlinkSync(target);
    fs.linkSync(outside, target);
    const repository = {
      head: HEAD,
      remoteHead: null,
      modified: false,
      pr: null,
    };
    const runFix = vi.fn(async () => ({ isError: false }));
    const adapter = createGitHubDeliveryProductionAdapter(
      { cwd: worktree, config: providerConfig() },
      { runProcess: createProcessDouble(repository), runFix },
    );

    await expect(
      adapter.applyFix(
        {
          commitSha: HEAD,
          baseCommitSha: BASE,
          diffDigest: DIGEST,
          changedFiles: ["src/widget.js"],
          failures: [],
          review: { findings: [] },
        },
        { effect: { id: `sha256:${"3".repeat(64)}` } },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("hard links"),
    });
    expect(runFix).not.toHaveBeenCalled();
    expect(fs.readFileSync(outside, "utf8")).toBe("outside\n");
  });

  it("requires exactly one successful instance of every protected check", () => {
    const repository = {
      head: HEAD,
      remoteHead: null,
      modified: false,
      pr: null,
    };
    const adapter = createGitHubDeliveryProductionAdapter(
      { cwd: process.cwd(), config: providerConfig() },
      { runProcess: createProcessDouble(repository) },
    );
    const snapshot = adapter._ciSnapshot(
      {
        reviewDecision: "APPROVED",
        reviewRequests: [],
        mergeStateStatus: "CLEAN",
        statusCheckRollup: [
          { name: "ci/local", conclusion: "SUCCESS" },
          { name: "ci/local", conclusion: "SUCCESS" },
        ],
      },
      HEAD,
      {
        protected: true,
        requiredChecksProtected: true,
        reviewRequired: true,
        enforcedForAdmins: true,
        protectedChecks: ["ci/local"],
      },
    );
    expect(snapshot).toMatchObject({
      requiredMatrixComplete: false,
      requiredChecksSuccessful: false,
      reviewApproved: true,
      branchProtectionSatisfied: true,
    });
  });

  it("fails evidence revalidation when published bytes no longer match their digest", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-delivery-artifact-tamper-"),
    );
    temporaryDirectories.push(directory);
    const artifactStore = new ArtifactStore({
      dir: path.join(directory, "artifacts"),
      now: () => Date.parse(NOW),
    });
    const entry = artifactStore.publishData({
      data: "{}\n",
      fileName: "evidence.json",
      kind: "data",
      mime: "application/json",
      immutable: true,
      recordDigest: DIGEST,
    });
    const storedPath = artifactStore.storedPath(entry);
    fs.chmodSync(storedPath, 0o600);
    fs.writeFileSync(storedPath, "tampered\n");
    const repository = {
      head: HEAD,
      remoteHead: null,
      modified: false,
      pr: null,
    };
    const adapter = createGitHubDeliveryProductionAdapter(
      { cwd: process.cwd(), config: providerConfig() },
      { runProcess: createProcessDouble(repository), artifactStore },
    );

    expect(
      adapter._verifyPublishedEvidence(
        { recordDigest: DIGEST, artifact: entry },
        HEAD,
        DIGEST,
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("integrity failed"),
    });
  });

  it("rejects CI evidence from a PR whose remote head moved", async () => {
    const repository = {
      head: HEAD,
      remoteHead: NEXT,
      modified: false,
      pr: {
        number: 42,
        state: "OPEN",
        headRefOid: NEXT,
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN",
        statusCheckRollup: [
          { name: "ci/local", status: "COMPLETED", conclusion: "SUCCESS" },
        ],
      },
    };
    const adapter = createGitHubDeliveryProductionAdapter(
      { cwd: process.cwd(), config: providerConfig() },
      { runProcess: createProcessDouble(repository) },
    );

    await expect(
      adapter.refreshCi(
        { commitSha: HEAD },
        {
          effect: { id: `sha256:${"9".repeat(64)}` },
          state: { pr: { number: 42 } },
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      commitSha: HEAD,
      error: expect.stringContaining("exact-head PR"),
    });
  });

  it("does not publish a record whose claimed digest is not authoritative", async () => {
    const repository = {
      head: HEAD,
      remoteHead: null,
      modified: false,
      pr: null,
    };
    const artifactStore = {
      publishData: vi.fn(),
      verifyIntegrity: vi.fn(),
    };
    const adapter = createGitHubDeliveryProductionAdapter(
      { cwd: process.cwd(), config: providerConfig() },
      { runProcess: createProcessDouble(repository), artifactStore },
    );

    await expect(
      adapter.publishEvidence(
        {
          commitSha: HEAD,
          baseCommitSha: BASE,
          diffDigest: DIGEST,
          changedFiles: ["src/widget.js"],
          record: {
            commit: { sha: HEAD },
            recordDigest: DIGEST,
          },
          readiness: { ready: true },
        },
        { effect: { id: `sha256:${"8".repeat(64)}` } },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("authoritative verification"),
    });
    expect(artifactStore.publishData).not.toHaveBeenCalled();
  });
});
