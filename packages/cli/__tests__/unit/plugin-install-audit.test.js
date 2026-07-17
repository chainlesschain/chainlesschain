/**
 * cc plugin add / upgrade — unified install-command audit (Plugin-Bin install
 * path, P0 sandbox slice). A plugin ships executable components, so installing
 * one joins the same opt-in "fetch and run third-party code" trail
 * (CC_INSTALL_AUDIT → ~audit/install-commands.jsonl) as run_shell installs and
 * run_code auto-installs. Default (policy off) → zero writes, byte-unchanged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPluginCommand } from "../../src/commands/plugin.js";
import { _deps as consentDeps } from "../../src/lib/plugin-runtime/capability-consent.js";

let cwd, srcRoot, storeDir, auditDir, logSpy, errSpy, origStorePath;
const ENV_KEYS = ["CC_INSTALL_AUDIT", "CC_AUDIT_DIR"];
let savedEnv;

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
  return logSpy.mock.calls
    .map((c) => c.map((a) => String(a ?? "")).join(" "))
    .join("\n");
}

function makeSource(name, version, permissions) {
  const dir = fs.mkdtempSync(path.join(srcRoot, `${name}-`));
  const manifest = { name, version };
  if (permissions) manifest.permissions = permissions;
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify(manifest),
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

function auditRecords() {
  const file = path.join(auditDir, "install-commands.jsonl");
  if (!fs.existsSync(file)) return null;
  return fs
    .readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pia-cwd-"));
  srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pia-src-"));
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pia-store-"));
  auditDir = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-pia-audit-")),
    "audit",
  );
  origStorePath = consentDeps.storePath;
  consentDeps.storePath = () => path.join(storeDir, "consent.json");
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
});

afterEach(() => {
  consentDeps.storePath = origStorePath;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const d of [cwd, srcRoot, storeDir, path.dirname(auditDir)]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("cc plugin add — unified install audit", () => {
  it("writes nothing when the policy is off (default byte-unchanged)", async () => {
    const dir = makeSource("plain", "1.0.0", null);
    const out = JSON.parse(
      await run("add", dir, "--scope", "project", "--json"),
    );
    expect(out.name).toBe("plain");
    expect(auditRecords()).toBeNull();
  });

  it("records a plugin_install entry with the unified classification when opted in", async () => {
    process.env.CC_INSTALL_AUDIT = "1";
    process.env.CC_AUDIT_DIR = auditDir;
    const dir = makeSource("greeter", "1.0.0", { process: true });
    const out = JSON.parse(
      await run("add", dir, "--scope", "project", "--json"),
    );
    expect(out.name).toBe("greeter");

    const records = auditRecords();
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.kind).toBe("install-command");
    expect(r.source).toBe("plugin_install");
    expect(r.action).toBe("add");
    expect(r.install.manager).toBe("cc-plugin");
    expect(r.install.packages).toEqual(["greeter@1.0.0"]);
    expect(r.install.global).toBe(false); // project scope
    // Declared capabilities ride along so the trail says WHAT it may run.
    expect(String(r.install.capabilities)).toMatch(/process/);
  });

  it("an upgrade that lands a new version records action:upgrade; up-to-date records nothing", async () => {
    process.env.CC_INSTALL_AUDIT = "1";
    process.env.CC_AUDIT_DIR = auditDir;
    // "local" scope keeps the install inside the temp cwd (never the real
    // user data dir) while still exercising the upgrade path.
    const v1 = makeSource("greeter", "1.0.0", null);
    await run("add", v1, "--scope", "local", "--json");
    const v2 = makeSource("greeter", "2.0.0", null);
    await run("upgrade", v2, "--scope", "local");

    let records = auditRecords();
    expect(records).toHaveLength(2);
    expect(records[1].action).toBe("upgrade");
    expect(records[1].install.packages).toEqual(["greeter@2.0.0"]);
    expect(records[1].install.global).toBe(false); // repo-local scope

    // Same version again, no --force → nothing new landed → no record.
    await run("upgrade", v2, "--scope", "local");
    records = auditRecords();
    expect(records).toHaveLength(2);
  });
});
