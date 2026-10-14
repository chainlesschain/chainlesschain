import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const llm = require("../../../vscode-extension/src/llm-config.js");
const cli = require("../../../vscode-extension/src/cli-binary.js");
const {
  ChatViewProvider,
} = require("../../../vscode-extension/src/chat/chat-view.js");
const {
  openLlmConfigPanel,
} = require("../../../vscode-extension/src/ui/llm-config-panel.js");

describe("LLM connection test process failures", () => {
  it.each([
    "error: Cannot find package 'semver' imported from C:\\repo\\scopes.js",
    "Error: Cannot find module '/missing/cli.js'",
    "'chainlesschain' is not recognized as an internal or external command",
  ])("does not report a provider failure for %s", async (stderr) => {
    const result = await llm.testLlm({
      deps: {
        execFile: (_command, _args, _options, callback) =>
          callback(new Error("CLI exited"), "", stderr),
      },
    });
    expect(result).toMatchObject({ ok: false, failureKind: "cli" });
    expect(result.detail).toContain("尚未检测模型连接");
    expect(result.detail).toContain("无需重新填写 API Key");
  });

  it("classifies a missing executable even without subprocess output", async () => {
    const result = await llm.testLlm({
      deps: {
        execFile: (_command, _args, _options, callback) =>
          callback(
            Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
          ),
      },
    });
    expect(result.failureKind).toBe("cli");
  });

  it("preserves an actual provider rejection", async () => {
    const result = await llm.testLlm({
      deps: {
        execFile: (_command, _args, _options, callback) =>
          callback(new Error("exit 1"), "", "HTTP 401: invalid API key"),
      },
    });
    expect(result).toEqual({ ok: false, detail: "HTTP 401: invalid API key" });
  });

  it("retains an execution error when the subprocess produces no output", async () => {
    const result = await llm.testLlm({
      deps: {
        execFile: (_command, _args, _options, callback) =>
          callback(new Error("Connection test timed out")),
      },
    });
    expect(result).toEqual({ ok: false, detail: "Connection test timed out" });
  });
});

describe("configuration panel tests the chat CLI", () => {
  let dispose;
  const originalCli = cli.getResolvedCli();
  afterEach(() => {
    dispose?.();
    cli.setResolvedCli(originalCli);
  });

  function panelHarness(options) {
    let receive;
    const messages = [];
    const panel = {
      webview: {
        cspSource: "vscode-webview:",
        asWebviewUri: (uri) => uri,
        postMessage: (message) => messages.push(message),
        onDidReceiveMessage: (handler) => {
          receive = handler;
        },
      },
      onDidDispose: (handler) => {
        dispose = handler;
      },
    };
    openLlmConfigPanel(
      {
        window: { createWebviewPanel: () => panel },
        ViewColumn: { Active: 1 },
        Uri: { file: (file) => file },
      },
      options,
    );
    return { receive: (message) => receive(message), messages };
  }

  it("keeps the newer save CLI separate from the resolved chat runtime", async () => {
    cli.setResolvedCli("working-chat-cli");
    const values = {
      provider: "openai",
      model: "relay-model",
      baseUrl: "https://relay.example/v1",
      visionModel: "",
      apiKey: "",
      allowHttp: false,
    };
    const api = {
      PROVIDER_PRESETS: llm.PROVIDER_PRESETS,
      getConfiguredProvider: async () => values.provider,
      getConfiguredModel: async () => values.model,
      getConfiguredBaseUrl: async () => values.baseUrl,
      getConfiguredVisionModel: async () => values.visionModel,
      hasConfiguredApiKey: async () => true,
      applyLlmConnection: vi.fn(async () => ({ ok: true })),
      testLlm: vi.fn(async () => ({ ok: true, detail: "Connected" })),
    };
    const harness = panelHarness({ getCommand: () => "repo-save-cli.js", api });
    await harness.receive({ type: "ready" });
    await harness.receive({ type: "save", answers: values });
    expect(api.applyLlmConnection).toHaveBeenCalledWith({
      command: "repo-save-cli.js",
      answers: values,
    });
    await harness.receive({ type: "test" });
    expect(api.testLlm).toHaveBeenLastCalledWith({
      command: "working-chat-cli",
    });
    // Resolve on each click, so a runtime selection change is reflected.
    cli.setResolvedCli("new-chat-cli");
    await harness.receive({ type: "test" });
    expect(api.testLlm).toHaveBeenLastCalledWith({ command: "new-chat-cli" });
    expect(
      harness.messages.some((message) => message.text?.includes("连接成功")),
    ).toBe(true);
  });

  it("tracks changes to the explicit chat CLI path after activation", async () => {
    cli.setResolvedCli("activation-cli");
    let configuredPath = "first-chat-cli.js";
    const chatProvider = Object.create(ChatViewProvider.prototype);
    chatProvider.vscode = {
      workspace: {
        getConfiguration: () => ({ get: () => configuredPath }),
      },
    };
    const testLlm = vi.fn(async () => ({ ok: true, detail: "Connected" }));
    const harness = panelHarness({
      getCommand: () => "repo-save-cli.js",
      getTestCommand: () => chatProvider._cliCommand(),
      api: { testLlm },
    });
    await harness.receive({ type: "test" });
    expect(testLlm).toHaveBeenLastCalledWith({ command: "first-chat-cli.js" });
    configuredPath = "replacement-chat-cli.js";
    await harness.receive({ type: "test" });
    expect(testLlm).toHaveBeenLastCalledWith({
      command: "replacement-chat-cli.js",
    });
    configuredPath = "cc";
    await harness.receive({ type: "test" });
    expect(testLlm).toHaveBeenLastCalledWith({ command: "activation-cli" });
  });

  it("labels a failed CLI as an unperformed connection test", async () => {
    const testLlm = vi.fn(async () => ({
      ok: false,
      failureKind: "cli",
      detail: "本地 CLI 未能启动",
    }));
    const harness = panelHarness({
      getCommand: () => "save-cli",
      getTestCommand: () => "chat-cli",
      api: { testLlm },
    });
    await harness.receive({ type: "test" });
    expect(testLlm).toHaveBeenCalledWith({ command: "chat-cli" });
    const notices = harness.messages.filter(
      (message) => message.type === "notice",
    );
    expect(notices.at(-1).text).toContain("未执行连接测试");
    expect(notices.at(-1).text).not.toContain("连接未通过");
  });
});
