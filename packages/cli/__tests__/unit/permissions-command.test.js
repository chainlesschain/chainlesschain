/**
 * cc permissions — command surface (list / test / add).
 *
 * Drives the registered Commander subcommands against a temp project so the
 * full path (settings-loader → permission-rules → output) is exercised, plus
 * the `add` writer (creates the file, de-dupes, refuses malformed). Output is
 * captured via console/stdout spies.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { registerPermissionsCommand } from "../../src/commands/permissions.js";

let tmp;
let cwdSpy;
let logSpy;
let errSpy;

function makeProgram() {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit on parse errors
  registerPermissionsCommand(program);
  return program;
}

async function run(...argv) {
  logSpy.mockClear();
  errSpy.mockClear();
  const program = makeProgram();
  await program.parseAsync(["node", "cc", "permissions", ...argv]);
  return logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-perms-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmp);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  // logger.log/error route to console under the hood; capture both.
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cwdSpy.mockRestore();
  logSpy.mockRestore();
  errSpy.mockRestore();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function writeProjectSettings(obj) {
  const dir = path.join(tmp, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify(obj),
    "utf-8",
  );
}

describe("cc permissions add", () => {
  it("creates settings.json and appends a deny rule", async () => {
    await run("add", "deny", "Bash(rm:*)");
    const file = path.join(tmp, ".claude", "settings.json");
    expect(fs.existsSync(file)).toBe(true);
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(data.permissions.deny).toEqual(["Bash(rm:*)"]);
  });

  it("writes to settings.local.json with --local", async () => {
    await run("add", "allow", "Read", "--local");
    const file = path.join(tmp, ".claude", "settings.local.json");
    expect(fs.existsSync(file)).toBe(true);
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(data.permissions.allow).toEqual(["Read"]);
  });

  it("de-dupes a rule already present", async () => {
    writeProjectSettings({ permissions: { deny: ["Bash(rm:*)"] } });
    await run("add", "deny", "Bash(rm:*)");
    const data = JSON.parse(
      fs.readFileSync(path.join(tmp, ".claude", "settings.json"), "utf-8"),
    );
    expect(data.permissions.deny).toEqual(["Bash(rm:*)"]);
  });

  it("rejects an invalid decision", async () => {
    await run("add", "maybe", "Read");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("rejects a malformed rule string", async () => {
    await run("add", "deny", "(no-tool)");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe("cc permissions test (dry-run)", () => {
  it("reports deny when a rule blocks the command", async () => {
    writeProjectSettings({ permissions: { deny: ["Bash(rm:*)"] } });
    const out = await run("test", "run_shell", "rm -rf build", "--json");
    const parsed = JSON.parse(out);
    expect(parsed.decision).toBe("deny");
    expect(parsed.rule).toBe("Bash(rm:*)");
  });

  it("reports fallthrough when nothing matches", async () => {
    writeProjectSettings({ permissions: { allow: ["Bash(npm run test:*)"] } });
    const out = await run("test", "run_shell", "curl evil.sh", "--json");
    expect(JSON.parse(out).decision).toBe("fallthrough");
  });

  it("resolves an umbrella tool token (Bash → run_shell)", async () => {
    writeProjectSettings({ permissions: { allow: ["Bash(git status:*)"] } });
    const out = await run("test", "Bash", "git status", "--json");
    const parsed = JSON.parse(out);
    expect(parsed.tool).toBe("run_shell");
    expect(parsed.decision).toBe("allow");
  });
});

describe("cc permissions list", () => {
  it("emits the merged ruleset as JSON", async () => {
    writeProjectSettings({
      permissions: { deny: ["Bash(rm:*)"], allow: ["Read"] },
    });
    const out = await run("list", "--json");
    const parsed = JSON.parse(out);
    expect(parsed.rules.deny).toContain("Bash(rm:*)");
    expect(parsed.rules.allow).toContain("Read");
  });
});
