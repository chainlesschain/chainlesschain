/**
 * Integration: `cc remote-control start` against a REAL WebSocket server —
 * boots the host, creates the remote session over the loopback host client,
 * emits a loopback-safe direct pairing URI, and a second client actually joins
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

  async function startHost({
    port = TEST_PORT,
    json = true,
    allowLan = undefined,
    lanAddress = "192.168.50.20",
    config = {},
  } = {}) {
    const logs = [];
    const errs = [];
    const warns = [];
    let startOptions;
    const result = await runRemoteControlStart(
      {
        port: String(port),
        token: TOKEN,
        session: "agent-int-1",
        scopes: "observe,prompt,approve",
        allowApprove: true,
        json,
        qr: false,
        allowLan,
      },
      {
        stateDir,
        env: {},
        loadConfig: () => config,
        lanAddress,
        log: (m) => logs.push(m),
        err: (m) => errs.push(m),
        approvalStateFile: path.join(stateDir, "approval", "state.json"),
        membershipHostStateFile: path.join(stateDir, "host", "state.json"),
        membershipHostWitnessFile: path.join(stateDir, "host", "witness.json"),
        warn: (m) => warns.push(m),
        startServer: async (resolved) => {
          startOptions = resolved;
          server = new ChainlessChainWSServer({
            port: resolved.port,
            host: resolved.host,
            token: resolved.token,
            remoteMembershipCoordinatorOptions: {
              stateFile: path.join(stateDir, "coordinator", "state.json"),
              keyFile: path.join(stateDir, "coordinator", "key.json"),
              witnessFile: path.join(stateDir, "coordinator", "witness.json"),
            },
          });
          await server.start();
          return server;
        },
      },
    );
    if (result.bridge) handles.push(result.bridge);
    else if (result.client) handles.push(result.client);
    return { result, logs, errs, warns, startOptions };
  }

  it("defaults to loopback, pairs locally end-to-end, and reports status/stop", async () => {
    const { result, logs, errs, warns, startOptions } = await startHost();
    expect(errs).toEqual([]);
    expect(warns).toEqual([]);
    expect(result.code).toBe(0);
    expect(startOptions).toMatchObject({
      host: "127.0.0.1",
      allowLan: false,
      lanAccessible: false,
    });

    const output = JSON.parse(logs.join("\n"));
    expect(output.mode).toBe("direct");
    expect(output.wsUrl).toBe(`ws://127.0.0.1:${TEST_PORT}`);
    expect(output.exposure).toBe("loopback");
    expect(output.host).toBe("127.0.0.1");
    expect(output.lanAccessible).toBe(false);
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

  it("uses direct LAN pairing only with --allow-lan and emits a risk warning", async () => {
    const { result, logs, errs, warns, startOptions } = await startHost({
      allowLan: true,
      lanAddress: "192.168.50.20",
    });
    expect(errs).toEqual([]);
    expect(result.code).toBe(0);
    expect(startOptions).toMatchObject({
      host: "0.0.0.0",
      allowLan: true,
      lanAccessible: true,
    });
    expect(server.host).toBe("0.0.0.0");
    expect(warns.join("\n")).toMatch(/trusted network/i);
    expect(warns.join("\n")).toMatch(/plaintext ws:\/\//i);

    const output = JSON.parse(logs.join("\n"));
    expect(output).toMatchObject({
      mode: "direct",
      exposure: "direct-lan",
      host: "0.0.0.0",
      lanAccessible: true,
      wsUrl: `ws://192.168.50.20:${TEST_PORT}`,
    });
    expect(parseDirectPairingUri(output.pairingUri).wsUrl).toBe(
      `ws://192.168.50.20:${TEST_PORT}`,
    );
  });

  it("ignores a legacy LAN config host and prints the migration warning", async () => {
    const { result, logs, warns, startOptions } = await startHost({
      config: { remoteControl: { host: "0.0.0.0" } },
    });
    expect(result.code).toBe(0);
    expect(startOptions.host).toBe("127.0.0.1");
    expect(warns.join("\n")).toMatch(/exposure settings.*--host\/--allow-lan/);
    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      exposure: "loopback",
      wsUrl: `ws://127.0.0.1:${TEST_PORT}`,
    });
  });

  it("rejects a non-loopback --host before opening a listener", async () => {
    const startServer = vi.fn();
    const errs = [];
    const result = await runRemoteControlStart(
      {
        host: "0.0.0.0",
        token: TOKEN,
        session: "agent-int-1",
      },
      {
        stateDir,
        env: {},
        loadConfig: () => ({}),
        startServer,
        log: () => {},
        err: (message) => errs.push(message),
      },
    );
    expect(result.code).toBe(4);
    expect(errs.join("\n")).toMatch(/--allow-lan/);
    expect(startServer).not.toHaveBeenCalled();
  });

  it("fails closed before listening when wildcard LAN has no private address", async () => {
    const startServer = vi.fn(async () => ({ stop: vi.fn(async () => {}) }));
    const createClient = vi.fn();
    const errs = [];
    const result = await runRemoteControlStart(
      {
        port: String(TEST_PORT),
        token: TOKEN,
        session: "agent-int-1",
        allowLan: true,
        json: true,
      },
      {
        stateDir,
        env: {},
        loadConfig: () => ({}),
        startServer,
        createClient,
        pickLanAddress: () => null,
        log: () => {},
        warn: () => {},
        err: (message) => errs.push(message),
      },
    );
    expect(result.code).toBe(4);
    expect(errs.join("\n")).toMatch(/no private LAN address/i);
    expect(startServer).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(fs.readdirSync(stateDir)).toEqual([]);
  });

  it("tears down a live listener when state publication fails", async () => {
    const stop = vi.fn(async () => {});
    const bridge = {
      client: {},
      remoteSessionId: "remote-state-fail-1",
      pairing: {
        token: "pair-token",
        scopes: ["observe"],
        expiresAt: 123,
      },
      start: vi.fn(async () => {}),
      pairingInfo: vi.fn(() => ({ uri: "chainlesschain://direct/test" })),
      close: vi.fn(async () => {}),
    };
    const result = await runRemoteControlStart(
      {
        port: String(TEST_PORT),
        token: TOKEN,
        session: "agent-int-1",
        json: true,
      },
      {
        stateDir,
        env: {},
        loadConfig: () => ({}),
        startServer: async () => ({ stop }),
        createBridge: () => bridge,
        writeState: () => {
          throw new Error("state disk unavailable");
        },
        log: () => {},
        warn: () => {},
        err: () => {},
      },
    );
    expect(result.code).toBe(1);
    expect(bridge.close).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("keeps relay pairing on the default loopback listener", async () => {
    const logs = [];
    const warns = [];
    const startServer = vi.fn(async () => ({ stop: vi.fn(async () => {}) }));
    const bridge = {
      client: {},
      remoteSessionId: "remote-relay-1",
      pairing: {
        uri: "chainlesschain://remote-session/relay-1",
        token: "pair-token",
        scopes: ["observe"],
        expiresAt: 123,
      },
      start: vi.fn(async () => {}),
      pairingInfo: vi.fn(() => ({
        uri: "chainlesschain://remote-session/relay-1",
      })),
      close: vi.fn(async () => {}),
    };
    const result = await runRemoteControlStart(
      {
        port: String(TEST_PORT),
        token: TOKEN,
        session: "agent-int-1",
        relayUrl: "wss://relay.example",
        scopes: "observe",
        json: true,
      },
      {
        stateDir,
        env: {},
        loadConfig: () => ({}),
        startServer,
        createBridge: () => bridge,
        log: (message) => logs.push(message),
        warn: (message) => warns.push(message),
        err: () => {},
      },
    );
    handles.push(bridge);

    expect(result.code).toBe(0);
    expect(startServer).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1",
        relayUrl: "wss://relay.example",
        lanAccessible: false,
      }),
    );
    expect(warns).toEqual([]);
    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      mode: "relay",
      exposure: "outbound-relay",
      pairingUri: "chainlesschain://remote-session/relay-1",
    });
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
