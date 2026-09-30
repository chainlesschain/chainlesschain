import {
  agentLoop as coreAgentLoop,
  runAgentHeadless,
  withTestEvolutionIngress,
  executeTool,
} from "../helpers/test-model-egress.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import { agentLoop as replAgentLoop } from "../../src/repl/agent-repl.js";
import { createAgentRuntimeFactory } from "../../src/runtime/runtime-factory.js";
import { _gitProcessDeps } from "../../src/runtime/agent-core.js";
import { AgentScheduleStore } from "../../src/lib/agent-schedule-store.js";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";
import { ApprovalGate, APPROVAL_POLICY } from "@chainlesschain/session-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let cwd;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-unattended-entry-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

const unattended = (allowlist = []) => ({
  unattended: true,
  allowlist,
  trigger: { trusted: true },
});

function toolModel(name, args, beforeCall = () => {}) {
  let calls = 0;
  return vi.fn(async () => {
    beforeCall();
    return {
      message:
        ++calls === 1
          ? {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "unattended-call",
                  type: "function",
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            }
          : { role: "assistant", content: "complete" },
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });
}

async function runEntry(kind, name, args, overrides = {}, beforeCall) {
  const events = [];
  const loop = async function* (messages, options) {
    for await (const event of coreAgentLoop(messages, options)) {
      events.push(event);
      yield event;
    }
  };
  const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.AUTOPILOT });
  const options = withTestEvolutionIngress({
    cwd,
    ephemeral: true,
    expandFileRefs: false,
    slashMacros: false,
    useRegisteredMcp: false,
    ide: false,
    pdh: false,
    jetbrains: false,
    projectMemory: false,
    autoCheckpoint: false,
    permissionMode: "bypassPermissions",
    unattendedActionPolicy: unattended(),
    chatFn: toolModel(name, args, beforeCall),
    ...overrides,
  });
  if (kind === "repl") {
    await replAgentLoop([{ role: "user", content: "exercise policy" }], {
      ...options,
      approvalGate: gate,
      _coreLoop: loop,
      writeOut: () => {},
    });
  } else {
    const deps = {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => gate,
      agentLoop: loop,
      writeOut: () => {},
      writeErr: () => {},
    };
    if (kind === "stream-input") {
      deps.input = (async function* () {
        yield '{"type":"user","text":"exercise policy"}\n';
      })();
      await runAgentHeadlessStream(options, deps);
    } else {
      await runAgentHeadless(
        { ...options, prompt: "exercise policy", outputFormat: kind },
        deps,
      );
    }
  }
  return events.find((event) => event.type === "tool-result")?.result;
}

