import { describe, expect, test } from "vitest";
import { HooksV2Runtime } from "../../../src/lib/hooks-v2-runtime.js";
import { ContextSourceLedger } from "../../../src/lib/context-source-ledger.js";
import { AgentIPCBus } from "../../../src/lib/agent-ipc-bus.js";
import { EventRuntimeStore } from "../../../src/lib/event-runtime-store.js";
import { emitHooksV2Event } from "../../../src/lib/hooks-v2-producers.js";
import { agentLoop } from "../../../src/runtime/agent-core.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("runtime convergence compatibility APIs", () => {
  test("executes programmatic JS hooks and supports parallel mode", async () => {
    const runtime = new HooksV2Runtime();
    const order = [];
    runtime.registerHook({
      id: "compat-hook-a",
      event: "Notification",
      type: "js",
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("a");
        return { ok: true };
      },
    });
    runtime.registerHook({
      id: "compat-hook-b",
      event: "Notification",
      type: "js",
      handler: () => {
        order.push("b");
        return { ok: true };
      },
    });

    const result = await runtime.executeHooks("Notification", { source: "test" });
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((entry) => entry.status === "success")).toBe(true);
    expect(order).toContain("a");
    expect(order).toContain("b");
  });

  test("accepts lifecycle events produced by subagents and MCP elicitation", async () => {
    const runtime = new HooksV2Runtime();
    const seen = [];
    for (const event of ["TaskCreated", "TaskCompleted", "MCPElicitation"]) {
      runtime.registerHook({
        id: `producer-${event}`,
        event,
        type: "js",
        handler: (context) => {
          seen.push({ event, context });
          return { ok: true };
        },
      });
      const result = await runtime.executeHooks(event, { source: "producer-test" });
      expect(result.success).toBe(true);
    }
    expect(seen.map((entry) => entry.event)).toEqual([
      "TaskCreated",
      "TaskCompleted",
      "MCPElicitation",
    ]);
  });

  test("filters FileChanged producers with cross-platform globs", async () => {
    const runtime = new HooksV2Runtime();
    const seen = [];
    runtime.registerHook({
      id: "file-js",
      event: "FileChanged",
      type: "js",
      globs: ["src/**/*.js"],
      handler: (context) => {
        seen.push(context.path);
        return { ok: true };
      },
    });

    await runtime.executeHooks("FileChanged", {
      path: "src/lib/worker.js",
      cwd: process.cwd(),
    });
    await runtime.executeHooks("FileChanged", {
      path: "docs/worker.js",
      cwd: process.cwd(),
    });
    await runtime.executeHooks("FileChanged", {
      path: "src\\runtime\\agent-core.js",
      cwd: process.cwd(),
    });

    expect(seen).toEqual([
      "src/lib/worker.js",
      "src\\runtime\\agent-core.js",
    ]);
  });

  test("bridges a producer event into the default Hooks v2 runtime", async () => {
    const { default: runtime } = await import(
      "../../../src/lib/hooks-v2-runtime.js"
    );
    const seen = [];
    const id = runtime.registerHook({
      id: "producer-bridge-test",
      event: "MCPElicitation",
      type: "js",
      handler: (context) => {
        seen.push(context.request_id);
        return { ok: true };
      },
    });
    try {
      emitHooksV2Event("MCPElicitation", { request_id: "mcp-1" });
      for (let i = 0; i < 20 && seen.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(seen).toEqual(["mcp-1"]);
    } finally {
      runtime.unregisterHook(id);
    }
  });

  test("agent tool loop emits failure and batch producers from a real turn", async () => {
    const { default: runtime } = await import(
      "../../../src/lib/hooks-v2-runtime.js"
    );
    const seen = [];
    const ids = ["PostToolUseFailure", "PostToolBatch"].map((event) =>
      runtime.registerHook({
        id: `real-loop-${event}`,
        event,
        type: "js",
        handler: (context) => {
          seen.push({ event, context });
          return { ok: true };
        },
      }),
    );
    let call = 0;
    try {
      const events = agentLoop([{ role: "user", content: "test malformed" }], {
        autoCompact: false,
        sessionId: "hook-session",
        runId: "hook-run",
        chatFn: async () => {
          call += 1;
          return call === 1
            ? {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [{ id: "bad-1", type: "function" }],
                },
                usage: {},
              }
            : {
                message: { role: "assistant", content: "done" },
                usage: {},
              };
        },
      });
      for await (const _event of events) {
        // Drain the real generator.
      }
      for (let i = 0; i < 20 && seen.length < 2; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(seen.map((entry) => entry.event).sort()).toEqual([
        "PostToolBatch",
        "PostToolUseFailure",
      ]);
      expect(
        seen.find((entry) => entry.event === "PostToolBatch")?.context,
      ).toMatchObject({
        session_id: "hook-session",
        turn_id: "hook-run:t1",
        total: 1,
        failed: 1,
        tool_use_ids: ["bad-1"],
      });
    } finally {
      ids.forEach((id) => runtime.unregisterHook(id));
    }
  });

  test("emits StopFailure when a real Stop hook cannot execute", async () => {
    const { default: runtime } = await import(
      "../../../src/lib/hooks-v2-runtime.js"
    );
    const seen = [];
    const id = runtime.registerHook({
      id: "real-stop-failure",
      event: "StopFailure",
      type: "js",
      handler: (context) => {
        seen.push(context);
        return { ok: true };
      },
    });
    try {
      const events = agentLoop([{ role: "user", content: "finish" }], {
        autoCompact: false,
        sessionId: "stop-session",
        runId: "stop-run",
        chatFn: async () => ({
          message: { role: "assistant", content: "done" },
          usage: {},
        }),
        settingsHooks: {
          Stop: [
            {
              matcher: null,
              hooks: [
                {
                  type: "command",
                  command: "cc-definitely-missing-stop-hook-command",
                },
              ],
            },
          ],
        },
      });
      for await (const _event of events) {
        // Drain the real generator.
      }
      for (let i = 0; i < 40 && seen.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(seen[0]).toMatchObject({
        session_id: "stop-session",
        run_id: "stop-run",
        phase: "stop-hook",
      });
      expect(seen[0].failures).toHaveLength(1);
    } finally {
      runtime.unregisterHook(id);
    }
  });

  test("persists hook delivery and result through the durable runtime boundary", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hooks-durable-"));
    try {
      const durableStore = new EventRuntimeStore({ dir, owner: "test" });
      const runtime = new HooksV2Runtime(undefined, { durableStore });
      runtime.registerHook({
        id: "durable-hook",
        event: "Notification",
        type: "js",
        handler: () => ({ ok: true }),
      });

      const result = await runtime.emitEvent("Notification", {
        event_id: "hook-event-1",
        source: "test",
      });

      expect(result.success).toBe(true);
      expect(durableStore.listInbox({ status: "done" })).toHaveLength(1);
      expect(durableStore.listOutbox({ status: "pending" })).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves trace IDs through legacy provenance adapters", () => {
    const ledger = new ContextSourceLedger();
    ledger.recordRead({
      sessionId: "session-1",
      turnId: "turn-1",
      source: "tool:shell",
      span: "shell:echo",
      content: "hello",
      tokens: 12,
      traceId: "trace-1",
    });

    expect(ledger.getProvenance({ turnId: "turn-1" })[0].traceId).toBe("trace-1");
    expect(ledger.getTokenBreakdown()).toEqual({
      total: 12,
      bySource: { "tool:shell": 12 },
    });
    ledger.clear();
    expect(ledger.getProvenance()).toHaveLength(0);
  });

  test("exposes agent registration state for lifecycle cleanup", () => {
    const bus = new AgentIPCBus();
    bus.registerAgent("agent-1", () => {});
    expect(bus.isAgentRegistered("agent-1")).toBe(true);
    bus.unregisterAgent("agent-1");
    expect(bus.isAgentRegistered("agent-1")).toBe(false);
  });
});
