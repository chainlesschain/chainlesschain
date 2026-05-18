/**
 * terminal-handlers WS topic tests. PtyManager is faked so this test runs
 * without node-pty installed — same isolation pattern as fs-handlers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import pkg from "../handlers/terminal-handlers.js";
const { createTerminalHandlers, DEFAULT_DANGEROUS_PATTERNS } = pkg;

class FakePtyManager {
  constructor() {
    this._listeners = { stdout: [], exit: [] };
    this.calls = {
      create: [],
      write: [],
      resize: [],
      close: [],
      list: [],
      history: [],
    };
    this.nextSessionId = "sess-1";
    this.listResult = [];
    this.historyResult = { chunks: [], truncated: false };
  }
  on(event, cb) {
    this._listeners[event].push(cb);
  }
  emit(event, payload) {
    for (const cb of this._listeners[event]) {
      cb(payload);
    }
  }
  create(req) {
    this.calls.create.push(req);
    return {
      sessionId: this.nextSessionId,
      pid: 99,
      shell: req.shell || "pwsh",
      createdAt: 1700000000000,
    };
  }
  write(id, data) {
    this.calls.write.push({ id, data });
  }
  resize(id, cols, rows) {
    this.calls.resize.push({ id, cols, rows });
  }
  close(id) {
    this.calls.close.push(id);
  }
  list() {
    this.calls.list.push(true);
    return this.listResult;
  }
  history(id, from) {
    this.calls.history.push({ id, from });
    return this.historyResult;
  }
}

describe("terminal-handlers", () => {
  let pty, broadcast, broadcastFrames, handlers, attachServerEvents;

  beforeEach(() => {
    pty = new FakePtyManager();
    broadcastFrames = [];
    broadcast = (f) => broadcastFrames.push(f);
    ({ handlers, attachServerEvents } = createTerminalHandlers({
      ptyManager: pty,
      broadcast,
    }));
  });

  describe("envelope routing", () => {
    it("terminal.create forwards payload to PtyManager.create", async () => {
      const res = await handlers["terminal.create"]({
        payload: { shell: "pwsh", cols: 100, rows: 30 },
      });
      expect(pty.calls.create).toHaveLength(1);
      expect(pty.calls.create[0]).toMatchObject({
        shell: "pwsh",
        cols: 100,
        rows: 30,
      });
      expect(res.sessionId).toBe("sess-1");
      expect(res.pid).toBe(99);
    });

    it("terminal.list returns wrapped sessions array", async () => {
      pty.listResult = [{ id: "sess-1", shell: "pwsh", alive: true }];
      const res = await handlers["terminal.list"]({ payload: {} });
      expect(res.sessions).toHaveLength(1);
      expect(res.sessions[0].id).toBe("sess-1");
    });

    it("terminal.stdin base64-decodes and forwards to PtyManager.write", async () => {
      const data = Buffer.from("Get-Date\r", "utf-8").toString("base64");
      await handlers["terminal.stdin"]({
        payload: { sessionId: "sess-1", data },
      });
      expect(pty.calls.write).toHaveLength(1);
      expect(pty.calls.write[0].id).toBe("sess-1");
      expect(pty.calls.write[0].data.toString("utf-8")).toBe("Get-Date\r");
    });

    it("terminal.stdin throws session_id_required when missing", async () => {
      await expect(
        handlers["terminal.stdin"]({ payload: { data: "" } }),
      ).rejects.toThrow("session_id_required");
    });

    it("terminal.stdin throws data_must_be_base64_string for non-string data", async () => {
      await expect(
        handlers["terminal.stdin"]({
          payload: { sessionId: "sess-1", data: { not: "string" } },
        }),
      ).rejects.toThrow("data_must_be_base64_string");
    });

    it("terminal.resize forwards cols+rows", async () => {
      await handlers["terminal.resize"]({
        payload: { sessionId: "sess-1", cols: 120, rows: 40 },
      });
      expect(pty.calls.resize).toEqual([{ id: "sess-1", cols: 120, rows: 40 }]);
    });

    it("terminal.close calls PtyManager.close", async () => {
      await handlers["terminal.close"]({ payload: { sessionId: "sess-1" } });
      expect(pty.calls.close).toEqual(["sess-1"]);
    });

    it("terminal.history base64-encodes chunks and forwards fromSeq", async () => {
      pty.historyResult = {
        chunks: [
          { seq: 5, data: Buffer.from("hi", "utf-8") },
          { seq: 6, data: Buffer.from("bye", "utf-8") },
        ],
        truncated: true,
      };
      const res = await handlers["terminal.history"]({
        payload: { sessionId: "sess-1", fromSeq: 5 },
      });
      expect(pty.calls.history).toEqual([{ id: "sess-1", from: 5 }]);
      expect(res.truncated).toBe(true);
      expect(res.chunks).toHaveLength(2);
      expect(Buffer.from(res.chunks[0].data, "base64").toString("utf-8")).toBe(
        "hi",
      );
      expect(res.chunks[0].seq).toBe(5);
    });
  });

  describe("dangerous-keyword gate", () => {
    it("rejects matching stdin by default (no confirmation hook)", async () => {
      const data = Buffer.from("rm -rf /\r", "utf-8").toString("base64");
      await expect(
        handlers["terminal.stdin"]({
          payload: { sessionId: "sess-1", data },
        }),
      ).rejects.toThrow("dangerous_keyword_blocked");
      expect(pty.calls.write).toHaveLength(0);
    });

    it("allows matching stdin when requireConfirmation returns true", async () => {
      const confirm = vi.fn(async () => true);
      const local = createTerminalHandlers({
        ptyManager: pty,
        broadcast,
        requireConfirmation: confirm,
      });
      const data = Buffer.from("shutdown /s /f\r", "utf-8").toString("base64");
      await local.handlers["terminal.stdin"]({
        payload: { sessionId: "sess-1", data },
      });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(pty.calls.write).toHaveLength(1);
    });

    it("passes non-dangerous stdin through without invoking requireConfirmation", async () => {
      const confirm = vi.fn(async () => true);
      const local = createTerminalHandlers({
        ptyManager: pty,
        broadcast,
        requireConfirmation: confirm,
      });
      const data = Buffer.from("ls\r", "utf-8").toString("base64");
      await local.handlers["terminal.stdin"]({
        payload: { sessionId: "sess-1", data },
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(pty.calls.write).toHaveLength(1);
    });
  });

  describe("trusted-source gate", () => {
    it("silently drops envelopes when verifyTrustedSource returns false", async () => {
      const local = createTerminalHandlers({
        ptyManager: pty,
        broadcast,
        verifyTrustedSource: () => false,
      });
      const res = await local.handlers["terminal.create"]({
        payload: { shell: "pwsh" },
      });
      expect(res).toBeNull();
      expect(pty.calls.create).toHaveLength(0);
    });
  });

  describe("server events fan-out", () => {
    it("attachServerEvents broadcasts terminal.stdout on pty data event", () => {
      attachServerEvents();
      pty.emit("stdout", {
        sessionId: "sess-1",
        data: Buffer.from("hello", "utf-8"),
        seq: 1,
      });
      expect(broadcastFrames).toHaveLength(1);
      expect(broadcastFrames[0].type).toBe("terminal.stdout");
      expect(
        Buffer.from(broadcastFrames[0].payload.data, "base64").toString(
          "utf-8",
        ),
      ).toBe("hello");
      expect(broadcastFrames[0].payload.seq).toBe(1);
    });

    it("attachServerEvents broadcasts terminal.exit on pty exit event", () => {
      attachServerEvents();
      pty.emit("exit", { sessionId: "sess-1", exitCode: 0, signal: null });
      expect(broadcastFrames).toHaveLength(1);
      expect(broadcastFrames[0].type).toBe("terminal.exit");
      expect(broadcastFrames[0].payload).toEqual({
        sessionId: "sess-1",
        exitCode: 0,
        signal: null,
      });
    });
  });

  describe("DEFAULT_DANGEROUS_PATTERNS", () => {
    it("matches the documented set", () => {
      const samples = ["rm -rf /tmp/x", "FORMAT C:", "shutdown -h now"];
      for (const s of samples) {
        expect(
          DEFAULT_DANGEROUS_PATTERNS.some((re) => re.test(s)),
          `expected one of the patterns to match: ${s}`,
        ).toBe(true);
      }
    });
  });
});
