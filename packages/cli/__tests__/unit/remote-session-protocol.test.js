import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteSessionRegistry } from "../../src/harness/remote-session-registry.js";
import { RemoteSessionAuditLog } from "../../src/harness/remote-session-audit.js";
import {
  handleRemoteSessionAudit,
  handleRemoteSessionCreate,
  handleRemoteSessionDevices,
  handleRemoteSessionJoin,
  handleRemoteSessionPolicy,
  handleRemoteSessionPublish,
  handleRemoteSessionPushRegister,
  handleRemoteSessionRevoke,
} from "../../src/gateways/ws/remote-session-protocol.js";
import { parseRemotePairingUri } from "../../src/harness/remote-session-crypto.js";

function socket(name) {
  return { name, sent: [] };
}

describe("remote session WebSocket protocol", () => {
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
      sessionManager: {
        getSession: vi.fn(() => ({
          interaction: { resolveAnswer: vi.fn() },
        })),
      },
      emit: vi.fn(),
      remoteSessionRelayUrl: null,
      remoteSessionPeerId: null,
      remoteSessionCrypto: new Map(),
      remoteSessionPairingSecrets: new Map(),
      remoteSessionAudit: new RemoteSessionAuditLog(),
    };
  });

  it("returns a QR-safe pairing URI when relay settings are configured", () => {
    server.remoteSessionRelayUrl = "wss://relay.example.test";
    server.remoteSessionPeerId = "desktop-peer";
    handleRemoteSessionCreate(server, "host", host, {
      id: "create-relay",
      sessionId: "agent-1",
    });
    const response = host.sent.at(-1);
    expect(parseRemotePairingUri(response.pairing.uri)).toMatchObject({
      relayUrl: "wss://relay.example.test",
      remoteSessionId: response.session.sessionId,
      hostPeerId: "desktop-peer",
      hostPublicKey: response.pairing.hostPublicKey,
      pairingToken: response.pairing.token,
    });
  });

  function createAndJoin(scopes = ["observe", "approve"]) {
    handleRemoteSessionCreate(server, "host", host, {
      id: "create-1",
      sessionId: "agent-1",
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

  it("creates, joins and fans host events out to paired clients", () => {
    const remoteSessionId = createAndJoin();
    handleRemoteSessionPublish(server, "host", host, {
      id: "publish-1",
      remoteSessionId,
      event: { type: "assistant.delta", content: "hello" },
    });

    expect(phone.sent.at(-1)).toMatchObject({
      type: "remote-session-event",
      remoteSessionId,
      agentSessionId: "agent-1",
      event: { type: "assistant.delta", content: "hello" },
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: "remote-session-published",
      delivered: 1,
    });
  });

  it("routes scoped approval responses into the existing session handler", async () => {
    const remoteSessionId = createAndJoin();
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "approve-1",
      remoteSessionId,
      event: { type: "approval.resolve", approvalId: "a-1", approved: true },
    });
    const session = server.sessionManager.getSession.mock.results.at(-1).value;
    // Authority: the echoed approval binding (null here) rides through to the
    // host interaction gate as a 3rd argument.
    expect(session.interaction.resolveAnswer).toHaveBeenCalledWith(
      "a-1",
      true,
      null,
    );
    expect(phone.sent.at(-1)).toMatchObject({
      type: "command.response",
      sessionId: "agent-1",
    });
  });

  it("forwards an echoed approval binding to the host interaction gate", async () => {
    const remoteSessionId = createAndJoin();
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "approve-b",
      remoteSessionId,
      event: {
        type: "approval.resolve",
        approvalId: "a-2",
        approved: true,
        binding: "ab_deadbeef",
      },
    });
    const session = server.sessionManager.getSession.mock.results.at(-1).value;
    expect(session.interaction.resolveAnswer).toHaveBeenCalledWith(
      "a-2",
      true,
      "ab_deadbeef",
    );
  });

  it("stamps log-safe authority provenance on the approval audit", async () => {
    const remoteSessionId = createAndJoin();
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "approve-prov",
      remoteSessionId,
      event: { type: "approval.resolve", approvalId: "a-3", approved: true },
    });
    const entry = server.remoteSessionAudit
      .list({ sessionId: remoteSessionId, action: "control.approval" })
      .at(0);
    expect(entry.actor).toBe("phone");
    // A paired, approve-scoped device speaks with `approve` authority.
    expect(entry.detail.authority).toMatch(/origin=remote/);
    expect(entry.detail.authority).toMatch(/principal=phone/);
    expect(entry.detail.authority).toMatch(/authority=approve/);
  });

  it("routes scoped prompts into the active Agent Session handler", async () => {
    const remoteSessionId = createAndJoin(["observe", "prompt"]);
    const handleMessage = vi.fn(async () => {});
    server.sessionHandlers.set("agent-1", { handleMessage });
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "prompt-1",
      remoteSessionId,
      event: { type: "prompt", content: "continue fixing CI" },
    });
    expect(handleMessage).toHaveBeenCalledWith(
      "continue fixing CI",
      "prompt-1",
    );
  });

  it("lists paired devices for the host and rejects non-host callers", () => {
    const remoteSessionId = createAndJoin();
    handleRemoteSessionDevices(server, "host", host, {
      id: "devices-1",
      remoteSessionId,
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: "remote-session-devices",
      devices: expect.arrayContaining([
        expect.objectContaining({ clientId: "phone", isHost: false }),
        expect.objectContaining({ clientId: "host", isHost: true }),
      ]),
    });

    handleRemoteSessionDevices(server, "phone", phone, {
      id: "devices-2",
      remoteSessionId,
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "error",
      code: "REMOTE_SESSION_DEVICES_ERROR",
    });
  });

  it("revokes a locally connected device and pushes a revocation notice", () => {
    const remoteSessionId = createAndJoin();
    handleRemoteSessionRevoke(server, "host", host, {
      id: "revoke-1",
      remoteSessionId,
      clientId: "phone",
    });

    expect(phone.sent.at(-1)).toMatchObject({
      type: "remote-session-revoked",
      remoteSessionId,
      agentSessionId: "agent-1",
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: "remote-session-revoked",
      revoked: "phone",
      devices: [expect.objectContaining({ clientId: "host" })],
    });

    // A revoked device can no longer publish scoped control events.
    handleRemoteSessionPublish(server, "phone", phone, {
      id: "after-revoke",
      remoteSessionId,
      event: { type: "prompt", content: "still here?" },
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "error",
      code: "REMOTE_SESSION_PUBLISH_ERROR",
    });
  });

  it("rejects revocation attempts from non-host callers", () => {
    const remoteSessionId = createAndJoin();
    handleRemoteSessionRevoke(server, "phone", phone, {
      id: "revoke-x",
      remoteSessionId,
      clientId: "host",
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "error",
      code: "REMOTE_SESSION_REVOKE_ERROR",
    });
  });

  it("sends an encrypted revocation notice to a relay-paired device", () => {
    const remoteSessionId = createAndJoin();
    // Simulate a device reachable only over the relay (no local ws client).
    server.remoteSessions.join({
      sessionId: remoteSessionId,
      clientId: "mobile-peer",
      token: server.remoteSessions.issuePairingToken(remoteSessionId).token,
    });
    const sent = [];
    server.remoteSessionRelay = {
      sendEncrypted: (peerId, envelope) => sent.push({ peerId, envelope }),
    };
    server.remoteSessionCrypto.set(remoteSessionId, {
      encrypt: (peerId, message) => ({ peerId, message }),
    });

    handleRemoteSessionRevoke(server, "host", host, {
      id: "revoke-relay",
      remoteSessionId,
      clientId: "mobile-peer",
    });

    expect(sent).toEqual([
      {
        peerId: "mobile-peer",
        envelope: {
          peerId: "mobile-peer",
          message: { type: "session.revoked", remoteSessionId },
        },
      },
    ]);
  });

  it("blocks unscoped prompts and arbitrary remote runtime events", () => {
    const remoteSessionId = createAndJoin(["observe"]);
    handleRemoteSessionPublish(server, "phone", phone, {
      id: "prompt-1",
      remoteSessionId,
      event: { type: "prompt", content: "do it" },
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "error",
      code: "REMOTE_SESSION_PUBLISH_ERROR",
    });

    handleRemoteSessionPublish(server, "phone", phone, {
      id: "fake-runtime",
      remoteSessionId,
      event: { type: "assistant.delta", content: "spoof" },
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "error",
      message: expect.stringMatching(/host/),
    });
  });

  it("audits lifecycle and control events without recording prompt content", async () => {
    const remoteSessionId = createAndJoin(["observe", "prompt"]);
    server.sessionHandlers.set("agent-1", {
      handleMessage: vi.fn(async () => {}),
    });
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "prompt-audit",
      remoteSessionId,
      event: { type: "prompt", content: "secret plan details" },
    });

    const actions = server.remoteSessionAudit
      .list({ sessionId: remoteSessionId })
      .map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "session.created",
        "device.joined",
        "control.prompt",
      ]),
    );
    const prompt = server.remoteSessionAudit
      .list({ sessionId: remoteSessionId, action: "control.prompt" })
      .at(0);
    expect(prompt.actor).toBe("phone");
    expect(prompt.detail).toEqual({ chars: "secret plan details".length });
    // The prompt content itself must never appear in the audit trail.
    expect(JSON.stringify(prompt)).not.toContain("secret plan details");
  });

  it("returns the audit trail to the host and refuses non-host callers", () => {
    const remoteSessionId = createAndJoin();
    handleRemoteSessionRevoke(server, "host", host, {
      id: "rev",
      remoteSessionId,
      clientId: "phone",
    });

    handleRemoteSessionAudit(server, "host", host, {
      id: "audit-1",
      remoteSessionId,
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: "remote-session-audit",
      remoteSessionId,
      stats: { byAction: expect.objectContaining({ "device.revoked": 1 }) },
    });
    expect(host.sent.at(-1).entries[0]).toMatchObject({
      action: "device.revoked",
      actor: "host",
    });

    // A different member must not be able to read the host's audit trail.
    server.remoteSessions.join({
      sessionId: remoteSessionId,
      clientId: "tablet",
      token: server.remoteSessions.issuePairingToken(remoteSessionId).token,
    });
    const tabletWs = socket("tablet");
    server.clients.set("tablet", { ws: tabletWs });
    handleRemoteSessionAudit(server, "tablet", tabletWs, {
      id: "audit-2",
      remoteSessionId,
    });
    expect(tabletWs.sent.at(-1)).toMatchObject({
      type: "error",
      code: "REMOTE_SESSION_AUDIT_ERROR",
    });
  });

  it("stores a push token carried in the join message", () => {
    handleRemoteSessionCreate(server, "host", host, {
      id: "create-push",
      sessionId: "agent-1",
      scopes: ["observe"],
    });
    const created = host.sent.at(-1);
    handleRemoteSessionJoin(server, "phone", phone, {
      id: "join-push",
      remoteSessionId: created.session.sessionId,
      token: created.pairing.token,
      pushToken: "fcm-token",
      pushProvider: "fcm",
    });
    const devices = server.remoteSessions.listDevices(
      created.session.sessionId,
      "host",
    ).devices;
    expect(devices.find((d) => d.clientId === "phone")).toMatchObject({
      hasPush: true,
      pushProvider: "fcm",
    });
    const joined = server.remoteSessionAudit
      .list({ sessionId: created.session.sessionId, action: "device.joined" })
      .at(0);
    expect(joined.detail).toMatchObject({ via: "direct", hasPush: true });
  });

  it("registers a device's own push token after pairing", () => {
    const remoteSessionId = createAndJoin(["observe"]);
    handleRemoteSessionPushRegister(server, "phone", phone, {
      id: "push-reg",
      remoteSessionId,
      pushToken: "fcm-late",
      pushProvider: "fcm",
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "remote-session-push-registered",
      clientId: "phone",
      hasPush: true,
      provider: "fcm",
    });
    expect(server.remoteSessions.pushTargets(remoteSessionId)).toEqual([
      { clientId: "phone", pushToken: "fcm-late", pushProvider: "fcm" },
    ]);
    const audited = server.remoteSessionAudit
      .list({ sessionId: remoteSessionId, action: "push.registered" })
      .at(0);
    expect(audited).toMatchObject({
      actor: "phone",
      detail: { hasPush: true, provider: "fcm" },
    });
  });

  it("rejects a push registration from a non-member", () => {
    const remoteSessionId = createAndJoin(["observe"]);
    const ghostWs = socket("ghost");
    handleRemoteSessionPushRegister(server, "ghost", ghostWs, {
      id: "push-ghost",
      remoteSessionId,
      pushToken: "x",
    });
    expect(ghostWs.sent.at(-1)).toMatchObject({
      type: "error",
      code: "REMOTE_SESSION_PUSH_REGISTER_ERROR",
    });
  });

  it("registers a refreshed push token via a published push.register event", async () => {
    const remoteSessionId = createAndJoin(["observe"]);
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "push-reg-relay",
      remoteSessionId,
      event: {
        type: "push.register",
        pushToken: "fcm-new",
        pushProvider: "fcm",
      },
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "remote-session-push-registered",
      hasPush: true,
      provider: "fcm",
    });
    expect(server.remoteSessions.pushTargets(remoteSessionId)).toEqual([
      { clientId: "phone", pushToken: "fcm-new", pushProvider: "fcm" },
    ]);
    const audited = server.remoteSessionAudit
      .list({ sessionId: remoteSessionId, action: "push.registered" })
      .at(0);
    expect(audited).toMatchObject({
      actor: "phone",
      detail: { hasPush: true, provider: "fcm", via: "relay" },
    });
  });

  it("clears the push token when push.register omits it", async () => {
    const remoteSessionId = createAndJoin(["observe"]);
    server.remoteSessions.registerPush(remoteSessionId, "phone", {
      token: "old",
      provider: "fcm",
    });
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "push-clear",
      remoteSessionId,
      event: { type: "push.register" },
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "remote-session-push-registered",
      hasPush: false,
    });
    expect(server.remoteSessions.pushTargets(remoteSessionId)).toEqual([]);
  });

  it("rejects a push.register from a non-member", async () => {
    const remoteSessionId = createAndJoin(["observe"]);
    const ghostWs = socket("ghost");
    await handleRemoteSessionPublish(server, "ghost", ghostWs, {
      id: "push-ghost-relay",
      remoteSessionId,
      event: { type: "push.register", pushToken: "x" },
    });
    expect(ghostWs.sent.at(-1)).toMatchObject({
      type: "error",
      code: "REMOTE_SESSION_PUBLISH_ERROR",
    });
  });

  it("reports the active org policy to any authenticated client", () => {
    handleRemoteSessionPolicy(server, "phone", phone, { id: "policy-1" });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "remote-session-policy",
      policy: {
        allowedScopes: null,
        maxDevices: null,
        allowRelayPairing: true,
      },
    });
  });

  // Phase 5: control-event idempotency. The takeover path (a paired device
  // driving the host agent via prompt/approval/interrupt) must run its side
  // effect AT MOST ONCE when the event carries a stable commandId, so a device
  // that re-sends after a dropped connection does not run the agent turn twice.
  describe("commandId idempotency on the control path", () => {
    it("forwards a prompt once and returns `replayed` on a re-send (no second agent turn)", async () => {
      const remoteSessionId = createAndJoin(["observe", "prompt"]);
      const handleMessage = vi.fn(async () => {});
      server.sessionHandlers.set("agent-1", { handleMessage });

      const send = () =>
        handleRemoteSessionPublish(server, "phone", phone, {
          id: "prompt-1",
          commandId: "cmd-abc",
          remoteSessionId,
          event: { type: "prompt", content: "deploy to staging" },
        });

      await send(); // fresh delivery
      await send(); // reconnect re-send of the SAME commandId

      // The agent turn was dispatched exactly once…
      expect(handleMessage).toHaveBeenCalledTimes(1);
      // …and the re-send got a replayed ack rather than a second execution.
      expect(phone.sent.at(-1)).toMatchObject({
        type: "remote-session-published",
        replayed: true,
        commandId: "cmd-abc",
      });
    });

    it("dedups a RELAY-shaped message whose commandId is nested in `event` (mobile takeover path)", async () => {
      // `_handleRemoteEncryptedControl` decrypts the mobile's whole control
      // payload into `message.event`, so its commandId arrives at
      // `event.commandId`, NOT the message top level. Before the fix the ledger
      // was never consulted for this (primary) path and a reconnect re-ran the
      // agent turn.
      const remoteSessionId = createAndJoin(["observe", "prompt"]);
      const handleMessage = vi.fn(async () => {});
      server.sessionHandlers.set("agent-1", { handleMessage });

      const send = () =>
        handleRemoteSessionPublish(server, "phone", phone, {
          id: "remote-1",
          remoteSessionId,
          // No top-level commandId — exactly the relay wrapper's shape.
          event: {
            type: "prompt",
            content: "deploy to staging",
            commandId: "cmd-relay",
            seq: 1,
          },
        });

      await send(); // fresh delivery over relay
      await send(); // reconnect re-send of the SAME nested commandId

      expect(handleMessage).toHaveBeenCalledTimes(1);
      expect(phone.sent.at(-1)).toMatchObject({
        type: "remote-session-published",
        replayed: true,
        commandId: "cmd-relay",
      });
    });

    it("forwards a DIFFERENT commandId as a new command", async () => {
      const remoteSessionId = createAndJoin(["observe", "prompt"]);
      const handleMessage = vi.fn(async () => {});
      server.sessionHandlers.set("agent-1", { handleMessage });

      await handleRemoteSessionPublish(server, "phone", phone, {
        id: "prompt-1",
        commandId: "cmd-1",
        remoteSessionId,
        event: { type: "prompt", content: "first" },
      });
      await handleRemoteSessionPublish(server, "phone", phone, {
        id: "prompt-2",
        commandId: "cmd-2",
        remoteSessionId,
        event: { type: "prompt", content: "second" },
      });

      expect(handleMessage).toHaveBeenCalledTimes(2);
    });

    it("does NOT dedup when no commandId is present (opt-in, byte-identical)", async () => {
      const remoteSessionId = createAndJoin(["observe", "prompt"]);
      const handleMessage = vi.fn(async () => {});
      server.sessionHandlers.set("agent-1", { handleMessage });

      const send = () =>
        handleRemoteSessionPublish(server, "phone", phone, {
          id: "prompt-x",
          remoteSessionId,
          event: { type: "prompt", content: "no id" },
        });
      await send();
      await send();

      // Without a commandId the ledger is never consulted → each send forwards.
      expect(handleMessage).toHaveBeenCalledTimes(2);
      expect(server._remoteControlLedger).toBeUndefined();
    });

    it("resolves an approval once across a re-send with the same commandId", async () => {
      const remoteSessionId = createAndJoin(["observe", "approve"]);
      await handleRemoteSessionPublish(server, "phone", phone, {
        id: "approve-1",
        commandId: "appr-1",
        remoteSessionId,
        event: { type: "approval.resolve", approvalId: "a-1", approved: true },
      });
      const resolveAnswer =
        server.sessionManager.getSession.mock.results.at(-1).value.interaction
          .resolveAnswer;
      await handleRemoteSessionPublish(server, "phone", phone, {
        id: "approve-1",
        commandId: "appr-1", // reconnect re-send
        remoteSessionId,
        event: { type: "approval.resolve", approvalId: "a-1", approved: true },
      });
      expect(resolveAnswer).toHaveBeenCalledTimes(1);
      expect(phone.sent.at(-1)).toMatchObject({
        type: "remote-session-published",
        replayed: true,
        commandId: "appr-1",
      });
    });

    it("coalesces CONCURRENT re-deliveries of the same commandId to a single forward", async () => {
      const remoteSessionId = createAndJoin(["observe", "approve"]);
      // A slow, controllable resolve so both deliveries overlap in-flight.
      let release;
      const gate = new Promise((r) => (release = r));
      let calls = 0;
      server.sessionManager.getSession = vi.fn(() => ({
        interaction: {
          resolveAnswer: vi.fn(async () => {
            calls += 1;
            await gate;
          }),
        },
      }));
      const pub = (id) =>
        handleRemoteSessionPublish(server, "phone", phone, {
          id,
          commandId: "race-1",
          remoteSessionId,
          event: {
            type: "approval.resolve",
            approvalId: "a-1",
            approved: true,
          },
        });
      const both = Promise.all([pub("r-a"), pub("r-b")]); // fired same tick
      release();
      await both;
      // The side effect ran once despite two overlapping deliveries.
      expect(calls).toBe(1);
    });

    it("keeps prompt validation identical whether or not a commandId is present", async () => {
      const remoteSessionId = createAndJoin(["observe", "prompt"]);
      await handleRemoteSessionPublish(server, "phone", phone, {
        id: "prompt-bad",
        commandId: "cmd-bad",
        remoteSessionId,
        event: { type: "prompt", content: "   " }, // blank → invalid
      });
      expect(phone.sent.at(-1)).toMatchObject({
        type: "error",
        code: "REMOTE_SESSION_PUBLISH_ERROR",
      });
      // A rejected-before-dispatch prompt must not have consumed the commandId:
      // a corrected re-send with the same id still executes.
      const handleMessage = vi.fn(async () => {});
      server.sessionHandlers.set("agent-1", { handleMessage });
      await handleRemoteSessionPublish(server, "phone", phone, {
        id: "prompt-bad",
        commandId: "cmd-bad",
        remoteSessionId,
        event: { type: "prompt", content: "now valid" },
      });
      expect(handleMessage).toHaveBeenCalledTimes(1);
    });
  });
});
