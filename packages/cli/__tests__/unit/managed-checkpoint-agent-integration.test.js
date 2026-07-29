import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentCommand } from "../../src/commands/agent.js";
import {
  agentLoop,
  _getSharedCodeIntel,
  disposeSharedCodeIntel,
  killAllBackgroundShellTasks,
  listBackgroundShellTasks,
} from "../../src/runtime/agent-core.js";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import { createAgentRuntimeFactory } from "../../src/runtime/runtime-factory.js";
import { resolveAgentPolicy } from "../../src/runtime/policies/agent-policy.js";
import executionBroker from "../../src/lib/process-execution-broker/index.js";

function scriptedChat(toolName, toolArgs) {
  let turn = 0;
  return async () => {
    turn += 1;
    if (turn === 1) {
      return {
        message: {
          role: "assistant",
          tool_calls: [
            {
              id: "managed-call-1",
              function: {
                name: toolName,
                arguments: JSON.stringify(toolArgs),
              },
            },
          ],
        },
      };
    }
    return { message: { role: "assistant", content: "done" } };
  };
}

async function runLoop(cwd, stateDir, toolName, toolArgs, extra = {}) {
  const events = [];
  for await (const event of agentLoop(
    [{ role: "user", content: "run the managed tool" }],
    {
      cwd,
      chatFn: scriptedChat(toolName, toolArgs),
      autoCheckpoint: false,
      managedCheckpoint: true,
      managedCheckpointStateDir: stateDir,
      ...extra,
    },
  )) {
    events.push(event);
  }
  return events;
}

