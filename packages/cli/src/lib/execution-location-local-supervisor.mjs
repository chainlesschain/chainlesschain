#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const MEBIBYTE = 1024 * 1024;
const MAX_CAPTURED_MARKER_BYTES = 256;
const MAX_STDIN_BYTES = 64 * 1024 * 1024;
const CPU_LIMIT_SIGNALS = new Set(["SIGKILL", "SIGXCPU"]);

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
  if (options.stdinFile) {
    assert.ok(
      forwardsInput && path.isAbsolute(options.stdinFile),
      "local target stdin file is invalid",
    );
  }
  let inputDescriptor = null;
  let stagedInput = null;
  if (options.stdinFile) {
    const requested = fs.lstatSync(options.stdinFile);
    assert.ok(
      requested.isFile() &&
        !requested.isSymbolicLink() &&
        requested.size > 0 &&
        requested.size <= MAX_STDIN_BYTES,
      "local target stdin file is invalid",
    );
    inputDescriptor = fs.openSync(
      options.stdinFile,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const opened = fs.fstatSync(inputDescriptor);
    assert.ok(
      opened.isFile() &&
        opened.size === requested.size &&
        opened.dev === requested.dev &&
        opened.ino === requested.ino &&
        opened.nlink === 1,
      "local target stdin file changed while opening",
    );
    stagedInput = fs.readFileSync(inputDescriptor);
    assert.equal(
      stagedInput.length,
      requested.size,
      "local target stdin file changed while reading",
    );
  }
  const heapMebibytes = boundedHeapMebibytes(options.memoryBytes);
  const childEnvironment = {
    ...process.env,
    CC_EXECUTION_LOCATION_OBSERVED_CPU_SECONDS: String(options.cpuSeconds),
    CC_EXECUTION_LOCATION_OBSERVED_MEMORY_BYTES: String(
      heapMebibytes * MEBIBYTE,
    ),
    CC_EXECUTION_LOCATION_RESOURCE_ENFORCEMENT: "target-supervisor",
  };
  let child;
  try {
    child = spawn(
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
        stdio: [
          resume || stagedInput !== null
            ? "pipe"
            : forwardsInput
                ? "inherit"
                : "ignore",
          "pipe",
          "inherit",
        ],
        windowsHide: true,
      },
    );
  } finally {
    if (inputDescriptor !== null) fs.closeSync(inputDescriptor);
  }

  if (resume) child.stdin.end("/exit\n", "utf8");
  else if (stagedInput !== null) child.stdin.end(stagedInput);
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
  if (
    resourceKind === "cpu" &&
    armed &&
    (cpuLimitReached || CPU_LIMIT_SIGNALS.has(result.signal))
  ) {
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
