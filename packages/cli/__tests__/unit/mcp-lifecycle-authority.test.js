import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MCP_LIFECYCLE_ERROR_CODES,
  MCP_LIFECYCLE_PHASES,
  McpLifecycleAuthority,
} from "../../src/lib/mcp-lifecycle-authority.js";

const roots = new Set();

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-lifecycle-"));
  roots.add(root);
  const statePath = path.join(root, "authority.json");
  let now = 1_000;
  let owner = 0;
  let attempt = 0;
  const options = {
    statePath,
    now: () => now++,
    createOwnerId: () =>
      `mcp-owner-00000000-0000-4000-8000-${String(++owner).padStart(12, "0")}`,
    createAttemptId: () =>
      `mcp-attempt-00000000-0000-4000-8000-${String(++attempt).padStart(12, "0")}`,
  };
  return { authority: new McpLifecycleAuthority(options), options, statePath };
}

afterEach(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  roots.clear();
});

describe("McpLifecycleAuthority", () => {
  it("persists legal phases, subscriptions, and callback settlement", () => {
    const { authority, statePath } = fixture();
    const token = authority.beginConnection({
      name: "remote",
      sessionId: "session-1",
      config: { url: "https://mcp.example.test/rpc?credential=hidden" },
    });
    authority.transition(token, MCP_LIFECYCLE_PHASES.INITIALIZING);
    authority.registerRpc(token, 1, "initialize");
    authority.settleRpc(token, 1, "completed");
    authority.transition(token, MCP_LIFECYCLE_PHASES.DISCOVERING);
    authority.registerRpc(token, 2, "tools/list");
    authority.settleRpc(token, 2, "completed");
    authority.transition(token, MCP_LIFECYCLE_PHASES.READY, {
      tlsIdentityDigest: `sha256:${"a".repeat(64)}`,
    });
    authority.setSubscription(token, "res://watched", true);

    const snapshot = authority.snapshot({
      name: "remote",
      sessionId: "session-1",
    });
    expect(snapshot).toMatchObject({
      phase: "ready",
      generation: 1,
      subscriptions: ["res://watched"],
      tlsIdentityDigest: `sha256:${"a".repeat(64)}`,
      metrics: {
        rpcRegistered: 2,
        rpcSettled: 2,
        lostCallbacks: 0,
        duplicateCallbacksAccepted: 0,
        staleCallbacksAccepted: 0,
      },
    });
    expect(fs.readFileSync(statePath, "utf8")).not.toContain("credential");
  });

  it("recovers an in-flight RPC after restart and fences the old generation", () => {
    const { authority, options } = fixture();
    const first = authority.beginConnection({
      name: "remote",
      sessionId: "session-1",
      config: { url: "https://mcp.example.test/rpc" },
    });
    authority.transition(first, MCP_LIFECYCLE_PHASES.INITIALIZING);
    authority.transition(first, MCP_LIFECYCLE_PHASES.DISCOVERING);
    authority.transition(first, MCP_LIFECYCLE_PHASES.READY);
    authority.registerRpc(first, 9, "tools/call");
    authority.setSubscription(first, "res://watched", true);

    const restarted = new McpLifecycleAuthority(options);
    const second = restarted.beginConnection({
      name: "remote",
      sessionId: "session-1",
      config: { url: "https://mcp.example.test/rpc" },
      reconnect: true,
    });
    expect(second.generation).toBe(2);
    expect(restarted.desiredSubscriptions(second)).toEqual(["res://watched"]);
    expect(() => authority.registerRpc(first, 10, "tools/call")).toThrow(
      expect.objectContaining({ code: MCP_LIFECYCLE_ERROR_CODES.FENCED }),
    );
    restarted.rejectUnexpectedRpc(first, 9, "stale");

    const snapshot = restarted.snapshot({
      name: "remote",
      sessionId: "session-1",
    });
    expect(snapshot.metrics).toMatchObject({
      restartRecoveries: 1,
      rpcRegistered: 1,
      rpcSettled: 1,
      rpcFailedClosed: 1,
      rpcRecoveredAfterRestart: 1,
      staleCallbacksRejected: 1,
      staleCallbacksAccepted: 0,
      lostCallbacks: 0,
    });
    expect(snapshot.pendingRpc).toEqual([]);
  });

  it("rejects illegal transitions and disabled connection attempts", () => {
    const { authority } = fixture();
    authority.markDisabled({
      name: "disabled",
      sessionId: "session-1",
      config: { url: "https://disabled.example.test/rpc" },
    });
    expect(() =>
      authority.beginConnection({
        name: "disabled",
        sessionId: "session-1",
        config: { url: "https://disabled.example.test/rpc" },
      }),
    ).toThrow(
      expect.objectContaining({ code: MCP_LIFECYCLE_ERROR_CODES.DISABLED }),
    );

    const token = authority.beginConnection({
      name: "enabled",
      sessionId: "session-1",
      config: { url: "https://enabled.example.test/rpc" },
    });
    expect(() =>
      authority.transition(token, MCP_LIFECYCLE_PHASES.READY),
    ).toThrow(
      expect.objectContaining({
        code: MCP_LIFECYCLE_ERROR_CODES.INVALID_TRANSITION,
      }),
    );
  });

  it("rejects duplicate callbacks without changing accepted anomaly counts", () => {
    const { authority } = fixture();
    const token = authority.beginConnection({
      name: "remote",
      sessionId: "session-1",
      config: { url: "https://mcp.example.test/rpc" },
    });
    authority.transition(token, MCP_LIFECYCLE_PHASES.INITIALIZING);
    authority.registerRpc(token, 1, "initialize");
    expect(authority.settleRpc(token, 1, "completed")).toBe(true);
    expect(authority.settleRpc(token, 1, "completed")).toBe(false);

    const snapshot = authority.snapshot({
      name: "remote",
      sessionId: "session-1",
    });
    expect(snapshot.metrics).toMatchObject({
      duplicateCallbacksRejected: 1,
      duplicateCallbacksAccepted: 0,
      staleCallbacksAccepted: 0,
      lostCallbacks: 0,
    });
  });

  it("fails pending RPCs closed before a terminal idle transition", () => {
    const { authority } = fixture();
    const token = authority.beginConnection({
      name: "remote",
      sessionId: "session-1",
      config: { url: "https://mcp.example.test/rpc" },
    });
    authority.transition(token, MCP_LIFECYCLE_PHASES.INITIALIZING);
    authority.registerRpc(token, 1, "initialize");
    authority.transition(token, MCP_LIFECYCLE_PHASES.DISCONNECTING);
    authority.transition(token, MCP_LIFECYCLE_PHASES.IDLE);

    const snapshot = authority.snapshot({
      name: "remote",
      sessionId: "session-1",
    });
    expect(snapshot).toMatchObject({
      phase: "idle",
      ownerId: null,
      attemptId: null,
      pendingRpc: [],
      metrics: {
        rpcRegistered: 1,
        rpcSettled: 1,
        rpcFailedClosed: 1,
        rpcRecoveredAfterRestart: 0,
        lostCallbacks: 0,
      },
    });
  });

  it("administratively disables and fences an active generation", () => {
    const { authority } = fixture();
    const token = authority.beginConnection({
      name: "remote",
      sessionId: "session-1",
      config: { url: "https://mcp.example.test/rpc" },
    });
    authority.transition(token, MCP_LIFECYCLE_PHASES.INITIALIZING);
    authority.registerRpc(token, 1, "initialize");

    const disabled = authority.markDisabled({
      name: "remote",
      sessionId: "session-1",
      config: { url: "https://mcp.example.test/rpc", disabled: true },
    });
    expect(disabled).toMatchObject({
      phase: "disabled",
      desired: "disabled",
      generation: 2,
      ownerId: null,
      pendingRpc: [],
      metrics: {
        rpcRegistered: 1,
        rpcSettled: 1,
        rpcFailedClosed: 1,
      },
    });
    expect(() => authority.registerRpc(token, 2, "tools/list")).toThrow(
      expect.objectContaining({ code: MCP_LIFECYCLE_ERROR_CODES.FENCED }),
    );
  });
});
