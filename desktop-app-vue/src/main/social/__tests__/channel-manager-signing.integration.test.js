/**
 * channel-manager B4a signing integration test.
 *
 * Exercises the real sendMessage → handleMessageReceived chain with real
 * Ed25519 keys (tweetnacl). did-signer + channel-manager are both real;
 * only the sqlite layer is a tracking in-mem mock.
 *
 * Validates:
 *   - sendMessage embeds sender_pubkey + signature
 *   - handleMessageReceived ACCEPTS a correctly signed message
 *   - handleMessageReceived REJECTS impersonation (DID claimed but signed
 *     by attacker's key)
 *   - handleMessageReceived REJECTS payload tampered after signing
 *   - handleMessageReceived REJECTS malformed envelope (only one of
 *     sender_pubkey/signature present)
 *   - handleMessageReceived ACCEPTS unsigned legacy messages with warn
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `gen-msg-${++uuidCounter}`,
}));

const { ChannelManager } = require("../channel-manager.js");
const {
  computeDIDFromPublicKey,
  signPayloadWithIdentity,
} = require("../../did/did-signer.js");

function makeIdentity(keyPair) {
  return {
    did: computeDIDFromPublicKey(keyPair.publicKey),
    public_key_sign: naclUtil.encodeBase64(keyPair.publicKey),
    private_key_ref: JSON.stringify({
      sign: naclUtil.encodeBase64(keyPair.secretKey),
      encrypt: naclUtil.encodeBase64(new Uint8Array(32)),
    }),
  };
}

function createTrackingDb() {
  const channelMessages = new Map();
  const memberships = new Map();
  const channels = new Map([
    [
      "ch-test-1",
      { id: "ch-test-1", community_id: "comm-test-1", type: "discussion" },
    ],
  ]);

  function makeStmt(sql) {
    return {
      run: (...params) => {
        if (sql.includes("INSERT OR IGNORE INTO channel_messages")) {
          const [
            id,
            channel_id,
            sender_did,
            content,
            message_type,
            reply_to,
            is_pinned,
            reactions,
            created_at,
            updated_at,
            sender_pubkey,
            signature,
          ] = params;
          if (!channelMessages.has(id)) {
            channelMessages.set(id, {
              id,
              channel_id,
              sender_did,
              content,
              message_type,
              reply_to,
              is_pinned,
              reactions,
              created_at,
              updated_at,
              sender_pubkey,
              signature,
            });
          }
          return { changes: 1 };
        }
        if (sql.includes("INSERT INTO channel_messages")) {
          const [
            id,
            channel_id,
            sender_did,
            content,
            message_type,
            reply_to,
            is_pinned,
            reactions,
            created_at,
            updated_at,
            sender_pubkey,
            signature,
          ] = params;
          channelMessages.set(id, {
            id,
            channel_id,
            sender_did,
            content,
            message_type,
            reply_to,
            is_pinned,
            reactions,
            created_at,
            updated_at,
            sender_pubkey,
            signature,
          });
          return { changes: 1 };
        }
        return { changes: 0 };
      },
      get: (id) => {
        if (sql.includes("SELECT id FROM channel_messages WHERE id = ?")) {
          return channelMessages.has(id) ? { id } : null;
        }
        if (sql.includes("FROM channels WHERE id = ?")) {
          return channels.get(id) || null;
        }
        return null;
      },
      // PRAGMA table_info — return existing columns INCLUDING the new ones
      // so the migration helper short-circuits (no ALTER needed in mem)
      all: () => {
        if (sql.includes("PRAGMA table_info")) {
          return [
            { cid: 0, name: "id" },
            { cid: 1, name: "channel_id" },
            { cid: 2, name: "sender_did" },
            { cid: 3, name: "content" },
            { cid: 4, name: "message_type" },
            { cid: 5, name: "reply_to" },
            { cid: 6, name: "is_pinned" },
            { cid: 7, name: "reactions" },
            { cid: 8, name: "created_at" },
            { cid: 9, name: "updated_at" },
            { cid: 10, name: "sender_pubkey" },
            { cid: 11, name: "signature" },
          ];
        }
        return [];
      },
    };
  }

  return {
    db: {
      exec: vi.fn(),
      run: vi.fn(),
      prepare: makeStmt,
      _channelMessages: channelMessages,
      _memberships: memberships,
    },
    saveToFile: vi.fn(),
  };
}

function createDidManagerForKeypair(keyPair) {
  const identity = makeIdentity(keyPair);
  return {
    getCurrentIdentity: vi.fn().mockReturnValue(identity),
    _identity: identity,
  };
}

describe("ChannelManager B4a signing integration", () => {
  let alice;
  let mallory;
  let aliceMgr;
  let bobMgr;

  beforeEach(async () => {
    uuidCounter = 0;
    alice = nacl.sign.keyPair();
    mallory = nacl.sign.keyPair();

    const aliceDb = createTrackingDb();
    const bobDb = createTrackingDb();

    aliceMgr = new ChannelManager(
      aliceDb,
      createDidManagerForKeypair(alice),
      null,
    );
    await aliceMgr.initialize();

    // Bob's manager — receives messages, has its own identity (irrelevant
    // for verification of incoming msgs)
    const bob = nacl.sign.keyPair();
    bobMgr = new ChannelManager(bobDb, createDidManagerForKeypair(bob), null);
    await bobMgr.initialize();

    // Stub permission check so sendMessage doesn't need community_members
    aliceMgr.checkWritePermission = vi.fn().mockResolvedValue(true);
  });

  it("sendMessage embeds sender_pubkey + signature", async () => {
    const message = await aliceMgr.sendMessage({
      channelId: "ch-test-1",
      content: "hello signed",
    });
    expect(message.sender_pubkey).toBeTruthy();
    expect(message.signature).toBeTruthy();
    expect(message.sender_did).toBe(computeDIDFromPublicKey(alice.publicKey));
    // pubkey base64 length for 32-byte Ed25519 = 44 with padding
    expect(message.sender_pubkey.length).toBeGreaterThanOrEqual(43);
  });

  it("Bob accepts Alice's correctly signed message", async () => {
    const sent = await aliceMgr.sendMessage({
      channelId: "ch-test-1",
      content: "hi bob, signed",
    });

    const rejectedSpy = vi.fn();
    bobMgr.on("channel:message-rejected", rejectedSpy);

    await bobMgr.handleMessageReceived("ch-test-1", sent);

    expect(rejectedSpy).not.toHaveBeenCalled();
    expect(bobMgr.database.db._channelMessages.size).toBe(1);
    const stored = bobMgr.database.db._channelMessages.get(sent.id);
    expect(stored.content).toBe("hi bob, signed");
    expect(stored.sender_pubkey).toBe(sent.sender_pubkey);
    expect(stored.signature).toBe(sent.signature);
  });

  it("REJECTS impersonation: attacker claims Alice's DID but signs with own key", async () => {
    const aliceDid = computeDIDFromPublicKey(alice.publicKey);
    // Mallory crafts a payload claiming alice's DID
    const created_at = Date.now();
    const subset = {
      id: "evil-msg-1",
      channel_id: "ch-test-1",
      sender_did: aliceDid,
      content: "i am alice (lies)",
      message_type: "text",
      reply_to: null,
      created_at,
    };
    const malloryIdentity = makeIdentity(mallory);
    const { sender_pubkey, signature } = signPayloadWithIdentity(
      subset,
      malloryIdentity,
    );
    const evilMessage = {
      ...subset,
      is_pinned: 0,
      reactions: "{}",
      updated_at: created_at,
      sender_pubkey, // ← Mallory's pubkey
      signature, // ← Mallory's signature
    };

    const rejectedSpy = vi.fn();
    bobMgr.on("channel:message-rejected", rejectedSpy);

    await bobMgr.handleMessageReceived("ch-test-1", evilMessage);

    expect(rejectedSpy).toHaveBeenCalledOnce();
    expect(rejectedSpy.mock.calls[0][0].reason).toMatch(/sender_did mismatch/);
    expect(bobMgr.database.db._channelMessages.size).toBe(0);
  });

  it("REJECTS tampered payload after signing", async () => {
    const sent = await aliceMgr.sendMessage({
      channelId: "ch-test-1",
      content: "approved transfer",
    });

    const tampered = { ...sent, content: "approved transfer of $999999" };
    const rejectedSpy = vi.fn();
    bobMgr.on("channel:message-rejected", rejectedSpy);

    await bobMgr.handleMessageReceived("ch-test-1", tampered);

    expect(rejectedSpy).toHaveBeenCalledOnce();
    expect(rejectedSpy.mock.calls[0][0].reason).toMatch(
      /signature verification/,
    );
    expect(bobMgr.database.db._channelMessages.size).toBe(0);
  });

  it("REJECTS malformed envelope: signature without pubkey", async () => {
    const sent = await aliceMgr.sendMessage({
      channelId: "ch-test-1",
      content: "ambiguous",
    });
    const malformed = { ...sent, sender_pubkey: null };

    const rejectedSpy = vi.fn();
    bobMgr.on("channel:message-rejected", rejectedSpy);

    await bobMgr.handleMessageReceived("ch-test-1", malformed);

    // Note: malformed-envelope path doesn't emit channel:message-rejected
    // (only verify-fail does); but it still drops silently with logger.warn
    expect(bobMgr.database.db._channelMessages.size).toBe(0);
  });

  it("ACCEPTS unsigned legacy message with warn (backward compat)", async () => {
    const legacyMessage = {
      id: "legacy-msg-1",
      sender_did: "did:chainlesschain:legacy0000000000000000000000000000000000",
      content: "old client, no sig",
      message_type: "text",
      reply_to: null,
      is_pinned: 0,
      reactions: "{}",
      created_at: 1700000000000,
      updated_at: 1700000000000,
      // NO sender_pubkey, NO signature
    };

    const rejectedSpy = vi.fn();
    bobMgr.on("channel:message-rejected", rejectedSpy);

    await bobMgr.handleMessageReceived("ch-test-1", legacyMessage);

    expect(rejectedSpy).not.toHaveBeenCalled();
    expect(bobMgr.database.db._channelMessages.size).toBe(1);
    const stored = bobMgr.database.db._channelMessages.get("legacy-msg-1");
    expect(stored.signature).toBeFalsy();
    expect(stored.sender_pubkey).toBeFalsy();
  });

  it("idempotent — second valid delivery does not re-insert", async () => {
    const sent = await aliceMgr.sendMessage({
      channelId: "ch-test-1",
      content: "duplicate test",
    });
    await bobMgr.handleMessageReceived("ch-test-1", sent);
    await bobMgr.handleMessageReceived("ch-test-1", sent);
    await bobMgr.handleMessageReceived("ch-test-1", sent);
    expect(bobMgr.database.db._channelMessages.size).toBe(1);
  });

  it("sendMessage continues unsigned (logged) when identity has no keys", async () => {
    const noKeyMgr = new ChannelManager(
      createTrackingDb(),
      { getCurrentIdentity: () => ({ did: "did:chainlesschain:nokeys" }) },
      null,
    );
    await noKeyMgr.initialize();
    noKeyMgr.checkWritePermission = vi.fn().mockResolvedValue(true);

    const message = await noKeyMgr.sendMessage({
      channelId: "ch-test-1",
      content: "no keys here",
    });
    expect(message.sender_pubkey).toBeNull();
    expect(message.signature).toBeNull();
  });
});
