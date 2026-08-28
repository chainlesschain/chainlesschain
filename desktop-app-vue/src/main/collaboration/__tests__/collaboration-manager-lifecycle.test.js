import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const {
  closeCollaborationServer,
  resolveCollaborationServerLimits,
  websocketDataBytes,
} = require("../collaboration-server-lifecycle.js");

describe("CollaborationManager lifecycle", () => {
  it("wires the bounded helper through the manager's idempotent stop path", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const managerSource = readFileSync(
      path.resolve(testDirectory, "..", "collaboration-manager.js"),
      "utf8",
    );

    expect(managerSource).toContain("closeCollaborationServer({");
    expect(managerSource).toContain("if (this.stopServerPromise)");
    expect(managerSource).toContain("this.wss = null");
    expect(managerSource).toContain("maxPayload: this.limits.maxMessageBytes");
    expect(managerSource).toContain("this._enqueueConnectionMessage(");
    expect(managerSource.match(/conn\.ws\.send\(/g)).toHaveLength(1);
    expect(managerSource).toContain("this._closeAllDocuments()");
  });

  it("validates message, connection, document, and retained-output limits", () => {
    const limits = resolveCollaborationServerLimits({ maxConnections: 4 });
    expect(limits.maxConnections).toBe(4);
    expect(websocketDataBytes("你好")).toBe(6);
    expect(websocketDataBytes([Buffer.from("one"), Buffer.from("two")])).toBe(
      6,
    );
    expect(() =>
      resolveCollaborationServerLimits({ maxMessageBytes: 8 * 1024 * 1024 }),
    ).toThrow(/maxMessageBytes/);
    expect(() => resolveCollaborationServerLimits({ unknown: 1 })).toThrow(
      /unknown/,
    );
  });

  it("bounds server close and force-terminates a stuck client", async () => {
    const close = vi.fn();
    const terminate = vi.fn();
    const connections = new Map([["conn-1", { ws: { close, terminate } }]]);

    await expect(
      closeCollaborationServer({
        server: { close: vi.fn() },
        connections,
        logger: { info: vi.fn(), warn: vi.fn() },
        closeTimeoutMs: 10,
      }),
    ).resolves.toEqual({ timedOut: true });
    expect(close).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("preserves graceful completion without terminating clients", async () => {
    const terminate = vi.fn();
    const server = { close: vi.fn((finish) => finish()) };

    await expect(
      closeCollaborationServer({
        server,
        connections: new Map([
          ["conn-1", { ws: { close: vi.fn(), terminate } }],
        ]),
        logger: { info: vi.fn(), warn: vi.fn() },
        closeTimeoutMs: 100,
      }),
    ).resolves.toEqual({ timedOut: false });
    expect(terminate).not.toHaveBeenCalled();
  });

  it("bounds pending per-connection message drain after server close", async () => {
    const terminate = vi.fn();
    const pending = new Promise(() => {});
    const server = { close: vi.fn((finish) => finish()) };

    await expect(
      closeCollaborationServer({
        server,
        connections: new Map([
          [
            "conn-1",
            { ws: { close: vi.fn(), terminate }, messageChain: pending },
          ],
        ]),
        logger: { info: vi.fn(), warn: vi.fn() },
        closeTimeoutMs: 10,
      }),
    ).resolves.toEqual({ timedOut: true });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("drains the connection snapshot even when close handlers mutate the map", async () => {
    const connections = new Map();
    const terminate = vi.fn();
    const pending = new Promise(() => {});
    connections.set("conn-1", {
      ws: {
        close: vi.fn(() => connections.clear()),
        terminate,
      },
      messageChain: pending,
    });

    await expect(
      closeCollaborationServer({
        server: { close: vi.fn((finish) => finish()) },
        connections,
        logger: { info: vi.fn(), warn: vi.fn() },
        closeTimeoutMs: 10,
      }),
    ).resolves.toEqual({ timedOut: true });
    expect(terminate).toHaveBeenCalledOnce();
  });
});
