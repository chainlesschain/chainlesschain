import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  bootstrap: vi.fn(),
  shutdown: vi.fn(),
  probe: vi.fn(),
}));
vi.mock("../../src/lib/config-manager.js", async (importOriginal) => ({
  ...(await importOriginal()),
  loadConfig: mocks.loadConfig,
}));
vi.mock("../../src/runtime/bootstrap.js", () => ({
  bootstrap: mocks.bootstrap,
  shutdown: mocks.shutdown,
}));
vi.mock("../../src/lib/llm-connection-probe.js", () => ({
  probeLlmConnection: mocks.probe,
}));

import {
  formatLlmCapabilities,
  registerLlmCommand,
  resolveLlmCapabilities,
} from "../../src/commands/llm.js";

const builtIns = {
  openai: { baseUrl: "https://api.openai.com/v1", models: ["gpt-4o-mini"] },
  ollama: { baseUrl: "http://localhost:11434" },
};
let output;
let errors;
let fetchMock;
let originalExitCode;

beforeEach(() => {
  vi.clearAllMocks();
  originalExitCode = process.exitCode;
  process.exitCode = undefined;
  mocks.loadConfig.mockReturnValue({
    llm: { provider: "ollama", model: "unknown-local-model" },
  });
  output = vi.spyOn(console, "log").mockImplementation(() => {});
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock = vi.fn(() => {
    throw new Error("unexpected network request");
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  expect(mocks.bootstrap).not.toHaveBeenCalled();
  expect(mocks.shutdown).not.toHaveBeenCalled();
  expect(mocks.probe).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function invoke(args) {
  const program = new Command().exitOverride();
  registerLlmCommand(program);
  await program.parseAsync(["llm", "capabilities", ...args], { from: "user" });
}

describe("cc llm capabilities", () => {
  it("projects only connection metadata and never reads API key properties", () => {
    const llm = {
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    };
    const options = {};
    Object.defineProperty(llm, "apiKey", {
      get() {
        throw new Error("read config secret");
      },
    });
    Object.defineProperty(options, "apiKey", {
      get() {
        throw new Error("read option secret");
      },
    });
    const profile = resolveLlmCapabilities(options, { llm }, builtIns);
    expect(profile).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      runtimeVerified: false,
    });
    expect(profile).not.toHaveProperty("apiKey");
  });

  it("isolates another provider's saved model and endpoint from an override", () => {
    const config = {
      llm: {
        provider: "volcengine",
        model: "vendor-private-model",
        baseUrl: "https://private-relay.example/v1",
      },
    };
    const openai = resolveLlmCapabilities(
      { provider: "openai" },
      config,
      builtIns,
    );
    expect(openai).toEqual(
      resolveLlmCapabilities({ provider: "openai" }, {}, builtIns),
    );
    expect(openai.model).toBe("gpt-4o-mini");
    const ollama = resolveLlmCapabilities(
      { provider: "ollama" },
      config,
      builtIns,
    );
    expect(ollama).toEqual(
      resolveLlmCapabilities({ provider: "ollama" }, {}, builtIns),
    );
    expect(ollama.model).toBe("qwen2:7b");
  });

  it("preserves explicit model, endpoint and token overrides without changing configuration", () => {
    const config = {
      llm: {
        provider: "openai",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
      },
    };
    const before = JSON.stringify(config);
    const profile = resolveLlmCapabilities(
      {
        provider: "ollama",
        model: "explicit-local-model",
        baseUrl:
          "http://fixture-user:fixture-url-secret@127.0.0.1:1?key=fixture-query-secret",
        contextWindow: "8192",
        maxOutputTokens: "512",
      },
      config,
      builtIns,
    );
    expect(profile).toMatchObject({
      provider: "ollama",
      model: "explicit-local-model",
      contextWindowTokens: 8192,
      requestMaxOutputTokens: 512,
      runtimeVerified: false,
    });
    expect(JSON.stringify(config)).toBe(before);
    expect(JSON.stringify(profile)).not.toContain("fixture-url-secret");
    expect(formatLlmCapabilities(profile)).not.toContain(
      "fixture-query-secret",
    );
  });

  it("emits one plain JSON profile, loads no secrets and retains all unverified caveats", async () => {
    await invoke(["--json"]);
    expect(mocks.loadConfig).toHaveBeenCalledExactlyOnceWith({
      resolveSecrets: false,
      failIfUnavailable: true,
    });
    expect(output).toHaveBeenCalledTimes(1);
    const profile = JSON.parse(output.mock.calls[0][0]);
    expect(profile).toMatchObject({
      model: "unknown-local-model",
      windowAssumed: true,
      runtimeVerified: false,
      requestMaxOutputTokens: null,
    });
    expect(profile.plannedOutputReserveTokens).toBeGreaterThan(0);
    expect(profile.limitations.join(" ")).toMatch(/not|unverified|assum/i);
    expect(profile.limitations.join(" ")).toContain(
      "Runtime execution, endpoint access and account entitlement have not been verified",
    );
    expect(errors).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("labels text as static, distinguishes reserve from cap and does not claim readiness", async () => {
    await invoke([]);
    const text = output.mock.calls.flat().join(" ");
    expect(text).toContain("runtime not verified");
    expect(text).toContain("Fallback values are estimates");
    expect(text).toContain("planning reserve is not an enforced request cap");
    expect(text).toContain("transport selection is static");
    expect(text).not.toMatch(/\bready\b|✔|Connected/);
    expect(
      formatLlmCapabilities(resolveLlmCapabilities({ contextWindow: "8192" })),
    ).toContain("8192");
  });

  it("shows native Responses as selected but not runtime verified", async () => {
    await invoke([
      "--provider",
      "openai",
      "--model",
      "gpt-6-astra",
      "--base-url",
      "https://api.openai.com/v1",
    ]);
    const text = output.mock.calls.flat().join(" ");
    expect(text).toContain("Runtime protocol: openai-responses");
    expect(text).toContain("native Responses adapter selected");
    expect(text).toContain("runtime not verified");
    expect(text).not.toMatch(/\bready\b|Connected/);
  });

  it.each([
    ["--context-window", "0"],
    ["--context-window", "1023"],
    ["--context-window", "16777217"],
    ["--context-window", "1e6"],
    ["--max-output-tokens", "0"],
    ["--max-output-tokens", "1.5"],
    ["--max-output-tokens", "Infinity"],
    ["--max-output-tokens", "secret-invalid-token"],
    ["--base-url", "secret-invalid-token"],
    ["--base-url", "file:///tmp/not-an-api"],
  ])(
    "rejects invalid %s=%s without JSON success or raw value disclosure",
    async (flag, value) => {
      await invoke([flag, value, "--json"]);
      expect(process.exitCode).toBe(1);
      expect(output).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledTimes(1);
      if (value === "secret-invalid-token")
        expect(errors.mock.calls.flat().join(" ")).not.toContain(value);
    },
  );

  it("fails closed on unreadable configuration without exposing parse-error contents", async () => {
    mocks.loadConfig.mockImplementation(() => {
      throw new Error('bad config near "apiKey":"fixture-secret"');
    });
    await invoke(["--json"]);
    expect(process.exitCode).toBe(1);
    expect(output).not.toHaveBeenCalled();
    expect(errors.mock.calls.flat().join(" ")).toContain(
      "Could not read LLM configuration",
    );
    expect(errors.mock.calls.flat().join(" ")).not.toContain("fixture-secret");
  });
});
