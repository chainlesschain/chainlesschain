/**
 * Capability handshake wiring in the stream-json headless runner
 * (agent-sdk docs/PROTOCOL.md §1.3):
 *   1. parseInputEvent recognizes a `hello` line and normalizes it to an offer.
 *   2. createStreamCoalescer reads a LIVE fieldGate per line, so a negotiation
 *      arriving mid-stream can suppress negotiated metadata fields (teeth),
 *      while the default (all-true) gate is byte-for-byte unchanged.
 * The negotiation algorithm itself is covered by capability-negotiation.test.js;
 * here we prove the runner's two integration seams.
 */
import { describe, it, expect } from "vitest";
import {
  parseInputEvent,
  createStreamCoalescer,
  runAgentHeadlessStream,
} from "../../src/runtime/headless-stream.js";
import { applyNegotiationToGate } from "../../src/lib/capability-negotiation.js";

describe("parseInputEvent — capability hello", () => {
  it("normalizes a full hello into an offer", () => {
    expect(
      parseInputEvent(
        '{"type":"hello","protocol_version":2,"min_protocol_version":1,"features":["trace_id"]}',
      ),
    ).toEqual({
      hello: {
        protocolVersion: 2,
        minProtocolVersion: 1,
        features: ["trace_id"],
      },
    });
  });

  it("a bare hello (no fields) is an empty offer, not null", () => {
    expect(parseInputEvent('{"type":"hello"}')).toEqual({ hello: {} });
  });

  it("omitted fields stay absent (so negotiation applies its own defaults)", () => {
    expect(parseInputEvent('{"type":"hello","features":[]}')).toEqual({
      hello: { features: [] },
    });
  });

  it("still parses the other input types unchanged", () => {
    expect(parseInputEvent('{"type":"interrupt"}')).toEqual({
      interrupt: true,
    });
  });
});

function capture(fieldGate) {
  const lines = [];
  const c = createStreamCoalescer({
    writeOut: (s) => lines.push(JSON.parse(s.replace(/\n$/, ""))),
    coalesceMs: 0,
    traceId: "trace-abc",
    fieldGate,
  });
  return { emit: c.emit, lines };
}

