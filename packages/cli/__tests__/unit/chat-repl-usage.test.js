import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-chat-repl-"));
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
  globalThis.fetch = originalFetch;
  vi.doUnmock("../../src/lib/paths.js");
});

function stream(chunks) {
  let i = 0;
  const enc = new TextEncoder();
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: enc.encode(chunks[i++]) };
        },
      };
    },
  };
}

describe("chat-repl — session autorecord", () => {
  it("startChatRepl creates a JSONL session and records user + assistant + token_usage", async () => {
    // Mock readline to drive one prompt then close.
    vi.doMock("readline", () => ({
      default: {
        createInterface: () => {
          const handlers = {};
          return {
            on(event, fn) {
              handlers[event] = fn;
              return this;
            },
            prompt() {},
            emit(event, arg) {
              handlers[event]?.(arg);
            },
            // expose for test
            _handlers: handlers,
          };
        },
      },
    }));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream([
        '{"message":{"content":"Hello"}}\n',
        '{"done":true,"prompt_eval_count":20,"eval_count":10}\n',
      ]),
    });

    const rlMod = await import("readline");
    const { startChatRepl } = await import("../../src/repl/chat-repl.js");
    const { sessionPath } =
      await import("../../src/harness/jsonl-session-store.js");

    // Capture rl via patching createInterface
    let capturedRl = null;
    const orig = rlMod.default.createInterface;
    rlMod.default.createInterface = (opts) => {
      capturedRl = orig(opts);
      return capturedRl;
    };

    await startChatRepl({
      provider: "ollama",
      model: "qwen2:7b",
      baseUrl: "http://localhost:11434",
    });

    // Trigger line handler synchronously, wait for async handler
    await new Promise((resolve) => {
      // After async line handler finishes it will call rl.prompt(); we just
      // wait a tick by monkey-patching prompt to signal.
      const origPrompt = capturedRl.prompt.bind(capturedRl);
      capturedRl.prompt = () => {
        origPrompt();
        resolve();
      };
      capturedRl._handlers.line("hi");
    });

    // Find the session file written under tmpHome/sessions
    const sessionsDir = path.join(tmpHome, "sessions");
    expect(fs.existsSync(sessionsDir)).toBe(true);
    const files = fs
      .readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBe(1);

    const sid = files[0].replace(/\.jsonl$/, "");
    const lines = fs
      .readFileSync(sessionPath(sid), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    const types = lines.map((l) => l.type);
    expect(types).toContain("session_start");
    expect(types).toContain("user_message");
    expect(types).toContain("assistant_message");
    expect(types).toContain("token_usage");

    const tokenUsage = lines.find((l) => l.type === "token_usage");
    expect(tokenUsage.data).toMatchObject({
      provider: "ollama",
      model: "qwen2:7b",
      usage: { input_tokens: 20, output_tokens: 10 },
    });

    vi.doUnmock("readline");
  });
});
