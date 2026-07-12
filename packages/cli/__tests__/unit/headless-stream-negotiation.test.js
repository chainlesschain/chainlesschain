/**
 * Capability handshake wiring in the stream-json headless runner
 * (agent-sdk docs/PROTOCOL.md §1.3):
 *   1. parseInputEvent recognizes a `hello` line and normalizes it to an offer.
 *   2. createStreamCoalescer reads a LIVE fieldGate per line, so a negotiation
 *      arriving mid-stream can suppress `seq` / `trace_id` (teeth), while the
 *      default (all-true) gate is byte-for-byte unchanged.
 * The negotiation algorithm itself is covered by capability-negotiation.test.js;
 * here we prove the runner's two integration seams.
 */
import { describe, it, expect } from "vitest";
import {
  parseInputEvent,
  createStreamCoalescer,
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

describe("createStreamCoalescer — fieldGate teeth", () => {
  it("stamps seq + trace_id when the gate is all true (default behavior)", () => {
    const { emit, lines } = capture({
      seq: true,
      trace_id: true,
      tool_use_id: true,
    });
    emit({ type: "system", subtype: "init" });
    expect(lines[0]).toMatchObject({
      type: "system",
      trace_id: "trace-abc",
      seq: 1,
    });
  });

  it("suppresses seq but keeps trace_id after a client drops event_seq", () => {
    const gate = { seq: true, trace_id: true, tool_use_id: true };
    // Client negotiated only trace_id.
    applyNegotiationToGate({ ok: true, features: ["trace_id"] }, gate);
    const { emit, lines } = capture(gate);
    emit({ type: "tool_use", tool: "read_file" });
    expect(lines[0]).toHaveProperty("trace_id", "trace-abc");
    expect(lines[0]).not.toHaveProperty("seq");
  });

  it("suppresses trace_id but keeps seq after a client drops trace_id", () => {
    const gate = { seq: true, trace_id: true, tool_use_id: true };
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

  it("seq stays monotonic across gate flips (counter not reset by suppression)", () => {
    const gate = { seq: true, trace_id: true, tool_use_id: true };
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
