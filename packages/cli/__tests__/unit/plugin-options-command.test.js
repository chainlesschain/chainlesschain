/**
 * cc plugin options — view / set a plugin's typed options, and the sensitive
 * project-scope gate. Installs a real plugin fixture (with optionsSchema) into
 * a temp project scope and drives the Commander subcommand, with the option
 * store redirected to temp files.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPluginCommand } from "../../src/commands/plugin.js";
import { installFromDirectory } from "../../src/lib/plugin-runtime/install.js";
import { _deps as optDeps } from "../../src/lib/plugin-runtime/plugin-options.js";

let cwd, srcRoot, storeDir, logSpy, errSpy, orig;

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerPluginCommand(program);
  return program;
}

async function run(...argv) {
  logSpy.mockClear();
  errSpy.mockClear();
  process.exitCode = 0;
  await makeProgram().parseAsync(["node", "cc", "plugin", ...argv]);
  return logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
}

function makeSource(name, optionsSchema) {
  const dir = fs.mkdtempSync(path.join(srcRoot, `${name}-`));
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0", optionsSchema }),
    "utf8",
  );
  const s = path.join(dir, "skills", "hello");
  fs.mkdirSync(s, { recursive: true });
  fs.writeFileSync(
    path.join(s, "SKILL.md"),
    "---\nname: hello\n---\nhi",
    "utf8",
  );
  return dir;
}

const SCHEMA = {
  endpoint: { type: "string", default: "https://api.example.com" },
  apiKey: { type: "string", sensitive: true },
};

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-opt-cwd-"));
  srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-opt-src-"));
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-opt-store-"));
  orig = { u: optDeps.userStorePath, p: optDeps.projectStorePath };
  optDeps.userStorePath = () => path.join(storeDir, "user.json");
  optDeps.projectStorePath = () => path.join(storeDir, "project.json");
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  installFromDirectory(makeSource("optplug", SCHEMA), {
    scope: "project",
    cwd,
  });
});

afterEach(() => {
  optDeps.userStorePath = orig.u;
  optDeps.projectStorePath = orig.p;
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const d of [cwd, srcRoot, storeDir]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("cc plugin options", () => {
  it("shows defaults for a freshly-installed plugin", async () => {
    const out = JSON.parse(await run("options", "optplug", "--json"));
    expect(out.options.endpoint).toBe("https://api.example.com");
    expect(out.sources.endpoint).toBe("default");
    expect(out.droppedFromProject).toEqual([]);
  });

  it("stores a user-scope value and reports it redacted with user source", async () => {
    await run(
      "options",
      "optplug",
      "--set",
      "apiKey=s3cr3t",
      "--scope",
      "user",
    );
    const out = JSON.parse(await run("options", "optplug", "--json"));
    expect(out.options.apiKey).toBe("***"); // redacted for display
    expect(out.sources.apiKey).toBe("user");
  });

  it("drops a sensitive value set at project scope (gate)", async () => {
    await run(
      "options",
      "optplug",
      "--set",
      "apiKey=leak",
      "--scope",
      "project",
    );
    const out = JSON.parse(await run("options", "optplug", "--json"));
    expect(out.options.apiKey).toBeUndefined();
    expect(out.droppedFromProject).toContain("apiKey");
  });

  it("errors on malformed --set and unknown plugin", async () => {
    await run("options", "optplug", "--set", "noequals");
    expect(process.exitCode).toBe(1);
    await run("options", "ghost", "--json");
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.flat().join("\n")).toMatch(/not installed/i);
  });
});
