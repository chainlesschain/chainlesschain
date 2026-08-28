#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile, execFileSync, spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CODEX_APP_SERVER_COMPATIBILITY_MATRIX,
  isCodexAppServerVersionCompatible,
} from "../src/lib/codex-app-server-adapter.js";
import { EXTERNAL_AGENT_PROTOCOL } from "../src/lib/external-agent-adapters.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PLATFORMS = Object.freeze(["linux", "macos", "windows"]);
const VERSIONS = Object.freeze(
  CODEX_APP_SERVER_COMPATIBILITY_MATRIX.map((entry) => entry.version),
);
const REQUIRED_SCHEMA_METHODS = Object.freeze([
  "initialize",
  "initialized",
  "thread/start",
  "thread/list",
  "turn/start",
  "turn/interrupt",
]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function digest(value, domain) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(
      typeof value === "string" ? value : JSON.stringify(canonicalValue(value)),
    )
    .digest("hex")}`;
}

function parseArgs(argv) {
  const out = {
    codexJs: "",
    commitSha: "",
    output: "",
    platform: "",
    verifyDir: "",
    version: "",
  };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1] || "";
    if (key === "--codex-js") out.codexJs = value;
    else if (key === "--commit-sha") out.commitSha = value;
    else if (key === "--output") out.output = value;
    else if (key === "--platform") out.platform = value.toLowerCase();
    else if (key === "--verify-dir") out.verifyDir = value;
    else if (key === "--version") out.version = value;
    else throw new TypeError(`Unknown argument: ${key}`);
  }
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(out.commitSha)) {
    throw new TypeError("--commit-sha must be an exact 40 or 64 character SHA");
  }
  if (!out.output) throw new TypeError("--output is required");
  if (!out.verifyDir) {
    if (!PLATFORMS.includes(out.platform)) {
      throw new TypeError("--platform must be linux, macos, or windows");
    }
    if (!VERSIONS.includes(out.version)) {
      throw new TypeError("--version is not in the compatibility matrix");
    }
    if (!out.codexJs) throw new TypeError("--codex-js is required");
  }
  return out;
}

function exactHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

function assertExactSource(commitSha) {
  if (exactHead() !== commitSha) {
    throw new Error("checked-out source does not match --commit-sha");
  }
  const status = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  ).trim();
  if (status)
    throw new Error("compatibility evidence requires a clean source tree");
}

function writeJson(path, value) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function filesUnder(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files.sort();
}

function runCodex(codexJs, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      process.execPath,
      [resolve(codexJs), ...args],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(
            new Error(
              `Codex command failed (${error.code || "unknown"}); stderr_bytes=${Buffer.byteLength(stderr || "")}`,
            ),
          );
          return;
        }
        resolvePromise({
          stdout,
          stderrBytes: Buffer.byteLength(stderr || ""),
        });
      },
    );
  });
}

async function generateSchema(codexJs) {
  const schemaDir = mkdtempSync(join(tmpdir(), "cc-codex-app-schema-"));
  try {
    const command = await runCodex(codexJs, [
      "app-server",
      "generate-json-schema",
      "--out",
      schemaDir,
    ]);
    const files = filesUnder(schemaDir).filter((path) =>
      path.endsWith(".json"),
    );
    if (files.length === 0) throw new Error("Codex generated no JSON schemas");
    const entries = files.map((path) => ({
      path: relative(schemaDir, path).replaceAll("\\", "/"),
      text: readFileSync(path, "utf8"),
    }));
    const combined = entries
      .map(({ path, text }) => `${path}\0${text}`)
      .join("\0");
    const missing = REQUIRED_SCHEMA_METHODS.filter(
      (method) => !combined.includes(`"${method}"`),
    );
    if (missing.length > 0) {
      throw new Error(
        `Codex schema is missing required methods: ${missing.join(", ")}`,
      );
    }
    return {
      fileCount: files.length,
      digest: digest(combined, "cc.codex-app-server.schema/v1"),
      methods: [...REQUIRED_SCHEMA_METHODS],
      stderrBytes: command.stderrBytes,
    };
  } finally {
    const temporaryRoot = `${resolve(tmpdir())}${sep}`;
    if (!resolve(schemaDir).startsWith(temporaryRoot)) {
      throw new Error(
        "refusing to remove a schema directory outside the temp root",
      );
    }
    rmSync(schemaDir, { recursive: true, force: true });
  }
}

function requestWithTimeout(pending, id, method, timeoutMs = 15_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      pending.delete(String(id));
      rejectPromise(new Error(`Codex App Server request timed out: ${method}`));
    }, timeoutMs);
    pending.set(String(id), {
      resolve: (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    });
  });
}

async function probeStdio(codexJs) {
  const child = spawn(
    process.execPath,
    [resolve(codexJs), "app-server", "--listen", "stdio://"],
    { cwd: REPO_ROOT, env: process.env, stdio: ["pipe", "pipe", "pipe"] },
  );
  const pending = new Map();
  let stdoutBuffer = "";
  let stderrBytes = 0;
  let sawJsonrpcHeader = false;
  const failPending = (error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        failPending(new Error("Codex App Server emitted malformed JSONL"));
        continue;
      }
      if (Object.hasOwn(message, "jsonrpc")) sawJsonrpcHeader = true;
      if (message.id == null) continue;
      const entry = pending.get(String(message.id));
      if (!entry) continue;
      pending.delete(String(message.id));
      if (message.error) {
        entry.reject(
          new Error(
            `Codex App Server RPC failed: ${Number(message.error.code) || "unknown"}`,
          ),
        );
      } else entry.resolve(message.result);
    }
  });
  child.once("error", (error) => failPending(error));
  child.once("exit", (code) => {
    failPending(
      new Error(`Codex App Server exited during probe (${code ?? "signal"})`),
    );
  });
  const send = (message) => {
    child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
  };
  try {
    const initialized = requestWithTimeout(pending, 1, "initialize");
    send({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "chainlesschain_compatibility_probe",
          title: "ChainlessChain compatibility probe",
          version: "1.0.0",
        },
      },
    });
    const initializeResult = await initialized;
    send({ method: "initialized", params: {} });
    const listed = requestWithTimeout(pending, 2, "thread/list");
    send({ method: "thread/list", id: 2, params: { limit: 1 } });
    const listResult = await listed;
    if (!initializeResult || !listResult || sawJsonrpcHeader) {
      throw new Error(
        "Codex App Server stdio contract did not match the documented protocol",
      );
    }
    return {
      initialized: true,
      threadList: true,
      jsonrpcHeaderOmitted: true,
      stderrBytes,
    };
  } finally {
    child.stdin.end();
    if (child.exitCode == null && child.signalCode == null) child.kill();
    failPending(new Error("Codex App Server probe closed"));
  }
}

function scanProductionReferences() {
  const sourceRoot = resolve(REPO_ROOT, "packages/cli/src");
  const adapterPath = resolve(sourceRoot, "lib/codex-app-server-adapter.js");
  const references = [];
  for (const path of filesUnder(sourceRoot)) {
    if (path === adapterPath || !/\.(?:c?js|mjs|ts)$/u.test(path)) continue;
    const text = readFileSync(path, "utf8");
    if (
      text.includes("codex-app-server-adapter") ||
      text.includes("CodexAppServerAdapter")
    ) {
      references.push(relative(REPO_ROOT, path).replaceAll("\\", "/"));
    }
  }
  return references.sort();
}

async function runRemovalDrill() {
  const references = scanProductionReferences();
  if (references.length > 0) {
    throw new Error(
      `Codex adapter has production dependants: ${references.join(", ")}`,
    );
  }
  const stableModuleUrl = pathToFileURL(
    resolve(REPO_ROOT, "packages/cli/src/lib/external-agent-adapters.js"),
  );
  const stableModule = await import(`${stableModuleUrl.href}?removal-drill=1`);
  const adapter = new stableModule.CodexAdapter();
  const args = adapter.buildArgs({ prompt: "removal drill" });
  const projection = adapter.parseTranscript(
    '{"type":"item.completed","item":{"type":"agent_message","text":"fallback-ok"}}\n' +
      '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n',
  );
  if (
    adapter.capabilities().protocol !==
      EXTERNAL_AGENT_PROTOCOL.CODEX_EXEC_JSONL ||
    args.join("\0") !== "exec\0--json\0removal drill" ||
    projection.terminal !== "completed" ||
    projection.output !== "fallback-ok"
  ) {
    throw new Error("stable codex exec fallback failed the removal drill");
  }
  return {
    adapterProductionReferenceCount: references.length,
    fallbackProtocol: EXTERNAL_AGENT_PROTOCOL.CODEX_EXEC_JSONL,
    fallbackPassed: true,
    removable: true,
  };
}

async function runCandidate(options) {
  assertExactSource(options.commitSha);
  const versionResult = await runCodex(options.codexJs, ["--version"]);
  const reportedVersion = versionResult.stdout.trim();
  if (
    reportedVersion !== `codex-cli ${options.version}` ||
    !isCodexAppServerVersionCompatible(
      reportedVersion,
      CODEX_APP_SERVER_COMPATIBILITY_MATRIX,
    )
  ) {
    throw new Error(
      "installed Codex CLI does not match the exact compatibility entry",
    );
  }
  const [schema, handshake, removalDrill] = await Promise.all([
    generateSchema(options.codexJs),
    probeStdio(options.codexJs),
    runRemovalDrill(),
  ]);
  if (
    isCodexAppServerVersionCompatible(
      "codex-cli 0.150.2",
      CODEX_APP_SERVER_COMPATIBILITY_MATRIX,
    )
  ) {
    throw new Error("unverified future Codex version was admitted");
  }
  const body = {
    schema: "chainlesschain.codex-app-server-compatibility/v1",
    commitSha: options.commitSha,
    platform: options.platform,
    upstream: {
      package: "@openai/codex",
      version: options.version,
      reportedVersion,
      stability: "experimental",
      transport: "stdio",
      schema,
      handshake,
    },
    admission: {
      exactVersionAccepted: true,
      unverifiedFutureVersionRejected: true,
    },
    removalDrill,
  };
  return Object.freeze({
    ...body,
    reportDigest: digest(body, "cc.codex-app-server.compatibility/v1"),
  });
}

function jsonFiles(root) {
  return filesUnder(root).filter((path) => path.endsWith(".json"));
}

function verifyMatrix(options) {
  const reports = jsonFiles(resolve(options.verifyDir)).map((path) =>
    JSON.parse(readFileSync(path, "utf8")),
  );
  const expectedCount = PLATFORMS.length * VERSIONS.length;
  if (reports.length !== expectedCount) {
    throw new Error(
      `expected ${expectedCount} reports, found ${reports.length}`,
    );
  }
  const byKey = new Map(
    reports.map((report) => [
      `${report.platform}/${report.upstream?.version}`,
      report,
    ]),
  );
  if (byKey.size !== expectedCount) throw new Error("duplicate matrix report");
  for (const platform of PLATFORMS) {
    for (const version of VERSIONS) {
      if (!byKey.has(`${platform}/${version}`)) {
        throw new Error(`missing matrix report: ${platform}/${version}`);
      }
    }
  }
  const schemaDigests = {};
  for (const report of reports) {
    const upstream = report.upstream || {};
    const { reportDigest, ...reportBody } = report;
    if (
      report.schema !== "chainlesschain.codex-app-server-compatibility/v1" ||
      report.commitSha !== options.commitSha ||
      upstream.package !== "@openai/codex" ||
      upstream.reportedVersion !== `codex-cli ${upstream.version}` ||
      upstream.stability !== "experimental" ||
      upstream.transport !== "stdio" ||
      upstream.schema?.fileCount < 1 ||
      !/^sha256:[a-f0-9]{64}$/u.test(upstream.schema?.digest || "") ||
      upstream.handshake?.initialized !== true ||
      upstream.handshake?.threadList !== true ||
      upstream.handshake?.jsonrpcHeaderOmitted !== true ||
      report.admission?.exactVersionAccepted !== true ||
      report.admission?.unverifiedFutureVersionRejected !== true ||
      report.removalDrill?.adapterProductionReferenceCount !== 0 ||
      report.removalDrill?.fallbackPassed !== true ||
      report.removalDrill?.removable !== true ||
      reportDigest !==
        digest(reportBody, "cc.codex-app-server.compatibility/v1")
    ) {
      throw new Error(
        `invalid compatibility report: ${report.platform}/${upstream.version}`,
      );
    }
    schemaDigests[upstream.version] ||= new Set();
    schemaDigests[upstream.version].add(upstream.schema.digest);
  }
  for (const [version, values] of Object.entries(schemaDigests)) {
    if (values.size !== 1) {
      throw new Error(`schema digest differs across platforms for ${version}`);
    }
  }
  const entries = VERSIONS.map((version) => ({
    version,
    schemaDigest: [...schemaDigests[version]][0],
    platforms: PLATFORMS.map((platform) => ({
      platform,
      reportDigest: byKey.get(`${platform}/${version}`).reportDigest,
    })),
  }));
  const body = {
    schema: "chainlesschain.codex-app-server-matrix/v1",
    commitSha: options.commitSha,
    status: "passed",
    stability: "experimental",
    productionCritical: false,
    fallback: EXTERNAL_AGENT_PROTOCOL.CODEX_EXEC_JSONL,
    versions: entries,
    removalDrill: "passed",
  };
  return Object.freeze({
    ...body,
    matrixDigest: digest(body, "cc.codex-app-server.matrix/v1"),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = options.verifyDir
    ? verifyMatrix(options)
    : await runCandidate(options);
  writeJson(options.output, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
