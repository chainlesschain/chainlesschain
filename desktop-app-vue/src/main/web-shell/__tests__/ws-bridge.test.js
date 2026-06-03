/**
 * Phase 0 spike step 2 — verifies the `ukey.status` WS round-trip works
 * end-to-end inside this Node process. Validates risk #2 from
 * `memory/desktop_web_shell_strategy.md`: "request-id 关联".
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { startWsBridge } from "../ws-bridge.js";
import { createUKeyStatusHandler } from "../handlers/ukey-status-handler.js";

function openClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => {
      try {
        resolve(JSON.parse(raw.toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    ws.once("error", reject);
  });
}

async function rpc(ws, frame) {
  ws.send(JSON.stringify(frame));
  return nextMessage(ws);
}

describe("ws-bridge + ukey.status (Phase 0 spike step 2)", () => {
  let bridge;
  let detectCalls = 0;

  beforeAll(async () => {
    const stubManager = {
      async detect() {
        detectCalls += 1;
        return {
          detected: true,
          unlocked: false,
          simulationMode: true,
          reason: "spike_stub",
        };
      },
    };
    bridge = await startWsBridge({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        "ukey.status": createUKeyStatusHandler({
          ukeyManager: stubManager,
          getPlatform: () => "linux",
        }),
      },
    });
  }, 10000);

  afterAll(async () => {
    if (bridge) {
      await bridge.close();
    }
  });

  it("listens on a real OS-assigned port", () => {
    expect(bridge.port).toBeGreaterThan(0);
    expect(bridge.url).toBe(`ws://127.0.0.1:${bridge.port}/`);
  });

  it("round-trips ukey.status with id correlation", async () => {
    const ws = await openClient(bridge.url);
    try {
      const reply = await rpc(ws, { type: "ukey.status", id: "req-001" });
      expect(reply).toMatchObject({
        type: "ukey.status.result",
        id: "req-001",
        ok: true,
      });
      expect(reply.result).toMatchObject({
        available: true,
        detected: true,
        unlocked: false,
        simulationMode: true,
        platform: "linux",
        reason: "spike_stub",
      });
      expect(detectCalls).toBe(1);
    } finally {
      ws.close();
    }
  });

  it("preserves request id even when the topic is unknown", async () => {
    const ws = await openClient(bridge.url);
    try {
      const reply = await rpc(ws, { type: "does.not.exist", id: "req-002" });
      expect(reply).toMatchObject({
        type: "does.not.exist.result",
        id: "req-002",
        ok: false,
      });
      expect(reply.error).toContain("no_handler");
    } finally {
      ws.close();
    }
  });

  it("rejects malformed JSON without crashing", async () => {
    const ws = await openClient(bridge.url);
    try {
      ws.send("not json");
      const reply = await nextMessage(ws);
      expect(reply).toMatchObject({ type: "error", ok: false, id: null });
      expect(reply.error).toBe("invalid_json");
      // Bridge must keep serving — follow up with a valid request.
      const ok = await rpc(ws, { type: "ukey.status", id: "req-003" });
      expect(ok).toMatchObject({ id: "req-003", ok: true });
    } finally {
      ws.close();
    }
  });

  it("returns manager_not_initialized when no manager is injected", async () => {
    const handler = createUKeyStatusHandler({
      ukeyManager: null,
      getPlatform: () => "win32",
    });
    const result = await handler(
      { type: "ukey.status", id: "x" },
      {
        topic: "ukey.status",
        id: "x",
      },
    );
    expect(result).toMatchObject({
      available: false,
      reason: "manager_not_initialized",
      simulationMode: false,
      platform: "win32",
    });
  });

  it("surfaces handler errors as ok:false with the original message", async () => {
    bridge.register("boom", async () => {
      throw new Error("kaboom");
    });
    const ws = await openClient(bridge.url);
    try {
      const reply = await rpc(ws, { type: "boom", id: "req-004" });
      expect(reply).toMatchObject({
        type: "boom.result",
        id: "req-004",
        ok: false,
        error: "kaboom",
      });
    } finally {
      ws.close();
    }
  });
});
