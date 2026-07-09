import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  AgentSession,
  buildAgentArgs,
  buildSpawnCommand,
} from "../src/agent-session.js";
import type { AgentSessionOptions } from "../src/agent-session.js";

class FakeStdin extends EventEmitter {
  destroyed = false;
  written: string[] = [];
  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }
  end(): void {
    this.destroyed = true;
  }
}

class FakeChild extends EventEmitter {
  stdin = new FakeStdin();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4242;
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function startSession(options: AgentSessionOptions = {}) {
  const child = new FakeChild();
  const spawn = vi.fn(() => child);
  const session = new AgentSession({
    ...options,
    spawn: spawn as unknown as AgentSessionOptions["spawn"],
  });
  session.start();
  const push = (event: unknown) =>
    child.stdout.emit("data", Buffer.from(`${JSON.stringify(event)}\n`, "utf8"));
  const writtenEvents = () =>
    child.stdin.written.map((line) => JSON.parse(line));
  return { session, child, spawn, push, writtenEvents };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("buildAgentArgs", () => {
  it("builds the stream-json duplex argv by default", () => {
    expect(buildAgentArgs({})).toEqual([
      "agent",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
    ]);
  });

  it("maps options to flags; default permission mode adds no flag", () => {
    const args = buildAgentArgs({
      onApproval: () => true,
      resume: "s-9",
      forkSession: true,
      permissionMode: "acceptEdits",
      model: "m1",
      provider: "p1",
      includePartialMessages: false,
      extraArgs: ["--otlp"],
    });
    expect(args).toEqual([
      "agent",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--interactive-approvals",
      "--resume",
      "s-9",
      "--fork-session",
      "--permission-mode",
      "acceptEdits",
      "--model",
      "m1",
      "--provider",
      "p1",
      "--otlp",
    ]);
    expect(buildAgentArgs({ permissionMode: "default" })).not.toContain(
      "--permission-mode",
    );
  });

  it("passes --session for a declared new session; --resume wins over it", () => {
    expect(buildAgentArgs({ sessionId: "s-new" })).toEqual(
      expect.arrayContaining(["--session", "s-new"]),
    );
    const both = buildAgentArgs({ sessionId: "s-new", resume: "s-old" });
    expect(both).toEqual(expect.arrayContaining(["--resume", "s-old"]));
    expect(both).not.toContain("--session");
  });
});

describe("buildSpawnCommand", () => {
  it("wraps .cmd shims in cmd.exe /c on Windows", () => {
    expect(buildSpawnCommand("cc", ["agent"], "win32")).toEqual({
      command: "cmd.exe",
      args: ["/c", "cc", "agent"],
    });
  });

  it("runs POSIX binaries directly and .js entrypoints through Node", () => {
    expect(buildSpawnCommand("/opt/bin/cc", ["agent"], "linux")).toEqual({
      command: "/opt/bin/cc",
      args: ["agent"],
    });
    // A .js path is not directly spawnable (especially on Windows) — it must
    // go through the current Node executable.
    expect(
      buildSpawnCommand("C:\\cli\\bin\\chainlesschain.js", ["agent"], "win32"),
    ).toEqual({
      command: process.execPath,
      args: ["C:\\cli\\bin\\chainlesschain.js", "agent"],
    });
    expect(
      buildSpawnCommand("/repo/bin/chainlesschain.js", ["agent"], "linux"),
    ).toEqual({
      command: process.execPath,
      args: ["/repo/bin/chainlesschain.js", "agent"],
    });
  });
});

describe("AgentSession", () => {
  it("dispatches typed events and captures the session id", async () => {
    const { session, push } = startSession();
    const init = vi.fn();
    const text = vi.fn();
    const thinking = vi.fn();
    const toolUse = vi.fn();
    const result = vi.fn();
    session.on("init", init);
    session.on("text", text);
    session.on("thinking", thinking);
    session.on("tool_use", toolUse);
    session.on("result", result);

    push({ type: "system", subtype: "init", session_id: "s-1", model: "m" });
    push({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "he" },
      },
    });
    push({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "…" },
      },
    });
    push({ type: "tool_use", tool: "read_file", args: { path: "a" } });
    push({ type: "result", subtype: "success", is_error: false, result: "ok" });
    await flush();

    expect(session.sessionId).toBe("s-1");
    expect(init).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledWith("he");
    expect(thinking).toHaveBeenCalledWith("…");
    expect(toolUse).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "read_file" }),
    );
    expect(result).toHaveBeenCalledWith(
      expect.objectContaining({ subtype: "success" }),
    );
  });

  it("reassembles a protocol line split across stdout chunks", async () => {
    const { session, child } = startSession();
    const events = vi.fn();
    session.on("event", events);
    const line = `${JSON.stringify({ type: "tool_use", tool: "grep" })}\n`;
    child.stdout.emit("data", Buffer.from(line.slice(0, 9), "utf8"));
    child.stdout.emit("data", Buffer.from(line.slice(9), "utf8"));
    await flush();
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tool_use", tool: "grep" }),
    );
  });

  it("writes protocol input events for send/interrupt/compact", () => {
    const { session, writtenEvents } = startSession();
    session.send("hello", { images: ["/tmp/a.png"] });
    session.interrupt();
    session.compact();
    session.planControl("approve");
    expect(writtenEvents()).toEqual([
      { type: "user", text: "hello", images: ["/tmp/a.png"] },
      { type: "interrupt" },
      { type: "compact" },
      { type: "plan", action: "approve" },
    ]);
  });

  it("auto-answers approval requests via the callback", async () => {
    const onApproval = vi.fn(async () => true);
    const { session, push, writtenEvents } = startSession({ onApproval });
    const seen = vi.fn();
    session.on("approval_request", seen);
    push({
      type: "approval_request",
      id: "appr-1",
      tool: "shell",
      command: "npm test",
      risk: "medium",
      rule: null,
      reason: null,
    });
    await flush();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(onApproval).toHaveBeenCalledWith(
      expect.objectContaining({ id: "appr-1", tool: "shell" }),
    );
    expect(writtenEvents()).toEqual([
      { type: "approval", id: "appr-1", approve: true },
    ]);
  });

  it("fails closed (deny) when the approval callback throws", async () => {
    const onApproval = vi.fn(async () => {
      throw new Error("ui crashed");
    });
    const { push, writtenEvents } = startSession({ onApproval });
    push({
      type: "approval_request",
      id: "appr-2",
      tool: null,
      command: null,
      risk: null,
      rule: null,
      reason: null,
    });
    await flush();
    expect(writtenEvents()).toEqual([
      { type: "approval", id: "appr-2", approve: false },
    ]);
  });

  it("auto-answers question requests; a thrown callback cancels with null", async () => {
    const onQuestion = vi.fn(async () => "option-a");
    const first = startSession({ onQuestion });
    first.push({ type: "question_request", id: "q-1", question: "pick" });
    await flush();
    expect(first.writtenEvents()).toEqual([
      { type: "answer", id: "q-1", answer: "option-a" },
    ]);

    const second = startSession({
      onQuestion: async () => {
        throw new Error("nope");
      },
    });
    second.push({ type: "question_request", id: "q-2", question: "pick" });
    await flush();
    expect(second.writtenEvents()).toEqual([
      { type: "answer", id: "q-2", answer: null },
    ]);
  });

  it("nextResult resolves on result and rejects on exit", async () => {
    const { session, push } = startSession();
    const pending = session.nextResult();
    push({ type: "result", subtype: "success", is_error: false });
    await expect(pending).resolves.toEqual(
      expect.objectContaining({ subtype: "success" }),
    );

    const again = startSession();
    const rejected = again.session.nextResult();
    again.child.emit("exit", 1);
    await expect(rejected).rejects.toThrow("agent exited");
  });

  it("emits stderr chunks and a single exit event", async () => {
    const { session, child } = startSession();
    const stderr = vi.fn();
    const exit = vi.fn();
    session.on("stderr", stderr);
    session.on("exit", exit);
    child.stderr.emit("data", Buffer.from("trace line\n", "utf8"));
    child.emit("exit", 0);
    child.emit("exit", 0);
    await flush();
    expect(stderr).toHaveBeenCalledWith("trace line\n");
    expect(exit).toHaveBeenCalledTimes(1);
    expect(session.running).toBe(false);
  });

  it("ignores unknown and non-protocol messages without breaking the pump", async () => {
    const { session, push } = startSession();
    const events = vi.fn();
    session.on("event", events);
    push({ type: "future_event", data: 1 });
    push({ noType: true });
    push({ type: "tool_result", tool: "x", is_error: false });
    await flush();
    expect(events).toHaveBeenCalledTimes(2); // future_event + tool_result
  });
});
