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
  inspectActivePointer,
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
  fs.writeFileSync(path.join(path.dirname(dir), ".active"), version, "utf8");
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
    expect(() => encodeName(".")).toThrow(/invalid plugin name/);
    expect(() => encodeName("..")).toThrow(/invalid plugin name/);
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

  it("fails closed when installed versions have no .active authority", () => {
    writePlugin("project", "p", "1.0.0");
    writePlugin("project", "p", "2.0.0");
    fs.rmSync(path.join(cwd, ".chainlesschain", "plugins", "p", ".active"));
    expect(activeVersion("project", "p", { cwd })).toBeNull();
    expect(inspectActivePointer("project", "p", { cwd })).toMatchObject({
      status: "missing",
      version: null,
      versions: ["2.0.0", "1.0.0"],
    });
    expect(discoverPlugins({ cwd, scopes: ["project"] })).toEqual([]);
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

  it("fails closed for a dangling .active pin", () => {
    writePlugin("project", "p", "1.0.0");
    fs.writeFileSync(
      path.join(cwd, ".chainlesschain", "plugins", "p", ".active"),
      "9.9.9",
      "utf8",
    );
    expect(activeVersion("project", "p", { cwd })).toBeNull();
    expect(inspectActivePointer("project", "p", { cwd })).toMatchObject({
      status: "dangling",
      pinned: "9.9.9",
    });
  });

  it("fails closed for a corrupt .active pin", () => {
    writePlugin("project", "p", "1.0.0");
    fs.writeFileSync(
      path.join(cwd, ".chainlesschain", "plugins", "p", ".active"),
      "not-a-version",
      "utf8",
    );
    expect(activeVersion("project", "p", { cwd })).toBeNull();
    expect(inspectActivePointer("project", "p", { cwd }).status).toBe(
      "corrupt",
    );
  });

  it("fails closed when .active cannot be read as a file", () => {
    writePlugin("project", "p", "1.0.0");
    const activeFile = path.join(
      cwd,
      ".chainlesschain",
      "plugins",
      "p",
      ".active",
    );
    fs.rmSync(activeFile);
    fs.mkdirSync(activeFile);
    expect(activeVersion("project", "p", { cwd })).toBeNull();
    expect(inspectActivePointer("project", "p", { cwd })).toMatchObject({
      status: "unsafe",
    });
  });

  it("fails closed for an oversized .active file", () => {
    writePlugin("project", "p", "1.0.0");
    fs.writeFileSync(
      path.join(cwd, ".chainlesschain", "plugins", "p", ".active"),
      "1".repeat(257),
      "utf8",
    );
    expect(inspectActivePointer("project", "p", { cwd }).status).toBe("unsafe");
  });

  it.runIf(process.platform !== "win32")(
    "fails closed for a symlinked .active file",
    () => {
      writePlugin("project", "p", "1.0.0");
      const nameDir = path.join(cwd, ".chainlesschain", "plugins", "p");
      const activeFile = path.join(nameDir, ".active");
      const target = path.join(nameDir, "pointer-target");
      fs.rmSync(activeFile);
      fs.writeFileSync(target, "1.0.0", "utf8");
      fs.symlinkSync(target, activeFile, "file");
      expect(inspectActivePointer("project", "p", { cwd }).status).toBe(
        "unsafe",
      );
    },
  );
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
    const found = discoverPlugins({ cwd, scopes: ["local", "project"] });
    expect(found).toHaveLength(1);
    expect(found[0].scope).toBe("local");
    expect(found[0].manifest.metadata.description).toBe("from-local");
  });

  it("does not let inert higher-scope lock cleanup debris shadow a plugin", () => {
    writePlugin("project", "shared", "1.0.0");
    fs.mkdirSync(
      path.join(
        cwd,
        ".chainlesschain",
        "plugins.local",
        "shared",
        ".plugin-transaction-lock.release-debris",
      ),
      { recursive: true },
    );

    expect(discoverPlugins({ cwd, scopes: ["project", "local"] })).toEqual([
      expect.objectContaining({ name: "shared", scope: "project" }),
    ]);
  });

  it("reserves a higher-scope name while its transaction lock is retained", () => {
    writePlugin("project", "shared", "1.0.0");
    const lockDir = path.join(
      cwd,
      ".chainlesschain",
      "plugins.local",
      "shared",
      ".plugin-transaction-lock",
    );
    fs.mkdirSync(lockDir, { recursive: true });

    expect(discoverPlugins({ cwd, scopes: ["project", "local"] })).toEqual([]);
    expect(
      discoverPlugins({
        cwd,
        scopes: ["project", "local"],
        includeBlocked: true,
      }),
    ).toEqual([
      expect.objectContaining({
        name: "shared",
        scope: "local",
        runtimeBlocked: true,
        pointerStatus: "recovery-required",
        recoveryRoot: lockDir,
      }),
    ]);
  });

  it("a broken higher scope reserves only that plugin name", () => {
    writePlugin("project", "shared", "1.0.0", {
      description: "must-not-fall-through",
    });
    writePlugin("local", "shared", "2.0.0");
    fs.rmSync(
      path.join(cwd, ".chainlesschain", "plugins.local", "shared", ".active"),
    );
    writePlugin("project", "healthy", "1.0.0");
    const blocked = [];

    const found = discoverPlugins({
      cwd,
      scopes: ["project", "local"],
      onBlocked: (entry) => blocked.push(entry),
    });

    expect(found.map((plugin) => plugin.name)).toEqual(["healthy"]);
    expect(blocked).toContainEqual({
      scope: "local",
      encodedName: "shared",
      pointerStatus: "missing",
      versions: ["2.0.0"],
    });
  });

  it("keeps a manifest-invalid active row visible only to management discovery", () => {
    const root = writePlugin("project", "broken-manifest", "1.0.0");
    fs.rmSync(path.join(root, "plugin.json"));

    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toEqual([]);
    expect(
      discoverPlugins({
        cwd,
        scopes: ["project"],
        skipPolicy: true,
        includeBlocked: true,
      }),
    ).toEqual([
      expect.objectContaining({
        name: "broken-manifest",
        version: null,
        inspectionVersion: "1.0.0",
        runtimeBlocked: true,
        pointerStatus: "manifest-invalid",
      }),
    ]);
  });
});
