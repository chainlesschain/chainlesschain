/**
 * Phase 1.1 — proves ws-cli-loader gives us:
 *   1. CLI native messages still work (auth-less ping → pong).
 *   2. Custom topic round-trip via the dispatcher monkey-patch.
 *   3. Token gate is applied to custom topics (cannot bypass auth).
 *   4. Unknown types still get UNKNOWN_TYPE from the original dispatcher.
 *   5. Session-* without a sessionManager error gracefully (no crash).
 */

import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import { startWsCliBackend } from "../ws-cli-loader.js";

function rpc(ws, frame) {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => {
      try {
        resolve(JSON.parse(raw.toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    ws.once("error", reject);
    ws.send(JSON.stringify(frame));
  });
}

async function openWs(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return ws;
}

describe("ws-cli-loader (Phase 1.1)", () => {
  /** @type {Awaited<ReturnType<typeof startWsCliBackend>> | null} */
  let handle = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  it("listens on an OS-assigned port and exposes the expected handle shape", async () => {
    handle = await startWsCliBackend({});
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.host).toBe("127.0.0.1");
    expect(handle.url).toBe(`ws://127.0.0.1:${handle.port}/`);
    expect(typeof handle.register).toBe("function");
    expect(typeof handle.close).toBe("function");
  });

  it("answers the CLI-native `ping` with a pong (no token, no handlers)", async () => {
    handle = await startWsCliBackend({});
    const ws = await openWs(handle.url);
    try {
      const reply = await rpc(ws, { id: "p-1", type: "ping" });
      expect(reply).toMatchObject({ id: "p-1", type: "pong" });
      expect(typeof reply.serverTime).toBe("number");
    } finally {
      ws.close();
    }
  });

  it("dispatches custom topic handlers and wraps the result", async () => {
    handle = await startWsCliBackend({
      handlers: {
        "demo.echo": (frame) => ({ youSent: frame.payload || null }),
      },
    });
    const ws = await openWs(handle.url);
    try {
      const reply = await rpc(ws, {
        id: "e-1",
        type: "demo.echo",
        payload: "hi",
      });
      expect(reply).toEqual({
        id: "e-1",
        type: "demo.echo.result",
        ok: true,
        result: { youSent: "hi" },
      });
    } finally {
      ws.close();
    }
  });

  it("surfaces topic handler errors as ok:false with the original message", async () => {
    handle = await startWsCliBackend({
      handlers: {
        "demo.boom": () => {
          throw new Error("kaboom");
        },
      },
    });
    const ws = await openWs(handle.url);
    try {
      const reply = await rpc(ws, { id: "b-1", type: "demo.boom" });
      expect(reply).toEqual({
        id: "b-1",
        type: "demo.boom.result",
        ok: false,
        error: "kaboom",
      });
    } finally {
      ws.close();
    }
  });

  it("late-registered topics work via handle.register", async () => {
    handle = await startWsCliBackend({});
    handle.register("demo.late", () => 42);
    const ws = await openWs(handle.url);
    try {
      const reply = await rpc(ws, { id: "l-1", type: "demo.late" });
      expect(reply).toMatchObject({
        id: "l-1",
        type: "demo.late.result",
        ok: true,
        result: 42,
      });
    } finally {
      ws.close();
    }
  });

  it("rejects custom topics from unauthenticated clients when a token is set", async () => {
    handle = await startWsCliBackend({
      token: "secret-xyz",
      handlers: { "demo.gated": () => ({ ok: true }) },
    });
    const ws = await openWs(handle.url);
    try {
      const reply = await rpc(ws, { id: "g-1", type: "demo.gated" });
      expect(reply).toMatchObject({
        id: "g-1",
        type: "error",
        code: "AUTH_REQUIRED",
      });
    } finally {
      ws.close();
    }
  });

  it("allows custom topics after a successful auth handshake", async () => {
    handle = await startWsCliBackend({
      token: "secret-xyz",
      handlers: { "demo.gated": () => ({ secret: 1 }) },
    });
    const ws = await openWs(handle.url);
    try {
      const auth = await rpc(ws, {
        id: "a-1",
        type: "auth",
        token: "secret-xyz",
      });
      expect(auth).toMatchObject({
        id: "a-1",
        type: "auth-result",
        success: true,
      });

      const reply = await rpc(ws, { id: "g-2", type: "demo.gated" });
      expect(reply).toEqual({
        id: "g-2",
        type: "demo.gated.result",
        ok: true,
        result: { secret: 1 },
      });
    } finally {
      ws.close();
    }
  });

  it("falls through to CLI dispatcher for unknown native types (UNKNOWN_TYPE)", async () => {
    handle = await startWsCliBackend({});
    const ws = await openWs(handle.url);
    try {
      const reply = await rpc(ws, { id: "u-1", type: "no-such-thing" });
      expect(reply).toMatchObject({
        id: "u-1",
        type: "error",
        code: "UNKNOWN_TYPE",
      });
    } finally {
      ws.close();
    }
  });

  it("session-create without a sessionManager does not crash the connection", async () => {
    handle = await startWsCliBackend({});
    const ws = await openWs(handle.url);
    try {
      // CLI's response shape for missing sessionManager has fluctuated
      // between envelope errors (older) and silent dispatch drops (newer).
      // The contract THIS layer cares about is narrower: a session-* frame
      // sent at a server with no sessionManager must NOT close/abort the
      // socket — every other behaviour belongs to CLI tests.
      ws.send(
        JSON.stringify({
          id: "s-1",
          type: "session-create",
          sessionType: "agent",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      ws.close();
    }
  });

  it("missing id on a custom topic falls through to CLI's MISSING_ID", async () => {
    handle = await startWsCliBackend({
      handlers: { "demo.echo": () => ({}) },
    });
    const ws = await openWs(handle.url);
    try {
      // No `id` on the frame — CLI dispatcher rejects before our topic logic.
      const reply = await rpc(ws, { type: "demo.echo" });
      expect(reply).toMatchObject({ type: "error", code: "MISSING_ID" });
    } finally {
      ws.close();
    }
  });
});
