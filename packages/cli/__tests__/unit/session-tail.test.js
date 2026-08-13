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

  it("parseChunk rejects an oversized unterminated record", async () => {
    const { parseChunk } = await import("../../src/lib/session-tail.js");
    expect(() => parseChunk("0123456789", { maxRecordBytes: 8 })).toThrowError(
      expect.objectContaining({
        code: "CC_SESSION_JSONL_RECORD_TOO_LARGE",
        actualBytes: 10,
        maxBytes: 8,
      }),
    );
  });

  it("parseChunk rejects an oversized terminated record before slicing it", async () => {
    const { parseChunk } = await import("../../src/lib/session-tail.js");
    expect(() =>
      parseChunk("0123456789\n", { maxRecordBytes: 8 }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_SESSION_JSONL_RECORD_TOO_LARGE",
        actualBytes: 10,
        maxBytes: 8,
      }),
    );
  });

  it("retries transient ENOENT presence races and fails closed if they persist", async () => {
    const { readLiveTranscriptPresence } =
      await import("../../src/lib/session-tail.js");
    let attempts = 0;
    const transientPresence = readLiveTranscriptPresence("tail-race", () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("transient rename");
        error.code = "ENOENT";
        throw error;
      }
      return "conflict";
    });
    expect(transientPresence).toBe("conflict");
    expect(attempts).toBe(3);

    expect(() =>
      readLiveTranscriptPresence("tail-race", () => {
        const error = new Error("persistent rename ambiguity");
        error.code = "ENOENT";
        throw error;
      }),
    ).toThrowError(
      expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
    );
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

  it("bounds fromStart reads and rejects a record before decode or parse", async () => {
    const { sessionPath } =
      await import("../../src/harness/jsonl-session-store.js");
    const { followSession } = await import("../../src/lib/session-tail.js");
    fs.mkdirSync(path.join(tmpHome, "sessions"), { recursive: true });
    fs.writeFileSync(
      sessionPath("tail-oversized-from-start"),
      `${JSON.stringify({ type: "large", data: { value: "界".repeat(40) } })}\n`,
      "utf8",
    );

    await expect(
      drain(
        followSession("tail-oversized-from-start", {
          fromStart: true,
          once: true,
          maxRecordBytes: 64,
          readChunkBytes: 7,
        }),
      ),
    ).rejects.toMatchObject({
      code: "CC_SESSION_JSONL_RECORD_TOO_LARGE",
      maxBytes: 64,
    });
  });

  it("rejects an unterminated record that crosses the cap across polls", async () => {
    const { sessionPath } =
      await import("../../src/harness/jsonl-session-store.js");
    const { followSession } = await import("../../src/lib/session-tail.js");
    fs.mkdirSync(path.join(tmpHome, "sessions"), { recursive: true });
    const transcript = sessionPath("tail-oversized-across-polls");
    fs.writeFileSync(transcript, '{"type":"pending","data":"', "utf8");

    const iter = followSession("tail-oversized-across-polls", {
      fromStart: true,
      pollMs: 5,
      maxRecordBytes: 40,
      readChunkBytes: 6,
    });
    const next = iter.next();
    setTimeout(() => fs.appendFileSync(transcript, "x".repeat(30), "utf8"), 20);

    await expect(next).rejects.toMatchObject({
      code: "CC_SESSION_JSONL_RECORD_TOO_LARGE",
      maxBytes: 40,
    });
  });

  it("preserves UTF-8 code points split across bounded reads", async () => {
    const { sessionPath } =
      await import("../../src/harness/jsonl-session-store.js");
    const { followSession } = await import("../../src/lib/session-tail.js");
    fs.mkdirSync(path.join(tmpHome, "sessions"), { recursive: true });
    fs.writeFileSync(
      sessionPath("tail-split-utf8"),
      `${JSON.stringify({ type: "unicode", data: { value: "界" } })}\n`,
      "utf8",
    );

    const items = await drain(
      followSession("tail-split-utf8", {
        fromStart: true,
        once: true,
        readChunkBytes: 1,
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].event.data.value).toBe("界");
  });

  it("rejects an explicit offset that starts inside a physical record", async () => {
    const { sessionPath } =
      await import("../../src/harness/jsonl-session-store.js");
    const { followSession } = await import("../../src/lib/session-tail.js");
    fs.mkdirSync(path.join(tmpHome, "sessions"), { recursive: true });
    const prefix = "x".repeat(80);
    const suffix = `${JSON.stringify({ type: "suffix", data: {} })}\n`;
    fs.writeFileSync(sessionPath("tail-mid-record-offset"), prefix + suffix);

    await expect(
      drain(
        followSession("tail-mid-record-offset", {
          fromOffset: Buffer.byteLength(prefix),
          once: true,
          maxRecordBytes: 64,
          readChunkBytes: 7,
        }),
      ),
    ).rejects.toMatchObject({
      code: "SESSION_TAIL_OFFSET_NOT_RECORD_BOUNDARY",
      offset: Buffer.byteLength(prefix),
    });
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

  it("refuses missing, tombstoned, and restored-conflict transcripts", async () => {
    const store = await import("../../src/harness/jsonl-session-store.js");
    const { followSession, initialOffset } =
      await import("../../src/lib/session-tail.js");
    const id = store.startSession("tail-damaged", { title: "damaged" });
    const transcript = store.sessionPath(id);
    const restored = fs.readFileSync(transcript, "utf8");

    fs.rmSync(transcript, { force: true });
    expect(() => initialOffset(id, { fromStart: true })).toThrowError(
      expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
    );
    await expect(
      drain(followSession(id, { fromStart: true, once: true })),
    ).rejects.toMatchObject({ code: "SESSION_TRANSCRIPT_UNVERIFIED" });

    expect(store.deleteJsonlSession(id)).toBe(true);
    await expect(
      drain(followSession(id, { fromStart: true, once: true })),
    ).rejects.toMatchObject({ code: "SESSION_DELETED" });

    fs.writeFileSync(transcript, restored, "utf8");
    await expect(
      drain(followSession(id, { fromStart: true, once: true })),
    ).rejects.toMatchObject({ code: "SESSION_TRANSCRIPT_UNVERIFIED" });
  });

  it("stops a live follower when its transcript becomes a restored conflict", async () => {
    const store = await import("../../src/harness/jsonl-session-store.js");
    const { followSession } = await import("../../src/lib/session-tail.js");
    const id = store.startSession("tail-live-conflict", { title: "live" });
    const transcript = store.sessionPath(id);
    const restored = fs.readFileSync(transcript, "utf8");
    const iter = followSession(id, { pollMs: 10 });
    const pending = iter.next();

    setTimeout(() => {
      store.deleteJsonlSession(id);
      fs.writeFileSync(transcript, restored, "utf8");
    }, 25);

    await expect(pending).rejects.toMatchObject({
      code: "SESSION_TRANSCRIPT_UNVERIFIED",
    });
  });
});
