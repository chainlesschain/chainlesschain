/**
 * Integration: `cc remote-control start` against a REAL WebSocket server —
 * boots the host, creates the remote session over the loopback host client,
 * emits a direct-LAN pairing URI, and a second (device) client actually joins
 * with the one-time pairing token. Exercises the full unified-entry path
 * minus the heavy runtime bootstrap (session pre-supplied via --session).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { ChainlessChainWSServer } from "../../src/gateways/ws/ws-server.js";
import { WsRpcClient } from "../../src/lib/ws-rpc-client.js";
import {
  runRemoteControlStart,
  runRemoteControlStatus,
  runRemoteControlStop,
} from "../../src/commands/remote-control.js";
import { parseDirectPairingUri } from "../../src/lib/remote-control.js";
import {
  createRemoteMembershipPrincipalCredential,
  signRemoteMembershipAuthenticationChallenge,
} from "../../src/lib/remote-membership-coordinator.js";

vi.setConfig({ testTimeout: 15_000 });

const TEST_PORT = 18930 + Math.floor(Math.random() * 50);
const TOKEN = "rc-integration-token";

describe("remote-control unified entry (integration)", () => {
  let stateDir;
  let server;
  let handles = [];

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-rc-int-"));
  });

  afterEach(async () => {
    for (const handle of handles) {
      try {
        await handle.close?.();
      } catch {
        // already closed
      }
    }
    handles = [];
    if (server) {
      await server.stop().catch(() => undefined);
      server = null;
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  async function startHost({ port = TEST_PORT, json = true } = {}) {
    const logs = [];
    const errs = [];
    const result = await runRemoteControlStart(
      {
        port: String(port),
        token: TOKEN,
        session: "agent-int-1",
        scopes: "observe,prompt,approve",
        allowApprove: true,
        json,
        qr: false,
      },
      {
        stateDir,
        env: {},
        loadConfig: () => ({}),
        lanAddress: "127.0.0.1",
        log: (m) => logs.push(m),
        err: (m) => errs.push(m),
        approvalStateFile: path.join(stateDir, "approval", "state.json"),
        membershipHostStateFile: path.join(stateDir, "host", "state.json"),
        membershipHostWitnessFile: path.join(
          stateDir,
          "host",
          "witness.json",
        ),
        startServer: async (resolved) => {
          server = new ChainlessChainWSServer({
            port: resolved.port,
            host: resolved.host,
            token: resolved.token,
            remoteMembershipCoordinatorOptions: {
              stateFile: path.join(stateDir, "coordinator", "state.json"),
              keyFile: path.join(stateDir, "coordinator", "key.json"),
              witnessFile: path.join(
                stateDir,
                "coordinator",
                "witness.json",
              ),
            },
          });
          await server.start();
          return server;
        },
      },
    );
    if (result.bridge) handles.push(result.bridge);
    return { result, logs, errs };
  }

  it("starts, pairs a device end-to-end, and reports status/stop", async () => {
    const { result, logs, errs } = await startHost();
    expect(errs).toEqual([]);
    expect(result.code).toBe(0);

    const output = JSON.parse(logs.join("\n"));
    expect(output.mode).toBe("direct");
    expect(output.wsUrl).toBe(`ws://127.0.0.1:${TEST_PORT}`);
    expect(output.agentSessionId).toBe("agent-int-1");
    expect(output.remoteSessionId).toBeTruthy();

    // The pairing URI round-trips and carries the essentials for a device.
    const payload = parseDirectPairingUri(output.pairingUri);
    expect(payload).toMatchObject({
      transport: "direct",
      serverToken: TOKEN,
      remoteSessionId: output.remoteSessionId,
      agentSessionId: "agent-int-1",
      scopes: ["observe", "prompt", "approve"],
      durableMembership: true,
    });
    expect(payload.wsUrl).toBe(`ws://127.0.0.1:${TEST_PORT}`);

    // A DEVICE actually joins using nothing but the URI payload.
    const device = new WsRpcClient({ url: payload.wsUrl });
    handles.push(device);
    await device.connect();
    await device.auth(payload.serverToken);
    const credential = createRemoteMembershipPrincipalCredential();
    const challenged = await device.request("remote-session-join-challenge", {
      remoteSessionId: payload.remoteSessionId,
      token: payload.pairingToken,
      credentialPublicKey: credential.publicKey,
      capabilities: ["approval-binding-v1"],
    });
    const joined = await device.request("remote-session-join", {
      remoteSessionId: payload.remoteSessionId,
      challengeId: challenged.challenge.challengeId,
      signature: signRemoteMembershipAuthenticationChallenge(
        challenged.challenge,
        credential.privateKeyPkcs8,
      ),
    });
    expect(joined.type).toBe("remote-session-joined");
    expect(joined.member.scopes).toEqual(["approve", "observe", "prompt"]);

    // The one-time token is consumed — a second challenge must fail.
    const thief = new WsRpcClient({ url: payload.wsUrl });
    handles.push(thief);
    await thief.connect();
    await thief.auth(payload.serverToken);
    await expect(
      thief.request("remote-session-join-challenge", {
        remoteSessionId: payload.remoteSessionId,
        token: payload.pairingToken,
        credentialPublicKey:
          createRemoteMembershipPrincipalCredential().publicKey,
      }),
    ).rejects.toThrow(/missing or expired|Invalid pairing token/);

    // Discovery state reflects the running host…
    const statusLogs = [];
    runRemoteControlStatus(
      { json: true },
      { stateDir, log: (m) => statusLogs.push(m) },
    );
    const states = JSON.parse(statusLogs.join("\n"));
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      port: TEST_PORT,
      alive: true,
      mode: "direct",
      exposure: "loopback",
      agentSessionId: "agent-int-1",
    });
    // …and never leaks the server token through status output.
    expect(states[0].token).toBeUndefined();
    expect(fs.readFileSync(states[0].stateFile, "utf8")).not.toContain(TOKEN);

    // stop() with an injected kill cleans the record without killing vitest.
    const kill = vi.fn();
    const stopCode = runRemoteControlStop(
      { port: String(TEST_PORT) },
      { stateDir, kill, log: () => {}, err: () => {} },
    );
    expect(stopCode).toBe(0);
    expect(kill).toHaveBeenCalledWith(process.pid);
    const after = [];
    runRemoteControlStatus(
      { json: true },
      { stateDir, log: (m) => after.push(m) },
    );
    expect(JSON.parse(after.join("\n"))).toHaveLength(0);
  });

  it("refuses to double-start on a live port", async () => {
    const first = await startHost();
    expect(first.result.code).toBe(0);

    const errs = [];
    const second = await runRemoteControlStart(
      { port: String(TEST_PORT), token: TOKEN, session: "agent-int-2" },
      {
        stateDir,
        env: {},
        loadConfig: () => ({}),
        err: (m) => errs.push(m),
        log: () => {},
        startServer: async () => {
          throw new Error("should not be called");
        },
      },
    );
    expect(second.code).toBe(2);
    expect(errs.join("\n")).toMatch(/already running/);
  });
});
