/**
 * hook-event-log — persistent, hash-chained log of hook delivery envelopes that
 * backs `cc hook replay`. Verifies append/lookup, tamper-evident chaining,
 * latest-wins lookup, listing, the opt-in gate, and the size-rotation guard.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isHookEventLogEnabled,
  appendHookEvent,
  findHookEvent,
  listHookEvents,
  verifyHookEventChain,
  readHookEventRecords,
  MAX_LOG_BYTES,
} = require("../../src/lib/hook-event-log.cjs");
const {
  buildHookEnvelope,
  _resetSeq,
} = require("../../src/lib/hook-event-bus.cjs");

let dir, file;

function env(eventType, data = {}, over = {}) {
  return buildHookEnvelope({
    eventType,
    data,
    sessionId: "s1",
    now: 111,
    ...over,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hooklog-"));
  file = path.join(dir, "hook-events.jsonl");
  _resetSeq();
});

afterEach(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("isHookEventLogEnabled", () => {
  it("is opt-in (default off, common truthy values on)", () => {
    expect(isHookEventLogEnabled({})).toBe(false);
    expect(isHookEventLogEnabled({ CC_HOOK_EVENT_LOG: "0" })).toBe(false);
    expect(isHookEventLogEnabled({ CC_HOOK_EVENT_LOG: "" })).toBe(false);
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isHookEventLogEnabled({ CC_HOOK_EVENT_LOG: v })).toBe(true);
    }
  });
});

describe("append + find round trip", () => {
  it("records an envelope and looks it up by event_id", () => {
    const e = env("SessionStart", { source: "startup" });
    const r = appendHookEvent(e, { filePath: file });
    expect(r.ok).toBe(true);
    expect(r.event_id).toBe(e.event_id);
    const found = findHookEvent(e.event_id, { filePath: file });
    expect(found).toEqual(e);
  });

  it("rejects an envelope with no event_id", () => {
    const r = appendHookEvent({ event_type: "x" }, { filePath: file });
    expect(r.ok).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("returns null for a missing file / unknown id", () => {
    expect(findHookEvent("evt_nope", { filePath: file })).toBeNull();
    expect(listHookEvents({ filePath: file })).toEqual([]);
    expect(verifyHookEventChain({ filePath: file })).toEqual({
      ok: true,
      length: 0,
      brokenAt: -1,
    });
  });
});

describe("hash chain", () => {
  it("verifies a valid multi-record chain", () => {
    for (let i = 0; i < 4; i++) {
      appendHookEvent(env("UserPromptSubmit", { prompt: `p${i}` }), {
        filePath: file,
      });
    }
    const v = verifyHookEventChain({ filePath: file });
    expect(v.ok).toBe(true);
    expect(v.length).toBe(4);
  });

  it("detects tampering with a recorded line", () => {
    appendHookEvent(env("Stop", { a: 1 }), { filePath: file });
    appendHookEvent(env("Stop", { a: 2 }), { filePath: file });
    // Tamper: rewrite the first record's envelope but keep its stored hash.
    const lines = fs.readFileSync(file, "utf-8").trim().split("\n");
    const rec = JSON.parse(lines[0]);
    rec.envelope.data.a = 999;
    lines[0] = JSON.stringify(rec);
    fs.writeFileSync(file, lines.join("\n") + "\n", "utf-8");
    const v = verifyHookEventChain({ filePath: file });
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(0);
  });
});

describe("lookup + listing semantics", () => {
  it("latest matching delivery wins for a duplicated event_id", () => {
    const first = env(
      "SessionStart",
      { source: "startup" },
      { deliveryId: "evt_dup" },
    );
    const second = env(
      "SessionStart",
      { source: "resume" },
      { deliveryId: "evt_dup" },
    );
    appendHookEvent(first, { filePath: file });
    appendHookEvent(second, { filePath: file });
    expect(findHookEvent("evt_dup", { filePath: file }).data.source).toBe(
      "resume",
    );
  });

  it("lists the most recent N envelopes (newest last)", () => {
    for (let i = 0; i < 5; i++) {
      appendHookEvent(env("Stop", { n: i }), { filePath: file });
    }
    const last2 = listHookEvents({ limit: 2, filePath: file });
    expect(last2).toHaveLength(2);
    expect(last2.map((e) => e.data.n)).toEqual([3, 4]);
  });

  it("skips malformed lines when reading", () => {
    appendHookEvent(env("Stop", { n: 1 }), { filePath: file });
    fs.appendFileSync(file, "not json\n", "utf-8");
    appendHookEvent(env("Stop", { n: 2 }), { filePath: file });
    expect(readHookEventRecords({ filePath: file })).toHaveLength(2);
  });
});

describe("size rotation guard", () => {
  it("rotates to <file>.1 once the log exceeds MAX_LOG_BYTES", () => {
    fs.writeFileSync(file, "x".repeat(MAX_LOG_BYTES + 1), "utf-8");
    const e = env("Stop", { fresh: true });
    const r = appendHookEvent(e, { filePath: file });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(`${file}.1`)).toBe(true);
    // The rotated file is a fresh chain with just the new record.
    const records = readHookEventRecords({ filePath: file });
    expect(records).toHaveLength(1);
    expect(records[0].prevHash).toBeNull();
    expect(verifyHookEventChain({ filePath: file }).ok).toBe(true);
  });
});
