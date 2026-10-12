import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  launchLogged,
  requireSuccess,
} from "./verify01-diagnostic-process.mjs";

export function isDistributionNetworkFailure(log, distributionUrl) {
  const lines = log.split(/\r?\n/u);
  return (
    lines.includes(`Downloading ${distributionUrl}`) &&
    /java\.net\.(?:SocketException|SocketTimeoutException|ConnectException):[^\r\n]*(?:aborted|reset|timed out|Broken pipe|Connection refused)/iu.test(
      log,
    ) &&
    !/PKIX|certificate|checksum|verification failed/iu.test(log)
  );
}

/** Only bootstrap the unchanged project wrapper. Never retry build or IDE tasks. */
export async function prepareGradle({
  projectDir,
  artifactDir,
  launch = launchLogged,
  attemptTimeoutMs = 90000,
  retryDelayMs = 3000,
}) {
  assert(Number.isSafeInteger(attemptTimeoutMs) && attemptTimeoutMs > 0);
  assert(Number.isSafeInteger(retryDelayMs) && retryDelayMs >= 0);
  const properties = fs.readFileSync(
    path.join(projectDir, "gradle/wrapper/gradle-wrapper.properties"),
    "utf8",
  );
  const distributionUrl = properties
    .match(/^distributionUrl=(.+)$/mu)?.[1]
    .trim()
    .replaceAll("\\:", ":");
  const match = distributionUrl?.match(
    /^https:\/\/services\.gradle\.org\/distributions\/gradle-(\d+\.\d+(?:\.\d+)?)-bin\.zip$/u,
  );
  assert(match, "Expected the project's pinned official Gradle distribution");
  fs.mkdirSync(path.dirname(artifactDir), { recursive: true });
  fs.mkdirSync(artifactDir); // Preserve any previous attempt directory.
  const result = {
    distributionUrl,
    version: match[1],
    scope: "wrapper --version only; build and IDE journeys are not retried",
    passed: false,
    attempts: [],
  };
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const logFile = path.join(artifactDir, `attempt-${attempt}.log`);
      const record = { attempt, startedAt: new Date().toISOString() };
      result.attempts.push(record);
      let handle;
      let failure;
      try {
        handle = launch(
          path.join(
            projectDir,
            process.platform === "win32" ? "gradlew.bat" : "gradlew",
          ),
          ["--version"],
          { cwd: projectDir, env: process.env, logFile },
        );
        await requireSuccess(
          handle,
          Date.now() + attemptTimeoutMs,
          "Gradle distribution bootstrap",
        );
      } catch (error) {
        failure = error;
        record.error = error.message;
      }
      const bytes = fs.existsSync(logFile) ? fs.readFileSync(logFile) : null;
      const log = bytes?.toString("utf8") || "";
      Object.assign(record, {
        finishedAt: new Date().toISOString(),
        code: handle?.child.exitCode ?? null,
        signal: handle?.child.signalCode ?? null,
        logFile: path.basename(logFile),
        logBytes: bytes?.length ?? null,
        logSha256: bytes
          ? createHash("sha256").update(bytes).digest("hex")
          : null,
      });
      if (!failure) {
        assert(
          log.split(/\r?\n/u).includes(`Gradle ${match[1]}`),
          "Wrapper output did not confirm the pinned Gradle version",
        );
        result.passed = true;
        return result;
      }
      record.retryable = Boolean(
        handle?.closed &&
        Number.isInteger(handle.child.exitCode) &&
        handle.child.exitCode !== 0 &&
        handle.child.signalCode === null &&
        failure.message ===
          `Gradle distribution bootstrap exited ${handle.child.exitCode}/null` &&
        isDistributionNetworkFailure(log, distributionUrl),
      );
      if (!record.retryable || attempt === 3) throw failure;
      await delay(retryDelayMs);
    }
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    fs.writeFileSync(
      path.join(artifactDir, "bootstrap-result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      { flag: "wx" },
    );
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const { values } = parseArgs({
    options: {
      "project-dir": { type: "string" },
      "artifact-dir": { type: "string" },
    },
  });
  prepareGradle({
    projectDir: path.resolve(values["project-dir"]),
    artifactDir: path.resolve(values["artifact-dir"]),
  }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
