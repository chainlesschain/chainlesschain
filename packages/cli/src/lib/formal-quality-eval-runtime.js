import os from "node:os";
import path from "node:path";

export const FORMAL_QUALITY_HERMETIC_ENV = "CC_FORMAL_QUALITY_EVAL_HERMETIC";
export const FORMAL_QUALITY_PROVIDER_ENV = "CC_FORMAL_QUALITY_EVAL_PROVIDER";
export const FORMAL_QUALITY_ALLOWED_FILES_ENV =
  "CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES";

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
