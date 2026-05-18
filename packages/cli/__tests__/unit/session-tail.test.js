import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-tail-"));
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

async function drain(iter, { maxEvents, timeoutMs = 1000 } = {}) {
  const out = [];
  const deadline = Date.now() + timeoutMs;
  for await (const item of iter) {
    out.push(item);
    if (maxEvents && out.length >= maxEvents) break;
    if (Date.now() > deadline) break;
  }
  return out;
}

describe("session-tail", () => {
  it("parseChunk splits complete lines and keeps the partial tail", async () => {
    const { parseChunk } = await import("../../src/lib/session-tail.js");
    const { events, rest } = parseChunk(
      '{"type":"a","data":{}}\n{"type":"b","data":{}}\n{"type":"c"',
    );
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("a");
    expect(events[1].type).toBe("b");
    expect(rest).toBe('{"type":"c"');
  });

  it("parseChunk skips malformed lines", async () => {
    const { parseChunk } = await import("../../src/lib/session-tail.js");
    const { events } = parseChunk('not-json\n{"type":"ok","data":{}}\n{bad\n');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("ok");
  });

  it("followSession with fromStart+once drains existing events and stops", async () => {
    const { appendEvent } =
      await import("../../src/harness/jsonl-session-store.js");
    const { followSession } = await import("../../src/lib/session-tail.js");

    appendEvent("s1", "session_start", { title: "t" });
    appendEvent("s1", "user_message", { role: "user", content: "hi" });
    appendEvent("s1", "assistant_message", {
      role: "assistant",
      content: "ok",
    });

    const iter = followSession("s1", {
      fromStart: true,
      once: true,
      pollMs: 10,
    });
    const items = await drain(iter);
    expect(items.map((i) => i.event.type)).toEqual([
      "session_start",
      "user_message",
      "assistant_message",
    ]);
  });

  it("followSession filters by type", async () => {
    const { appendEvent } =
      await import("../../src/harness/jsonl-session-store.js");
    const { followSession } = await import("../../src/lib/session-tail.js");

    appendEvent("s2", "session_start", {});
    appendEvent("s2", "tool_call", { tool: "read_file" });
    appendEvent("s2", "assistant_message", { content: "x" });

    const iter = followSession("s2", {
      fromStart: true,
      once: true,
      types: ["tool_call"],
      pollMs: 10,
    });
    const items = await drain(iter);
    expect(items).toHaveLength(1);
    expect(items[0].event.type).toBe("tool_call");
  });

  it("followSession yields appended events in follow mode", async () => {
    const { appendEvent } =
      await import("../../src/harness/jsonl-session-store.js");
    const { followSession } = await import("../../src/lib/session-tail.js");

    appendEvent("s3", "session_start", {});
    const controller = new AbortController();
    const iter = followSession("s3", {
      signal: controller.signal,
      pollMs: 20,
    });

    setTimeout(() => {
      appendEvent("s3", "user_message", { role: "user", content: "ping" });
    }, 40);
    setTimeout(() => controller.abort(), 600);

    const items = await drain(iter, { maxEvents: 1, timeoutMs: 1500 });
    expect(items).toHaveLength(1);
    expect(items[0].event.type).toBe("user_message");
  });

  it("followSession with sinceMs filters by timestamp", async () => {
    const { sessionPath } =
      await import("../../src/harness/jsonl-session-store.js");
    const { followSession } = await import("../../src/lib/session-tail.js");
    // Write file with explicit timestamps
    fs.mkdirSync(path.join(tmpHome, "sessions"), { recursive: true });
    fs.writeFileSync(
      sessionPath("s4"),
      JSON.stringify({ type: "old", timestamp: 1, data: {} }) +
        "\n" +
        JSON.stringify({ type: "new", timestamp: 1000, data: {} }) +
        "\n",
      "utf-8",
    );

    const iter = followSession("s4", {
      fromStart: true,
      once: true,
      sinceMs: 500,
      pollMs: 10,
    });
    const items = await drain(iter);
    expect(items.map((i) => i.event.type)).toEqual(["new"]);
  });

  it("initialOffset returns EOF by default, 0 with fromStart", async () => {
    const { initialOffset } = await import("../../src/lib/session-tail.js");
    const { appendEvent } =
      await import("../../src/harness/jsonl-session-store.js");
    appendEvent("s5", "x", { foo: 1 });
    expect(initialOffset("s5", { fromStart: true })).toBe(0);
    expect(initialOffset("s5")).toBeGreaterThan(0);
  });
});
