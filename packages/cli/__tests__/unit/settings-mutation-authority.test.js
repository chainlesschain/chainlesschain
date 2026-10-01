import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import loader from "../../src/lib/settings-loader.cjs";
import {
  createPermissionRulesProvider,
  permissionRulesProviderAuthority,
} from "../../src/lib/permission-authority.js";

const run = promisify(execFile);
const {
  addRule,
  getSettingsPermissionRevision,
  subscribeSettingsPermissionRevision,
  _deps,
} = loader;
const defaults = { ..._deps };
const removers = [];
let root;
let file;
const providerFor = (cwd = root) =>
  createPermissionRulesProvider({
    cwd,
    env: {},
    baseRules: { allow: [], ask: [], deny: [] },
  });

beforeEach(() => {
  Object.assign(_deps, defaults);
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-settings-authority-"));
  _deps.homedir = () => path.join(root, "home");
  file = path.join(root, ".claude", "settings.json");
});
afterEach(() => {
  for (const remove of removers.splice(0)) remove();
  Object.assign(_deps, defaults);
  fs.rmSync(root, { recursive: true, force: true });
});
function seed(data, target = file) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    typeof data === "string" ? data : JSON.stringify(data),
  );
}
function listen(fn) {
  const remove = subscribeSettingsPermissionRevision(fn);
  removers.push(remove);
  return remove;
}

