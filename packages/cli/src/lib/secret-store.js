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

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getElectronUserDataDir } from "./paths.js";
import { executionBroker } from "./process-execution-broker/index.js";

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

function defaultRunner(file, args, input = undefined) {
  const result = executionBroker.spawnSync(file, args, {
    origin: "secret-store",
    policy: "allow",
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    windowsHide: true,
    ...(input !== undefined ? { input } : {}),
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || "secret store command failed").trim());
  }
  return String(result.stdout || "").trim();
}

function safeToken(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 32);
}

function chooseBackend(platform = process.platform) {
  if (platform === "win32") return "dpapi";
  if (platform === "darwin") return "keychain";
  if (platform === "linux" || platform === "freebsd") return "secret-service";
  return "unavailable";
}

function readJson(file, readFile = fs.readFileSync) {
  try {
    const value = JSON.parse(readFile(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

function writeJson(file, value, deps = {}) {
  const mkdirSync = deps.mkdirSync || fs.mkdirSync;
  const writeFileSync = deps.writeFileSync || fs.writeFileSync;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
}

function createDpapiBackend({ file, runner, readFile, writeFile, mkdirSync } = {}) {
  const storeFile = file || path.join(getElectronUserDataDir(), "plugin-secrets.dpapi.json");
  const load = () => readJson(storeFile, readFile);
  const save = (v) => writeJson(storeFile, v, { writeFileSync: writeFile, mkdirSync });
  return {
    name: "dpapi",
    set(key, value) {
      const payload = Buffer.from(String(value), "utf8").toString("base64");
      const encoded = runner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", DPAPI_SCRIPT], payload);
      const data = load(); data[key] = encoded; save(data);
    },
    get(key) {
      const encoded = load()[key];
      if (!encoded) return null;
      const plain = runner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", DPAPI_UNPROTECT_SCRIPT], encoded);
      return Buffer.from(plain, "base64").toString("utf8");
    },
    delete(key) {
      const data = load();
      if (!Object.prototype.hasOwnProperty.call(data, key)) return false;
      delete data[key]; save(data); return true;
    },
  };
}

function createKeychainBackend({ service, runner } = {}) {
  const name = service || "com.chainlesschain.plugin";
  return {
    name: "keychain",
    set(key, value) {
      runner("security", ["add-generic-password", "-a", key, "-s", name, "-w", String(value), "-U"]);
    },
    get(key) {
      try { return runner("security", ["find-generic-password", "-a", key, "-s", name, "-w"]) || null; } catch { return null; }
    },
    delete(key) {
      try { runner("security", ["delete-generic-password", "-a", key, "-s", name]); return true; } catch { return false; }
    },
  };
}

function createSecretServiceBackend({ service, runner } = {}) {
  const name = service || "chainlesschain-plugin";
  return {
    name: "secret-service",
    set(key, value) {
      runner("secret-tool", ["store", "--label", `${name}:${key}`, "service", name, "account", key], String(value));
    },
    get(key) {
      try { return runner("secret-tool", ["lookup", "service", name, "account", key]) || null; } catch { return null; }
    },
    delete(key) {
      try { runner("secret-tool", ["clear", "service", name, "account", key]); return true; } catch { return false; }
    },
  };
}

/** Create a fail-closed secret store. `memory` is intended for tests only. */
export function createSecretStore(options = {}) {
  const backend = options.backend || chooseBackend(options.platform);
  const runner = options.runner || defaultRunner;
  if (backend === "memory") {
    const values = options.values || new Map();
    return { name: "memory", set: (k, v) => values.set(k, String(v)), get: (k) => values.get(k) ?? null, delete: (k) => values.delete(k) };
  }
  if (backend === "dpapi") return createDpapiBackend({ ...options, runner });
  if (backend === "keychain") return createKeychainBackend({ ...options, runner });
  if (backend === "secret-service") return createSecretServiceBackend({ ...options, runner });
  throw new Error(`No OS secret store available for platform ${options.platform || process.platform}`);
}

export function secretRef(key) { return { __cc_secret_ref: String(key) }; }
export function isSecretRef(value) { return Boolean(value && typeof value === "object" && value.__cc_secret_ref); }
export { chooseBackend };
