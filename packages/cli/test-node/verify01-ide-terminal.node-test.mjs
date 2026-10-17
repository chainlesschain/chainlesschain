import test from "node:test";
import assert from "node:assert/strict";
import { verifyAgentTerminal } from "../src/lib/eval/stream-terminal.js";
import { assessNativeGeneration } from "../scripts/verify01-native-task-checker.mjs";

function records() {
  return [
    { type: "system", subtype: "init", session_id: "real-session", seq: 1 },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: "real-session",
      trace_id: "tr-real",
      turn: 1,
      seq: 2,
      usage: {
        input_tokens: 10,
        output_tokens: 3,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
    {
      type: "system",
      subtype: "end",
      session_id: "real-session",
      trace_id: "tr-real",
      turns: 1,
      seq: 3,
    },
  ];
}
const stream = (rows) =>
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

test("IDE accepts the exact persistent session shutdown; default one-shot remains strict", () => {
  const rows = records();
  assert.equal(verifyAgentTerminal(stream(rows)).terminalVerified, false);
  assert.equal(
    verifyAgentTerminal(stream(rows), { allowSessionEnd: true })
      .terminalVerified,
    true,
  );
  assert.equal(
    verifyAgentTerminal(stream(rows), { allowSessionEnd: true }).totalCostUsd,
    null,
  );
  assert.equal(
    verifyAgentTerminal(stream(rows.slice(0, 2))).terminalVerified,
    true,
  );
});

test("IDE rejects foreign shutdown identity, sequence, extra records and error terminals", () => {
  for (const patch of [
    { session_id: "foreign" },
    { trace_id: "foreign" },
    { seq: 5 },
    { turns: 2 },
    { subtype: "other" },
  ]) {
    const rows = records();
    Object.assign(rows[2], patch);
    assert.equal(
      verifyAgentTerminal(stream(rows), { allowSessionEnd: true })
        .terminalVerified,
      false,
    );
  }
  const cases = [
    [...records(), { type: "tool_use", id: "late" }],
    [...records(), records()[2]],
    [records()[0], { ...records()[1], is_error: true }, records()[2]],
    [
      records()[0],
      { type: "error", error: "failure" },
      records()[1],
      records()[2],
    ],
    [records()[0], records()[1], records()[1], records()[2]],
  ];
  for (const rows of cases)
    assert.equal(
      verifyAgentTerminal(stream(rows), { allowSessionEnd: true })
        .terminalVerified,
      false,
    );
});

test("independent dialect reassessment retains original failure and requires host, broker and scope", () => {
  const native = {
    generationPassed: false,
    host: { passed: true },
    sourceScopePassed: true,
    brokerStatus: { passed: true },
    model: Object.fromEntries(
      ["identity", "fileOnlyToolSurface", "scoped", "settled", "delivered"].map(
        (key) => [key, true],
      ),
    ),
  };
  const result = assessNativeGeneration(native, stream(records()), "vscode");
  assert.equal(result.passed, true);
  assert.equal(result.originalGenerationPassed, false);
  assert.equal(
    assessNativeGeneration(
      { ...native, host: { passed: false } },
      stream(records()),
      "vscode",
    ).passed,
    false,
  );
  assert.equal(
    assessNativeGeneration(
      { ...native, brokerStatus: { passed: false } },
      stream(records()),
      "vscode",
    ).passed,
    false,
  );
  assert.equal(
    assessNativeGeneration(
      { ...native, sourceScopePassed: false },
      stream(records()),
      "vscode",
    ).passed,
    false,
  );
  assert.equal(
    assessNativeGeneration(
      { ...native, model: { ...native.model, delivered: false } },
      stream(records()),
      "vscode",
    ).passed,
    false,
  );
  assert.equal(
    assessNativeGeneration(native, stream(records()), "cli").passed,
    false,
  );
});
