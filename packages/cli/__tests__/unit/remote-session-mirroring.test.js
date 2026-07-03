import { describe, expect, it } from "vitest";
import { ChainlessChainWSServer } from "../../src/gateways/ws/ws-server.js";

function socket() {
  return {
    OPEN: 1,
    readyState: 1,
    messages: [],
    send(value) {
      this.messages.push(JSON.parse(value));
    },
  };
}

describe("Remote Session automatic Agent event mirroring", () => {
  it("mirrors host session envelopes only to paired observe members", () => {
    const server = new ChainlessChainWSServer();
    const host = socket();
    const observer = socket();
    const controller = socket();
    server.clients.set("host", { ws: host, authenticated: true });
    server.clients.set("observer", { ws: observer, authenticated: true });
    server.clients.set("controller", { ws: controller, authenticated: true });

    const observed = server.remoteSessions.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
      scopes: ["observe"],
    });
    server.remoteSessions.join({
      sessionId: observed.session.sessionId,
      clientId: "observer",
      token: observed.pairing.token,
    });
    const controlled = server.remoteSessions.issuePairingToken(
      observed.session.sessionId,
      { scopes: ["interrupt"] },
    );
    server.remoteSessions.join({
      sessionId: observed.session.sessionId,
      clientId: "controller",
      token: controlled.token,
    });

    server._send(host, {
      type: "assistant.delta",
      sessionId: "agent-1",
      payload: { content: "hello" },
    });

    expect(observer.messages).toHaveLength(1);
    expect(observer.messages[0]).toMatchObject({
      type: "remote-session-event",
      agentSessionId: "agent-1",
      event: { type: "assistant.delta", sessionId: "agent-1" },
    });
    expect(controller.messages).toHaveLength(0);
  });

  it("does not mirror unrelated sessions or remote wrapper events", () => {
    const server = new ChainlessChainWSServer();
    const host = socket();
    const phone = socket();
    server.clients.set("host", { ws: host, authenticated: true });
    server.clients.set("phone", { ws: phone, authenticated: true });
    const created = server.remoteSessions.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    server.remoteSessions.join({
      sessionId: created.session.sessionId,
      clientId: "phone",
      token: created.pairing.token,
    });

    server._send(host, { type: "assistant.delta", sessionId: "other" });
    server._send(host, { type: "remote-session-event", sessionId: "agent-1" });
    expect(phone.messages).toHaveLength(0);
  });
});
