import { describe, expect, it, vi } from "vitest";
import { sendAgentNotification } from "../../src/lib/agent-notify.js";

function fakeManager({ configured = true, channels = ["telegram"] } = {}) {
  const calls = [];
  return {
    calls,
    isConfigured: configured,
    activeChannels: channels,
    notifyStart: vi.fn(async (s) => {
      calls.push(["start", s]);
      return [{ channel: "telegram", ok: true }];
    }),
    notifySuccess: vi.fn(async (s) => {
      calls.push(["success", s]);
      return [
        { channel: "telegram", ok: true },
        { channel: "wecom", ok: false, reason: "boom" },
      ];
    }),
    notifyFailure: vi.fn(async (s) => {
      calls.push(["failure", s]);
      return [{ channel: "telegram", ok: true }];
    }),
  };
}

describe("sendAgentNotification", () => {
  it("requires a title", async () => {
    await expect(sendAgentNotification({ title: "" })).rejects.toThrow(/title/);
  });

  it("returns a no-op note when no channels are configured", async () => {
    const res = await sendAgentNotification(
      { title: "hi" },
      { manager: fakeManager({ configured: false }) },
    );
    expect(res.channels).toBe(0);
    expect(res.delivered).toEqual([]);
    expect(res.note).toMatch(/No notification channels/);
  });

  it("maps level to the right broadcast method and splits delivered/failed", async () => {
    const manager = fakeManager();
    const res = await sendAgentNotification(
      { title: "Done", body: "all green", level: "success" },
      { manager },
    );
    expect(manager.notifySuccess).toHaveBeenCalledTimes(1);
    expect(res.delivered).toEqual(["telegram"]);
    expect(res.failed).toEqual(["wecom"]);
    expect(res.channels).toBe(1);
  });

  it("defaults to notifyStart for info level", async () => {
    const manager = fakeManager();
    await sendAgentNotification({ title: "FYI" }, { manager });
    expect(manager.notifyStart).toHaveBeenCalledTimes(1);
  });
});
