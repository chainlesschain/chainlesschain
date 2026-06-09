/**
 * cc hook test — dry-run + --run of .claude/settings.json hooks.
 *
 * Drives the registered `hook test` subcommand against a temp project (no DB
 * needed — it's settings-only). Match mode lists hooks that would fire; --run
 * actually executes them with a real `node -e` command and reports the decision
 * (exit 2 → block).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { registerHookCommand } from "../../src/commands/hook.js";

let tmp, cwdSpy, logSpy;

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerHookCommand(program);
  return program;
}

async function run(...argv) {
  logSpy.mockClear();
  await makeProgram().parseAsync(["node", "cc", "hook", ...argv]);
  return logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
}

function writeHooks(block) {
  const dir = path.join(tmp, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify({ hooks: block }),
    "utf-8",
  );
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hooktest-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmp);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cwdSpy.mockRestore();
  vi.restoreAllMocks();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("cc hook test — match (dry-run)", () => {
  it("lists hooks that would fire for an event+tool (--json)", async () => {
    writeHooks({
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
    });
    const out = await run("test", "PreToolUse", "run_shell", "git push", "--json");
    const parsed = JSON.parse(out);
    expect(parsed.matched.map((m) => m.command)).toEqual(["guard.sh"]);
    expect(parsed.payload.tool_input.command).toBe("git push");
  });

  it("reports no match when the matcher misses", async () => {
    writeHooks({
      PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "x.sh" }] }],
    });
    const out = await run("test", "PreToolUse", "run_shell", "ls", "--json");
    expect(JSON.parse(out).matched).toEqual([]);
  });
});

describe("cc hook test --run (execute)", () => {
  it("executes a matched hook and reports block on exit 2", async () => {
    writeHooks({
      PreToolUse: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: 'node -e "process.exit(2)"' }],
        },
      ],
    });
    const out = await run("test", "PreToolUse", "run_shell", "rm -rf x", "--run", "--json");
    expect(JSON.parse(out).decision).toBe("block");
  });

  it("reports continue when the hook exits 0", async () => {
    writeHooks({
      PreToolUse: [
        { matcher: "*", hooks: [{ type: "command", command: 'node -e ""' }] },
      ],
    });
    const out = await run("test", "PreToolUse", "run_shell", "ls", "--run", "--json");
    expect(JSON.parse(out).decision).toBe("continue");
  });
});
