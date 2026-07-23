/**
 * Safe IDE wrapper for `cc doctor --export-bundle <path>`.
 *
 * The CLI owns collection, redaction and the fail-closed secret scan. The IDE
 * owns only the save dialog and final placement. Export through a private
 * temporary file, validate the schema, then copy to the user-approved target:
 * a failed/old CLI can never truncate an existing support bundle.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DIAGNOSTIC_BUNDLE_SCHEMA = "cc-diagnostic-bundle/v1";

function buildDiagnosticExportArgs(outPath) {
  const target = String(outPath || "").trim();
  if (!target) throw new Error("Diagnostic bundle target path is required");
  return ["doctor", "--export-bundle", target];
}

function validateDiagnosticBundleText(text) {
  let bundle;
  try {
    bundle = JSON.parse(String(text || ""));
  } catch {
    return { ok: false, reason: "CLI output is not valid JSON" };
  }
  if (
    !bundle ||
    typeof bundle !== "object" ||
    Array.isArray(bundle) ||
    bundle.schema !== DIAGNOSTIC_BUNDLE_SCHEMA
  ) {
    return {
      ok: false,
      reason: `CLI output is not ${DIAGNOSTIC_BUNDLE_SCHEMA}`,
    };
  }
  if (!Array.isArray(bundle.meta?.excluded)) {
    return {
      ok: false,
      reason: "Diagnostic bundle is missing its privacy exclusions",
    };
  }
  return { ok: true, bundle };
}

function temporaryDiagnosticPath(targetPath, nonce = crypto.randomUUID()) {
  const target = path.resolve(String(targetPath || ""));
  const safeNonce =
    String(nonce || "")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 64) || "bundle";
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.cc-export-${process.pid}-${safeNonce}.tmp`,
  );
}

function assertSafeTarget(fsImpl, targetPath) {
  const parent = path.dirname(targetPath);
  if (!fsImpl.existsSync(parent) || !fsImpl.statSync(parent).isDirectory()) {
    throw new Error(`Diagnostic bundle directory not found: ${parent}`);
  }
  if (fsImpl.existsSync(targetPath)) {
    const target = fsImpl.lstatSync(targetPath);
    if (!target.isFile() || target.isSymbolicLink()) {
      throw new Error(
        `Diagnostic bundle target must be a regular file: ${targetPath}`,
      );
    }
  }
}

/**
 * Run the CLI exporter into a private temporary file, validate it, and only
 * then replace the user-approved regular-file target.
 */
async function exportDiagnosticBundleToPath({
  command = "cc",
  cwd,
  targetPath,
  runCliText,
  timeoutMs = 60000,
  fsImpl = fs,
  nonce,
} = {}) {
  if (typeof runCliText !== "function") {
    throw new Error("runCliText dependency is required");
  }
  const target = path.resolve(String(targetPath || ""));
  if (!String(targetPath || "").trim()) {
    return { ok: false, reason: "Diagnostic bundle target path is required" };
  }
  let tempPath;
  let tempFd = null;
  try {
    assertSafeTarget(fsImpl, target);
    tempPath = temporaryDiagnosticPath(target, nonce);
    tempFd = fsImpl.openSync(tempPath, "wx", 0o600);
    fsImpl.closeSync(tempFd);
    tempFd = null;

    await runCliText({
      command,
      args: buildDiagnosticExportArgs(tempPath),
      cwd,
      timeoutMs,
    });
    if (!fsImpl.existsSync(tempPath)) {
      return { ok: false, reason: "CLI did not create a diagnostic bundle" };
    }
    const checked = validateDiagnosticBundleText(
      fsImpl.readFileSync(tempPath, "utf8"),
    );
    if (!checked.ok) return checked;

    fsImpl.copyFileSync(tempPath, target);
    return {
      ok: true,
      path: target,
      schema: checked.bundle.schema,
    };
  } catch (error) {
    return {
      ok: false,
      reason: String(error?.message || error).slice(0, 240),
    };
  } finally {
    if (tempFd != null) {
      try {
        fsImpl.closeSync(tempFd);
      } catch {
        /* best-effort */
      }
    }
    if (tempPath && fsImpl.existsSync(tempPath)) {
      try {
        fsImpl.unlinkSync(tempPath);
      } catch {
        /* best-effort: the validated target was already copied, if successful */
      }
    }
  }
}

module.exports = {
  DIAGNOSTIC_BUNDLE_SCHEMA,
  buildDiagnosticExportArgs,
  validateDiagnosticBundleText,
  temporaryDiagnosticPath,
  exportDiagnosticBundleToPath,
};
