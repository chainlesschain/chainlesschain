import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import { RemoteSessionRelay } from "../../src/gateways/remote-session-relay.js";

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = 1;
    this.sent = [];
  }
  send(value) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.emit("close");
  }
}

describe("RemoteSessionRelay", () => {
  it("registers a peer and sends only encrypted envelopes", async () => {
    const socket = new FakeSocket();
    const relay = new RemoteSessionRelay({
      relayUrl: "ws://relay.test",
      peerId: "host",
      websocketFactory: () => socket,
    });
    const connecting = relay.connect();
    socket.emit("open");
    await connecting;

    expect(socket.sent[0]).toMatchObject({
      type: "register",
      peerId: "host",
      deviceInfo: { protocol: "remote-session.e2ee.v1" },
    });
    relay.sendEncrypted("phone", { ciphertext: "opaque", tag: "tag" });
    expect(socket.sent[1]).toEqual({
      type: "message",
      to: "phone",
      payload: {
        type: "remote-session.encrypted",
        envelope: { ciphertext: "opaque", tag: "tag" },
      },
    });
  });

  it("unwraps online and offline signaling messages without decrypting them", async () => {
    const socket = new FakeSocket();
    const relay = new RemoteSessionRelay({
      relayUrl: "ws://relay.test",
      peerId: "phone",
      websocketFactory: () => socket,
    });
    const received = vi.fn();
    relay.on("encrypted-message", received);
    const connecting = relay.connect();
    socket.emit("open");
    await connecting;

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "message",
          from: "host",
          payload: {
            type: "remote-session.encrypted",
            envelope: { ciphertext: "a" },
          },
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "offline-message",
          originalMessage: {
            type: "message",
            from: "host",
            payload: {
              type: "remote-session.encrypted",
              envelope: { ciphertext: "b" },
            },
          },
        }),
      ),
    );

    expect(received).toHaveBeenNthCalledWith(1, {
      from: "host",
      envelope: { ciphertext: "a" },
    });
    expect(received).toHaveBeenNthCalledWith(2, {
      from: "host",
      envelope: { ciphertext: "b" },
    });
  });

  it("reconnects with backoff and flushes a bounded offline queue", async () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    const timers = [];
    const relay = new RemoteSessionRelay({
      relayUrl: "ws://relay.test",
      peerId: "host",
      websocketFactory: () => sockets.shift(),
      reconnectBaseMs: 100,
      queueLimit: 2,
      setTimer: (callback, delay) => {
        const timer = { callback, delay, unref() {} };
        timers.push(timer);
        return timer;
      },
      clearTimer: vi.fn(),
    });
    const first = relay.connect();
    const firstSocket = relay.ws;
    firstSocket.emit("open");
    await first;
    firstSocket.emit("close");
    expect(timers[0].delay).toBe(100);

    relay.sendEncrypted("phone", { sequence: 1 });
    relay.sendEncrypted("phone", { sequence: 2 });
    relay.sendEncrypted("phone", { sequence: 3 });
    expect(relay.outbox.map((item) => item.payload.envelope.sequence)).toEqual([
      2, 3,
    ]);

    timers[0].callback();
    const secondSocket = relay.ws;
    secondSocket.emit("open");
    await Promise.resolve();
    expect(
      secondSocket.sent.slice(1).map((item) => item.payload.envelope.sequence),
    ).toEqual([2, 3]);
    expect(relay.outbox).toHaveLength(0);
  });

  it("does not reconnect after an explicit close", async () => {
    const socket = new FakeSocket();
    const setTimer = vi.fn();
    const relay = new RemoteSessionRelay({
      relayUrl: "ws://relay.test",
      peerId: "host",
      websocketFactory: () => socket,
      setTimer,
    });
    const connecting = relay.connect();
    socket.emit("open");
    await connecting;
    relay.close();
    expect(setTimer).not.toHaveBeenCalled();
  });
});
