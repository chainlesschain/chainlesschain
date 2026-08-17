import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCoworkCommand } from "../../src/commands/cowork.js";
import { generateDynamicWorkflowDraft } from "../../src/lib/dynamic-workflow-draft.js";
import { getWorkflowRecord } from "../../src/lib/cowork-workflow.js";

function workflowDefinition(id = "generated-command-workflow") {
  return {
    id,
    name: "Generated command workflow",
    steps: [{ id: "review", message: "Review the release" }],
    facade: {
      requirements: {
        capabilities: ["cowork-task", "dag", "variables"],
        executionLocations: ["local"],
        permissions: {
          file: "read",
          shell: false,
          network: false,
          mcp: false,
          externalSystems: false,
        },
        sandbox: "strong",
        dataBoundary: "repository",
        credentials: [],
      },
      estimates: {
        tokensPerTask: 100,
        usdPerTask: 0.01,
        durationMsPerTask: 1000,
      },
      budget: {
        maxExpandedTasks: 4,
        maxParallel: 1,
        maxTokens: 500,
        maxUsd: 1,
        maxDurationMs: 5000,
      },
    },
  };
}

describe("cowork workflow draft and review commands", () => {
  let root;
  let projectRoot;
  let previousCwd;
  let previousExitCode;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    root = realpathSync.native(
      mkdtempSync(join(tmpdir(), "cc-cowork-draft-command-")),
    );
    projectRoot = join(root, "project");
    mkdirSync(projectRoot, { recursive: true });
    previousCwd = process.cwd();
    previousExitCode = process.exitCode;
    process.chdir(projectRoot);
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = previousExitCode;
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  });

  function program(commandDeps = {}) {
    const instance = new Command();
    instance.exitOverride();
    registerCoworkCommand(instance, commandDeps);
    return instance;
  }

  function jsonOutput() {
    return JSON.parse(logSpy.mock.calls.at(-1)[0]);
  }

  it("prints a pending-review artifact and does not persist model output", async () => {
    const chat = vi.fn(async () => JSON.stringify(workflowDefinition()));
    await program({ workflowDraftChat: chat }).parseAsync([
      "node",
      "cc",
      "cowork",
      "workflow",
      "draft",
      "Review the release",
      "--provider",
      "fixture",
      "--model",
      "fixture-model",
    ]);

    const draft = jsonOutput();
    expect(draft).toMatchObject({
      status: "pending-review",
      generator: { provider: "fixture", model: "fixture-model" },
      definition: { id: "generated-command-workflow" },
    });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
    expect(
      existsSync(join(projectRoot, ".chainlesschain", "cowork", "workflows")),
    ).toBe(false);
  });

  it("persists only the accepted, exact-digest reviewed definition", async () => {
    const draft = await generateDynamicWorkflowDraft(
      {
        prompt: "Review the release",
        provider: "fixture",
        model: "fixture-model",
      },
      {
        chat: async () => JSON.stringify(workflowDefinition()),
        now: () => "2026-08-18T04:10:00.000Z",
      },
    );
    const draftPath = join(root, "draft.json");
    writeFileSync(draftPath, JSON.stringify(draft), "utf8");

    await program().parseAsync([
      "node",
      "cc",
      "cowork",
      "workflow",
      "review",
      draftPath,
      "--expected-draft-digest",
      draft.draftDigest,
      "--reviewer",
      "alice@example.com",
      "--reason",
      "Permission and budget declarations reviewed",
      "--accept",
      "--json",
    ]);

    const review = jsonOutput();
    expect(review).toMatchObject({
      status: "accepted",
      persisted: true,
      draftDigest: draft.draftDigest,
      definition: {
        id: "generated-command-workflow",
        facade: {
          review: {
            decision: "accepted",
            reviewer: "alice@example.com",
          },
        },
      },
    });
    const saved = getWorkflowRecord(projectRoot, "generated-command-workflow");
    expect(saved.definitionDigest).toBe(review.acceptedDefinitionDigest);
    expect(saved.definition.facade.review.draftDigest).toBe(draft.draftDigest);
    expect(process.exitCode).toBeUndefined();
  });

  it("does not persist rejected or stale-digest drafts", async () => {
    const rejected = await generateDynamicWorkflowDraft(
      {
        prompt: "Reject this workflow",
        provider: "fixture",
        model: "fixture-model",
      },
      {
        chat: async () =>
          JSON.stringify(workflowDefinition("rejected-workflow")),
        now: () => "2026-08-18T04:11:00.000Z",
      },
    );
    const rejectedPath = join(root, "rejected.json");
    writeFileSync(rejectedPath, JSON.stringify(rejected), "utf8");
    await program().parseAsync([
      "node",
      "cc",
      "cowork",
      "workflow",
      "review",
      rejectedPath,
      "--expected-draft-digest",
      rejected.draftDigest,
      "--reviewer",
      "reviewer-1",
      "--reject",
      "--json",
    ]);
    expect(jsonOutput()).toMatchObject({
      status: "rejected",
      persisted: false,
    });
    expect(getWorkflowRecord(projectRoot, "rejected-workflow")).toBeNull();

    logSpy.mockClear();
    errorSpy.mockClear();
    await program().parseAsync([
      "node",
      "cc",
      "cowork",
      "workflow",
      "review",
      rejectedPath,
      "--expected-draft-digest",
      `sha256:${"f".repeat(64)}`,
      "--reviewer",
      "reviewer-1",
      "--accept",
    ]);
    expect(process.exitCode).toBe(2);
    expect(getWorkflowRecord(projectRoot, "rejected-workflow")).toBeNull();
    expect(errorSpy.mock.calls.flat().join("\n")).toContain(
      "workflow draft changed before review",
    );
  });

  it("requires exactly one human decision", async () => {
    const draft = await generateDynamicWorkflowDraft(
      {
        prompt: "Review this workflow",
        provider: "fixture",
        model: "fixture-model",
      },
      {
        chat: async () =>
          JSON.stringify(workflowDefinition("decision-workflow")),
        now: () => "2026-08-18T04:12:00.000Z",
      },
    );
    const draftPath = join(root, "decision.json");
    writeFileSync(draftPath, JSON.stringify(draft), "utf8");
    await program().parseAsync([
      "node",
      "cc",
      "cowork",
      "workflow",
      "review",
      draftPath,
      "--expected-draft-digest",
      draft.draftDigest,
      "--reviewer",
      "reviewer-1",
    ]);
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain(
      "exactly one of --accept or --reject is required",
    );
  });
});