describe("unattended policy through real runtime entries", () => {
  it.each([
    "fetch --upload-pack='npm publish' .",
    "fetch --up=executor .",
    "push --receive-pack=executor origin feature",
    "merge --strategy=executor feature",
  ])("blocks the actual Git argv dispatch for %s", async (command) => {
    const dispatch = vi.spyOn(_gitProcessDeps, "run");
    const result = await executeTool(
      "git",
      { command },
      {
        cwd,
        unattendedActionPolicy: unattended([
          "publish",
          "merge",
          "deploy",
          "infra_mutation",
          "external_message",
        ]),
      },
    );
    expect(result.policy?.via).toBe("unattended-action-policy");
    expect(result.unattendedAction?.reason).toBe("unknown-action-unattended");
    expect(dispatch).not.toHaveBeenCalled();
  });
  it.each(["run_code", "run_skill", "browser_act", "spawn_sub_agent"])(
    "refuses opaque %s effects even with all high-risk classes allowlisted",
    async (name) => {
      const result = await executeTool(
        name,
        name === "run_code"
          ? { language: "node", code: "console.log('must-not-run')" }
          : {},
        {
          cwd,
          unattendedActionPolicy: unattended([
            "publish",
            "merge",
            "deploy",
            "infra_mutation",
            "external_message",
          ]),
        },
      );
      expect(result.policy?.via).toBe("unattended-action-policy");
      expect(result.unattendedAction?.reason).toBe("unknown-action-unattended");
    },
  );

  it.each(["wakeup", "cron", "monitor"])(
    "refuses persistent %s creation before storage",
    async (action) => {
      const create = vi.spyOn(
        AgentScheduleStore.prototype,
        action === "wakeup"
          ? "scheduleWakeup"
          : action === "cron"
            ? "createCron"
            : "createMonitor",
      );
      const result = await executeTool(
        "schedule",
        {
          action,
          prompt: "publish",
          cron: "* * * * *",
          command: "npm publish",
          unattended_allow: ["publish"],
        },
        { cwd, unattendedActionPolicy: unattended() },
      );
      expect(result.policy?.via).toBe("unattended-action-policy");
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("does not trust a peer's read-only annotation for an opaque MCP executor", async () => {
    const callTool = vi.fn();
    const result = await executeTool(
      "mcp_peer_read",
      {},
      {
        cwd,
        unattendedActionPolicy: unattended(),
        mcpClient: { callTool },
        externalToolDescriptors: {
          mcp_peer_read: {
            isReadOnly: true,
            annotations: { readOnlyHint: true },
          },
        },
        externalToolExecutors: {
          mcp_peer_read: { kind: "mcp", serverName: "peer", toolName: "read" },
        },
      },
    );
    expect(result.unattendedAction?.reason).toBe("unknown-action-unattended");
    expect(callTool).not.toHaveBeenCalled();
  });

  it("retains the child authority despite input mutation and run-time overrides", async () => {
    const input = unattended();
    const dispatch = vi.spyOn(_gitProcessDeps, "run");
    const child = new SubAgentContext({
      cwd,
      unattendedActionPolicy: input,
      allowedTools: ["git"],
      llmOptions: withTestEvolutionIngress({
        chatFn: toolModel("git", { command: "push origin main" }),
      }),
    });
    input.allowlist.push("merge");
    input.trigger.trusted = false;
    await child.run("try protected push", {
      unattendedActionPolicy: unattended(["merge"]),
    });
    expect(
      child.messages.find((message) => message.role === "tool")?.content,
    ).toContain("Unattended Action");
    expect(dispatch).not.toHaveBeenCalled();
  });
  it.each(["false", {}])(
    "nonboolean hermetic option %j cannot clear unattended authority",
    async (hermeticExecution) => {
      const dispatch = vi.spyOn(_gitProcessDeps, "run");
      const result = await runEntry(
        "json",
        "git",
        { command: "push origin main" },
        { hermeticExecution },
      );
      expect(result?.policy?.via).toBe("unattended-action-policy");
      expect(dispatch).not.toHaveBeenCalled();
    },
  );
  it.each(["text", "json", "stream-json", "stream-input", "repl"])(
    "%s blocks protected git dispatch while bypass permissions is enabled",
    async (kind) => {
      const dispatch = vi
        .spyOn(_gitProcessDeps, "run")
        .mockReturnValue({ status: 0, stdout: "dispatched" });
      const result = await runEntry(kind, "git", {
        command: "push origin HEAD:main",
      });
      expect(result?.policy?.via).toBe("unattended-action-policy");
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it("allows an explicitly authorized merge through the real git argv boundary", async () => {
    const dispatch = vi
      .spyOn(_gitProcessDeps, "run")
      .mockReturnValue({ status: 0, stdout: "dispatched" });
    const result = await runEntry(
      "json",
      "git",
      { command: "push origin HEAD:main" },
      {
        unattendedActionPolicy: unattended(["merge"]),
      },
    );
    expect(result?.error).toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith(
      "git",
      ["push", "origin", "HEAD:main"],
      expect.any(Object),
    );
  });

  it("retains Plan's tool ceiling despite an unattended allowlist", async () => {
    const dispatch = vi.spyOn(_gitProcessDeps, "run");
    const result = await runEntry(
      "json",
      "git",
      { command: "push origin HEAD:main" },
      {
        permissionMode: "plan",
        unattendedActionPolicy: unattended(["merge"]),
      },
    );
    expect(result?.error).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("executes permitted local shell work and produces the real file", async () => {
    const result = await runEntry("json", "run_shell", {
      command: "echo allowed-local > unattended-marker.txt",
    });
    expect(result?.error).toBeUndefined();
    expect(
      fs.readFileSync(path.join(cwd, "unattended-marker.txt"), "utf8"),
    ).toContain("allowed-local");
  });

  it.each(["notify", "publish_artifact"])(
    "blocks %s even with a settings allow",
    async (name) => {
      const result = await executeTool(
        name,
        {},
        {
          cwd,
          unattendedActionPolicy: unattended(),
          permissionRules: { allow: ["*"], deny: [], ask: [] },
          approvalGate: new ApprovalGate({
            defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
          }),
        },
      );
      expect(result.policy?.via).toBe("unattended-action-policy");
      expect(result.unattendedAction?.reason).toBe("requires-attendance");
    },
  );

  it("an allowlist still obeys the host deny", async () => {
    const result = await executeTool(
      "notify",
      {},
      {
        cwd,
        unattendedActionPolicy: unattended(["external_message"]),
        hostManagedToolPolicy: { tools: { notify: { allowed: false } } },
        permissionRules: { allow: ["*"], deny: [], ask: [] },
      },
    );
    expect(result.error).toBeTruthy();
    expect(result.policy?.via).not.toBe("unattended-action-policy");
  });

  it.each(["json", "stream-input"])(
    "%s cannot relax startup authority by mutating caller data",
    async (kind) => {
      const input = unattended();
      const dispatch = vi.spyOn(_gitProcessDeps, "run");
      const result = await runEntry(
        kind,
        "git",
        { command: "push origin main" },
        {
          unattendedActionPolicy: input,
        },
        () => {
          input.allowlist.push("merge");
          input.unattended = false;
        },
      );
      expect(result?.policy?.via).toBe("unattended-action-policy");
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it("preserves immutable policy through the actual interactive runtime handoff", async () => {
    const startAgentRepl = vi.fn(async () => "started");
    const input = unattended(["merge"]);
    const runtime = createAgentRuntimeFactory({
      config: {},
      deps: { startAgentRepl },
    }).createAgentRuntime({
      unattendedActionPolicy: input,
    });
    input.allowlist.push("publish");
    await runtime.startAgentSession();
    const passed = startAgentRepl.mock.calls[0][0].unattendedActionPolicy;
    expect(passed.allowlist).toEqual(["merge"]);
    expect(Object.isFrozen(passed.allowlist)).toBe(true);
  });
});
