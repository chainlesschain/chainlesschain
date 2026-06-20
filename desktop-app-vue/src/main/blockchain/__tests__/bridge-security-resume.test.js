import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const BridgeSecurityManager = require("../bridge-security.js");

describe("BridgeSecurityManager auto-resume resilience", () => {
  let mgr;

  beforeEach(() => {
    mgr = new BridgeSecurityManager({}); // db unused once logSecurityEvent is stubbed
  });

  it("resumeBridge resumes and emits on a successful audit write", async () => {
    vi.spyOn(mgr, "logSecurityEvent").mockResolvedValue();
    mgr.isPaused = true;
    const onResumed = vi.fn();
    mgr.on("bridge-resumed", onResumed);

    await expect(mgr.resumeBridge()).resolves.toBeUndefined();

    expect(mgr.isPaused).toBe(false);
    expect(mgr.pausedUntil).toBeNull();
    expect(onResumed).toHaveBeenCalledTimes(1);
  });

  it("resumeBridge still resumes when the audit-log write fails (no unhandled rejection)", async () => {
    // Regression: previously a rejected logSecurityEvent made resumeBridge
    // reject (unhandled, since it's invoked from an unawaited timer) and the
    // bridge-resumed event was never emitted.
    vi.spyOn(mgr, "logSecurityEvent").mockRejectedValue(new Error("db down"));
    mgr.isPaused = true;
    const onResumed = vi.fn();
    mgr.on("bridge-resumed", onResumed);

    await expect(mgr.resumeBridge()).resolves.toBeUndefined(); // does NOT reject
    expect(mgr.isPaused).toBe(false); // bridge still resumed
    expect(onResumed).toHaveBeenCalledTimes(1); // event still emitted
  });

  it("pauseBridge schedules an auto-resume timer that resumeBridge cancels", async () => {
    vi.spyOn(mgr, "logSecurityEvent").mockResolvedValue();

    await mgr.pauseBridge(60_000, "test");
    expect(mgr.isPaused).toBe(true);
    expect(mgr.autoResumeTimer).toBeTruthy(); // timer scheduled

    await mgr.resumeBridge();
    expect(mgr.autoResumeTimer).toBeNull(); // cancelled on resume
  });
});
