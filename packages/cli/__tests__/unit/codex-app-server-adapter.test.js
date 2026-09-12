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
  it("uses a fail-closed compatibility matrix", () => {
    expect(isCodexAppServerVersionCompatible("codex-cli 0.165.0", matrix)).toBe(
      false,
    );
    expect(isCodexAppServerVersionCompatible("codex-cli 0.150.1", matrix)).toBe(
      true,
    );
    expect(isCodexAppServerVersionCompatible("0.150.2", matrix)).toBe(false);
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
      usage: { input_tokens: 20, output_tokens: 4 },
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
      code: "CC_CODEX_APP_SERVER_FAILED_AFTER_ADMISSION",
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
