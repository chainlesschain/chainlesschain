"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { setResolvedCli } = require("../src/cli-binary");
const { applyLlmConfig, buildConfigSetArgs } = require("../src/llm-config");

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