async function drainBackgroundShells() {
  killAllBackgroundShellTasks();
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!listBackgroundShellTasks().some((task) => task.status === "running")) {
      return;
    }
    killAllBackgroundShellTasks();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("managed checkpoint agent integration", () => {
  const cleanup = [];

  afterEach(async () => {
    await disposeSharedCodeIntel();
    await drainBackgroundShells();
    for (const target of cleanup.splice(0)) {
      rmSync(target, { recursive: true, force: true });
    }
  });

  function temp(prefix) {
    const target = mkdtempSync(join(tmpdir(), prefix));
    cleanup.push(target);
    return target;
  }

  it("blocks the tool before execution when strict preparation fails", async () => {
    const workspace = temp("cc-managed-prep-workspace-");
    const secret = "must-not-be-written-after-preparation-failure";

    // A managed state directory inside the workspace is forbidden. This
    // reliably exercises the fail-closed preparation path without mocking the
    // transaction engine.
    const events = await runLoop(
      workspace,
      join(workspace, ".managed-state"),
      "write_file",
      { path: "blocked.txt", content: secret },
    );

    expect(existsSync(join(workspace, "blocked.txt"))).toBe(false);
    expect(events.some((event) => event.type === "tool-executing")).toBe(false);

    const checkpointError = events.find(
      (event) => event.type === "managed-checkpoint-error",
    );
    const toolResult = events.find((event) => event.type === "tool-result");
    expect(checkpointError).toMatchObject({
      phase: "prepare",
      coverage: "none",
      tool: "write_file",
    });
    expect(toolResult).toMatchObject({
      error: expect.stringMatching(/state directory must be outside/i),
      result: {
        error: expect.stringMatching(/blocked before execution/i),
        managedCheckpoint: {
          status: "not_started",
          coverage: "none",
        },
      },
    });
    expect(events.indexOf(checkpointError)).toBeLessThan(
      events.indexOf(toolResult),
    );
  });

  it("commits successful writes in order without copying file contents into checkpoint events", async () => {
    const workspace = temp("cc-managed-success-workspace-");
    const stateDir = temp("cc-managed-success-state-");
    const secret = "checkpoint-event-secret-marker";

    const events = await runLoop(workspace, stateDir, "write_file", {
      path: "created.txt",
      content: secret,
    });

    expect(readFileSync(join(workspace, "created.txt"), "utf8")).toBe(secret);
    const prepared = events.find(
      (event) => event.type === "managed-checkpoint",
    );
    const executing = events.find((event) => event.type === "tool-executing");
    const settled = events.find(
      (event) => event.type === "managed-checkpoint-settled",
    );
    const result = events.find((event) => event.type === "tool-result");

    expect(prepared).toMatchObject({ phase: "prepared", coverage: "partial" });
    expect(settled).toMatchObject({
      phase: "committed",
      coverage: "partial",
      transaction_id: prepared.transaction_id,
      evidence_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(events.indexOf(prepared)).toBeLessThan(events.indexOf(executing));
    expect(events.indexOf(executing)).toBeLessThan(events.indexOf(settled));
    expect(events.indexOf(settled)).toBeLessThan(events.indexOf(result));
    expect(JSON.stringify([prepared, settled])).not.toContain(secret);
  });

  it("rolls back and releases the lock when the event consumer stops after prepare", async () => {
    const workspace = temp("cc-managed-cancel-workspace-");
    const stateDir = temp("cc-managed-cancel-state-");
    const iterator = agentLoop(
      [{ role: "user", content: "write then disconnect" }],
      {
        cwd: workspace,
        chatFn: scriptedChat("write_file", {
          path: "must-not-run.txt",
          content: "uncommitted",
        }),
        autoCheckpoint: false,
        managedCheckpoint: true,
        managedCheckpointStateDir: stateDir,
      },
    );

    let prepared;
    while (!prepared) {
      const next = await iterator.next();
      expect(next.done).toBe(false);
      if (next.value?.type === "managed-checkpoint") prepared = next.value;
    }
    expect(prepared.phase).toBe("prepared");
    expect(existsSync(join(workspace, "must-not-run.txt"))).toBe(false);

    await expect(iterator.return()).resolves.toMatchObject({ done: true });
    const state = JSON.parse(
      readFileSync(
        join(
          stateDir,
          "transactions",
          prepared.transaction_id,
          "transaction.json",
        ),
        "utf8",
      ),
    );
    expect(state).toMatchObject({
      state: "rolled_back",
      evidence: {
        outcome: "rolled_back",
        fileCoverage: "partial",
      },
    });
    expect(existsSync(join(workspace, "must-not-run.txt"))).toBe(false);

    // A second managed transaction on the same workspace proves the lifetime
    // lock was released, rather than merely changing durable state.
    const resumed = await runLoop(workspace, stateDir, "write_file", {
      path: "after-cancel.txt",
      content: "ok",
    });
    expect(
      resumed.find((event) => event.type === "managed-checkpoint-settled"),
    ).toMatchObject({ phase: "committed" });
    expect(readFileSync(join(workspace, "after-cancel.txt"), "utf8")).toBe(
      "ok",
    );
  });

  it("rolls back a failed tool call and reports the durable rollback evidence", async () => {
    const workspace = temp("cc-managed-failure-workspace-");
    const stateDir = temp("cc-managed-failure-state-");
    writeFileSync(join(workspace, "seed.txt"), "unchanged", "utf8");

    const events = await runLoop(workspace, stateDir, "edit_file", {
      path: "seed.txt",
      old_string: "missing text",
      new_string: "replacement",
    });

    expect(readFileSync(join(workspace, "seed.txt"), "utf8")).toBe("unchanged");
    const settled = events.find(
      (event) => event.type === "managed-checkpoint-settled",
    );
    const result = events.find((event) => event.type === "tool-result");
    expect(settled).toMatchObject({
      phase: "rolled_back",
      coverage: "partial",
      evidence_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(result.result.managedCheckpoint.evidence).toMatchObject({
      outcome: "rolled_back",
      coverage: "partial",
    });
  });

  it("rolls back workspace writes made by a foreground Broker process that exits nonzero", async () => {
    const root = temp("cc-managed-process-root-");
    const workspace = join(root, "workspace");
    const stateDir = join(root, "state");
    const sentinel = join(root, "process-executed.txt");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "seed.txt"), "before", "utf8");

    // The sentinel is intentionally outside the workspace transaction. It
    // proves the child process really ran, while the two in-workspace writes
    // prove the transaction restored both a modified and a newly-created
    // file after the nonzero exit.
    const script = [
      "const fs=require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(sentinel)},'executed')`,
      "fs.writeFileSync('seed.txt','changed')",
      "fs.writeFileSync('new.txt','new')",
      "process.exit(7)",
    ].join(";");
    const encoded = Buffer.from(script, "utf8").toString("base64");
    const command =
      `"${process.execPath}" -e ` +
      `"eval(Buffer.from('${encoded}','base64').toString('utf8'))"`;

    // This test isolates the Broker/checkpoint writer fence from native
    // platform availability. The real Linux/macOS/Windows boundaries have
    // their own strict CI matrix; ordinary unit runners must not depend on a
    // host bubblewrap/AppContainer installation.
    const sandboxPlan = vi
      .spyOn(executionBroker, "_prepareSandboxPlan")
      .mockImplementation((file, argv, options, context = {}) => ({
        contractVersion: 1,
        applied: true,
        platform: process.platform,
        profile: "strict",
        command: file,
        args: [...(argv || [])],
        options: { ...options },
        enforcement: "test-process-tree",
        backend: "test-process-tree",
        guarantees: ["process-tree"],
        requiredBoundaries: [
          ...(context.sandboxPolicy?.requiredBoundaries || []),
        ],
        reason: null,
        postSpawn: { required: false, mode: "none" },
        cleanup: vi.fn(),
      }));
    let events;
    try {
      events = await runLoop(workspace, stateDir, "run_shell", {
        command,
      });
    } finally {
      sandboxPlan.mockRestore();
    }

    const processResult = events.find((event) => event.type === "tool-result");
    expect(
      existsSync(sentinel),
      JSON.stringify(processResult?.result || processResult || null),
    ).toBe(true);
    expect(readFileSync(sentinel, "utf8")).toBe("executed");
    expect(readFileSync(join(workspace, "seed.txt"), "utf8")).toBe("before");
    expect(existsSync(join(workspace, "new.txt"))).toBe(false);
    expect(
      events.find((event) => event.type === "managed-checkpoint-settled"),
    ).toMatchObject({
      phase: "rolled_back",
      coverage: "partial",
      evidence_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(processResult).toMatchObject({
      result: {
        exitCode: 7,
        managedCheckpoint: {
          evidence: { outcome: "rolled_back" },
        },
      },
    });
  }, 30_000);

  it.each([
    {
      name: "additional workspace root",
      expectedReason: "additional_workspace_roots_not_transactional",
      extra: (additional) => ({ additionalDirectories: [additional] }),
    },
    {
      name: "ambient MCP server",
      expectedReason: "ambient_mcp_server_writer_not_quiescent",
      extra: () => ({
        mcpClient: { servers: new Map([["ambient", {}]]) },
      }),
    },
    {
      name: "asynchronous hook writer",
      expectedReason: "asynchronous_hook_writer_not_quiescent",
      extra: () => ({
        settingsHooks: {},
        hookSupervisor: { dispatch: vi.fn() },
      }),
    },
  ])("reports coverage none for $name", async ({ expectedReason, extra }) => {
    const workspace = temp("cc-managed-uncovered-workspace-");
    const stateDir = temp("cc-managed-uncovered-state-");
    const additional = temp("cc-managed-additional-workspace-");
    const events = await runLoop(
      workspace,
      stateDir,
      "write_file",
      { path: "still-runs.txt", content: "written" },
      extra(additional),
    );

    expect(readFileSync(join(workspace, "still-runs.txt"), "utf8")).toBe(
      "written",
    );
    expect(
      events.find((event) => event.type === "managed-checkpoint"),
    ).toMatchObject({
      phase: "unavailable",
      coverage: "none",
      reason: expectedReason,
    });
    expect(
      events.find((event) => event.type === "managed-checkpoint-settled"),
    ).toMatchObject({
      phase: "unavailable",
      coverage: "none",
      reason: expectedReason,
    });
  });

  it("reports coverage none while an overlapping LSP pool entry is alive", async () => {
    const workspace = temp("cc-managed-lsp-workspace-");
    const stateDir = temp("cc-managed-lsp-state-");
    await _getSharedCodeIntel(workspace);

    const events = await runLoop(workspace, stateDir, "write_file", {
      path: "lsp-overlap.txt",
      content: "written without rollback claim",
    });

    expect(readFileSync(join(workspace, "lsp-overlap.txt"), "utf8")).toBe(
      "written without rollback claim",
    );
    expect(
      events.find((event) => event.type === "managed-checkpoint"),
    ).toMatchObject({
      phase: "unavailable",
      coverage: "none",
      reason: "ambient_lsp_writer_not_quiescent",
    });
    expect(
      events.find((event) => event.type === "managed-checkpoint-settled"),
    ).toMatchObject({
      phase: "unavailable",
      coverage: "none",
      reason: "ambient_lsp_writer_not_quiescent",
    });
  });

  it("reports coverage none for a background writer", async () => {
    const workspace = temp("cc-managed-background-workspace-");
    const stateDir = temp("cc-managed-background-state-");
    const events = await runLoop(workspace, stateDir, "run_shell", {
      command: `"${process.execPath}" -e "setTimeout(()=>{},500)"`,
      run_in_background: true,
    });

    expect(
      events.find((event) => event.type === "managed-checkpoint"),
    ).toMatchObject({
      phase: "unavailable",
      coverage: "none",
      reason: "background_writer_not_quiescent",
    });
    expect(
      events.find((event) => event.type === "managed-checkpoint-settled"),
    ).toMatchObject({
      phase: "unavailable",
      coverage: "none",
      reason: "background_writer_not_quiescent",
    });
  });

  it("reports coverage none for an external MCP writer", async () => {
    const workspace = temp("cc-managed-external-workspace-");
    const stateDir = temp("cc-managed-external-state-");
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
      isError: false,
    }));
    const toolName = "mcp_external_write";
    const events = await runLoop(
      workspace,
      stateDir,
      toolName,
      { value: "external" },
      {
        mcpClient: { callTool },
        externalToolDescriptors: {
          [toolName]: {
            name: toolName,
            source: "mcp:external",
            riskLevel: "medium",
            isReadOnly: false,
          },
        },
        externalToolExecutors: {
          [toolName]: {
            kind: "mcp",
            serverName: "external",
            toolName: "write",
          },
        },
      },
    );

    expect(callTool).toHaveBeenCalledOnce();
    expect(
      events.find((event) => event.type === "managed-checkpoint"),
    ).toMatchObject({
      phase: "unavailable",
      coverage: "none",
      reason: "external_writer_lifetime_unmanaged",
    });
  });
});

describe("managed checkpoint CLI and runtime propagation", () => {
  it("parses the explicit flag, state directory and repeatable exclusions", () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommand(program);
    const command = program.commands.find(
      (candidate) => candidate.name() === "agent",
    );

    command.parseOptions([
      "--managed-checkpoint",
      "--managed-checkpoint-state",
      "durable-state",
      "--managed-checkpoint-exclude",
      "vendor",
      "--managed-checkpoint-exclude",
      "generated",
    ]);

    expect(command.opts()).toMatchObject({
      managedCheckpoint: true,
      managedCheckpointState: "durable-state",
      managedCheckpointExclude: ["vendor", "generated"],
    });
  });

  it("preserves the managed options through the interactive runtime policy and REPL handoff", async () => {
    const startAgentRepl = vi.fn(async () => "started");
    const overrides = {
      managedCheckpoint: true,
      managedCheckpointStateDir: "durable-state",
      managedCheckpointExclusions: ["vendor", "generated"],
    };

    expect(resolveAgentPolicy({ config: {}, overrides })).toMatchObject(
      overrides,
    );

    const runtime = createAgentRuntimeFactory({
      config: {},
      deps: { startAgentRepl },
    }).createAgentRuntime(overrides);
    await runtime.startAgentSession();
    expect(startAgentRepl).toHaveBeenCalledWith(
      expect.objectContaining(overrides),
    );
  });

  it("preserves the managed options through the single-prompt headless runner", async () => {
    let captured;
    const agentLoop = async function* (_messages, options) {
      captured = options;
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };

    await runAgentHeadless(
      {
        prompt: "test",
        managedCheckpoint: true,
        managedCheckpointStateDir: "durable-state",
        managedCheckpointExclusions: ["vendor", "generated"],
      },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        agentLoop,
        writeOut: () => {},
        writeErr: () => {},
      },
    );

    expect(captured).toMatchObject({
      managedCheckpoint: true,
      managedCheckpointStateDir: "durable-state",
      managedCheckpointExclusions: ["vendor", "generated"],
    });
  }, 30_000);

  it("preserves the managed options through the stream-json runner", async () => {
    let captured;
    const output = [];
    const agentLoop = async function* (_messages, options) {
      captured = options;
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    async function* input() {
      yield `${JSON.stringify({ type: "user", text: "test" })}\n`;
    }

    await runAgentHeadlessStream(
      {
        expandFileRefs: false,
        managedCheckpoint: true,
        managedCheckpointStateDir: "durable-state",
        managedCheckpointExclusions: ["vendor", "generated"],
      },
      {
        input: input(),
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        agentLoop,
        writeOut: (chunk) => output.push(chunk),
        writeErr: () => {},
      },
    );

    expect(captured).toMatchObject({
      managedCheckpoint: true,
      managedCheckpointStateDir: "durable-state",
      managedCheckpointExclusions: ["vendor", "generated"],
    });
    expect(output.length).toBeGreaterThan(0);
  });
});
