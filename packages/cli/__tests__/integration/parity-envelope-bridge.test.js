/**
 * Parity Harness — Desktop bridge envelope roundtrip
 *
 * Phase 7 Step 8. The unified Coding Agent event protocol is the wire format
 * shared by the CLI runtime, the Desktop Main process, and the web UI's
 * browser bundle. Three pieces collaborate at the boundary:
 *
 *   1. `createCodingAgentEvent` / `wrapLegacyMessage`
 *        (packages/cli/src/runtime/coding-agent-events.cjs) — the producer
 *        side. Builds envelopes with version "1.0", auto-assigned eventId,
 *        per-requestId monotonic `sequence`, and a legacy→dot-case type map.
 *
 *   2. `validateCodingAgentEvent` (same module) — a defensive gate that
 *        receivers use to fail fast on malformed producers.
 *
 *   3. `unwrapEnvelope` / `UNIFIED_TO_LEGACY`
 *        (packages/cli/src/lib/web-ui-envelope.js) — the consumer side.
 *        Flattens an envelope back into the legacy kebab-case shape the old
 *        CLI WS clients (and the web UI browser bundle) already understand,
 *        and passes non-envelope traffic (auth-result, pings) through
 *        unchanged.
 *
 * This test locks in the roundtrip contract so the Desktop bridge (which
 * sits between the CLI runtime and the web UI) can rely on a byte-level
 * stable shape. The property that must hold:
 *
 *     unwrap(wrapLegacy({ type: legacyT, ...payload })) ≡
 *       { type: legacyT, ...payload, sessionId?, requestId? }
 *
 * for every `legacyT` that appears in LEGACY_TO_UNIFIED_TYPE AND has a
 * reverse entry in UNIFIED_TO_LEGACY. Types that only map one-way (e.g.
 * `response-delta` collapses into `assistant.delta` which reverses to
 * `response-token`) are explicitly excluded from the roundtrip assertion
 * and verified as known lossy mappings instead.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import {
  UNIFIED_TO_LEGACY,
  unwrapEnvelope,
} from "../../src/lib/web-ui-envelope.js";

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
} = require("../../src/runtime/coding-agent-events.cjs");

describe("Phase 7 parity: Desktop bridge envelope roundtrip", () => {
  describe("createCodingAgentEvent", () => {
    it("produces a well-formed envelope with all required fields", () => {
      const tracker = new CodingAgentSequenceTracker();
      const evt = createCodingAgentEvent(
        "tool.call.started",
        { tool: "read_file", args: { path: "foo.txt" } },
        {
          sessionId: "sess-1",
          requestId: "req-1",
          source: "cli-runtime",
          tracker,
        },
      );

      expect(evt.version).toBe(CODING_AGENT_EVENT_VERSION);
      expect(evt.version).toBe("1.0");
      expect(typeof evt.eventId).toBe("string");
      expect(evt.eventId.length).toBeGreaterThan(0);
      expect(evt.id).toBe(evt.eventId); // legacy alias
      expect(evt.type).toBe("tool.call.started");
      expect(evt.sessionId).toBe("sess-1");
      expect(evt.requestId).toBe("req-1");
      expect(evt.source).toBe("cli-runtime");
      expect(evt.sequence).toBe(1);
      expect(typeof evt.timestamp).toBe("number");
      expect(evt.payload).toEqual({
        tool: "read_file",
        args: { path: "foo.txt" },
      });
      expect(evt.meta).toEqual({});

      // Validator accepts our own envelope
      const report = validateCodingAgentEvent(evt);
      expect(report).toEqual({ valid: true, errors: [] });
    });

    it("normalizes a legacy kebab-case type into the dot-case canonical form", () => {
      const evt = createCodingAgentEvent(
        "tool-executing",
        { tool: "read_file" },
        { requestId: "req-legacy" },
      );
      expect(evt.type).toBe(CODING_AGENT_EVENT_TYPES.TOOL_CALL_STARTED);
      expect(evt.type).toBe("tool.call.started");
    });

    it("defaults source to 'desktop-main' when not provided", () => {
      const evt = createCodingAgentEvent("session.started", {}, {});
      expect(evt.source).toBe("desktop-main");
    });

    it("strips envelope-reserved keys from the meta object", () => {
      const evt = createCodingAgentEvent(
        "session.started",
        {},
        {
          meta: {
            customKey: "keep-me",
            sessionId: "strip-1",
            requestId: "strip-2",
            sequence: 99,
            source: "strip-3",
            eventId: "strip-4",
          },
        },
      );
      expect(evt.meta).toEqual({ customKey: "keep-me" });
    });

    it("auto-increments sequence per requestId via the default tracker", () => {
      const tracker = new CodingAgentSequenceTracker();
      const a1 = createCodingAgentEvent(
        "assistant.delta",
        {},
        {
          requestId: "req-A",
          tracker,
        },
      );
      const a2 = createCodingAgentEvent(
        "assistant.delta",
        {},
        {
          requestId: "req-A",
          tracker,
        },
      );
      const b1 = createCodingAgentEvent(
        "assistant.delta",
        {},
        {
          requestId: "req-B",
          tracker,
        },
      );
      const a3 = createCodingAgentEvent(
        "assistant.delta",
        {},
        {
          requestId: "req-A",
          tracker,
        },
      );

      expect(a1.sequence).toBe(1);
      expect(a2.sequence).toBe(2);
      expect(a3.sequence).toBe(3);
      // req-B is an independent counter
      expect(b1.sequence).toBe(1);
    });

    it("respects an explicit context.sequence instead of tracker", () => {
      const tracker = new CodingAgentSequenceTracker();
      const evt = createCodingAgentEvent(
        "assistant.delta",
        {},
        {
          requestId: "req-X",
          sequence: 42,
          tracker,
        },
      );
      expect(evt.sequence).toBe(42);
      // Tracker should NOT have been advanced
      expect(tracker.peek("req-X")).toBe(0);
    });

    it("yields sequence=null when there is no requestId and no tracker override", () => {
      const evt = createCodingAgentEvent("warning", { text: "heads up" }, {});
      expect(evt.sequence).toBe(null);
    });

    it("throws TypeError when payload is a non-object", () => {
      expect(() =>
        createCodingAgentEvent("warning", "not-an-object", {}),
      ).toThrow(TypeError);
    });
  });

  describe("CodingAgentSequenceTracker", () => {
    it("next/peek/reset behave independently per requestId", () => {
      const t = new CodingAgentSequenceTracker();
      expect(t.next("r1")).toBe(1);
      expect(t.next("r1")).toBe(2);
      expect(t.next("r2")).toBe(1);
      expect(t.peek("r1")).toBe(2);
      expect(t.peek("r2")).toBe(1);

      t.reset("r1");
      expect(t.peek("r1")).toBe(0);
      expect(t.next("r1")).toBe(1);
      // r2 counter untouched
      expect(t.peek("r2")).toBe(1);

      // Global reset
      t.reset();
      expect(t.peek("r1")).toBe(0);
      expect(t.peek("r2")).toBe(0);
    });

    it("next returns 0 for a falsy requestId (unsequenced events)", () => {
      const t = new CodingAgentSequenceTracker();
      expect(t.next(null)).toBe(0);
      expect(t.next("")).toBe(0);
      expect(t.next(undefined)).toBe(0);
    });
  });

  describe("wrapLegacyMessage", () => {
    it("lifts a legacy kebab-case message into a canonical envelope", () => {
      const envelope = wrapLegacyMessage(
        {
          type: "tool-executing",
          tool: "read_file",
          args: { path: "a.js" },
          id: "req-77",
          sessionId: "sess-9",
        },
        { source: "cli-runtime" },
      );

      expect(envelope.version).toBe("1.0");
      expect(envelope.type).toBe("tool.call.started");
      expect(envelope.sessionId).toBe("sess-9");
      expect(envelope.requestId).toBe("req-77");
      expect(envelope.source).toBe("cli-runtime");
      // Payload is the remainder of the legacy message (sans `type`)
      expect(envelope.payload).toMatchObject({
        tool: "read_file",
        args: { path: "a.js" },
        id: "req-77",
        sessionId: "sess-9",
      });
    });

    it("rejects non-object inputs", () => {
      expect(() => wrapLegacyMessage(null)).toThrow(TypeError);
      expect(() => wrapLegacyMessage("legacy")).toThrow(TypeError);
      expect(() => wrapLegacyMessage(undefined)).toThrow(TypeError);
    });
  });

  describe("unwrapEnvelope", () => {
    it("flattens a v1.0 envelope into the legacy kebab-case shape", () => {
      const envelope = {
        version: "1.0",
        eventId: "evt-1",
        type: "tool.call.started",
        timestamp: 123,
        sessionId: "sess-1",
        requestId: "req-1",
        source: "cli-runtime",
        sequence: 1,
        payload: { tool: "read_file", args: { path: "foo.txt" } },
        meta: {},
      };

      expect(unwrapEnvelope(envelope)).toEqual({
        type: "tool-executing",
        tool: "read_file",
        args: { path: "foo.txt" },
        sessionId: "sess-1",
        requestId: "req-1",
      });
    });

    it("keeps an unknown type verbatim when no reverse mapping exists", () => {
      const envelope = {
        version: "1.0",
        eventId: "evt-2",
        type: "sub-agent.started",
        payload: { subAgentId: "child-1" },
      };
      // sub-agent.* is NOT in UNIFIED_TO_LEGACY → passed through
      const unwrapped = unwrapEnvelope(envelope);
      expect(unwrapped.type).toBe("sub-agent.started");
      expect(unwrapped.subAgentId).toBe("child-1");
    });

    it("omits sessionId / requestId when the envelope does not carry them", () => {
      const envelope = {
        version: "1.0",
        eventId: "evt-3",
        type: "assistant.final",
        payload: { content: "done" },
      };
      const flat = unwrapEnvelope(envelope);
      expect(flat).toEqual({ type: "response-complete", content: "done" });
      expect("sessionId" in flat).toBe(false);
      expect("requestId" in flat).toBe(false);
    });

    it("returns non-envelope traffic unchanged (pass-through)", () => {
      // null / non-object
      expect(unwrapEnvelope(null)).toBe(null);
      expect(unwrapEnvelope("plain-string")).toBe("plain-string");

      // Missing version
      const authResult = { type: "auth-result", ok: true };
      expect(unwrapEnvelope(authResult)).toBe(authResult);

      // Wrong version
      const wrongVer = {
        version: "2.0",
        eventId: "evt-x",
        type: "session.started",
        payload: {},
      };
      expect(unwrapEnvelope(wrongVer)).toBe(wrongVer);

      // Missing eventId
      const noId = {
        version: "1.0",
        type: "session.started",
        payload: {},
      };
      expect(unwrapEnvelope(noId)).toBe(noId);

      // Missing payload
      const noPayload = {
        version: "1.0",
        eventId: "evt-y",
        type: "session.started",
      };
      expect(unwrapEnvelope(noPayload)).toBe(noPayload);
    });
  });

  describe("roundtrip: legacy → wrap → unwrap ≡ legacy", () => {
    /**
     * Types with a lossless reverse mapping in UNIFIED_TO_LEGACY. Legacy
     * aliases that collapse onto a different canonical form (e.g. the
     * `response-delta`, `tool-blocked`, `plan-generated`, `compression-*`
     * families) are intentionally excluded — those are known lossy
     * mappings where the canonical output is the "winning" legacy name.
     */
    const losslessLegacyTypes = Object.keys(LEGACY_TO_UNIFIED_TYPE).filter(
      (legacy) => {
        const unified = LEGACY_TO_UNIFIED_TYPE[legacy];
        return UNIFIED_TO_LEGACY[unified] === legacy;
      },
    );

    it("covers a non-trivial subset of legacy types", () => {
      // Sanity check — there are at least a dozen lossless mappings so the
      // loop below is actually exercising the protocol surface.
      expect(losslessLegacyTypes.length).toBeGreaterThan(10);
    });

    it.each(losslessLegacyTypes)("roundtrips '%s'", (legacyType) => {
      const legacyMessage = {
        type: legacyType,
        sessionId: "sess-rt",
        id: "req-rt",
        extra: { foo: "bar" },
      };

      const envelope = wrapLegacyMessage(legacyMessage, {
        source: "cli-runtime",
      });
      // Envelope is well-formed
      expect(validateCodingAgentEvent(envelope).valid).toBe(true);

      const flat = unwrapEnvelope(envelope);
      expect(flat.type).toBe(legacyType);
      expect(flat.sessionId).toBe("sess-rt");
      expect(flat.requestId).toBe("req-rt");
      expect(flat.extra).toEqual({ foo: "bar" });
    });

    it("lossy aliases collapse onto the canonical legacy name", () => {
      // response-delta and response-token both map to assistant.delta,
      // but unwrapEnvelope always yields 'response-token' (the winner).
      const fromDelta = unwrapEnvelope(
        wrapLegacyMessage({ type: "response-delta", token: "hi" }),
      );
      expect(fromDelta.type).toBe("response-token");

      // tool-blocked → tool.call.failed → tool-error
      const fromBlocked = unwrapEnvelope(
        wrapLegacyMessage({ type: "tool-blocked", tool: "bash" }),
      );
      expect(fromBlocked.type).toBe("tool-error");

      // plan-generated → plan.updated → plan-updated
      const fromGenerated = unwrapEnvelope(
        wrapLegacyMessage({ type: "plan-generated", plan: [] }),
      );
      expect(fromGenerated.type).toBe("plan-updated");
    });
  });

  describe("validateCodingAgentEvent", () => {
    const baseEvent = () => ({
      version: "1.0",
      eventId: "evt-v",
      type: "session.started",
      timestamp: 1,
      sessionId: "s",
      requestId: "r",
      source: "cli-runtime",
      sequence: 1,
      payload: {},
      meta: {},
    });

    it("accepts a well-formed envelope", () => {
      expect(validateCodingAgentEvent(baseEvent())).toEqual({
        valid: true,
        errors: [],
      });
    });

    it("rejects envelopes with the wrong version", () => {
      const e = baseEvent();
      e.version = "0.9";
      const r = validateCodingAgentEvent(e);
      expect(r.valid).toBe(false);
      expect(r.errors.join(",")).toMatch(/version must be "1.0"/);
    });

    it("rejects envelopes missing eventId", () => {
      const e = baseEvent();
      delete e.eventId;
      const r = validateCodingAgentEvent(e);
      expect(r.valid).toBe(false);
      expect(r.errors.join(",")).toMatch(/eventId is required/);
    });

    it("rejects envelopes whose type is outside the whitelist", () => {
      const e = baseEvent();
      e.type = "not.a.real.type";
      const r = validateCodingAgentEvent(e);
      expect(r.valid).toBe(false);
      expect(r.errors.join(",")).toMatch(/not in the whitelist/);
    });

    it("rejects envelopes with a non-object payload", () => {
      const e = baseEvent();
      e.payload = "oops";
      const r = validateCodingAgentEvent(e);
      expect(r.valid).toBe(false);
      expect(r.errors.join(",")).toMatch(/payload must be an object/);
    });

    it("rejects non-object envelopes entirely", () => {
      expect(validateCodingAgentEvent(null).valid).toBe(false);
      expect(validateCodingAgentEvent("nope").valid).toBe(false);
      expect(validateCodingAgentEvent(undefined).valid).toBe(false);
    });
  });

  describe("mapLegacyType", () => {
    it("maps known legacy types", () => {
      expect(mapLegacyType("tool-executing")).toBe("tool.call.started");
      expect(mapLegacyType("session-created")).toBe("session.started");
    });

    it("passes unknown types through unchanged", () => {
      expect(mapLegacyType("totally.unknown")).toBe("totally.unknown");
    });

    it("returns null for a falsy input", () => {
      expect(mapLegacyType(null)).toBe(null);
      expect(mapLegacyType("")).toBe(null);
      expect(mapLegacyType(undefined)).toBe(null);
    });
  });
});
