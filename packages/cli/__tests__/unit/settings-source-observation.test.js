import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import observation from "../../src/lib/settings-source-observation.cjs";
import loader from "../../src/lib/settings-loader.cjs";

const { observeSettingsSource, observeSettingsSources, MAX_SETTINGS_SOURCES } =
  observation;
let root;
let originalHome;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-settings-observe-"));
  originalHome = loader._deps.homedir;
  loader._deps.homedir = () => path.join(root, "home");
});
afterEach(() => {
  loader._deps.homedir = originalHome;
  fs.rmSync(root, { recursive: true, force: true });
});

function write(relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof value === "object" && !Buffer.isBuffer(value)
      ? JSON.stringify(value)
      : value,
  );
  return file;
}

function onFirstRead(callback) {
  let called = false;
  return {
    ...fs,
    readSync(...args) {
      const count = fs.readSync(...args);
      if (count && !called) {
        called = true;
        callback();
      }
      return count;
    },
  };
}

describe("strict settings source observations", () => {
  it("derives immutable settings and digest from one descriptor's exact bytes", () => {
    const bytes = '{\n "permissions": {"deny":["Bash"]}, "model":"haiku"\n}\n';
    const file = write(".claude/settings.json", bytes);
    let nonemptyReads = 0;
    const runtimeFs = {
      ...fs,
      readFileSync() {
        throw new Error("must not reread by path");
      },
      readSync(...args) {
        const count = fs.readSync(...args);
        if (count) nonemptyReads++;
        return count;
      },
    };
    const result = observeSettingsSource(file, { fs: runtimeFs });
    expect(result).toMatchObject({
      logicalPath: file,
      physicalPath: fs.realpathSync(file),
      exists: true,
      byteLength: Buffer.byteLength(bytes),
      digest: createHash("sha256").update(bytes).digest("hex"),
      settings: { permissions: { deny: ["Bash"] }, model: "haiku" },
    });
    expect(nonemptyReads).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.settings.permissions.deny)).toBe(true);
    expect(() => result.settings.permissions.deny.push("Write")).toThrow();
  });

  it("binds missing directories and a future physical target instead of dropping a candidate", () => {
    const file = path.join(root, "missing", ".claude", "settings.json");
    const before = observeSettingsSource(file);
    expect(before).toMatchObject({
      exists: false,
      nearestExistingParent: fs.realpathSync(root),
      remainingPath: path.join("missing", ".claude", "settings.json"),
      physicalPath: path.join(
        fs.realpathSync(root),
        "missing",
        ".claude",
        "settings.json",
      ),
      digest: null,
      settings: null,
    });
    write("missing/.claude/settings.json", { env: { TOOL: "yes" } });
    const after = observeSettingsSource(file);
    expect(after.exists).toBe(true);
    expect(after.physicalPath).toBe(before.physicalPath);
    expect(after.nearestExistingParent).not.toBe(before.nearestExistingParent);
  });

  it("accepts atomic replacement between observations without pinning a permanent file inode", () => {
    const file = write("settings.json", { permissions: { allow: ["Read"] } });
    const before = observeSettingsSource(file);
    const replacement = write("new.json", { permissions: { deny: ["Read"] } });
    fs.renameSync(replacement, file);
    const after = observeSettingsSource(file);
    expect(after.physicalPath).toBe(before.physicalPath);
    expect(after.digest).not.toBe(before.digest);
    expect(before.settings.permissions.allow).toEqual(["Read"]);
    expect(after.settings.permissions.deny).toEqual(["Read"]);
  });

  it("rejects creation of a previously missing parent during the absence check", () => {
    const directory = path.join(root, ".claude");
    let created = false;
    const runtimeFs = {
      ...fs,
      fstatSync(...args) {
        const stat = fs.fstatSync(...args);
        if (!created) {
          created = true;
          fs.mkdirSync(directory);
        }
        return stat;
      },
    };
    expect(() =>
      observeSettingsSource(path.join(directory, "settings.json"), {
        fs: runtimeFs,
      }),
    ).toThrow(expect.objectContaining({ code: "CC_SETTINGS_SOURCE_CHANGED" }));
    expect(fs.existsSync(path.join(directory, "settings.json"))).toBe(false);
  });

  it("closes every opened descriptor even if a close fails, preserving the original read error", () => {
    const file = write("settings.json", "{");
    const outstanding = new Set();
    let failed = false;
    const runtimeFs = {
      ...fs,
      openSync(...args) {
        const fd = fs.openSync(...args);
        outstanding.add(fd);
        return fd;
      },
      closeSync(fd) {
        fs.closeSync(fd);
        outstanding.delete(fd);
        if (!failed) {
          failed = true;
          throw Object.assign(new Error("injected close failure"), {
            code: "EIO",
          });
        }
      },
    };
    expect(() => observeSettingsSource(file, { fs: runtimeFs })).toThrow(
      expect.objectContaining({ code: "CC_SETTINGS_SOURCE_INVALID" }),
    );
    expect(failed).toBe(true);
    expect(outstanding.size).toBe(0);
    fs.writeFileSync(file, "{}");
    expect(() => observeSettingsSource(file, { fs: runtimeFs })).not.toThrow();
  });

  it("rejects an in-place edit while the source is being inspected", () => {
    const file = write("settings.json", { permissions: { allow: ["Read"] } });
    const runtimeFs = onFirstRead(() =>
      fs.writeFileSync(
        file,
        JSON.stringify({ permissions: { deny: ["Read", "Write"] } }),
      ),
    );
    expect(() => observeSettingsSource(file, { fs: runtimeFs })).toThrow(
      expect.objectContaining({ code: "CC_SETTINGS_SOURCE_CHANGED" }),
    );
  });

  it("rejects a concurrent replacement or an OS refusal to perform it while the descriptor is open", () => {
    const file = write("settings.json", { permissions: { allow: ["Read"] } });
    const replacement = write("new.json", { permissions: { deny: ["Read"] } });
    let renameError = null;
    const runtimeFs = onFirstRead(() => {
      try {
        fs.renameSync(replacement, file);
      } catch (cause) {
        renameError = cause;
        throw cause;
      }
    });
    let observedError = null;
    try {
      observeSettingsSource(file, { fs: runtimeFs });
    } catch (cause) {
      observedError = cause;
    }
    if (renameError) {
      // Windows MoveFileEx can refuse to replace an opened target. That is a
      // failed mutation attempt, rather than a successful replacement probe.
      expect(process.platform).toBe("win32");
      expect(["EPERM", "EACCES"]).toContain(renameError.code);
      expect(observedError).toMatchObject({
        code: "CC_SETTINGS_SOURCE_UNAVAILABLE",
        cause: renameError,
      });
      expect(
        JSON.parse(fs.readFileSync(file, "utf8")).permissions.allow,
      ).toEqual(["Read"]);
    } else {
      expect(observedError).toMatchObject({
        code: "CC_SETTINGS_SOURCE_CHANGED",
      });
      expect(
        JSON.parse(fs.readFileSync(file, "utf8")).permissions.deny,
      ).toEqual(["Read"]);
    }
  });

  it("keeps logical directory aliases while checking the canonical physical parent", () => {
    const file = write("physical/settings.json", { model: "haiku" });
    const alias = path.join(root, "alias");
    fs.symlinkSync(
      path.dirname(file),
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    const aliased = path.join(alias, "settings.json");
    const sources = observeSettingsSources([file, aliased]);
    expect(sources[0].logicalPath).not.toBe(sources[1].logicalPath);
    expect(sources[0].physicalPath).toBe(sources[1].physicalPath);
    expect(sources[0].digest).toBe(sources[1].digest);
  });

  it("rejects a directory alias rebound to another target during the read", () => {
    const first = write("first/settings.json", { model: "haiku" });
    const second = write("second/settings.json", { model: "sonnet" });
    const alias = path.join(root, "alias");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(path.dirname(first), alias, linkType);
    const runtimeFs = onFirstRead(() => {
      if (process.platform === "win32") fs.rmdirSync(alias);
      else fs.unlinkSync(alias);
      fs.symlinkSync(path.dirname(second), alias, linkType);
    });
    expect(() =>
      observeSettingsSource(path.join(alias, "settings.json"), {
        fs: runtimeFs,
      }),
    ).toThrow(expect.objectContaining({ code: "CC_SETTINGS_SOURCE_CHANGED" }));
  });

  it("rejects hard links and directories as settings sources", () => {
    const file = write("settings.json", {});
    fs.linkSync(file, path.join(root, "alias.json"));
    expect(() => observeSettingsSource(file)).toThrow(
      expect.objectContaining({ code: "CC_SETTINGS_SOURCE_UNSAFE" }),
    );
    expect(() => observeSettingsSource(root)).toThrow(
      expect.objectContaining({ code: "CC_SETTINGS_SOURCE_UNSAFE" }),
    );
  });

  it.skipIf(process.platform === "win32")(
    "rejects a real final file symlink",
    () => {
      const file = write("settings.json", {});
      const alias = path.join(root, "alias.json");
      fs.symlinkSync(file, alias);
      expect(() => observeSettingsSource(alias)).toThrow(
        expect.objectContaining({ code: "CC_SETTINGS_SOURCE_UNSAFE" }),
      );
    },
  );

  it("rejects a dangling parent link rather than accepting its source as missing", () => {
    const alias = path.join(root, "alias");
    fs.symlinkSync(
      path.join(root, "gone"),
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() =>
      observeSettingsSource(path.join(alias, "settings.json")),
    ).toThrow(
      expect.objectContaining({ code: "CC_SETTINGS_SOURCE_UNAVAILABLE" }),
    );
  });

  it("only treats ENOENT as absence and preserves other filesystem failure classifications", () => {
    const cause = Object.assign(new Error("private path omitted"), {
      code: "EACCES",
    });
    const runtimeFs = {
      ...fs,
      lstatSync() {
        throw cause;
      },
    };
    expect(() =>
      observeSettingsSource(path.join(root, "settings.json"), {
        fs: runtimeFs,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CC_SETTINGS_SOURCE_UNAVAILABLE",
        cause,
      }),
    );
    const file = write("parent", "regular file");
    expect(() =>
      observeSettingsSource(path.join(file, "settings.json")),
    ).toThrow(expect.objectContaining({ code: "CC_SETTINGS_SOURCE_UNSAFE" }));
  });

  it("bounds both a declared large file and growth after opening", () => {
    const file = write("settings.json", '{"x":"123456789"}');
    expect(() => observeSettingsSource(file, { maxBytes: 8 })).toThrow(
      expect.objectContaining({ code: "CC_SETTINGS_SOURCE_TOO_LARGE" }),
    );
    fs.writeFileSync(file, "{}");
    const runtimeFs = onFirstRead(() =>
      fs.appendFileSync(file, " ".repeat(40)),
    );
    expect(() =>
      observeSettingsSource(file, { fs: runtimeFs, maxBytes: 16 }),
    ).toThrow(
      expect.objectContaining({ code: "CC_SETTINGS_SOURCE_TOO_LARGE" }),
    );
  });

  it.each([
    "",
    "{",
    "[]",
    "null",
    "42",
    "\ufeff{}",
    Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
  ])(
    "rejects invalid UTF-8, malformed JSON or a non-object top level (%#)",
    (bytes) => {
      const file = write("settings.json", bytes);
      expect(() => observeSettingsSource(file)).toThrow(
        expect.objectContaining({ code: "CC_SETTINGS_SOURCE_INVALID" }),
      );
    },
  );

  it("freezes a wide JSON object without spreading an unbounded argument list", () => {
    const file = write("settings.json", { list: Array(150000).fill(0) });
    const result = observeSettingsSource(file);
    expect(result.settings.list).toHaveLength(150000);
    expect(Object.isFrozen(result.settings.list)).toBe(true);
  });

  it("includes the complete discovered and managed inventory, including non-contributing documents", () => {
    const project = path.join(root, "project");
    const cwd = path.join(project, "nested");
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });
    fs.mkdirSync(cwd);
    const projectFile = write("project/.claude/settings.json", {
      env: { TOOL_DEFAULT: "yes" },
    });
    const explicit = write("explicit.json", {});
    const managed = path.join(root, "managed.json");
    const snapshot = loader.inspectSettingsSources({
      cwd,
      settingsFile: explicit,
      managedSettingsFile: managed,
      env: {},
    });
    expect(snapshot.sources.map((source) => source.logicalPath)).toEqual([
      path.join(root, "home", ".claude", "settings.json"),
      projectFile,
      path.join(project, ".claude", "settings.local.json"),
      path.join(cwd, ".claude", "settings.json"),
      path.join(cwd, ".claude", "settings.local.json"),
      explicit,
      managed,
    ]);
    expect(snapshot.sources.filter((source) => source.exists)).toHaveLength(2);
    expect(snapshot.sources[1].settings.env.TOOL_DEFAULT).toBe("yes");
    expect(Object.isFrozen(snapshot.sources)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("resolves all relative candidates before a reentrant cwd change in a real Node process", () => {
    write("first.json", {});
    write("second.json", { model: "haiku" });
    fs.mkdirSync(path.join(root, "elsewhere"));
    const modulePath = fileURLToPath(
      new URL("../../src/lib/settings-source-observation.cjs", import.meta.url),
    );
    const script = `
      const fs = require("node:fs");
      const { observeSettingsSources } = require(${JSON.stringify(modulePath)});
      let changed = false;
      const runtimeFs = { ...fs, readSync(...args) {
        const count = fs.readSync(...args);
        if (count && !changed) { changed = true; process.chdir(${JSON.stringify(path.join(root, "elsewhere"))}); }
        return count;
      }};
      const observations = observeSettingsSources(["first.json", "second.json"], { fs: runtimeFs });
      process.stdout.write(JSON.stringify(observations.map(source => [source.logicalPath, source.settings])));
    `;
    const child = spawnSync(process.execPath, ["-e", script], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stderr).toBe("");
    const canonicalRoot = fs.realpathSync(root);
    expect(JSON.parse(child.stdout)).toEqual([
      [path.join(canonicalRoot, "first.json"), {}],
      [path.join(canonicalRoot, "second.json"), { model: "haiku" }],
    ]);
  });

  it("bounds the inventory and validates paths before making any observations", () => {
    expect(() =>
      observeSettingsSources(
        Array(MAX_SETTINGS_SOURCES + 1).fill("missing.json"),
      ),
    ).toThrow(TypeError);
    expect(() => observeSettingsSources(["missing.json", "BAD\0PATH"])).toThrow(
      TypeError,
    );
    expect(() =>
      observeSettingsSource("settings.json", { maxBytes: 0 }),
    ).toThrow(TypeError);
  });
});
