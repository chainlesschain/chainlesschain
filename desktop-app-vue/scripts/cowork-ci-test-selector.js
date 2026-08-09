#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(PROJECT_ROOT, "..");
const PROJECT_PREFIX = "desktop-app-vue/";
const CI_VITEST_FLAGS = [
  "--reporter=default",
  "--silent=passed-only",
  "--pool=threads",
];
const CRITICAL_TESTS = [
  "tests/unit/llm/llm-service.test.js",
  "tests/unit/did/did-manager.test.js",
];
const FULL_UNIT_TRIGGERS = new Set([
  ".cowork/ci-test-config.json",
  "package.json",
  "package-lock.json",
  "tests/setup.ts",
  "vitest.config.js",
  "vitest.config.mjs",
  "vitest.config.ts",
  "scripts/cowork-ci-test-selector.js",
]);

class SelectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SelectionError";
    this.code = code;
    this.details = details;
  }
}

function toPosix(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function validateBaseRef(baseRef) {
  if (
    typeof baseRef !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(baseRef) ||
    baseRef.includes("..") ||
    baseRef.includes("@{") ||
    baseRef.includes("//") ||
    baseRef.endsWith("/") ||
    baseRef.endsWith(".") ||
    baseRef.endsWith(".lock")
  ) {
    throw new SelectionError(
      "INVALID_BASE_REF",
      `Unsafe or invalid base ref: ${JSON.stringify(baseRef)}`,
    );
  }

  return baseRef;
}

function getChangedFilesCI({
  baseRef = process.env.GITHUB_BASE_REF || "main",
  repoRoot = REPO_ROOT,
  spawn = spawnSync,
} = {}) {
  const validatedBase = validateBaseRef(baseRef);
  const comparison = `origin/${validatedBase}...HEAD`;
  const result = spawn(
    "git",
    ["diff", "--name-only", "--diff-filter=ACDMRTUXB", comparison, "--"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  );

  if (result.error) {
    throw new SelectionError(
      "GIT_DIFF_SPAWN_FAILED",
      `Unable to start git diff: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new SelectionError(
      "GIT_DIFF_FAILED",
      `git diff exited with ${String(result.status)}`,
      { stderr: String(result.stderr || "").trim() },
    );
  }

  const changedFiles = String(result.stdout || "")
    .split(/\r?\n/)
    .map((file) => toPosix(file.trim()))
    .filter(Boolean);

  if (changedFiles.length === 0) {
    throw new SelectionError(
      "NO_CHANGED_FILES",
      "The base comparison produced no changed files; refusing a no-op pass.",
      { comparison },
    );
  }

  return changedFiles;
}

function projectRelativePath(repoRelativePath) {
  const normalized = toPosix(repoRelativePath);
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").includes("..")
  ) {
    return null;
  }
  if (!normalized.startsWith(PROJECT_PREFIX)) {
    return null;
  }
  return normalized.slice(PROJECT_PREFIX.length);
}

function isVitestFile(projectRelativeFile) {
  return (
    /^(tests\/unit|src)\/.*\.test\.(?:js|ts|jsx|tsx)$/.test(
      projectRelativeFile,
    ) && !projectRelativeFile.includes("/tests/e2e/")
  );
}

function candidateTestsForSource(
  projectRelativeFile,
  { projectRoot = PROJECT_ROOT } = {},
) {
  const extension = path.posix.extname(projectRelativeFile);
  if (![".js", ".ts", ".jsx", ".tsx", ".vue"].includes(extension)) {
    return [];
  }

  const dirname = path.posix.dirname(projectRelativeFile);
  const basename = path.posix.basename(projectRelativeFile, extension);
  const testExtensions = extension === ".vue" ? [".js", ".ts"] : [extension];
  const candidates = new Set();

  for (const testExtension of testExtensions) {
    candidates.add(`${dirname}/${basename}.test${testExtension}`);
    candidates.add(`${dirname}/__tests__/${basename}.test${testExtension}`);
  }

  for (const sourcePrefix of ["src/main/", "src/renderer/", "src/shared/"]) {
    if (!projectRelativeFile.startsWith(sourcePrefix)) {
      continue;
    }
    const mirrored = projectRelativeFile.slice(sourcePrefix.length);
    const mirrorDir = path.posix.dirname(mirrored);
    for (const testExtension of testExtensions) {
      candidates.add(
        `tests/unit/${mirrorDir}/${basename}.test${testExtension}`,
      );
      candidates.add(
        `tests/unit/${mirrorDir}/__tests__/${basename}.test${testExtension}`,
      );
    }
  }

  const candidateDirectories = new Set(
    [...candidates].map((candidate) => path.posix.dirname(candidate)),
  );
  for (const directory of candidateDirectories) {
    const absoluteDirectory = path.join(projectRoot, ...directory.split("/"));
    if (!fs.existsSync(absoluteDirectory)) {
      continue;
    }

    let entries;
    try {
      entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      throw new SelectionError(
        "TEST_DISCOVERY_FAILED",
        `Unable to inspect related test directory ${JSON.stringify(directory)}: ${error.message}`,
      );
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const match = entry.name.match(/^(.*)\.test\.(?:js|ts|jsx|tsx)$/);
      if (!match) {
        continue;
      }
      const testStem = match[1];
      if (
        testStem === basename ||
        testStem.startsWith(`${basename}-`) ||
        testStem.startsWith(`${basename}.`)
      ) {
        candidates.add(`${directory}/${entry.name}`);
      }
    }
  }

  return [...candidates].sort();
}

function createSelection(changedFiles, { projectRoot = PROJECT_ROOT } = {}) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    throw new SelectionError(
      "NO_CHANGED_FILES",
      "At least one changed file is required for test selection.",
    );
  }

  const selectedTests = new Set();
  const mappings = [];
  const unmappedFiles = [];
  let fullUnit = false;

  for (const changedFile of changedFiles) {
    const normalized = toPosix(changedFile);
    const relativeFile = projectRelativePath(normalized);

    if (!relativeFile) {
      unmappedFiles.push(normalized);
      continue;
    }

    if (FULL_UNIT_TRIGGERS.has(relativeFile)) {
      fullUnit = true;
      mappings.push({ file: normalized, suite: "desktop-unit", mode: "full" });
      continue;
    }

    if (isVitestFile(relativeFile)) {
      const absoluteTest = path.join(projectRoot, ...relativeFile.split("/"));
      if (fs.existsSync(absoluteTest)) {
        selectedTests.add(relativeFile);
        mappings.push({
          file: normalized,
          suite: "desktop-unit",
          tests: [relativeFile],
        });
      } else {
        // A deleted or renamed test can invalidate more than itself.
        fullUnit = true;
        mappings.push({
          file: normalized,
          suite: "desktop-unit",
          mode: "full",
          reason: "changed-test-not-present",
        });
      }
      continue;
    }

    if (relativeFile.startsWith("src/")) {
      const relatedTests = candidateTestsForSource(relativeFile, {
        projectRoot,
      }).filter((testFile) =>
        fs.existsSync(path.join(projectRoot, ...testFile.split("/"))),
      );

      if (relatedTests.length === 0) {
        unmappedFiles.push(normalized);
        continue;
      }

      for (const testFile of relatedTests) {
        selectedTests.add(testFile);
      }
      mappings.push({
        file: normalized,
        suite: "desktop-unit",
        tests: relatedTests,
      });
      continue;
    }

    // Non-source project changes can affect bundling, fixtures, or runtime
    // discovery. Treat them as a full unit-suite trigger instead of a no-op.
    fullUnit = true;
    mappings.push({
      file: normalized,
      suite: "desktop-unit",
      mode: "full",
      reason: "project-support-file",
    });
  }

  if (unmappedFiles.length > 0) {
    throw new SelectionError(
      "UNMAPPED_CHANGED_FILES",
      "One or more changed files could not be mapped safely; the workflow must run its fallback suite.",
      { unmappedFiles, mappings },
    );
  }

  if (!fullUnit) {
    for (const criticalTest of CRITICAL_TESTS) {
      if (fs.existsSync(path.join(projectRoot, ...criticalTest.split("/")))) {
        selectedTests.add(criticalTest);
      }
    }
  }

  const tests = [...selectedTests].sort();
  if (!fullUnit && tests.length === 0) {
    throw new SelectionError(
      "EMPTY_SELECTION",
      "The selector produced no executable tests; refusing a no-op pass.",
      { mappings },
    );
  }

  return {
    schemaVersion: 1,
    status: "selected",
    suite: "desktop-unit",
    mode: fullUnit ? "full" : "targeted",
    changedFiles: changedFiles.map(toPosix),
    selectedTests: fullUnit ? ["tests/unit", "src"] : tests,
    mappings,
  };
}

function commandForSelection(selection, options = {}) {
  let vitestEntrypoint =
    options.vitestEntrypoint || process.env.COWORK_VITEST_ENTRYPOINT;
  if (!vitestEntrypoint) {
    try {
      const vitestPackage = require.resolve("vitest/package.json", {
        paths: [PROJECT_ROOT, REPO_ROOT],
      });
      vitestEntrypoint = path.join(path.dirname(vitestPackage), "vitest.mjs");
    } catch {
      // Keep dry-run planning dependency-free. A real invocation still starts
      // Node with this explicit path and propagates its non-zero missing-module
      // exit instead of falling back to a shell or reporting success.
      vitestEntrypoint = path.join(
        PROJECT_ROOT,
        "node_modules",
        "vitest",
        "vitest.mjs",
      );
    }
  }
  return {
    executable: process.execPath,
    args: [
      vitestEntrypoint,
      "run",
      ...selection.selectedTests,
      ...CI_VITEST_FLAGS,
    ],
  };
}

function appendGitHubOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`, "utf8");
}

function emitMachineResult(payload) {
  const serialized = JSON.stringify(payload);
  console.log(`COWORK_TEST_SELECTION_JSON=${serialized}`);
  appendGitHubOutput("test-mode", payload.mode || "fail-closed");
  appendGitHubOutput(
    "test-count",
    String(
      Array.isArray(payload.selectedTests) ? payload.selectedTests.length : 0,
    ),
  );
  appendGitHubOutput("selection-json", serialized);
}

function parseArgs(argv) {
  const parsed = { changedFiles: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      parsed.dryRun = true;
    } else if (argument === "--json") {
      parsed.json = true;
    } else if (argument === "--base") {
      index += 1;
      if (!argv[index]) {
        throw new SelectionError("INVALID_ARGUMENT", "--base requires a value");
      }
      parsed.baseRef = argv[index];
    } else if (argument === "--changed-file") {
      index += 1;
      if (!argv[index]) {
        throw new SelectionError(
          "INVALID_ARGUMENT",
          "--changed-file requires a value",
        );
      }
      parsed.changedFiles.push(argv[index]);
    } else {
      throw new SelectionError(
        "INVALID_ARGUMENT",
        `Unknown argument: ${argument}`,
      );
    }
  }
  return parsed;
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  const spawn = dependencies.spawn || spawnSync;

  try {
    const args = parseArgs(argv);
    const changedFiles =
      args.changedFiles.length > 0
        ? args.changedFiles
        : getChangedFilesCI({ baseRef: args.baseRef, spawn });
    const selection = createSelection(changedFiles);
    const command = commandForSelection(selection);
    const selectedPayload = { ...selection, command };

    if (!args.json) {
      console.log(
        `Selected ${selection.mode} ${selection.suite} coverage for ${selection.changedFiles.length} changed file(s).`,
      );
      console.log(`Command: ${command.executable} ${command.args.join(" ")}`);
    }

    if (args.dryRun) {
      emitMachineResult({ ...selectedPayload, status: "dry-run" });
      return 0;
    }

    const result = spawn(command.executable, command.args, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) {
      throw new SelectionError(
        "TEST_SPAWN_FAILED",
        `Unable to start selected test suite: ${result.error.message}`,
      );
    }

    const exitCode = Number.isInteger(result.status) ? result.status : 1;
    emitMachineResult({
      ...selectedPayload,
      status: exitCode === 0 ? "passed" : "failed",
      exitCode,
      signal: result.signal || null,
    });
    return exitCode;
  } catch (error) {
    const payload = {
      schemaVersion: 1,
      status: "fail-closed",
      code: error.code || "SELECTION_FAILED",
      message: error.message,
      details: error.details || {},
    };
    console.error(`CI test selection failed closed: ${payload.message}`);
    emitMachineResult(payload);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  SelectionError,
  candidateTestsForSource,
  commandForSelection,
  createSelection,
  getChangedFilesCI,
  main,
  parseArgs,
  projectRelativePath,
  validateBaseRef,
};
