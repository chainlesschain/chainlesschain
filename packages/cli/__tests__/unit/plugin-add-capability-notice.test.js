/**
 * cc plugin add / upgrade — capability-diff + re-consent notice. Installs a real
 * plugin fixture through the `add` command and asserts the declared-capability
 * list (folded into --json) and the re-consent hint an upgrade surfaces when it
 * widens capabilities. The consent store is redirected to a temp file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPluginCommand } from "../../src/commands/plugin.js";
import {
  _deps as consentDeps,
  listCapabilityConsent,
} from "../../src/lib/plugin-runtime/capability-consent.js";

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

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-addcap-cwd-"));
  srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-addcap-src-"));
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-addcap-store-"));
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

describe("cc plugin add — capability notice", () => {
  it("folds a needs-consent capability list into --json for a fresh install", async () => {
    const dir = makeSource("greeter", "1.0.0", { process: true });
    const out = JSON.parse(
      await run("add", dir, "--scope", "project", "--json"),
    );
    expect(out.name).toBe("greeter");
    expect(out.capabilities).toBeTruthy();
    expect(out.capabilities.consented).toBe(false);
    expect(out.capabilities.declared.join(" ")).toMatch(/process/);
    expect(out.capabilities.added).toContain("process");
  });

  it("reports null capabilities for a plugin that declares none", async () => {
    const dir = makeSource("plain", "1.0.0", null);
    const out = JSON.parse(
      await run("add", dir, "--scope", "project", "--json"),
    );
    expect(out.name).toBe("plain");
    expect(out.capabilities).toBeNull();
  });

  it("prints the re-consent hint in text mode", async () => {
    const dir = makeSource("greeter", "1.0.0", { process: true });
    const text = await run("add", dir, "--scope", "project");
    expect(text).toMatch(/Capabilities \(declared\)/);
    expect(text).toMatch(/capability consent required/);
    expect(text).toMatch(/cc plugin consent greeter --grant/);
  });

  it("stays advisory (no grant) by default in a non-interactive session", async () => {
    const dir = makeSource("greeter", "1.0.0", { process: true });
    const out = JSON.parse(
      await run("add", dir, "--scope", "project", "--json"),
    );
    expect(out.capabilitiesGranted).toBe(false);
    expect(Object.keys(listCapabilityConsent())).toHaveLength(0);
  });

  it("--grant-capabilities records consent at install time (--json)", async () => {
    const dir = makeSource("greeter", "1.0.0", { process: true });
    const out = JSON.parse(
      await run(
        "add",
        dir,
        "--scope",
        "project",
        "--grant-capabilities",
        "--json",
      ),
    );
    expect(out.capabilitiesGranted).toBe(true);
    expect(
      listCapabilityConsent().find(
        (e) => e.scope === "project" && e.name === "greeter",
      ),
    ).toBeTruthy();
  });

  it("--grant-capabilities records consent at install time (text mode)", async () => {
    const dir = makeSource("greeter", "1.0.0", { process: true });
    const text = await run(
      "add",
      dir,
      "--scope",
      "project",
      "--grant-capabilities",
    );
    expect(text).toMatch(/capability consent granted for greeter/);
    expect(text).not.toMatch(/cc plugin consent greeter --grant/);
    expect(
      listCapabilityConsent().find(
        (e) => e.scope === "project" && e.name === "greeter",
      ),
    ).toBeTruthy();
  });
});

describe("cc plugin upgrade — capability diff", () => {
  it("surfaces a re-consent notice when an upgrade widens capabilities", async () => {
    // Install v1 (process) and grant consent.
    await run(
      "add",
      makeSource("greeter", "1.0.0", { process: true }),
      "--scope",
      "project",
      "--json",
    );
    await run("consent", "greeter", "--grant", "--json");

    // Upgrade to v2 that also wants network → widening → re-consent required.
    const text = await run(
      "upgrade",
      makeSource("greeter", "2.0.0", { process: true, network: "*" }),
      "--scope",
      "project",
    );
    expect(text).toMatch(/Updated greeter/);
    expect(text).toMatch(/capability consent required/);
    expect(text).toMatch(/network:\*/);
  });

  it("--grant-capabilities re-consents the widened set during upgrade", async () => {
    await run(
      "add",
      makeSource("greeter", "1.0.0", { process: true }),
      "--scope",
      "project",
      "--grant-capabilities",
    );

    const text = await run(
      "upgrade",
      makeSource("greeter", "2.0.0", { process: true, network: "*" }),
      "--scope",
      "project",
      "--grant-capabilities",
    );
    expect(text).toMatch(/Updated greeter/);
    expect(text).toMatch(/capability consent granted for greeter/);
    // The recorded consent now covers the widened set → a plain re-check is satisfied.
    const entry = listCapabilityConsent().find(
      (e) => e.scope === "project" && e.name === "greeter",
    );
    expect(entry).toBeTruthy();
    expect(entry.version).toBe("2.0.0");
  });

  it("shows a satisfied notice when an upgrade does not widen", async () => {
    await run(
      "add",
      makeSource("greeter", "1.0.0", { process: true }),
      "--scope",
      "project",
      "--json",
    );
    await run("consent", "greeter", "--grant", "--json");

    const text = await run(
      "upgrade",
      makeSource("greeter", "2.0.0", { process: true }),
      "--scope",
      "project",
    );
    expect(text).toMatch(/Updated greeter/);
    expect(text).toMatch(/capability consent:/);
    expect(text).not.toMatch(/capability consent required/);
  });
});
