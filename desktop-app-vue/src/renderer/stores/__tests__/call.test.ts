/**
 * useCallStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: isInCall / hasIncomingCall / connectedParticipants /
 *    participantCount / isVideoCall / hostParticipant / qualityLevelText /
 *    formattedDuration
 *  - Pure actions: setIncomingCall / updateQuality / updateParticipant /
 *    addParticipant / incrementDuration / handleRoomEnded / _resetCallState
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useCallStore } from "../call";
import type { CallParticipant } from "../call";

function makeParticipant(
  overrides: Partial<CallParticipant> = {},
): CallParticipant {
  return {
    participantDid: "did:test:p1",
    status: "connected",
    role: "participant",
    ...overrides,
  } as CallParticipant;
}

describe("useCallStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts idle with audio+video enabled and zero duration", () => {
      const store = useCallStore();
      expect(store.activeCall).toBeNull();
      expect(store.incomingCall).toBeNull();
      expect(store.participants).toEqual([]);
      expect(store.audioEnabled).toBe(true);
      expect(store.videoEnabled).toBe(true);
      expect(store.screenSharing).toBe(false);
      expect(store.callQuality).toBeNull();
      expect(store.callDuration).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("isInCall is true only for an active call", () => {
      const store = useCallStore();
      expect(store.isInCall).toBe(false);
      store.activeCall = { status: "active", type: "video" } as any;
      expect(store.isInCall).toBe(true);
      store.activeCall = { status: "ended", type: "video" } as any;
      expect(store.isInCall).toBe(false);
    });

    it("hasIncomingCall reflects incomingCall presence", () => {
      const store = useCallStore();
      expect(store.hasIncomingCall).toBe(false);
      store.incomingCall = { callId: "c1" } as any;
      expect(store.hasIncomingCall).toBe(true);
    });

    it("connectedParticipants + participantCount only count connected", () => {
      const store = useCallStore();
      store.participants = [
        makeParticipant({ participantDid: "a", status: "connected" }),
        makeParticipant({ participantDid: "b", status: "ringing" }),
        makeParticipant({ participantDid: "c", status: "left" }),
        makeParticipant({ participantDid: "d", status: "connected" }),
      ];
      expect(store.connectedParticipants.map((p) => p.participantDid)).toEqual([
        "a",
        "d",
      ]);
      expect(store.participantCount).toBe(2);
    });

    it("isVideoCall is true only for a video active call", () => {
      const store = useCallStore();
      expect(store.isVideoCall).toBe(false); // no active call
      store.activeCall = { status: "active", type: "voice" } as any;
      expect(store.isVideoCall).toBe(false);
      store.activeCall = { status: "active", type: "video" } as any;
      expect(store.isVideoCall).toBe(true);
    });

    it("hostParticipant finds the host", () => {
      const store = useCallStore();
      store.participants = [
        makeParticipant({ participantDid: "a", role: "participant" }),
        makeParticipant({ participantDid: "h", role: "host" }),
      ];
      expect(store.hostParticipant?.participantDid).toBe("h");
    });

    it("qualityLevelText maps level to a label, empty when no quality", () => {
      const store = useCallStore();
      expect(store.qualityLevelText).toBe("");
      store.callQuality = { level: "excellent" } as any;
      expect(store.qualityLevelText).toBe("Excellent");
      store.callQuality = { level: "poor" } as any;
      expect(store.qualityLevelText).toBe("Poor");
    });

    it("formattedDuration renders MM:SS zero-padded", () => {
      const store = useCallStore();
      expect(store.formattedDuration).toBe("00:00");
      store.callDuration = 5;
      expect(store.formattedDuration).toBe("00:05");
      store.callDuration = 65;
      expect(store.formattedDuration).toBe("01:05");
      store.callDuration = 3599;
      expect(store.formattedDuration).toBe("59:59");
    });
  });

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  describe("actions", () => {
    it("setIncomingCall + updateQuality set their state", () => {
      const store = useCallStore();
      store.setIncomingCall({ callId: "c1" } as any);
      expect(store.incomingCall).toEqual({ callId: "c1" });
      store.updateQuality({ level: "good" } as any);
      expect(store.callQuality).toEqual({ level: "good" });
    });

    it("updateParticipant sets status, stamping leftAt when leaving", () => {
      const store = useCallStore();
      store.participants = [
        makeParticipant({ participantDid: "a", status: "connected" }),
      ];
      store.updateParticipant("a", "left");
      expect(store.participants[0].status).toBe("left");
      expect(typeof store.participants[0].leftAt).toBe("number");
    });

    it("updateParticipant is a no-op for an unknown participant", () => {
      const store = useCallStore();
      store.participants = [
        makeParticipant({ participantDid: "a", status: "connected" }),
      ];
      store.updateParticipant("missing", "left");
      expect(store.participants[0].status).toBe("connected");
    });

    it("addParticipant appends new and merges existing by did", () => {
      const store = useCallStore();
      store.addParticipant(
        makeParticipant({ participantDid: "a", status: "ringing" }),
      );
      expect(store.participants).toHaveLength(1);
      // same did → merge (update status), not duplicate
      store.addParticipant(
        makeParticipant({ participantDid: "a", status: "connected" }),
      );
      expect(store.participants).toHaveLength(1);
      expect(store.participants[0].status).toBe("connected");
      // different did → append
      store.addParticipant(makeParticipant({ participantDid: "b" }));
      expect(store.participants).toHaveLength(2);
    });

    it("incrementDuration adds one second", () => {
      const store = useCallStore();
      store.incrementDuration();
      store.incrementDuration();
      expect(store.callDuration).toBe(2);
    });

    it("handleRoomEnded / _resetCallState restore call defaults", () => {
      const store = useCallStore();
      store.activeCall = { status: "active", type: "video" } as any;
      store.participants = [makeParticipant()];
      store.audioEnabled = false;
      store.screenSharing = true;
      store.callQuality = { level: "poor" } as any;
      store.callDuration = 42;
      store.handleRoomEnded();
      expect(store.activeCall).toBeNull();
      expect(store.participants).toEqual([]);
      expect(store.audioEnabled).toBe(true);
      expect(store.screenSharing).toBe(false);
      expect(store.callQuality).toBeNull();
      expect(store.callDuration).toBe(0);
    });
  });
});
