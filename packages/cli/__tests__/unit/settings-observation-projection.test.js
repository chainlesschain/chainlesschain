import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import loader from "../../src/lib/settings-loader.cjs";
import {
  createPermissionRulesProvider,
  loadPermissionAuthority,
} from "../../src/lib/permission-authority.js";
import { ScopedPermissionStore } from "../../src/lib/scoped-permission-store.js";

const defaults = { ...loader._deps };
let root;
let cwd;
let file;
let options;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-settings-project-"));
  cwd = path.join(root, "workspace");
  fs.mkdirSync(cwd);
  loader._deps.homedir = () => path.join(root, "home");
  file = path.join(cwd, ".claude", "settings.json");
  options = {
    cwd,
    env: {},
    managedSettingsFile: path.join(root, "managed.json"),
    scopedStore: new ScopedPermissionStore({
      cwd,
      filePath: path.join(root, "scoped.json"),
    }),
  };
});
afterEach(() => {
  Object.assign(loader._deps, defaults);
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function write(target, data) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    typeof data === "string" ? data : JSON.stringify(data),
  );
}

describe("permission projection from strictly observed bytes", () => {
  it("rejects copied, fabricated and proxy observations without invoking getters or traps", () => {
    const observed = loader.inspectSettingsSources(options);
    let accesses = 0;
    const forged = Object.defineProperty({}, "sources", {
      get() {
        accesses++;
        throw new Error("getter invoked");
      },
    });
    const proxy = new Proxy(observed, {
      get() {
        accesses++;
        throw new Error("proxy invoked");
      },
      getOwnPropertyDescriptor() {
        accesses++;
        throw new Error("proxy descriptor invoked");
      },
    });
    for (const candidate of [forged, proxy, { ...observed }, null]) {
      expect(() => loader.projectSettingsObservation(candidate)).toThrow(
        /strict settings source observation/,
      );
    }
    expect(accesses).toBe(0);
  });

  it.each(["replace", "delete"])(
    "projects the original bytes after %s without filesystem reads or discovery",
    (operation) => {
      const bytes = '{"permissions":{"deny":["Bash"]},"custom":{"x":[1]}}\n';
      write(file, bytes);
      const observed = loader.inspectSettingsSources(options);
      const source = observed.sources.find((item) => item.logicalPath === file);
      expect(source.digest).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      expect(() => source.settings.permissions.deny.push("Write")).toThrow();
      expect(() => source.settings.custom.x.push(2)).toThrow();
      expect(() => observed.sources.pop()).toThrow();
      if (operation === "replace") {
        write(`${file}.replacement`, { permissions: { allow: ["Bash"] } });
        fs.renameSync(`${file}.replacement`, file);
      } else fs.unlinkSync(file);
      loader._deps.fs = new Proxy(
        {},
        {
          get() {
            throw new Error("projection attempted filesystem access");
          },
        },
      );
      loader._deps.homedir = () => {
        throw new Error("projection rediscovered home");
      };
      const result = loader.projectSettingsObservation(observed);
      expect(result.rules).toEqual({ allow: [], ask: [], deny: ["Bash"] });
      expect(result.sources["deny:Bash"]).toBe(file);
      loader._deps.fs = defaults.fs;
      loader._deps.homedir = () => path.join(root, "home");
      const fresh = loader.projectSettingsObservation(
        loader.inspectSettingsSources(options),
      );
      expect(fresh.rules.deny).toEqual([]);
      expect(fresh.rules.allow).toEqual(
        operation === "replace" ? ["Bash"] : [],
      );
    },
  );

  it.each([false, true])(
    "preserves explicit and managed roles at the same path (managed-only=%s)",
    (managedOnly) => {
      write(file, { permissions: { allow: ["Read"], deny: ["Bash"] } });
      write(options.managedSettingsFile, {
        permissions: { allow: ["Write"], ask: ["Edit"] },
        allowManagedPermissionRulesOnly: managedOnly,
      });
      options.settingsFile = options.managedSettingsFile;
      options.env.CC_PERMISSIONS_DENY = "Delete";
      const legacy = loader.loadSettings(options);
      const observed = loader.inspectSettingsSources(options);
      expect(
        observed.sources.slice(-2).map((source) => source.logicalPath),
      ).toEqual([options.managedSettingsFile, options.managedSettingsFile]);
      const projected = loader.projectSettingsObservation(observed, {
        env: options.env,
      });
      expect(projected).toEqual(legacy);
      expect(
        projected.files.filter(
          (entry) => entry === options.managedSettingsFile,
        ),
      ).toHaveLength(2);
      // Preserve the existing first-source provenance even with managed-only.
      expect(projected.sources["allow:Write"]).toBe(
        options.managedSettingsFile,
      );
      expect(projected.rules.deny).toEqual(
        managedOnly ? [] : ["Bash", "Delete"],
      );
      expect(projected.rules.allow).toEqual(
        managedOnly ? ["Write"] : ["Read", "Write"],
      );
    },
  );

  it("matches legacy layer ordering, deduplication, env and managed provenance", () => {
    write(path.join(root, "home", ".claude", "settings.json"), {
      permissions: { deny: ["Bash"], allow: ["Read"] },
    });
    write(file, { permissions: { allow: ["Read", "Write"] } });
    write(path.join(cwd, ".claude", "settings.local.json"), {
      permissions: { ask: ["Edit"] },
    });
    options.settingsFile = path.join(root, "explicit.json");
    write(options.settingsFile, { permissions: { deny: ["Delete"] } });
    write(options.managedSettingsFile, { permissions: { deny: ["Network"] } });
    options.env.CC_PERMISSIONS_ASK = "Read, Write";
    const projected = loader.projectSettingsObservation(
      loader.inspectSettingsSources(options),
      { env: options.env },
    );
    expect(projected).toEqual(loader.loadSettings(options));
    expect(projected.sources["deny:Network"]).toBe("<managed>");
    expect(projected.sources["ask:Write"]).toBe("<env>");
  });

  it("provider keeps the observed managed bytes when the file changes during env sampling", () => {
    write(options.managedSettingsFile, { permissions: { deny: ["Bash"] } });
    let replaced = false;
    Object.defineProperty(options.env, "CC_PERMISSIONS_ALLOW", {
      get() {
        if (!replaced) {
          replaced = true;
          write(`${options.managedSettingsFile}.new`, {
            permissions: { allow: ["Bash"] },
          });
          fs.renameSync(
            `${options.managedSettingsFile}.new`,
            options.managedSettingsFile,
          );
        }
        return "Read";
      },
    });
    const result = loadPermissionAuthority(options);
    expect(replaced).toBe(true);
    expect(result.rules).toEqual({ allow: ["Read"], ask: [], deny: ["Bash"] });
    expect(result.managed).toBe(
      result.settingsObservation.sources.at(-1).settings,
    );
    expect(
      Object.isFrozen(
        result.settingsObservation.sources.at(-1).settings.permissions.deny,
      ),
    ).toBe(true);
    expect(() => result.rules.deny.push("Write")).toThrow();
    expect(loadPermissionAuthority(options).rules).toEqual({
      allow: ["Read", "Bash"],
      ask: [],
      deny: [],
    });
  });

  it("strict provider rejects malformed non-permission JSON while legacy loading still warns and skips", () => {
    write(file, '{"custom":');
    const onWarn = vi.fn();
    expect(loader.loadSettings({ ...options, onWarn }).rules).toEqual({
      allow: [],
      ask: [],
      deny: [],
    });
    expect(onWarn).toHaveBeenCalledOnce();
    expect(() => createPermissionRulesProvider(options)()).toThrow(
      expect.objectContaining({ code: "CC_SETTINGS_SOURCE_INVALID" }),
    );
  });

  it("strict provider rejects an unreadable nonmanaged source instead of using legacy skip semantics", () => {
    write(file, { custom: true });
    const physicalFile = fs.realpathSync(file);
    const denied = () => {
      throw Object.assign(new Error("access denied"), { code: "EACCES" });
    };
    loader._deps.fs = {
      ...fs,
      openSync(target, ...args) {
        return target === file || target === physicalFile
          ? denied()
          : fs.openSync(target, ...args);
      },
      readFileSync(target, ...args) {
        return target === file ? denied() : fs.readFileSync(target, ...args);
      },
    };
    expect(loader.loadSettings(options).rules.allow).toEqual([]);
    expect(() => loadPermissionAuthority(options)).toThrow(
      expect.objectContaining({ code: "CC_SETTINGS_SOURCE_UNAVAILABLE" }),
    );
  });

  it("strict provider refuses a real hard-linked nonmanaged source", () => {
    write(file, { custom: true });
    fs.linkSync(file, path.join(root, "alias.json"));
    expect(loader.loadSettings(options).rules.allow).toEqual([]);
    expect(() => loadPermissionAuthority(options)).toThrow(
      expect.objectContaining({ code: "CC_SETTINGS_SOURCE_UNSAFE" }),
    );
  });

  it("retains live env sampling and explicit baseRules replacement under managed policy", () => {
    write(file, { permissions: { allow: ["Write"] } });
    write(options.managedSettingsFile, { permissions: { deny: ["Bash"] } });
    options.env.CC_PERMISSIONS_ALLOW = "Read";
    const provider = createPermissionRulesProvider(options);
    expect(provider().rules.allow).toEqual(["Write", "Read"]);
    options.env.CC_PERMISSIONS_ALLOW = "Edit";
    expect(provider().rules.allow).toEqual(["Write", "Edit"]);
    options.baseRules = { allow: ["Network"], ask: [], deny: [] };
    const explicit = createPermissionRulesProvider(options);
    expect(explicit().rules).toEqual({
      allow: ["Network"],
      ask: [],
      deny: ["Bash"],
    });
    expect(explicit().scoped).toBeNull();
    write(options.managedSettingsFile, {
      allowManagedPermissionRulesOnly: true,
      permissions: { allow: ["Read"] },
    });
    expect(explicit().rules).toEqual({ allow: ["Read"], ask: [], deny: [] });
  });

  it.each([false, true])(
    "loads and deeply freezes 12,000 levels of unrelated JSON (baseRules=%s)",
    (explicit) => {
      write(
        file,
        `{"permissions":{"deny":["Bash"]},"custom":${"[".repeat(12000)}0${"]".repeat(12000)}}`,
      );
      if (explicit) options.baseRules = { allow: ["Read"], ask: [], deny: [] };
      const result = loadPermissionAuthority(options);
      expect(result.rules.deny).toEqual(explicit ? [] : ["Bash"]);
      let nested = result.settingsObservation.sources.find(
        (source) => source.logicalPath === file,
      ).settings.custom;
      for (let depth = 0; depth < 12000; depth++) {
        if (!Object.isFrozen(nested))
          throw new Error(`unfrozen depth ${depth}`);
        nested = nested[0];
      }
      expect(nested).toBe(0);
    },
  );
});
