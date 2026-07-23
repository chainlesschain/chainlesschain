import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  installFromDirectory,
  installFromSource,
  updatePlugin,
  listInstalled,
  uninstall,
  setActiveVersion,
  getActiveVersion,
  parseGitSource,
  _deps as installDeps,
} from "../../src/lib/plugin-runtime/install.js";
import { execSync } from "node:child_process";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";

let cwd; // acts as the project root for project/local scopes
let srcRoot; // where source plugin fixtures live

function makeSource(name, version, { withSkill = true, extra = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(srcRoot, `${name}-`));
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version, ...extra }),
    "utf8",
  );
  if (withSkill) {
    const s = path.join(dir, "skills", "hello");
    fs.mkdirSync(s, { recursive: true });
    fs.writeFileSync(
      path.join(s, "SKILL.md"),
      "---\nname: hello\n---\nhi",
      "utf8",
    );
  }
  return dir;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-inst-cwd-"));
  srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-inst-src-"));
});
afterEach(() => {
  for (const d of [cwd, srcRoot]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("installFromDirectory", () => {
  it("copies a valid plugin into the scope version dir and marks it active", () => {
    const src = makeSource("greeter", "1.0.0");
    const res = installFromDirectory(src, { scope: "project", cwd });
    expect(res).toMatchObject({
      name: "greeter",
      version: "1.0.0",
      scope: "project",
    });
    const dest = pluginVersionDir("project", "greeter", "1.0.0", { cwd });
    expect(fs.existsSync(path.join(dest, "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "skills", "hello", "SKILL.md"))).toBe(
      true,
    );
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("refuses to overwrite an immutable version without force", () => {
    const src = makeSource("greeter", "1.0.0");
    installFromDirectory(src, { scope: "project", cwd });
    expect(() => installFromDirectory(src, { scope: "project", cwd })).toThrow(
      /already installed.*immutable/,
    );
  });

  it("reinstalls with force", () => {
    const src = makeSource("greeter", "1.0.0");
    installFromDirectory(src, { scope: "project", cwd });
    const res = installFromDirectory(src, {
      scope: "project",
      cwd,
      force: true,
    });
    expect(res.version).toBe("1.0.0");
  });

  it("rejects an invalid manifest", () => {
    const src = makeSource("evil", "1.0.0", {
      extra: { skills: [{ name: "x", path: "../../../etc" }] },
    });
    expect(() => installFromDirectory(src, { scope: "project", cwd })).toThrow(
      /manifest is invalid/,
    );
  });
});

describe("installFromSource", () => {
  it("installs from an existing local directory", () => {
    const src = makeSource("greeter", "1.0.0");
    const res = installFromSource(src, { scope: "project", cwd });
    expect(res.name).toBe("greeter");
  });

  it("errors on a plain non-remote, non-existent source", () => {
    // A bare word is neither a directory nor a git URL.
    expect(() =>
      installFromSource("this-is-not-a-path-or-url", { scope: "project", cwd }),
    ).toThrow(/not found as a local directory or git URL/);
  });
});

describe("listInstalled", () => {
  it("lists installed plugins across scopes", () => {
    installFromDirectory(makeSource("alpha", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("beta", "0.2.0"), { scope: "local", cwd });
    const rows = listInstalled({ cwd, scopes: ["project", "local"] });
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
    expect(rows.every((r) => r.ok)).toBe(true);
  });
});

describe("updatePlugin (upgrade from source)", () => {
  it("installs a NEW version, repoints .active, keeps the old on disk for rollback", () => {
    installFromDirectory(makeSource("widget", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const res = updatePlugin(makeSource("widget", "2.0.0"), {
      scope: "project",
      cwd,
    });
    expect(res.updated).toBe(true);
    expect(res.previousVersion).toBe("1.0.0");
    expect(res.version).toBe("2.0.0");
    expect(getActiveVersion("widget", { scope: "project", cwd })).toBe("2.0.0");
    // old version dir preserved (rollback via `cc plugin use widget 1.0.0`)
    expect(
      fs.existsSync(pluginVersionDir("project", "widget", "1.0.0", { cwd })),
    ).toBe(true);
  });

  it("is a no-op when already at the source version (no --force)", () => {
    const src = makeSource("widget", "1.0.0");
    installFromDirectory(src, { scope: "project", cwd });
    const res = updatePlugin(makeSource("widget", "1.0.0"), {
      scope: "project",
      cwd,
    });
    expect(res.updated).toBe(false);
    expect(res.reinstalled).toBe(false);
    expect(res.version).toBe("1.0.0");
  });

  it("--force reinstalls the same version", () => {
    installFromDirectory(makeSource("widget", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const res = updatePlugin(makeSource("widget", "1.0.0"), {
      scope: "project",
      cwd,
      force: true,
    });
    expect(res.reinstalled).toBe(true);
    expect(res.version).toBe("1.0.0");
  });

  it("installs a plugin that was not yet present", () => {
    const res = updatePlugin(makeSource("fresh", "1.0.0"), {
      scope: "project",
      cwd,
    });
    expect(res.updated).toBe(true);
    expect(res.previousVersion).toBe(null);
    expect(getActiveVersion("fresh", { scope: "project", cwd })).toBe("1.0.0");
  });
});

describe("uninstall + rollback", () => {
  it("removes a whole plugin (all versions)", () => {
    installFromDirectory(makeSource("greeter", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("greeter", "2.0.0"), {
      scope: "project",
      cwd,
    });
    const res = uninstall("greeter", { scope: "project", cwd });
    expect(res.removed.sort()).toEqual(["1.0.0", "2.0.0"]);
    expect(listInstalled({ cwd, scopes: ["project"] })).toHaveLength(0);
  });

  it("removes one version and repoints active to the newest remaining", () => {
    installFromDirectory(makeSource("greeter", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("greeter", "2.0.0"), {
      scope: "project",
      cwd,
    });
    // active is 2.0.0 (last installed); remove it → active falls back to 1.0.0
    uninstall("greeter", { scope: "project", cwd, version: "2.0.0" });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("removing a NON-active version leaves the pinned active version untouched", () => {
    for (const v of ["1.0.0", "2.0.0", "3.0.0"]) {
      installFromDirectory(makeSource("greeter", v), { scope: "project", cwd });
    }
    // Roll back: pin the OLD version as active.
    setActiveVersion("greeter", "1.0.0", { scope: "project", cwd });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
    // Uninstall an unrelated (non-active) version — the pin must NOT move to the
    // newest remaining (previously it silently jumped 1.0.0 → 2.0.0).
    uninstall("greeter", { scope: "project", cwd, version: "3.0.0" });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("setActiveVersion pins an older version (rollback)", () => {
    installFromDirectory(makeSource("greeter", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("greeter", "2.0.0"), {
      scope: "project",
      cwd,
    });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "2.0.0",
    );
    setActiveVersion("greeter", "1.0.0", { scope: "project", cwd });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("throws pinning a version that isn't installed", () => {
    installFromDirectory(makeSource("greeter", "1.0.0"), {
      scope: "project",
      cwd,
    });
    expect(() =>
      setActiveVersion("greeter", "9.9.9", { scope: "project", cwd }),
    ).toThrow(/not installed/);
  });
});

describe("parseGitSource", () => {
  it("expands GitHub shorthand owner/repo", () => {
    expect(parseGitSource("acme/widgets")).toEqual({
      url: "https://github.com/acme/widgets.git",
      ref: null,
    });
  });

  it("passes through git URLs and keeps the #ref", () => {
    expect(parseGitSource("https://example.com/p.git#v2")).toEqual({
      url: "https://example.com/p.git",
      ref: "v2",
    });
    expect(parseGitSource("git@github.com:acme/w.git")).toMatchObject({
      url: "git@github.com:acme/w.git",
    });
    expect(parseGitSource("file:///tmp/repo#main")).toEqual({
      url: "file:///tmp/repo",
      ref: "main",
    });
  });

  it("returns null for non-remote strings", () => {
    expect(parseGitSource("./local/dir")).toBeNull();
    expect(parseGitSource("just-a-word")).toBeNull();
  });
});

describe("installFromSource — git (mocked clone)", () => {
  let savedSpawn;
  beforeEach(() => {
    savedSpawn = installDeps.spawnSync;
  });
  afterEach(() => {
    installDeps.spawnSync = savedSpawn;
  });

  it("clones a remote source and installs it", () => {
    const calls = [];
    // Emulate `git clone … <dir>` by materializing a plugin at the target dir.
    installDeps.spawnSync = (cmd, args, options) => {
      calls.push([cmd, args, options]);
      const dir = args[args.length - 1];
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify({ name: "remote-plugin", version: "3.1.0" }),
        "utf8",
      );
      return { status: 0, stdout: "", stderr: "" };
    };
    const res = installFromSource("acme/widgets", { scope: "project", cwd });
    expect(res).toMatchObject({
      name: "remote-plugin",
      version: "3.1.0",
      source: "https://github.com/acme/widgets.git",
    });
    expect(listInstalled({ cwd, scopes: ["project"] })).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      "git",
      [
        "clone",
        "--depth",
        "1",
        "https://github.com/acme/widgets.git",
        expect.any(String),
      ],
      expect.objectContaining({
        origin: "plugin:install-git",
        policy: "allow",
        scope: "plugin-install",
        shell: false,
      }),
    ]);
  });

  it("reports a clear error when git is not installed", () => {
    installDeps.spawnSync = () => ({ error: { code: "ENOENT" }, status: null });
    expect(() =>
      installFromSource("acme/widgets", { scope: "project", cwd }),
    ).toThrow(/git is not installed/);
  });
});

// Real end-to-end against a LOCAL git repo (offline) — only when git exists.
let gitAvailable = false;
try {
  execSync("git --version", { stdio: "ignore" });
  gitAvailable = true;
} catch {
  gitAvailable = false;
}

describe.skipIf(!gitAvailable)(
  "installFromSource — git (real, local repo)",
  () => {
    it("clones a file:// repo and installs the plugin", () => {
      const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cc-gitrepo-"));
      fs.writeFileSync(
        path.join(repo, "plugin.json"),
        JSON.stringify({ name: "git-plugin", version: "1.0.0" }),
        "utf8",
      );
      const skillDir = path.join(repo, "skills", "gskill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: gskill\n---\nx",
        "utf8",
      );
      const git = (args) =>
        execSync(`git ${args}`, { cwd: repo, stdio: "ignore" });
      git("init -q");
      git("-c user.email=t@t -c user.name=t add -A");
      execSync("git -c user.email=t@t -c user.name=t commit -q -m init", {
        cwd: repo,
        stdio: "ignore",
      });

      const url = "file://" + repo.replace(/\\/g, "/");
      try {
        const res = installFromSource(url, { scope: "project", cwd });
        expect(res.name).toBe("git-plugin");
        const rows = listInstalled({ cwd, scopes: ["project"] });
        expect(rows.map((r) => r.name)).toContain("git-plugin");
      } finally {
        try {
          fs.rmSync(repo, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    });
  },
);
