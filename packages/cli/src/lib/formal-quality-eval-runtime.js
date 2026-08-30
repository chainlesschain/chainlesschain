export const FORMAL_QUALITY_HERMETIC_ENV = "CC_FORMAL_QUALITY_EVAL_HERMETIC";
export const FORMAL_QUALITY_PROVIDER_ENV = "CC_FORMAL_QUALITY_EVAL_PROVIDER";

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
import os from "node:os";
import path from "node:path";