async function runNegotiatedPermissionDecision(features) {
  const lines = [];
  async function* input() {
    yield `${JSON.stringify({
      type: "hello",
      protocol_version: 1,
      min_protocol_version: 1,
      features,
    })}\n`;
    yield `${JSON.stringify({ type: "user", text: "inspect" })}\n`;
  }
  async function* agentLoop() {
    yield { type: "tool-executing", tool: "run_shell", args: {} };
    yield {
      type: "tool-result",
      tool: "run_shell",
      result: { error: "blocked" },
      permission_decision_id: "perm-live-1",
      permission_decision: {
        version: 1,
        id: "perm-live-1",
        decision: "deny",
      },
    };
    yield { type: "response-complete", content: "done" };
    yield { type: "run-ended", reason: "complete" };
  }
  await runAgentHeadlessStream(
    { expandFileRefs: false, traceId: "trace-negotiation-test" },
    {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut: (line) => lines.push(line),
      writeErr: () => {},
      agentLoop,
      input: input(),
    },
  );
  return lines
    .join("")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("createStreamCoalescer — fieldGate teeth", () => {
  it("stamps seq + trace_id when the gate is all true (default behavior)", () => {
    const { emit, lines } = capture({
      seq: true,
      trace_id: true,
      tool_use_id: true,
      permission_decision: true,
    });
    emit({ type: "system", subtype: "init" });
    expect(lines[0]).toMatchObject({
      type: "system",
      trace_id: "trace-abc",
      seq: 1,
    });
  });

  it("suppresses seq but keeps trace_id after a client drops event_seq", () => {
    const gate = {
      seq: true,
      trace_id: true,
      tool_use_id: true,
      permission_decision: true,
    };
    // Client negotiated only trace_id.
    applyNegotiationToGate({ ok: true, features: ["trace_id"] }, gate);
    const { emit, lines } = capture(gate);
    emit({ type: "tool_use", tool: "read_file" });
    expect(lines[0]).toHaveProperty("trace_id", "trace-abc");
    expect(lines[0]).not.toHaveProperty("seq");
  });

  it("suppresses trace_id but keeps seq after a client drops trace_id", () => {
    const gate = {
      seq: true,
      trace_id: true,
      tool_use_id: true,
      permission_decision: true,
    };
    applyNegotiationToGate({ ok: true, features: ["event_seq"] }, gate);
    const { emit, lines } = capture(gate);
    emit({ type: "text" });
    expect(lines[0]).toHaveProperty("seq", 1);
    expect(lines[0]).not.toHaveProperty("trace_id");
  });

  it("a null gate stamps everything (unchanged legacy path)", () => {
    const { emit, lines } = capture(null);
    emit({ type: "system" });
    expect(lines[0]).toMatchObject({ trace_id: "trace-abc", seq: 1 });
  });

  it("suppresses the permission decision and its id as one feature", () => {
    const gate = {
      seq: true,
      trace_id: true,
      tool_use_id: true,
      permission_decision: true,
    };
    applyNegotiationToGate({ ok: true, features: ["event_seq"] }, gate);
    const { emit, lines } = capture(gate);
    emit({
      type: "tool_result",
      permission_decision_id: "perm-1",
      permission_decision: { id: "perm-1", decision: "allow" },
    });

    expect(lines[0]).not.toHaveProperty("permission_decision");
    expect(lines[0]).not.toHaveProperty("permission_decision_id");
  });

  it("preserves the permission decision pair without mutating the input", () => {
    const gate = {
      seq: true,
      trace_id: true,
      tool_use_id: true,
      permission_decision: true,
    };
    const { emit, lines } = capture(gate);
    const event = {
      type: "tool_result",
      permission_decision_id: "perm-2",
      permission_decision: { id: "perm-2", decision: "deny" },
    };
    const original = structuredClone(event);
    emit(event);

    expect(lines[0]).toMatchObject(event);
    expect(event).toEqual(original);
  });

  it("seq stays monotonic across gate flips (counter not reset by suppression)", () => {
    const gate = {
      seq: true,
      trace_id: true,
      tool_use_id: true,
      permission_decision: true,
    };
    const { emit, lines } = capture(gate);
    emit({ type: "a" }); // seq 1
    gate.seq = false;
    emit({ type: "b" }); // suppressed, counter NOT advanced
    gate.seq = true;
    emit({ type: "c" }); // seq 2
    expect(lines[0].seq).toBe(1);
    expect(lines[1]).not.toHaveProperty("seq");
    expect(lines[2].seq).toBe(2);
  });
});

describe("runAgentHeadlessStream — negotiated permission decision wiring", () => {
  it("strips both fields when an explicit hello omits the feature", async () => {
    const lines = await runNegotiatedPermissionDecision([
      "event_seq",
      "tool_use_id",
      "trace_id",
    ]);
    const negotiated = lines.find(
      (line) => line.type === "system" && line.subtype === "negotiated",
    );
    const result = lines.find((line) => line.type === "tool_result");

    expect(negotiated.disabled_features).toContain("permission_decision");
    expect(result).not.toHaveProperty("permission_decision");
    expect(result).not.toHaveProperty("permission_decision_id");
  });

  it("keeps both fields when an explicit hello accepts the feature", async () => {
    const lines = await runNegotiatedPermissionDecision([
      "event_seq",
      "tool_use_id",
      "permission_decision",
      "trace_id",
    ]);
    const result = lines.find((line) => line.type === "tool_result");

    expect(result.permission_decision_id).toBe("perm-live-1");
    expect(result.permission_decision).toMatchObject({
      id: "perm-live-1",
      decision: "deny",
    });
  });
});
