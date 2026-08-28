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
});
