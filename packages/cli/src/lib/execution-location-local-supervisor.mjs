#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import process from "node:process";

const MEBIBYTE = 1024 * 1024;
const MAX_CAPTURED_MARKER_BYTES = 256;
const MAX_INPUT_BYTES = 64 * MEBIBYTE;

function parseArguments(argv) {
  const separator = argv.indexOf("--");
  assert.ok(separator >= 0, "local target supervisor requires --");
  const control = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  const options = {};
  for (let index = 0; index < control.length; index += 2) {
    const key = control[index];
    const value = control[index + 1];
    assert.ok(key?.startsWith("--") && value, `invalid argument: ${key}`);
    options[
      key
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = value;
  }
  assert.ok(options.cwd && options.entry && command.length > 0);
  const cpuSeconds = Number(options.cpuSeconds);
  const memoryBytes = Number(options.memoryBytes);
  assert.ok(
    Number.isSafeInteger(cpuSeconds) && cpuSeconds >= 1 && cpuSeconds <= 86_400,
  );
  assert.ok(
    Number.isSafeInteger(memoryBytes) &&
      memoryBytes >= 64 * MEBIBYTE &&
      memoryBytes <= 64 * 1024 * MEBIBYTE,
  );
  return { ...options, cpuSeconds, memoryBytes, command };
}

function boundedHeapMebibytes(memoryBytes) {
  // V8's old-space boundary is a real child-process limit and is intentionally
  // allowed to be stricter than the runner's total-memory ceiling. Keeping the
  // probe at or below 256 MiB avoids consuming a multi-GiB hosted runner merely
  // to prove that the target-side supervisor terminates the workload.
  return Math.max(64, Math.min(256, Math.floor(memoryBytes / MEBIBYTE)));
}

function sameFileIdentity(left, right) {
  return (
    String(left.dev) === String(right.dev) &&
    String(left.ino) === String(right.ino) &&
    Number(left.nlink) === 1 &&
    Number(right.nlink) === 1 &&
    Number(left.size) === Number(right.size)
  );
}

function readMaterializedInput(options) {
  if (!options.inputFile) return null;
  assert.match(options.inputSha256 || "", /^[a-f0-9]{64}$/u);
  const expectedBytes = Number(options.inputBytes);
  assert.ok(
    Number.isSafeInteger(expectedBytes) &&
      expectedBytes >= 1 &&
      expectedBytes <= MAX_INPUT_BYTES,
  );
  const before = fs.lstatSync(options.inputFile, { bigint: true });
  assert.ok(
    before.isFile() &&
      !before.isSymbolicLink() &&
      Number(before.nlink) === 1 &&
      Number(before.size) === expectedBytes,
    "local target input authority is invalid",
  );
  let descriptor;
  try {
    descriptor = fs.openSync(
      options.inputFile,
      fs.constants.O_RDONLY | Number(fs.constants.O_NOFOLLOW || 0),
    );
    const opened = fs.fstatSync(descriptor, { bigint: true });
    assert.ok(
      opened.isFile() && sameFileIdentity(before, opened),
      "local target input identity changed while opening",
    );
    const input = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    assert.ok(
      input.length === expectedBytes && sameFileIdentity(opened, after),
      "local target input changed while reading",
    );
    const expectedDigest = Buffer.from(options.inputSha256, "hex");
    const actualDigest = createHash("sha256").update(input).digest();
    assert.ok(
      timingSafeEqual(actualDigest, expectedDigest),
      "local target input digest mismatch",
    );
    return input;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const resourceKind =
    options.command[0] === "session" &&
    options.command[1] === "location" &&
    options.command[2] === "resource-probe"
      ? options.command[3]
      : null;
  const resume =
    options.command[0] === "session" && options.command[1] === "resume";
  const forwardsInput =
    options.command[0] === "session" &&
    options.command[1] === "location" &&
    options.command[2] === "prepare";
  assert.ok(
    !options.inputFile || forwardsInput,
    "materialized input is permitted only for session location prepare",
  );
  const materializedInput = readMaterializedInput(options);
  const heapMebibytes = boundedHeapMebibytes(options.memoryBytes);
  const enforcement =
    process.env.CC_EXECUTION_LOCATION_SUPERVISOR_ENFORCEMENT ||
    "target-supervisor";
  assert.match(
    enforcement,
    /^(?:target-supervisor|posix-rlimit\+target-supervisor)$/u,
  );
  const childEnvironment = {
    ...process.env,
    CC_EXECUTION_LOCATION_OBSERVED_CPU_SECONDS: String(options.cpuSeconds),
    CC_EXECUTION_LOCATION_OBSERVED_MEMORY_BYTES: String(
      heapMebibytes * MEBIBYTE,
    ),
    CC_EXECUTION_LOCATION_RESOURCE_ENFORCEMENT: enforcement,
  };
  const child = spawn(
    process.execPath,
    [
      `--max-old-space-size=${heapMebibytes}`,
      options.entry,
      ...options.command,
    ],
    {
      cwd: options.cwd,
      env: childEnvironment,
      shell: false,
      stdio: [resume || forwardsInput ? "pipe" : "ignore", "pipe", "inherit"],
      windowsHide: true,
    },
  );

  if (resume) child.stdin.end("/exit\n", "utf8");
  else if (materializedInput) child.stdin.end(materializedInput);
  else if (forwardsInput) process.stdin.pipe(child.stdin);
  let outputPrefix = "";
  let cpuLimitReached = false;
  let cpuTimer = null;
  const armCpuLimit = () => {
    if (cpuTimer !== null) return;
    cpuTimer = setTimeout(() => {
      cpuLimitReached = true;
      child.kill("SIGKILL");
    }, options.cpuSeconds * 1_000);
  };
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    if (outputPrefix.length < MAX_CAPTURED_MARKER_BYTES) {
      outputPrefix += chunk
        .toString("utf8")
        .slice(0, MAX_CAPTURED_MARKER_BYTES - outputPrefix.length);
    }
    if (
      resourceKind === "cpu" &&
      outputPrefix.includes("CC_EXECUTION_LOCATION_RESOURCE_PROBE_ARMED:cpu")
    ) {
      // Startup and module loading are not the probed workload. Arm the
      // target-side CPU boundary only after the fixed command proves that its
      // busy loop is live; otherwise slow filesystem I/O could masquerade as
      // CPU enforcement on hosted Windows or macOS.
      armCpuLimit();
    }
  });

  const forwardSignal = () => child.kill("SIGTERM");
  process.once("SIGTERM", forwardSignal);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (cpuTimer !== null) clearTimeout(cpuTimer);
  process.removeListener("SIGTERM", forwardSignal);

  const expectedMarker = resourceKind
    ? `CC_EXECUTION_LOCATION_RESOURCE_PROBE_ARMED:${resourceKind}`
    : null;
  const armed =
    expectedMarker !== null && outputPrefix.includes(expectedMarker);
  if (resourceKind === "cpu" && cpuLimitReached && armed) {
    process.exitCode = 152;
  } else if (
    resourceKind === "memory" &&
    armed &&
    (result.code !== 0 || result.signal !== null)
  ) {
    process.exitCode = 137;
  } else if (result.signal !== null) {
    process.exitCode = 128;
  } else {
    process.exitCode = Number(result.code || 0);
  }
}

await main();
