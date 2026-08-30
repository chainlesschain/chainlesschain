import { describe, it, expect, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/constants.js";
import {
  CONFIG_SCHEMA,
  CONFIG_SCHEMA_VERSION,
  coerceConfigValue,
  getConfigDescriptor,
  getConfigJsonSchema,
  isSecretConfigKey,
  migrateConfigDocument,
  registerPluginConfigSchema,
  validateConfigDocument,
} from "../../src/lib/config-schema.js";
import {
  CONFIG_CONFIGURED,
  CONFIG_REDACTED,
  redactConfigObject,
} from "../../src/lib/config-redaction.js";
import {
  _resolveWindowsAclTimeout,
  ensurePrivateDirectory,
  ensurePrivateFile,
  inspectPrivatePath,
  inspectPrivatePaths,
  repairPrivatePath,
  repairPrivatePaths,
} from "../../src/lib/secure-fs.js";
import { appendSecurityAuditEvent } from "../../src/lib/security-audit.js";
import { prepareConfigForEdit } from "../../src/commands/config.js";

describe("versioned typed config schema", () => {
  it("publishes schema metadata and secret annotations", () => {
    expect(CONFIG_SCHEMA_VERSION).toMatch(/^1\./);
    expect(CONFIG_SCHEMA.$schema).toContain("2020-12");
    expect(CONFIG_SCHEMA["x-chainlesschain-schema-version"]).toBe(
      CONFIG_SCHEMA_VERSION,
    );
    expect(getConfigDescriptor("advisor.enabled")).toMatchObject({
      type: "boolean",
      default: false,
      managedLock: true,
    });
    expect(CONFIG_SCHEMA.properties.llm.properties.apiKey["x-secret"]).toBe(
      true,
    );
    expect(CONFIG_SCHEMA.properties.llm.properties.apiKey.anyOf).toContainEqual(
      { $ref: "#/$defs/secretRef" },
    );
  });

  it("coerces according to the declared type instead of weak guessing", () => {
    expect(coerceConfigValue("setupCompleted", "true")).toBe(true);
    expect(coerceConfigValue("llm.streamStallTimeoutMs", "2500")).toBe(2500);
    expect(coerceConfigValue("llm.model", "123")).toBe("123");
    expect(coerceConfigValue("llm.fallbackModels", "backup-model")).toBe(
      "backup-model",
    );
    expect(coerceConfigValue("llm.fallbackModels", '["one","two"]')).toEqual([
      "one",
      "two",
    ]);
    expect(coerceConfigValue("hub.llm", '{"provider":"openai"}')).toEqual({
      provider: "openai",
    });
    expect(coerceConfigValue("advisor.repeatErrorThreshold", "2")).toBe(2);
    expect(coerceConfigValue("voice.allowCloud", "true")).toBe(true);
    expect(coerceConfigValue("voice.backends.whisper-local", "true")).toBe(
      true,
    );
    expect(coerceConfigValue("cli.promptSuggestions", "false")).toBe(false);
    expect(() =>
      coerceConfigValue("advisor.repeatErrorThreshold", "1"),
    ).toThrow(/>= 2/);
    expect(() => coerceConfigValue("update.autoCheck", "yes")).toThrow(
      /true or false/,
    );
  });

  it("rejects unknown and prototype-polluting keys by default", () => {
    expect(() => coerceConfigValue("unknown.value", "x")).toThrow(/Unknown/);
    expect(() => getConfigDescriptor("features.__proto__.x")).toThrow(
      /Invalid configuration key/,
    );
    expect(
      validateConfigDocument({ services: { port: 8080 } }).issues[0].code,
    ).toBe("CONFIG_KEY_UNKNOWN");
    expect(
      validateConfigDocument(
        { services: { port: 8080 } },
        { allowUnknown: true },
      ).valid,
    ).toBe(true);
  });

  it("recognizes implicit object groups and validates the shipped defaults", () => {
    expect(getConfigDescriptor("llm")).toMatchObject({
      type: "object",
      implicit: true,
    });
    expect(validateConfigDocument(DEFAULT_CONFIG)).toMatchObject({
      valid: true,
      issues: [],
    });
  });

  it("accepts only the controlled persisted reference shape for secrets", () => {
    expect(
      validateConfigDocument({
        llm: { apiKey: { __cc_secret_ref: "config/llm.apiKey" } },
      }).valid,
    ).toBe(true);
    expect(
      validateConfigDocument({
        llm: {
          apiKey: {
            __cc_secret_ref: "config/llm.apiKey",
            injected: true,
          },
        },
      }).valid,
    ).toBe(false);
  });

  it("supports explicit open extension namespaces", () => {
    expect(
      validateConfigDocument({
        features: { EXPERIMENTAL_X: { enabled: true } },
      }).valid,
    ).toBe(true);
  });

  it("lets a plugin register typed and custom-secret keys in its namespace", () => {
    registerPluginConfigSchema("schema-test-plugin", [
      { key: "enabled", type: "boolean" },
      { key: "authMaterial", type: "string", secret: true },
    ]);
    expect(
      coerceConfigValue("plugins.schema-test-plugin.enabled", "true"),
    ).toBe(true);
    expect(
      validateConfigDocument({
        plugins: {
          "schema-test-plugin": {
            enabled: true,
            authMaterial: "private",
          },
        },
      }).valid,
    ).toBe(true);
    expect(
      validateConfigDocument({
        plugins: { "schema-test-plugin": { typo: true } },
      }).issues[0].code,
    ).toBe("CONFIG_KEY_UNKNOWN");
    expect(isSecretConfigKey("plugins.schema-test-plugin.authMaterial")).toBe(
      true,
    );
  });

  it("prevents plugins from weakening reserved secret namespaces", () => {
    const key = "plugins.registryTokens.registry.example";
    expect(isSecretConfigKey(key)).toBe(true);
    expect(() =>
      registerPluginConfigSchema("registryTokens", [
        { key: "registry.example", type: "string", secret: false },
      ]),
    ).toThrow(/reserved/);
    expect(isSecretConfigKey(key)).toBe(true);
  });

  it("inherits plugin secretChildren regardless of registration order", () => {
    registerPluginConfigSchema("schema-secret-order-plugin", [
      { key: "auth.opaqueValue", type: "string", secret: false },
      { key: "auth", type: "object", secretChildren: true },
    ]);
    expect(
      isSecretConfigKey("plugins.schema-secret-order-plugin.auth.opaqueValue"),
    ).toBe(true);
  });

  it("rejects secret references at non-secret extension keys", () => {
    const result = validateConfigDocument({
      features: {
        leak: { __cc_secret_ref: "config/llm.apiKey" },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        key: "features.leak",
        code: "CONFIG_SECRET_REF_INVALID",
      }),
    );
  });

  it("keeps union-typed object branches valid in the exported JSON Schema", () => {
    const llm = getConfigJsonSchema().properties.hub.properties.llm;
    expect(llm.type).toBeUndefined();
    expect(llm.anyOf).toContainEqual({ type: "string" });
    expect(llm.anyOf).toContainEqual(
      expect.objectContaining({
        type: "object",
        additionalProperties: true,
        properties: expect.objectContaining({ provider: expect.any(Object) }),
      }),
    );
  });

  it("describes and performs the legacy fallback-model migration", () => {
    const entry = getConfigDescriptor("llm.fallbackModel");
    expect(entry.deprecated).toBe(true);
    expect(entry.migration).toBe("llm.fallbackModels");
    expect(migrateConfigDocument({ llm: { fallbackModel: "backup" } })).toEqual(
      {
        config: { llm: { fallbackModels: ["backup"] } },
        migrations: [{ from: "llm.fallbackModel", to: "llm.fallbackModels" }],
      },
    );
  });

  it("migrates legacy advisor aliases without overriding nested values", () => {
    expect(
      migrateConfigDocument({
        advisorEnabled: true,
        advisorModel: "legacy-model",
        advisor: { model: "nested-model" },
      }),
    ).toEqual({
      config: { advisor: { enabled: true, model: "nested-model" } },
      migrations: [
        { from: "advisorEnabled", to: "advisor.enabled" },
        { from: "advisorModel", to: "advisor.model" },
      ],
    });
  });

  it("leaves malformed advisor containers for validation instead of crashing", () => {
    expect(
      migrateConfigDocument({ advisor: "invalid", advisorEnabled: true }),
    ).toEqual({
      config: { advisor: "invalid", advisorEnabled: true },
      migrations: [],
    });
    expect(
      validateConfigDocument({ advisor: "invalid", advisorEnabled: true })
        .valid,
    ).toBe(false);
  });
});

describe("schema-driven config redaction", () => {
  it("covers explicit secrets and extension token/password names recursively", () => {
    const config = {
      llm: { apiKey: "provider-value", model: "safe-model" },
      cloud: { token: "cloud-value", password: "cloud-password" },
      plugins: { registryTokens: { "registry.example": "registry-value" } },
      channels: { custom: { credential: "channel-value" } },
    };
    const safe = redactConfigObject(config);
    expect(safe.llm.apiKey).toBe(CONFIG_REDACTED);
    expect(safe.cloud.token).toBe(CONFIG_REDACTED);
    expect(safe.cloud.password).toBe(CONFIG_REDACTED);
    expect(safe.plugins.registryTokens["registry.example"]).toBe(
      CONFIG_REDACTED,
    );
    expect(safe.channels.custom.credential).toBe(CONFIG_REDACTED);
    expect(JSON.stringify(safe)).not.toMatch(
      /provider-value|cloud-value|cloud-password|registry-value|channel-value/,
    );
    expect(safe.llm.model).toBe("safe-model");
  });

  it("recognizes schema secrets and common secret extensions", () => {
    for (const key of [
      "llm.apiKey",
      "enterprise.apiKey",
      "cloud.token",
      "channels.telegram.password",
      "channels.slack.botToken",
      "cloud.clientSecret",
      "remoteControl.accessToken",
      "plugins.registryTokens.example",
    ]) {
      expect(isSecretConfigKey(key), key).toBe(true);
    }
  });

  it("never prints an MCP headers helper command", () => {
    const command = "credential-helper --opaque-profile production";
    const safe = redactConfigObject({ mcp: { headersHelper: command } });
    expect(safe.mcp.headersHelper).toBe(CONFIG_CONFIGURED);
    expect(JSON.stringify(safe)).not.toContain(command);
  });

  it("redacts invalid hostile paths without invoking __proto__ setters", () => {
    const raw = JSON.parse(
      '{"__proto__":{"password":"hostile-private-value"}}',
    );
    const safe = redactConfigObject(raw);
    expect(Object.prototype.hasOwnProperty.call(safe, "__proto__")).toBe(true);
    expect(safe.__proto__.password).toBe(CONFIG_REDACTED);
    expect(isSecretConfigKey("__proto__.password")).toBe(true);
    expect({}.password).toBeUndefined();
  });
});

describe("secure configuration surfaces", () => {
  it("opens an existing malformed config without parsing or rewriting it", () => {
    const loadConfig = vi.fn(() => {
      throw new Error("malformed JSON must be left for the editor");
    });
    const saveConfig = vi.fn();
    const checkPermissions = vi.fn(() => ({
      home: { ok: true },
      config: { ok: true },
    }));
    expect(
      prepareConfigForEdit({
        configPath: "/private/config.json",
        existsSync: () => true,
        checkPermissions,
        loadConfig,
        saveConfig,
      }),
    ).toBe("/private/config.json");
    expect(checkPermissions).toHaveBeenCalledWith({
      fix: true,
      configPath: "/private/config.json",
    });
    expect(loadConfig).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("preflights an existing audit file before append can follow a symlink", () => {
    const appendFileSync = vi.fn();
    expect(() =>
      appendSecurityAuditEvent("sandbox_mode_off", {
        home: "/private",
        auditPath: "/private/audit/security-events.jsonl",
        deps: {
          ensurePrivateDirectory: vi.fn(),
          ensurePrivateFile: () => {
            throw new Error("symbolic links are not allowed");
          },
          appendFileSync,
          now: () => new Date("2026-08-01T00:00:00.000Z"),
        },
      }),
    ).toThrow(/symbolic links/);
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it("redacts audit details and verifies the file before and after append", () => {
    const ensurePrivateFile = vi.fn();
    const appendFileSync = vi.fn();
    appendSecurityAuditEvent("sandbox_mode_off", {
      home: "/private",
      auditPath: "/private/audit/security-events.jsonl",
      details: {
        token: "private-audit-value",
        mode: "off",
        event: "forged",
        version: 99,
      },
      deps: {
        ensurePrivateDirectory: vi.fn(),
        ensurePrivateFile,
        appendFileSync,
        now: () => new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    expect(ensurePrivateFile).toHaveBeenCalledTimes(2);
    const line = appendFileSync.mock.calls[0][1];
    expect(line).not.toContain("private-audit-value");
    expect(JSON.parse(line)).toMatchObject({
      event: "sandbox_mode_off",
      version: 1,
      token: CONFIG_REDACTED,
      mode: "off",
    });
  });
});

describe("owner-only filesystem helpers", () => {
  it("lets a trusted harness raise but not lower the Windows ACL timeout", () => {
    expect(
      _resolveWindowsAclTimeout(15_000, {
        CC_SECURE_FS_WINDOWS_ACL_TIMEOUT_MS: "60000",
      }),
    ).toBe(60_000);
    expect(
      _resolveWindowsAclTimeout(30_000, {
        CC_SECURE_FS_WINDOWS_ACL_TIMEOUT_MS: "1000",
      }),
    ).toBe(30_000);
    expect(
      _resolveWindowsAclTimeout(30_000, {
        CC_SECURE_FS_WINDOWS_ACL_TIMEOUT_MS: "900000",
      }),
    ).toBe(300_000);
    expect(_resolveWindowsAclTimeout(15_000, {})).toBe(15_000);
  });

  function fakeFs(initialMode, directory = false) {
    let mode = initialMode;
    return {
      existsSync: () => true,
      mkdirSync: () => {},
      chmodSync: (_path, next) => {
        mode = next;
      },
      lstatSync: () => ({
        mode,
        uid: typeof process.getuid === "function" ? process.getuid() : 0,
        isDirectory: () => directory,
        isSymbolicLink: () => false,
      }),
    };
  }

  it("detects and repairs POSIX directory modes", () => {
    const fs = fakeFs(0o755, true);
    const options = {
      platform: "linux",
      deps: { fs, platform: () => "linux" },
    };
    expect(inspectPrivatePath("/private", options).ok).toBe(false);
    repairPrivatePath("/private", options);
    expect(inspectPrivatePath("/private", options)).toMatchObject({
      ok: true,
      actualMode: 0o700,
    });
  });

  it("enforces 0700 when ensuring an existing POSIX directory", () => {
    const fs = fakeFs(0o777, true);
    ensurePrivateDirectory("/private", {
      platform: "linux",
      deps: { fs, platform: () => "linux" },
    });
    expect(
      inspectPrivatePath("/private", {
        platform: "linux",
        deps: { fs, platform: () => "linux" },
      }).actualMode,
    ).toBe(0o700);
  });

  it("does not rewrite ctime-equivalent modes for secure POSIX paths", () => {
    const directoryFs = fakeFs(0o700, true);
    const fileFs = fakeFs(0o600, false);
    directoryFs.chmodSync = vi.fn(directoryFs.chmodSync);
    fileFs.chmodSync = vi.fn(fileFs.chmodSync);

    ensurePrivateDirectory("/private", {
      platform: "linux",
      deps: { fs: directoryFs, platform: () => "linux" },
    });
    ensurePrivateFile("/private/state.json", {
      platform: "linux",
      deps: { fs: fileFs, platform: () => "linux" },
    });

    expect(directoryFs.chmodSync).not.toHaveBeenCalled();
    expect(fileFs.chmodSync).not.toHaveBeenCalled();
  });

  it("accepts only the root-owned canonical macOS /var system alias", () => {
    let mode = 0o755;
    const target = "/var/folders/cc-private";
    const fs = {
      existsSync: () => true,
      mkdirSync: () => {},
      chmodSync: (_path, next) => {
        mode = next;
      },
      realpathSync: (candidate) =>
        candidate === "/var" ? "/private/var" : candidate,
      lstatSync: (candidate) => {
        if (candidate === "/var") {
          return {
            mode: 0o120755,
            uid: 0,
            isDirectory: () => false,
            isSymbolicLink: () => true,
          };
        }
        if (candidate === "/private/var") {
          return {
            mode: 0o40755,
            uid: 0,
            isDirectory: () => true,
            isSymbolicLink: () => false,
          };
        }
        return {
          mode,
          uid: typeof process.getuid === "function" ? process.getuid() : 501,
          isDirectory: () => true,
          isSymbolicLink: () => false,
        };
      },
    };

    expect(
      ensurePrivateDirectory(target, {
        platform: "darwin",
        deps: { fs, platform: () => "darwin" },
      }),
    ).toBe(target);
    expect(mode).toBe(0o700);
  });

  it("keeps rejecting a user-owned alias even when it is named /var", () => {
    const fs = {
      lstatSync: (candidate) => ({
        mode: candidate === "/var" ? 0o120755 : 0o40755,
        uid: 501,
        isDirectory: () => candidate !== "/var",
        isSymbolicLink: () => candidate === "/var",
      }),
      realpathSync: () => "/private/var",
    };

    expect(() =>
      repairPrivatePath("/var/folders/attacker/state.json", {
        platform: "darwin",
        deps: { fs, platform: () => "darwin" },
      }),
    ).toThrow(/symbolic link or junction/i);
  });

  it("uses read-back verification for Windows owner-only ACLs", () => {
    const fs = {
      lstatSync: vi.fn(() => {
        throw Object.assign(new Error("target denied"), { code: "EPERM" });
      }),
    };
    const spawnSync = (_file, _args, options) => {
      const request = JSON.parse(options.input);
      return {
        status: 0,
        stdout: JSON.stringify(
          request.targets.map((target) => ({
            target,
            exists: true,
            isDirectory: true,
            ok: true,
            aceCount: 1,
          })),
        ),
        stderr: "",
      };
    };
    expect(
      inspectPrivatePath("C:\\private", {
        platform: "win32",
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toMatchObject({ ok: true, platform: "win32" });
    expect(fs.lstatSync).not.toHaveBeenCalled();
  });

  it("checks multiple Windows ACLs in one fixed-script process", () => {
    const targets = ["C:\\private", "C:\\private\\config.json"];
    const spawnSync = vi.fn((_file, args, options) => {
      const request = JSON.parse(options.input);
      return {
        status: 0,
        stdout: JSON.stringify(
          request.targets.map((target) => ({
            target,
            exists: true,
            ok: true,
            protected: true,
            aceCount: 1,
          })),
        ),
        stderr: "",
      };
    });

    expect(
      inspectPrivatePaths(targets, {
        platform: "win32",
        deps: { spawnSync, platform: () => "win32" },
      }),
    ).toEqual([
      expect.objectContaining({ target: targets[0], ok: true }),
      expect.objectContaining({ target: targets[1], ok: true }),
    ]);
    expect(spawnSync).toHaveBeenCalledOnce();
    const [, args, options] = spawnSync.mock.calls[0];
    expect(args.join(" ")).toMatch(/ReparsePoint/);
    expect(args.join(" ")).toMatch(/AreAccessRulesProtected/);
    expect(args.join(" ")).toContain("$identity.Owner");
    expect(args.join(" ")).toContain("$security.SetOwner($sid)");
    expect(args.join(" ")).toMatch(/\$owner\.Value -ne \$tokenOwner\.Value/);
    expect(args).not.toContain(targets[0]);
    expect(JSON.parse(options.input)).toEqual({
      operation: "inspect",
      targets,
    });
  });

  it("fails closed on an inconsistent Windows ACL batch exit", () => {
    const target = "C:\\private";
    const spawnSync = vi.fn(() => ({
      status: 4,
      stdout: JSON.stringify([{ target, exists: true, ok: true }]),
      stderr: "",
    }));
    expect(
      inspectPrivatePaths([target], {
        platform: "win32",
        deps: { spawnSync, platform: () => "win32" },
      })[0],
    ).toMatchObject({ target, ok: false });
  });

  it("chunks large Windows ACL inventories without changing order", () => {
    const targets = Array.from(
      { length: 501 },
      (_, index) => `C:\\private\\session-${index}.jsonl`,
    );
    const spawnSync = vi.fn((_file, _args, options) => {
      const request = JSON.parse(options.input);
      return {
        status: 0,
        stdout: JSON.stringify(
          request.targets.map((target) => ({
            target,
            exists: true,
            ok: true,
          })),
        ),
        stderr: "",
      };
    });
    const results = inspectPrivatePaths(targets, {
      platform: "win32",
      deps: { spawnSync, platform: () => "win32" },
    });
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(results.map((entry) => entry.target)).toEqual(targets);
    expect(JSON.parse(spawnSync.mock.calls[0][2].input).targets).toHaveLength(
      500,
    );
    expect(JSON.parse(spawnSync.mock.calls[1][2].input).targets).toEqual([
      targets[500],
    ]);
  });

  it.runIf(process.platform === "win32")(
    "preserves Unicode paths through the real Windows ACL protocol",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "cc-acl-中文-"));
      const target = join(directory, "快速打包.bat");
      writeFileSync(target, "@echo off\r\n");
      try {
        const [result] = inspectPrivatePaths([target]);
        expect(result).toMatchObject({ target, exists: true });
        expect(result.details?.target).toBe(target);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    30000,
  );

  it.runIf(process.platform === "win32")(
    "repairs and verifies a real Windows directory and file ACL",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "cc-acl-repair-"));
      const target = join(directory, "credential.json");
      writeFileSync(target, "{}\n");
      try {
        expect(repairPrivatePaths([directory, target])).toEqual([
          expect.objectContaining({ target: directory, ok: true }),
          expect.objectContaining({ target, ok: true }),
        ]);
        expect(inspectPrivatePaths([directory, target])).toEqual([
          expect.objectContaining({ target: directory, ok: true }),
          expect.objectContaining({ target, ok: true }),
        ]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    30000,
  );

  it.runIf(process.platform === "win32")(
    "rejects a real junction when JS ancestor inspection is unavailable",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "cc-acl-fallback-"));
      const outside = mkdtempSync(join(tmpdir(), "cc-acl-outside-"));
      const junction = join(directory, "linked");
      const target = join(junction, "new-state");
      symlinkSync(outside, junction, "junction");
      try {
        const deniedFs = {
          lstatSync: () => {
            throw Object.assign(new Error("ancestor denied"), {
              code: "EPERM",
            });
          },
        };
        expect(() =>
          ensurePrivateDirectory(target, {
            platform: "win32",
            applyWindowsAcl: true,
            failIfUnavailable: true,
            deps: { fs: deniedFs, platform: () => "win32" },
          }),
        ).toThrow(/Could not verify Windows path ancestors/);
        expect(existsSync(target)).toBe(false);
      } finally {
        rmSync(directory, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    },
    30000,
  );

  it.runIf(process.platform === "win32")(
    "checks the expected file kind again inside the native repair",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "cc-acl-kind-"));
      const fs = {
        lstatSync: () => ({
          isDirectory: () => false,
          isSymbolicLink: () => false,
        }),
      };
      try {
        expect(() =>
          ensurePrivateFile(directory, {
            platform: "win32",
            applyWindowsAcl: true,
            failIfUnavailable: false,
            deps: { fs, platform: () => "win32" },
          }),
        ).toThrow(/Expected a file/);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    30000,
  );

  it("repairs an existing Windows directory when ACL application is explicit", () => {
    const fs = fakeFs(0, true);
    const spawnSync = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ ownerOnly: true, aceCount: 1 }),
      stderr: "",
    }));
    ensurePrivateDirectory("C:\\private-existing", {
      platform: "win32",
      applyWindowsAcl: true,
      failIfUnavailable: true,
      deps: { fs, spawnSync, platform: () => "win32" },
    });
    expect(spawnSync).toHaveBeenCalledOnce();
  });

  it("refuses to secure storage through a symbolic link", () => {
    const fs = {
      existsSync: () => true,
      lstatSync: () => ({
        isDirectory: () => true,
        isSymbolicLink: () => true,
      }),
    };
    expect(() =>
      ensurePrivateDirectory("/linked", {
        platform: "linux",
        deps: { fs, platform: () => "linux" },
      }),
    ).toThrow(/symbolic link/);
  });

  it("preflights every ancestor before a Windows ACL batch can mutate", () => {
    const spawnSync = vi.fn();
    const fs = {
      lstatSync: (target) => ({
        isSymbolicLink: () =>
          String(target).replaceAll("/", "\\").endsWith("\\linked"),
      }),
    };
    expect(() =>
      repairPrivatePaths(["C:\\private\\linked\\config.json"], {
        platform: "win32",
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toThrow(/symbolic link or junction/i);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("uses the fixed Windows reparse preflight when Node denies ancestor lstat", () => {
    const targets = ["C:\\Users\\owner\\AppData\\Local\\state"];
    const fs = {
      lstatSync: (target) => {
        if (target === "C:\\Users\\owner") {
          throw Object.assign(new Error("ancestor denied"), { code: "EPERM" });
        }
        return { isSymbolicLink: () => false };
      },
    };
    const spawnSync = vi.fn((_file, _args, options) => {
      const request = JSON.parse(options.input);
      return {
        status: 0,
        stdout: JSON.stringify(
          request.targets.map((target) => ({
            target,
            exists: true,
            ok: true,
          })),
        ),
        stderr: "",
      };
    });

    expect(
      repairPrivatePaths(targets, {
        platform: "win32",
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toEqual([expect.objectContaining({ target: targets[0], ok: true })]);
    expect(
      spawnSync.mock.calls.map((call) => JSON.parse(call[2].input).operation),
    ).toEqual(["preflight", "repair"]);
    expect(spawnSync.mock.calls[0][1].join(" ")).toMatch(/ReparsePoint/);
  });

  it("uses exact Windows directory entries when ancestor lstat is unreliable", () => {
    const target = "C:\\Users\\owner\\AppData\\Local\\state";
    const fs = {
      lstatSync: (candidate) => {
        if (candidate === "C:\\Users\\owner") {
          throw Object.assign(new Error("ancestor missing"), {
            code: "ENOENT",
          });
        }
        return { isSymbolicLink: () => false };
      },
      readdirSync: (parent, options) => {
        expect(parent).toBe("C:\\Users");
        expect(options).toEqual({ withFileTypes: true });
        return [
          {
            name: "owner",
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
          },
        ];
      },
    };
    const spawnSync = vi.fn((_file, _args, options) => {
      const request = JSON.parse(options.input);
      return {
        status: 0,
        stdout: JSON.stringify(
          request.targets.map((candidate) => ({
            target: candidate,
            exists: true,
            ok: true,
          })),
        ),
        stderr: "",
      };
    });

    expect(
      repairPrivatePaths([target], {
        platform: "win32",
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toEqual([expect.objectContaining({ target, ok: true })]);
    expect(
      spawnSync.mock.calls.map((call) => JSON.parse(call[2].input).operation),
    ).toEqual(["repair"]);
  });

  it.each([
    [
      "case-folded",
      {
        name: "Owner",
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
      },
    ],
    [
      "unknown-type",
      {
        name: "owner",
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => false,
      },
    ],
  ])("routes a %s Windows dirent to native preflight", (_label, entry) => {
    const target = "C:\\Users\\owner\\AppData\\Local\\state";
    const fs = {
      lstatSync: (candidate) => {
        if (candidate === "C:\\Users\\owner") {
          throw Object.assign(new Error("ancestor denied"), { code: "EPERM" });
        }
        return { isSymbolicLink: () => false };
      },
      readdirSync: () => [entry],
    };
    const spawnSync = vi.fn((_file, _args, options) => ({
      status: 4,
      stdout: JSON.stringify(
        JSON.parse(options.input).targets.map((candidate) => ({
          target: candidate,
          exists: true,
          ok: false,
          error: "native proof unavailable",
        })),
      ),
      stderr: "",
    }));

    expect(() =>
      repairPrivatePaths([target], {
        platform: "win32",
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toThrow(/Could not verify Windows path ancestors/);
    expect(spawnSync).toHaveBeenCalledOnce();
  });

  it("repairs a Windows target natively after target lstat becomes unreliable", () => {
    const target = "C:\\Users\\owner\\AppData\\Local\\state.json";
    const fs = {
      lstatSync: (candidate) => {
        if (candidate === target) {
          throw Object.assign(new Error("target denied"), { code: "EPERM" });
        }
        return { isSymbolicLink: () => false };
      },
    };
    const spawnSync = vi.fn((_file, args, options) => {
      if (options.input) {
        const request = JSON.parse(options.input);
        return {
          status: 0,
          stdout: JSON.stringify(
            request.targets.map((candidate) => ({
              target: candidate,
              exists: true,
              isDirectory: false,
              ok: true,
            })),
          ),
          stderr: "",
        };
      }
      expect(args.at(-1)).toBe("repair");
      return {
        status: 0,
        stdout: JSON.stringify({
          ownerOnly: true,
          isDirectory: false,
          aceCount: 1,
        }),
        stderr: "",
      };
    });

    expect(
      repairPrivatePath(target, {
        platform: "win32",
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toMatchObject({ ok: true, platform: "win32" });
    expect(
      spawnSync.mock.calls.map((call) =>
        call[2].input ? JSON.parse(call[2].input).operation : call[1].at(-1),
      ),
    ).toEqual(["preflight", "repair"]);
  });

  it("secures an existing Windows file despite target exists/lstat false negatives", () => {
    const target = "C:\\Users\\owner\\AppData\\Local\\state.json";
    const parent = "C:\\Users\\owner\\AppData\\Local";
    const fs = {
      existsSync: vi.fn(() => false),
      lstatSync: (candidate) => {
        if (candidate === target) {
          throw Object.assign(new Error("target missing"), { code: "ENOENT" });
        }
        return { isSymbolicLink: () => false };
      },
      readdirSync: (candidate, options) => {
        expect(candidate).toBe(parent);
        expect(options).toEqual({ withFileTypes: true });
        return [
          {
            name: "state.json",
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
          },
        ];
      },
    };
    const spawnSync = vi.fn((_file, _args, options) => {
      const request = JSON.parse(options.input);
      expect(request).toEqual({
        operation: "repair",
        targets: [target],
        expectedKind: "file",
      });
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            target,
            exists: true,
            isDirectory: false,
            ok: true,
          },
        ]),
        stderr: "",
      };
    });

    expect(
      ensurePrivateFile(target, {
        platform: "win32",
        applyWindowsAcl: true,
        failIfUnavailable: true,
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toBe(target);
    expect(fs.existsSync).not.toHaveBeenCalled();
    expect(spawnSync).toHaveBeenCalledOnce();
  });

  it("fails a native file-kind race even when ACL failures are optional", () => {
    const target = "C:\\private\\state.json";
    const fs = {
      lstatSync: () => ({
        isDirectory: () => false,
        isSymbolicLink: () => false,
      }),
    };
    const spawnSync = vi.fn((_file, _args, options) => {
      expect(JSON.parse(options.input).expectedKind).toBe("file");
      return {
        status: 4,
        stdout: JSON.stringify([
          {
            target,
            exists: true,
            isDirectory: true,
            ok: false,
            error: "expected file but found directory",
            errorCode: "EXPECTED_KIND_MISMATCH",
          },
        ]),
        stderr: "",
      };
    });

    expect(() =>
      ensurePrivateFile(target, {
        platform: "win32",
        applyWindowsAcl: true,
        failIfUnavailable: false,
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toThrow(/Expected a file/);
    expect(spawnSync).toHaveBeenCalledOnce();
  });

  it("rejects a directory when Windows target lstat cannot classify it", () => {
    const target = "C:\\Users\\owner\\AppData\\Local\\state.json";
    const fs = {
      lstatSync: (candidate) => {
        if (candidate === target) {
          throw Object.assign(new Error("target denied"), { code: "EPERM" });
        }
        return { isSymbolicLink: () => false };
      },
      readdirSync: () => [
        {
          name: "state.json",
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
        },
      ],
    };
    const spawnSync = vi.fn();

    expect(() =>
      ensurePrivateFile(target, {
        platform: "win32",
        applyWindowsAcl: true,
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toThrow(/Expected a file/);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("preflights an unclassified Windows ENOENT before creating a directory", () => {
    const target = "C:\\Users\\owner\\AppData\\Local\\state";
    const missing = "C:\\Users\\owner";
    const events = [];
    const fs = {
      lstatSync: (candidate) => {
        if (candidate === missing) {
          throw Object.assign(new Error("ancestor missing"), {
            code: "ENOENT",
          });
        }
        return { isSymbolicLink: () => false };
      },
      existsSync: () => false,
      mkdirSync: () => events.push("mkdir"),
    };
    const spawnSync = vi.fn((_file, _args, options) => {
      events.push("preflight");
      const request = JSON.parse(options.input);
      return {
        status: 0,
        stdout: JSON.stringify(
          request.targets.map((candidate) => ({
            target: candidate,
            exists: false,
            ok: true,
          })),
        ),
        stderr: "",
      };
    });

    expect(
      ensurePrivateDirectory(target, {
        platform: "win32",
        applyWindowsAcl: false,
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toBe(target);
    expect(events).toEqual(["preflight", "mkdir"]);
    expect(spawnSync).toHaveBeenCalledOnce();
  });

  it("fails closed when parent directory entries cannot classify an ENOENT", () => {
    const target = "C:\\Users\\owner\\AppData\\Local\\state";
    const fs = {
      lstatSync: (candidate) => {
        if (candidate === "C:\\Users\\owner") {
          throw Object.assign(new Error("ancestor missing"), {
            code: "ENOENT",
          });
        }
        return { isSymbolicLink: () => false };
      },
      readdirSync: () => {
        throw Object.assign(new Error("parent denied"), { code: "EACCES" });
      },
    };
    const spawnSync = vi.fn((_file, _args, options) => ({
      status: 4,
      stdout: JSON.stringify(
        JSON.parse(options.input).targets.map((candidate) => ({
          target: candidate,
          exists: true,
          ok: false,
          error: "reparse point denied",
        })),
      ),
      stderr: "",
    }));

    expect(() =>
      repairPrivatePaths([target], {
        platform: "win32",
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toThrow(/Could not verify Windows path ancestors/);
    expect(spawnSync).toHaveBeenCalledOnce();
  });

  it("fails closed when the Windows ancestor fallback cannot prove safety", () => {
    const target = "C:\\Users\\owner\\AppData\\Local\\state";
    const fs = {
      lstatSync: (candidate) => {
        if (candidate === "C:\\Users\\owner") {
          throw Object.assign(new Error("ancestor denied"), { code: "EPERM" });
        }
        return { isSymbolicLink: () => false };
      },
    };
    const spawnSync = vi.fn((_file, _args, options) => ({
      status: 4,
      stdout: JSON.stringify(
        JSON.parse(options.input).targets.map((candidate) => ({
          target: candidate,
          exists: true,
          ok: false,
          error: "reparse point denied",
        })),
      ),
      stderr: "",
    }));

    expect(() =>
      repairPrivatePaths([target], {
        platform: "win32",
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toThrow(/Could not verify Windows path ancestors/);
    expect(spawnSync).toHaveBeenCalledOnce();
  });

  it("preflights a single Windows directory before ACL repair on ancestor EPERM", () => {
    const target = "C:\\Users\\owner\\AppData\\Local\\state";
    const fs = {
      existsSync: () => true,
      mkdirSync: () => {},
      lstatSync: (candidate) => {
        if (candidate === "C:\\Users\\owner") {
          throw Object.assign(new Error("ancestor denied"), { code: "EPERM" });
        }
        return {
          isDirectory: () => true,
          isSymbolicLink: () => false,
        };
      },
    };
    const spawnSync = vi.fn((_file, _args, options) => {
      if (options.input) {
        const request = JSON.parse(options.input);
        return {
          status: 0,
          stdout: JSON.stringify(
            request.targets.map((candidate) => ({
              target: candidate,
              exists: true,
              isDirectory: true,
              ok: true,
            })),
          ),
          stderr: "",
        };
      }
      return {
        status: 0,
        stdout: JSON.stringify({ ownerOnly: true, aceCount: 1 }),
        stderr: "",
      };
    });

    expect(
      ensurePrivateDirectory(target, {
        platform: "win32",
        applyWindowsAcl: true,
        failIfUnavailable: true,
        deps: { fs, spawnSync, platform: () => "win32" },
      }),
    ).toBe(target);
    expect(JSON.parse(spawnSync.mock.calls[0][2].input)).toEqual({
      operation: "preflight",
      targets: [target],
    });
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });
});
