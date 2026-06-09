/**
 * cc output-style — command surface (list / show / new).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { registerOutputStyleCommand } from "../../src/commands/output-style.js";

let tmp, cwdSpy, logSpy;

async function run(...argv) {
  logSpy.mockClear();
  const program = new Command();
  program.exitOverride();
  registerOutputStyleCommand(program);
  await program.parseAsync(["node", "cc", "output-style", ...argv]);
  return logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ostyle-"));
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

describe("cc output-style list", () => {
  it("lists built-ins as JSON", async () => {
    const out = await run("list", "--json");
    const parsed = JSON.parse(out);
    const names = parsed.styles.map((s) => s.name);
    expect(names).toContain("explanatory");
    expect(names).toContain("learning");
  });
});

describe("cc output-style show", () => {
  it("shows a built-in body as JSON", async () => {
    const out = await run("show", "learning", "--json");
    expect(JSON.parse(out).name).toBe("learning");
  });
});

describe("cc output-style new", () => {
  it("scaffolds a style file and it becomes discoverable", async () => {
    await run("new", "pirate", "--description", "Arr");
    const file = path.join(tmp, ".claude", "output-styles", "pirate.md");
    expect(fs.existsSync(file)).toBe(true);
    const out = await run("show", "pirate", "--json");
    expect(JSON.parse(out)).toMatchObject({ name: "pirate", builtin: false });
  });
});
