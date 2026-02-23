/**
 * Community + Channel Integration Tests
 *
 * Tests the combined flow of community management, channel messaging,
 * governance voting, and content moderation working together.
 *
 * All database access goes through stateful in-memory mocks so no native
 * better-sqlite3 binary is required.
 *
 * Scenarios covered:
 * 1. Community creation and membership (create, join, promote, ban)
 * 2. Channel messaging flow (send, receive, pin)
 * 3. Governance voting (proposal, vote weights, tally)
 * 4. Content moderation (analyze, report, retrieve log)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => {
  let counter = 0;
  return { v4: () => `uuid-${++counter}` };
});

// ---------------------------------------------------------------------------
// Stateful in-memory mock database
// ---------------------------------------------------------------------------

function createStatefulMockDatabase() {
  const communities = new Map();
  const communityMembers = new Map();  // "communityId:memberDid" → row
  const channels = new Map();
  const channelMessages = new Map();
  const governanceProposals = new Map();
  const governanceVotes = new Map();   // "proposalId:voterDid" → row
  const moderationLog = new Map();
  const contacts = new Map();          // did → { nickname }

  // ---- helpers ----

  function memberKey(communityId, did) {
    return `${communityId}:${did}`;
  }

  function voteKey(proposalId, did) {
    return `${proposalId}:${did}`;
  }

  function getActiveMember(communityId, did) {
    const m = communityMembers.get(memberKey(communityId, did));
    return m && m.status === "active" ? m : null;
  }

  // ---- sql-aware statement builder ----

  function makeStmt(sql) {
    return {
      run: vi.fn((...args) => {
        const flat = args.flat();

        // -- communities --
        if (sql.includes("INSERT INTO communities")) {
          const [id, name, description, iconUrl, rulesMd, creatorDid, memberLimit, memberCount, status, createdAt, updatedAt] = flat;
          communities.set(id, { id, name, description, icon_url: iconUrl, rules_md: rulesMd, creator_did: creatorDid, member_limit: memberLimit, member_count: memberCount, status, created_at: createdAt, updated_at: updatedAt });
          return { changes: 1 };
        }
        if (sql.includes("UPDATE communities SET member_count = member_count + 1")) {
          const [updatedAt, communityId] = flat;
          const c = communities.get(communityId);
          if (c) { c.member_count += 1; c.updated_at = updatedAt; }
          return { changes: 1 };
        }
        if (sql.includes("UPDATE communities SET member_count = MAX")) {
          const [updatedAt, communityId] = flat;
          const c = communities.get(communityId);
          if (c) { c.member_count = Math.max(c.member_count - 1, 0); c.updated_at = updatedAt; }
          return { changes: 1 };
        }

        // -- community_members --
        if (sql.includes("INSERT INTO community_members")) {
          const [id, communityId, memberDid, role, , status, joinedAt, updatedAt] = flat;
          const row = { id, community_id: communityId, member_did: memberDid, role, status, joined_at: joinedAt, updated_at: updatedAt };
          communityMembers.set(memberKey(communityId, memberDid), row);
          return { changes: 1 };
        }
        if (sql.includes("UPDATE community_members SET role =")) {
          const [role, updatedAt, memberId] = flat;
          for (const [, m] of communityMembers) {
            if (m.id === memberId) { m.role = role; m.updated_at = updatedAt; }
          }
          return { changes: 1 };
        }
        if (sql.includes("UPDATE community_members SET status =") && !sql.includes("role")) {
          const [status, updatedAt, memberId] = flat;
          for (const [, m] of communityMembers) {
            if (m.id === memberId) { m.status = status; m.updated_at = updatedAt; }
          }
          return { changes: 1 };
        }
        if (sql.includes("UPDATE community_members SET status = ?, role =")) {
          const [status, role, updatedAt, memberId] = flat;
          for (const [, m] of communityMembers) {
            if (m.id === memberId) { m.status = status; m.role = role; m.updated_at = updatedAt; }
          }
          return { changes: 1 };
        }

        // -- channels --
        if (sql.includes("INSERT INTO channels")) {
          const [id, communityId, name, description, type, sortOrder, createdAt, updatedAt] = flat;
          channels.set(id, { id, community_id: communityId, name, description, type, sort_order: sortOrder, created_at: createdAt, updated_at: updatedAt });
          return { changes: 1 };
        }
        if (sql.includes("UPDATE channels SET updated_at")) {
          const [updatedAt, channelId] = flat;
          const ch = channels.get(channelId);
          if (ch) ch.updated_at = updatedAt;
          return { changes: 1 };
        }

        // -- channel_messages --
        if (sql.includes("INSERT INTO channel_messages")) {
          const [id, channelId, senderDid, content, messageType, replyTo, isPinned, reactions, createdAt, updatedAt] = flat;
          channelMessages.set(id, { id, channel_id: channelId, sender_did: senderDid, content, message_type: messageType, reply_to: replyTo, is_pinned: isPinned, reactions, created_at: createdAt, updated_at: updatedAt });
          return { changes: 1 };
        }
        if (sql.includes("UPDATE channel_messages SET is_pinned = 1")) {
          const [updatedAt, messageId] = flat;
          const msg = channelMessages.get(messageId);
          if (msg) { msg.is_pinned = 1; msg.updated_at = updatedAt; }
          return { changes: 1 };
        }
        if (sql.includes("UPDATE channel_messages SET is_pinned = 0")) {
          const [updatedAt, messageId] = flat;
          const msg = channelMessages.get(messageId);
          if (msg) { msg.is_pinned = 0; msg.updated_at = updatedAt; }
          return { changes: 1 };
        }

        // -- governance_proposals --
        if (sql.includes("INSERT INTO governance_proposals")) {
          const [id, communityId, proposerDid, title, description, proposalType, status, discussionEnd, votingEnd, createdAt, updatedAt] = flat;
          governanceProposals.set(id, { id, community_id: communityId, proposer_did: proposerDid, title, description, proposal_type: proposalType, status, discussion_end: discussionEnd, voting_end: votingEnd, created_at: createdAt, updated_at: updatedAt });
          return { changes: 1 };
        }
        if (sql.includes("UPDATE governance_proposals SET status =")) {
          const [status, updatedAt, proposalId] = flat;
          const p = governanceProposals.get(proposalId);
          if (p) { p.status = status; p.updated_at = updatedAt; }
          return { changes: 1 };
        }

        // -- governance_votes --
        if (sql.includes("INSERT INTO governance_votes")) {
          const [id, proposalId, voterDid, vote, weight, createdAt] = flat;
          const row = { id, proposal_id: proposalId, voter_did: voterDid, vote, weight, created_at: createdAt };
          governanceVotes.set(voteKey(proposalId, voterDid), row);
          return { changes: 1 };
        }
        if (sql.includes("UPDATE governance_votes SET vote =")) {
          const [vote, weight, createdAt, voteId] = flat;
          for (const [, v] of governanceVotes) {
            if (v.id === voteId) { v.vote = vote; v.weight = weight; v.created_at = createdAt; }
          }
          return { changes: 1 };
        }

        // -- moderation_log --
        if (sql.includes("INSERT INTO moderation_log")) {
          const [id, communityId, contentId, contentType, reporterDid, moderatorDid, action, reason, aiScore, status, createdAt, resolvedAt] = flat;
          moderationLog.set(id, { id, community_id: communityId, content_id: contentId, content_type: contentType, reporter_did: reporterDid, moderator_did: moderatorDid, action, reason, ai_score: aiScore, status, created_at: createdAt, resolved_at: resolvedAt });
          return { changes: 1 };
        }
        if (sql.includes("UPDATE moderation_log")) {
          const [moderatorDid, action, reason, status, resolvedAt, reportId] = flat;
          const r = moderationLog.get(reportId);
          if (r) { r.moderator_did = moderatorDid; r.action = action; r.reason = reason; r.status = status; r.resolved_at = resolvedAt; }
          return { changes: 1 };
        }

        return { changes: 0 };
      }),

      get: vi.fn((...args) => {
        const flat = args.flat();

        if (sql.includes("SELECT * FROM communities WHERE id =")) {
          return communities.get(flat[0]) || null;
        }
        if (sql.includes("SELECT * FROM community_members WHERE community_id = ? AND member_did = ?")) {
          const [communityId, did] = flat;
          return communityMembers.get(memberKey(communityId, did)) || null;
        }
        if (sql.includes("SELECT role FROM community_members")) {
          const [communityId, did] = flat;
          const m = getActiveMember(communityId, did);
          return m ? { role: m.role } : null;
        }
        if (sql.includes("SELECT * FROM channels WHERE id =")) {
          return channels.get(flat[0]) || null;
        }
        if (sql.includes("SELECT * FROM channel_messages WHERE id =")) {
          return channelMessages.get(flat[0]) || null;
        }
        if (sql.includes("SELECT * FROM governance_proposals WHERE id =")) {
          return governanceProposals.get(flat[0]) || null;
        }
        if (sql.includes("SELECT * FROM governance_votes WHERE proposal_id = ? AND voter_did =")) {
          const [proposalId, voterDid] = flat;
          return governanceVotes.get(voteKey(proposalId, voterDid)) || null;
        }
        if (sql.includes("SELECT * FROM moderation_log WHERE content_id = ? AND reporter_did =")) {
          const [contentId, reporterDid] = flat;
          return [...moderationLog.values()].find(
            (r) => r.content_id === contentId && r.reporter_did === reporterDid && r.status !== "resolved",
          ) || null;
        }
        if (sql.includes("SELECT * FROM moderation_log WHERE id =")) {
          return moderationLog.get(flat[0]) || null;
        }

        return null;
      }),

      all: vi.fn((...args) => {
        const flat = args.flat();

        if (sql.includes("FROM community_members cm") && sql.includes("WHERE cm.community_id = ? AND cm.status = 'active'")) {
          const communityId = flat[0];
          return [...communityMembers.values()].filter(
            (m) => m.community_id === communityId && m.status === "active",
          );
        }
        if (sql.includes("FROM channel_messages cm") || (sql.includes("FROM channel_messages") && sql.includes("channel_id"))) {
          const channelId = flat[0];
          return [...channelMessages.values()]
            .filter((m) => m.channel_id === channelId)
            .map((m) => ({ ...m, reactions: m.reactions || "{}", sender_nickname: null }))
            .sort((a, b) => b.created_at - a.created_at);
        }
        if (sql.includes("FROM channel_messages") && sql.includes("is_pinned")) {
          const channelId = flat[0];
          return [...channelMessages.values()].filter(
            (m) => m.channel_id === channelId && m.is_pinned === 1,
          );
        }
        if (sql.includes("FROM governance_votes WHERE proposal_id =")) {
          const proposalId = flat[0];
          return [...governanceVotes.values()].filter((v) => v.proposal_id === proposalId);
        }
        if (sql.includes("FROM moderation_log ml") || sql.includes("FROM moderation_log WHERE community_id")) {
          const communityId = flat[0];
          return [...moderationLog.values()].filter((r) => r.community_id === communityId);
        }

        return [];
      }),
    };
  }

  const db = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => makeStmt(sql)),
    // expose stores for test assertions
    _communities: communities,
    _members: communityMembers,
    _channels: channels,
    _messages: channelMessages,
    _proposals: governanceProposals,
    _votes: governanceVotes,
    _moderationLog: moderationLog,
  };

  return {
    db,
    saveToFile: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Actor helpers – each actor has their own "current DID"
// ---------------------------------------------------------------------------

function makeDIDManager(did) {
  return { getCurrentIdentity: vi.fn(() => ({ did })) };
}

// ---------------------------------------------------------------------------
// Module factory helpers
// ---------------------------------------------------------------------------

async function buildCommunityManager(database, did, p2pManager = null) {
  const { CommunityManager } = await import("../../src/main/social/community-manager.js");
  const didManager = makeDIDManager(did);
  const mgr = new CommunityManager(database, didManager, p2pManager);
  mgr.initialized = true;
  await mgr.initializeTables();
  return { mgr, didManager };
}

async function buildChannelManager(database, did, p2pManager = null) {
  const { ChannelManager } = await import("../../src/main/social/channel-manager.js");
  const didManager = makeDIDManager(did);
  const mgr = new ChannelManager(database, didManager, p2pManager);
  mgr.initialized = true;
  await mgr.initializeTables();
  return { mgr, didManager };
}

async function buildGovernanceEngine(database, did, communityManager = null) {
  const { GovernanceEngine } = await import("../../src/main/social/governance-engine.js");
  const didManager = makeDIDManager(did);
  const engine = new GovernanceEngine(database, didManager, communityManager);
  engine.initialized = true;
  await engine.initializeTables();
  return { engine, didManager };
}

async function buildContentModerator(database, did) {
  const { ContentModerator } = await import("../../src/main/social/content-moderator.js");
  const didManager = makeDIDManager(did);
  const mod = new ContentModerator(database, didManager);
  mod.initialized = true;
  await mod.initializeTables();
  return { mod, didManager };
}

// ---------------------------------------------------------------------------
// Suite 1 – Community creation and membership
// ---------------------------------------------------------------------------

describe("Community Channels Integration – Community Membership", () => {
  const ALICE = "did:test:alice-cm";
  const BOB = "did:test:bob-cm";
  const CHARLIE = "did:test:charlie-cm";

  let database;
  let alice; // { mgr, didManager }
  let bob;

  beforeEach(async () => {
    vi.clearAllMocks();
    database = createStatefulMockDatabase();
    alice = await buildCommunityManager(database, ALICE);
    bob = await buildCommunityManager(database, BOB);
    // Share the same database object
    bob.mgr.database = alice.mgr.database;
  });

  afterEach(() => {
    alice.mgr.removeAllListeners();
    bob.mgr.removeAllListeners();
  });

  it("alice creates a community and is automatically the owner", async () => {
    const community = await alice.mgr.createCommunity({ name: "Test Community" });

    expect(community.id).toBeTruthy();
    expect(community.name).toBe("Test Community");
    expect(community.creator_did).toBe(ALICE);
    expect(community.member_count).toBe(1);
  });

  it("bob can join and getMembers returns both alice and bob", async () => {
    const community = await alice.mgr.createCommunity({ name: "Open Community" });

    // Bob joins
    bob.mgr.didManager.getCurrentIdentity.mockReturnValue({ did: BOB });
    await bob.mgr.joinCommunity(community.id, BOB);

    // Retrieve members using alice's manager (same DB)
    const members = await alice.mgr.getMembers(community.id);

    const dids = members.map((m) => m.member_did);
    expect(dids).toContain(ALICE);
    expect(dids).toContain(BOB);
  });

  it("alice promotes bob to moderator", async () => {
    const community = await alice.mgr.createCommunity({ name: "Promo Community" });
    await alice.mgr.joinCommunity(community.id, BOB);

    const result = await alice.mgr.promoteMember(community.id, BOB, "moderator");
    expect(result.success).toBe(true);

    const members = await alice.mgr.getMembers(community.id);
    const bobMember = members.find((m) => m.member_did === BOB);
    expect(bobMember).toBeDefined();
    expect(bobMember.role).toBe("moderator");
  });

  it("banning a non-member (charlie) throws an error about member not found", async () => {
    const community = await alice.mgr.createCommunity({ name: "Ban Test" });

    await expect(
      alice.mgr.banMember(community.id, CHARLIE),
    ).rejects.toThrow(/member not found|not found/i);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 – Channel messaging flow
// ---------------------------------------------------------------------------

describe("Community Channels Integration – Channel Messaging", () => {
  const ALICE = "did:test:alice-ch";
  const BOB = "did:test:bob-ch";

  let database;
  let communityId;
  let aliceChannelMgr;
  let bobChannelMgr;

  beforeEach(async () => {
    vi.clearAllMocks();
    database = createStatefulMockDatabase();

    // Create community so membership checks pass
    const { mgr: communityMgr } = await buildCommunityManager(database, ALICE);
    const community = await communityMgr.createCommunity({ name: "Channel Test" });
    communityId = community.id;
    // Add BOB as a member
    await communityMgr.joinCommunity(communityId, BOB);

    // Build channel managers
    ({ mgr: aliceChannelMgr } = await buildChannelManager(database, ALICE));
    ({ mgr: bobChannelMgr } = await buildChannelManager(database, BOB));
    // Share the same database reference
    bobChannelMgr.database = aliceChannelMgr.database;
  });

  afterEach(() => {
    aliceChannelMgr.removeAllListeners();
    bobChannelMgr.removeAllListeners();
  });

  it("alice (owner) creates a discussion channel", async () => {
    const channel = await aliceChannelMgr.createChannel({
      communityId,
      name: "general",
    });

    expect(channel.id).toBeTruthy();
    expect(channel.name).toBe("general");
    expect(channel.type).toBe("discussion");
    expect(channel.community_id).toBe(communityId);
  });

  it("alice and bob both send messages and getMessages returns both", async () => {
    const channel = await aliceChannelMgr.createChannel({
      communityId,
      name: "general",
    });

    const msgAlice = await aliceChannelMgr.sendMessage({
      channelId: channel.id,
      content: "Hello from Alice",
    });
    expect(msgAlice.id).toBeTruthy();

    const msgBob = await bobChannelMgr.sendMessage({
      channelId: channel.id,
      content: "Hello from Bob",
    });
    expect(msgBob.id).toBeTruthy();

    const messages = await aliceChannelMgr.getMessages(channel.id);
    const contents = messages.map((m) => m.content).filter((c) => c !== 'Channel "general" has been created');
    expect(contents).toContain("Hello from Alice");
    expect(contents).toContain("Hello from Bob");
  });

  it("alice (moderator+) can pin a message", async () => {
    const channel = await aliceChannelMgr.createChannel({
      communityId,
      name: "announcements",
      type: "announcement",
    });

    const msg = await aliceChannelMgr.sendMessage({
      channelId: channel.id,
      content: "Important announcement",
    });

    const pinResult = await aliceChannelMgr.pinMessage(msg.id);
    expect(pinResult.success).toBe(true);

    // Verify via raw DB
    const pinned = [...database.db._messages.values()].filter(
      (m) => m.channel_id === channel.id && m.is_pinned === 1,
    );
    expect(pinned.length).toBeGreaterThanOrEqual(1);
    expect(pinned.some((m) => m.id === msg.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 – Governance voting
// ---------------------------------------------------------------------------

describe("Community Channels Integration – Governance Voting", () => {
  const ALICE = "did:test:alice-gov";  // owner  → weight 3
  const BOB = "did:test:bob-gov";     // member → weight 1
  const CHARLIE = "did:test:charlie-gov"; // member → weight 1

  let database;
  let communityId;
  let aliceEngine;
  let bobEngine;
  let charlieEngine;

  beforeEach(async () => {
    vi.clearAllMocks();
    database = createStatefulMockDatabase();

    // Bootstrap community with alice as owner, bob and charlie as members
    const { mgr: communityMgr } = await buildCommunityManager(database, ALICE);
    const community = await communityMgr.createCommunity({ name: "Governance Community" });
    communityId = community.id;
    await communityMgr.joinCommunity(communityId, BOB);
    await communityMgr.joinCommunity(communityId, CHARLIE);

    // Build governance engines – all share the same database
    ({ engine: aliceEngine } = await buildGovernanceEngine(database, ALICE));
    ({ engine: bobEngine } = await buildGovernanceEngine(database, BOB));
    ({ engine: charlieEngine } = await buildGovernanceEngine(database, CHARLIE));
    bobEngine.database = aliceEngine.database;
    charlieEngine.database = aliceEngine.database;
  });

  afterEach(() => {
    aliceEngine.removeAllListeners();
    bobEngine.removeAllListeners();
    charlieEngine.removeAllListeners();
  });

  it("alice creates a proposal as the community owner", async () => {
    const proposal = await aliceEngine.createProposal({
      communityId,
      title: "Add weekly AMA",
      description: "Hold a weekly Ask Me Anything session",
    });

    expect(proposal.id).toBeTruthy();
    expect(proposal.title).toBe("Add weekly AMA");
    expect(proposal.proposer_did).toBe(ALICE);
  });

  it("tallyVotes: alice approve(3) + bob approve(1) vs charlie reject(1) → passed=true (80%)", async () => {
    // Use zero-length discussion so we can go straight to voting
    const proposal = await aliceEngine.createProposal({
      communityId,
      title: "Adopt new rules",
      discussionDuration: 0,
    });

    // Force the proposal into VOTING status in the DB so castVote succeeds
    const proposalRow = database.db._proposals.get(proposal.id);
    proposalRow.status = "voting";
    proposalRow.voting_end = Date.now() + 48 * 60 * 60 * 1000;

    await aliceEngine.castVote(proposal.id, "approve");
    await bobEngine.castVote(proposal.id, "approve");
    await charlieEngine.castVote(proposal.id, "reject");

    const tally = await aliceEngine.tallyVotes(proposal.id);

    expect(tally.approveWeight).toBe(4); // owner(3) + member(1)
    expect(tally.rejectWeight).toBe(1);
    expect(tally.passed).toBe(true);
    expect(tally.passRatio).toBeGreaterThanOrEqual(0.66);
  });

  it("a proposal with only reject votes is not passed", async () => {
    const proposal = await aliceEngine.createProposal({
      communityId,
      title: "Controversial rule",
      discussionDuration: 0,
    });

    const proposalRow = database.db._proposals.get(proposal.id);
    proposalRow.status = "voting";
    proposalRow.voting_end = Date.now() + 48 * 60 * 60 * 1000;

    // Only bob and charlie vote, both reject
    await bobEngine.castVote(proposal.id, "reject");
    await charlieEngine.castVote(proposal.id, "reject");

    const tally = await aliceEngine.tallyVotes(proposal.id);
    expect(tally.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 – Content moderation
// ---------------------------------------------------------------------------

describe("Community Channels Integration – Content Moderation", () => {
  const ALICE = "did:test:alice-mod";
  const BOB = "did:test:bob-mod";

  let database;
  let communityId;
  let aliceMod;
  let bobMod;

  beforeEach(async () => {
    vi.clearAllMocks();
    database = createStatefulMockDatabase();

    // Bootstrap community
    const { mgr: communityMgr } = await buildCommunityManager(database, ALICE);
    const community = await communityMgr.createCommunity({ name: "Moderated Community" });
    communityId = community.id;
    await communityMgr.joinCommunity(communityId, BOB);

    ({ mod: aliceMod } = await buildContentModerator(database, ALICE));
    ({ mod: bobMod } = await buildContentModerator(database, BOB));
    bobMod.database = aliceMod.database;
  });

  afterEach(() => {
    aliceMod.removeAllListeners();
    bobMod.removeAllListeners();
  });

  it("analyzeContent with friendly text returns score < 0.3 (safe)", async () => {
    const result = await aliceMod.analyzeContent("I love this amazing feature!");
    expect(result.safe).toBe(true);
    expect(result.score).toBeLessThan(0.3);
  });

  it("analyzeContent with aggressive spam-like text returns higher score", async () => {
    // Repeated character spam triggers the spam heuristic
    const spamText = "aaaaaaaaaa buy now today free click subscribe";
    const result = await aliceMod.analyzeContent(spamText);
    expect(result.score).toBeGreaterThan(0);
    expect(result.categories.length).toBeGreaterThan(0);
  });

  it("reportContent creates a moderation log entry", async () => {
    const result = await bobMod.reportContent({
      communityId,
      contentId: "msg-001",
      contentType: "message",
      reason: "This looks like spam",
      contentText: "buy now free click",
    });

    expect(result.success).toBe(true);
    expect(result.reportId).toBeTruthy();
  });

  it("getModerationLog returns the submitted report", async () => {
    await bobMod.reportContent({
      communityId,
      contentId: "msg-002",
      contentType: "message",
      reason: "Suspected harassment",
    });

    const logs = await aliceMod.getModerationLog(communityId);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((r) => r.content_id === "msg-002")).toBe(true);
  });

  it("a duplicate report from the same user on the same content throws", async () => {
    await bobMod.reportContent({
      communityId,
      contentId: "msg-003",
      contentType: "message",
      reason: "First report",
    });

    await expect(
      bobMod.reportContent({
        communityId,
        contentId: "msg-003",
        contentType: "message",
        reason: "Duplicate report",
      }),
    ).rejects.toThrow(/already reported/i);
  });
});
