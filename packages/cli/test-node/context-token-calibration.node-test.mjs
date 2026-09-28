import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareContextTokenEstimates,
  observedInputTokens,
} from "../scripts/context-token-calibration.mjs";

test("input usage includes Anthropic cache creation and read tokens", () => {
  assert.equal(
    observedInputTokens({
      input_tokens: 8,
      cache_creation_input_tokens: 12,
      cache_read_input_tokens: 20,
    }),
    40,
  );
  assert.equal(observedInputTokens({ prompt_tokens: 21 }), 21);
  assert.throws(
    () => observedInputTokens({ input_tokens: 8, prompt_tokens: 8 }),
    /exactly one/,
  );
  assert.throws(() => observedInputTokens({ input_tokens: -1 }), /nonnegative/);
});

test("report groups actual usage comparisons without exposing prompt text", () => {
  const rows = [
    {
      category: "chinese",
      provider: "openai",
      model: "gpt-6-sol",
      messages: [{ role: "user", content: "秘密提示：你好世界" }],
      toolDefinitions: [],
      usage: { input_tokens: 40 },
    },
    {
      category: "tool-schema",
      provider: "openai",
      model: "gpt-6-sol",
      messages: [{ role: "user", content: "Run tool" }],
      toolDefinitions: [
        {
          type: "function",
          function: { name: "search", parameters: { type: "object" } },
        },
      ],
      usage: { input_tokens: 60 },
    },
  ];
  const report = compareContextTokenEstimates(rows);
  assert.equal(report.total.samples, 2);
  assert.equal(report.groups.length, 2);
  assert.ok(report.requests[0].estimatedTokens > 0);
  assert.ok(
    report.requests[1].estimatedTokens > report.requests[0].estimatedTokens,
  );
  assert.match(report.requests[0].requestSha256, /^[a-f0-9]{64}$/u);
  assert.ok(!JSON.stringify(report).includes("秘密提示"));
  assert.ok(!JSON.stringify(report).includes("search"));
});

test("malformed captures cannot silently become calibration evidence", () => {
  const row = {
    category: "code",
    provider: "openai",
    model: "gpt-6-sol",
    messages: [],
    toolDefinitions: [],
    usage: { input_tokens: 10 },
  };
  assert.throws(() => compareContextTokenEstimates([]), /at least one/);
  assert.throws(
    () => compareContextTokenEstimates([{ ...row, category: "other" }]),
    /unknown category/,
  );
  assert.throws(
    () => compareContextTokenEstimates([{ ...row, usage: {} }]),
    /exactly one/,
  );
});

test("the command reports usage without echoing prompts or malformed input", () => {
  const directory = mkdtempSync(join(tmpdir(), "cc-token-calibration-"));
  const input = join(directory, "requests.jsonl");
  const command = fileURLToPath(
    new URL("../scripts/context-token-calibration.mjs", import.meta.url),
  );
  try {
    writeFileSync(
      input,
      `${JSON.stringify({
        category: "emoji",
        provider: "openai",
        model: "gpt-6-sol",
        messages: [{ role: "user", content: "PRIVATE_PROMPT_SENTINEL 😀" }],
        toolDefinitions: [],
        usage: { input_tokens: 30 },
      })}\n`,
    );
    const valid = spawnSync(process.execPath, [command, "--input", input], {
      encoding: "utf8",
    });
    assert.equal(valid.status, 0);
    assert.equal(JSON.parse(valid.stdout).total.observedTokens, 30);
    assert.ok(!valid.stdout.includes("PRIVATE_PROMPT_SENTINEL"));

    writeFileSync(input, '{"content":"PRIVATE_PROMPT_SENTINEL",}\n');
    const result = spawnSync(process.execPath, [command, "--input", input], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid input or request shape/u);
    assert.ok(!result.stderr.includes("PRIVATE_PROMPT_SENTINEL"));
    assert.equal(result.stdout, "");
  } finally {
    unlinkSync(input);
    rmdirSync(directory);
  }
});
