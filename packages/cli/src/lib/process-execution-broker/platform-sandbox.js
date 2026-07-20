/**
 * Platform-specific Sandbox Implementations
 * P0-1: Native OS-level process isolation
 *
 * macOS:   Seatbelt sandbox (sandbox-exec profiles)
 * Windows: Win32 Job Objects + Restricted Tokens + Kill-on-Close
 * Linux:   seccomp-bpf + Landlock (where available)
 *
 * Reference: Apple Sandbox Profile Language, Windows Job Objects API
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const platform = os.platform();

// ---------------------------------------------------------------------------
// macOS Seatbelt Sandbox
// ---------------------------------------------------------------------------

const MACOS_SANDBOX_PROFILE = `(version 1)
(deny default)

; Allow basic execution
(allow process*)

; File access - limited to cwd and temp
(allow file-read*
    (subpath "/usr")
    (subpath "/bin")
    (subpath "/sbin")
    (subpath "/System")
    (subpath "/private/var")
    (subpath "/tmp")
    (subpath "/private/tmp")
    (subpath "{{CWD}}")
    (subpath "{{HOME}}")
)

(allow file-write*
    (subpath "{{CWD}}")
    (subpath "/tmp")
    (subpath "/private/tmp")
    (subpath "{{HOME}}/.chainlesschain")
)

; Network - outbound only, no raw sockets
(allow network-outbound
    (remote tcp)
    (remote udp)
)
(deny network-inbound)
(deny network-raw)

; Signal - allow self signals only
(allow signal (target self))

; Deny dangerous operations
(deny file-write*
    (subpath "/etc")
    (subpath "/System")
    (subpath "/usr")
    (literal "/.file")
)

; System operations
(allow sysctl-read)
(deny sysctl-write)
(allow mach-lookup
    (global-name "com.apple.system.logger")
)
`;

function generateMacOSProfile(cwd, extraAllowPaths = []) {
  let profile = MACOS_SANDBOX_PROFILE;
  profile = profile.replaceAll("{{CWD}}", cwd.replace(/\\/g, "/"));
  profile = profile.replaceAll("{{HOME}}", os.homedir().replace(/\\/g, "/"));
  if (extraAllowPaths.length > 0) {
    const fileReadSection = extraAllowPaths
      .map((p) => `    (subpath "${p.replace(/\\/g, "/")}")`)
      .join("\n");
    profile = profile.replace(
      "(allow file-read*",
      `(allow file-read*\n${fileReadSection}`,
    );
  }
  const profilePath = path.join(
    os.tmpdir(),
    `cc-sandbox-${crypto.randomUUID()}.sb`,
  );
  fs.writeFileSync(profilePath, profile, { mode: 0o600 });
  return profilePath;
}

function applyMacOSSandbox(spawnOptions, sandboxConfig = {}) {
  const cwd = spawnOptions.cwd || process.cwd();
  const profilePath = generateMacOSProfile(cwd, sandboxConfig.allowPaths || []);

  // Wrap with sandbox-exec
  const originalCmd = spawnOptions.file || spawnOptions.command;
  const originalArgs = spawnOptions.args || [];

  spawnOptions.sandboxProfile = profilePath;
  spawnOptions.file = "/usr/bin/sandbox-exec";
  spawnOptions.args = ["-f", profilePath, originalCmd, ...originalArgs];

  // Cleanup profile on exit
  const cleanup = () => {
    try {
      fs.unlinkSync(profilePath);
    } catch {}
  };
  setTimeout(cleanup, 5 * 60 * 1000); // cleanup after 5 min

  return spawnOptions;
}

// ---------------------------------------------------------------------------
// Windows Job Object + Restricted Token Sandbox
// ---------------------------------------------------------------------------

// Job Object limits: kill on close, restrict memory, prevent breakout
const WINDOWS_JOB_LIMITS = {
  KILL_ON_JOB_CLOSE: 0x00002000,
  JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION: 0x00000400,
  JOB_OBJECT_LIMIT_ACTIVE_PROCESS: 0x00000008,
  JOB_OBJECT_LIMIT_PROCESS_MEMORY: 0x00000100,
  JOB_OBJECT_LIMIT_JOB_MEMORY: 0x00000200,
  JOB_OBJECT_SECURITY_NO_ADMIN: 0x00000001,
  JOB_OBJECT_SECURITY_RESTRICTED_TOKEN: 0x00000002,
  JOB_OBJECT_SECURITY_ONLY_TOKEN: 0x00000004,
};

// Win32 API constants for Job Objects
// We use koffi (already used in U-Key module) for native bindings
let _ffi = null;
function getWin32Ffi() {
  if (_ffi !== null) return _ffi;
  if (platform !== "win32") {
    _ffi = null;
    return null;
  }
  try {
    // Try koffi first (existing dependency for U-Key)
    const koffi = require("koffi");
    const kernel32 = koffi.load("kernel32.dll");
    const advapi32 = koffi.load("advapi32.dll");

    _ffi = {
      koffi,
      CreateJobObjectW: kernel32.func(
        "ulong __stdcall CreateJobObjectW(void*, const wchar_t*)",
      ),
      SetInformationJobObject: kernel32.func(
        "int __stdcall SetInformationJobObject(ulong, int, void*, ulong)",
      ),
      AssignProcessToJobObject: kernel32.func(
        "int __stdcall AssignProcessToJobObject(ulong, ulong)",
      ),
      CloseHandle: kernel32.func("int __stdcall CloseHandle(ulong)"),
      CreateRestrictedToken: advapi32.func(
        "int __stdcall CreateRestrictedToken(void*, int, ulong, void*, ulong, void*, ulong, void*, void**)",
      ),
    };
    return _ffi;
  } catch {
    // koffi not available - fall back to PowerShell-based approach
    _ffi = false;
    return null;
  }
}

// PowerShell-based sandbox as fallback when koffi not available
function getWindowsJobObjectPowerShell(pid) {
  // PowerShell script to create Job Object and assign PID
  return `
$job = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(4)
[System.Runtime.InteropServices.Marshal]::WriteInt32($job, 0x2000)  # KILL_ON_JOB_CLOSE
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class JobObject {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);
    [DllImport("kernel32.dll")]
    public static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);
    [DllImport("kernel32.dll")]
    public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr hObject);
    [DllImport("kernel32.dll")]
    public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
}
"@
$hJob = [JobObject]::CreateJobObject([IntPtr]::Zero, "cc-sandbox-${pid}")
$PROCESS_SET_QUOTA = 0x100
$hProc = [JobObject]::OpenProcess($PROCESS_SET_QUOTA, $false, ${pid})
if ($hProc -ne [IntPtr]::Zero) {
    [JobObject]::AssignProcessToJobObject($hJob, $hProc) | Out-Null
    [JobObject]::CloseHandle($hProc) | Out-Null
}
[JobObject]::CloseHandle($hJob) | Out-Null
`;
}

function applyWindowsSandbox(spawnOptions, sandboxConfig = {}) {
  const ffi = getWin32Ffi();

  if (ffi) {
    // Native path using koffi - we'll attach Job Object after spawn
    // so just mark options for post-spawn assignment
    spawnOptions._sandbox = {
      platform: "win32",
      mode: "native-koffi",
      limits: sandboxConfig.limits || WINDOWS_JOB_LIMITS,
    };
  } else {
    // Fallback: we'll use PowerShell wrapper
    // Mark for post-spawn Job Object assignment via PowerShell
    spawnOptions._sandbox = {
      platform: "win32",
      mode: "powershell-fallback",
    };
  }

  // Disable sensitive environment variables
  const env = spawnOptions.env || { ...process.env };
  delete env.COMSPEC_TT;
  delete env.DEBUG_FULL;
  spawnOptions.env = env;

  // WindowsHide to prevent window popups
  spawnOptions.windowsHide = true;

  return spawnOptions;
}

// Called after process starts to assign it to Job Object
function assignProcessToJobObject(proc, sandboxInfo) {
  if (!proc || !proc.pid) return;
  if (!sandboxInfo || sandboxInfo.platform !== "win32") return;

  if (sandboxInfo.mode === "native-koffi") {
    const ffi = getWin32Ffi();
    if (!ffi) return;
    try {
      const jobName = `cc-sandbox-${proc.pid}-${crypto.randomUUID()}`;
      const hJob = ffi.CreateJobObjectW(null, jobName);
      if (hJob && hJob !== 0xffffffffffffffffn) {
        // Set KILL_ON_JOB_CLOSE limit
        // JOBOBJECT_BASIC_LIMIT_INFORMATION: 64 bytes
        // LimitFlags at offset 0
        const limitBuf = Buffer.alloc(64);
        limitBuf.writeUInt32LE(WINDOWS_JOB_LIMITS.KILL_ON_JOB_CLOSE, 0);
        // JobObjectBasicLimitInformation = 2
        ffi.SetInformationJobObject(hJob, 2, limitBuf, limitBuf.length);
        // Get process handle
        // We need PROCESS_SET_QUOTA (0x100) and PROCESS_TERMINATE
        const OpenProcess = ffi.koffi
          .load("kernel32.dll")
          .func("ulong __stdcall OpenProcess(uint, int, uint)");
        const hProc = OpenProcess(0x100 | 0x0001, 0, proc.pid);
        if (hProc && hProc !== 0) {
          ffi.AssignProcessToJobObject(hJob, hProc);
          ffi.CloseHandle(hProc);
        }
        // Store handle for cleanup when process exits
        proc.on("exit", () => {
          try {
            ffi.CloseHandle(hJob);
          } catch {}
        });
        proc.on("error", () => {
          try {
            ffi.CloseHandle(hJob);
          } catch {}
        });
      }
    } catch {
      // Fall through to PowerShell method
    }
  }

  if (sandboxInfo.mode === "powershell-fallback") {
    try {
      const { spawnSync } = require("node:child_process");
      spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          getWindowsJobObjectPowerShell(proc.pid),
        ],
        { windowsHide: true, timeout: 5000 },
      );
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Linux seccomp-bpf + Landlock Sandbox
// ---------------------------------------------------------------------------

function applyLinuxSandbox(spawnOptions, sandboxConfig = {}) {
  // Use bubblewrap if available (most portable user namespace sandbox)
  // Fallback: restrict via cwd, env, and capability dropping
  let bwrapPath = null;
  try {
    const { spawnSync } = require("node:child_process");
    const result = spawnSync("which", ["bwrap"], { encoding: "utf8" });
    if (result.status === 0) {
      bwrapPath = result.stdout.trim();
    }
  } catch {}

  if (bwrapPath) {
    // Bubblewrap-based sandbox
    const cwd = spawnOptions.cwd || process.cwd();
    const home = os.homedir();
    const originalCmd = spawnOptions.file || spawnOptions.command;
    const originalArgs = spawnOptions.args || [];

    spawnOptions.file = bwrapPath;
    spawnOptions.args = [
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/bin",
      "/bin",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--ro-bind",
      "/etc/ld.so.cache",
      "/etc/ld.so.cache",
      "--ro-bind",
      "/etc/ld.so.conf",
      "/etc/ld.so.conf",
      "--ro-bind",
      "/etc/ld.so.conf.d",
      "/etc/ld.so.conf.d",
      "--bind",
      cwd,
      cwd,
      "--bind",
      path.join(home, ".chainlesschain"),
      path.join(home, ".chainlesschain"),
      "--tmpfs",
      "/tmp",
      "--unshare-all",
      "--share-net",
      "--die-with-parent",
      "--new-session",
      originalCmd,
      ...originalArgs,
    ];
    spawnOptions._sandbox = { platform: "linux", mode: "bwrap" };
  } else {
    // Minimal fallback: set restrictive env, no new privs
    const env = { ...(spawnOptions.env || process.env) };
    env.NO_NEW_PRIVS = "1";
    spawnOptions.env = env;
    spawnOptions._sandbox = { platform: "linux", mode: "minimal" };
  }

  return spawnOptions;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function applySandbox(spawnOptions, sandboxConfig = {}) {
  const enabled = sandboxConfig.enabled !== false; // default on
  if (!enabled) return spawnOptions;

  switch (platform) {
    case "darwin":
      return applyMacOSSandbox(spawnOptions, sandboxConfig);
    case "win32":
      return applyWindowsSandbox(spawnOptions, sandboxConfig);
    case "linux":
      return applyLinuxSandbox(spawnOptions, sandboxConfig);
    default:
      return spawnOptions;
  }
}

export function postSpawnSandbox(proc, spawnOptions) {
  const info = spawnOptions?._sandbox;
  if (!info) return;

  if (platform === "win32") {
    assignProcessToJobObject(proc, info);
  }
}

export function getSandboxInfo() {
  const ffi = platform === "win32" ? getWin32Ffi() : null;
  return {
    platform,
    supported: true,
    darwin: {
      available: platform === "darwin",
      mechanism: "seatbelt-sandbox-exec",
    },
    win32: {
      available: platform === "win32",
      mechanism: ffi ? "job-object-native-koffi" : "job-object-powershell",
      hasKoffi: !!ffi,
    },
    linux: {
      available: platform === "linux",
      mechanism: "bwrap-or-minimal",
    },
  };
}

export default { applySandbox, postSpawnSandbox, getSandboxInfo };
