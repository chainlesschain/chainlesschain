/**
 * `--input-format stream-json` × `--json-schema` (P2 §"JSON Schema 与流式结构化
 * 结果"): the stream-INPUT runner now reaches parity with single-prompt
 * `--json-schema` — it resolves + meta-validates the schema up front (fail-fast),
 * injects the output contract into the system prompt, and emits a per-turn
 * `structured_result` event after each turn's result. The agent loop and stdin
 * are injected, so this is exercised without a real model or pipe.
 */

import { describe, it, expect } from "vitest";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

const baseDeps = (over = {}) => {
  const lines = [];
  const errs = [];
  return {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    writeOut: (s) => lines.push(s),
    writeErr: (s) => errs.push(s),
    _lines: lines,
    _errs: errs,
    ...over,
  };
};

async function* input(...jsonObjs) {
  yield jsonObjs.map((o) => JSON.stringify(o)).join("\n") + "\n";
}

const parseEmitted = (lines) =>
  lines
    .join("")
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

// An agent loop whose final text is fixed, so we can drive validity precisely.
const loopReturning = (finalText) =>
  async function* () {
    yield { type: "response-complete", content: finalText };
    yield { type: "run-ended", reason: "complete" };
  };

const OBJ_SCHEMA = JSON.stringify({
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
  additionalProperties: false,
});

describe("stream-json × --json-schema", () => {
  it("emits a per-turn structured_result for a conforming reply", async () => {
    const deps = baseDeps({
      agentLoop: loopReturning('{"ok":true}'),
      input: input({ type: "user", text: "go" }),
    });
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false, jsonSchema: OBJ_SCHEMA },
      deps,
    );
    const events = parseEmitted(deps._lines);
    const sr = events.find((e) => e.type === "structured_result");
    expect(sr).toBeTruthy();
    expect(sr.valid).toBe(true);
    expect(sr.value).toEqual({ ok: true });
    expect(sr.schema_digest).toMatch(/^sha256:/);
    expect(sr.session_id).toBeTruthy();
    expect(sr.turn).toBe(1);
    // It comes AFTER that turn's result.
    const idxResult = events.findIndex((e) => e.type === "result");
    const idxSr = events.findIndex((e) => e.type === "structured_result");
    expect(idxSr).toBeGreaterThan(idxResult);
    expect(outcome.exitCode).toBe(0);
  });

  it("reports valid:false with coded errors for a schema-violating reply", async () => {
    const deps = baseDeps({
      agentLoop: loopReturning('{"ok":"not a boolean"}'),
      input: input({ type: "user", text: "go" }),
    });
    await runAgentHeadlessStream(
      { expandFileRefs: false, jsonSchema: OBJ_SCHEMA },
      deps,
    );
    const events = parseEmitted(deps._lines);
    const sr = events.find((e) => e.type === "structured_result");
    expect(sr.valid).toBe(false);
    expect(Array.isArray(sr.errors)).toBe(true);
    expect(sr.errors.length).toBeGreaterThan(0);
  });

  it("reports valid:false (never free text) when the reply has no JSON", async () => {
    const deps = baseDeps({
      agentLoop: loopReturning("here is some prose, no JSON at all"),
      input: input({ type: "user", text: "go" }),
    });
    await runAgentHeadlessStream(
      { expandFileRefs: false, jsonSchema: OBJ_SCHEMA },
      deps,
    );
    const sr = parseEmitted(deps._lines).find(
      (e) => e.type === "structured_result",
    );
    expect(sr.valid).toBe(false);
    expect(sr.value).toBeNull();
  });

  it("emits one structured_result per turn across a multi-turn stream", async () => {
    const deps = baseDeps({
      agentLoop: loopReturning('{"ok":true}'),
      input: input({ text: "one" }, { text: "two" }),
    });
    await runAgentHeadlessStream(
      { expandFileRefs: false, jsonSchema: OBJ_SCHEMA },
      deps,
    );
    const srs = parseEmitted(deps._lines).filter(
      (e) => e.type === "structured_result",
    );
    expect(srs).toHaveLength(2);
    expect(srs.map((e) => e.turn)).toEqual([1, 2]);
  });

  it("injects the schema output contract into the system prompt", async () => {
    let systemContent = "";
    const deps = baseDeps({
      agentLoop: async function* (messages) {
        systemContent =
          messages.find((m) => m.role === "system")?.content || "";
        yield { type: "response-complete", content: '{"ok":true}' };
        yield { type: "run-ended", reason: "complete" };
      },
      input: input({ text: "go" }),
    });
    await runAgentHeadlessStream(
      { expandFileRefs: false, jsonSchema: OBJ_SCHEMA },
      deps,
    );
    expect(systemContent).toContain("OUTPUT CONTRACT");
    expect(systemContent).toContain('"required":["ok"]');
  });

  it("fails fast (exit 1, no turns) on an invalid inline schema", async () => {
    const deps = baseDeps({
      agentLoop: loopReturning('{"ok":true}'),
      input: input({ text: "go" }),
    });
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false, jsonSchema: "{not valid json" },
      deps,
    );
    expect(outcome).toEqual({ exitCode: 1, turns: 0 });
    expect(deps._errs.join("")).toMatch(/Error:/);
    // Bailed before any stream output — no init, no result.
    expect(deps._lines.join("")).toBe("");
  });

  it("emits NO structured_result when --json-schema is not set (byte-identical)", async () => {
    const deps = baseDeps({
      agentLoop: loopReturning('{"ok":true}'),
      input: input({ text: "go" }),
    });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);
    const srs = parseEmitted(deps._lines).filter(
      (e) => e.type === "structured_result",
    );
    expect(srs).toHaveLength(0);
  });
});