describe("official settings mutations on real files", () => {
  it.each(["project", "local", "user"])(
    "preserves unrelated fields and writes %s synchronously",
    (scope) => {
      const target = loader.scopeFile(root, scope);
      seed(
        {
          model: "kept",
          permissions: { allow: ["Read"] },
          custom: { retained: true },
        },
        target,
      );
      const before = getSettingsPermissionRevision();
      let atNotification;
      listen((revision) => {
        atNotification = revision;
      });
      const result = addRule({ cwd: root, kind: "deny", rule: "Bash", scope });
      expect(result).toEqual({ file: target, added: true });
      expect(result.then).toBeUndefined();
      expect(atNotification).toMatchObject({
        state: "mutating",
        revision: before.revision + 1,
      });
      expect(getSettingsPermissionRevision()).toMatchObject({
        state: "ready",
        revision: before.revision + 1,
      });
      expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({
        model: "kept",
        permissions: { allow: ["Read"], deny: ["Bash"] },
        custom: { retained: true },
      });
      expect(fs.existsSync(`${target}.lock`)).toBe(false);
      expect(fs.readdirSync(path.dirname(target))).toEqual([
        path.basename(target),
      ]);
    },
  );

  it("duplicate rules leave exact bytes, revision and subscribers unchanged", () => {
    seed('{"permissions":{"allow":["Read"]}}');
    const before = getSettingsPermissionRevision();
    const observer = vi.fn();
    listen(observer);
    expect(addRule({ cwd: root, kind: "allow", rule: "Read" }).added).toBe(
      false,
    );
    expect(getSettingsPermissionRevision()).toBe(before);
    expect(observer).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, "utf8")).toBe(
      '{"permissions":{"allow":["Read"]}}',
    );
  });

  it("binds relative targets before a synchronous observer changes process.cwd", () => {
    const provider = providerFor();
    const entryCwd = process.cwd();
    const elsewhere = path.join(root, "elsewhere");
    fs.mkdirSync(elsewhere);
    listen(() => {
      process.chdir(elsewhere);
    });
    try {
      const result = addRule({
        cwd: path.relative(entryCwd, root),
        kind: "deny",
        rule: "Bash",
      });
      // macOS exposes its temp tree through /var -> /private/var; chdir()
      // reports the physical path. Keep the separate logical writer-target
      // assertion below so alias normalization cannot hide target drift.
      expect(process.cwd()).toBe(fs.realpathSync(elsewhere));
      expect(result.file).toBe(file);
      expect(
        JSON.parse(fs.readFileSync(file, "utf8")).permissions.deny,
      ).toEqual(["Bash"]);
      expect(fs.readdirSync(elsewhere)).toEqual([]);
      expect(fs.existsSync(`${file}.lock`)).toBe(false);
      expect(provider().settingsRevision).toBe(getSettingsPermissionRevision());
    } finally {
      process.chdir(entryCwd);
    }
  });

  it("refuses a final settings file symlink without replacing it or its target (real Node)", () => {
    // File symlink creation needs extra Windows privileges; Node's fs seam
    // supplies just the lstat observation there, while Linux uses a real link.
    const target = path.join(root, "target.json");
    seed({ permissions: { allow: ["Read"] } }, target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (process.platform === "win32") {
      _deps.fs = {
        ...fs,
        lstatSync: (name, opts) =>
          name === file
            ? { isSymbolicLink: () => true }
            : fs.lstatSync(name, opts),
      };
    } else fs.symlinkSync(target, file);
    const before = getSettingsPermissionRevision();
    expect(() => addRule({ cwd: root, kind: "deny", rule: "Bash" })).toThrow(
      /symbolic link/,
    );
    expect(getSettingsPermissionRevision()).toBe(before);
    expect(
      JSON.parse(fs.readFileSync(target, "utf8")).permissions.deny,
    ).toBeUndefined();
    if (process.platform !== "win32")
      expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
  });

  it.each([
    "{ bad json",
    "null",
    "[]",
    "3",
    { permissions: null },
    { permissions: [] },
    { permissions: "broken" },
    { permissions: { deny: "Bash" } },
    { permissions: { allow: [3] } },
  ])("refuses to replace corrupt settings %j", (data) => {
    seed(data);
    const before = getSettingsPermissionRevision();
    const bytes = fs.readFileSync(file, "utf8");
    expect(() => addRule({ cwd: root, kind: "allow", rule: "Read" })).toThrow(
      /corrupt|malformed/,
    );
    expect(fs.readFileSync(file, "utf8")).toBe(bytes);
    expect(getSettingsPermissionRevision()).toBe(before);
  });

  it.each([
    { kind: "maybe", rule: "Read" },
    { kind: "allow", rule: "" },
    { kind: "allow", rule: 2 },
    { kind: "allow", rule: "Read", scope: "other" },
  ])("rejects invalid mutation inputs %j before file effects", (input) => {
    const before = getSettingsPermissionRevision();
    expect(() => addRule({ cwd: root, ...input })).toThrow();
    expect(getSettingsPermissionRevision()).toBe(before);
    expect(fs.existsSync(path.dirname(file))).toBe(false);
  });

  it("isolates observer exceptions and rejects reader/writer reentry before acquiring a lock", () => {
    const provider = providerFor();
    listen(() => {
      throw new Error("observer failed");
    });
    const reentryErrors = [];
    listen(() => {
      for (const attempt of [
        provider,
        () => addRule({ cwd: root, kind: "allow", rule: "Read" }),
      ]) {
        try {
          attempt();
          reentryErrors.push(null);
        } catch (error) {
          reentryErrors.push(error);
        }
      }
    });
    const last = vi.fn();
    const remove = listen(last);
    addRule({ cwd: root, kind: "deny", rule: "Bash" });
    expect(last).toHaveBeenCalledOnce();
    expect(reentryErrors).toHaveLength(2);
    expect(
      reentryErrors.every(
        (error) =>
          error?.code === "CC_SETTINGS_PERMISSION_AUTHORITY_UNAVAILABLE",
      ),
    ).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(file, "utf8")).permissions.allow,
    ).toBeUndefined();
    remove();
    addRule({ cwd: root, kind: "deny", rule: "Write" });
    expect(last).toHaveBeenCalledOnce();
  });

  it("fails closed on an unavailable strict lock without changing revision or files", () => {
    seed({ permissions: { allow: ["Read"] } });
    fs.mkdirSync(`${file}.lock`);
    fs.writeFileSync(
      path.join(`${file}.lock`, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
        token: "live-settings-test-owner-0001",
      }),
    );
    const originalLock = _deps.withFileLock;
    _deps.withFileLock = (target, body, opts) =>
      originalLock(target, body, { ...opts, timeoutMs: 20 });
    const before = getSettingsPermissionRevision();
    expect(() => addRule({ cwd: root, kind: "deny", rule: "Bash" })).toThrow(
      /acquire state lock/,
    );
    expect(getSettingsPermissionRevision()).toBe(before);
    expect(
      JSON.parse(fs.readFileSync(file, "utf8")).permissions.deny,
    ).toBeUndefined();
  });

  it("known uncommitted writes still revoke old authority and retain the original file", () => {
    seed({ permissions: { allow: ["Read"] } });
    const before = getSettingsPermissionRevision();
    const observer = vi.fn();
    listen(observer);
    _deps.writeSecurityStore = () => {
      throw Object.assign(new Error("before rename"), {
        commitState: "not-committed",
      });
    };
    expect(() => addRule({ cwd: root, kind: "deny", rule: "Bash" })).toThrow(
      /before rename/,
    );
    expect(getSettingsPermissionRevision()).toMatchObject({
      state: "ready",
      revision: before.revision + 1,
    });
    expect(observer).toHaveBeenCalledOnce();
    expect(
      JSON.parse(fs.readFileSync(file, "utf8")).permissions.deny,
    ).toBeUndefined();
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it("reports a committed lock cleanup error after synchronously revoking and retaining the write", () => {
    const realLock = _deps.withFileLock;
    const before = getSettingsPermissionRevision();
    const observer = vi.fn();
    listen(observer);
    _deps.withFileLock = (target, body, opts) => {
      realLock(target, body, opts);
      throw new Error("lock cleanup failed");
    };
    let error;
    try {
      addRule({ cwd: root, kind: "deny", rule: "Bash" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ commitState: "committed" });
    expect(observer).toHaveBeenCalledOnce();
    expect(getSettingsPermissionRevision()).toMatchObject({
      state: "ready",
      revision: before.revision + 1,
    });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).permissions.deny).toEqual([
      "Bash",
    ]);
  });

  it("keeps uncertain commits unavailable even after external restoration (isolated process)", () => {
    const module = fileURLToPath(
      new URL("../../src/lib/settings-loader.cjs", import.meta.url),
    );
    const code = `const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const loader=require(process.argv[1]), root=process.argv[2];
const realWrite=loader._deps.writeSecurityStore;
let notified=false;loader.subscribeSettingsPermissionRevision(()=>{notified=true});
loader._deps.writeSecurityStore=(...args)=>{realWrite(...args);throw Object.assign(new Error('directory fsync unavailable'),{commitState:'unknown'})};
assert.throws(()=>loader.addRule({cwd:root,kind:'deny',rule:'Bash'}),/fsync/);
assert.equal(notified,true);fs.writeFileSync(path.join(root,'.claude','settings.json'),'{}');
assert.throws(()=>loader.getSettingsPermissionRevision(),/unavailable/);
assert.throws(()=>loader.addRule({cwd:root,kind:'allow',rule:'Bash'}),/unavailable/);`;
    expect(() =>
      execFileSync(process.execPath, ["-e", code, module, root], {
        timeout: 10_000,
        windowsHide: true,
      }),
    ).not.toThrow();
  });

  it("preserves every concurrent process update using the existing strict lock", async () => {
    seed({ retained: "yes" });
    const fixture = fileURLToPath(
      new URL("../fixtures/settings-rule-writer.cjs", import.meta.url),
    );
    await Promise.all(
      [0, 1, 2, 3].map((index) =>
        run(process.execPath, [fixture, root, `writer${index}`], {
          timeout: 20_000,
          windowsHide: true,
        }),
      ),
    );
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(data.retained).toBe("yes");
    expect(data.permissions.deny.sort()).toEqual(
      [0, 1, 2, 3]
        .flatMap((index) =>
          Array.from({ length: 6 }, (_, n) => `writer${index}-${n}`),
        )
        .sort(),
    );
  }, 30_000);
});

