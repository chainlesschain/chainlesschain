"use strict";

import { describe, it, expect } from "vitest";

const {
  SCHEMA_GOVERNANCE,
  EVENT_TYPES,
  isValidEventType,
  createGovernanceEvent,
  verifyGovernanceEvent,
  replayGovernanceLog,
  dedupeEventsByEventId,
  sortEventsChronologically,
  verifyGovernanceLog,
} = require("../lib/federation-governance.js");
const ed25519 = require("../lib/signers/ed25519.js");

describe("federation-governance", () => {
  function makeKeys() {
    return ed25519.generateKeyPair();
  }

  describe("EVENT_TYPES + isValidEventType", () => {
    it("includes all 13 v0.1 event types", () => {
      expect(EVENT_TYPES.length).toBe(13);
      for (const t of [
        "create",
        "invite",
        "vote",
        "leave",
        "propose-revoke",
        "confirm-revoke",
        "rotate-key",
        "propose-threshold",
        "confirm-threshold",
        "fork",
        "merge",
        "dispute",
        "wind-down",
      ]) {
        expect(isValidEventType(t)).toBe(true);
      }
    });

    it("rejects unknown event types", () => {
      expect(isValidEventType("frobnicate")).toBe(false);
      expect(isValidEventType("")).toBe(false);
      expect(isValidEventType(null)).toBe(false);
    });
  });

  describe("createGovernanceEvent", () => {
    it("produces a well-formed schema/v1 event with signature", () => {
      const keys = makeKeys();
      const ev = createGovernanceEvent({
        federationId: "fed-x",
        eventType: "create",
        actorMemberId: "alice",
        secretKey: keys.secretKey,
        publicKey: keys.publicKey,
        payload: {
          bootstrap_member_id: "alice",
          bootstrap_pubkey_id: keys.pubkeyId,
        },
      });
      expect(ev.schema).toBe(SCHEMA_GOVERNANCE);
      expect(ev.fed_id).toBe("fed-x");
      expect(ev.event_type).toBe("create");
      expect(ev.actor_member_id).toBe("alice");
      expect(ev.signature.alg).toBe("Ed25519");
      expect(ev.signature.key_id).toBe(keys.pubkeyId);
      expect(typeof ev.signature.value).toBe("string");
      expect(typeof ev.event_id).toBe("string");
      expect(ev.event_id.length).toBeGreaterThanOrEqual(36);
    });

    it("rejects unknown eventType", () => {
      const keys = makeKeys();
      expect(() =>
        createGovernanceEvent({
          federationId: "fed-x",
          eventType: "evil",
          actorMemberId: "alice",
          secretKey: keys.secretKey,
          publicKey: keys.publicKey,
        }),
      ).toThrow(/eventType must be/);
    });

    it("rejects missing federationId / actorMemberId / keys", () => {
      const keys = makeKeys();
      expect(() =>
        createGovernanceEvent({
          eventType: "create",
          actorMemberId: "a",
          secretKey: keys.secretKey,
          publicKey: keys.publicKey,
        }),
      ).toThrow(/federationId/);
      expect(() =>
        createGovernanceEvent({
          federationId: "f",
          eventType: "create",
          secretKey: keys.secretKey,
          publicKey: keys.publicKey,
        }),
      ).toThrow(/actorMemberId/);
      expect(() =>
        createGovernanceEvent({
          federationId: "f",
          eventType: "create",
          actorMemberId: "a",
        }),
      ).toThrow(/secretKey/);
    });
  });

  describe("verifyGovernanceEvent", () => {
    it("verifies a self-signed event", () => {
      const keys = makeKeys();
      const ev = createGovernanceEvent({
        federationId: "fed-1",
        eventType: "leave",
        actorMemberId: "bob",
        secretKey: keys.secretKey,
        publicKey: keys.publicKey,
      });
      const r = verifyGovernanceEvent(ev, { publicKey: keys.publicKey });
      expect(r.ok).toBe(true);
    });

    it("rejects tampered payload", () => {
      const keys = makeKeys();
      const ev = createGovernanceEvent({
        federationId: "fed-1",
        eventType: "leave",
        actorMemberId: "bob",
        secretKey: keys.secretKey,
        publicKey: keys.publicKey,
      });
      ev.payload = { evil: true };
      const r = verifyGovernanceEvent(ev, { publicKey: keys.publicKey });
      expect(r.ok).toBe(false);
      expect(r.code).toBe("BAD_SIGNATURE");
    });

    it("rejects wrong public key", () => {
      const keys = makeKeys();
      const otherKeys = makeKeys();
      const ev = createGovernanceEvent({
        federationId: "fed-1",
        eventType: "leave",
        actorMemberId: "bob",
        secretKey: keys.secretKey,
        publicKey: keys.publicKey,
      });
      const r = verifyGovernanceEvent(ev, { publicKey: otherKeys.publicKey });
      expect(r.ok).toBe(false);
    });

    it("rejects bad schema or missing fields", () => {
      const r1 = verifyGovernanceEvent({}, { publicKey: makeKeys().publicKey });
      expect(r1.ok).toBe(false);
      expect(r1.code).toBe("BAD_SCHEMA");
      const r2 = verifyGovernanceEvent(
        { schema: SCHEMA_GOVERNANCE, event_type: "create", fed_id: "f" },
        { publicKey: makeKeys().publicKey },
      );
      expect(r2.ok).toBe(false);
      expect(["BAD_SHAPE", "BAD_SIGNATURE"]).toContain(r2.code);
    });
  });

  describe("replayGovernanceLog", () => {
    function ev(overrides) {
      const keys = overrides.keys || makeKeys();
      return createGovernanceEvent({
        federationId: overrides.fed || "fed-test",
        eventType: overrides.eventType,
        actorMemberId: overrides.actor || "alice",
        secretKey: keys.secretKey,
        publicKey: keys.publicKey,
        payload: overrides.payload || {},
        issuedAt: overrides.issuedAt,
      });
    }

    it("returns bootstrap state for empty log", () => {
      const s = replayGovernanceLog([], "fed-x");
      expect(s.status).toBe("bootstrap");
      expect(s.threshold).toBe(1);
      expect(s.members).toEqual([]);
    });

    it("create initializes the federation with bootstrap member", () => {
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: "sha256:alice-pk",
            initial_threshold: 1,
          },
        }),
      ];
      const s = replayGovernanceLog(log, "fed-test");
      expect(s.members).toHaveLength(1);
      expect(s.members[0].member_id).toBe("alice");
      expect(s.members[0].weight).toBe(1);
      expect(s.threshold).toBe(1);
    });

    it("invite + threshold votes promotes to candidate (weight 0.5)", () => {
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: "sha256:a",
            initial_threshold: 1,
          },
        }),
        ev({
          eventType: "invite",
          actor: "alice",
          payload: {
            candidate_member_id: "bob",
            candidate_pubkey_id: "sha256:bob-pk",
          },
        }),
        ev({
          eventType: "vote",
          actor: "alice",
          payload: {
            invite_target_member_id: "bob",
            decision: "approve",
          },
        }),
      ];
      const s = replayGovernanceLog(log, "fed-test");
      expect(s.members.find((m) => m.member_id === "bob")).toBeDefined();
      expect(s.members.find((m) => m.member_id === "bob").weight).toBe(0.5);
      expect(s.members.find((m) => m.member_id === "bob").status).toBe(
        "candidate",
      );
      expect(s.pending_invites).toHaveLength(0);
    });

    it("candidate auto-promotes to active after 30 days", () => {
      const t0 = Date.parse("2026-01-01T00:00:00Z");
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: "sha256:a",
            initial_threshold: 1,
          },
          issuedAt: new Date(t0).toISOString(),
        }),
        ev({
          eventType: "invite",
          actor: "alice",
          payload: { candidate_member_id: "bob", candidate_pubkey_id: "sha256:b" },
          issuedAt: new Date(t0 + 1000).toISOString(),
        }),
        ev({
          eventType: "vote",
          actor: "alice",
          payload: { invite_target_member_id: "bob", decision: "approve" },
          issuedAt: new Date(t0 + 2000).toISOString(),
        }),
      ];
      const future = t0 + 60 * 24 * 3600 * 1000; // 60 days later
      const s = replayGovernanceLog(log, "fed-test", { now: future });
      const bob = s.members.find((m) => m.member_id === "bob");
      expect(bob.status).toBe("active");
      expect(bob.weight).toBe(1);
    });

    it("leave removes member and archives key", () => {
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: "sha256:a",
          },
        }),
        ev({ eventType: "leave", actor: "alice" }),
      ];
      const s = replayGovernanceLog(log, "fed-test");
      expect(s.members).toHaveLength(0);
      expect(s.archived_keys).toContain("sha256:a");
    });

    it("propose-revoke + confirm-revoke removes member and marks key compromised", () => {
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: "sha256:a",
          },
        }),
        ev({
          eventType: "invite",
          actor: "alice",
          payload: { candidate_member_id: "bob", candidate_pubkey_id: "sha256:b" },
        }),
        ev({
          eventType: "vote",
          actor: "alice",
          payload: { invite_target_member_id: "bob", decision: "approve" },
        }),
        ev({
          eventType: "propose-revoke",
          actor: "alice",
          payload: { target_member_id: "bob", reason: "key-compromise" },
        }),
        ev({
          eventType: "confirm-revoke",
          actor: "alice",
          payload: { target_member_id: "bob", reason: "key-compromise" },
        }),
      ];
      const s = replayGovernanceLog(log, "fed-test");
      expect(s.members.find((m) => m.member_id === "bob")).toBeUndefined();
      expect(s.compromised_keys).toContain("sha256:b");
    });

    it("rotate-key swaps pubkey + archives old", () => {
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: "sha256:old",
          },
        }),
        ev({
          eventType: "rotate-key",
          actor: "alice",
          payload: { new_pubkey_id: "sha256:new" },
        }),
      ];
      const s = replayGovernanceLog(log, "fed-test");
      expect(s.members[0].pubkey_id).toBe("sha256:new");
      expect(s.archived_keys).toContain("sha256:old");
    });

    it("propose-threshold + confirm-threshold updates threshold", () => {
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: "sha256:a",
            initial_threshold: 1,
          },
        }),
        ev({
          eventType: "propose-threshold",
          actor: "alice",
          payload: { proposed_threshold: 3 },
        }),
      ];
      let s = replayGovernanceLog(log, "fed-test");
      expect(s.threshold).toBe(1); // not yet confirmed
      expect(s.pending_threshold.target).toBe(3);
      log.push(
        ev({ eventType: "confirm-threshold", actor: "alice", payload: {} }),
      );
      s = replayGovernanceLog(log, "fed-test");
      expect(s.threshold).toBe(3);
      expect(s.pending_threshold).toBeNull();
    });

    it("dispute + wind-down change status", () => {
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: "sha256:a",
          },
        }),
        ev({ eventType: "dispute", actor: "alice", payload: {} }),
      ];
      let s = replayGovernanceLog(log, "fed-test");
      expect(s.status).toBe("dispute");
      expect(s.dispute_deadline).toBeDefined();

      log.push(ev({ eventType: "wind-down", actor: "alice", payload: {} }));
      s = replayGovernanceLog(log, "fed-test");
      expect(s.status).toBe("wind-down");
    });

    it("fork removes the forked-out members and archives their keys", () => {
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: "sha256:a",
          },
        }),
        ev({
          eventType: "invite",
          actor: "alice",
          payload: { candidate_member_id: "bob", candidate_pubkey_id: "sha256:b" },
        }),
        ev({
          eventType: "vote",
          actor: "alice",
          payload: { invite_target_member_id: "bob", decision: "approve" },
        }),
        ev({
          eventType: "fork",
          actor: "bob",
          payload: { new_federation_id: "fed-fork", member_ids: ["bob"] },
        }),
      ];
      const s = replayGovernanceLog(log, "fed-test");
      expect(s.members.find((m) => m.member_id === "bob")).toBeUndefined();
      expect(s.archived_keys).toContain("sha256:b");
      expect(s.last_fork.new_federation_id).toBe("fed-fork");
    });

    it("ignores events for other federations", () => {
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: "sha256:a",
          },
        }),
        ev({
          fed: "OTHER-FED",
          eventType: "leave",
          actor: "alice",
        }),
      ];
      const s = replayGovernanceLog(log, "fed-test");
      expect(s.members).toHaveLength(1); // OTHER-FED leave didn't touch fed-test
    });
  });

  describe("dedupeEventsByEventId", () => {
    it("returns empty array for non-array input", () => {
      expect(dedupeEventsByEventId(null)).toEqual([]);
      expect(dedupeEventsByEventId(undefined)).toEqual([]);
    });

    it("dedupes by event_id keeping first occurrence", () => {
      const events = [
        { event_id: "a", x: 1 },
        { event_id: "b", x: 2 },
        { event_id: "a", x: 999 }, // duplicate
        { event_id: "c", x: 3 },
      ];
      const out = dedupeEventsByEventId(events);
      expect(out).toHaveLength(3);
      expect(out.map((e) => e.event_id)).toEqual(["a", "b", "c"]);
      expect(out[0].x).toBe(1); // first kept, not 999
    });

    it("skips events without string event_id", () => {
      const events = [
        { event_id: "a" },
        { event_id: 42 },
        { something: "else" },
        { event_id: "b" },
      ];
      expect(dedupeEventsByEventId(events).map((e) => e.event_id)).toEqual([
        "a",
        "b",
      ]);
    });
  });

  describe("sortEventsChronologically", () => {
    it("sorts by issued_at ascending", () => {
      const events = [
        { event_id: "c", issued_at: "2026-05-03T00:00:00Z" },
        { event_id: "a", issued_at: "2026-05-01T00:00:00Z" },
        { event_id: "b", issued_at: "2026-05-02T00:00:00Z" },
      ];
      expect(
        sortEventsChronologically(events).map((e) => e.event_id),
      ).toEqual(["a", "b", "c"]);
    });

    it("breaks ties by event_id", () => {
      const events = [
        { event_id: "z", issued_at: "2026-05-01T00:00:00Z" },
        { event_id: "a", issued_at: "2026-05-01T00:00:00Z" },
      ];
      expect(
        sortEventsChronologically(events).map((e) => e.event_id),
      ).toEqual(["a", "z"]);
    });

    it("does not mutate input", () => {
      const events = [
        { event_id: "b", issued_at: "2026-05-02T00:00:00Z" },
        { event_id: "a", issued_at: "2026-05-01T00:00:00Z" },
      ];
      const before = events.map((e) => e.event_id).join(",");
      sortEventsChronologically(events);
      expect(events.map((e) => e.event_id).join(",")).toBe(before);
    });
  });

  describe("verifyGovernanceLog", () => {
    function makeKeys() {
      return ed25519.generateKeyPair();
    }

    it("classifies events into valid/invalid/unknown", () => {
      const aliceKeys = makeKeys();
      const bobKeys = makeKeys();
      const evAlice = createGovernanceEvent({
        federationId: "fed-1",
        eventType: "leave",
        actorMemberId: "alice",
        secretKey: aliceKeys.secretKey,
        publicKey: aliceKeys.publicKey,
      });
      const evBob = createGovernanceEvent({
        federationId: "fed-1",
        eventType: "leave",
        actorMemberId: "bob",
        secretKey: bobKeys.secretKey,
        publicKey: bobKeys.publicKey,
      });
      // Tamper bob's payload to break signature
      const evBobTampered = { ...evBob, payload: { evil: true } };
      // Unknown signer
      const evGhost = createGovernanceEvent({
        federationId: "fed-1",
        eventType: "leave",
        actorMemberId: "ghost",
        secretKey: makeKeys().secretKey,
        publicKey: makeKeys().publicKey,
      });

      const lookup = (actor) => {
        if (actor === "alice") return aliceKeys.publicKey;
        if (actor === "bob") return bobKeys.publicKey;
        return null;
      };

      const result = verifyGovernanceLog(
        [evAlice, evBobTampered, evGhost],
        lookup,
      );
      expect(result.valid).toHaveLength(1);
      expect(result.valid[0].actor_member_id).toBe("alice");
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0].event.actor_member_id).toBe("bob");
      expect(result.unknown).toHaveLength(1);
      expect(result.unknown[0].event.actor_member_id).toBe("ghost");
    });

    it("treats getPublicKey throw as unknown signer", () => {
      const keys = makeKeys();
      const ev1 = createGovernanceEvent({
        federationId: "fed-1",
        eventType: "leave",
        actorMemberId: "alice",
        secretKey: keys.secretKey,
        publicKey: keys.publicKey,
      });
      const result = verifyGovernanceLog([ev1], () => {
        throw new Error("registry corrupt");
      });
      expect(result.unknown).toHaveLength(1);
      expect(result.unknown[0].reason).toBe("UNKNOWN_KEY");
    });
  });
});
