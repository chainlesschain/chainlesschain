import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { stopAgentProcess } from "../../../vscode-extension/src/chat/stop-agent-process.js";
import { AgentChatSession } from "../../../vscode-extension/src/chat/agent-session.js";

describe("confirmed agent termination", () => {
  it("waits for BOTH Windows tree termination and child close", async () => {
    const child = Object.assign(new EventEmitter(), { pid: 1234 });
    const helper = new EventEmitter();
    let settled = false;
    const stopping = stopAgentProcess(child, {
      platform: "win32",
      spawn: () => helper,
    }).then(() => {
      settled = true;
    });
    child.emit("close", 0);
    await Promise.resolve();
    expect(settled).toBe(false);
    helper.emit("close", 0);
    await stopping;
    expect(settled).toBe(true);
  });

  it("rejects helper errors even when the shell wrapper closes", async () => {
    const child = Object.assign(new EventEmitter(), { pid: 1234 });
    const helper = new EventEmitter();
    const stopping = stopAgentProcess(child, {
      platform: "win32",
      spawn: () => helper,
    });
    const rejection = expect(stopping).rejects.toThrow(
      "process-tree stop failed",
    );
    child.emit("close", 0);
    helper.emit("close", 1);
    await rejection;
  });

  it("does not treat kill acceptance as closure", async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), { kill: () => true });
      const stopping = stopAgentProcess(child, {
        platform: "linux",
        timeoutMs: 50,
      });
      const rejection = expect(stopping).rejects.toThrow("not confirmed");
      await vi.advanceTimersByTimeAsync(51);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("observes a real child close before allowing restart", async () => {
    let ready;
    const started = new Promise((resolve) => {
      ready = resolve;
    });
    let exits = 0;
    const session = new AgentChatSession({
      deps: {
        spawn: (command, args, opts) =>
          command === "taskkill"
            ? spawn(command, args, opts)
            : spawn(process.execPath, [
                "-e",
                'console.log(JSON.stringify({type:"raw",text:"ready"})); setInterval(()=>{},1000)',
              ]),
      },
      onEvent: (evt) => {
        if (evt.text === "ready") ready();
      },
      onExit: () => {
        exits += 1;
      },
    }).start();
    try {
      await started;
      const child = session.child;
      const stopping = session.stopAndWait();
      expect(session.running).toBe(false);
      session.start();
      expect(session.child).toBe(child);
      await stopping;
      expect(session.child).toBeNull();
      expect(exits).toBe(1);
    } finally {
      await session.stopAndWait();
    }
  }, 20000);
});
