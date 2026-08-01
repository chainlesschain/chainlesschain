/**
 * Small OS-backed secret store used by plugin options and other user-scoped
 * credentials.  Secrets never fall back to plaintext JSON:
 *   - Windows: DPAPI (CurrentUser) encrypted blobs in the user data dir
 *   - macOS:   Keychain via `security`
 *   - Linux:   Secret Service via `secret-tool`
 *
 * The command runner is injectable so the protocol is deterministic in unit
 * tests and so callers can route it through ProcessExecutionBroker.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getElectronUserDataDir } from "./paths.js";
import { executionBroker } from "./process-execution-broker/index.js";
import { withFileLock } from "./with-file-lock.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "./secure-fs.js";

const DPAPI_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Security",
  "$raw=[Console]::In.ReadToEnd()",
  "$b=[Convert]::FromBase64String($raw)",
  "$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Write([Convert]::ToBase64String($p))",
].join("; ");

const DPAPI_UNPROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Security",
  "$raw=[Console]::In.ReadToEnd()",
  "$b=[Convert]::FromBase64String($raw)",
  "$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Write([Convert]::ToBase64String($p))",
].join("; ");

const SAFE_SECRET_IDENTIFIER = /^[A-Za-z0-9@][A-Za-z0-9._/@:+-]{0,511}$/;
const KEYCHAIN_VALUE_PREFIX = "ccv1:";

function normalizeSecretIdentifier(value, label) {
  const normalized = String(value);
  if (!SAFE_SECRET_IDENTIFIER.test(normalized)) {
    throw new Error(`Invalid ${label} for OS secret storage`);
  }
  return normalized;
}

function defaultRunner(file, args, input = undefined) {
  const result = executionBroker.spawnSync(file, args, {
    origin: "secret-store",
    policy: "allow",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
    ...(input !== undefined ? { input } : {}),
  });
  if (result.status !== 0) {
    const error = new Error(
      String(result.stderr || "secret store command failed").trim(),
    );
    error.exitCode = result.status;
    error.stderr = String(result.stderr || "").trim();
    throw error;
  }
  return String(result.stdout || "");
}

function stripCommandTerminator(value) {
  return String(value || "").replace(/\r?\n$/, "");
}

function chooseBackend(platform = process.platform) {
  if (platform === "win32") return "dpapi";
  if (platform === "darwin") return "keychain";
  if (platform === "linux" || platform === "freebsd") return "secret-service";
  return "unavailable";
}

function readJson(file, readFile = fs.readFileSync) {
  let raw;
  try {
    raw = readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return Object.create(null);
    throw new Error(`Could not read encrypted secret store: ${error.message}`, {
      cause: error,
    });
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Encrypted secret store contains invalid JSON: ${error.message}`,
      { cause: error },
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Encrypted secret store root must be an object");
  }
  const safe = Object.create(null);
  for (const [key, encrypted] of Object.entries(value)) {
    normalizeSecretIdentifier(key, "secret key");
    if (typeof encrypted !== "string" || encrypted.length === 0) {
      throw new Error(`Encrypted secret store entry is invalid: ${key}`);
    }
    safe[key] = encrypted;
  }
  return safe;
}

function writeJson(file, value, deps = {}) {
  const mkdirSync = deps.mkdirSync || fs.mkdirSync;
  const writeFileSync = deps.writeFileSync || fs.writeFileSync;
  const renameSync = deps.renameSync || fs.renameSync;
  const unlinkSync = deps.unlinkSync || fs.unlinkSync;
  const existsSync = deps.existsSync || fs.existsSync;
  const secureDirectory = deps.ensurePrivateDirectory || ensurePrivateDirectory;
  const secureFile = deps.ensurePrivateFile || ensurePrivateFile;
  const directory = path.dirname(file);
  secureDirectory(directory, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${
    deps.randomId?.() || randomUUID()
  }.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    secureFile(temporary);
    renameSync(temporary, file);
    secureFile(file);
  } catch (error) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // Preserve the original persistence error.
    }
    throw error;
  }
}

function createDpapiBackend({
  file,
  runner,
  readFile,
  writeFile,
  mkdirSync,
  renameFile,
  unlinkFile,
  existsFile,
  withLock = withFileLock,
  secureDirectory = ensurePrivateDirectory,
  secureFile = ensurePrivateFile,
  randomId,
} = {}) {
  const storeFile =
    file || path.join(getElectronUserDataDir(), "plugin-secrets.dpapi.json");
  const load = () => readJson(storeFile, readFile);
  const save = (v) =>
    writeJson(storeFile, v, {
      writeFileSync: writeFile,
      mkdirSync,
      renameSync: renameFile,
      unlinkSync: unlinkFile,
      existsSync: existsFile,
      ensurePrivateDirectory: secureDirectory,
      ensurePrivateFile: secureFile,
      randomId,
    });
  const mutate = (fn) => {
    secureDirectory(path.dirname(storeFile), {
      applyWindowsAcl: true,
      failIfUnavailable: true,
    });
    return withLock(storeFile, fn, { failIfUnavailable: true });
  };
  return {
    name: "dpapi",
    set(key, value) {
      key = normalizeSecretIdentifier(key, "secret key");
      const payload = Buffer.from(String(value), "utf8").toString("base64");
      const encoded = runner(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", DPAPI_SCRIPT],
        payload,
      ).trim();
      return mutate(() => {
        const data = load();
        data[key] = encoded;
        save(data);
      });
    },
    get(key) {
      key = normalizeSecretIdentifier(key, "secret key");
      const encoded = load()[key];
      if (!encoded) return null;
      const plain = runner(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", DPAPI_UNPROTECT_SCRIPT],
        encoded,
      ).trim();
      return Buffer.from(plain, "base64").toString("utf8");
    },
    delete(key) {
      key = normalizeSecretIdentifier(key, "secret key");
      return mutate(() => {
        const data = load();
        if (!Object.prototype.hasOwnProperty.call(data, key)) return false;
        delete data[key];
        save(data);
        return true;
      });
    },
  };
}

function createKeychainBackend({ service, runner } = {}) {
  const name = normalizeSecretIdentifier(
    service || "com.chainlesschain.plugin",
    "Keychain service",
  );
  return {
    name: "keychain",
    set(key, value) {
      const account = normalizeSecretIdentifier(key, "secret key");
      // `security add-generic-password -w <value>` exposes the value in the
      // process list. Interactive-command mode reads the command from stdin;
      // base64 keeps arbitrary secret bytes out of its token grammar as well as
      // argv. The fixed prefix distinguishes our encoding from legacy entries.
      const encoded = `${KEYCHAIN_VALUE_PREFIX}${Buffer.from(
        String(value),
        "utf8",
      ).toString("base64")}`;
      const command = `add-generic-password -a ${account} -s ${name} -U -w ${encoded}\n`;
      if (Buffer.byteLength(command, "utf8") >= 4096) {
        throw new Error(
          "Secret is too large for the macOS Keychain command protocol",
        );
      }
      runner("security", ["-i"], command);
    },
    get(key) {
      const account = normalizeSecretIdentifier(key, "secret key");
      try {
        const stored = stripCommandTerminator(
          runner("security", [
            "find-generic-password",
            "-a",
            account,
            "-s",
            name,
            "-w",
          ]),
        );
        if (!stored) return null;
        if (!stored.startsWith(KEYCHAIN_VALUE_PREFIX)) return stored;
        const payload = stored.slice(KEYCHAIN_VALUE_PREFIX.length);
        if (
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            payload,
          )
        ) {
          throw new Error("Keychain secret payload is malformed");
        }
        return Buffer.from(payload, "base64").toString("utf8");
      } catch (error) {
        if (
          error?.exitCode === 44 ||
          /could not be found|item not found|SecKeychainSearchCopyNext/i.test(
            error?.message || "",
          )
        ) {
          return null;
        }
        throw error;
      }
    },
    delete(key) {
      const account = normalizeSecretIdentifier(key, "secret key");
      try {
        runner("security", [
          "delete-generic-password",
          "-a",
          account,
          "-s",
          name,
        ]);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function createSecretServiceBackend({ service, runner } = {}) {
  const name = normalizeSecretIdentifier(
    service || "chainlesschain-plugin",
    "Secret Service name",
  );
  return {
    name: "secret-service",
    set(key, value) {
      key = normalizeSecretIdentifier(key, "secret key");
      runner(
        "secret-tool",
        ["store", "--label", `${name}:${key}`, "service", name, "account", key],
        String(value),
      );
    },
    get(key) {
      key = normalizeSecretIdentifier(key, "secret key");
      try {
        return (
          stripCommandTerminator(
            runner("secret-tool", ["lookup", "service", name, "account", key]),
          ) || null
        );
      } catch (error) {
        if (error?.exitCode === 1 && !error?.stderr) return null;
        if (/not found|no such/i.test(error?.message || "")) return null;
        throw error;
      }
    },
    delete(key) {
      key = normalizeSecretIdentifier(key, "secret key");
      try {
        runner("secret-tool", ["clear", "service", name, "account", key]);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Create a fail-closed secret store. `memory` is intended for tests only. */
export function createSecretStore(options = {}) {
  const backend = options.backend || chooseBackend(options.platform);
  const runner = options.runner || defaultRunner;
  if (backend === "memory") {
    const values = options.values || new Map();
    return {
      name: "memory",
      set: (k, v) =>
        values.set(normalizeSecretIdentifier(k, "secret key"), String(v)),
      get: (k) =>
        values.get(normalizeSecretIdentifier(k, "secret key")) ?? null,
      delete: (k) => values.delete(normalizeSecretIdentifier(k, "secret key")),
    };
  }
  if (backend === "dpapi") return createDpapiBackend({ ...options, runner });
  if (backend === "keychain")
    return createKeychainBackend({ ...options, runner });
  if (backend === "secret-service")
    return createSecretServiceBackend({ ...options, runner });
  throw new Error(
    `No OS secret store available for platform ${options.platform || process.platform}`,
  );
}

export function secretRef(key) {
  return { __cc_secret_ref: String(key) };
}
export function isSecretRef(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof value.__cc_secret_ref === "string" &&
    value.__cc_secret_ref.length > 0,
  );
}
export { chooseBackend };
