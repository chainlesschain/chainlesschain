import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const MIB = 1024 * 1024;
const DEFAULT_RETIREMENT_POLL_MS = 100;

const WINDOWS_TOOLHELP32_SNAPSHOT_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CcProcessSnapshot {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct PROCESSENTRY32 {
    public uint dwSize;
    public uint cntUsage;
    public uint th32ProcessID;
    public IntPtr th32DefaultHeapID;
    public uint th32ModuleID;
    public uint cntThreads;
    public uint th32ParentProcessID;
    public int pcPriClassBase;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
    public string szExeFile;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);
  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr handle);

  public static string Capture() {
    IntPtr snapshot = CreateToolhelp32Snapshot(0x00000002, 0);
    if (snapshot == new IntPtr(-1)) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    try {
      var output = new StringBuilder();
      var entry = new PROCESSENTRY32();
      entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
      if (Process32FirstW(snapshot, ref entry)) {
        do {
          output.Append(entry.th32ParentProcessID);
          output.Append(',');
          output.Append(entry.th32ProcessID);
          output.Append('\n');
          entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
        } while (Process32NextW(snapshot, ref entry));
      }
      return output.ToString();
    } finally {
      CloseHandle(snapshot);
    }
  }
}
'@
Add-Type -TypeDefinition $source -Language CSharp
[CcProcessSnapshot]::Capture()
`;

let preferredWindowsProcessProbe = null;

function validPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0;
}

export function normalizeOperatingSystem(platform = process.platform) {
  const normalized = String(platform || "")
    .trim()
    .toLowerCase();
  if (["win32", "windows", "windows-latest"].includes(normalized)) {
    return "windows";
  }
  if (["darwin", "macos", "macos-latest", "osx"].includes(normalized)) {
    return "macos";
  }
  if (["linux", "ubuntu", "ubuntu-latest"].includes(normalized)) {
    return "linux";
  }
  return normalized || "unknown";
}

/**
 * Capture the open file descriptor count on Unix and handle count on Windows.
 * Dependencies are injectable so every platform path can be tested on one host.
 */
export function resourceCount(
  pid,
  { platform = process.platform, readdir = readdirSync, run = spawnSync } = {},
) {
  if (!validPid(pid)) return { kind: "unavailable", count: null };
  const operatingSystem = normalizeOperatingSystem(platform);
  if (operatingSystem === "linux") {
    try {
      return { kind: "fd", count: readdir(`/proc/${pid}/fd`).length };
    } catch {
      const listing = run(
        "bash",
        ["-lc", `ls -1 /proc/${pid}/fd 2>/dev/null | wc -l`],
        { encoding: "utf8" },
      );
      const count = Number.parseInt(listing.stdout, 10);
      return { kind: "fd", count: Number.isFinite(count) ? count : null };
    }
  }
  if (operatingSystem === "macos") {
    const listing = run("lsof", ["-n", "-p", String(pid)], {
      encoding: "utf8",
    });
    const count =
      listing.status === 0
        ? listing.stdout.trim().split(/\r?\n/u).length - 1
        : null;
    return { kind: "fd", count };
  }
  if (operatingSystem === "windows") {
    const probe = run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid}).HandleCount`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const count = Number.parseInt(probe.stdout, 10);
    return { kind: "handle", count: Number.isFinite(count) ? count : null };
  }
  return { kind: "unavailable", count: null };
}

