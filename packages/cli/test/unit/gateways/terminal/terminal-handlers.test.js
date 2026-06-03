/**
 * cli-side terminal-handlers tests — ESM mirror of the desktop copy.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTerminalHandlers,
  DEFAULT_DANGEROUS_PATTERNS,
} from "../../../../src/gateways/terminal/terminal-handlers.js";

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
    this.listResult = [];
    this.historyResult = { chunks: [], truncated: false };
  }
  on(ev, cb) {
    this._listeners[ev].push(cb);
  }
  emit(ev, p) {
    for (const cb of this._listeners[ev]) cb(p);
  }
  create(req) {
    this.calls.create.push(req);
    return {
      sessionId: "sess-1",
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

describe("cli/terminal-handlers", () => {
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

  it("terminal.create forwards payload", async () => {
    const res = await handlers["terminal.create"]({
      payload: { shell: "pwsh", cols: 100, rows: 30 },
    });
    expect(pty.calls.create).toHaveLength(1);
    expect(res.sessionId).toBe("sess-1");
  });

  it("terminal.stdin decodes base64 and forwards", async () => {
    const data = Buffer.from("Get-Date\r", "utf-8").toString("base64");
    await handlers["terminal.stdin"]({
      payload: { sessionId: "sess-1", data },
    });
    expect(pty.calls.write[0].data.toString("utf-8")).toBe("Get-Date\r");
  });

  it("terminal.stdin rejects dangerous keyword by default", async () => {
    const data = Buffer.from("rm -rf /\r", "utf-8").toString("base64");
    await expect(
      handlers["terminal.stdin"]({ payload: { sessionId: "sess-1", data } }),
    ).rejects.toThrow("dangerous_keyword_blocked");
  });

  it("terminal.stdin allows dangerous keyword when requireConfirmation returns true", async () => {
    const confirm = vi.fn(async () => true);
    const local = createTerminalHandlers({
      ptyManager: pty,
      broadcast,
      requireConfirmation: confirm,
    });
    const data = Buffer.from("shutdown\r", "utf-8").toString("base64");
    await local.handlers["terminal.stdin"]({
      payload: { sessionId: "sess-1", data },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(pty.calls.write).toHaveLength(1);
  });

  it("verifyTrustedSource silently drops envelopes when false", async () => {
    const local = createTerminalHandlers({
      ptyManager: pty,
      broadcast,
      verifyTrustedSource: () => false,
    });
    const r = await local.handlers["terminal.create"]({
      payload: { shell: "pwsh" },
    });
    expect(r).toBeNull();
    expect(pty.calls.create).toHaveLength(0);
  });

  it("attachServerEvents broadcasts terminal.stdout on pty data", () => {
    attachServerEvents();
    pty.emit("stdout", {
      sessionId: "sess-1",
      data: Buffer.from("hi", "utf-8"),
      seq: 5,
    });
    expect(broadcastFrames[0].type).toBe("terminal.stdout");
    expect(
      Buffer.from(broadcastFrames[0].payload.data, "base64").toString("utf-8"),
    ).toBe("hi");
    expect(broadcastFrames[0].payload.seq).toBe(5);
  });

  it("attachServerEvents broadcasts terminal.exit on pty exit", () => {
    attachServerEvents();
    pty.emit("exit", { sessionId: "sess-1", exitCode: 0, signal: null });
    expect(broadcastFrames[0].type).toBe("terminal.exit");
  });

  it("DEFAULT_DANGEROUS_PATTERNS catches rm -rf / format / shutdown", () => {
    const samples = ["rm -rf /x", "format c:", "shutdown -h"];
    for (const s of samples) {
      expect(DEFAULT_DANGEROUS_PATTERNS.some((re) => re.test(s))).toBe(true);
    }
  });
});
