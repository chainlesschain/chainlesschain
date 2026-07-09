/**
 * Batch-18 protocol extension: control events for CLIENT-HOSTED remote
 * sessions (agent session NOT in the server's sessionManager) are forwarded
 * to the HOST connection instead of being dispatched server-side; host
 * publishes gain relay delivery + approval push wake parity with the
 * server-hosted mirror path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteSessionRegistry } from "../../src/harness/remote-session-registry.js";
import { RemoteSessionAuditLog } from "../../src/harness/remote-session-audit.js";
import {
  handleRemoteSessionCreate,
  handleRemoteSessionJoin,
  handleRemoteSessionPublish,
} from "../../src/gateways/ws/remote-session-protocol.js";

function socket(name) {
  return { name, sent: [] };
}

describe("client-hosted remote session control forwarding", () => {
  let server;
  let host;
  let phone;

  beforeEach(() => {
    host = socket("host");
    phone = socket("phone");
    server = {
      remoteSessions: new RemoteSessionRegistry(),
      clients: new Map([
        ["host", { ws: host }],
        ["phone", { ws: phone }],
      ]),
      _send(ws, message) {
        ws.sent.push(message);
      },
      sessionHandlers: new Map(),
      // Client-hosted: the server has NO record of the agent session.
      sessionManager: { getSession: vi.fn(() => null) },
      emit: vi.fn(),
      remoteSessionRelayUrl: null,
      remoteSessionPeerId: null,
      remoteSessionCrypto: new Map(),
      remoteSessionPairingSecrets: new Map(),
      remoteSessionAudit: new RemoteSessionAuditLog(),
    };
  });

  function createAndJoin(scopes = ["observe", "approve", "prompt"]) {
    handleRemoteSessionCreate(server, "host", host, {
      id: "create-1",
      sessionId: "local-agent-1",
      scopes,
    });
    const created = host.sent.at(-1);
    handleRemoteSessionJoin(server, "phone", phone, {
      id: "join-1",
      remoteSessionId: created.session.sessionId,
      token: created.pairing.token,
    });
    return created.session.sessionId;
  }

  it("forwards approval.resolve to the host connection", async () => {
    const remoteSessionId = createAndJoin();
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "approve-1",
      remoteSessionId,
      event: { type: "approval.resolve", requestId: "ra-1", answer: true },
    });

    const forwarded = host.sent.at(-1);
    expect(forwarded).toMatchObject({
      type: "remote-session-control",
      remoteSessionId,
      agentSessionId: "local-agent-1",
      from: "phone",
      event: { type: "approval.resolve", requestId: "ra-1", answer: true },
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "remote-session-published",
      delivered: 1,
      forwardedToHost: true,
    });
    const audits = server.remoteSessionAudit.list({
      sessionId: remoteSessionId,
    });
    expect(
      audits.some(
        (entry) =>
          entry.action === "control.approval" &&
          entry.detail?.forwarded === true,
      ),
    ).toBe(true);
  });

  it("forwards prompts and interrupts the same way", async () => {
    const remoteSessionId = createAndJoin(["observe", "prompt", "interrupt"]);
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "prompt-1",
      remoteSessionId,
      event: { type: "prompt", content: "run the tests" },
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: "remote-session-control",
      event: { type: "prompt", content: "run the tests" },
    });

    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "int-1",
      remoteSessionId,
      event: { type: "interrupt" },
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: "remote-session-control",
      event: { type: "interrupt" },
    });
  });

  it("errors without consuming the commandId when the host is unreachable", async () => {
    const remoteSessionId = createAndJoin();
    server.clients.delete("host");

    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "approve-2",
      remoteSessionId,
      commandId: "cmd-retry-1",
      event: { type: "approval.resolve", requestId: "ra-2", answer: true },
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "error",
      code: "REMOTE_SESSION_PUBLISH_ERROR",
    });

    // Host reconnects → the SAME commandId must still apply (not "replayed").
    server.clients.set("host", { ws: host });
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "approve-3",
      remoteSessionId,
      commandId: "cmd-retry-1",
      event: { type: "approval.resolve", requestId: "ra-2", answer: true },
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: "remote-session-control",
      event: { requestId: "ra-2" },
    });
  });

  it("keeps server-hosted dispatch byte-identical", async () => {
    const resolveAnswer = vi.fn();
    server.sessionManager = {
      getSession: vi.fn(() => ({ interaction: { resolveAnswer } })),
    };
    const remoteSessionId = createAndJoin();
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "approve-4",
      remoteSessionId,
      event: { type: "approval.resolve", approvalId: "a-9", approved: false },
    });
    expect(resolveAnswer).toHaveBeenCalledWith("a-9", false);
    expect(host.sent.some((m) => m.type === "remote-session-control")).toBe(
      false,
    );
  });
});

describe("host publish parity (relay + push wake)", () => {
  let server;
  let host;

  beforeEach(() => {
    host = socket("host");
    server = {
      remoteSessions: new RemoteSessionRegistry(),
      clients: new Map([["host", { ws: host }]]),
      _send(ws, message) {
        ws.sent.push(message);
      },
      sessionHandlers: new Map(),
      sessionManager: { getSession: vi.fn(() => null) },
      emit: vi.fn(),
      remoteSessionRelayUrl: null,
      remoteSessionPeerId: null,
      remoteSessionCrypto: new Map(),
      remoteSessionPairingSecrets: new Map(),
      remoteSessionAudit: new RemoteSessionAuditLog(),
      _dispatchApprovalPush: vi.fn(),
    };
  });

  function createSessionWithRelayMember() {
    handleRemoteSessionCreate(server, "host", host, {
      id: "create-1",
      sessionId: "local-agent-1",
      scopes: ["observe", "approve"],
    });
    const created = host.sent.at(-1);
    // Join a device then simulate relay-only presence: drop its local socket
    // and register a push token.
    const phone = socket("phone");
    server.clients.set("relay-phone", { ws: phone });
    handleRemoteSessionJoin(server, "relay-phone", phone, {
      id: "join-1",
      remoteSessionId: created.session.sessionId,
      token: created.pairing.token,
      pushToken: "push-tok-1",
      pushProvider: "fcm",
    });
    server.clients.delete("relay-phone");
    return created.session.sessionId;
  }

  it("delivers host events to relay-only members via the E2EE relay", async () => {
    const remoteSessionId = createSessionWithRelayMember();
    const sendEncrypted = vi.fn();
    const encrypt = vi.fn((to, data) => ({ enc: true, to, data }));
    server.remoteSessionRelay = { sendEncrypted };
    server.remoteSessionCrypto.set(remoteSessionId, { encrypt });

    await handleRemoteSessionPublish(server, "host", host, {
      id: "pub-1",
      remoteSessionId,
      event: {
        type: "permission.request",
        requestId: "ra-7",
        tool: "run_shell",
      },
    });

    expect(encrypt).toHaveBeenCalledWith(
      "relay-phone",
      expect.objectContaining({
        type: "remote-session-event",
        event: expect.objectContaining({ requestId: "ra-7" }),
      }),
    );
    expect(sendEncrypted).toHaveBeenCalled();
    expect(host.sent.at(-1)).toMatchObject({
      type: "remote-session-published",
      delivered: 1,
    });
  });

  it("wakes push-registered members for permission.request events only", async () => {
    const remoteSessionId = createSessionWithRelayMember();

    await handleRemoteSessionPublish(server, "host", host, {
      id: "pub-2",
      remoteSessionId,
      event: { type: "permission.request", requestId: "ra-8" },
    });
    expect(server._dispatchApprovalPush).toHaveBeenCalledTimes(1);
    const [, member, data] = server._dispatchApprovalPush.mock.calls[0];
    expect(member.pushToken).toBe("push-tok-1");
    expect(data.requestId).toBe("ra-8");

    await handleRemoteSessionPublish(server, "host", host, {
      id: "pub-3",
      remoteSessionId,
      event: { type: "permission.resolved", requestId: "ra-8", approved: true },
    });
    // "resolved" is not a wake-worthy event.
    expect(server._dispatchApprovalPush).toHaveBeenCalledTimes(1);
  });
});