/** Capture resident memory in bytes using the native host facility. */
export function rssBytes(
  pid,
  {
    platform = process.platform,
    readFile = readFileSync,
    run = spawnSync,
  } = {},
) {
  if (!validPid(pid)) return null;
  const operatingSystem = normalizeOperatingSystem(platform);
  if (operatingSystem === "linux") {
    try {
      const status = readFile(`/proc/${pid}/status`, "utf8");
      const match = /^VmRSS:\s+(\d+)\s+kB$/mu.exec(status);
      return match ? Number(match[1]) * 1024 : null;
    } catch {
      return null;
    }
  }
  if (operatingSystem === "windows") {
    const probe = run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid}).WorkingSet64`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (probe.status !== 0 || String(probe.stdout || "").trim() === "") {
      return null;
    }
    const value = Number(probe.stdout.trim());
    return Number.isFinite(value) ? value : null;
  }
  const probe = run("ps", ["-o", "rss=", "-p", String(pid)], {
    encoding: "utf8",
  });
  if (probe.status !== 0 || String(probe.stdout || "").trim() === "") {
    return null;
  }
  const value = Number(probe.stdout.trim());
  return Number.isFinite(value) ? value * 1024 : null;
}

export function descendantPidsFromProcessRows(rows, rootPid) {
  if (!validPid(rootPid)) return [];
  const childrenByParent = new Map();
  for (const entry of rows) {
    const processId = Number(entry?.processId);
    const parentProcessId = Number(entry?.parentProcessId);
    if (
      !validPid(processId) ||
      !Number.isSafeInteger(parentProcessId) ||
      parentProcessId < 0
    ) {
      continue;
    }
    const children = childrenByParent.get(parentProcessId) || [];
    children.push(processId);
    childrenByParent.set(parentProcessId, children);
  }
  const descendants = [];
  const pending = [...(childrenByParent.get(rootPid) || [])];
  const seen = new Set([rootPid]);
  while (pending.length > 0) {
    const processId = pending.shift();
    if (seen.has(processId)) continue;
    seen.add(processId);
    descendants.push(processId);
    pending.push(...(childrenByParent.get(processId) || []));
  }
  return descendants;
}

export function parseWindowsProcessPairs(value) {
  const rows = [];
  for (const line of String(value || "").split(/\r?\n/u)) {
    const fields = line.trim().split(",");
    if (fields.length < 2) continue;
    const parentProcessId = Number(fields.at(-2));
    const processId = Number(fields.at(-1));
    if (
      validPid(processId) &&
      Number.isSafeInteger(parentProcessId) &&
      parentProcessId >= 0
    ) {
      rows.push({ processId, parentProcessId });
    }
  }
  return rows;
}

/** Capture every transitive descendant of a process. */
export function descendantProcessSnapshot(
  pid,
  { platform = process.platform, run = spawnSync } = {},
) {
  if (!validPid(pid)) {
    return { available: false, pids: [], reason: "invalid-root-pid" };
  }
  if (normalizeOperatingSystem(platform) === "windows") {
    const probes = [
      {
        source: "wmic",
        command: "wmic.exe",
        args: [
          "path",
          "Win32_Process",
          "get",
          "ParentProcessId,ProcessId",
          "/format:csv",
        ],
      },
      {
        source: "cim",
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$ErrorActionPreference='Stop'; Get-CimInstance ` +
            `-ClassName Win32_Process -ErrorAction Stop | ` +
            `ForEach-Object { '{0},{1}' -f ` +
            `$_.ParentProcessId,$_.ProcessId }`,
        ],
      },
      {
        source: "toolhelp32",
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          WINDOWS_TOOLHELP32_SNAPSHOT_COMMAND,
        ],
      },
    ];
    const orderedProbes = preferredWindowsProcessProbe
      ? [
          probes.find((probe) => probe.source === preferredWindowsProcessProbe),
          ...probes.filter(
            (probe) => probe.source !== preferredWindowsProcessProbe,
          ),
        ].filter(Boolean)
      : probes;
    const failures = [];
    for (const probe of orderedProbes) {
      const result = run(probe.command, probe.args, {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 16 * MIB,
      });
      if (result.status !== 0) {
        failures.push(
          result.error?.code
            ? `${probe.source}-${result.error.code}`
            : `${probe.source}-exit-${result.status ?? "unknown"}`,
        );
        continue;
      }
      const rows = parseWindowsProcessPairs(result.stdout);
      if (rows.length === 0) {
        failures.push(`${probe.source}-empty`);
        continue;
      }
      preferredWindowsProcessProbe = probe.source;
      return {
        available: true,
        pids: descendantPidsFromProcessRows(rows, pid),
        source: probe.source,
      };
    }
    return {
      available: false,
      pids: [],
      reason: failures.join("+") || "windows-process-snapshot-unavailable",
    };
  }
  const descendants = [];
  const pending = [pid];
  const seen = new Set([pid]);
  while (pending.length > 0) {
    const parentPid = pending.shift();
    const probe = run("pgrep", ["-P", String(parentPid)], {
      encoding: "utf8",
    });
    if (probe.status !== 0 && probe.status !== 1) {
      return { available: false, pids: [], reason: "pgrep-unavailable" };
    }
    if (probe.status === 1) continue;
    for (const value of probe.stdout.trim().split(/\s+/u).filter(Boolean)) {
      const processId = Number.parseInt(value, 10);
      if (!validPid(processId) || seen.has(processId)) continue;
      seen.add(processId);
      descendants.push(processId);
      pending.push(processId);
    }
  }
  return { available: true, pids: descendants, source: "pgrep" };
}

