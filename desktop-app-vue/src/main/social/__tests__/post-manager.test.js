/**
 * PostManager Unit Tests
 *
 * Covers:
 * - constructor: sets properties, extends EventEmitter
 * - initialize: calls initializeTables, setupP2PListeners, sets initialized
 * - initializeTables: creates posts, post_likes, post_comments tables and indexes
 * - createPost: happy path, not-logged-in, empty content, content too long, too many images
 * - getFeed: returns parsed posts, empty when not logged in
 * - getPost: returns parsed post, returns null when not found
 * - deletePost: happy path, not-logged-in, post not found, wrong author
 * - likePost: happy path, not-logged-in, already liked
 * - unlikePost: happy path, not-logged-in, not yet liked
 * - hasLiked: returns true/false, handles errors gracefully
 * - addComment: happy path, not-logged-in, empty content, content too long
 * - getComments: delegates to DB query
 * - deleteComment: happy path, not-logged-in, comment not found, wrong author
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock uuid ────────────────────────────────────────────────────────────────
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ─── Module under test ────────────────────────────────────────────────────────
const { PostManager, PostVisibility } = require("../post-manager.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 0 }),
  };
  return {
    db: {
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    },
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
  };
}

function createMockDIDManager(did = "did:test:alice") {
  return { getCurrentIdentity: vi.fn().mockReturnValue({ did }) };
}

function createMockP2PManager() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    broadcast: vi.fn(),
    sendMessage: vi.fn(),
    sendEncryptedMessage: vi.fn().mockResolvedValue(true),
    getConnectedPeers: vi.fn().mockReturnValue([]),
  };
}

function createMockFriendManager() {
  return {
    getFriends: vi.fn().mockResolvedValue([]),
    isFriend: vi.fn().mockResolvedValue(false),
  };
}

describe("PostManager", () => {
  let pm;
  let mockDb;
  let mockDID;
  let mockP2P;
  let mockFriend;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    mockDb = createMockDatabase();
    mockDID = createMockDIDManager();
    mockP2P = createMockP2PManager();
    mockFriend = createMockFriendManager();
    pm = new PostManager(mockDb, mockDID, mockP2P, mockFriend);
  });

  // ─── Constructor ──────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should set all dependency properties", () => {
      expect(pm.database).toBe(mockDb);
      expect(pm.didManager).toBe(mockDID);
      expect(pm.p2pManager).toBe(mockP2P);
      expect(pm.friendManager).toBe(mockFriend);
    });

    it("should initialise as not initialized", () => {
      expect(pm.initialized).toBe(false);
    });
  });

  // ─── initialize ───────────────────────────────────────────────────────
  describe("initialize", () => {
    it("should create tables, setup P2P listeners, and set initialized", async () => {
      await pm.initialize();
      expect(mockDb.db.exec).toHaveBeenCalled();
      expect(mockP2P.on).toHaveBeenCalled();
      expect(pm.initialized).toBe(true);
    });

    it("should throw and not set initialized on failure", async () => {
      mockDb.db.exec.mockImplementationOnce(() => {
        throw new Error("db error");
      });
      await expect(pm.initialize()).rejects.toThrow("db error");
      expect(pm.initialized).toBe(false);
    });
  });

  // ─── initializeTables ─────────────────────────────────────────────────
  describe("initializeTables", () => {
    it("should create posts, post_likes, post_comments tables and indexes", async () => {
      await pm.initializeTables();
      const execCalls = mockDb.db.exec.mock.calls.map((c) => c[0]);
      expect(execCalls.some((sql) => sql.includes("posts"))).toBe(true);
      expect(execCalls.some((sql) => sql.includes("post_likes"))).toBe(true);
      expect(execCalls.some((sql) => sql.includes("post_comments"))).toBe(true);
      expect(
        execCalls.some((sql) => sql.includes("idx_posts_author_did")),
      ).toBe(true);
    });
  });

  // ─── createPost ───────────────────────────────────────────────────────
  describe("createPost", () => {
    it("should create a post and return it with correct fields", async () => {
      const post = await pm.createPost({ content: "Hello world" });
      expect(typeof post.id).toBe("string");
      expect(post.id.length).toBeGreaterThan(0);
      expect(post.content).toBe("Hello world");
      expect(post.author_did).toBe("did:test:alice");
      expect(post.visibility).toBe("public");
      expect(post.like_count).toBe(0);
      expect(post.comment_count).toBe(0);
    });

    it("should emit post:created event", async () => {
      const handler = vi.fn();
      pm.on("post:created", handler);
      await pm.createPost({ content: "test" });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          post: expect.objectContaining({ content: "test" }),
        }),
      );
    });

    it("should throw when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      await expect(pm.createPost({ content: "test" })).rejects.toThrow(
        "未登录",
      );
    });

    it("should throw when content is empty", async () => {
      await expect(pm.createPost({ content: "" })).rejects.toThrow(
        "动态内容不能为空",
      );
    });

    it("should throw when content is whitespace only", async () => {
      await expect(pm.createPost({ content: "   " })).rejects.toThrow(
        "动态内容不能为空",
      );
    });

    it("should throw when content exceeds 1000 characters", async () => {
      const longContent = "a".repeat(1001);
      await expect(pm.createPost({ content: longContent })).rejects.toThrow(
        "动态内容不能超过 1000 字",
      );
    });

    it("should throw when more than 9 images", async () => {
      const images = Array(10).fill("img.jpg");
      await expect(pm.createPost({ content: "test", images })).rejects.toThrow(
        "图片数量不能超过 9 张",
      );
    });

    it("should trim content before saving", async () => {
      const post = await pm.createPost({ content: "  hello  " });
      expect(post.content).toBe("hello");
    });

    it("should set visibility from options", async () => {
      const post = await pm.createPost({
        content: "test",
        visibility: PostVisibility.FRIENDS,
      });
      expect(post.visibility).toBe("friends");
    });
  });

  // ─── getFeed ──────────────────────────────────────────────────────────
  describe("getFeed", () => {
    it("should return empty array when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      const feed = await pm.getFeed();
      expect(feed).toEqual([]);
    });

    it("should parse images JSON from DB results", async () => {
      mockDb.db._prep.all.mockReturnValue([
        {
          id: "p1",
          images: '["img1.jpg","img2.jpg"]',
          author_did: "did:test:alice",
        },
      ]);
      mockDb.db._prep.get.mockReturnValue(null); // hasLiked
      const feed = await pm.getFeed();
      expect(feed[0].images).toEqual(["img1.jpg", "img2.jpg"]);
    });

    it("should return empty images array when images is null", async () => {
      mockDb.db._prep.all.mockReturnValue([
        { id: "p1", images: null, author_did: "did:test:alice" },
      ]);
      const feed = await pm.getFeed();
      expect(feed[0].images).toEqual([]);
    });
  });

  // ─── getPost ──────────────────────────────────────────────────────────
  describe("getPost", () => {
    it("should return parsed post when found", async () => {
      mockDb.db._prep.get.mockReturnValue({
        id: "p1",
        content: "hello",
        images: '["img.jpg"]',
      });
      const post = await pm.getPost("p1");
      expect(post.images).toEqual(["img.jpg"]);
    });

    it("should return null when not found", async () => {
      mockDb.db._prep.get.mockReturnValue(null);
      const post = await pm.getPost("missing");
      expect(post).toBeNull();
    });
  });

  // ─── deletePost ───────────────────────────────────────────────────────
  describe("deletePost", () => {
    it("should delete post and related data, emit event", async () => {
      mockDb.db._prep.get.mockReturnValue({
        id: "p1",
        author_did: "did:test:alice",
      });
      const handler = vi.fn();
      pm.on("post:deleted", handler);
      const result = await pm.deletePost("p1");
      expect(result.success).toBe(true);
      // 3 delete calls: post, likes, comments
      expect(mockDb.db._prep.run).toHaveBeenCalledTimes(3);
      expect(handler).toHaveBeenCalledWith({ postId: "p1" });
    });

    it("should throw when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      await expect(pm.deletePost("p1")).rejects.toThrow("未登录");
    });

    it("should throw when post not found", async () => {
      mockDb.db._prep.get.mockReturnValue(null);
      await expect(pm.deletePost("missing")).rejects.toThrow("动态不存在");
    });

    it("should throw when user is not the author", async () => {
      mockDb.db._prep.get.mockReturnValue({
        id: "p1",
        author_did: "did:test:other",
      });
      await expect(pm.deletePost("p1")).rejects.toThrow("无权删除此动态");
    });
  });

  // ─── likePost ─────────────────────────────────────────────────────────
  describe("likePost", () => {
    it("should add like, increment count, and emit event", async () => {
      // No existing like
      mockDb.db._prep.get.mockReturnValue(null);
      const handler = vi.fn();
      pm.on("post:liked", handler);
      const result = await pm.likePost("p1");
      expect(result.success).toBe(true);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ postId: "p1", userDid: "did:test:alice" }),
      );
    });

    it("should throw when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      await expect(pm.likePost("p1")).rejects.toThrow("未登录");
    });

    it("should throw when already liked", async () => {
      mockDb.db._prep.get.mockReturnValue({
        post_id: "p1",
        user_did: "did:test:alice",
      });
      await expect(pm.likePost("p1")).rejects.toThrow("已经点过赞了");
    });
  });

  // ─── unlikePost ───────────────────────────────────────────────────────
  describe("unlikePost", () => {
    it("should remove like, decrement count, and emit event", async () => {
      mockDb.db._prep.run.mockReturnValue({ changes: 1 });
      const handler = vi.fn();
      pm.on("post:unliked", handler);
      const result = await pm.unlikePost("p1");
      expect(result.success).toBe(true);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ postId: "p1", userDid: "did:test:alice" }),
      );
    });

    it("should throw when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      await expect(pm.unlikePost("p1")).rejects.toThrow("未登录");
    });

    it("should throw when not yet liked", async () => {
      mockDb.db._prep.run.mockReturnValue({ changes: 0 });
      await expect(pm.unlikePost("p1")).rejects.toThrow("还未点赞");
    });
  });

  // ─── hasLiked ─────────────────────────────────────────────────────────
  describe("hasLiked", () => {
    it("should return true when like exists", () => {
      mockDb.db._prep.get.mockReturnValue({ 1: 1 });
      expect(pm.hasLiked("p1", "did:test:alice")).toBe(true);
    });

    it("should return false when like does not exist", () => {
      mockDb.db._prep.get.mockReturnValue(null);
      expect(pm.hasLiked("p1", "did:test:alice")).toBe(false);
    });

    it("should return false on error", () => {
      mockDb.db.prepare.mockImplementationOnce(() => {
        throw new Error("db error");
      });
      expect(pm.hasLiked("p1", "did:test:alice")).toBe(false);
    });
  });

  // ─── addComment ───────────────────────────────────────────────────────
  describe("addComment", () => {
    it("should add comment and return it", async () => {
      // getPost for notification
      mockDb.db._prep.get.mockReturnValue(null);
      const comment = await pm.addComment("p1", "nice post");
      expect(typeof comment.id).toBe("string");
      expect(comment.id.length).toBeGreaterThan(0);
      expect(comment.post_id).toBe("p1");
      expect(comment.content).toBe("nice post");
      expect(comment.author_did).toBe("did:test:alice");
    });

    it("should emit comment:added event", async () => {
      const handler = vi.fn();
      pm.on("comment:added", handler);
      await pm.addComment("p1", "hello");
      expect(handler).toHaveBeenCalled();
    });

    it("should throw when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      await expect(pm.addComment("p1", "test")).rejects.toThrow("未登录");
    });

    it("should throw when content is empty", async () => {
      await expect(pm.addComment("p1", "")).rejects.toThrow("评论内容不能为空");
    });

    it("should throw when content exceeds 500 characters", async () => {
      const longContent = "a".repeat(501);
      await expect(pm.addComment("p1", longContent)).rejects.toThrow(
        "评论内容不能超过 500 字",
      );
    });

    it("should support parentId for replies", async () => {
      mockDb.db._prep.get.mockReturnValue(null);
      const comment = await pm.addComment("p1", "reply", "parent-id");
      expect(comment.parent_id).toBe("parent-id");
    });
  });

  // ─── getComments ──────────────────────────────────────────────────────
  describe("getComments", () => {
    it("should return comments from DB", async () => {
      const mockComments = [{ id: "c1", content: "test" }];
      mockDb.db._prep.all.mockReturnValue(mockComments);
      const comments = await pm.getComments("p1");
      expect(comments).toEqual(mockComments);
    });
  });

  // ─── deleteComment ────────────────────────────────────────────────────
  describe("deleteComment", () => {
    it("should delete comment and its replies, update count, emit event", async () => {
      mockDb.db._prep.get
        .mockReturnValueOnce({
          id: "c1",
          author_did: "did:test:alice",
          post_id: "p1",
        }) // comment lookup
        .mockReturnValueOnce({ count: 2 }); // recount
      const handler = vi.fn();
      pm.on("comment:deleted", handler);
      const result = await pm.deleteComment("c1");
      expect(result.success).toBe(true);
      expect(handler).toHaveBeenCalledWith({ commentId: "c1", postId: "p1" });
    });

    it("should throw when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      await expect(pm.deleteComment("c1")).rejects.toThrow("未登录");
    });

    it("should throw when comment not found", async () => {
      mockDb.db._prep.get.mockReturnValue(null);
      await expect(pm.deleteComment("missing")).rejects.toThrow("评论不存在");
    });

    it("should throw when user is not the author", async () => {
      mockDb.db._prep.get.mockReturnValue({
        id: "c1",
        author_did: "did:test:other",
        post_id: "p1",
      });
      await expect(pm.deleteComment("c1")).rejects.toThrow("无权删除此评论");
    });
  });

  // ─── P2P DID signature (syncPost signs / handlePostReceived verifies) ───
  describe("P2P DID signature", () => {
    const nacl = require("tweetnacl");
    const naclUtil = require("tweetnacl-util");
    const { computeDIDFromPublicKey } = require("../../did/did-signer.js");

    function makeIdentity() {
      const kp = nacl.sign.keyPair();
      return {
        did: computeDIDFromPublicKey(kp.publicKey),
        public_key_sign: naclUtil.encodeBase64(kp.publicKey),
        private_key_ref: JSON.stringify({
          sign: naclUtil.encodeBase64(kp.secretKey),
        }),
      };
    }

    // Run a real createPost with a signing identity + a connected peer and
    // capture the broadcast post. Uses prod's OWN signer, so the canonical
    // subset can never drift from the verify side.
    async function captureSignedPost(identity, opts = {}) {
      const db = createMockDatabase();
      const did = { getCurrentIdentity: () => identity };
      const p2p = createMockP2PManager();
      p2p.getConnectedPeers.mockReturnValue([{ id: "did:test:peer" }]);
      const local = new PostManager(db, did, p2p, createMockFriendManager());
      await local.createPost({
        content: opts.content || "signed hello",
        images: opts.images || [],
      });
      return JSON.parse(p2p.sendEncryptedMessage.mock.calls[0][1]).post;
    }

    it("attaches author_pubkey + signature when identity has keys", async () => {
      const signed = await captureSignedPost(makeIdentity());
      expect(typeof signed.author_pubkey).toBe("string");
      expect(signed.author_pubkey.length).toBeGreaterThan(0);
      expect(typeof signed.signature).toBe("string");
      expect(signed.signature.length).toBeGreaterThan(0);
    });

    it("sends unsigned (null fields) when identity lacks signing keys", async () => {
      mockP2P.getConnectedPeers.mockReturnValue([{ id: "did:test:peer" }]);
      await pm.createPost({ content: "keyless" }); // default mockDID has no keys
      const wire = JSON.parse(mockP2P.sendEncryptedMessage.mock.calls[0][1]);
      expect(wire.post.author_pubkey == null).toBe(true);
      expect(wire.post.signature == null).toBe(true);
    });

    it("stores a correctly-signed received post", async () => {
      const signed = await captureSignedPost(makeIdentity());
      await pm.handlePostReceived(signed);
      expect(mockDb.db._prep.run).toHaveBeenCalled();
    });

    it("rejects a post whose content was tampered after signing", async () => {
      const signed = await captureSignedPost(makeIdentity());
      const rejected = vi.fn();
      pm.on("post:rejected", rejected);
      await pm.handlePostReceived({
        ...signed,
        content: signed.content + " EVIL",
      });
      expect(mockDb.db._prep.run).not.toHaveBeenCalled();
      expect(rejected).toHaveBeenCalled();
    });

    it("rejects impersonation (author_did swapped so pubkey no longer hashes to it)", async () => {
      const signed = await captureSignedPost(makeIdentity());
      const victim = makeIdentity();
      await pm.handlePostReceived({ ...signed, author_did: victim.did });
      expect(mockDb.db._prep.run).not.toHaveBeenCalled();
    });

    it("rejects a malformed envelope (pubkey present, signature missing)", async () => {
      const signed = await captureSignedPost(makeIdentity());
      await pm.handlePostReceived({ ...signed, signature: null });
      expect(mockDb.db._prep.run).not.toHaveBeenCalled();
    });

    it("accepts a legacy unsigned post (both fields absent)", async () => {
      const signed = await captureSignedPost(makeIdentity());
      await pm.handlePostReceived({
        ...signed,
        author_pubkey: null,
        signature: null,
      });
      expect(mockDb.db._prep.run).toHaveBeenCalled();
    });
  });

  // ─── P2P like/comment DID signature ────────────────────────────────────
  describe("P2P like/comment DID signature", () => {
    const nacl = require("tweetnacl");
    const naclUtil = require("tweetnacl-util");
    const { computeDIDFromPublicKey } = require("../../did/did-signer.js");

    function makeIdentity() {
      const kp = nacl.sign.keyPair();
      return {
        did: computeDIDFromPublicKey(kp.publicKey),
        public_key_sign: naclUtil.encodeBase64(kp.publicKey),
        private_key_ref: JSON.stringify({
          sign: naclUtil.encodeBase64(kp.secretKey),
        }),
      };
    }

    // Run prod's OWN likePost with a signing identity + a post authored by
    // someone else, and capture the P2P like notification it emits.
    async function captureSignedLike(identity, postId = "p1") {
      const db = createMockDatabase();
      db.db._prep.get
        .mockReturnValueOnce(null) // existing-like check → not yet liked
        .mockReturnValueOnce({ id: postId, author_did: "did:test:author" }); // getPost
      const did = { getCurrentIdentity: () => identity };
      const p2p = createMockP2PManager();
      const local = new PostManager(db, did, p2p, createMockFriendManager());
      await local.likePost(postId);
      return JSON.parse(p2p.sendEncryptedMessage.mock.calls[0][1]);
    }

    async function captureSignedComment(identity, postId = "p1") {
      const db = createMockDatabase();
      db.db._prep.get.mockReturnValueOnce({
        id: postId,
        author_did: "did:test:author",
      }); // getPost
      const did = { getCurrentIdentity: () => identity };
      const p2p = createMockP2PManager();
      const local = new PostManager(db, did, p2p, createMockFriendManager());
      await local.addComment(postId, "nice post");
      return JSON.parse(p2p.sendEncryptedMessage.mock.calls[0][1]).comment;
    }

    // ── likes ──
    it("attaches authorPubkey + signature to an outgoing like", async () => {
      const wire = await captureSignedLike(makeIdentity());
      expect(typeof wire.authorPubkey).toBe("string");
      expect(wire.authorPubkey.length).toBeGreaterThan(0);
      expect(typeof wire.signature).toBe("string");
      expect(wire.signature.length).toBeGreaterThan(0);
    });

    it("sends an unsigned like when identity lacks signing keys", async () => {
      const db = createMockDatabase();
      db.db._prep.get
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ id: "p1", author_did: "did:test:author" });
      const p2p = createMockP2PManager();
      // default mock identity (did:test:alice) has no signing keys
      const local = new PostManager(
        db,
        createMockDIDManager(),
        p2p,
        createMockFriendManager(),
      );
      await local.likePost("p1");
      const wire = JSON.parse(p2p.sendEncryptedMessage.mock.calls[0][1]);
      expect(wire.authorPubkey == null).toBe(true);
      expect(wire.signature == null).toBe(true);
    });

    it("stores a correctly-signed received like", async () => {
      const wire = await captureSignedLike(makeIdentity());
      mockDb.db._prep.get
        .mockReturnValueOnce({ id: wire.postId, author_did: "did:test:author" }) // post exists
        .mockReturnValueOnce(null); // not already liked
      await pm.handleLikeReceived(
        wire.postId,
        wire.userDid,
        wire.authorPubkey,
        wire.signature,
      );
      expect(mockDb.db._prep.run).toHaveBeenCalled();
    });

    it("rejects a like whose signer DID was swapped (impersonation)", async () => {
      const wire = await captureSignedLike(makeIdentity());
      const victim = makeIdentity();
      const rejected = vi.fn();
      pm.on("post-like:rejected", rejected);
      await pm.handleLikeReceived(
        wire.postId,
        victim.did,
        wire.authorPubkey,
        wire.signature,
      );
      expect(mockDb.db._prep.run).not.toHaveBeenCalled();
      expect(rejected).toHaveBeenCalled();
    });

    it("rejects a like with a malformed envelope (signature missing)", async () => {
      const wire = await captureSignedLike(makeIdentity());
      await pm.handleLikeReceived(
        wire.postId,
        wire.userDid,
        wire.authorPubkey,
        null,
      );
      expect(mockDb.db._prep.run).not.toHaveBeenCalled();
    });

    it("accepts a legacy unsigned like (both fields absent)", async () => {
      mockDb.db._prep.get
        .mockReturnValueOnce({ id: "p1", author_did: "did:test:author" })
        .mockReturnValueOnce(null);
      await pm.handleLikeReceived("p1", "did:test:someone", null, null);
      expect(mockDb.db._prep.run).toHaveBeenCalled();
    });

    // ── comments ──
    it("attaches author_pubkey + signature to an outgoing comment", async () => {
      const wire = await captureSignedComment(makeIdentity());
      expect(typeof wire.author_pubkey).toBe("string");
      expect(wire.author_pubkey.length).toBeGreaterThan(0);
      expect(typeof wire.signature).toBe("string");
      expect(wire.signature.length).toBeGreaterThan(0);
    });

    it("stores a correctly-signed received comment", async () => {
      const wire = await captureSignedComment(makeIdentity());
      await pm.handleCommentReceived(wire);
      expect(mockDb.db._prep.run).toHaveBeenCalled();
    });

    it("rejects a comment whose content was tampered after signing", async () => {
      const wire = await captureSignedComment(makeIdentity());
      const rejected = vi.fn();
      pm.on("comment:rejected", rejected);
      await pm.handleCommentReceived({
        ...wire,
        content: wire.content + " EVIL",
      });
      expect(mockDb.db._prep.run).not.toHaveBeenCalled();
      expect(rejected).toHaveBeenCalled();
    });

    it("rejects a comment with author_did swapped (impersonation)", async () => {
      const wire = await captureSignedComment(makeIdentity());
      const victim = makeIdentity();
      await pm.handleCommentReceived({ ...wire, author_did: victim.did });
      expect(mockDb.db._prep.run).not.toHaveBeenCalled();
    });

    it("rejects a comment with a malformed envelope (signature missing)", async () => {
      const wire = await captureSignedComment(makeIdentity());
      await pm.handleCommentReceived({ ...wire, signature: null });
      expect(mockDb.db._prep.run).not.toHaveBeenCalled();
    });

    it("accepts a legacy unsigned comment (both fields absent)", async () => {
      await pm.handleCommentReceived({
        id: "c1",
        post_id: "p1",
        author_did: "did:test:someone",
        content: "hi",
        parent_id: null,
        created_at: 123,
      });
      expect(mockDb.db._prep.run).toHaveBeenCalled();
    });
  });

  // ─── close ────────────────────────────────────────────────────────────
  describe("close", () => {
    it("should reset initialized flag", async () => {
      pm.initialized = true;
      await pm.close();
      expect(pm.initialized).toBe(false);
    });
  });
});
