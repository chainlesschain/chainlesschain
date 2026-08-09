import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  shouldRetryOwnedProcessTreeTermination,
  terminateOwnedProcessTree,
} from "../../src/lib/process-tree-termination.js";

function makeChild(pid = 4123) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = { end: vi.fn() };
  child.kill = vi.fn(() => true);
  return child;
}

function esrch() {
  const error = new Error("no such process group");
  error.code = "ESRCH";
  return error;
}

describe("terminateOwnedProcessTree", () => {
  it("never retries a stale numeric identity after the owned root closes", () => {
    const child = makeChild();
    expect(
      shouldRetryOwnedProcessTreeTermination(child, {
        closed: false,
        confirmed: false,
      }),
    ).toBe(true);

    expect(
      shouldRetryOwnedProcessTreeTermination(child, {
        closed: true,
        treeTerminated: false,
        confirmed: false,
      }),
    ).toBe(false);

    child.signalCode = "SIGKILL";
    expect(
      shouldRetryOwnedProcessTreeTermination(child, {
        closed: false,
        confirmed: false,
      }),
    ).toBe(false);
  });

  it("soft-terminates and verifies a POSIX process group", async () => {
    const child = makeChild();
    let groupAlive = true;
    const kill = vi.fn((pid, signal) => {
      expect(pid).toBe(-child.pid);
      if (signal === 0) {
        if (!groupAlive) throw esrch();
        return;
      }
      if (signal === "SIGTERM") {
        groupAlive = false;
        child.exitCode = 0;
        queueMicrotask(() => child.emit("close", 0, "SIGTERM"));
      }
    });

    const result = await terminateOwnedProcessTree(child, {
      platform: "linux",
      treeMode: "posix-group",
      kill,
      cleanupTimeoutMs: 100,
      graceMs: 50,
    });

    expect(result).toMatchObject({
      verifiable: true,
      softRequested: true,
      hardRequested: false,
      escalated: false,
      closed: true,
      treeTerminated: true,
      confirmed: true,
      deadlineExceeded: false,
    });
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    expect(kill).not.toHaveBeenCalledWith(-child.pid, "SIGKILL");
  });

  it("escalates an unresponsive POSIX group to SIGKILL", async () => {
    const child = makeChild();
    let groupAlive = true;
    const kill = vi.fn((_pid, signal) => {
      if (signal === 0) {
        if (!groupAlive) throw esrch();
        return;
      }
      if (signal === "SIGKILL") {
        groupAlive = false;
        child.signalCode = "SIGKILL";
        queueMicrotask(() => child.emit("close", null, "SIGKILL"));
      }
    });

    const result = await terminateOwnedProcessTree(child, {
      platform: "darwin",
      treeMode: "posix-group",
      kill,
      cleanupTimeoutMs: 100,
      graceMs: 1,
    });

    expect(result).toMatchObject({
      escalated: true,
      hardRequested: true,
      confirmed: true,
    });
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGKILL");
  });

  it("does not hard-signal a reusable PID after the root closes", async () => {
    const child = makeChild();
    const kill = vi.fn((_pid, signal) => {
      if (signal === "SIGTERM") {
        child.exitCode = 0;
        queueMicrotask(() => child.emit("close", 0, null));
      }
      // The process group intentionally remains observable after root close,
      // so whole-tree termination cannot be claimed.
    });

    const result = await terminateOwnedProcessTree(child, {
      platform: "linux",
      treeMode: "posix-group",
      kill,
      cleanupTimeoutMs: 100,
      graceMs: 25,
    });

    expect(result).toMatchObject({
      closed: true,
      treeTerminated: false,
      confirmed: false,
      hardRequested: false,
    });
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    expect(kill).not.toHaveBeenCalledWith(-child.pid, "SIGKILL");
  });

  it("treats an observed managed-sandbox close as a complete tree fence", async () => {
    const child = makeChild();
    child.exitCode = 1;

    const result = await terminateOwnedProcessTree(child, {
      treeMode: "sandbox",
      alreadyClosed: true,
    });

    expect(result).toMatchObject({
      treeMode: "sandbox",
      softRequested: false,
      hardRequested: false,
      closed: true,
      treeTerminated: true,
      confirmed: true,
    });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("uses taskkill /T then /T /F and verifies Windows root close", async () => {
    const child = makeChild();
    const spawnSync = vi.fn((_file, args) => {
      if (args.includes("/F")) {
        child.signalCode = "SIGKILL";
        queueMicrotask(() => child.emit("close", null, "SIGKILL"));
        return { status: 0 };
      }
      return { status: 1 };
    });

    const result = await terminateOwnedProcessTree(child, {
      platform: "win32",
      treeMode: "windows-tree",
      spawnSync,
      cleanupTimeoutMs: 100,
      graceMs: 1,
    });

    expect(result).toMatchObject({
      treeMode: "windows-tree",
      escalated: true,
      hardRequested: true,
      treeRequested: true,
      confirmed: true,
    });
    expect(spawnSync).toHaveBeenNthCalledWith(
      1,
      "taskkill",
      ["/PID", String(child.pid), "/T"],
      expect.objectContaining({ shell: false }),
    );
    expect(spawnSync).toHaveBeenNthCalledWith(
      2,
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("reports an unverified deadline instead of claiming direct-child success", async () => {
    const child = makeChild();
    const kill = vi.fn(() => {});

    const result = await terminateOwnedProcessTree(child, {
      platform: "linux",
      treeMode: "posix-group",
      kill,
      cleanupTimeoutMs: 5,
      graceMs: 1,
    });

    expect(result).toMatchObject({
      verifiable: true,
      escalated: true,
      confirmed: false,
      deadlineExceeded: true,
    });
  });

  it("caps caller-supplied grace and cleanup deadlines at host limits", async () => {
    const child = makeChild();
    let clock = 0;

    const result = await terminateOwnedProcessTree(child, {
      platform: "linux",
      treeMode: "posix-group",
      kill: () => {},
      cleanupTimeoutMs: 999_999,
      graceMs: 999_999,
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    });

    expect(result).toMatchObject({
      escalated: true,
      confirmed: false,
      deadlineExceeded: true,
      elapsedMs: 2_000,
    });
  });
});
