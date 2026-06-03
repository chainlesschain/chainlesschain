/**
 * Gossip → ChannelManager receiver integration test.
 *
 * Validates the wiring added in social-initializer's `gossipReceiver`:
 *   gossipProtocol.emit('message:received', { communityId, payload })
 *     → channelManager.handleMessageReceived(payload.channelId, payload.message)
 *     → INSERT OR IGNORE into channel_messages
 *
 * This was the missing last-mile after Phase A's wire-frame fix:
 * the gossip path delivered the bytes, parsed them, and emitted the typed
 * event — but no listener wrote the message to the receiver's local DB.
 *
 * Uses real GossipProtocol + real ChannelManager + minimal mock DB.
 * (No real libp2p — the wire path is covered by p2p-gossip-roundtrip.test.js.)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import EventEmitter from "events";

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
  v4: () => `gen-uuid-${++uuidCounter}`,
}));

const { ChannelManager } = require("../channel-manager.js");
const { GossipProtocol } = require("../gossip-protocol.js");

// Tracks every channel_messages INSERT so the test can assert on it
function createTrackingDatabase() {
  const channelMessages = new Map(); // id → row
  const channels = new Map(); // id → row
  const memberships = new Map(); // composite key → row

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
            });
          }
          return { changes: 1 };
        }
        return { changes: 0 };
      },
      get: (id) => {
        if (sql.includes("SELECT id FROM channel_messages WHERE id = ?")) {
          return channelMessages.has(id) ? { id } : null;
        }
        if (sql.includes("FROM channel_messages WHERE id = ?")) {
          return channelMessages.get(id) || null;
        }
        return null;
      },
      all: () => Array.from(channelMessages.values()),
    };
  }

  return {
    db: {
      exec: vi.fn(),
      run: vi.fn(),
      prepare: makeStmt,
      _channelMessages: channelMessages,
      _channels: channels,
      _memberships: memberships,
    },
    saveToFile: vi.fn(),
  };
}

function createMockP2PManager() {
  const ee = new EventEmitter();
  ee.peerId = "12D3KooW-local-peer";
  ee.localPeerId = "12D3KooW-local-peer";
  ee.sendMessage = vi.fn().mockResolvedValue({ success: true });
  ee.getConnectedPeers = vi.fn().mockReturnValue([]);
  return ee;
}

// Mirror of social-initializer.js gossipReceiver — kept inline so the test
// pins the contract that init code must satisfy. If social-initializer's
// wiring drifts (e.g., dispatch on wrong field name), this test won't catch
// it — that's a known gap, but the fields are tiny and grep-able.
function wireGossipReceiver(gossipProtocol, channelManager) {
  gossipProtocol.on("message:received", async (data) => {
    const payload = data && data.payload;
    if (!payload || payload.type !== "channel_message") {
      return;
    }
    if (!payload.channelId || !payload.message) {
      return;
    }
    await channelManager.handleMessageReceived(
      payload.channelId,
      payload.message,
    );
  });
}

describe("Gossip → ChannelManager receiver wiring (integration)", () => {
  let database;
  let channelManager;
  let p2pManager;
  let gossipProtocol;
  const COMMUNITY_ID = "comm-recv-1";
  const CHANNEL_ID = "chan-recv-1";

  beforeEach(async () => {
    uuidCounter = 0;
    database = createTrackingDatabase();
    channelManager = new ChannelManager(
      database,
      { getCurrentIdentity: () => ({ did: "did:test:bob" }) },
      null,
    );
    await channelManager.initialize();

    p2pManager = createMockP2PManager();
    gossipProtocol = new GossipProtocol(p2pManager, { fanout: 1 });
    await gossipProtocol.initialize();
    gossipProtocol.subscribe(COMMUNITY_ID);

    wireGossipReceiver(gossipProtocol, channelManager);
  });

  it("inserts incoming channel_message into channel_messages on first delivery", async () => {
    // Simulate libp2p delivering a wire message to gossip-protocol's
    // p2pManager event listener (what dispatchTypedMessage now does).
    p2pManager.emit("gossip:message", {
      id: "wire-msg-1",
      communityId: COMMUNITY_ID,
      payload: {
        type: "channel_message",
        channelId: CHANNEL_ID,
        message: {
          id: "remote-msg-1",
          sender_did: "did:test:alice",
          content: "hi from alice",
          message_type: "text",
          created_at: 1700000000000,
          updated_at: 1700000000000,
        },
      },
      sender: "12D3KooW-alice",
      timestamp: Date.now(),
      ttl: 3_600_000,
      hops: 0,
      fromPeerId: "12D3KooW-alice",
    });

    // gossipProtocol.handleIncomingMessage + the wiring callback are async
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(database.db._channelMessages.has("remote-msg-1")).toBe(true);
    const row = database.db._channelMessages.get("remote-msg-1");
    expect(row.channel_id).toBe(CHANNEL_ID);
    expect(row.sender_did).toBe("did:test:alice");
    expect(row.content).toBe("hi from alice");
  });

  it("is idempotent — duplicate delivery does not insert twice", async () => {
    const fire = () =>
      p2pManager.emit("gossip:message", {
        id: "wire-msg-dup-" + Math.random(),
        communityId: COMMUNITY_ID,
        payload: {
          type: "channel_message",
          channelId: CHANNEL_ID,
          message: {
            id: "remote-msg-dup",
            sender_did: "did:test:alice",
            content: "duplicate test",
            message_type: "text",
            created_at: 1700000000001,
          },
        },
        sender: "12D3KooW-alice",
        timestamp: Date.now(),
        ttl: 3_600_000,
        hops: 0,
        fromPeerId: "12D3KooW-alice",
      });

    fire();
    await new Promise((r) => setImmediate(r));
    fire();
    await new Promise((r) => setImmediate(r));
    fire();
    await new Promise((r) => setImmediate(r));

    // INSERT OR IGNORE on (id) → still one row
    expect(database.db._channelMessages.size).toBe(1);
  });

  it("ignores non-channel_message gossip payloads", async () => {
    p2pManager.emit("gossip:message", {
      id: "wire-other-1",
      communityId: COMMUNITY_ID,
      payload: {
        type: "presence_announce",
        sender_did: "did:test:alice",
      },
      sender: "12D3KooW-alice",
      timestamp: Date.now(),
      ttl: 3_600_000,
      hops: 0,
      fromPeerId: "12D3KooW-alice",
    });

    await new Promise((r) => setImmediate(r));

    expect(database.db._channelMessages.size).toBe(0);
  });

  it("ignores gossip for communities the local node didn't subscribe to", async () => {
    // Local only subscribed to COMMUNITY_ID; arrival on a different community
    // should be filtered out by gossip-protocol's handleIncomingMessage.
    p2pManager.emit("gossip:message", {
      id: "wire-other-comm",
      communityId: "comm-not-joined",
      payload: {
        type: "channel_message",
        channelId: "chan-anywhere",
        message: {
          id: "msg-anywhere",
          sender_did: "did:test:alice",
          content: "should not arrive",
          message_type: "text",
          created_at: Date.now(),
        },
      },
      sender: "12D3KooW-alice",
      timestamp: Date.now(),
      ttl: 3_600_000,
      hops: 0,
      fromPeerId: "12D3KooW-alice",
    });

    await new Promise((r) => setImmediate(r));

    expect(database.db._channelMessages.size).toBe(0);
  });
});
