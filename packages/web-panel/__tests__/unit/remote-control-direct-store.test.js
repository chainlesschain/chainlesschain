/**
 * Direct (LAN) remote-control transport in the remoteSession store
 * (gap-analysis 批28 — 批17/18 web-panel 遗留收口):
 *
 *   chainlesschain://remote-control/pair#… → WS connect → auth(serverToken)
 *   → remote-session-join(one-time pairingToken) → remote-session-event
 *   frames → permission.request cards → remote-session-publish approvals
 *   with a TOP-LEVEL commandId+seq (host idempotency ledger contract).
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useRemoteSessionStore } from "../../src/stores/remoteSession.js";
import {
  REMOTE_CONTROL_PAIRING_SCHEME,
  parseDirectPairingUri,
} from "../../src/utils/remote-control-pairing.js";

const SESSION_ID = "rc-session-1";
const SERVER_TOKEN = "rc-server-token";
const PAIRING_TOKEN = "one-time-pairing";

function directUri(overrides = {}) {
  const payload = {
    v: 1,
    transport: "direct",
    wsUrl: "ws://192.168.1.20:18800",
    serverToken: SERVER_TOKEN,
    remoteSessionId: SESSION_ID,
    agentSessionId: "agent-1",
    pairingToken: PAIRING_TOKEN,
    scopes: ["observe", "approve"],
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
  return (
    REMOTE_CONTROL_PAIRING_SCHEME +
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  );
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Browser-WebSocket stand-in that plays the cc WS server's remote-session
// protocol (auth-result / remote-session-joined / remote-session-published).
class FakeDirectServer {
  static OPEN = 1;
  static instances = [];
  static rejectJoin = null;

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.frames = [];
    this.published = [];
    this.listeners = {};
    FakeDirectServer.instances.push(this);
  }

  addEventListener(type, cb) {
    (this.listeners[type] ||= []).push(cb);
  }

  emit(type, event = {}) {
    (this.listeners[type] || []).forEach((cb) =>
      cb({ ...event, target: this }),
    );
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  deliver(obj) {
    this.emit("message", { data: JSON.stringify(obj) });
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }

  send(raw) {
    const msg = JSON.parse(raw);
    this.frames.push(msg);
    if (msg.type === "auth") {
      this.deliver({
        id: msg.id,
        type: "auth-result",
        success: msg.token === SERVER_TOKEN,
        ...(msg.token === SERVER_TOKEN ? {} : { message: "Invalid token" }),
      });
      return;
    }
    if (msg.type === "remote-session-join") {
      if (FakeDirectServer.rejectJoin) {
        this.deliver({
          id: msg.id,
          type: "error",
          code: "REMOTE_SESSION_JOIN_ERROR",
          message: FakeDirectServer.rejectJoin,
        });
        return;
      }
      this.deliver({
        id: msg.id,
        type: "remote-session-joined",
        session: { sessionId: SESSION_ID },
        member: { clientId: "web-client", scopes: ["observe", "approve"] },
      });
      return;
    }
    if (msg.type === "remote-session-publish") {
      this.published.push(msg);
      this.deliver({
        id: msg.id,
        type: "remote-session-published",
        delivered: 1,
        forwardedToHost: true,
      });
    }
  }

  pushEvent(event) {
    this.deliver({
      type: "remote-session-event",
      remoteSessionId: SESSION_ID,
      agentSessionId: "agent-1",
      event,
    });
  }
}

async function connectDirect(store, uri = directUri()) {
  expect(store.connect(uri)).toBe(true);
  const active = FakeDirectServer.instances.at(-1);
  active.open();
  await flush();
  return active;
}

describe("parseDirectPairingUri", () => {
  it("round-trips the CLI payload shape", () => {
    const parsed = parseDirectPairingUri(directUri());
    expect(parsed).toMatchObject({
      wsUrl: "ws://192.168.1.20:18800",
      serverToken: SERVER_TOKEN,
      remoteSessionId: SESSION_ID,
      agentSessionId: "agent-1",
      pairingToken: PAIRING_TOKEN,
      scopes: ["observe", "approve"],
    });
  });

  it("rejects expired, unsupported and malformed payloads", () => {
    expect(() =>
      parseDirectPairingUri(directUri({ expiresAt: Date.now() - 1 })),
    ).toThrow(/expired/);
    expect(() =>
      parseDirectPairingUri(directUri({ transport: "carrier-pigeon" })),
    ).toThrow(/Unsupported/);
    expect(() =>
      parseDirectPairingUri(REMOTE_CONTROL_PAIRING_SCHEME + "%%%not-b64%%%"),
    ).toThrow(/Malformed/);
    expect(() => parseDirectPairingUri("https://nope")).toThrow(
      /Not a remote-control/,
    );
  });
});

describe("remoteSession store — direct transport", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    FakeDirectServer.instances = [];
    FakeDirectServer.rejectJoin = null;
    vi.stubGlobal("WebSocket", FakeDirectServer);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auths, joins with the one-time token and reports transport/scopes", async () => {
    const store = useRemoteSessionStore();
    const active = await connectDirect(store);
    expect(store.status).toBe("connected");
    expect(store.transport).toBe("direct");
    expect(store.scopes).toEqual(["observe", "approve"]);
    expect(store.remoteSessionId).toBe(SESSION_ID);
    const [auth, join] = active.frames;
    expect(auth).toMatchObject({ type: "auth", token: SERVER_TOKEN });
    expect(join).toMatchObject({
      type: "remote-session-join",
      remoteSessionId: SESSION_ID,
      token: PAIRING_TOKEN,
    });
  });

  it("opens a permission card and publishes the approval with top-level commandId+seq", async () => {
    const store = useRemoteSessionStore();
    const active = await connectDirect(store);

    active.pushEvent({
      type: "permission.request",
      requestId: "ra-1",
      tool: "run_shell",
      action: "high-risk",
      detail: "npm publish",
    });
    expect(store.pendingApprovals).toHaveLength(1);
    expect(store.pendingApprovals[0]).toMatchObject({
      requestId: "ra-1",
      tool: "run_shell",
      detail: "npm publish",
    });
    // The raw event also lands in the log.
    expect(store.events.at(-1).type).toBe("permission.request");

    store.approve("ra-1", true);
    // Optimistic clear + wire shape.
    expect(store.pendingApprovals).toHaveLength(0);
    await flush();
    const publish = active.published.at(-1);
    expect(publish).toMatchObject({
      type: "remote-session-publish",
      remoteSessionId: SESSION_ID,
      seq: 1,
      event: { type: "approval.resolve", requestId: "ra-1", answer: true },
    });
    expect(typeof publish.commandId).toBe("string");
    expect(publish.commandId.length).toBeGreaterThan(8);

    // The host's permission.resolved confirmation stays idempotent.
    active.pushEvent({
      type: "permission.resolved",
      requestId: "ra-1",
      approved: true,
    });
    expect(store.pendingApprovals).toHaveLength(0);
  });

  it("clears a card when someone else resolves it (terminal or another device)", async () => {
    const store = useRemoteSessionStore();
    const active = await connectDirect(store);
    active.pushEvent({ type: "permission.request", requestId: "ra-2" });
    expect(store.pendingApprovals).toHaveLength(1);
    active.pushEvent({
      type: "permission.resolved",
      requestId: "ra-2",
      approved: false,
      via: "local",
    });
    expect(store.pendingApprovals).toHaveLength(0);
    expect(active.published).toHaveLength(0); // panel never answered
  });

  it("dedupes re-delivered permission.request events by requestId", async () => {
    const store = useRemoteSessionStore();
    const active = await connectDirect(store);
    active.pushEvent({ type: "permission.request", requestId: "ra-3" });
    active.pushEvent({ type: "permission.request", requestId: "ra-3" });
    expect(store.pendingApprovals).toHaveLength(1);
  });

  it("does NOT auto-reconnect a dropped direct link (one-time pairing token)", async () => {
    const store = useRemoteSessionStore();
    const active = await connectDirect(store);
    const socketCount = FakeDirectServer.instances.length;
    active.close(); // unexpected drop
    await flush();
    expect(store.status).toBe("disconnected");
    expect(store.error).toMatch(/一次性/);
    expect(FakeDirectServer.instances.length).toBe(socketCount);
  });

  it("surfaces a rejected join (token already spent) as an error", async () => {
    FakeDirectServer.rejectJoin = "Invalid pairing token";
    const store = useRemoteSessionStore();
    await connectDirect(store);
    expect(store.status).toBe("error");
    expect(store.error).toMatch(/Invalid pairing token/);
  });

  it("fails fast on an expired pairing link without opening a socket", () => {
    const store = useRemoteSessionStore();
    expect(store.connect(directUri({ expiresAt: Date.now() - 1 }))).toBe(false);
    expect(store.status).toBe("error");
    expect(FakeDirectServer.instances).toHaveLength(0);
  });

  it("sends prompts as published control events", async () => {
    const store = useRemoteSessionStore();
    const active = await connectDirect(store);
    store.sendPrompt("  keep going  ");
    await flush();
    expect(active.published.at(-1)).toMatchObject({
      type: "remote-session-publish",
      event: { type: "prompt", content: "keep going" },
    });
  });

  it("handles a host-issued revocation", async () => {
    const store = useRemoteSessionStore();
    const active = await connectDirect(store);
    active.deliver({
      type: "remote-session-revoked",
      remoteSessionId: SESSION_ID,
    });
    expect(store.status).toBe("revoked");
  });

  it("explicit disconnect closes the socket quietly", async () => {
    const store = useRemoteSessionStore();
    const active = await connectDirect(store);
    store.disconnect();
    expect(active.readyState).toBe(3);
    expect(store.status).toBe("disconnected");
    expect(store.error).toBe("");
  });
});
