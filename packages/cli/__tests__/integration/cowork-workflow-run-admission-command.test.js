import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerCoworkCommand } from "../../src/commands/cowork.js";
import {
  _deps as workflowDeps,
  saveWorkflow,
} from "../../src/lib/cowork-workflow.js";
import { createExecutionLocationBinding } from "../../src/lib/execution-location-contract.js";
import { startSession } from "../../src/harness/jsonl-session-store.js";

vi.mock("ora", () => ({
  default: () => ({
    start() {
      return this;
    },
    stop() {},
    succeed() {},
    fail() {},
  }),
}));

function governedWorkflow() {
  return {
    id: "command-admission",
    name: "Command admission",
    steps: [{ id: "s1", message: "must not run while blocked" }],
    facade: {
      requirements: {
        capabilities: ["cowork-task"],
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
        tokensPerTask: 10,
        usdPerTask: 0.001,
        durationMsPerTask: 10,
      },
      budget: {
        maxExpandedTasks: 4,
        maxParallel: 2,
        maxTokens: 100,
        maxUsd: 1,
        maxDurationMs: 1000,
      },
    },
  };
}

function executionBinding(projectRoot) {
  return createExecutionLocationBinding({
    location: "local",
    observed: true,
    observedAt: "2026-08-15T00:00:00.000Z",
    source: {
      cwd: projectRoot,
      git: { root: projectRoot, commit: "c".repeat(40) },
    },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      tools: ["node"],
    },
    permissions: {
      status: "declared",
      file: "read",
      shell: false,
      network: false,
      mcp: false,
      externalSystems: false,
    },
    policy: {
      network: "offline",
      sandbox: "strong",
      dataBoundary: { kind: "repository", root: projectRoot },
    },
  });
}

function executionProof(sessionId, projectRoot) {
  return Object.freeze({
    sessionId,
    headHash: "d".repeat(64),
    eventCount: 3,
    binding: executionBinding(projectRoot),
  });
}

