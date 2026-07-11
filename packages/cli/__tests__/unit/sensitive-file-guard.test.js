/**
 * Sensitive-file write guard (Claude-Code 2.1.160 parity) — pattern lib +
 * executeTool seam: shell startup files / PS profiles / git+husky hooks
 * require confirmation even on otherwise-permitted edit flows; explicit
 * settings `allow` is the only bypass; headless fails closed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  sensitiveFileReason,
  autoExecConfigReason,
} from "../../src/lib/sensitive-file-guard.js";
import { executeTool } from "../../src/runtime/agent-core.js";

describe("sensitiveFileReason", () => {
  it("flags shell startup files, PS profiles, fish config, git/husky hooks", () => {
    expect(sensitiveFileReason(".bashrc")).toMatch(/shell startup/);
    expect(sensitiveFileReason("/home/u/.zshenv")).toMatch(/shell startup/);
    expect(sensitiveFileReason("C:\\Users\\u\\.profile")).toMatch(/startup/);
    expect(
      sensitiveFileReason(
        "C:\\Users\\u\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1",
      ),
    ).toMatch(/PowerShell profile/);
    expect(sensitiveFileReason("~/.config/fish/config.fish")).toMatch(/fish/);
    expect(sensitiveFileReason("repo/.git/hooks/pre-commit")).toMatch(
      /git hook/,
    );
    expect(sensitiveFileReason("repo/.husky/pre-push")).toMatch(/husky/);
  });

  it("flags direnv .envrc (executes on directory entry)", () => {
    expect(sensitiveFileReason(".envrc")).toMatch(/direnv/);
    expect(sensitiveFileReason("/home/u/project/.envrc")).toMatch(/direnv/);
    expect(sensitiveFileReason("C:\\repo\\.envrc")).toMatch(/direnv/);
  });

  it("flags .bash_aliases (auto-sourced by default .bashrc)", () => {
    expect(sensitiveFileReason("~/.bash_aliases")).toMatch(/shell startup/);
  });

  it("flags all PowerShell host profiles, not just the console one", () => {
    for (const f of [
      "Documents/PowerShell/Microsoft.VSCode_profile.ps1",
      "Documents/WindowsPowerShell/Microsoft.PowerShellISE_profile.ps1",
      "C:\\Users\\u\\Documents\\PowerShell\\profile.ps1",
    ]) {
      expect(sensitiveFileReason(f), f).toMatch(/PowerShell profile/);
    }
  });

  it("flags auto-sourced fish conf.d snippets", () => {
    expect(sensitiveFileReason("~/.config/fish/conf.d/aliases.fish")).toMatch(
      /fish/,
    );
  });

  it("leaves everyday files alone (incl. .husky/_ internals)", () => {
    expect(sensitiveFileReason("src/index.js")).toBeNull();
    expect(sensitiveFileReason("package.json")).toBeNull();
    expect(sensitiveFileReason("Makefile")).toBeNull();
    expect(sensitiveFileReason("docs/profile.md")).toBeNull();
    expect(sensitiveFileReason(".husky/_/husky.sh")).toBeNull();
    expect(sensitiveFileReason("")).toBeNull();
  });
});

describe("executeTool sensitive-file seam", () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sensfile-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("headless (no confirmer) write to .bashrc fails closed", async () => {
    const res = await executeTool(
      "write_file",
      { path: ".bashrc", content: "echo pwned" },
      { cwd: tmp },
    );
    expect(res.error).toMatch(/\[Sensitive File\]/);
    expect(res.policy).toMatchObject({
      decision: "ask",
      via: "sensitive-file",
    });
    expect(fs.existsSync(path.join(tmp, ".bashrc"))).toBe(false);
  });

  it("declined confirmation blocks; approval proceeds", async () => {
    const denied = await executeTool(
      "write_file",
      { path: ".zshenv", content: "x" },
      { cwd: tmp, permissionConfirm: async () => false },
    );
    expect(denied.error).toMatch(/Sensitive File/);

    let seen = null;
    const ok = await executeTool(
      "write_file",
      { path: ".zshenv", content: "export A=1" },
      {
        cwd: tmp,
        permissionConfirm: async (q) => {
          seen = q;
          return true;
        },
      },
    );
    expect(ok.error).toBeUndefined();
    expect(seen.reason).toMatch(/sensitive file: shell startup/);
    expect(fs.readFileSync(path.join(tmp, ".zshenv"), "utf-8")).toBe(
      "export A=1",
    );
  });

  it("explicit settings allow rule bypasses the guard without confirming", async () => {
    let confirmCalled = false;
    const res = await executeTool(
      "write_file",
      { path: ".bashrc", content: "alias ll='ls -la'" },
      {
        cwd: tmp,
        permissionRules: { allow: ["Write"] },
        permissionConfirm: async () => {
          confirmCalled = true;
          return false;
        },
      },
    );
    expect(res.error).toBeUndefined();
    expect(confirmCalled).toBe(false);
    expect(fs.existsSync(path.join(tmp, ".bashrc"))).toBe(true);
  });

  it("ordinary files are untouched by the guard (headless write proceeds)", async () => {
    const res = await executeTool(
      "write_file",
      { path: "notes.txt", content: "plain" },
      { cwd: tmp },
    );
    expect(res.error).toBeUndefined();
    expect(fs.readFileSync(path.join(tmp, "notes.txt"), "utf-8")).toBe("plain");
  });
});

describe("autoExecConfigReason", () => {
  it("flags VS Code tasks/launch/settings", () => {
    expect(autoExecConfigReason(".vscode/tasks.json")).toMatch(
      /auto-exec config: VS Code tasks/,
    );
    expect(autoExecConfigReason("C:\\repo\\.vscode\\tasks.json")).toMatch(
      /VS Code tasks/,
    );
    expect(autoExecConfigReason("proj/.vscode/launch.json")).toMatch(
      /launch\/debug/,
    );
    expect(autoExecConfigReason(".vscode/settings.json")).toMatch(
      /workspace settings/,
    );
  });

  it("flags MCP configs, JetBrains run configs/workspace.xml", () => {
    expect(autoExecConfigReason(".mcp.json")).toMatch(/MCP server config/);
    expect(autoExecConfigReason("sub/dir/mcp.json")).toMatch(/MCP server/);
    expect(autoExecConfigReason(".idea/runConfigurations/x.xml")).toMatch(
      /JetBrains run configuration/,
    );
    expect(
      autoExecConfigReason("C:\\repo\\.idea\\runConfigurations\\build.xml"),
    ).toMatch(/JetBrains run configuration/);
    expect(autoExecConfigReason(".idea/workspace.xml")).toMatch(
      /workspace\.xml/,
    );
  });

  it("flags devcontainer.json and *.code-workspace", () => {
    expect(autoExecConfigReason(".devcontainer/devcontainer.json")).toMatch(
      /devcontainer/,
    );
    expect(autoExecConfigReason("devcontainer.json")).toMatch(/devcontainer/);
    expect(autoExecConfigReason("my-project.code-workspace")).toMatch(
      /workspace file/,
    );
  });

  it("leaves ordinary files (incl. other .vscode/.idea files) alone", () => {
    expect(autoExecConfigReason(".vscode/foo.txt")).toBeNull();
    expect(autoExecConfigReason(".vscode/extensions.json")).toBeNull();
    expect(autoExecConfigReason(".idea/misc.xml")).toBeNull();
    expect(autoExecConfigReason("src/tasks.json")).toBeNull();
    expect(autoExecConfigReason("package.json")).toBeNull();
    expect(autoExecConfigReason("")).toBeNull();
  });
});

describe("executeTool auto-exec config seam", () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-autoexec-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("headless write to .vscode/tasks.json fails closed", async () => {
    fs.mkdirSync(path.join(tmp, ".vscode"));
    const res = await executeTool(
      "write_file",
      { path: ".vscode/tasks.json", content: '{"tasks":[]}' },
      { cwd: tmp },
    );
    expect(res.error).toMatch(/\[Sensitive File\]/);
    expect(res.error).toMatch(/auto-exec config/);
    expect(res.policy).toMatchObject({
      decision: "ask",
      via: "sensitive-file",
    });
    expect(fs.existsSync(path.join(tmp, ".vscode", "tasks.json"))).toBe(false);
  });

  it("headless write to a JetBrains run configuration fails closed", async () => {
    const res = await executeTool(
      "write_file",
      { path: ".idea/runConfigurations/x.xml", content: "<component/>" },
      { cwd: tmp },
    );
    expect(res.error).toMatch(/auto-exec config: JetBrains run configuration/);
  });

  it("confirmation carries the auto-exec reason; approval proceeds", async () => {
    fs.mkdirSync(path.join(tmp, ".vscode"));
    let seen = null;
    const ok = await executeTool(
      "write_file",
      { path: ".vscode/tasks.json", content: '{"tasks":[]}' },
      {
        cwd: tmp,
        permissionConfirm: async (q) => {
          seen = q;
          return true;
        },
      },
    );
    expect(ok.error).toBeUndefined();
    expect(seen.reason).toMatch(/sensitive file: auto-exec config: VS Code/);
    expect(fs.existsSync(path.join(tmp, ".vscode", "tasks.json"))).toBe(true);
  });

  it("ordinary .vscode files pass the guard (headless write proceeds)", async () => {
    fs.mkdirSync(path.join(tmp, ".vscode"));
    const res = await executeTool(
      "write_file",
      { path: ".vscode/foo.txt", content: "plain" },
      { cwd: tmp },
    );
    expect(res.error).toBeUndefined();
    expect(fs.readFileSync(path.join(tmp, ".vscode", "foo.txt"), "utf-8")).toBe(
      "plain",
    );
  });
});
