/** Additional diagnostic coverage; never a replacement for frozen baselines. */
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { diagnosticBehaviorControl } from "./verify01-review-pack-diagnostic.mjs";
import { extraDiagnosticControl } from "./verify01-review-diagnostic-extra-controls.mjs";
import { VERIFY01_REVIEW_SPECS } from "./verify01-review-specs.mjs";

export const PRIVATE_V4_CONTROL_SOURCES = Object.freeze([
  "windows-node-private-v4-controls.mjs",
  "verify01-review-pack-diagnostic.mjs",
  "verify01-review-diagnostic-extra-controls.mjs",
]);
const supported = new Set([
  "verify-12",
  "verify-19",
  "verify-20",
  "verify-29",
  "verify-30",
]);
const digest = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");

export function privateV4BehaviorControls(taskIds) {
  if (
    !Array.isArray(taskIds) ||
    taskIds.length === 0 ||
    new Set(taskIds).size !== taskIds.length ||
    taskIds.some(
      (id) => !VERIFY01_REVIEW_SPECS.some((spec) => spec.taskId === id),
    )
  )
    throw Error("Invalid control task population");
  return VERIFY01_REVIEW_SPECS.filter(
    (spec) => taskIds.includes(spec.taskId) && supported.has(spec.taskId),
  ).map((spec) => {
    const relativePath = `packages/cli/verify01-diagnostic-controls/${spec.taskId}.test.js`;
    const modulePath = (file) => {
      const relative = path.posix.relative(
        path.posix.dirname(relativePath),
        file,
      );
      return relative.startsWith(".") ? relative : "./" + relative;
    };
    const text =
      'import { it as diagnosticIt, expect as diagnosticExpect } from "vitest";\n' +
      diagnosticBehaviorControl(spec.taskId, modulePath) +
      extraDiagnosticControl(spec.taskId, modulePath(spec.sourcePath));
    const names = [
      ...text.matchAll(/(?:diagnosticIt|controlIt)\("([^"\n]+)"/gu),
    ].map((match) => match[1]);
    if (!names.length || new Set(names).size !== names.length)
      throw Error("Diagnostic controls have no unique assertions");
    return {
      taskId: spec.taskId,
      relativePath,
      text,
      bytes: Buffer.byteLength(text),
      digest: digest(text),
      names,
    };
  });
}

/** Consume actual reporter rows, never the producer's accepted/completed flag. */
export function inspectPrivateV4ControlResults(
  stdout,
  controls,
  { mutant = false, frozenTests = [] } = {},
) {
  const errors = [];
  try {
    if (
      typeof stdout !== "string" ||
      Buffer.byteLength(stdout) > 8 * 1024 * 1024
    )
      throw Error("bounded reporter required");
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed.testResults)) throw Error("testResults missing");
    const expectedFiles = [
      ...frozenTests,
      ...controls.map((row) => row.relativePath),
    ].map((file) => "X:/workspace/tree/" + file);
    const actualFiles = parsed.testResults.map((row) =>
      typeof row?.name === "string" ? row.name.replaceAll("\\", "/") : null,
    );
    if (
      new Set(expectedFiles).size !== expectedFiles.length ||
      !isDeepStrictEqual([...actualFiles].sort(), [...expectedFiles].sort())
    )
      throw Error(
        "review reporter file population differs from frozen baseline and controls",
      );
    if (
      parsed.testResults.some(
        (row) =>
          !Array.isArray(row.assertionResults) ||
          row.assertionResults.length === 0,
      )
    )
      throw Error(
        "review reporter contains a file without executed assertions",
      );
    if (
      parsed.testResults.some((file) =>
        file.assertionResults.some(
          (row) =>
            row.status === "failed" &&
            (row.failureMessages ?? []).some(
              (message) =>
                typeof message === "string" &&
                /^(?:Error: (?:Test|Hook) timed out|TimeoutError:)/mu.test(
                  message,
                ),
            ),
        ),
      )
    )
      throw Error("review reporter includes a test or hook timeout");
    for (const control of controls) {
      const expectedPath = "X:/workspace/tree/" + control.relativePath;
      const files = parsed.testResults.filter(
        (row) => row?.name?.replaceAll("\\", "/") === expectedPath,
      );
      if (files.length !== 1)
        throw Error("control file missing or duplicated: " + control.taskId);
      const assertions = files[0].assertionResults;
      if (
        !Array.isArray(assertions) ||
        !isDeepStrictEqual(
          assertions.map((row) => row.fullName).sort(),
          [...control.names].sort(),
        )
      )
        throw Error("control assertion population differs: " + control.taskId);
      if (
        assertions.some(
          (row) =>
            !["passed", ...(mutant ? ["failed"] : [])].includes(row.status),
        )
      )
        throw Error("control skipped, failed or incomplete: " + control.taskId);
      if (
        mutant &&
        !assertions.some(
          (row) =>
            row.status === "failed" &&
            Array.isArray(row.failureMessages) &&
            row.failureMessages.some(
              (message) =>
                typeof message === "string" &&
                /^AssertionError(?:\s*\[[^\]]+\])?(?::|\b)/mu.test(message),
            ),
        )
      )
        throw Error(
          "mutant control lacks behavioral assertion rejection: " +
            control.taskId,
        );
      if (
        assertions.some(
          (row) =>
            row.status === "failed" &&
            !row.failureMessages?.some(
              (message) =>
                typeof message === "string" &&
                /^AssertionError(?:\s*\[[^\]]+\])?(?::|\b)/mu.test(message),
            ),
        )
      )
        throw Error(
          "control failure is not a behavioral assertion: " + control.taskId,
        );
    }
  } catch (error) {
    errors.push(error.message);
  }
  return { verified: errors.length === 0, errors };
}
