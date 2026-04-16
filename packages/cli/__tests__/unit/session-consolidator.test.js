import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-consolidate-"));
  vi.resetModules();
  vi.doMock("../../src/lib/paths.js", () => ({
    getHomeDir: () => tmpHome,
    getBinDir: () => path.join(tmpHome, "bin"),
    getConfigPath: () => path.join(tmpHome, "config.json"),
    getStatePath: () => path.join(tmpHome, "state"),
    getPidFilePath: () => path.join(tmpHome, "state", "app.pid"),
    getServicesDir: () => path.join(tmpHome, "services"),
  }));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.doUnmock("../../src/lib/paths.js");
});

function writeJsonl(sessionId, events) {
  const dir = path.join(tmpHome, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  const body = events
    .map((e) => JSON.stringify({ timestamp: Date.now(), ...e }))
    .join("\n");
  fs.writeFileSync(file, body + "\n", "utf-8");
}

describe("buildTraceStoreFromJsonl", () => {
  it("maps user/assistant messages + tool_call/result into TRACE_TYPES", async () => {
    const { buildTraceStoreFromJsonl } =
      await import("../../src/lib/session-consolidator.js");
    const { TRACE_TYPES } = await import("@chainlesschain/session-core");

    const events = [
      { type: "session_start", data: { title: "t" } },
      { type: "user_message", data: { content: "我喜欢 TypeScript" } },
      { type: "assistant_message", data: { content: "ok" } },
      { type: "tool_call", data: { tool: "read_file", args: { path: "a" } } },
      {
        type: "tool_result",
        data: { tool: "read_file", result: { summary: "done" } },
      },
      { type: "compact", data: {} },
    ];

    const trace = buildTraceStoreFromJsonl("s1", events);
    const recorded = trace.query("s1", { limit: 100 });

    expect(recorded).toHaveLength(4); // session_start + compact skipped
    expect(recorded[0].type).toBe(TRACE_TYPES.MESSAGE);
    expect(recorded[0].payload.role).toBe("user");
    expect(recorded[1].payload.role).toBe("assistant");
    expect(recorded[2].type).toBe(TRACE_TYPES.TOOL_CALL);
    expect(recorded[3].type).toBe(TRACE_TYPES.TOOL_RESULT);
    expect(recorded[3].payload.ok).toBe(true);
    expect(recorded[3].payload.summary).toBe("done");
  });

  it("flags tool_result as not-ok when payload has error", async () => {
    const { buildTraceStoreFromJsonl } =
      await import("../../src/lib/session-consolidator.js");
    const trace = buildTraceStoreFromJsonl("s2", [
      {
        type: "tool_result",
        data: { tool: "x", result: { error: "boom" } },
      },
    ]);
    const [e] = trace.query("s2");
    expect(e.payload.ok).toBe(false);
  });

  it("falls back to readEvents when events not provided", async () => {
    writeJsonl("s3", [
      { type: "user_message", data: { content: "I prefer vim" } },
    ]);
    const { buildTraceStoreFromJsonl } =
      await import("../../src/lib/session-consolidator.js");
    const trace = buildTraceStoreFromJsonl("s3");
    expect(trace.query("s3")).toHaveLength(1);
  });
});

describe("consolidateJsonlSession", () => {
  it("extracts user preferences and tool-completions into MemoryStore", async () => {
    writeJsonl("abc", [
      { type: "session_start", data: { title: "t" } },
      {
        type: "user_message",
        data: { content: "我喜欢用 pnpm 管理依赖" },
      },
      {
        type: "tool_result",
        data: { tool: "edit_file", result: { summary: "patched" } },
      },
    ]);

    const { consolidateJsonlSession } =
      await import("../../src/lib/session-consolidator.js");
    const { getMemoryStore } =
      await import("../../src/lib/session-core-singletons.js");

    const result = await consolidateJsonlSession("abc", {
      scope: "agent",
      agentId: "agent-a",
    });

    expect(result.sessionId).toBe("abc");
    expect(result.scope).toBe("agent");
    expect(result.scopeId).toBe("agent-a");
    expect(result.writtenCount).toBeGreaterThanOrEqual(2);

    const store = getMemoryStore();
    const recalled = store.recall({
      scope: "agent",
      scopeId: "agent-a",
      limit: 10,
    });
    expect(recalled.length).toBeGreaterThanOrEqual(2);
    expect(recalled.some((m) => m.category === "preference")).toBe(true);
    expect(recalled.some((m) => m.category === "task")).toBe(true);
  });

  it("throws SESSION_NOT_FOUND when JSONL is missing", async () => {
    const { consolidateJsonlSession } =
      await import("../../src/lib/session-consolidator.js");
    await expect(consolidateJsonlSession("missing-id")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
  });

  it("honours scope=session", async () => {
    writeJsonl("sess-x", [
      { type: "user_message", data: { content: "我偏好 dark mode" } },
    ]);
    const { consolidateJsonlSession } =
      await import("../../src/lib/session-consolidator.js");
    const { getMemoryStore } =
      await import("../../src/lib/session-core-singletons.js");

    const result = await consolidateJsonlSession("sess-x", {
      scope: "session",
    });
    expect(result.scope).toBe("session");
    expect(result.scopeId).toBe("sess-x");

    const store = getMemoryStore();
    const recalled = store.recall({
      scope: "session",
      scopeId: "sess-x",
      limit: 10,
    });
    expect(recalled.length).toBeGreaterThanOrEqual(1);
  });
});
