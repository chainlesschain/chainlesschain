"use strict";

/**
 * coding-agent-events tests (previously untested) — the unified event protocol
 * shared by the CLI runtime, Desktop Main and the Renderer. Pins the contract:
 * mapLegacyType normalization, the per-requestId monotonic SequenceTracker,
 * createCodingAgentEvent envelope shaping (type normalize, id/eventId alias,
 * sessionId/requestId resolution, sequence rules, meta sanitization, source
 * default), wrapLegacyMessage, and validateCodingAgentEvent (version/type/
 * eventId/payload checks). A fresh tracker is injected per test to avoid the
 * module-global default tracker leaking state. No I/O.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  CODING_AGENT_EVENT_VERSION,
  CODING_AGENT_EVENT_TYPES,
  LEGACY_TO_UNIFIED_TYPE,
  CodingAgentSequenceTracker,
  createCodingAgentEvent,
  wrapLegacyMessage,
  validateCodingAgentEvent,
  mapLegacyType,
} = require("../coding-agent-events.cjs");

const VALID_TYPE = Object.values(CODING_AGENT_EVENT_TYPES)[0];
const newTracker = () => new CodingAgentSequenceTracker();

describe("mapLegacyType", () => {
  it("returns null for falsy input", () => {
    expect(mapLegacyType(null)).toBe(null);
    expect(mapLegacyType("")).toBe(null);
  });

  it("maps a known legacy type to its canonical form", () => {
    const entries = Object.entries(LEGACY_TO_UNIFIED_TYPE);
    expect(entries.length).toBeGreaterThan(0);
    const [legacy, unified] = entries[0];
    expect(mapLegacyType(legacy)).toBe(unified);
  });

  it("passes an unknown type through unchanged", () => {
    expect(mapLegacyType("totally.unknown.type")).toBe("totally.unknown.type");
  });
});

describe("CodingAgentSequenceTracker", () => {
  it("increments strictly per requestId", () => {
    const t = newTracker();
    expect(t.next("r1")).toBe(1);
    expect(t.next("r1")).toBe(2);
    expect(t.next("r1")).toBe(3);
  });

  it("keeps separate requestIds independent", () => {
    const t = newTracker();
    expect(t.next("a")).toBe(1);
    expect(t.next("b")).toBe(1);
    expect(t.next("a")).toBe(2);
  });

  it("returns 0 for a falsy requestId without advancing", () => {
    const t = newTracker();
    expect(t.next(null)).toBe(0);
    expect(t.next(null)).toBe(0);
  });

  it("peek reads without advancing; reset clears", () => {
    const t = newTracker();
    t.next("r");
    expect(t.peek("r")).toBe(1);
    expect(t.peek("r")).toBe(1);
    t.reset("r");
    expect(t.next("r")).toBe(1); // back to start
  });
});

describe("createCodingAgentEvent", () => {
  it("throws on a non-object payload", () => {
    expect(() => createCodingAgentEvent(VALID_TYPE, "nope")).toThrow(TypeError);
  });

  it("produces a versioned envelope with eventId/id alias and defaults", () => {
    const ev = createCodingAgentEvent(
      VALID_TYPE,
      { x: 1 },
      { tracker: newTracker() },
    );
    expect(ev.version).toBe(CODING_AGENT_EVENT_VERSION);
    expect(ev.type).toBe(VALID_TYPE);
    expect(ev.eventId).toBeTruthy();
    expect(ev.id).toBe(ev.eventId); // legacy alias
    expect(ev.source).toBe("desktop-main"); // default source
    expect(ev.payload).toEqual({ x: 1 });
  });

  it("normalizes a legacy type alias", () => {
    const [legacy, unified] = Object.entries(LEGACY_TO_UNIFIED_TYPE)[0];
    expect(
      createCodingAgentEvent(legacy, {}, { tracker: newTracker() }).type,
    ).toBe(unified);
  });

  it("resolves sessionId/requestId from context, falling back to payload", () => {
    const fromCtx = createCodingAgentEvent(
      VALID_TYPE,
      {},
      {
        sessionId: "s1",
        requestId: "r1",
        tracker: newTracker(),
      },
    );
    expect(fromCtx.sessionId).toBe("s1");
    expect(fromCtx.requestId).toBe("r1");

    const fromPayload = createCodingAgentEvent(
      VALID_TYPE,
      { sessionId: "sp", id: "rp" },
      {
        tracker: newTracker(),
      },
    );
    expect(fromPayload.sessionId).toBe("sp");
    expect(fromPayload.requestId).toBe("rp");
  });

  it("uses an explicit integer sequence when provided", () => {
    const ev = createCodingAgentEvent(
      VALID_TYPE,
      {},
      { sequence: 7, tracker: newTracker() },
    );
    expect(ev.sequence).toBe(7);
  });

  it("auto-increments sequence via the tracker for a requestId", () => {
    const tracker = newTracker();
    const a = createCodingAgentEvent(
      VALID_TYPE,
      {},
      { requestId: "r", tracker },
    );
    const b = createCodingAgentEvent(
      VALID_TYPE,
      {},
      { requestId: "r", tracker },
    );
    expect(a.sequence).toBe(1);
    expect(b.sequence).toBe(2);
  });

  it("leaves sequence null when there is no requestId and no explicit value", () => {
    const ev = createCodingAgentEvent(
      VALID_TYPE,
      {},
      { tracker: newTracker() },
    );
    expect(ev.sequence).toBe(null);
  });

  it("honors an explicit eventId and timestamp", () => {
    const ev = createCodingAgentEvent(
      VALID_TYPE,
      {},
      {
        eventId: "fixed-id",
        timestamp: 1234,
        tracker: newTracker(),
      },
    );
    expect(ev.eventId).toBe("fixed-id");
    expect(ev.timestamp).toBe(1234);
  });

  it("strips envelope fields accidentally placed in meta", () => {
    const ev = createCodingAgentEvent(
      VALID_TYPE,
      {},
      {
        meta: {
          sessionId: "x",
          requestId: "y",
          sequence: 9,
          source: "z",
          eventId: "e",
          keep: "ok",
        },
        tracker: newTracker(),
      },
    );
    expect(ev.meta).toEqual({ keep: "ok" });
  });
});

describe("wrapLegacyMessage", () => {
  it("throws for a non-object message", () => {
    expect(() => wrapLegacyMessage(null)).toThrow(TypeError);
  });

  it("splits {type, ...payload} and resolves requestId from message.id", () => {
    const ev = wrapLegacyMessage(
      { type: VALID_TYPE, id: "req-9", foo: "bar" },
      { tracker: newTracker() },
    );
    expect(ev.type).toBe(VALID_TYPE);
    expect(ev.requestId).toBe("req-9");
    expect(ev.payload.foo).toBe("bar");
  });
});

describe("validateCodingAgentEvent", () => {
  const valid = () =>
    createCodingAgentEvent(VALID_TYPE, {}, { tracker: newTracker() });

  it("accepts a freshly created envelope", () => {
    expect(validateCodingAgentEvent(valid())).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects a non-object", () => {
    const r = validateCodingAgentEvent(null);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/object/);
  });

  it("flags a wrong version", () => {
    const r = validateCodingAgentEvent({ ...valid(), version: "v0" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /version/.test(e))).toBe(true);
  });

  it("flags a missing or non-whitelisted type", () => {
    expect(
      validateCodingAgentEvent({ ...valid(), type: undefined }).errors.some(
        (e) => /type is required/.test(e),
      ),
    ).toBe(true);
    expect(
      validateCodingAgentEvent({ ...valid(), type: "bogus.type" }).errors.some(
        (e) => /whitelist/.test(e),
      ),
    ).toBe(true);
  });

  it("flags a missing eventId and a non-object payload", () => {
    expect(
      validateCodingAgentEvent({ ...valid(), eventId: undefined }).errors.some(
        (e) => /eventId/.test(e),
      ),
    ).toBe(true);
    expect(
      validateCodingAgentEvent({ ...valid(), payload: "x" }).errors.some((e) =>
        /payload/.test(e),
      ),
    ).toBe(true);
  });
});
