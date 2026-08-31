import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FORMAL_QUALITY_HERMETIC_ENV = "CC_FORMAL_QUALITY_EVAL_HERMETIC";
export const FORMAL_QUALITY_PROVIDER_ENV = "CC_FORMAL_QUALITY_EVAL_PROVIDER";
export const FORMAL_QUALITY_ISOLATION_ROOT_ENV =
  "CC_FORMAL_QUALITY_EVAL_ISOLATION_ROOT";
export const FORMAL_QUALITY_ALLOWED_FILES_ENV =
  "CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES";
export const FORMAL_QUALITY_FILE_TOOLS = Object.freeze([
  "read_file",
  "search_files",
  "list_dir",
  "write_file",
  "edit_file",
  "edit_file_hashed",
]);

/**
 * The real-model quality harness opts into the already-supported hermetic
 * headless boundary through a launcher-only environment marker. Keep the
 * check exact so inherited or malformed values never change normal CLI runs.
 */
export function isFormalQualityHermeticRuntime(environment = process.env) {
  if (environment?.[FORMAL_QUALITY_HERMETIC_ENV] !== "1") return false;
  const configuredHome = String(environment?.CHAINLESSCHAIN_HOME || "").trim();
  if (!configuredHome) return false;
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolvedHome = path.resolve(configuredHome);
  const relation = path.relative(temporaryRoot, resolvedHome);
  return Boolean(
    relation &&
    relation !== ".." &&
    !relation.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relation),
  );
}

function formalQualityIsolationRoot(environment) {
  if (!isFormalQualityHermeticRuntime(environment)) return null;
  const configuredRoot = String(
    environment?.[FORMAL_QUALITY_ISOLATION_ROOT_ENV] || "",
  ).trim();
  if (!configuredRoot) {
    throw new Error("formal quality isolation root is missing");
  }
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolvedRoot = path.resolve(configuredRoot);
  const relation = path.relative(temporaryRoot, resolvedRoot);
  const configuredHome = path.resolve(String(environment.CHAINLESSCHAIN_HOME));
  const homeRelation = path.relative(resolvedRoot, configuredHome);
  if (
    !relation ||
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation) ||
    !homeRelation ||
    homeRelation === ".." ||
    homeRelation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(homeRelation)
  ) {
    throw new Error("formal quality isolation root is invalid");
  }
  return resolvedRoot;
}

/**
 * Give concurrent formal teammates separate ephemeral config/cache trees.
 * Sharing one Windows config root makes independent processes contend on DACL
 * repair and lets platform first-use caches leak into the benchmark cwd.
 */
export function formalQualityChildEnvironment(
  identity,
  environment = process.env,
) {
  const isolationRoot = formalQualityIsolationRoot(environment);
  if (!isolationRoot) return null;
  const normalizedIdentity = String(identity || "").trim();
  if (
    !normalizedIdentity ||
    normalizedIdentity.length > 256 ||
    normalizedIdentity.includes("\0")
  ) {
    throw new Error("formal quality child identity is invalid");
  }
  const identityDigest = createHash("sha256")
    .update(normalizedIdentity, "utf8")
    .digest("hex")
    .slice(0, 24);
  const childRoot = path.join(isolationRoot, "agent-homes", identityDigest);
  const userHome = path.join(childRoot, "user-home");
  const configHome = path.join(childRoot, "chainlesschain-home");
  const appData = path.join(userHome, "app-data");
  const localAppData = path.join(userHome, "local-app-data");
  const xdgConfigHome = path.join(userHome, "xdg-config");
  const xdgCacheHome = path.join(userHome, "xdg-cache");
  const xdgDataHome = path.join(userHome, "xdg-data");
  const dotnetHome = path.join(userHome, "dotnet-home");
  const nugetPackages = path.join(userHome, "nuget-packages");
  for (const directory of [
    childRoot,
    userHome,
    configHome,
    appData,
    localAppData,
    xdgConfigHome,
    xdgCacheHome,
    xdgDataHome,
    dotnetHome,
    nugetPackages,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const childEnvironment = {
    HOME: userHome,
    USERPROFILE: userHome,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_CACHE_HOME: xdgCacheHome,
    XDG_DATA_HOME: xdgDataHome,
    CHAINLESSCHAIN_HOME: configHome,
    DOTNET_CLI_HOME: dotnetHome,
    NUGET_PACKAGES: nugetPackages,
    POWERSHELL_TELEMETRY_OPTOUT: "1",
    POWERSHELL_UPDATECHECK: "Off",
  };
  if (/^[A-Za-z]:[\\/]/u.test(userHome)) {
    childEnvironment.HOMEDRIVE = userHome.slice(0, 2);
    childEnvironment.HOMEPATH = userHome.slice(2);
  }
  return Object.freeze(childEnvironment);
}

/** Resolve the provider that the formal harness bound before any model call. */
export function formalQualityProvider(environment = process.env) {
  if (!isFormalQualityHermeticRuntime(environment)) return null;
  const provider = String(environment?.[FORMAL_QUALITY_PROVIDER_ENV] || "")
    .trim()
    .toLowerCase();
  return provider || null;
}

function validateAllowedFiles(value) {
  const allowedFiles = Array.isArray(value) ? value : null;
  if (
    !allowedFiles ||
    allowedFiles.length === 0 ||
    allowedFiles.length > 16 ||
    allowedFiles.some(
      (file) =>
        typeof file !== "string" ||
        file.length === 0 ||
        file.includes("\\") ||
        file.includes("\0") ||
        path.posix.isAbsolute(file) ||
        path.posix.normalize(file) !== file ||
        file === "." ||
        file === ".." ||
        file.startsWith("../"),
    ) ||
    new Set(allowedFiles).size !== allowedFiles.length
  ) {
    throw new Error("formal quality allowed-files binding is invalid");
  }
  return Object.freeze([...allowedFiles]);
}

/** Resolve the exact task-local file allowlist passed to a formal child. */
export function formalQualityAllowedFiles(environment = process.env) {
  if (!isFormalQualityHermeticRuntime(environment)) return null;
  let allowedFiles;
  try {
    allowedFiles = JSON.parse(
      String(environment?.[FORMAL_QUALITY_ALLOWED_FILES_ENV] || ""),
    );
  } catch {
    throw new Error("formal quality allowed-files binding is invalid");
  }
  return validateAllowedFiles(allowedFiles);
}

/** Bind a validated plan allowlist to the child without widening normal runs. */
export function formalQualityTaskAllowedFiles(
  allowedFiles,
  environment = process.env,
) {
  if (!isFormalQualityHermeticRuntime(environment)) return null;
  return validateAllowedFiles(allowedFiles);
}
