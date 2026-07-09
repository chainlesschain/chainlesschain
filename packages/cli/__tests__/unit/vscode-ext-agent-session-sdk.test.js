/**
 * AgentChatSession ↔ vendored @chainlesschain/agent-sdk contract.
 *
 * Platform phase 3 (平台化): the extension no longer hand-assembles the
 * stream-json protocol argv nor hand-rolls NDJSON framing — both come from
 * the vendored SDK (src/vendor/agent-sdk, synced by
 * scripts/sync-agent-sdk.mjs). These tests pin that delegation:
 *  1. spawn argv === SDK buildAgentArgs (protocol flags + extras appended)
 *  2. a protocol line split across stdout chunks is reassembled (carry
 *     buffer), not dropped
 *  3. a final unterminated line is flushed on close (error output often
 *     lacks the trailing \n)
 *  4. non-JSON stdout still surfaces as {type:"raw"}
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { AgentChatSession } from "../../../vscode-extension/src/chat/agent-session.js";
import { buildAgentArgs } from "../../../vscode-extension/src/vendor/agent-sdk/agent-session.js";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.exitCode = null;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
  });
  return child;
}

function startSession(extraArgs = []) {
  const child = fakeChild();
  const spawnFn = vi.fn(() => child);
  const events = [];
  const session = new AgentChatSession({
    args: extraArgs,
    onEvent: (evt) => events.push(evt),
    deps: { spawn: spawnFn },
  });
  session.start();
  return { session, child, spawnFn, events };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("AgentChatSession uses the SDK protocol argv", () => {
  it("spawns with exactly buildAgentArgs(extraArgs) — no hand-pinned flags", () => {
    const extras = ["--resume", "s-1", "--interactive-approvals"];
    const { spawnFn } = startSession(extras);
    expect(spawnFn.mock.calls[0][1]).toEqual(
      buildAgentArgs({ extraArgs: extras }),
    );
    // And the SDK contract itself: duplex stream-json with partials.
    expect(spawnFn.mock.calls[0][1].slice(0, 6)).toEqual([
      "agent",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
    ]);
  });
});

describe("AgentChatSession uses the SDK NDJSON framing", () => {
  it("reassembles a line split across chunk boundaries", async () => {
    const { child, events } = startSession();
    const line = `${JSON.stringify({ type: "tool_use", tool: "grep" })}\n`;
    child.stdout.write(line.slice(0, 10));
    child.stdout.write(line.slice(10));
    await tick();
    expect(events).toEqual([{ type: "tool_use", tool: "grep" }]);
  });

  it("flushes a final unterminated JSON line on close", async () => {
    const { child, events } = startSession();
    child.stdout.write('{"type":"result","is_error":true}'); // no \n
    child.emit("close", 1, null);
    await tick();
    expect(events).toEqual([{ type: "result", is_error: true }]);
  });

  it('surfaces non-JSON stdout as {type:"raw"}', async () => {
    const { child, events } = startSession();
    child.stdout.write("plain warning line\n");
    await tick();
    expect(events).toEqual([{ type: "raw", text: "plain warning line" }]);
  });
});

describe("first-conversation persistence (session id declared up front)", () => {
  it("first spawn passes --resume with a panel-generated id (anonymous sessions are never persisted)", () => {
    const state = new Map();
    const memento = {
      get: (k, d) => (state.has(k) ? state.get(k) : d),
      update: (k, v) => (state.set(k, v), Promise.resolve()),
      _map: state,
    };
    const factory = (cfg) => ({
      cfg,
      running: true,
      send: () => true,
      sendEvent: () => true,
      stop() {},
    });
    const sessions = [];
    const wrapped = (cfg) => {
      const s = factory(cfg);
      sessions.push(s);
      return s;
    };
    const vscode = {
      commands: { executeCommand() {} },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: "/ws" } }],
        getConfiguration: () => ({ get: () => undefined }),
      },
    };
    const provider = new ChatViewProvider(vscode, {
      deps: { createSession: wrapped },
      state: memento,
    });
    provider.view = { webview: { postMessage: () => Promise.resolve() } };
    provider._handleMessage({ type: "send", text: "hi" });

    expect(sessions).toHaveLength(1);
    const args = sessions[0].cfg.args;
    const resumeIdx = args.indexOf("--resume");
    // A brand-new conversation must DECLARE its id: without one the CLI's
    // stream session is persistence-free and a later IDE-reload --resume of
    // the init-echoed id silently starts empty (pre-reload context lost).
    expect(resumeIdx).toBeGreaterThanOrEqual(0);
    expect(args[resumeIdx + 1]).toMatch(/^panel-/);
    // …and the id is already on the conversation (persisted for reload).
    expect(provider._convs.active().sessionId).toBe(args[resumeIdx + 1]);
  });
});
