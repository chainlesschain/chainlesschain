/**
 * cc plugin consent — view / grant / revoke / list a plugin's capability
 * consent, and `cc plugin validate` rendering declared capabilities. Installs a
 * real plugin fixture into a temp project scope and drives the Commander
 * subcommands, with the consent store redirected to a temp file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPluginCommand } from "../../src/commands/plugin.js";
import { installFromDirectory } from "../../src/lib/plugin-runtime/install.js";
import { _deps as consentDeps } from "../../src/lib/plugin-runtime/capability-consent.js";

let cwd, srcRoot, storeDir, logSpy, errSpy, origStorePath;

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

function makeSource(name, version, permissions) {
  const dir = fs.mkdtempSync(path.join(srcRoot, `${name}-`));
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version, permissions }),
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

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-consent-cwd-"));
  srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-consent-src-"));
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-consent-store-"));
  origStorePath = consentDeps.storePath;
  consentDeps.storePath = () => path.join(storeDir, "consent.json");
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
});

afterEach(() => {
  consentDeps.storePath = origStorePath;
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

describe("cc plugin consent", () => {
  it("reports NEEDS CONSENT for a freshly-installed plugin, then consented after --grant", async () => {
    installFromDirectory(makeSource("greeter", "1.0.0", { process: true }), {
      scope: "project",
      cwd,
    });

    const before = JSON.parse(await run("consent", "greeter", "--json"));
    expect(before.consented).toBe(false);
    expect(before.declared.join(" ")).toMatch(/process/);

    const granted = JSON.parse(
      await run("consent", "greeter", "--grant", "--json"),
    );
    expect(granted.granted).toBe(true);

    const after = JSON.parse(await run("consent", "greeter", "--json"));
    expect(after.consented).toBe(true);
  });

  it("re-prompts after an upgrade widens capabilities", async () => {
    installFromDirectory(makeSource("greeter", "1.0.0", { process: true }), {
      scope: "project",
      cwd,
    });
    await run("consent", "greeter", "--grant", "--json");

    // Upgrade in place to a version that also wants network.
    installFromDirectory(
      makeSource("greeter", "2.0.0", { process: true, network: "*" }),
      { scope: "project", cwd },
    );
    const status = JSON.parse(await run("consent", "greeter", "--json"));
    expect(status.consented).toBe(false);
    expect(status.added).toContain("network:*");
  });

  it("lists and revokes consent", async () => {
    installFromDirectory(makeSource("greeter", "1.0.0", { process: true }), {
      scope: "project",
      cwd,
    });
    await run("consent", "greeter", "--grant", "--json");

    const list = JSON.parse(await run("consent", "--list", "--json"));
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("greeter");

    await run("consent", "greeter", "--revoke");
    expect(JSON.parse(await run("consent", "--list", "--json"))).toEqual([]);
  });

  it("errors when the plugin is not installed", async () => {
    await run("consent", "ghost", "--json");
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.flat().join("\n")).toMatch(/not installed/i);
  });
});

describe("cc plugin validate — capabilities section", () => {
  it("renders declared capabilities as JSON", async () => {
    const dir = makeSource("capplug", "1.0.0", {
      process: true,
      credential: ["GH_TOKEN"],
    });
    const out = JSON.parse(await run("validate", dir, "--json"));
    expect(out.capabilitiesDeclared).toBe(true);
    expect(out.capabilities.process).toBe(true);
    expect(out.capabilities.credential.names).toContain("GH_TOKEN");
  });
});
