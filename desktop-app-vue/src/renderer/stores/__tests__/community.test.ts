/**
 * useCommunityStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: ownedCommunities / currentMemberCount / pinnedMessages /
 *    activeProposals / pendingReports / isAdminOrOwner / isModeratorOrAbove
 *  - Pure action: resetState
 *
 * ipcRenderer built at MODULE LOAD via createRetryableIPC from "../utils/ipc"
 * (= renderer/utils/ipc); from stores/__tests__/ that's "../../utils/ipc".
 * vi.hoisted avoids the TDZ. (See memory vitest-vimock-path-relative-to-testfile.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock("../../utils/ipc", () => ({
  createRetryableIPC: () => ({ invoke: mockInvoke }),
}));

import { useCommunityStore } from "../community";
import type {
  Community,
  ChannelMessage,
  Proposal,
  ModerationReport,
} from "../community";

type Role = Community["my_role"];

function community(
  id: string,
  my_role: Role,
  overrides: Partial<Community> = {},
): Community {
  return {
    id,
    name: `Community ${id}`,
    description: "",
    icon_url: "",
    rules_md: "",
    creator_did: "did:me",
    member_limit: 100,
    member_count: 0,
    status: "active",
    my_role,
    created_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  };
}

function message(id: string, is_pinned: number): ChannelMessage {
  return {
    id,
    channel_id: "ch1",
    sender_did: "did:me",
    content: "hi",
    message_type: "text",
    reply_to: null,
    is_pinned,
    reactions: {},
    created_at: 1700000000000,
    updated_at: 1700000000000,
  };
}

function proposal(id: string, status: Proposal["status"]): Proposal {
  return {
    id,
    community_id: "c1",
    proposer_did: "did:me",
    title: `P ${id}`,
    description: "",
    proposal_type: "other",
    status,
    discussion_end: 0,
    voting_end: 0,
    created_at: 1700000000000,
    updated_at: 1700000000000,
  };
}

function report(
  id: string,
  status: ModerationReport["status"],
): ModerationReport {
  return {
    id,
    community_id: "c1",
    content_id: "m1",
    content_type: "message",
    reporter_did: "did:me",
    moderator_did: null,
    action: null,
    reason: "spam",
    ai_score: null,
    status,
    created_at: 1700000000000,
    resolved_at: null,
  };
}

describe("useCommunityStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useCommunityStore();
      expect(store.communities).toEqual([]);
      expect(store.currentCommunity).toBeNull();
      expect(store.channelMessages).toEqual([]);
      expect(store.proposals).toEqual([]);
      expect(store.moderationLog).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("ownedCommunities filters my_role === 'owner'", () => {
      const store = useCommunityStore();
      store.communities = [
        community("a", "owner"),
        community("b", "member"),
        community("c", "owner"),
      ];
      expect(store.ownedCommunities.map((c) => c.id)).toEqual(["a", "c"]);
    });

    it("currentMemberCount reads currentCommunity, defaulting to 0", () => {
      const store = useCommunityStore();
      expect(store.currentMemberCount).toBe(0);
      store.currentCommunity = community("a", "owner", { member_count: 17 });
      expect(store.currentMemberCount).toBe(17);
    });

    it("pinnedMessages filters is_pinned === 1", () => {
      const store = useCommunityStore();
      store.channelMessages = [
        message("m1", 1),
        message("m2", 0),
        message("m3", 1),
      ];
      expect(store.pinnedMessages.map((m) => m.id)).toEqual(["m1", "m3"]);
    });

    it("activeProposals includes discussion + voting", () => {
      const store = useCommunityStore();
      store.proposals = [
        proposal("p1", "discussion"),
        proposal("p2", "voting"),
        proposal("p3", "passed"),
        proposal("p4", "rejected"),
      ];
      expect(store.activeProposals.map((p) => p.id)).toEqual(["p1", "p2"]);
    });

    it("pendingReports filters status === 'pending'", () => {
      const store = useCommunityStore();
      store.moderationLog = [
        report("r1", "pending"),
        report("r2", "resolved"),
        report("r3", "pending"),
      ];
      expect(store.pendingReports.map((r) => r.id)).toEqual(["r1", "r3"]);
    });

    it("isAdminOrOwner / isModeratorOrAbove follow role hierarchy", () => {
      const store = useCommunityStore();
      const check = (role: Role) => {
        store.currentCommunity = community("a", role);
        return { admin: store.isAdminOrOwner, mod: store.isModeratorOrAbove };
      };
      expect(check("owner")).toEqual({ admin: true, mod: true });
      expect(check("admin")).toEqual({ admin: true, mod: true });
      expect(check("moderator")).toEqual({ admin: false, mod: true });
      expect(check("member")).toEqual({ admin: false, mod: false });
    });

    it("role getters are false with no current community", () => {
      const store = useCommunityStore();
      expect(store.isAdminOrOwner).toBe(false);
      expect(store.isModeratorOrAbove).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // resetState
  // -------------------------------------------------------------------------

  describe("resetState", () => {
    it("clears all collections + flags", () => {
      const store = useCommunityStore();
      store.communities = [community("a", "owner")];
      store.currentCommunity = community("a", "owner");
      store.channelMessages = [message("m1", 1)];
      store.proposals = [proposal("p1", "voting")];
      store.loading = true;
      store.resetState();
      expect(store.communities).toEqual([]);
      expect(store.currentCommunity).toBeNull();
      expect(store.channelMessages).toEqual([]);
      expect(store.proposals).toEqual([]);
      expect(store.loading).toBe(false);
    });
  });
});
