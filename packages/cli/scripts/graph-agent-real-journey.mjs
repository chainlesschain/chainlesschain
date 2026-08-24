#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.dirname(scriptDirectory);
const repositoryRoot = path.resolve(cliRoot, "..", "..");
const cliBin = path.join(cliRoot, "bin", "chainlesschain.js");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function exactSha(value, label) {
  const sha = String(value || "").toLowerCase();
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(sha)) {
    throw new Error(`${label} must be an exact commit SHA`);
  }
  return sha;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function minimalJourneyEnvironment() {
  const allowed = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "TMP",
    "TEMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "CI",
    "GITHUB_ACTIONS",
    "NO_COLOR",
  ];
  const environment = Object.fromEntries(
    allowed
      .filter((name) => process.env[name] != null)
      .map((name) => [name, process.env[name]]),
  );
  environment.CC_API_KEY = process.env.CC_API_KEY;
  environment.CC_GRAPH_JOURNEY_PROVIDER =
    process.env.CC_GRAPH_JOURNEY_PROVIDER || "openai";
  environment.CC_GRAPH_JOURNEY_MODEL =
    process.env.CC_GRAPH_JOURNEY_MODEL || "gpt-5-mini";
  return environment;
}

function verifyEvidence(directory, expectedSha) {
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const records = files.map((name) =>
    JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")),
  );
  for (const record of records) {
    const { evidenceDigest, ...evidence } = record;
    if (
      !evidenceDigest ||
      evidenceDigest !== sha256(JSON.stringify(evidence))
    ) {
      throw new Error("Graph/Agent journey evidence digest is invalid");
    }
  }
  const platforms = new Set(records.map((record) => record.platform));
  for (const platform of ["linux", "windows", "macos"]) {
    if (!platforms.has(platform)) {
      throw new Error(`missing Graph/Agent journey platform: ${platform}`);
    }
  }
  if (
    records.some(
      (record) =>
        record.schema !== "chainlesschain.graph-agent-real-journey/v1" ||
        record.commitSha !== expectedSha ||
        record.status !== "passed" ||
        !record.terminalEventDigest,
    )
  ) {
    throw new Error("Graph/Agent journey evidence is incomplete or stale");
  }
  const aggregate = {
    schema: "chainlesschain.graph-agent-real-journey-matrix/v1",
    commitSha: expectedSha,
    status: "passed",
    platforms: [...platforms].sort(),
    evidenceDigests: records.map((record) => record.evidenceDigest).sort(),
  };
  return {
    ...aggregate,
    aggregateDigest: sha256(JSON.stringify(aggregate)),
  };
}

const verifyDirectory = argument("--verify-dir");
const expectedSha = exactSha(
  argument("--commit-sha") || process.env.CC_GRAPH_JOURNEY_COMMIT,
  "commit SHA",
);
const output = path.resolve(
  argument("--output") || path.join(process.cwd(), "graph-agent-journey.json"),
);

if (verifyDirectory) {
  const aggregate = verifyEvidence(path.resolve(verifyDirectory), expectedSha);
  fs.writeFileSync(output, `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(aggregate)}\n`);
  process.exit(0);
}

if (!process.env.CC_API_KEY) {
  throw new Error("CC_API_KEY is required for the real-provider journey");
}
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
  .trim()
  .toLowerCase();
if (head !== expectedSha) {
  throw new Error(`checked out HEAD ${head} does not match ${expectedSha}`);
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cc-graph-journey-"));
const nonce = `CC_GRAPH_JOURNEY_${randomUUID().replaceAll("-", "")}`;
try {
  execFileSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
  execFileSync(
    "git",
    ["config", "user.email", "journey@chainlesschain.local"],
    {
      cwd: workspace,
    },
  );
  execFileSync("git", ["config", "user.name", "Graph Journey"], {
    cwd: workspace,
  });
  fs.writeFileSync(path.join(workspace, "README.md"), "# Journey\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: workspace });
  execFileSync("git", ["commit", "-m", "test: seed journey"], {
    cwd: workspace,
    stdio: "ignore",
  });

  const result = spawnSync(
    process.execPath,
    [
      cliBin,
      "exec",
      "--print",
      `Reply with this exact token and no other text: ${nonce}`,
      "--output-format",
      "stream-json",
      "--provider",
      process.env.CC_GRAPH_JOURNEY_PROVIDER || "openai",
      "--model",
      process.env.CC_GRAPH_JOURNEY_MODEL || "gpt-5-mini",
      "--permission-mode",
      "plan",
      "--max-turns",
      "2",
      "--ephemeral",
      "--worktree",
    ],
    {
      cwd: workspace,
      env: minimalJourneyEnvironment(),
      encoding: "utf8",
      timeout: 10 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `cc exec real-provider journey failed (${result.status}): ${String(result.stderr).slice(-2000)}`,
    );
  }
  const events = String(result.stdout)
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const terminal = [...events]
    .reverse()
    .find((event) => event.type === "result");
  if (
    !terminal ||
    terminal.is_error === true ||
    terminal.subtype !== "success" ||
    !String(terminal.result || "").includes(nonce)
  ) {
    throw new Error(
      "real-provider journey lacks a matching success terminal event",
    );
  }
  const terminalEventDigest = sha256(JSON.stringify(terminal));
  const evidence = {
    schema: "chainlesschain.graph-agent-real-journey/v1",
    commitSha: expectedSha,
    platform:
      process.platform === "win32"
        ? "windows"
        : process.platform === "darwin"
          ? "macos"
          : "linux",
    architecture: process.arch,
    node: process.version,
    status: "passed",
    protocol: "cc-exec-stream-json",
    worktreeRequested: true,
    sandboxPosture: "plan",
    terminalEventDigest,
    eventCount: events.length,
  };
  const record = {
    ...evidence,
    evidenceDigest: sha256(JSON.stringify(evidence)),
  };
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(record)}\n`);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
