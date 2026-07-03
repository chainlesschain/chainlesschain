import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RemoteSessionAuditFileSink } from "../../src/harness/remote-session-audit-sink.js";
import { RemoteSessionAuditLog } from "../../src/harness/remote-session-audit.js";

describe("RemoteSessionAuditFileSink", () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-audit-"));
    file = path.join(dir, "nested", "audit.jsonl");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("requires a path", () => {
    expect(() => new RemoteSessionAuditFileSink()).toThrow(/requires a path/);
  });

  it("appends entries as JSON lines and reads them back oldest-first", () => {
    const sink = new RemoteSessionAuditFileSink({ path: file });
    // Parent directories are created lazily.
    expect(fs.existsSync(path.dirname(file))).toBe(true);
    sink.append({ seq: 1, action: "session.created", sessionId: "s1" });
    sink.append({ seq: 2, action: "device.joined", sessionId: "s1" });

    const raw = fs.readFileSync(file, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);
    expect(sink.readAll().map((e) => e.action)).toEqual([
      "session.created",
      "device.joined",
    ]);
  });

  it("skips torn or corrupt lines on read", () => {
    const sink = new RemoteSessionAuditFileSink({ path: file });
    sink.append({ seq: 1, action: "session.created" });
    // Simulate a crash mid-append (a partial trailing line).
    fs.appendFileSync(file, '{"seq":2,"action":"device.joi', "utf8");
    const entries = sink.readAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("session.created");
  });

  it("honors the readAll limit, keeping the newest", () => {
    const sink = new RemoteSessionAuditFileSink({ path: file });
    for (let i = 1; i <= 5; i += 1) {
      sink.append({ seq: i, action: "control.prompt", detail: { i } });
    }
    expect(sink.readAll({ limit: 2 }).map((e) => e.detail.i)).toEqual([4, 5]);
  });

  it("rotates when the file exceeds maxBytes and reads across backups", () => {
    // Tiny ceiling forces a rotation after the first entry.
    const sink = new RemoteSessionAuditFileSink({
      path: file,
      maxBytes: 80,
      backups: 1,
    });
    sink.append({ seq: 1, action: "session.created", pad: "x".repeat(60) });
    sink.append({ seq: 2, action: "device.joined" });

    expect(fs.existsSync(`${file}.1`)).toBe(true);
    // The active file holds the newest entry, the .1 backup the older one.
    expect(sink.readAll().map((e) => e.seq)).toEqual([1, 2]);
  });

  it("drops history entirely when backups is 0", () => {
    const sink = new RemoteSessionAuditFileSink({
      path: file,
      maxBytes: 80,
      backups: 0,
    });
    sink.append({ seq: 1, action: "session.created", pad: "x".repeat(60) });
    sink.append({ seq: 2, action: "device.joined" });
    expect(fs.existsSync(`${file}.1`)).toBe(false);
    expect(sink.readAll().map((e) => e.seq)).toEqual([2]);
  });

  it("fromEnv returns null without a configured file, a sink with one", () => {
    expect(RemoteSessionAuditFileSink.fromEnv({})).toBeNull();
    const sink = RemoteSessionAuditFileSink.fromEnv({
      CHAINLESSCHAIN_REMOTE_SESSION_AUDIT_FILE: file,
      CHAINLESSCHAIN_REMOTE_SESSION_AUDIT_MAX_BYTES: "2048",
    });
    expect(sink).toBeInstanceOf(RemoteSessionAuditFileSink);
    expect(sink.maxBytes).toBe(2048);
  });

  it("round-trips through the audit log: persist, then hydrate a fresh log", () => {
    const writer = new RemoteSessionAuditFileSink({ path: file });
    const first = new RemoteSessionAuditLog({ sink: writer.handler });
    first.record({ sessionId: "s1", actor: "host", action: "session.created" });
    first.record({ sessionId: "s1", actor: "phone", action: "device.joined" });

    // A brand-new process: reopen the same file and hydrate.
    const reader = new RemoteSessionAuditFileSink({ path: file });
    const restored = new RemoteSessionAuditLog({
      sink: reader.handler,
      initialEntries: reader.readAll({ limit: 1000 }),
    });
    expect(restored.list({ sessionId: "s1" }).map((e) => e.action)).toEqual([
      "device.joined",
      "session.created",
    ]);
    // A new event after restart both continues the seq and is persisted.
    const next = restored.record({ sessionId: "s1", action: "session.closed" });
    expect(next.seq).toBe(3);
    expect(reader.readAll().map((e) => e.action)).toEqual([
      "session.created",
      "device.joined",
      "session.closed",
    ]);
  });
});
