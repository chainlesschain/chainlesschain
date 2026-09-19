import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { createProviderLogger } = require("../provider-log-privacy");

describe("provider log privacy boundary", () => {
  const sink = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does not inspect or forward provider errors", () => {
    let inspected = false;
    const secret = "sk-provider-secret-private-prompt";
    const hostileError = new Proxy(new Error(secret), {
      get() {
        inspected = true;
        throw new Error("provider error was inspected");
      },
      getOwnPropertyDescriptor() {
        inspected = true;
        throw new Error("provider error descriptor was inspected");
      },
    });

    createProviderLogger("openai", sink).failure("chat", hostileError);

    expect(inspected).toBe(false);
    expect(sink.error).toHaveBeenCalledWith("[LLMProvider] operation failed", {
      provider: "openai",
      operation: "chat",
    });
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(secret);
  });

  it("fails closed for dynamic identifiers and bounds retry counters", () => {
    const providerLog = createProviderLogger("tenant-secret-provider", sink);

    providerLog.retry("private-operation-name", 9001);

    expect(sink.warn).toHaveBeenCalledWith(
      "[LLMProvider] operation retry scheduled",
      { provider: "unknown", operation: "unknown", attempt: 1 },
    );
  });

  it("keeps fixed lifecycle events free of model identifiers", () => {
    const providerLog = createProviderLogger("llava", sink);

    providerLog.started("pull-model");
    providerLog.success("pull-model");

    expect(sink.info.mock.calls).toEqual([
      [
        "[LLMProvider] operation started",
        { provider: "llava", operation: "pull-model" },
      ],
      [
        "[LLMProvider] operation succeeded",
        { provider: "llava", operation: "pull-model" },
      ],
    ]);
  });

  it("prevents provider clients from bypassing the wrapper", () => {
    const root = path.resolve(__dirname, "..");
    const clients = fs
      .readdirSync(root)
      .filter((file) => file.endsWith("-client.js"));

    expect(clients).toEqual(
      expect.arrayContaining([
        "anthropic-client.js",
        "gemini-client.js",
        "llava-client.js",
        "mistral-client.js",
        "ollama-client.js",
        "openai-client.js",
      ]),
    );

    for (const file of clients) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source, file).not.toMatch(/utils\/logger\.js/u);
      expect(source, file).not.toMatch(
        /\blogger\.(?:debug|info|warn|error|fatal)\s*\(/u,
      );
      expect(source, file).not.toMatch(
        /console\.(?:debug|info|warn|error|log)\s*\(/u,
      );
    }
  });
});
