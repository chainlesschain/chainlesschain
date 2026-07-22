import { describe, expect, test } from "vitest";
import { HooksV2Runtime } from "../../../src/lib/hooks-v2-runtime.js";
import { ContextSourceLedger } from "../../../src/lib/context-source-ledger.js";
import { AgentIPCBus } from "../../../src/lib/agent-ipc-bus.js";
import { EventRuntimeStore } from "../../../src/lib/event-runtime-store.js";
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
