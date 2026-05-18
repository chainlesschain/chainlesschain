import { describe, it, expect } from "vitest";
import {
  ENVELOPE_VERSION,
  TYPES,
  TYPE_PATTERN,
  createEnvelope,
  validateEnvelope,
  isKnownType,
  fromStreamEvent,
  toLegacyWsMessage,
  parseEnvelope,
} from "../lib/service-envelope.js";

describe("createEnvelope", () => {
  it("produces canonical shape with defaults", () => {
    const env = createEnvelope({
      type: "run.token",
      sessionId: "sess_1",
      payload: { content: "hi" },
    });
    expect(env.v).toBe(ENVELOPE_VERSION);
    expect(env.type).toBe("run.token");
    expect(env.sessionId).toBe("sess_1");
    expect(env.runId).toBeNull();
    expect(env.requestId).toBeNull();
    expect(typeof env.ts).toBe("number");
    expect(env.payload).toEqual({ content: "hi" });
  });
  it("requires type", () => {
    expect(() => createEnvelope({ sessionId: "s" })).toThrow(/type/);
  });
  it("requires sessionId", () => {
    expect(() => createEnvelope({ type: "run.token" })).toThrow(/sessionId/);
  });
  it("rejects non-dot.case type", () => {
    expect(() =>
      createEnvelope({ type: "RunToken", sessionId: "s" }),
    ).toThrow(/dot.case/);
  });
  it("accepts custom ts", () => {
    const env = createEnvelope({ type: "run.token", sessionId: "s", ts: 42 });
    expect(env.ts).toBe(42);
  });
});

describe("validateEnvelope", () => {
  it("accepts a well-formed envelope", () => {
    const env = createEnvelope({ type: "run.token", sessionId: "s" });
    expect(validateEnvelope(env)).toEqual([]);
  });
  it("rejects mismatched version", () => {
    const env = createEnvelope({ type: "run.token", sessionId: "s" });
    env.v = 99;
    expect(validateEnvelope(env)[0]).toMatch(/v/);
  });
  it("rejects bad runId/requestId types", () => {
    const env = {
      v: 1,
      type: "run.token",
      sessionId: "s",
      runId: 42,
      requestId: 7,
      ts: 0,
      payload: {},
    };
    const errs = validateEnvelope(env);
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });
  it("rejects null envelope", () => {
    expect(validateEnvelope(null)[0]).toMatch(/object/);
  });
});

describe("isKnownType / TYPE_PATTERN", () => {
  it("recognizes whitelisted types", () => {
    expect(isKnownType(TYPES.SESSION_CREATED)).toBe(true);
    expect(isKnownType("custom.event")).toBe(false);
  });
  it("type pattern accepts dot.case", () => {
    expect(TYPE_PATTERN.test("foo.bar")).toBe(true);
    expect(TYPE_PATTERN.test("foo_bar.baz_qux")).toBe(true);
    expect(TYPE_PATTERN.test("Foo.Bar")).toBe(false);
    expect(TYPE_PATTERN.test("noprefix")).toBe(false);
  });
});

describe("fromStreamEvent", () => {
  const ctx = { sessionId: "s1", runId: "r1", requestId: "req-1" };
  it("maps token", () => {
    const env = fromStreamEvent({ type: "token", content: "hi" }, ctx);
    expect(env.type).toBe(TYPES.RUN_TOKEN);
    expect(env.payload.content).toBe("hi");
    expect(env.runId).toBe("r1");
    expect(env.requestId).toBe("req-1");
  });
  it("maps tool_call", () => {
    const env = fromStreamEvent(
      { type: "tool_call", name: "read_file", args: { path: "x" }, callId: "c1" },
      ctx,
    );
    expect(env.type).toBe(TYPES.RUN_TOOL_CALL);
    expect(env.payload.name).toBe("read_file");
    expect(env.payload.callId).toBe("c1");
  });
  it("preserves stream ts when present", () => {
    const env = fromStreamEvent({ type: "start", ts: 1234 }, ctx);
    expect(env.ts).toBe(1234);
    expect(env.type).toBe(TYPES.RUN_STARTED);
  });
  it("throws on unknown type", () => {
    expect(() => fromStreamEvent({ type: "weird" }, ctx)).toThrow(/unknown/);
  });
  it("requires sessionId in ctx", () => {
    expect(() => fromStreamEvent({ type: "token" }, {})).toThrow(/sessionId/);
  });
});

describe("toLegacyWsMessage", () => {
  it("flattens payload onto root", () => {
    const env = createEnvelope({
      type: "run.token",
      sessionId: "s1",
      runId: "r1",
      requestId: "req-1",
      payload: { content: "hello" },
    });
    const msg = toLegacyWsMessage(env);
    expect(msg.type).toBe("run.token");
    expect(msg.content).toBe("hello");
    expect(msg.requestId).toBe("req-1");
    expect(msg.sessionId).toBe("s1");
  });
  it("rejects invalid envelope", () => {
    expect(() => toLegacyWsMessage({ type: "x" })).toThrow(/invalid/);
  });
});

describe("parseEnvelope", () => {
  it("parses JSON string", () => {
    const env = createEnvelope({ type: "run.token", sessionId: "s" });
    const out = parseEnvelope(JSON.stringify(env));
    expect(out.type).toBe("run.token");
  });
  it("rejects bad JSON", () => {
    expect(() => parseEnvelope("{bad")).toThrow(/JSON/);
  });
  it("validates parsed object", () => {
    expect(() =>
      parseEnvelope(JSON.stringify({ type: "run.token", v: 99 })),
    ).toThrow(/invalid/);
  });
});