export function descendantPids(rootPid, options) {
  return descendantProcessSnapshot(rootPid, options);
}

export function descendantCount(pid, options) {
  const snapshot = descendantProcessSnapshot(pid, options);
  return snapshot.available ? snapshot.pids.length : null;
}

export function processExists(pid, { kill = process.kill.bind(process) } = {}) {
  if (!validPid(pid)) return null;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "ESRCH" ? false : null;
  }
}

export async function waitForProcessRetirement(
  pid,
  {
    timeoutMs = 10_000,
    pollMs = DEFAULT_RETIREMENT_POLL_MS,
    exists = processExists,
    now = () => performance.now(),
    sleep = (delayMs) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs)),
  } = {},
) {
  let alive = exists(pid);
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  while (alive === true && now() < deadline) {
    await sleep(pollMs);
    alive = exists(pid);
  }
  return {
    retired: alive === false,
    elapsedMs: Math.max(0, now() - startedAt),
  };
}

/**
 * Summarize the linear trend of the sample tail. Positive projected growth is
 * retained while a flat or falling tail reports zero projected growth.
 */
export function linearTailTrend(
  samples,
  { tailFraction = 0.25, minSamples = 3 } = {},
) {
  const finiteSamples = Array.from(samples || []).filter(Number.isFinite);
  const boundedMinimum =
    Number.isSafeInteger(minSamples) && minSamples > 1 ? minSamples : 3;
  const boundedFraction =
    Number.isFinite(tailFraction) && tailFraction > 0 && tailFraction <= 1
      ? tailFraction
      : 0.25;
  const tailSize = Math.min(
    finiteSamples.length,
    Math.max(boundedMinimum, Math.ceil(finiteSamples.length * boundedFraction)),
  );
  const tail = finiteSamples.slice(-tailSize);
  let slopePerSample = 0;
  if (tail.length >= 2) {
    const xMean = (tail.length - 1) / 2;
    const yMean = tail.reduce((total, value) => total + value, 0) / tail.length;
    let numerator = 0;
    let denominator = 0;
    for (let index = 0; index < tail.length; index += 1) {
      numerator += (index - xMean) * (tail[index] - yMean);
      denominator += (index - xMean) ** 2;
    }
    slopePerSample = denominator === 0 ? 0 : numerator / denominator;
  }
  return {
    available: finiteSamples.length >= boundedMinimum,
    samples: finiteSamples.length,
    maximum: finiteSamples.length > 0 ? Math.max(...finiteSamples) : null,
    tailSamples: tail.length,
    tailSlopePerSample: Math.round(slopePerSample),
    projectedTailGrowth: Math.round(
      Math.max(0, slopePerSample * Math.max(0, tail.length - 1)),
    ),
  };
}
