"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { setResolvedCli } = require("../src/cli-binary");
const {
  applyLlmConfig,
  buildConfigSetArgs,
  readLlmConfigFromFile,
  getLlmConfigurationState,
} = require("../src/llm-config");

test("LLM setup keeps the API key out of argv and uses the resolved CLI", async () => {
  setResolvedCli("chainlesschain");
  const calls = [];
  const execFile = (command, args, options, callback) => {
    const call = { command, args: [...args], options, stdin: null };
    calls.push(call);
    const child = {
      stdin: {
        on() {},
        end(value) {
          call.stdin = String(value);
          callback(null, "Set llm.apiKey", "");
        },
      },
      kill() {},
    };
    if (args[1] !== "set-secret") callback(null, "ok", "");
    return child;
  };

  const result = await applyLlmConfig({
    answers: {
      provider: "dashscope",
      model: "qwen-plus",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "sk-user-secret",
    },
    deps: { execFile },
  });

  assert.deepEqual(result, { ok: true });
  assert.ok(calls.every((call) => call.command === "chainlesschain"));
  assert.deepEqual(calls.at(-1).args, ["config", "set-secret", "llm.apiKey"]);
  assert.equal(calls.at(-1).stdin, "sk-user-secret");
  assert.ok(calls.every((call) => !call.args.includes("sk-user-secret")));
});

test("ordinary config writes never include the API key", () => {
  const args = buildConfigSetArgs({
    provider: "dashscope",
    model: "qwen-plus",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-user-secret",
  });
  assert.equal(args.length, 3);
  assert.ok(args.every((entry) => !entry.includes("llm.apiKey")));
  assert.ok(args.every((entry) => !entry.includes("sk-user-secret")));
});

test("overridden config roots never read credentials from the default user profile", () => {
  assert.equal(
    readLlmConfigFromFile({
      env: { CHAINLESSCHAIN_HOME: "C:/isolated" },
      readFileSync: () => {
        throw new Error("must not read default config");
      },
    }),
    null,
  );
  assert.equal(
    readLlmConfigFromFile({ env: { CLAUDE_CONFIG_DIR: "C:/isolated" } }),
    null,
  );
});

function configurationDeps({ document, error, env = {}, cli } = {}) {
  return {
    env,
    homedir: () => "C:/fixture-profile",
    readFileSync: () => {
      if (error) throw error;
      return document;
    },
    execFile: (_command, args, options, callback) => {
      assert.deepEqual(args, ["llm", "capabilities", "--json"]);
      assert.equal(options.timeout, 12000);
      if (!cli)
        throw new Error("CLI must not be called for an authoritative file");
      return cli(callback, options);
    },
  };
}

test("onboarding reads an existing provider even while the CLI is unavailable, without exposing the key", async () => {
  const result = await getLlmConfigurationState({
    deps: configurationDeps({
      document: '{"llm":{"provider":"custom-relay","apiKey":"private-key"}}',
    }),
  });
  assert.deepEqual(result, {
    status: "configured",
    provider: "custom-relay",
    source: "file",
  });
  assert.ok(!JSON.stringify(result).includes("private-key"));
});

test("only an authoritative unset provider is classified as unconfigured", async () => {
  for (const provider of [undefined, null, "", "  ", "undefined"]) {
    const result = await getLlmConfigurationState({
      deps: configurationDeps({
        document: JSON.stringify({ llm: { provider } }),
      }),
    });
    assert.deepEqual(result, {
      status: "unconfigured",
      provider: null,
      source: "file",
    });
  }
});

test("onboarding does not call a repairing CLI fallback for corrupt or unreadable files", async () => {
  for (const fixture of [
    { document: '{"apiKey":"private-key",broken' },
    { document: "[]" },
    { document: '{"llm":[]}' },
    { document: '{"llm":{"provider":{"apiKey":"private-key"}}}' },
    {
      error: Object.assign(new Error("private-key /secret/config.json"), {
        code: "EACCES",
      }),
    },
    { error: Object.assign(new Error("private-key"), { code: "EIO" }) },
  ]) {
    const result = await getLlmConfigurationState({
      deps: configurationDeps(fixture),
    });
    assert.equal(result.status, "unavailable");
    assert.ok(!JSON.stringify(result).includes("private-key"));
  }
});

test("overridden roots use the CLI's read-only capability diagnostic and preserve the override", async () => {
  const deps = configurationDeps({
    env: { CHAINLESSCHAIN_HOME: "C:/isolated", PATH: process.env.PATH },
    error: new Error("default profile must not be read"),
    cli: (callback, options) => {
      assert.equal(options.env.CHAINLESSCHAIN_HOME, "C:/isolated");
      callback(
        null,
        JSON.stringify({
          schema: "chainlesschain.model-capability-profile/v1",
          provider: "openai",
          model: "relay-alias",
        }),
        "private diagnostic",
      );
      return {};
    },
  });
  assert.deepEqual(await getLlmConfigurationState({ command: "cc", deps }), {
    status: "configured",
    provider: "openai",
    source: "cli",
  });
});

test("a missing file may use a valid CLI diagnostic without a model request", async () => {
  const result = await getLlmConfigurationState({
    command: "cc",
    deps: configurationDeps({
      error: Object.assign(new Error("missing"), { code: "ENOENT" }),
      cli: (callback) => {
        callback(
          null,
          JSON.stringify({
            schema: "chainlesschain.model-capability-profile/v1",
            provider: "ollama",
          }),
          "",
        );
        return {};
      },
    }),
  });
  assert.equal(result.status, "configured");
});

test("failed, unsupported and malformed CLI diagnostics never mean unconfigured", async () => {
  for (const response of [
    [new Error("private-key"), "", "private-key"],
    [null, "private-key invalid json", ""],
    [null, JSON.stringify({ provider: "openai" }), ""],
    [
      null,
      JSON.stringify({
        schema: "chainlesschain.model-capability-profile/v1",
        provider: null,
      }),
      "",
    ],
  ]) {
    const result = await getLlmConfigurationState({
      command: "cc",
      deps: configurationDeps({
        env: { CLAUDE_CONFIG_DIR: "C:/relocated" },
        cli: (callback) => {
          callback(...response);
          return {};
        },
      }),
    });
    assert.equal(result.status, "unavailable");
    assert.ok(!JSON.stringify(result).includes("private-key"));
  }
});
