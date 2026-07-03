import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  encodeName,
  scopeRoot,
  pluginVersionDir,
  listInstalledVersions,
  activeVersion,
  discoverPlugins,
  SCOPES,
} from "../../src/lib/plugin-runtime/scopes.js";

let cwd;

function writePlugin(scope, name, version, extra = {}) {
  const dir = pluginVersionDir(scope, name, version, { cwd });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version, ...extra }),
    "utf8",
  );
  return dir;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-scope-"));
});
afterEach(() => {
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("scope model", () => {
  it("exposes the three scopes lowest→highest precedence", () => {
    expect(SCOPES).toEqual(["user", "project", "local"]);
  });

  it("encodes unsafe name characters", () => {
    expect(encodeName("@org/my-plugin")).toBe("__org__my-plugin");
    expect(encodeName("plain.name_1")).toBe("plain.name_1");
  });

  it("resolves project/local roots under cwd/.chainlesschain", () => {
    expect(scopeRoot("project", { cwd })).toBe(
      path.join(cwd, ".chainlesschain", "plugins"),
    );
    expect(scopeRoot("local", { cwd })).toBe(
      path.join(cwd, ".chainlesschain", "plugins.local"),
    );
  });

  it("throws on an unknown scope", () => {
    expect(() => scopeRoot("bogus", { cwd })).toThrow(/unknown plugin scope/);
  });
});

describe("version directories", () => {
  it("lists installed versions newest-first, ignoring non-semver", () => {
    writePlugin("project", "p", "1.0.0");
    writePlugin("project", "p", "1.2.0");
    writePlugin("project", "p", "0.9.0");
    fs.mkdirSync(path.join(cwd, ".chainlesschain", "plugins", "p", "junk"), {
      recursive: true,
    });
    expect(listInstalledVersions("project", "p", { cwd })).toEqual([
      "1.2.0",
      "1.0.0",
      "0.9.0",
    ]);
  });

  it("active version is highest semver by default", () => {
    writePlugin("project", "p", "1.0.0");
    writePlugin("project", "p", "2.0.0");
    expect(activeVersion("project", "p", { cwd })).toBe("2.0.0");
  });

  it("active version honors a valid .active pin", () => {
    writePlugin("project", "p", "1.0.0");
    writePlugin("project", "p", "2.0.0");
    fs.writeFileSync(
      path.join(cwd, ".chainlesschain", "plugins", "p", ".active"),
      "1.0.0",
      "utf8",
    );
    expect(activeVersion("project", "p", { cwd })).toBe("1.0.0");
  });

  it("ignores an .active pin that isn't installed", () => {
    writePlugin("project", "p", "1.0.0");
    fs.writeFileSync(
      path.join(cwd, ".chainlesschain", "plugins", "p", ".active"),
      "9.9.9",
      "utf8",
    );
    expect(activeVersion("project", "p", { cwd })).toBe("1.0.0");
  });
});

describe("discoverPlugins", () => {
  it("returns active versions across scopes", () => {
    writePlugin("project", "alpha", "1.0.0");
    writePlugin("local", "beta", "0.3.0");
    const found = discoverPlugins({ cwd, scopes: ["project", "local"] });
    const byName = Object.fromEntries(found.map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(["alpha", "beta"]);
    expect(byName.alpha.scope).toBe("project");
    expect(byName.beta.scope).toBe("local");
    expect(byName.alpha.manifest.ok).toBe(true);
  });

  it("local scope overrides project on a name collision (precedence)", () => {
    writePlugin("project", "shared", "1.0.0", { description: "from-project" });
    writePlugin("local", "shared", "1.0.0", { description: "from-local" });
    const found = discoverPlugins({ cwd, scopes: ["project", "local"] });
    expect(found).toHaveLength(1);
    expect(found[0].scope).toBe("local");
    expect(found[0].manifest.metadata.description).toBe("from-local");
  });
});