describe("settings permission providers", () => {
  it("keeps real Node read-only discovery and provider loading free of write bridge diagnostics", () => {
    const fixture = fileURLToPath(
      new URL("../fixtures/settings-read-smoke.cjs", import.meta.url),
    );
    const result = spawnSync(process.execPath, [fixture], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("revokes absent and unrelated project sources and directory aliases through one owner", () => {
    const provider = providerFor();
    const authority = permissionRulesProviderAuthority(provider);
    const before = authority.getSnapshot();
    const observed = vi.fn();
    removers.push(authority.subscribePolicyRevision(observed));
    const other = path.join(root, "other");
    fs.mkdirSync(other);
    addRule({ cwd: other, kind: "deny", rule: "Bash" });
    expect(observed).toHaveBeenCalledOnce();
    const alias = path.join(root, "alias");
    fs.symlinkSync(
      other,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    addRule({
      cwd: path.relative(process.cwd(), alias),
      kind: "deny",
      rule: "Write",
    });
    if (process.platform === "win32") {
      addRule({ cwd: alias.toUpperCase(), kind: "deny", rule: "Read" });
    }
    expect(authority.getSnapshot().revision).toBe(
      before.revision + (process.platform === "win32" ? 3 : 2),
    );
    expect(observed).toHaveBeenCalledTimes(
      process.platform === "win32" ? 3 : 2,
    );
    expect(fs.existsSync(file)).toBe(false);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(other, ".claude", "settings.json"), "utf8"),
      ).permissions.deny,
    ).toContain("Write");
  });

  it("captures source options and immutable rule inputs without replacing live scoped owners", () => {
    const rules = { allow: ["Read"], ask: [], deny: [] };
    const options = { cwd: root, env: {}, baseRules: rules };
    const provider = createPermissionRulesProvider(options);
    options.cwd = path.join(root, "changed");
    rules.allow.push("Bash");
    expect(provider().rules.allow).toEqual(["Read"]);
    expect(Object.isFrozen(provider)).toBe(true);
    expect(Object.isFrozen(provider().rules.allow)).toBe(true);
    const forged = Object.assign(() => ({}), {
      subscribePolicyRevision: vi.fn(),
    });
    expect(permissionRulesProviderAuthority(forged)).toBeNull();
  });

  it("rejects a settings write during its synchronous load instead of attaching new revision to stale rules", () => {
    seed({});
    const provider = providerFor();
    const originalRead = _deps.fs;
    let fired = false;
    _deps.fs = {
      ...fs,
      readFileSync(target, ...args) {
        const contents = fs.readFileSync(target, ...args);
        if (target === file && !fired) {
          fired = true;
          addRule({ cwd: root, kind: "deny", rule: "Bash" });
        }
        return contents;
      },
    };
    expect(() => provider()).toThrow(/settings changed/);
    _deps.fs = originalRead;
    expect(provider().settingsRevision).toBe(getSettingsPermissionRevision());
  });

  it("uses the same owner under real Node CJS and ESM loading with synchronous return", () => {
    const fixture = fileURLToPath(
      new URL("../fixtures/settings-write-smoke.cjs", import.meta.url),
    );
    expect(
      execFileSync(process.execPath, [fixture], {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      }),
    ).toMatch(/settings-write-smoke passed/);
  });
});
