import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChainlessChainWSServer } from "../../src/gateways/ws/ws-server.js";
import { RemoteSessionAuditFileSink } from "../../src/harness/remote-session-audit-sink.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

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

  it("wakes a push-registered observer for approval requests only", async () => {
    const sender = vi.fn(async () => ({ id: "msg" }));
    const server = new ChainlessChainWSServer({
      remoteSessionPushSender: sender,
    });
    const host = socket();
    const phone = socket();
    server.clients.set("host", { ws: host, authenticated: true });
    server.clients.set("phone", { ws: phone, authenticated: true });
    const created = server.remoteSessions.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
      scopes: ["observe", "approve"],
    });
    server.remoteSessions.join({
      sessionId: created.session.sessionId,
      clientId: "phone",
      token: created.pairing.token,
      pushToken: "fcm-token",
      pushProvider: "fcm",
    });

    // A normal output event mirrors but does NOT wake the device.
    server._send(host, { type: "assistant.delta", sessionId: "agent-1" });
    await flush();
    expect(sender).not.toHaveBeenCalled();

    // An approval request fires exactly one wake-up.
    server._send(host, {
      type: "approval_request",
      sessionId: "agent-1",
      requestId: "req-1",
    });
    await flush();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "fcm-token",
        provider: "fcm",
        sessionId: created.session.sessionId,
        clientId: "phone",
      }),
    );
    // The wake-up is audited as push.sent.
    const actions = server.remoteSessionAudit
      .list({ sessionId: created.session.sessionId })
      .map((e) => e.action);
    expect(actions).toContain("push.sent");
  });

  it("does not attempt push when no sender is configured", async () => {
    const server = new ChainlessChainWSServer();
    const host = socket();
    const phone = socket();
    server.clients.set("host", { ws: host, authenticated: true });
    server.clients.set("phone", { ws: phone, authenticated: true });
    const created = server.remoteSessions.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
      scopes: ["observe", "approve"],
    });
    server.remoteSessions.join({
      sessionId: created.session.sessionId,
      clientId: "phone",
      token: created.pairing.token,
      pushToken: "fcm-token",
      pushProvider: "fcm",
    });
    expect(server.remoteSessionPush.enabled).toBe(false);
    server._send(host, {
      type: "approval_request",
      sessionId: "agent-1",
      requestId: "req-1",
    });
    await flush();
    // No sender → dispatcher short-circuits, so nothing is even audited.
    const actions = server.remoteSessionAudit
      .list({ sessionId: created.session.sessionId })
      .map((e) => e.action);
    expect(actions).not.toContain("push.sent");
    expect(actions).not.toContain("push.skipped");
  });
});

describe("Remote Session durable audit sink wiring", () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-audit-ws-"));
    file = path.join(dir, "audit.jsonl");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("persists audit entries through an injected sink and hydrates a fresh server", () => {
    const sink = new RemoteSessionAuditFileSink({ path: file });
    const server = new ChainlessChainWSServer({ remoteSessionAuditSink: sink });
    const created = server.remoteSessions.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    // create() itself does not audit; drive one lifecycle event explicitly.
    server.remoteSessionAudit.record({
      sessionId: created.session.sessionId,
      actor: "host",
      action: "session.created",
    });
    expect(sink.readAll().map((e) => e.action)).toEqual(["session.created"]);

    // A brand-new server over the same file recovers the trail on startup.
    const restarted = new ChainlessChainWSServer({
      remoteSessionAuditSink: new RemoteSessionAuditFileSink({ path: file }),
    });
    expect(
      restarted.remoteSessionAudit
        .list({ sessionId: created.session.sessionId })
        .map((e) => e.action),
    ).toEqual(["session.created"]);
  });

  it("keeps the audit log in-memory-only when no sink is configured", () => {
    const server = new ChainlessChainWSServer();
    expect(server.remoteSessionAuditSink).toBeNull();
    server.remoteSessionAudit.record({
      sessionId: "s1",
      action: "session.created",
    });
    // Nothing was written to disk (no file path exists to check, but the sink
    // being null is the contract the wiring guarantees).
    expect(server.remoteSessionAudit.list({ sessionId: "s1" })).toHaveLength(1);
  });
});
