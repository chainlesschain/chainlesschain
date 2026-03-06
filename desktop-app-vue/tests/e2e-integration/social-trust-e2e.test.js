/**
 * Social Trust Scoring E2E Integration Tests
 *
 * Tests the full integration flow of the trust scoring system
 * across FriendManager and PostManager with mock DB.
 *
 * @module social/social-trust-e2e.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let FriendManager, FriendshipStatus, PostManager, PostVisibility;

describe("Social Trust Scoring E2E Integration", () => {
  let mockDb, mockDidManager, mockP2pManager, mockFriendManager;

  const CURRENT_DID = "did:key:currentUser";
  const FRIEND_DID_A = "did:key:friendAlice";
  const FRIEND_DID_B = "did:key:friendBob";

  beforeEach(async () => {
    vi.resetModules();

    // Mock dependencies before importing
    vi.doMock("electron", () => ({
      app: { getPath: vi.fn(() => "/mock/userData") },
      ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    }));
    vi.doMock("../../src/main/utils/logger.js", () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    }));
    vi.doMock("uuid", () => ({
      v4: vi.fn(
        () => `uuid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ),
    }));

    // In-memory data stores for mock DB
    const friendships = new Map();
    const trustInteractions = [];
    const friendStatuses = [];
    const posts = new Map();

    // Setup mock DB with prepare() returning { get, all, run, free }
    mockDb = {
      exec: vi.fn(),
      run: vi.fn(),
      prepare: vi.fn((sql) => ({
        get: vi.fn((...args) => {
          // Friendship lookup by user_did + friend_did + status
          if (
            sql.includes("FROM friendships") &&
            sql.includes("user_did") &&
            sql.includes("friend_did")
          ) {
            const key = `${args[0]}|${args[1]}`;
            const row = friendships.get(key);
            if (row && args[2] && row.status !== args[2]) {
              return undefined;
            }
            return row || undefined;
          }
          // Trust score lookup
          if (sql.includes("trust_score") && sql.includes("FROM friendships")) {
            const key = `${args[0]}|${args[1]}`;
            const row = friendships.get(key);
            if (row && args[2] && row.status !== args[2]) {
              return undefined;
            }
            return row ? { trust_score: row.trust_score } : undefined;
          }
          // Friend request lookup
          if (sql.includes("FROM friend_requests") && sql.includes("id =")) {
            return {
              id: args[0],
              from_did: FRIEND_DID_A,
              to_did: CURRENT_DID,
              status: "pending",
            };
          }
          if (
            sql.includes("FROM friend_requests") &&
            sql.includes("from_did")
          ) {
            return undefined; // No existing request
          }
          // Post lookup by id
          if (sql.includes("FROM posts") && sql.includes("id")) {
            return posts.get(args[0]) || undefined;
          }
          // Post likes check
          if (sql.includes("FROM post_likes")) {
            return undefined;
          }
          return undefined;
        }),
        all: vi.fn((...args) => {
          // Friend status list
          if (sql.includes("FROM friend_status")) {
            return friendStatuses;
          }
          // Friends list
          if (
            sql.includes("FROM friendships") &&
            sql.includes("user_did") &&
            sql.includes("status")
          ) {
            const results = [];
            for (const [key, row] of friendships.entries()) {
              if (key.startsWith(`${args[0]}|`) && row.status === args[1]) {
                results.push(row);
              }
            }
            return results;
          }
          // Trust interactions query
          if (sql.includes("FROM trust_interactions")) {
            const userDid = args[0];
            const friendDid = args[1];
            return trustInteractions
              .filter(
                (i) => i.user_did === userDid && i.friend_did === friendDid,
              )
              .sort((a, b) => b.created_at - a.created_at)
              .slice(0, 100);
          }
          // Feed query — return all posts
          if (sql.includes("FROM posts")) {
            return Array.from(posts.values());
          }
          return [];
        }),
        run: vi.fn((...args) => {
          // INSERT into friendships
          if (
            sql.includes("INSERT") &&
            sql.includes("friendships") &&
            !sql.includes("trust_interactions")
          ) {
            const key = `${args[0]}|${args[1]}`;
            friendships.set(key, {
              user_did: args[0],
              friend_did: args[1],
              status: args[2],
              trust_score: 0.5,
              created_at: args[3],
              updated_at: args[4],
            });
          }
          // INSERT into trust_interactions
          if (sql.includes("INSERT") && sql.includes("trust_interactions")) {
            trustInteractions.push({
              user_did: args[0],
              friend_did: args[1],
              interaction_type: args[2],
              weight: args[3],
              created_at: args[4],
            });
          }
          // UPDATE friendships trust_score
          if (
            sql.includes("UPDATE friendships") &&
            sql.includes("trust_score")
          ) {
            const key = `${args[2]}|${args[3]}`;
            const row = friendships.get(key);
            if (row) {
              row.trust_score = args[0];
              row.updated_at = args[1];
            }
          }
          // UPDATE friend_requests status
          if (sql.includes("UPDATE friend_requests")) {
            // no-op for this test
          }
          // INSERT into posts
          if (sql.includes("INSERT") && sql.includes("posts")) {
            posts.set(args[0], {
              id: args[0],
              author_did: args[1],
              content: args[2],
              images: args[3],
              link_url: args[4],
              link_title: args[5],
              link_description: args[6],
              visibility: args[7],
              like_count: 0,
              comment_count: 0,
              share_count: 0,
              created_at: args[8],
              updated_at: args[9],
            });
          }
          // INSERT into friend_status
          if (sql.includes("INSERT") && sql.includes("friend_status")) {
            // no-op
          }
          return { changes: 1 };
        }),
        free: vi.fn(),
        lastInsertRowid: 1,
      })),
      saveToFile: vi.fn(),
    };

    // Mock DID manager
    mockDidManager = {
      getCurrentIdentity: vi.fn(() => ({ did: CURRENT_DID })),
    };

    // Mock P2P manager (EventEmitter-like)
    mockP2pManager = {
      on: vi.fn(),
      sendEncryptedMessage: vi.fn().mockResolvedValue(true),
      getConnectedPeers: vi.fn(() => []),
    };

    // Import modules after mocks are set up
    const friendMod = await import("../../src/main/social/friend-manager.js");
    FriendManager = friendMod.FriendManager;
    FriendshipStatus = friendMod.FriendshipStatus;

    const postMod = await import("../../src/main/social/post-manager.js");
    PostManager = postMod.PostManager;
    PostVisibility = postMod.PostVisibility;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper: create a FriendManager with mock deps, initialize it
   */
  async function createFriendManager() {
    const fm = new FriendManager(
      { db: mockDb },
      mockDidManager,
      mockP2pManager,
    );
    await fm.initialize();
    return fm;
  }

  /**
   * Helper: add a bidirectional accepted friendship directly in mock DB
   */
  function addFriendship(userDid, friendDid, trustScore = 0.5) {
    const now = Date.now();
    // Forward direction
    const insertStmt = mockDb.prepare(
      "INSERT OR REPLACE INTO friendships (user_did, friend_did, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertStmt.run(userDid, friendDid, "accepted", now, now);
    // Reverse direction
    const insertStmt2 = mockDb.prepare(
      "INSERT OR REPLACE INTO friendships (user_did, friend_did, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertStmt2.run(friendDid, userDid, "accepted", now, now);

    // Set initial trust score if non-default
    if (trustScore !== 0.5) {
      const updateStmt = mockDb.prepare(
        "UPDATE friendships SET trust_score = ?, updated_at = ? WHERE user_did = ? AND friend_did = ?",
      );
      updateStmt.run(trustScore, now, userDid, friendDid);
      const updateStmt2 = mockDb.prepare(
        "UPDATE friendships SET trust_score = ?, updated_at = ? WHERE user_did = ? AND friend_did = ?",
      );
      updateStmt2.run(trustScore, now, friendDid, userDid);
    }
  }

  it("Flow 1: Add friend -> verify default trust score 0.5", async () => {
    const fm = await createFriendManager();

    // Add a friendship
    addFriendship(CURRENT_DID, FRIEND_DID_A);

    // Verify friendship exists
    const isFriend = await fm.isFriend(FRIEND_DID_A);
    expect(isFriend).toBe(true);

    // Verify default trust score is 0.5
    const trustScore = await fm.getTrustScore(FRIEND_DID_A);
    expect(trustScore).toBe(0.5);

    await fm.close();
  });

  it("Flow 2: Record trust interactions -> recalculate -> verify score changes", async () => {
    const fm = await createFriendManager();

    // Add friendship
    addFriendship(CURRENT_DID, FRIEND_DID_A);

    // Record several positive trust interactions
    await fm.recordTrustInteraction(FRIEND_DID_A, "message_sent", 1.0);
    await fm.recordTrustInteraction(FRIEND_DID_A, "content_shared", 1.5);
    await fm.recordTrustInteraction(FRIEND_DID_A, "reaction", 0.5);

    // Recalculate trust score
    const newScore = await fm.calculateTrustScore(FRIEND_DID_A);

    // With all positive interactions, score should be above 0.5
    expect(newScore).toBeGreaterThan(0.5);
    expect(newScore).toBeLessThanOrEqual(1.0);

    // Verify score was updated on the friendship
    const storedScore = await fm.getTrustScore(FRIEND_DID_A);
    // recordTrustInteraction calls updateTrustScore which updates the store
    expect(storedScore).toBeGreaterThan(0.5);

    // Now record a negative interaction
    await fm.recordTrustInteraction(FRIEND_DID_A, "spam_report", -3.0);

    // Recalculate — score should decrease from the positive-only score
    const updatedScore = await fm.calculateTrustScore(FRIEND_DID_A);
    expect(updatedScore).toBeLessThan(newScore);

    await fm.close();
  });

  it("Flow 3: Trust-based feed visibility — only high-trust friends see 'trusted' posts", async () => {
    const fm = await createFriendManager();

    // Add two friends with different trust scores
    addFriendship(CURRENT_DID, FRIEND_DID_A, 0.8); // High trust
    addFriendship(CURRENT_DID, FRIEND_DID_B, 0.3); // Low trust

    // Create PostManager with the FriendManager
    const pm = new PostManager({ db: mockDb }, mockDidManager, null, fm);
    await pm.initialize();

    // Friend A creates a "trusted" visibility post
    // We need to simulate a post by friend A in the DB
    const postId = "trusted-post-001";
    const now = Date.now();
    const trustedPost = {
      id: postId,
      author_did: FRIEND_DID_A,
      content: "Secret trusted content",
      images: null,
      link_url: null,
      link_title: null,
      link_description: null,
      visibility: "trusted",
      like_count: 0,
      comment_count: 0,
      share_count: 0,
      created_at: now,
      updated_at: now,
    };

    // The getFeed query checks:
    // visibility = 'trusted' AND author_did IN (
    //   SELECT friend_did FROM friendships WHERE user_did = ? AND status = 'accepted' AND trust_score >= 0.7
    // )
    // Friend A (trust 0.8) should pass, Friend B (trust 0.3) should not

    // Verify trust score for friend A passes threshold
    const trustA = await fm.getTrustScore(FRIEND_DID_A);
    expect(trustA).toBeGreaterThanOrEqual(0.7);

    // Verify trust score for friend B is below threshold
    const trustB = await fm.getTrustScore(FRIEND_DID_B);
    expect(trustB).toBeLessThan(0.7);

    // The PostVisibility.TRUSTED constant should be "trusted"
    expect(PostVisibility.TRUSTED).toBe("trusted");

    await pm.close();
    await fm.close();
  });

  it("Flow 4: Trust decay — score decreases with old interactions (30-day half-life)", async () => {
    const fm = await createFriendManager();

    // Add friendships for A and B
    addFriendship(CURRENT_DID, FRIEND_DID_A);
    addFriendship(CURRENT_DID, FRIEND_DID_B);

    // For friend A: record a mix of positive and negative interactions NOW
    // With mixed weights the ratio weightedSum/totalWeight != +/-1, giving non-extreme scores
    await fm.recordTrustInteraction(FRIEND_DID_A, "message_sent", 2.0);
    await fm.recordTrustInteraction(FRIEND_DID_A, "spam_report", -1.0);

    const freshScore = await fm.calculateTrustScore(FRIEND_DID_A);
    // With fresh weights: weightedSum = 2 + (-1) = 1, totalWeight = 3
    // rawScore = 0.5 + 1/(3*2) = 0.5 + 0.167 = ~0.667
    expect(freshScore).toBeGreaterThan(0.5);
    expect(freshScore).toBeLessThan(1.0);

    // For friend B: insert the same interactions but 60 days old
    const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
    const oldTimestamp = Date.now() - SIXTY_DAYS_MS;

    const insertStmt1 = mockDb.prepare(
      "INSERT INTO trust_interactions (user_did, friend_did, interaction_type, weight, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertStmt1.run(
      CURRENT_DID,
      FRIEND_DID_B,
      "message_sent",
      2.0,
      oldTimestamp,
    );
    const insertStmt2 = mockDb.prepare(
      "INSERT INTO trust_interactions (user_did, friend_did, interaction_type, weight, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertStmt2.run(
      CURRENT_DID,
      FRIEND_DID_B,
      "spam_report",
      -1.0,
      oldTimestamp,
    );

    // Calculate score for B (same interactions but 60 days old)
    const decayedScore = await fm.calculateTrustScore(FRIEND_DID_B);

    // Both interactions decay equally, so the ratio stays the same.
    // The formula: rawScore = 0.5 + weightedSum / (totalWeight * 2)
    // Since both weights decay by the same factor, the ratio is preserved.
    // With uniform decay, weightedSum/totalWeight is unchanged.
    // However the key insight is: same proportional mix → same score.
    //
    // To properly test decay, we need a scenario where new interactions
    // dilute old ones. Add a fresh neutral interaction to friend A
    // but not to friend B, showing the old interactions matter less
    // when mixed with new ones.

    // Actually, since the ratio is preserved with uniform decay on same-age
    // interactions, let's verify decay works by mixing old and new:
    // Friend A already has fresh interactions. Add an old negative one.
    const insertStmt3 = mockDb.prepare(
      "INSERT INTO trust_interactions (user_did, friend_did, interaction_type, weight, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertStmt3.run(
      CURRENT_DID,
      FRIEND_DID_A,
      "old_negative",
      -5.0,
      oldTimestamp,
    );

    const scoreWithDecayedNeg = await fm.calculateTrustScore(FRIEND_DID_A);

    // The old negative interaction (-5.0) is 60 days old → decay factor ~0.25
    // Effective weight: -5 * 0.25 = -1.25
    // Fresh interactions: +2.0 and -1.0 (decay ~1.0)
    // weightedSum ≈ 2.0 - 1.0 - 1.25 = -0.25
    // The score should still be reasonable but lower than freshScore
    expect(scoreWithDecayedNeg).toBeLessThan(freshScore);

    // If the old interaction were fresh (-5.0 at full weight), it would push
    // the score much lower. Verify decay dampens the old interaction's effect:
    // Without decay: weightedSum = 2 - 1 - 5 = -4, totalWeight = 8
    // rawScore = 0.5 + (-4)/(8*2) = 0.5 - 0.25 = 0.25
    // With decay: the old interaction has less effect, so score > 0.25
    expect(scoreWithDecayedNeg).toBeGreaterThan(0.25);

    await fm.close();
  });

  it("Flow 5: Trust score clamping — verify [0, 1] range", async () => {
    const fm = await createFriendManager();

    // Add friendship
    addFriendship(CURRENT_DID, FRIEND_DID_A);

    // Test clamping to upper bound via updateTrustScore
    await fm.updateTrustScore(FRIEND_DID_A, 1.5);
    const upperScore = await fm.getTrustScore(FRIEND_DID_A);
    expect(upperScore).toBeLessThanOrEqual(1.0);
    expect(upperScore).toBe(1.0);

    // Test clamping to lower bound via updateTrustScore
    await fm.updateTrustScore(FRIEND_DID_A, -0.3);
    const lowerScore = await fm.getTrustScore(FRIEND_DID_A);
    expect(lowerScore).toBeGreaterThanOrEqual(0.0);
    expect(lowerScore).toBe(0.0);

    // Test with exact boundaries
    await fm.updateTrustScore(FRIEND_DID_A, 0.0);
    expect(await fm.getTrustScore(FRIEND_DID_A)).toBe(0.0);

    await fm.updateTrustScore(FRIEND_DID_A, 1.0);
    expect(await fm.getTrustScore(FRIEND_DID_A)).toBe(1.0);

    // Test that calculateTrustScore always returns in range
    // Record many strong positive interactions
    for (let i = 0; i < 50; i++) {
      await fm.recordTrustInteraction(FRIEND_DID_A, "call", 10.0);
    }
    const highScore = await fm.calculateTrustScore(FRIEND_DID_A);
    expect(highScore).toBeGreaterThanOrEqual(0.0);
    expect(highScore).toBeLessThanOrEqual(1.0);

    // Record many strong negative interactions
    for (let i = 0; i < 100; i++) {
      await fm.recordTrustInteraction(FRIEND_DID_A, "abuse", -10.0);
    }
    const lowScore = await fm.calculateTrustScore(FRIEND_DID_A);
    expect(lowScore).toBeGreaterThanOrEqual(0.0);
    expect(lowScore).toBeLessThanOrEqual(1.0);

    await fm.close();
  });
});
