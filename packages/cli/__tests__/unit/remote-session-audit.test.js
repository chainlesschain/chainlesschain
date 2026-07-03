import { describe, expect, it, vi } from "vitest";
import { RemoteSessionAuditLog } from "../../src/harness/remote-session-audit.js";

describe("RemoteSessionAuditLog", () => {
  it("records entries with monotonic sequence and injected clock", () => {
    const clock = vi.fn(() => 1000);
    const log = new RemoteSessionAuditLog({ now: clock });
    const first = log.record({
      sessionId: "s1",
      actor: "host",
      action: "session.created",
    });
    clock.mockReturnValue(2000);
    const second = log.record({
      sessionId: "s1",
      actor: "phone",
      action: "device.joined",
    });
    expect(first).toMatchObject({
      seq: 1,
      timestamp: 1000,
      action: "session.created",
    });
    expect(second).toMatchObject({
      seq: 2,
      timestamp: 2000,
      action: "device.joined",
    });
  });

  it("ignores entries with no action and copies detail defensively", () => {
    const log = new RemoteSessionAuditLog();
    expect(log.record({ sessionId: "s1" })).toBeNull();
    const detail = { chars: 5 };
    const entry = log.record({
      sessionId: "s1",
      action: "control.prompt",
      detail,
    });
    detail.chars = 999;
    expect(entry.detail).toEqual({ chars: 5 });
  });

  it("lists newest-first, filtered by session and action, honoring limit", () => {
    const log = new RemoteSessionAuditLog();
    log.record({ sessionId: "s1", action: "session.created" });
    log.record({ sessionId: "s2", action: "session.created" });
    log.record({ sessionId: "s1", action: "control.prompt" });
    log.record({ sessionId: "s1", action: "control.interrupt" });

    const s1 = log.list({ sessionId: "s1" });
    expect(s1.map((e) => e.action)).toEqual([
      "control.interrupt",
      "control.prompt",
      "session.created",
    ]);
    expect(
      log.list({ sessionId: "s1", action: "control.prompt" }),
    ).toHaveLength(1);
    expect(log.list({ sessionId: "s1", limit: 1 })[0].action).toBe(
      "control.interrupt",
    );
  });

  it("aggregates stats per session", () => {
    const log = new RemoteSessionAuditLog();
    log.record({ sessionId: "s1", action: "control.prompt" });
    log.record({ sessionId: "s1", action: "control.prompt" });
    log.record({ sessionId: "s1", action: "control.interrupt" });
    log.record({ sessionId: "s2", action: "session.created" });
    expect(log.stats("s1")).toEqual({
      total: 3,
      byAction: { "control.prompt": 2, "control.interrupt": 1 },
    });
    expect(log.stats().total).toBe(4);
  });

  it("caps the ring buffer at maxEntries, dropping the oldest", () => {
    const log = new RemoteSessionAuditLog({ maxEntries: 3 });
    for (let i = 0; i < 5; i += 1) {
      log.record({ sessionId: "s1", action: "control.prompt", detail: { i } });
    }
    expect(log.entries).toHaveLength(3);
    expect(log.entries.map((e) => e.detail.i)).toEqual([2, 3, 4]);
  });

  it("feeds a durable sink and survives a throwing one", () => {
    const seen = [];
    const good = new RemoteSessionAuditLog({
      sink: (e) => seen.push(e.action),
    });
    good.record({ sessionId: "s1", action: "session.created" });
    expect(seen).toEqual(["session.created"]);

    const bad = new RemoteSessionAuditLog({
      sink: () => {
        throw new Error("disk full");
      },
    });
    expect(() =>
      bad.record({ sessionId: "s1", action: "session.created" }),
    ).not.toThrow();
    expect(bad.entries).toHaveLength(1);
  });
});
