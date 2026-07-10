/**
 * shell-selector (P1 #8 Windows/PowerShell first-class): per-call / configured
 * / default shell resolution, PowerShell argv building, ExecutionPolicy
 * validation (a settings typo must never smuggle argv), layered settings +
 * CC_WINDOWS_SHELL env override.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "module";

const require_ = createRequire(import.meta.url);
const {
  normalizeShellKind,
  normalizeExecutionPolicy,
  buildPowershellArgv,
  resolveShellInvocation,
  loadShellConfig,
  _clearShellConfigCache,
} = require_("../../src/lib/shell-selector.cjs");

beforeEach(() => {
  _clearShellConfigCache();
});

describe("normalizeShellKind / normalizeExecutionPolicy", () => {
  it("accepts kinds case-insensitively + common exe spellings", () => {
    expect(normalizeShellKind("PowerShell")).toBe("powershell");
    expect(normalizeShellKind("powershell.exe")).toBe("powershell");
    expect(normalizeShellKind("PWSH")).toBe("pwsh");
    expect(normalizeShellKind("pwsh.exe")).toBe("pwsh");
    expect(normalizeShellKind("cmd.exe")).toBe("cmd");
    expect(normalizeShellKind("default")).toBe("default");
  });
  it("rejects unknown kinds (fail-to-default)", () => {
    expect(normalizeShellKind("fish")).toBeNull();
    expect(normalizeShellKind("")).toBeNull();
    expect(normalizeShellKind(null)).toBeNull();
  });
  it("canonicalizes ExecutionPolicy casing and rejects non-enum values", () => {
    expect(normalizeExecutionPolicy("bypass")).toBe("Bypass");
    expect(normalizeExecutionPolicy("REMOTESIGNED")).toBe("RemoteSigned");
    // injection attempt / typo → null → flag simply not attached
    expect(normalizeExecutionPolicy("Bypass; rm -rf /")).toBeNull();
    expect(normalizeExecutionPolicy("-Command evil")).toBeNull();
    expect(normalizeExecutionPolicy("")).toBeNull();
  });
});

describe("buildPowershellArgv", () => {
  it("always -NoProfile, command verbatim as the last -Command arg", () => {
    const { file, argv } = buildPowershellArgv(
      'Get-ChildItem | Where-Object { $_.Name -match "x" }',
      "powershell",
      { platform: "win32" },
    );
    expect(file).toBe("powershell.exe");
    expect(argv).toEqual([
      "-NoProfile",
      "-Command",
      'Get-ChildItem | Where-Object { $_.Name -match "x" }',
    ]);
  });
  it("attaches a validated ExecutionPolicy on win32 only", () => {
    const win = buildPowershellArgv("Get-Date", "pwsh", {
      platform: "win32",
      executionPolicy: "bypass",
    });
    expect(win.file).toBe("pwsh");
    expect(win.argv).toEqual([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-Date",
    ]);
    const posix = buildPowershellArgv("Get-Date", "pwsh", {
      platform: "linux",
      executionPolicy: "Bypass",
    });
    expect(posix.argv).toEqual(["-NoProfile", "-Command", "Get-Date"]);
  });
});

describe("resolveShellInvocation — precedence + platform semantics", () => {
  const noConfig = { windowsDefault: null, executionPolicy: null };

  it("unconfigured → byte-identical default path", () => {
    const inv = resolveShellInvocation({
      command: "npm test",
      platform: "win32",
      config: noConfig,
    });
    expect(inv).toEqual({ kind: "default", useDefaultShell: true });
  });

  it("per-call request wins over configured windowsDefault", () => {
    const inv = resolveShellInvocation({
      command: "dir",
      requested: "cmd",
      platform: "win32",
      config: { windowsDefault: "powershell", executionPolicy: null },
    });
    expect(inv.kind).toBe("cmd");
    expect(inv.useDefaultShell).toBe(true); // cmd IS the win32 default shell
  });

  it("configured windowsDefault=powershell routes through explicit argv on win32", () => {
    const inv = resolveShellInvocation({
      command: "Get-Date",
      platform: "win32",
      config: { windowsDefault: "powershell", executionPolicy: "Bypass" },
    });
    expect(inv.useDefaultShell).toBe(false);
    expect(inv.file).toBe("powershell.exe");
    expect(inv.argv).toContain("-ExecutionPolicy");
    expect(inv.argv[inv.argv.length - 1]).toBe("Get-Date");
  });

  it("windowsDefault does NOT apply off-Windows", () => {
    const inv = resolveShellInvocation({
      command: "ls",
      platform: "linux",
      config: { windowsDefault: "powershell", executionPolicy: null },
    });
    expect(inv).toEqual({ kind: "default", useDefaultShell: true });
  });

  it("per-call pwsh is honored on any platform (PowerShell 7 is cross-platform)", () => {
    const inv = resolveShellInvocation({
      command: "Get-Date",
      requested: "pwsh",
      platform: "linux",
      config: noConfig,
    });
    expect(inv.useDefaultShell).toBe(false);
    expect(inv.file).toBe("pwsh");
  });

  it("per-call powershell/cmd off-Windows falls back to default with a note", () => {
    const ps = resolveShellInvocation({
      command: "x",
      requested: "powershell",
      platform: "linux",
      config: noConfig,
    });
    expect(ps.useDefaultShell).toBe(true);
    expect(ps.note).toMatch(/pwsh/);
    const cmd = resolveShellInvocation({
      command: "x",
      requested: "cmd",
      platform: "darwin",
      config: noConfig,
    });
    expect(cmd.useDefaultShell).toBe(true);
    expect(cmd.note).toMatch(/Windows-only/);
  });

  it("unknown per-call value falls back through config to default", () => {
    const inv = resolveShellInvocation({
      command: "x",
      requested: "fish",
      platform: "win32",
      config: noConfig,
    });
    expect(inv).toEqual({ kind: "default", useDefaultShell: true });
  });
});

describe("loadShellConfig — layered settings + env override", () => {
  function withTempSettings(shellBlock, fn) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-shellsel-"));
    try {
      fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".claude", "settings.json"),
        JSON.stringify({ shell: shellBlock }),
        "utf-8",
      );
      return fn(tmp);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  it("reads windowsDefault + powershell.executionPolicy from settings", () => {
    withTempSettings(
      {
        windowsDefault: "pwsh",
        powershell: { executionPolicy: "remotesigned" },
      },
      (tmp) => {
        const cfg = loadShellConfig({ cwd: tmp, env: {} });
        expect(cfg.windowsDefault).toBe("pwsh");
        expect(cfg.executionPolicy).toBe("RemoteSigned");
      },
    );
  });

  it("ignores invalid values (fail-to-default, never widens)", () => {
    withTempSettings(
      {
        windowsDefault: "bash -c evil",
        powershell: { executionPolicy: "Evil" },
      },
      (tmp) => {
        const cfg = loadShellConfig({ cwd: tmp, env: {} });
        expect(cfg.windowsDefault).toBeNull();
        expect(cfg.executionPolicy).toBeNull();
      },
    );
  });

  it("CC_WINDOWS_SHELL env wins over settings", () => {
    withTempSettings({ windowsDefault: "powershell" }, (tmp) => {
      const cfg = loadShellConfig({
        cwd: tmp,
        env: { CC_WINDOWS_SHELL: "cmd" },
      });
      expect(cfg.windowsDefault).toBe("cmd");
    });
  });
});
