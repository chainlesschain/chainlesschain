/**
 * Unit tests: web-ui-envelope.js
 *
 * The web UI receives unified Coding Agent envelopes from the CLI runtime
 * but its existing switch table still keys off legacy kebab-case names.
 * `unwrapEnvelope` is the single source of truth that bridges both worlds.
 *
 * These tests cover:
 *   1. Pass-through for non-envelope traffic.
 *   2. Detection rules (version, eventId, payload shape).
 *   3. Type mapping for every entry in UNIFIED_TO_LEGACY.
 *   4. sessionId / requestId promotion from envelope into the flat shape.
 *   5. The inlined browser bundle stays in lock-step with the helper.
 */

import { describe, it, expect } from "vitest";
import {
  UNIFIED_TO_LEGACY,
  unwrapEnvelope,
  getInlineSource,
} from "../../src/lib/web-ui-envelope.js";

function makeEnvelope(overrides = {}) {
  return {
    version: "1.0",
    eventId: "evt-test-1",
    type: "session.started",
    requestId: "req-1",
    sessionId: "sess-1",
    source: "cli-runtime",
    payload: { sessionId: "sess-1", record: { id: "sess-1" } },
    ...overrides,
  };
}

describe("web-ui-envelope.unwrapEnvelope", () => {
  describe("pass-through (not an envelope)", () => {
    it("returns null/undefined unchanged", () => {
      expect(unwrapEnvelope(null)).toBe(null);
      expect(unwrapEnvelope(undefined)).toBe(undefined);
    });

    it("returns primitives unchanged", () => {
      expect(unwrapEnvelope("hello")).toBe("hello");
      expect(unwrapEnvelope(42)).toBe(42);
      expect(unwrapEnvelope(true)).toBe(true);
    });

    it("returns plain legacy messages unchanged", () => {
      const legacy = { id: "x", type: "auth-result", success: true };
      expect(unwrapEnvelope(legacy)).toBe(legacy);
    });

    it("returns when version is missing", () => {
      const msg = { eventId: "e1", payload: {}, type: "session.started" };
      expect(unwrapEnvelope(msg)).toBe(msg);
    });

    it("returns when version is wrong", () => {
      const msg = makeEnvelope({ version: "2.0" });
      expect(unwrapEnvelope(msg)).toBe(msg);
    });

    it("returns when eventId is missing", () => {
      const msg = makeEnvelope();
      delete msg.eventId;
      expect(unwrapEnvelope(msg)).toBe(msg);
    });

    it("returns when eventId is not a string", () => {
      const msg = makeEnvelope({ eventId: 12345 });
      expect(unwrapEnvelope(msg)).toBe(msg);
    });

    it("returns when payload is missing", () => {
      const msg = makeEnvelope();
      delete msg.payload;
      expect(unwrapEnvelope(msg)).toBe(msg);
    });

    it("returns when payload is null", () => {
      const msg = makeEnvelope({ payload: null });
      expect(unwrapEnvelope(msg)).toBe(msg);
    });

    it("returns when payload is a string (not an object)", () => {
      const msg = makeEnvelope({ payload: "oops" });
      expect(unwrapEnvelope(msg)).toBe(msg);
    });
  });

  describe("envelope detection + unwrap", () => {
    it("flattens payload onto a fresh object", () => {
      const env = makeEnvelope({
        payload: { sessionId: "s1", record: { foo: "bar" }, history: [] },
      });
      const flat = unwrapEnvelope(env);
      expect(flat).not.toBe(env);
      expect(flat).not.toBe(env.payload);
      expect(flat.record).toEqual({ foo: "bar" });
      expect(flat.history).toEqual([]);
    });

    it("rewrites type to legacy kebab-case", () => {
      const env = makeEnvelope({ type: "session.started" });
      expect(unwrapEnvelope(env).type).toBe("session-created");
    });

    it("promotes sessionId from envelope into flat shape", () => {
      const env = makeEnvelope({
        sessionId: "promoted",
        payload: { record: {} },
      });
      expect(unwrapEnvelope(env).sessionId).toBe("promoted");
    });

    it("promotes requestId from envelope into flat shape", () => {
      const env = makeEnvelope({
        requestId: "req-99",
        payload: { record: {} },
      });
      expect(unwrapEnvelope(env).requestId).toBe("req-99");
    });

    it("does NOT overwrite payload sessionId with null envelope sessionId", () => {
      const env = makeEnvelope({
        sessionId: null,
        payload: { sessionId: "from-payload" },
      });
      expect(unwrapEnvelope(env).sessionId).toBe("from-payload");
    });

    it("envelope sessionId wins over payload sessionId when both set", () => {
      // Envelope-level field is more authoritative because it is set by
      // the CLI runtime after the session is fully bound.
      const env = makeEnvelope({
        sessionId: "envelope-wins",
        payload: { sessionId: "payload-loses" },
      });
      expect(unwrapEnvelope(env).sessionId).toBe("envelope-wins");
    });

    it("preserves source field on the original envelope (does not leak into flat)", () => {
      const env = makeEnvelope({ source: "cli-runtime" });
      const flat = unwrapEnvelope(env);
      expect(flat.source).toBeUndefined();
      expect(env.source).toBe("cli-runtime");
    });

    it("unmapped envelope type passes type through unchanged", () => {
      const env = makeEnvelope({ type: "future.event.type" });
      expect(unwrapEnvelope(env).type).toBe("future.event.type");
    });

    it("error envelope unwraps payload code/message", () => {
      const env = makeEnvelope({
        type: "error",
        payload: { code: "BAD_THING", message: "broken" },
      });
      const flat = unwrapEnvelope(env);
      expect(flat.type).toBe("error");
      expect(flat.code).toBe("BAD_THING");
      expect(flat.message).toBe("broken");
    });
  });

  describe("UNIFIED_TO_LEGACY map coverage", () => {
    it("contains every required Coding Agent v1.0 type", () => {
      const required = [
        "session.started",
        "session.resumed",
        "session.list",
        "session.closed",
        "assistant.delta",
        "assistant.final",
        "assistant.message",
        "tool.call.started",
        "tool.call.completed",
        "tool.call.failed",
        "plan.started",
        "plan.updated",
        "plan.approval_required",
        "approval.requested",
        "command.response",
        "context.compaction.completed",
        "worktree.list",
        "worktree.diff",
        "worktree.merged",
        "worktree.merge-preview",
        "worktree.automation-applied",
      ];
      for (const key of required) {
        expect(UNIFIED_TO_LEGACY[key]).toBeDefined();
        expect(typeof UNIFIED_TO_LEGACY[key]).toBe("string");
      }
    });

    it("every value uses kebab-case (no dots, no underscores)", () => {
      for (const value of Object.values(UNIFIED_TO_LEGACY)) {
        expect(value).not.toMatch(/[._]/);
        expect(value).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });

    it("every key is dot-segmented (at least one dot, lowercase tokens)", () => {
      // Tokens may contain dashes (e.g. `assistant.thought-summary`) and
      // underscores (e.g. `plan.approval_required`); the only hard rule
      // is that the namespace separator is `.`.
      for (const key of Object.keys(UNIFIED_TO_LEGACY)) {
        expect(key).toMatch(/\./);
        expect(key).toMatch(/^[a-z][a-z0-9._-]*$/);
      }
    });

    it("is frozen (immutable)", () => {
      expect(Object.isFrozen(UNIFIED_TO_LEGACY)).toBe(true);
    });

    it("round-trips every mapped type through unwrapEnvelope", () => {
      for (const [unifiedType, legacyType] of Object.entries(
        UNIFIED_TO_LEGACY,
      )) {
        const env = makeEnvelope({ type: unifiedType, payload: { ok: 1 } });
        const flat = unwrapEnvelope(env);
        expect(flat.type).toBe(legacyType);
      }
    });
  });

  describe("getInlineSource (browser bundle)", () => {
    it("returns ES5-friendly source (var, not const/let)", () => {
      const src = getInlineSource();
      expect(src).toContain("var UNIFIED_TO_LEGACY");
      expect(src).toContain("function unwrapEnvelope(msg)");
      // Must not use modern keywords that would break ES5 runtimes.
      expect(src).not.toMatch(/\bconst\s/);
      expect(src).not.toMatch(/\blet\s/);
      expect(src).not.toMatch(/=>\s/);
    });

    it("inlined source contains every map entry verbatim", () => {
      const src = getInlineSource();
      for (const [unified, legacy] of Object.entries(UNIFIED_TO_LEGACY)) {
        expect(src).toContain(`"${unified}"`);
        expect(src).toContain(`"${legacy}"`);
      }
    });

    it("inlined source is executable and behaves like the helper", () => {
      const src = getInlineSource();
      // Wrap in a closure that returns the function so we can call it.
      // eslint-disable-next-line no-new-func
      const factory = new Function(src + "\nreturn unwrapEnvelope;");
      const inlinedUnwrap = factory();

      // Sanity-check: same answer for a representative envelope.
      const env = makeEnvelope({
        type: "tool.call.completed",
        payload: { toolName: "fs.read", result: { ok: true } },
      });
      const fromHelper = unwrapEnvelope(env);
      const fromInlined = inlinedUnwrap(env);
      expect(fromInlined.type).toBe(fromHelper.type);
      expect(fromInlined.toolName).toBe(fromHelper.toolName);
      expect(fromInlined.sessionId).toBe(fromHelper.sessionId);
    });

    it("inlined source rejects non-envelopes the same way", () => {
      const src = getInlineSource();
      // eslint-disable-next-line no-new-func
      const factory = new Function(src + "\nreturn unwrapEnvelope;");
      const inlinedUnwrap = factory();

      const legacy = { id: "x", type: "auth-result", success: true };
      expect(inlinedUnwrap(legacy)).toBe(legacy);
      expect(inlinedUnwrap(null)).toBe(null);
      expect(inlinedUnwrap("hi")).toBe("hi");
    });
  });
});
