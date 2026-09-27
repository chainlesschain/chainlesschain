import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  CODEX_APP_SERVER_COMPATIBILITY_MATRIX,
  CODEX_APP_SERVER_FEATURE_FLAG,
  CodexAppServerAdapter,
  isCodexAppServerVersionCompatible,
} from "../../src/lib/codex-app-server-adapter.js";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../fixtures/external-agent/codex-app-server-session.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);

class FakeClient extends EventEmitter {
  running = false;

  async start() {
    this.running = true;
    return { protocolVersion: 1 };
  }

  async request(method) {
    if (method === "thread/start") return { thread: { id: "codex-thread-1" } };
    if (method === "turn/start") {
      queueMicrotask(() => {
        for (const event of fixture) this.emit("notification", event);
      });
      return { turn: { id: "codex-turn-1", status: "running" } };
    }
    throw new Error(`unexpected method: ${method}`);
  }
}

const matrix = CODEX_APP_SERVER_COMPATIBILITY_MATRIX;

describe("optional Codex App Server adapter", () => {
  it.each([
    ["commandExecution", "completed", "completed"],
    ["commandExecution", "failed", "failed"],
    ["commandExecution", "declined", "declined"],
    ["fileChange", "completed", "completed"],
    ["fileChange", "failed", "failed"],
    ["fileChange", "declined", "declined"],
    ["commandExecution", "future-status", "unknown"],
    ["fileChange", undefined, "unknown"],
  ])("preserves %s tool outcome %s as %s", async (type, status, expected) => {
    const client = new EventEmitter();
    client.running = true;
    client.request = vi.fn(async () => {
      queueMicrotask(() => {
        client.emit("notification", {
          method: "item/completed",
          params: {
            threadId: "tools",
            turnId: "turn-tools",
            item: { id: "tool-1", type, status },
          },
        });
        client.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: "tools",
            turn: { id: "turn-tools", status: "interrupted" },
          },
        });
      });
      return { turn: { id: "turn-tools", status: "inProgress" } };
    });
    const result = await new CodexAppServerAdapter({
      client,
      enabled: true,
      upstreamVersion: "0.154.0",
    }).execute({ threadId: "tools", prompt: "tool outcome" });
    expect(result.terminal).toBe("interrupted");
    expect(
      result.notifications.find((event) => event.method === "item/completed")
        .params.item,
    ).toMatchObject({ kind: "tool", status: expected, content: { type } });
  });

  it("correlates interleaved turns, including events before RPC replies", async () => {
    const client = new EventEmitter();
    client.running = true;
    const replies = new Map();
    client.request = vi.fn(
      (method, params) =>
        new Promise((resolve) => {
          expect(method).toBe("turn/start");
          replies.set(params.threadId, resolve);
        }),
    );
    const adapter = new CodexAppServerAdapter({
      client,
      enabled: true,
      upstreamVersion: "0.154.0",
    });
    const pendingA = adapter.execute({ threadId: "A", prompt: "a" });
    const pendingB = adapter.execute({ threadId: "B", prompt: "b" });
    const emit = (method, params) =>
      client.emit("notification", { method, params });
    emit("item/completed", {
      threadId: "A",
      turnId: "old-A",
      item: { id: "x", type: "agentMessage", text: "stale" },
    });
    emit("turn/completed", {
      threadId: "A",
      turn: { id: "old-A", status: "completed" },
    });
    emit("turn/completed", { turn: { id: "turn-A", status: "completed" } });
    emit("item/completed", {
      threadId: "B",
      turnId: "turn-B",
      item: { id: "same-id", type: "agentMessage", text: "B answer" },
    });
    emit("turn/completed", {
      threadId: "B",
      turn: { id: "turn-B", status: "interrupted" },
    });
    replies.get("B")({ turn: { id: "turn-B", status: "inProgress" } });
    expect(await pendingB).toMatchObject({
      threadId: "B",
      turnId: "turn-B",
      output: "B answer",
      terminal: "interrupted",
    });
    const finishedA = vi.fn();
    pendingA.then(finishedA);
    replies.get("A")({ turn: { id: "turn-A", status: "inProgress" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(finishedA).not.toHaveBeenCalled();
    emit("item/agentMessage/delta", {
      threadId: "A",
      turnId: "turn-A",
      itemId: "same-id",
      delta: "partial",
    });
    emit("item/completed", {
      threadId: "A",
      turnId: "turn-A",
      item: { id: "same-id", type: "agentMessage", text: "A answer" },
    });
    emit("item/commandExecution/outputDelta", {
      threadId: "A",
      turnId: "turn-A",
      itemId: "tool",
      delta: "tool output",
    });
    emit("turn/completed", {
      threadId: "A",
      turn: { id: "turn-A", status: "completed" },
    });
    const a = await pendingA;
    expect(a).toMatchObject({
      threadId: "A",
      turnId: "turn-A",
      output: "A answer",
      terminal: "completed",
      unknownMethods: [],
    });
    expect(
      a.notifications.every(
        (n) => n.params.threadId === "A" && n.params.turnId === "turn-A",
      ),
    ).toBe(true);
    expect(a.notifications.some((n) => n.params.item?.kind === "tool")).toBe(
      true,
    );
    expect(client.listenerCount("notification")).toBe(0);
  });

  it("times out a hung submission without fallback or detached rejection", async () => {
    vi.useFakeTimers();
    try {
      const client = new EventEmitter();
      client.running = true;
      client.request = vi.fn(() => new Promise(() => {}));
      const fallback = vi.fn();
      const adapter = new CodexAppServerAdapter({
        client,
        fallback,
        enabled: true,
        upstreamVersion: "0.154.0",
        timeoutMs: 10,
      });
      const assertion = expect(
        adapter.execute({ threadId: "A", prompt: "a" }),
      ).rejects.toMatchObject({
        code: "CC_CODEX_APP_SERVER_SUBMISSION_UNKNOWN",
        cause: { code: "CC_CODEX_APP_SERVER_TIMEOUT" },
      });
      await vi.advanceTimersByTimeAsync(10);
      await assertion;
      expect(fallback).not.toHaveBeenCalled();
      expect(client.listenerCount("notification")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds early notifications and suppresses fallback after submission", async () => {
    const client = new EventEmitter();
    client.running = true;
    client.request = vi.fn(async () => {
      client.emit("notification", {
        method: "item/agentMessage/delta",
        params: {
          threadId: "A",
          turnId: "a",
          itemId: "i",
          delta: "x".repeat(4 * 1024 * 1024),
        },
      });
      return { turn: { id: "a", status: "completed" } };
    });
    const fallback = vi.fn();
    const adapter = new CodexAppServerAdapter({
      client,
      fallback,
      enabled: true,
      upstreamVersion: "0.154.0",
    });
    await expect(adapter.execute({ threadId: "A" })).rejects.toMatchObject({
      cause: { code: "CC_CODEX_APP_SERVER_EVENT_LIMIT" },
    });
    expect(fallback).not.toHaveBeenCalled();
    expect(client.listenerCount("notification")).toBe(0);
  });

  it("uses complete response items when a terminal RPC reply has no notifications", async () => {
    const client = new EventEmitter();
    client.running = true;
    client.request = vi.fn(async () => ({
      turn: {
        id: "a",
        status: "completed",
        items: [{ id: "i", type: "agentMessage", text: "response answer" }],
      },
    }));
    const adapter = new CodexAppServerAdapter({
      client,
      enabled: true,
      upstreamVersion: "0.154.0",
    });
    await expect(adapter.execute({ threadId: "A" })).resolves.toMatchObject({
      terminal: "completed",
      output: "response answer",
    });
  });

  it("uses a fail-closed compatibility matrix", () => {
    expect(isCodexAppServerVersionCompatible("codex-cli 0.165.0", matrix)).toBe(
      false,
    );
    expect(isCodexAppServerVersionCompatible("codex-cli 0.150.1", matrix)).toBe(
      true,
    );
    expect(isCodexAppServerVersionCompatible("codex-cli 0.154.0", matrix)).toBe(
      true,
    );
    expect(isCodexAppServerVersionCompatible("0.150.2", matrix)).toBe(false);
    expect(isCodexAppServerVersionCompatible("0.154.1", matrix)).toBe(false);
    expect(isCodexAppServerVersionCompatible("0.150.1-beta.1", matrix)).toBe(
      false,
    );
    expect(isCodexAppServerVersionCompatible("0.150.01", matrix)).toBe(false);
    expect(isCodexAppServerVersionCompatible("unknown", matrix)).toBe(false);
    expect(isCodexAppServerVersionCompatible("0.165.0", [])).toBe(false);
  });

  it("is feature-gated and falls back to codex exec JSONL", async () => {
    const fallback = vi.fn(async () => ({
      terminal: "completed",
      output: "fallback",
    }));
    const adapter = new CodexAppServerAdapter({
      client: new FakeClient(),
      fallback,
      upstreamVersion: "0.150.1",
      compatibilityMatrix: matrix,
      enabled: false,
    });

    await expect(adapter.execute({ prompt: "test" })).resolves.toMatchObject({
      protocol: "codex-exec-jsonl-v1",
      fallback: true,
      fallbackReason: "feature_disabled",
      output: "fallback",
    });
    expect(adapter.runtimeClaims()).toMatchObject({
      featureFlag: CODEX_APP_SERVER_FEATURE_FLAG,
      authoritative: false,
      productionCritical: false,
    });
  });

  it("maps a compatible experimental session to provider-neutral events", async () => {
    const fallback = vi.fn();
    const adapter = new CodexAppServerAdapter({
      client: new FakeClient(),
      fallback,
      upstreamVersion: "codex-cli 0.150.1",
      compatibilityMatrix: matrix,
      enabled: true,
    });
    const result = await adapter.execute({ prompt: "test" });

    expect(result).toMatchObject({
      terminal: "completed",
      output: "App Server result",
      fallback: false,
      authoritative: false,
      unknownMethods: ["future/telemetry"],
      usage: { inputTokens: 20, outputTokens: 4 },
    });
    expect(result.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "thread/updated" }),
        expect.objectContaining({ method: "item/completed" }),
        expect.objectContaining({ method: "turn/completed" }),
      ]),
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    [
      "failed",
      { message: "provider rejected the turn", codexErrorInfo: "BadRequest" },
    ],
    ["interrupted", null],
  ])(
    "projects turn/completed status=%s without rewriting it as success",
    async (status, expectedError) => {
      class TerminalClient extends FakeClient {
        async request(method) {
          if (method === "thread/start") {
            return { thread: { id: "codex-thread-terminal" } };
          }
          if (method === "turn/start") {
            queueMicrotask(() => {
              this.emit("notification", {
                method: "turn/completed",
                params: {
                  threadId: "codex-thread-terminal",
                  turn: {
                    id: "codex-turn-terminal",
                    status,
                    ...(expectedError ? { error: expectedError } : {}),
                  },
                  usage: { input_tokens: 3, output_tokens: 1 },
                },
              });
            });
            return {
              turn: { id: "codex-turn-terminal", status: "inProgress" },
            };
          }
          throw new Error(`unexpected method: ${method}`);
        }
      }

      const fallback = vi.fn();
      const result = await new CodexAppServerAdapter({
        client: new TerminalClient(),
        fallback,
        upstreamVersion: "0.150.1",
        compatibilityMatrix: matrix,
        enabled: true,
      }).execute({ prompt: "terminal status" });

      expect(result).toMatchObject({
        terminal: status,
        error: expectedError,
        fallback: false,
        usage: { input_tokens: 3, output_tokens: 1 },
      });
      expect(result.notifications.at(-1)).toMatchObject({
        method: "turn/completed",
        params: { turn: { status } },
      });
      expect(fallback).not.toHaveBeenCalled();
    },
  );

  it("fails closed when turn/completed omits a supported terminal status", async () => {
    class InvalidTerminalClient extends FakeClient {
      async request(method) {
        if (method === "thread/start") {
          return { thread: { id: "codex-thread-invalid" } };
        }
        if (method === "turn/start") {
          queueMicrotask(() => {
            this.emit("notification", {
              method: "turn/completed",
              params: {
                threadId: "codex-thread-invalid",
                turn: { id: "codex-turn-invalid", status: "inProgress" },
              },
            });
          });
          return { turn: { id: "codex-turn-invalid", status: "inProgress" } };
        }
        throw new Error(`unexpected method: ${method}`);
      }
    }

    const result = await new CodexAppServerAdapter({
      client: new InvalidTerminalClient(),
      fallback: vi.fn(),
      upstreamVersion: "0.150.1",
      compatibilityMatrix: matrix,
      enabled: true,
    }).execute({ prompt: "invalid terminal" });

    expect(result).toMatchObject({
      terminal: "failed",
      error: {
        code: "CC_CODEX_APP_SERVER_INVALID_TERMINAL_STATUS",
      },
      fallback: false,
    });
  });

  it("suppresses fallback when turn/start reports admission before its response is lost", async () => {
    class AcceptedThenDisconnectedClient extends FakeClient {
      async request(method) {
        if (method === "thread/start") {
          return { thread: { id: "codex-thread-accepted" } };
        }
        if (method === "turn/start") {
          this.emit("notification", {
            method: "turn/started",
            params: {
              threadId: "codex-thread-accepted",
              turn: {
                id: "codex-turn-accepted",
                threadId: "codex-thread-accepted",
                status: "inProgress",
              },
            },
          });
          const error = new Error("connection reset after acceptance");
          error.code = "ECONNRESET";
          throw error;
        }
        throw new Error(`unexpected method: ${method}`);
      }
    }

    const fallback = vi.fn();
    const adapter = new CodexAppServerAdapter({
      client: new AcceptedThenDisconnectedClient(),
      fallback,
      upstreamVersion: "0.150.1",
      compatibilityMatrix: matrix,
      enabled: true,
    });

    await expect(
      adapter.execute({ prompt: "accepted once" }),
    ).rejects.toMatchObject({
      // The RPC turn ID was lost; a shared thread event cannot identify this
      // submission. Unknown and admitted failures both suppress fallback.
      code: "CC_CODEX_APP_SERVER_SUBMISSION_UNKNOWN",
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("treats a rejected turn/start with no receipt as unknown, not unsubmitted", async () => {
    class AmbiguousSubmissionClient extends FakeClient {
      async request(method) {
        if (method === "thread/start") {
          return { thread: { id: "codex-thread-ambiguous" } };
        }
        if (method === "turn/start") {
          const error = new Error("connection reset without a receipt");
          error.code = "ECONNRESET";
          throw error;
        }
        throw new Error(`unexpected method: ${method}`);
      }
    }

    const fallback = vi.fn();
    const adapter = new CodexAppServerAdapter({
      client: new AmbiguousSubmissionClient(),
      fallback,
      upstreamVersion: "0.150.1",
      compatibilityMatrix: matrix,
      enabled: true,
    });

    await expect(
      adapter.execute({ prompt: "ambiguous" }),
    ).rejects.toMatchObject({ code: "CC_CODEX_APP_SERVER_SUBMISSION_UNKNOWN" });
    expect(fallback).not.toHaveBeenCalled();
  });
});
