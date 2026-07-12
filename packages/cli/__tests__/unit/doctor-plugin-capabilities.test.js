/**
 * cc doctor — Plugin trust section now also flags a plugin whose DECLARED
 * capabilities have not been consented (distinct from the existing signature-
 * lock check). Installs a real plugin fixture with a `permissions` block into a
 * temp project scope, redirects the consent store, and asserts the finding
 * appears, then clears after consent is granted.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectCheckupSections } from "../../src/lib/doctor-checkup.js";
import { installFromDirectory } from "../../src/lib/plugin-runtime/install.js";
import {
  consentPluginCapabilities,
  _deps as consentDeps,
} from "../../src/lib/plugin-runtime/capability-consent.js";

let cwd, srcRoot, storeDir, origStorePath;

function fakeDeps(overrides = {}) {
  return {
    existsSync: () => false,
    readFileSync: () => "",
    readdirSync: () => [],
    statSync: () => ({ mtimeMs: 0, size: 0 }),
    now: () => 10_000_000,
    ...overrides,
  };
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

async function pluginChecks() {
  const sections = await collectCheckupSections({ cwd, deps: fakeDeps() });
  return sections.find((s) => s.id === "plugins").checks;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-docct-cwd-"));
  srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-docct-src-"));
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-docct-store-"));
  origStorePath = consentDeps.storePath;
  consentDeps.storePath = () => path.join(storeDir, "consent.json");
});

afterEach(() => {
  consentDeps.storePath = origStorePath;
  for (const d of [cwd, srcRoot, storeDir]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("doctor Plugin trust — capability consent", () => {
  it("warns about a plugin whose declared capabilities are not consented", async () => {
    installFromDirectory(makeSource("greeter", "1.0.0", { process: true }), {
      scope: "project",
      cwd,
    });
    const finding = (await pluginChecks()).find(
      (c) =>
        c.id === "plugin-capability-unconsented" &&
        String(c.name).includes("greeter"),
    );
    expect(finding).toBeTruthy();
    expect(finding.detail).toMatch(/cc plugin consent greeter/);
  });

  it("clears the warning once capabilities are consented", async () => {
    installFromDirectory(makeSource("greeter", "1.0.0", { process: true }), {
      scope: "project",
      cwd,
    });
    consentPluginCapabilities("greeter", {
      scope: "project",
      version: "1.0.0",
      capabilities: { process: true },
    });
    const finding = (await pluginChecks()).find(
      (c) =>
        c.id === "plugin-capability-unconsented" &&
        String(c.name).includes("greeter"),
    );
    expect(finding).toBeUndefined();
  });

  it("does not warn about a plugin that declares no capabilities", async () => {
    installFromDirectory(makeSource("plain", "1.0.0", undefined), {
      scope: "project",
      cwd,
    });
    const finding = (await pluginChecks()).find(
      (c) =>
        c.id === "plugin-capability-unconsented" &&
        String(c.name).includes("plain"),
    );
    expect(finding).toBeUndefined();
  });
});
