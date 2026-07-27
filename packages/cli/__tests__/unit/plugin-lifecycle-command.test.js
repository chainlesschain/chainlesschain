import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPluginCommand } from "../../src/commands/plugin.js";
import { discoverPlugins } from "../../src/lib/plugin-runtime/scopes.js";

let cwd;
let source;
let logSpy;

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerPluginCommand(program);
  return program;
}

async function run(...argv) {
  logSpy.mockClear();
  process.exitCode = 0;
  await makeProgram().parseAsync(["node", "cc", "plugin", ...argv]);
  return logSpy.mock.calls
    .map((call) => call.map((value) => String(value ?? "")).join(" "))
    .join("\n");
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-life-cwd-"));
  source = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-life-src-"));
  fs.writeFileSync(
    path.join(source, "plugin.json"),
    JSON.stringify({ name: "switchable", version: "1.0.0" }),
    "utf8",
  );
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const dir of [cwd, source]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("cc plugin enable/disable --scope", () => {
  it("controls the unified runtime while retaining immutable versions", async () => {
    await run("add", source, "--scope", "project", "--json");

    expect(
      JSON.parse(
        await run("disable", "switchable", "--scope", "project", "--json"),
      ),
    ).toEqual({
      name: "switchable",
      scope: "project",
      enabled: false,
    });
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toEqual([]);
    const disabledRows = JSON.parse(await run("installed", "--json"));
    expect(disabledRows.find((row) => row.name === "switchable")).toMatchObject(
      {
        name: "switchable",
        version: "1.0.0",
        versions: ["1.0.0"],
        enabled: false,
      },
    );

    expect(
      JSON.parse(
        await run("enable", "switchable", "--scope", "project", "--json"),
      ),
    ).toMatchObject({ enabled: true });
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toHaveLength(1);
  });
});
