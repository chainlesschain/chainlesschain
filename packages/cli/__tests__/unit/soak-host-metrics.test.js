import { describe, expect, it } from "vitest";
import {
  descendantPids,
  descendantPidsFromProcessRows,
  linearTailTrend,
  normalizeOperatingSystem,
  processExists,
  resourceCount,
  rssBytes,
  waitForProcessRetirement,
} from "../../scripts/soak-host-metrics.mjs";

describe("soak host metrics", () => {
  it("normalizes Node and runner operating-system names", () => {
    expect(normalizeOperatingSystem("win32")).toBe("windows");
    expect(normalizeOperatingSystem("windows-latest")).toBe("windows");
    expect(normalizeOperatingSystem("darwin")).toBe("macos");
    expect(normalizeOperatingSystem("macos-latest")).toBe("macos");
    expect(normalizeOperatingSystem("ubuntu-latest")).toBe("linux");
    expect(normalizeOperatingSystem("freebsd")).toBe("freebsd");
    expect(normalizeOperatingSystem("")).toBe("unknown");
  });

  it("captures Linux RSS and file descriptors without shelling out", () => {
    expect(
      resourceCount(42, {
        platform: "linux",
        readdir: (path) => {
          expect(path).toBe("/proc/42/fd");
          return ["0", "1", "2", "3"];
        },
      }),
    ).toEqual({ kind: "fd", count: 4 });
    expect(
      rssBytes(42, {
        platform: "linux",
        readFile: (path, encoding) => {
          expect([path, encoding]).toEqual(["/proc/42/status", "utf8"]);
          return "Name:\tnode\nVmRSS:\t1234 kB\nThreads:\t8\n";
        },
      }),
    ).toBe(1234 * 1024);
  });

  it("uses the Linux FD fallback when procfs cannot be read", () => {
    const calls = [];
    expect(
      resourceCount(73, {
        platform: "ubuntu-latest",
        readdir: () => {
          throw new Error("procfs unavailable");
        },
        run: (command, args, options) => {
          calls.push({ command, args, options });
          return { status: 0, stdout: "9\n" };
        },
      }),
    ).toEqual({ kind: "fd", count: 9 });
    expect(calls[0]).toMatchObject({
      command: "bash",
      args: ["-lc", "ls -1 /proc/73/fd 2>/dev/null | wc -l"],
    });
  });

  it("captures macOS RSS and file descriptors with native commands", () => {
    const run = (command, args) => {
      if (command === "lsof") {
        expect(args).toEqual(["-n", "-p", "81"]);
        return { status: 0, stdout: "COMMAND PID\nnode 81\nnode 81\n" };
      }
      expect([command, args]).toEqual(["ps", ["-o", "rss=", "-p", "81"]]);
      return { status: 0, stdout: "2048\n" };
    };
    expect(resourceCount(81, { platform: "darwin", run })).toEqual({
      kind: "fd",
      count: 2,
    });
    expect(rssBytes(81, { platform: "macos", run })).toBe(2 * 1024 * 1024);
  });

  it("captures Windows RSS and handle counts with PowerShell", () => {
    const commands = [];
    const run = (command, args, options) => {
      commands.push({ command, args, options });
      return {
        status: 0,
        stdout: args.at(-1).includes("HandleCount") ? "37\r\n" : "65536\r\n",
      };
    };
    expect(resourceCount(99, { platform: "win32", run })).toEqual({
      kind: "handle",
      count: 37,
    });
    expect(rssBytes(99, { platform: "windows-latest", run })).toBe(65536);
    expect(commands).toHaveLength(2);
    expect(commands.every(({ command }) => command === "powershell.exe")).toBe(
      true,
    );
    expect(commands.every(({ options }) => options.windowsHide)).toBe(true);
  });

  it("reports invalid and unsupported measurements as unavailable", () => {
    expect(resourceCount(-1)).toEqual({ kind: "unavailable", count: null });
    expect(resourceCount(5, { platform: "aix" })).toEqual({
      kind: "unavailable",
      count: null,
    });
    expect(rssBytes(Number.NaN)).toBeNull();
    expect(
      rssBytes(5, {
        platform: "windows",
        run: () => ({ status: 1, stdout: "" }),
      }),
    ).toBeNull();
    expect(
      rssBytes(5, {
        platform: "macos",
        run: () => ({ status: 0, stdout: "" }),
      }),
    ).toBeNull();
  });

  it("walks descendant rows transitively and cycle-safely", () => {
    expect(
      descendantPidsFromProcessRows(
        [
          { processId: 20, parentProcessId: 10 },
          { processId: 30, parentProcessId: 20 },
          { processId: 40, parentProcessId: 30 },
          { processId: 20, parentProcessId: 40 },
          { processId: 50, parentProcessId: 999 },
          { processId: "invalid", parentProcessId: 10 },
        ],
        10,
      ),
    ).toEqual([20, 30, 40]);
  });

  it("captures a transitive Unix descendant snapshot", () => {
    const children = new Map([
      [10, "20 30\n"],
      [20, "40\n"],
      [30, ""],
      [40, ""],
    ]);
    const snapshot = descendantPids(10, {
      platform: "linux",
      run: (command, args) => {
        expect(command).toBe("pgrep");
        const output = children.get(Number(args[1]));
        return { status: output ? 0 : 1, stdout: output || "" };
      },
    });
    expect(snapshot).toEqual({
      available: true,
      pids: [20, 30, 40],
      source: "pgrep",
    });
  });

  it("falls back from WMIC to CIM for a Windows descendant snapshot", () => {
    const commands = [];
    const snapshot = descendantPids(10, {
      platform: "windows",
      run: (command) => {
        commands.push(command);
        if (command === "wmic.exe") return { status: 1, stdout: "" };
        return {
          status: 0,
          stdout: "0,10\n10,20\n20,30\n999,50\n",
        };
      },
    });
    expect(commands).toEqual(["wmic.exe", "powershell.exe"]);
    expect(snapshot).toEqual({
      available: true,
      pids: [20, 30],
      source: "cim",
    });
  });

  it("distinguishes live, retired, and unobservable processes", () => {
    expect(processExists(12, { kill: () => {} })).toBe(true);
    expect(
      processExists(12, {
        kill: () => {
          throw Object.assign(new Error("gone"), { code: "ESRCH" });
        },
      }),
    ).toBe(false);
    expect(
      processExists(12, {
        kill: () => {
          throw Object.assign(new Error("denied"), { code: "EPERM" });
        },
      }),
    ).toBeNull();
    expect(processExists(0)).toBeNull();
  });

  it("waits for process retirement and reports elapsed time", async () => {
    let clock = 0;
    const observations = [true, true, false];
    const result = await waitForProcessRetirement(44, {
      timeoutMs: 500,
      pollMs: 100,
      exists: () => observations.shift(),
      now: () => clock,
      sleep: async (delayMs) => {
        clock += delayMs;
      },
    });
    expect(result).toEqual({ retired: true, elapsedMs: 200 });
  });

  it("fails closed when retirement cannot be observed by the deadline", async () => {
    let clock = 0;
    const result = await waitForProcessRetirement(45, {
      timeoutMs: 250,
      pollMs: 100,
      exists: () => true,
      now: () => clock,
      sleep: async (delayMs) => {
        clock += delayMs;
      },
    });
    expect(result).toEqual({ retired: false, elapsedMs: 300 });
  });

  it("computes an upward linear trend over the configured sample tail", () => {
    expect(
      linearTailTrend([100, 900, 20, 30, 40, 50, 60, 70], {
        tailFraction: 0.5,
        minSamples: 3,
      }),
    ).toEqual({
      available: true,
      samples: 8,
      maximum: 900,
      tailSamples: 4,
      tailSlopePerSample: 10,
      projectedTailGrowth: 30,
    });
  });

  it("reports no projected growth for a falling or insufficient tail", () => {
    expect(linearTailTrend([30, 20, 10])).toMatchObject({
      available: true,
      tailSlopePerSample: -10,
      projectedTailGrowth: 0,
    });
    expect(linearTailTrend([10, Number.NaN], { minSamples: 3 })).toEqual({
      available: false,
      samples: 1,
      maximum: 10,
      tailSamples: 1,
      tailSlopePerSample: 0,
      projectedTailGrowth: 0,
    });
  });
});
