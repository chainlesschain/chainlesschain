import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

const {
  DesktopAppServerPilot,
  MAX_PARAMS_BYTES,
  normalizeParams,
} = require("../app-server-pilot.js");

class FakePilotClient extends EventEmitter {
  static options = null;

  constructor(options) {
    super();
    FakePilotClient.options = options;
    this.status = {
      running: false,
      initialized: false,
      pendingRequestCount: 0,
      capabilities: null,
      lastError: null,
    };
    for (const method of [
      "threadStart",
      "threadResume",
      "threadFork",
      "threadRead",
      "threadList",
      "threadArchive",
      "turnStart",
      "turnInterrupt",
    ]) {
      this[method] = vi.fn(async (params) => ({ method, params }));
    }
    this.start = vi.fn(async () => ({ protocolVersion: 1 }));
    this.close = vi.fn(async () => undefined);
  }
}

describe("DesktopAppServerPilot", () => {
  it("uses the shared fixed-capability client through the Desktop process broker", async () => {
    const child = {};
    const spawnProcess = vi.fn(() => child);
    const pilot = new DesktopAppServerPilot({
      ClientClass: FakePilotClient,
      cliPath: "C:/repo/packages/cli/bin/chainlesschain.js",
      cwd: "C:/repo",
      spawnProcess,
    });

    expect(
      await pilot.turnStart({ threadId: "thread-1", input: "hello" }),
    ).toEqual({
      method: "turnStart",
      params: { threadId: "thread-1", input: "hello" },
    });
    expect("request" in pilot).toBe(false);
    expect(pilot.status).toMatchObject({ enabled: true, surface: "desktop" });

    expect(
      FakePilotClient.options.spawn("node", ["cli.js"], {
        cwd: "C:/repo",
        stdio: ["pipe", "pipe", "pipe"],
      }),
    ).toBe(child);
    expect(spawnProcess).toHaveBeenCalledWith(
      "node",
      ["cli.js"],
      expect.objectContaining({
        cwd: "C:/repo",
        shell: false,
        origin: "desktop:coding-agent-app-server-pilot",
        provenance: { component: "coding-agent-app-server-pilot" },
      }),
    );
  });

  it("bounds and clones renderer parameters before they reach the client", () => {
    const source = { threadId: "thread-1", metadata: { safe: true } };
    const normalized = normalizeParams(source);
    expect(normalized).toEqual(source);
    expect(normalized).not.toBe(source);

    expect(() => normalizeParams([])).toThrow(/must be an object/u);
    expect(() => normalizeParams(new Date())).toThrow(/must be an object/u);
    expect(() =>
      normalizeParams({ input: "x".repeat(MAX_PARAMS_BYTES + 1) }),
    ).toThrow(/exceed 256 KiB/u);
  });

  it("forwards lifecycle events without unhandled host errors", () => {
    const pilot = new DesktopAppServerPilot({ ClientClass: FakePilotClient });
    const notification = vi.fn();
    pilot.on("notification", notification);
    pilot.client.emit("notification", { method: "turn/completed" });
    expect(notification).toHaveBeenCalledWith({ method: "turn/completed" });
    expect(() =>
      pilot.client.emit("error", new Error("broken pipe")),
    ).not.toThrow();
  });
});