describe("cowork workflow Commander admission", () => {
  let root;
  let projectRoot;
  let previousCwd;
  let previousHome;
  let previousAnchorHome;
  let previousRunTask;
  let commandRunTask;
  let commandAuthorityProvider;
  let logSpy;
  let errorSpy;
  let exitCodeBefore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cc-cowork-admission-command-"));
    projectRoot = join(root, "project");
    mkdirSync(projectRoot, { recursive: true });
    previousCwd = process.cwd();
    previousHome = process.env.CHAINLESSCHAIN_HOME;
    previousAnchorHome = process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
    process.env.CHAINLESSCHAIN_HOME = join(root, "home");
    process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = join(root, "anchors");
    process.chdir(projectRoot);
    saveWorkflow(projectRoot, governedWorkflow());
    previousRunTask = workflowDeps.runTask;
    workflowDeps.runTask = vi.fn();
    commandRunTask = vi.fn(async ({ userMessage }) => ({
      taskId: `command-${userMessage}`,
      status: "completed",
      result: { summary: userMessage },
    }));
    commandAuthorityProvider = undefined;
    exitCodeBefore = process.exitCode;
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    workflowDeps.runTask = previousRunTask;
    process.exitCode = exitCodeBefore;
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
    else process.env.CHAINLESSCHAIN_HOME = previousHome;
    if (previousAnchorHome === undefined) {
      delete process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
    } else {
      process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = previousAnchorHome;
    }
    rmSync(root, { recursive: true, force: true });
  });

  async function runWorkflow(...args) {
    const program = new Command();
    program.exitOverride();
    const commandDeps = { workflowRunTask: commandRunTask };
    if (commandAuthorityProvider !== undefined) {
      commandDeps.workflowExecutionAuthorityProvider = commandAuthorityProvider;
    }
    registerCoworkCommand(program, commandDeps);
    await program.parseAsync([
      "node",
      "cc",
      "cowork",
      "workflow",
      "run",
      "command-admission",
      ...args,
    ]);
  }

  function historyPath() {
    return join(
      projectRoot,
      ".chainlesschain",
      "cowork",
      "workflow-history.jsonl",
    );
  }

  function output() {
    return [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map(String)
      .join("\n");
  }

  it("fails closed with exit code 2 when execution authority is missing", async () => {
    const sentinel = workflowDeps.runTask;

    await runWorkflow("--max-parallel", "2");

    expect(process.exitCode).toBe(2);
    expect(workflowDeps.runTask).toBe(sentinel);
    expect(workflowDeps.runTask).not.toHaveBeenCalled();
    expect(commandRunTask).not.toHaveBeenCalled();
    expect(existsSync(historyPath())).toBe(false);
    expect(output()).toContain(
      "CC_DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_MISSING",
    );
    expect(output()).not.toContain("Executing workflow");
  });

  it("does not fall back from invalid maxParallel after verified authority", async () => {
    const sessionId = "command-authority-session";
    startSession(sessionId, {
      executionLocation: executionBinding(projectRoot),
    });
    const sentinel = workflowDeps.runTask;

    await runWorkflow(
      "--execution-authority-session",
      sessionId,
      "--max-parallel",
      "invalid",
    );

    expect(process.exitCode).toBe(2);
    expect(workflowDeps.runTask).toBe(sentinel);
    expect(workflowDeps.runTask).not.toHaveBeenCalled();
    expect(commandRunTask).not.toHaveBeenCalled();
    expect(existsSync(historyPath())).toBe(false);
    expect(output()).toContain("requested-parallel-invalid");
    expect(output()).not.toContain("Executing workflow");
  }, 45_000);

  it.each([
    ["completed", ["completed"], 0],
    ["failed", ["failed"], 1],
    ["partial", ["completed", "failed"], 1],
  ])(
    "maps an admitted %s workflow record to the shell exit code",
    async (expectedStatus, taskStatuses, expectedExitCode) => {
      const sessionId = `command-status-${expectedStatus}`;
      const workflow = governedWorkflow();
      workflow.steps = taskStatuses.map((status, index) => ({
        id: `s${index + 1}`,
        message: `${status}-${index}`,
      }));
      workflow.facade.requirements.capabilities = [
        "cowork-task",
        "dag",
        "variables",
        ...(taskStatuses.length > 1 ? ["parallel"] : []),
      ];
      saveWorkflow(projectRoot, workflow);
      commandRunTask.mockImplementation(async ({ userMessage }) => {
        const index = Number(userMessage.split("-").at(-1));
        return {
          taskId: `command-status-${index}`,
          status: taskStatuses[index],
          result: { summary: userMessage },
        };
      });
      commandAuthorityProvider = vi.fn(() =>
        executionProof(sessionId, projectRoot),
      );

      await runWorkflow(
        "--execution-authority-session",
        sessionId,
        "--max-parallel",
        "2",
      );

      expect(process.exitCode).toBe(expectedExitCode);
      expect(commandRunTask).toHaveBeenCalledTimes(taskStatuses.length);
      expect(commandAuthorityProvider).toHaveBeenCalledTimes(2);
      expect(workflowDeps.runTask).not.toHaveBeenCalled();
      const history = existsSync(historyPath())
        ? readFileSync(historyPath(), "utf8").trim().split("\n").map(JSON.parse)
        : [];
      expect(history.at(-1)).toMatchObject({ status: expectedStatus });
      expect(output()).toContain(`Workflow ${expectedStatus}`);
    },
  );

  it("returns a structured fixed code for JSON preflight authority failure", async () => {
    const program = new Command();
    program.exitOverride();
    registerCoworkCommand(program);
    await program.parseAsync([
      "node",
      "cc",
      "cowork",
      "workflow",
      "preflight",
      "command-admission",
      "--json",
      "--max-parallel",
      "2",
    ]);

    expect(process.exitCode).toBe(2);
    const payload = JSON.parse(logSpy.mock.calls.at(-1)[0]);
    expect(payload).toEqual(
      expect.objectContaining({
        schema: "cc-dynamic-workflow-run-admission-error/v1",
        allowed: false,
        executionStarted: false,
        code: "CC_DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_MISSING",
      }),
    );
    expect(existsSync(historyPath())).toBe(false);
  });

  it("returns structured JSON when the preflight workflow is not found", async () => {
    const program = new Command();
    program.exitOverride();
    registerCoworkCommand(program);
    await program.parseAsync([
      "node",
      "cc",
      "cowork",
      "workflow",
      "preflight",
      "missing-workflow",
      "--json",
    ]);

    expect(process.exitCode).toBe(1);
    const payload = JSON.parse(logSpy.mock.calls.at(-1)[0]);
    expect(payload).toEqual(
      expect.objectContaining({
        schema: "cc-dynamic-workflow-run-admission-error/v1",
        allowed: false,
        executionStarted: false,
        code: "WORKFLOW_NOT_FOUND",
      }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(existsSync(historyPath())).toBe(false);
  });
});
