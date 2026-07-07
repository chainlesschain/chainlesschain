import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useRemoteSessionStore } from "../../src/stores/remoteSession.js";
import {
  RemoteSessionCryptoContext,
  createRemotePairingUri,
} from "../../../cli/src/harness/remote-session-crypto.js";

const SESSION_ID = "session-store";
const TOKEN = "store-token";

// Fake relay + host: a WebSocket stand-in that also plays the host side so the
// store's real E2EE crypto runs end to end with no network. A single shared
// host crypto (FakeRelay.host) is seeded per test so the pairing URI advertises
// the same key every reconnected socket pairs against.
class FakeRelay {
  static OPEN = 1;
  static instances = [];
  static host = null;
  static mobilePeerId = null;

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = {};
    this.controls = [];
    FakeRelay.instances.push(this);
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
    this.sent.push(raw);
    const msg = JSON.parse(raw);
    if (msg.type === "register") {
      this.deliver({ type: "registered" });
      return;
    }
    if (msg.type !== "message") return;
    const payload = msg.payload;
    if (payload.type === "remote-session.pair") {
      FakeRelay.mobilePeerId = payload.mobilePeerId;
      FakeRelay.host.pair(payload.mobilePeerId, payload.mobilePublicKey, TOKEN);
      const join = FakeRelay.host.decrypt(payload.envelope);
      if (join.type !== "pair.join") throw new Error("bad pair.join");
      FakeRelay.lastJoin = join;
      this.pushEvent({ type: "pair.accepted", remoteSessionId: SESSION_ID });
    } else if (payload.type === "remote-session.encrypted") {
      this.controls.push(FakeRelay.host.decrypt(payload.envelope));
    }
  }

  pushEvent(event) {
    this.deliver({
      type: "message",
      payload: {
        type: "remote-session.encrypted",
        envelope: FakeRelay.host.encrypt(FakeRelay.mobilePeerId, event),
      },
    });
  }
}

function pairingUri() {
  return createRemotePairingUri({
    relayUrl: "wss://relay.test",
    remoteSessionId: SESSION_ID,
    hostPeerId: "host",
    hostPublicKey: FakeRelay.host.publicKey,
    pairingToken: TOKEN,
    expiresAt: Date.now() + 60_000,
  });
}

function connectAndOpen(store, options) {
  store.connect(pairingUri(), options);
  const active = FakeRelay.instances[FakeRelay.instances.length - 1];
  active.open(); // register → registered → pair → pair.accepted (all synchronous)
  return active;
}

describe("remoteSession store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    FakeRelay.instances = [];
    FakeRelay.mobilePeerId = null;
    FakeRelay.host = new RemoteSessionCryptoContext({
      sessionId: SESSION_ID,
      localPeerId: "host",
    });
    vi.stubGlobal("WebSocket", FakeRelay);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("pairs, connects, mirrors events and sends scoped controls", () => {
    const store = useRemoteSessionStore();
    const active = connectAndOpen(store);
    expect(store.status).toBe("connected");

    active.pushEvent({ type: "assistant.delta", content: "building" });
    expect(store.events.at(-1)).toMatchObject({
      type: "assistant.delta",
      content: "building",
    });

    store.sendPrompt("continue");
    expect(active.controls.at(-1)).toMatchObject({
      type: "prompt",
      content: "continue",
    });

    store.approve("req-1", true);
    expect(active.controls.at(-1)).toMatchObject({
      type: "approval.resolve",
      requestId: "req-1",
      approved: true,
    });

    store.interrupt();
    expect(active.controls.at(-1)).toMatchObject({ type: "interrupt" });
  });

  it("stamps every control event with a commandId + monotonic seq (idempotency)", () => {
    // The relay is at-least-once (offline-message redelivery): the host dedups
    // via event.commandId in its RemoteCommandLedger, so every control must
    // carry one INSIDE the encrypted plaintext.
    const store = useRemoteSessionStore();
    const active = connectAndOpen(store);

    store.sendPrompt("one");
    store.approve("req-9", false);
    store.interrupt();
    const [a, b, c] = active.controls.slice(-3);
    for (const evt of [a, b, c]) {
      expect(typeof evt.commandId).toBe("string");
      expect(evt.commandId.length).toBeGreaterThan(8);
    }
    // Distinct ids per logical command, strictly monotonic per-pairing seq.
    expect(new Set([a.commandId, b.commandId, c.commandId]).size).toBe(3);
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);

    // A NEW pairing starts a fresh seq space (new peerId = new device id on
    // the host); the counter must not leak across sessions.
    FakeRelay.mobilePeerId = null;
    const second = connectAndOpen(store);
    store.sendPrompt("again");
    expect(second.controls.at(-1).seq).toBe(1);
  });

  it("auto-reconnects a transient drop and resumes without re-pairing", () => {
    vi.useFakeTimers();
    const store = useRemoteSessionStore();
    connectAndOpen(store);
    expect(store.status).toBe("connected");

    const before = FakeRelay.instances.length;
    FakeRelay.instances[before - 1].close();
    expect(store.status).toBe("reconnecting");

    vi.advanceTimersByTime(1_000);
    expect(FakeRelay.instances.length).toBe(before + 1);
    FakeRelay.instances[before].open(); // registered → already paired → resume
    expect(store.status).toBe("connected");
  });

  it("stops on a host-issued revocation", () => {
    const store = useRemoteSessionStore();
    const active = connectAndOpen(store);
    expect(store.status).toBe("connected");

    active.pushEvent({ type: "session.revoked", remoteSessionId: SESSION_ID });
    expect(store.status).toBe("revoked");
  });

  it("rejects an invalid pairing link without throwing", () => {
    const store = useRemoteSessionStore();
    expect(store.connect("not-a-pairing-uri")).toBe(false);
    expect(store.status).toBe("error");
    expect(store.error).toMatch(/Invalid Remote Session pairing URI/);
  });

  it("carries a Web Push subscription in pair.join", () => {
    const store = useRemoteSessionStore();
    connectAndOpen(store, {
      pushCredentials: {
        token: '{"endpoint":"https://p.test"}',
        provider: "web",
      },
    });
    expect(store.status).toBe("connected");
    expect(FakeRelay.lastJoin).toMatchObject({
      type: "pair.join",
      pushToken: '{"endpoint":"https://p.test"}',
      pushProvider: "web",
    });
  });

  it("omits push fields from pair.join when no subscription is set", () => {
    const store = useRemoteSessionStore();
    connectAndOpen(store);
    expect(FakeRelay.lastJoin.pushToken).toBeUndefined();
    expect(FakeRelay.lastJoin.pushProvider).toBeUndefined();
  });

  it("forwards updatePushCredentials to the host as a push.register control", () => {
    const store = useRemoteSessionStore();
    const active = connectAndOpen(store);
    store.updatePushCredentials('{"endpoint":"https://p2.test"}', "web");
    expect(active.controls.at(-1)).toMatchObject({
      type: "push.register",
      pushToken: '{"endpoint":"https://p2.test"}',
      pushProvider: "web",
    });
  });
});
