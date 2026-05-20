"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
  SCHEMA_CROSS_FED_TRUST_ANCHOR,
  createCrossFederationTrustAnchor,
  validateCrossFederationTrustAnchor,
  auditGovernanceLog,
  SCHEMA_GOVERNANCE_ANCHOR,
  computeGovernanceSnapshotHash,
  buildGovernanceAnchorRecord,
  verifyGovernanceAnchor,
  InMemoryChainAnchorClient,
  FilesystemChainAnchorClient,
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

  describe("v0.10 multi-proposal conflict resolution", () => {
    function ev(overrides) {
      const keys = overrides.keys || ed25519.generateKeyPair();
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

    it("two concurrent propose-threshold events both kept in pending_thresholds", () => {
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
        ev({
          eventType: "propose-threshold",
          actor: "alice",
          payload: { proposed_threshold: 5 },
        }),
      ];
      const s = replayGovernanceLog(log, "fed-test");
      expect(s.pending_thresholds).toHaveLength(2);
      expect(s.pending_thresholds.map((p) => p.target).sort()).toEqual([3, 5]);
      // back-compat: pending_threshold = most recent
      expect(s.pending_threshold.target).toBe(5);
    });

    it("confirm-threshold without proposal_event_id applies the most recent", () => {
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
        ev({
          eventType: "propose-threshold",
          actor: "alice",
          payload: { proposed_threshold: 5 },
        }),
        ev({ eventType: "confirm-threshold", actor: "alice", payload: {} }),
      ];
      const s = replayGovernanceLog(log, "fed-test");
      expect(s.threshold).toBe(5); // most recent wins
      expect(s.pending_thresholds).toHaveLength(0); // all cleared
    });

    it("confirm-threshold with proposal_event_id picks the specific proposal", () => {
      const propose3 = ev({
        eventType: "propose-threshold",
        actor: "alice",
        payload: { proposed_threshold: 3 },
      });
      const propose5 = ev({
        eventType: "propose-threshold",
        actor: "alice",
        payload: { proposed_threshold: 5 },
      });
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
        propose3,
        propose5,
        ev({
          eventType: "confirm-threshold",
          actor: "alice",
          payload: { proposal_event_id: propose3.event_id },
        }),
      ];
      const s = replayGovernanceLog(log, "fed-test");
      expect(s.threshold).toBe(3); // explicit choice, NOT most-recent
      expect(s.pending_thresholds).toHaveLength(0);
    });

    it("confirm-threshold with unknown proposal_event_id is a no-op", () => {
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
        ev({
          eventType: "confirm-threshold",
          actor: "alice",
          payload: { proposal_event_id: "nonexistent-uuid" },
        }),
      ];
      const s = replayGovernanceLog(log, "fed-test");
      expect(s.threshold).toBe(1); // unchanged
      expect(s.pending_thresholds).toHaveLength(1); // still open
    });

    it("multiple propose-revoke for same target both kept in pending_revokes_all", () => {
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
          payload: { target_member_id: "bob", reason: "inactive" },
        }),
        ev({
          eventType: "propose-revoke",
          actor: "alice",
          payload: { target_member_id: "bob", reason: "key-compromise" },
        }),
      ];
      const s = replayGovernanceLog(log, "fed-test");
      expect(s.pending_revokes_all).toHaveLength(2);
      expect(s.pending_revokes_all.map((r) => r.reason).sort()).toEqual([
        "inactive",
        "key-compromise",
      ]);
      // back-compat: pending_revokes (per-target) keeps the most recent
      expect(s.pending_revokes).toHaveLength(1);
    });

    it("confirm-revoke clears ALL pending_revokes_all entries for that target", () => {
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
          payload: { target_member_id: "bob", reason: "inactive" },
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
      expect(s.pending_revokes_all).toHaveLength(0);
      expect(s.members.find((m) => m.member_id === "bob")).toBeUndefined();
      expect(s.compromised_keys).toContain("sha256:b");
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

  describe("v0.3 cross-federation trust anchor", () => {
    function makeRoster(n) {
      return Array.from({ length: n }, (_, i) => ({
        member_id: `m${i + 1}`,
        pubkey_id: `sha256:m${i + 1}`,
        alg: "ed25519",
      }));
    }

    it("createCrossFederationTrustAnchor builds a well-formed v1 record", () => {
      const a = createCrossFederationTrustAnchor({
        host_federation_id: "host-fed",
        trusted_federation_id: "trusted-fed",
        member_roster_snapshot: makeRoster(3),
        threshold: 2,
      });
      expect(a.schema).toBe(SCHEMA_CROSS_FED_TRUST_ANCHOR);
      expect(a.host_federation_id).toBe("host-fed");
      expect(a.trusted_federation_id).toBe("trusted-fed");
      expect(a.member_roster_snapshot).toHaveLength(3);
      expect(a.threshold).toBe(2);
      expect(a.accepted_kinds).toEqual(["did", "skill", "bridge", "audit"]);
      expect(a.expires_at).toBeDefined();
    });

    it("rejects same host + trusted federation", () => {
      expect(() =>
        createCrossFederationTrustAnchor({
          host_federation_id: "f",
          trusted_federation_id: "f",
          member_roster_snapshot: makeRoster(1),
          threshold: 1,
        }),
      ).toThrow(/must differ/);
    });

    it("rejects out-of-bounds threshold", () => {
      expect(() =>
        createCrossFederationTrustAnchor({
          host_federation_id: "a",
          trusted_federation_id: "b",
          member_roster_snapshot: makeRoster(3),
          threshold: 4,
        }),
      ).toThrow(/threshold/);
    });

    it("validate accepts a freshly-created anchor", () => {
      const a = createCrossFederationTrustAnchor({
        host_federation_id: "a",
        trusted_federation_id: "b",
        member_roster_snapshot: makeRoster(2),
        threshold: 1,
      });
      const r = validateCrossFederationTrustAnchor(a);
      expect(r.ok).toBe(true);
    });

    it("validate flags expired anchor", () => {
      const a = createCrossFederationTrustAnchor({
        host_federation_id: "a",
        trusted_federation_id: "b",
        member_roster_snapshot: makeRoster(1),
        threshold: 1,
        expires_at: "2020-01-01T00:00:00Z",
      });
      const r = validateCrossFederationTrustAnchor(a);
      expect(r.ok).toBe(false);
      expect(r.code).toBe("EXPIRED");
    });

    it("validate flags bad schema/shape", () => {
      expect(validateCrossFederationTrustAnchor(null).code).toBe("BAD_SHAPE");
      expect(
        validateCrossFederationTrustAnchor({ schema: "wrong" }).code,
      ).toBe("BAD_SCHEMA");
    });
  });

  describe("v0.3 auditGovernanceLog (offline auditor)", () => {
    function ev(overrides) {
      const keys = overrides.keys || ed25519.generateKeyPair();
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

    it("clean log: no findings + ok=true", () => {
      const aliceKeys = ed25519.generateKeyPair();
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          keys: aliceKeys,
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: aliceKeys.pubkeyId,
          },
        }),
        ev({
          eventType: "leave",
          actor: "alice",
          keys: aliceKeys,
        }),
      ];
      const r = auditGovernanceLog(log, "fed-test");
      expect(r.ok).toBe(true);
      expect(r.findings).toHaveLength(0);
      expect(r.events_count).toBe(2);
    });

    it("flags UNKNOWN_ACTOR when an event's actor isn't in the roster", () => {
      const aliceKeys = ed25519.generateKeyPair();
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          keys: aliceKeys,
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: aliceKeys.pubkeyId,
          },
        }),
        ev({ eventType: "leave", actor: "ghost" }),
      ];
      const r = auditGovernanceLog(log, "fed-test");
      expect(r.ok).toBe(false);
      const f = r.findings.find((x) => x.code === "UNKNOWN_ACTOR");
      expect(f).toBeDefined();
    });

    it("flags ACTOR_KEY_MISMATCH when signature key_id != recorded pubkey_id", () => {
      const aliceKeys = ed25519.generateKeyPair();
      const otherKeys = ed25519.generateKeyPair();
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          keys: aliceKeys,
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: aliceKeys.pubkeyId,
          },
        }),
        // alice "leave" event signed by a DIFFERENT key — auditor catches it
        ev({ eventType: "leave", actor: "alice", keys: otherKeys }),
      ];
      const r = auditGovernanceLog(log, "fed-test");
      const f = r.findings.find((x) => x.code === "ACTOR_KEY_MISMATCH");
      expect(f).toBeDefined();
      expect(r.ok).toBe(false);
    });

    it("flags BOOTSTRAP_KEY_MISMATCH if create payload claims a different pubkey_id than the signer", () => {
      const aliceKeys = ed25519.generateKeyPair();
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          keys: aliceKeys,
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: "sha256:wrong-claim",
          },
        }),
      ];
      const r = auditGovernanceLog(log, "fed-test");
      const f = r.findings.find((x) => x.code === "BOOTSTRAP_KEY_MISMATCH");
      expect(f).toBeDefined();
      expect(r.ok).toBe(false);
    });

    it("flags OUT_OF_ORDER (warn) when issued_at decreases between events", () => {
      const aliceKeys = ed25519.generateKeyPair();
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          keys: aliceKeys,
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: aliceKeys.pubkeyId,
          },
          issuedAt: "2026-05-03T10:00:00Z",
        }),
        // Earlier timestamp than create — flagged as warn (not error)
        ev({
          eventType: "leave",
          actor: "alice",
          keys: aliceKeys,
          issuedAt: "2026-05-01T00:00:00Z",
        }),
      ];
      const r = auditGovernanceLog(log, "fed-test");
      const f = r.findings.find((x) => x.code === "OUT_OF_ORDER");
      expect(f).toBeDefined();
      expect(f.severity).toBe("warn");
      expect(r.ok).toBe(true); // warn doesn't break ok
    });

    it("includes final_state from replay", () => {
      const aliceKeys = ed25519.generateKeyPair();
      const log = [
        ev({
          eventType: "create",
          actor: "alice",
          keys: aliceKeys,
          payload: {
            bootstrap_member_id: "alice",
            bootstrap_pubkey_id: aliceKeys.pubkeyId,
            initial_threshold: 1,
          },
        }),
      ];
      const r = auditGovernanceLog(log, "fed-test");
      expect(r.final_state).toBeDefined();
      expect(r.final_state.federation_id).toBe("fed-test");
      expect(r.final_state.members).toHaveLength(1);
    });
  });

  describe("v0.3 #2 on-chain governance anchor (Q-COMP-3 unlocked)", () => {
    function makeEv(fedId, eventId, issuedAt) {
      return {
        schema: SCHEMA_GOVERNANCE,
        fed_id: fedId,
        event_type: "leave",
        event_id: eventId,
        issued_at: issuedAt,
        actor_member_id: "alice",
        payload: {},
        signature: { alg: "Ed25519", key_id: "k", value: "v" },
      };
    }

    describe("computeGovernanceSnapshotHash", () => {
      it("returns null fields for empty log", () => {
        const snap = computeGovernanceSnapshotHash([], "fed-x");
        expect(snap.events_count).toBe(0);
        expect(snap.last_event_id).toBeNull();
        expect(snap.event_id_chain_root).toBeNull();
        expect(snap.snapshot_hash).toBeDefined();
      });

      it("is deterministic for same events", () => {
        const events = [
          makeEv("fed-x", "ev-1", "2026-05-01T00:00:00Z"),
          makeEv("fed-x", "ev-2", "2026-05-02T00:00:00Z"),
        ];
        const a = computeGovernanceSnapshotHash(events, "fed-x");
        const b = computeGovernanceSnapshotHash([...events], "fed-x");
        expect(a.snapshot_hash).toBe(b.snapshot_hash);
      });

      it("is order-independent (sorts internally before hashing)", () => {
        const e1 = makeEv("fed-x", "ev-1", "2026-05-01T00:00:00Z");
        const e2 = makeEv("fed-x", "ev-2", "2026-05-02T00:00:00Z");
        const a = computeGovernanceSnapshotHash([e1, e2], "fed-x");
        const b = computeGovernanceSnapshotHash([e2, e1], "fed-x");
        expect(a.snapshot_hash).toBe(b.snapshot_hash);
      });

      it("ignores events from other federations", () => {
        const events = [
          makeEv("fed-x", "ev-1", "2026-05-01T00:00:00Z"),
          makeEv("OTHER", "ev-99", "2026-05-01T01:00:00Z"),
        ];
        const snap = computeGovernanceSnapshotHash(events, "fed-x");
        expect(snap.events_count).toBe(1);
      });

      it("changes hash when an event is added or modified", () => {
        const e1 = makeEv("fed-x", "ev-1", "2026-05-01T00:00:00Z");
        const a = computeGovernanceSnapshotHash([e1], "fed-x");
        const e2 = makeEv("fed-x", "ev-2", "2026-05-02T00:00:00Z");
        const b = computeGovernanceSnapshotHash([e1, e2], "fed-x");
        expect(a.snapshot_hash).not.toBe(b.snapshot_hash);
      });
    });

    describe("buildGovernanceAnchorRecord", () => {
      it("builds a v1 record with snapshot fields + actor", () => {
        const events = [makeEv("fed-x", "ev-1", "2026-05-01T00:00:00Z")];
        const r = buildGovernanceAnchorRecord(events, "fed-x", "alice");
        expect(r.schema).toBe(SCHEMA_GOVERNANCE_ANCHOR);
        expect(r.fed_id).toBe("fed-x");
        expect(r.snapshot_hash).toBeDefined();
        expect(r.events_count).toBe(1);
        expect(r.last_event_id).toBe("ev-1");
        expect(r.anchor_actor_member_id).toBe("alice");
      });

      it("rejects missing actor", () => {
        expect(() => buildGovernanceAnchorRecord([], "fed-x")).toThrow(
          /actorMemberId required/,
        );
      });
    });

    describe("InMemoryChainAnchorClient", () => {
      it("publishes + fetches anchors per fed", async () => {
        const client = new InMemoryChainAnchorClient();
        const events = [makeEv("fed-x", "ev-1", "2026-05-01T00:00:00Z")];
        const record = buildGovernanceAnchorRecord(events, "fed-x", "alice");
        const r = await client.publish(record);
        expect(r.tx_hash).toMatch(/^imem:fed-x:1$/);
        expect(r.block_height).toBe(1);
        const fetched = await client.fetchLatest("fed-x");
        expect(fetched.snapshot_hash).toBe(record.snapshot_hash);
      });

      it("isolates by fed_id", async () => {
        const client = new InMemoryChainAnchorClient();
        await client.publish(buildGovernanceAnchorRecord([], "fed-a", "alice"));
        await client.publish(buildGovernanceAnchorRecord([], "fed-b", "bob"));
        expect((await client.fetch("fed-a")).length).toBe(1);
        expect((await client.fetch("fed-b")).length).toBe(1);
        expect((await client.fetch("fed-c")).length).toBe(0);
      });

      it("health returns ok + chain name", async () => {
        const c = new InMemoryChainAnchorClient({ chainName: "test-chain" });
        const h = await c.health();
        expect(h.ok).toBe(true);
        expect(h.chain_name).toBe("test-chain");
      });
    });

    describe("FilesystemChainAnchorClient", () => {
      const fs = require("node:fs");
      const os = require("node:os");
      const path = require("node:path");
      let dir;
      beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-anchor-"));
      });
      afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
      });

      it("publishes + fetches via filesystem", async () => {
        const client = new FilesystemChainAnchorClient({ rootDir: dir });
        const events = [makeEv("fed-x", "ev-1", "2026-05-01T00:00:00Z")];
        const r = await client.publish(
          buildGovernanceAnchorRecord(events, "fed-x", "alice"),
        );
        expect(r.tx_hash).toBe("fs:fed-x:1");
        expect(r.block_height).toBe(1);
        const all = await client.fetch("fed-x");
        expect(all).toHaveLength(1);
      });

      it("requires rootDir", () => {
        expect(() => new FilesystemChainAnchorClient({})).toThrow(/rootDir/);
      });
    });

    // IChainAnchorClient interface conformance — both shipping clients must
    // satisfy the same contract documented at federation-governance.js JSDoc
    // `@typedef ChainAnchorClient`. A future ConsortiumChainClient
    // (Q-COMP-3 unblock — see memory `external_blocked_items_triggers.md`)
    // SHOULD be added to the cases array below and pass all of these checks.
    describe("IChainAnchorClient conformance contract", () => {
      const fs = require("node:fs");
      const os = require("node:os");
      const path = require("node:path");
      let tmpDir;
      beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-contract-"));
      });
      afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });

      const cases = [
        {
          name: "InMemoryChainAnchorClient",
          make: () => new InMemoryChainAnchorClient({ chainName: "imem-x" }),
        },
        {
          name: "FilesystemChainAnchorClient",
          make: () =>
            new FilesystemChainAnchorClient({
              rootDir: tmpDir,
              chainName: "fs-x",
            }),
        },
      ];

      for (const c of cases) {
        describe(c.name, () => {
          it("exposes the 4 async methods", () => {
            const client = c.make();
            expect(typeof client.publish).toBe("function");
            expect(typeof client.fetch).toBe("function");
            expect(typeof client.fetchLatest).toBe("function");
            expect(typeof client.health).toBe("function");
          });

          it("publish returns receipt with tx_hash + block_height + anchored_at", async () => {
            const client = c.make();
            const record = buildGovernanceAnchorRecord([], "fed-z", "alice");
            const receipt = await client.publish(record);
            expect(typeof receipt.tx_hash).toBe("string");
            expect(receipt.tx_hash.length).toBeGreaterThan(0);
            expect(Number.isInteger(receipt.block_height)).toBe(true);
            expect(receipt.block_height).toBeGreaterThan(0);
            expect(typeof receipt.anchored_at).toBe("string");
            expect(() => new Date(receipt.anchored_at).toISOString()).not.toThrow();
          });

          it("block_height is strictly increasing per fed_id", async () => {
            const client = c.make();
            const r1 = await client.publish(
              buildGovernanceAnchorRecord([], "fed-z", "alice"),
            );
            const r2 = await client.publish(
              buildGovernanceAnchorRecord([], "fed-z", "alice"),
            );
            const r3 = await client.publish(
              buildGovernanceAnchorRecord([], "fed-z", "alice"),
            );
            expect(r2.block_height).toBeGreaterThan(r1.block_height);
            expect(r3.block_height).toBeGreaterThan(r2.block_height);
          });

          it("fetch returns array oldest-first with chain_name + receipt fields merged", async () => {
            const client = c.make();
            await client.publish(buildGovernanceAnchorRecord([], "fed-z", "alice"));
            await client.publish(buildGovernanceAnchorRecord([], "fed-z", "alice"));
            const all = await client.fetch("fed-z");
            expect(Array.isArray(all)).toBe(true);
            expect(all.length).toBe(2);
            expect(all[0].block_height).toBeLessThan(all[1].block_height);
            for (const stored of all) {
              expect(stored.schema).toBe(SCHEMA_GOVERNANCE_ANCHOR);
              expect(stored.fed_id).toBe("fed-z");
              expect(typeof stored.tx_hash).toBe("string");
              expect(typeof stored.chain_name).toBe("string");
              expect(typeof stored.anchored_at).toBe("string");
            }
          });

          it("fetch returns empty array (not null) for unknown fed_id", async () => {
            const client = c.make();
            const out = await client.fetch("nonexistent-fed");
            expect(Array.isArray(out)).toBe(true);
            expect(out.length).toBe(0);
          });

          it("fetch honors opts.limit (last N)", async () => {
            const client = c.make();
            for (let i = 0; i < 5; i++) {
              await client.publish(
                buildGovernanceAnchorRecord([], "fed-z", "alice"),
              );
            }
            const last2 = await client.fetch("fed-z", { limit: 2 });
            expect(last2.length).toBe(2);
            const all = await client.fetch("fed-z");
            expect(last2[0].block_height).toBe(all[3].block_height);
            expect(last2[1].block_height).toBe(all[4].block_height);
          });

          it("fetchLatest returns null when empty, latest record otherwise", async () => {
            const client = c.make();
            expect(await client.fetchLatest("fed-z")).toBeNull();
            await client.publish(buildGovernanceAnchorRecord([], "fed-z", "alice"));
            const r2 = await client.publish(
              buildGovernanceAnchorRecord([], "fed-z", "alice"),
            );
            const latest = await client.fetchLatest("fed-z");
            expect(latest.block_height).toBe(r2.block_height);
          });

          it("health returns { ok: true, chain_name } reachable + matches publish chain_name", async () => {
            const client = c.make();
            const h = await client.health();
            expect(h.ok).toBe(true);
            expect(typeof h.chain_name).toBe("string");
            const receipt = await client.publish(
              buildGovernanceAnchorRecord([], "fed-z", "alice"),
            );
            const [stored] = await client.fetch("fed-z");
            expect(stored.chain_name).toBe(h.chain_name);
            // receipt itself doesn't carry chain_name, but stored record does
            expect(receipt.tx_hash).toBeTruthy();
          });

          it("isolates state by fed_id (no cross-leak)", async () => {
            const client = c.make();
            await client.publish(buildGovernanceAnchorRecord([], "fed-a", "alice"));
            await client.publish(buildGovernanceAnchorRecord([], "fed-b", "bob"));
            const a = await client.fetch("fed-a");
            const b = await client.fetch("fed-b");
            expect(a.length).toBe(1);
            expect(b.length).toBe(1);
            expect(a[0].fed_id).toBe("fed-a");
            expect(b[0].fed_id).toBe("fed-b");
          });
        });
      }
    });

    describe("verifyGovernanceAnchor", () => {
      it("ok when local hash matches anchored hash", () => {
        const events = [makeEv("fed-x", "ev-1", "2026-05-01T00:00:00Z")];
        const record = buildGovernanceAnchorRecord(events, "fed-x", "alice");
        const r = verifyGovernanceAnchor(record, events);
        expect(r.ok).toBe(true);
      });

      it("flags HASH_MISMATCH when local log diverges", () => {
        const eventsAtAnchor = [makeEv("fed-x", "ev-1", "2026-05-01T00:00:00Z")];
        const record = buildGovernanceAnchorRecord(
          eventsAtAnchor,
          "fed-x",
          "alice",
        );
        // Now local log has additional event AFTER anchoring
        const localLater = [
          ...eventsAtAnchor,
          makeEv("fed-x", "ev-2", "2026-05-02T00:00:00Z"),
        ];
        const r = verifyGovernanceAnchor(record, localLater);
        expect(r.ok).toBe(false);
        expect(r.code).toBe("HASH_MISMATCH");
        expect(r.drift.events_count_diff).toBe(1);
      });

      it("flags NO_ANCHOR for null/missing record", () => {
        expect(verifyGovernanceAnchor(null, []).code).toBe("NO_ANCHOR");
      });

      it("flags BAD_SCHEMA for wrong schema", () => {
        const r = verifyGovernanceAnchor({ schema: "wrong" }, []);
        expect(r.code).toBe("BAD_SCHEMA");
      });
    });
  });
});
