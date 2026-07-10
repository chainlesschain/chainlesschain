/**
 * run_shell per-call shell selection (P1 #8 Windows/PowerShell first-class).
 * Real spawn tests — Windows-only ones exercise actual powershell.exe; the
 * POSIX downgrade test runs everywhere else. The default (no shell arg) path
 * is covered by every other run_shell test (byte-identical).
 */
import { describe, it, expect } from "vitest";
import { executeTool } from "../../src/runtime/agent-core.js";

const IS_WIN = process.platform === "win32";

describe.skipIf(!IS_WIN)("run_shell { shell: 'powershell' } on Windows", () => {
  it("evaluates the command with PowerShell semantics (foreground)", async () => {
    const res = await executeTool(
      "run_shell",
      { command: 'Write-Output "ps-marker-$(1 + 1)"', shell: "powershell" },
      {},
    );
    expect(res.error).toBeUndefined();
    // $(1 + 1) only evaluates to 2 under PowerShell — cmd.exe would echo it raw
    expect(res.stdout).toContain("ps-marker-2");
    expect(res.shell).toBe("powershell");
  });

  it("shapes non-zero exits like the default path (exitCode + error)", async () => {
    const res = await executeTool(
      "run_shell",
      { command: "exit 3", shell: "powershell" },
      {},
    );
    expect(res.error).toBeTruthy();
    expect(res.exitCode).toBe(3);
    expect(res.shell).toBe("powershell");
  });

  it("background tasks run under PowerShell too", async () => {
    const start = await executeTool(
      "run_shell",
      {
        command: 'Write-Output "bg-ps-$(2 + 2)"',
        shell: "powershell",
        run_in_background: true,
      },
      {},
    );
    expect(start.background).toBe(true);
    expect(start.shell).toBe("powershell");
    let last;
    let stdout = "";
    for (let i = 0; i < 300; i++) {
      last = await executeTool("check_shell", { task_id: start.task_id }, {});
      stdout += last.stdout || "";
      if (last.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(last.status).toBe("exited");
    expect(stdout).toContain("bg-ps-4");
  });
});

describe.skipIf(IS_WIN)("run_shell { shell: 'powershell' } off Windows", () => {
  it("falls back to the default shell with an explanatory note", async () => {
    const res = await executeTool(
      "run_shell",
      { command: "echo posix-fallback-ok", shell: "powershell" },
      {},
    );
    expect(res.error).toBeUndefined();
    expect(res.stdout).toContain("posix-fallback-ok");
    expect(res.shell).toBeUndefined(); // ran under the default shell
    expect(res.shell_note).toMatch(/pwsh/);
  });
});
