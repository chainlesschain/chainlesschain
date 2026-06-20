import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { appendEvent, readLog, _deps } = require("../lib/governance-log.js");

let tmpDir;
let logPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "multisig-log-"));
  logPath = path.join(tmpDir, "multisig.governance.log");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("governance log", () => {
  it("appendEvent creates the dir + file with single line", () => {
    appendEvent(logPath, { type: "proposed", at: "2026-05-12T00:00:00Z", id: "p1" });
    const raw = fs.readFileSync(logPath, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw.trim());
    expect(parsed.type).toBe("proposed");
    expect(parsed.id).toBe("p1");
  });

  it("fsyncs each record for crash safety (the auditability gate)", () => {
    const orig = _deps.fsyncSync;
    let fsyncCalls = 0;
    _deps.fsyncSync = (fd) => {
      fsyncCalls++;
      return orig(fd);
    };
    try {
      appendEvent(logPath, { type: "consumed", id: "p1" });
      appendEvent(logPath, { type: "cancelled", id: "p2" });
    } finally {
      _deps.fsyncSync = orig;
    }
    expect(fsyncCalls).toBe(2); // one fsync per appended record
    // data is still correct + durable
    expect(readLog(logPath).map((e) => e.type)).toEqual(["consumed", "cancelled"]);
  });

  it("multiple appends produce one line each", () => {
    appendEvent(logPath, { type: "proposed", id: "p1" });
    appendEvent(logPath, { type: "signed", id: "p1", signerDid: "did:cc:b" });
    appendEvent(logPath, { type: "reached", id: "p1" });
    const events = readLog(logPath);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type)).toEqual(["proposed", "signed", "reached"]);
  });

  it("readLog returns [] for missing file", () => {
    expect(readLog(logPath)).toEqual([]);
  });

  it("readLog skips malformed lines (defensive)", () => {
    fs.writeFileSync(logPath, '{"type":"ok"}\nINVALID JSON\n{"type":"also-ok"}\n', "utf-8");
    const events = readLog(logPath);
    expect(events).toHaveLength(2);
  });

  it("appendEvent throws on empty logPath", () => {
    expect(() => appendEvent("", { type: "x" })).toThrow(TypeError);
  });

  it("appendEvent throws on non-object event", () => {
    expect(() => appendEvent(logPath, null)).toThrow(TypeError);
    expect(() => appendEvent(logPath, "not an object")).toThrow(TypeError);
  });

  it("appendEvent creates parent dir recursively if missing", () => {
    const nestedPath = path.join(tmpDir, "a", "b", "c", "log.log");
    appendEvent(nestedPath, { type: "x" });
    expect(fs.existsSync(nestedPath)).toBe(true);
  });
});
