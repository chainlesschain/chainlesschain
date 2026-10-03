// Exact-candidate audit. --self-test is offline; only --record --config JSON writes a receipt.
// The embedded source96 configuration is an historical self-test/template fixture,
// never an implicit recording target and never evidence for a new candidate.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const REPO = "chainlesschain/chainlesschain";
const DEFAULT_CONFIG = {
  schema: 1,
  commit: "96cbf6ba5631d5ef855e3cdc41801d837142e62b",
  branch: "release/ide-vscode-0.37.127",
  version: "0.37.127",
  pairedCliVersion: "0.166.84",
  output:
    "docs/research/ide/evidence/vscode-0.37.127-candidate-gates-96cbf6ba56.json",
  runs: {
    cliCi: 37054207987,
    cliStrictSandbox: 37054217552,
    ideExtensions: 37054226885,
  },
  candidate: {
    directory: ".work/gap-validation/vscode-candidate-96cbf6ba56",
    artifactId: 11248620239,
    bytes: 691734,
    sha256: "3e9004b381c192cc54b55ec90833083008d238614d48aee5c4408f46a94f67e0",
  },
};
function exactKeys(value, keys, label) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    [...keys].sort(),
    `${label} has missing or unknown keys`,
  );
}
function repositoryPath(value, prefix, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert(
    value.startsWith(prefix) &&
      !value.includes("\\") &&
      !value.includes(":") &&
      !/[\x00-\x1f]/.test(value),
    `Invalid ${label}`,
  );
  assert(
    value.split("/").every((part) => part && part !== "." && part !== ".."),
    `Invalid ${label} segments`,
  );
  const result = path.resolve(ROOT, value);
  assert(
    result.startsWith(`${ROOT}${path.sep}`),
    `${label} escapes repository`,
  );
  return value;
}
function normalizeConfig(value) {
  exactKeys(
    value,
    [
      "schema",
      "commit",
      "branch",
      "version",
      "pairedCliVersion",
      "output",
      "runs",
      "candidate",
    ],
    "config",
  );
  assert.equal(value.schema, 1, "Unknown config schema");
  assert.equal(typeof value.commit, "string");
  assert.match(
    value.commit,
    /^[0-9a-f]{40}$/,
    "Require exact lowercase 40-character commit",
  );
  assert.equal(typeof value.branch, "string");
  assert(
    value.branch &&
      !/[\x00-\x20~^:?*\[\\]/.test(value.branch) &&
      !value.branch.includes("..") &&
      !value.branch.includes("@{") &&
      !value.branch.startsWith("/") &&
      !value.branch.endsWith("/") &&
      !value.branch.endsWith(".") &&
      !value.branch.includes("//"),
    "Invalid expected branch",
  );
  for (const key of ["version", "pairedCliVersion"]) {
    assert.equal(typeof value[key], "string");
    assert.match(
      value[key],
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      `Invalid ${key}`,
    );
  }
  repositoryPath(value.output, "docs/research/ide/evidence/", "output");
  assert.equal(
    path.posix.basename(value.output),
    `vscode-${value.version}-candidate-gates-${value.commit.slice(0, 10)}.json`,
    "Output must bind version and commit",
  );
  exactKeys(value.runs, ["cliCi", "cliStrictSandbox", "ideExtensions"], "runs");
  for (const id of Object.values(value.runs))
    assert(Number.isSafeInteger(id) && id > 0, "Invalid run ID");
  assert.equal(
    new Set(Object.values(value.runs)).size,
    3,
    "Run IDs must be distinct",
  );
  exactKeys(
    value.candidate,
    ["directory", "artifactId", "bytes", "sha256"],
    "candidate",
  );
  repositoryPath(
    value.candidate.directory,
    ".work/gap-validation/",
    "candidate directory",
  );
  assert(
    Number.isSafeInteger(value.candidate.artifactId) &&
      value.candidate.artifactId > 0,
    "Invalid candidate artifact ID",
  );
  assert(
    Number.isSafeInteger(value.candidate.bytes) &&
      value.candidate.bytes > 0 &&
      value.candidate.bytes <= 128 * 1024 * 1024,
    "Invalid candidate byte count",
  );
  assert.equal(typeof value.candidate.sha256, "string");
  assert.match(
    value.candidate.sha256,
    /^[0-9a-f]{64}$/,
    "Invalid candidate SHA-256",
  );
  return structuredClone(value);
}
let CONFIG = normalizeConfig(DEFAULT_CONFIG);
let SHA = CONFIG.commit;
let OUTPUT = CONFIG.output;
const PM = "Test-only PM exploration recovery three-OS aggregate";
const CLI_SKIP = "dry-run-publish";
const IDE_SKIP = "JetBrains Marketplace (post-publish verification)";
const OS = ["ubuntu-latest", "windows-latest", "macos-latest"];
const CLI_NAMES = [
  ...OS.flatMap((os) =>
    ["unit", "integration", "e2e"].flatMap((suite) => {
      const total =
        suite === "unit"
          ? os === "windows-latest"
            ? 16
            : 4
          : suite === "integration"
            ? 8
            : 4;
      return Array.from(
        { length: total },
        (_, index) =>
          `test-${os.split("-")[0]} / ${suite} (${os}, shard ${index + 1}/${total})`,
      );
    }),
  ),
  ...["x64", "arm64"].map(
    (arch) => `linux-subreaper / Linux packaged subreaper (${arch})`,
  ),
  ...OS.map((os) => `verify-cli (${os})`),
  PM,
  "pack-linux-dryrun",
  CLI_SKIP,
];
const GATE_DEFINITIONS = [
  { key: "cliCi", name: "CLI CI", workflow: "cli-ci.yml", names: CLI_NAMES },
  {
    key: "cliStrictSandbox",
    name: "CLI Strict Sandbox",
    workflow: "cli-strict-sandbox.yml",
    names: [
      "macOS latest native capability",
      ...["ubuntu-24.04", "ubuntu-24.04-arm", "macos-15", "windows-latest"].map(
        (os) => `strict native boundary (${os})`,
      ),
    ],
  },
  {
    key: "ideExtensions",
    name: "IDE Extensions",
    workflow: "ide-extensions.yml",
    names: [
      "Public IDE capability manifest (drift gate)",
      "VS Code extension (immutable candidate)",
      ...["linux", "windows", "macos"].map((os) => `Browser evidence (${os})`),
      ...OS.flatMap((os) =>
        ["2024.2", "2025.2"].map(
          (version) => `JetBrains real host (${os}, ${version})`,
        ),
      ),
      "VS Code Remote-SSH container (scoped trusted cell)",
      "VS Code extension (Windows host gate)",
      "VS Code extension (macOS host gate)",
      "Browser evidence (three-OS required aggregate)",
      "IDE roadmap evidence (trusted scoped aggregate)",
      "VS Code extension (Linux host gate + publish)",
      "JetBrains plugin (build + publish)",
      IDE_SKIP,
    ],
  },
];
let GATES = GATE_DEFINITIONS.map((gate) => ({
  ...gate,
  id: CONFIG.runs[gate.key],
}));
function configure(value) {
  CONFIG = normalizeConfig(value);
  SHA = CONFIG.commit;
  OUTPUT = CONFIG.output;
  GATES = GATE_DEFINITIONS.map((gate) => ({
    ...gate,
    id: CONFIG.runs[gate.key],
  }));
}
assert.deepEqual(
  GATES.map((gate) => gate.names.length),
  [68, 5, 19],
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
function command(program, args, maxBuffer = 16 * 1024 * 1024) {
  try {
    return execFileSync(program, args, {
      cwd: ROOT,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    // Do not echo transport stderr or signed download URLs into a receipt.
    throw new Error(
      `Read-only ${program} command failed (status ${cause.status ?? "unknown"})`,
      { cause },
    );
  }
}
function save(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  return { file: relative(file), bytes: bytes.length, sha256: hash(bytes) };
}
function api(endpoint, file) {
  const bytes = command("gh", ["api", `repos/${REPO}/${endpoint}`]);
  return { value: JSON.parse(bytes.toString("utf8")), raw: save(file, bytes) };
}
function paged(endpoint, field, prefix) {
  const entries = [],
    pages = [];
  let expected = null;
  for (let page = 1; page <= 100; page++) {
    const result = api(
      `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      `${prefix}-page-${page}.json`,
    );
    const payload = result.value;
    assert(
      Number.isSafeInteger(payload.total_count) && payload.total_count >= 0,
      "Invalid pagination total",
    );
    assert(Array.isArray(payload[field]), `Missing ${field} collection`);
    expected ??= payload.total_count;
    assert.equal(
      payload.total_count,
      expected,
      "Collection changed during pagination",
    );
    assert(payload[field].length <= 100, "Oversized API page");
    entries.push(...payload[field]);
    pages.push(result.raw);
    assert(entries.length <= expected, "Pagination exceeds total_count");
    if (entries.length === expected) {
      assert.equal(
        new Set(entries.map((entry) => entry.id)).size,
        entries.length,
        "Duplicate API IDs",
      );
      return { entries, pages };
    }
    assert.equal(payload[field].length, 100, "Truncated API collection");
  }
  throw new Error("API collection exceeds bounded pagination");
}
function assertRun(
  run,
  gate,
  { attempt = run.run_attempt, successful = true } = {},
) {
  assert.equal(run.id, gate.id, "Wrong run ID");
  assert.equal(run.name, gate.name, "Wrong workflow name");
  assert.equal(run.head_sha, SHA, "Wrong run SHA");
  assert.equal(run.head_branch, CONFIG.branch, "Wrong run branch");
  assert.equal(
    run.path,
    `.github/workflows/${gate.workflow}`,
    "Wrong workflow path",
  );
  assert.equal(run.repository?.full_name, REPO, "Wrong repository");
  assert.equal(run.run_attempt, attempt, "Wrong attempt");
  assert(
    Number.isSafeInteger(attempt) && attempt >= 1 && attempt <= 100,
    "Invalid attempt",
  );
  assert.equal(run.status, "completed", `${gate.name} is not complete`);
  if (successful)
    assert.equal(run.conclusion, "success", `${gate.name} is not successful`);
}
function assertStableRun(before, after, gate) {
  assertRun(after, gate, { attempt: before.run_attempt });
  for (const key of [
    "id",
    "head_sha",
    "run_attempt",
    "status",
    "conclusion",
    "updated_at",
    "event",
    "head_branch",
  ])
    assert.equal(
      after[key],
      before[key],
      `Run changed during collection: ${key}`,
    );
}
function section(source, key) {
  const start = source.indexOf(`\n  ${key}:\n`);
  assert(start >= 0, `Missing workflow section ${key}`);
  const rest = source.slice(start + 1);
  const next = rest.slice(1).search(/^  [a-z][a-z0-9-]*:/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function conditionalSkip(gate, run, job, source, sourceProof) {
  if (job.conclusion !== "skipped") return null;
  if (
    gate.name === "CLI CI" &&
    job.name === CLI_SKIP &&
    run.event === "workflow_dispatch"
  ) {
    assert.match(
      section(source, "dry-run-publish"),
      /^    if: github\.event_name == 'pull_request'$/m,
    );
    return {
      job: job.name,
      condition: "github.event_name == 'pull_request'",
      event: run.event,
      reason: "PR-only publish dry-run is inapplicable to workflow_dispatch.",
      workflowSource: sourceProof,
    };
  }
  if (
    gate.name === "IDE Extensions" &&
    job.name === IDE_SKIP &&
    ["workflow_dispatch", "pull_request"].includes(run.event)
  ) {
    const condition = section(source, "jetbrains-marketplace-verify").match(
      /^    if: >-\n((?:      .*(?:\n|$))+)/m,
    );
    assert(condition, "Missing JetBrains post-publish condition");
    assert.equal(
      condition[1].trim(),
      "github.event_name == 'push' &&\n      startsWith(github.ref, 'refs/tags/ide-jetbrains-v')",
      "JetBrains post-publish condition changed",
    );
    return {
      job: job.name,
      condition:
        "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/ide-jetbrains-v')",
      event: run.event,
      reason:
        "JetBrains post-publish readback requires a JetBrains release-tag push.",
      workflowSource: sourceProof,
    };
  }
  throw new Error(`Unapproved skipped job: ${gate.name}/${job.name}`);
}
function selectMatrix(gate, run, attempts, source, sourceProof) {
  const expected = new Set(gate.names),
    latest = new Map(),
    placeholders = [];
  assert.equal(
    expected.size,
    gate.names.length,
    "Duplicate expected matrix job",
  );
  for (const { attempt, jobs } of attempts) {
    const seen = new Set();
    for (const job of jobs) {
      assert.equal(job.run_id, run.id, "Wrong job run");
      assert.equal(job.head_sha, SHA, "Wrong job SHA");
      assert.equal(job.run_attempt, attempt, "Wrong job attempt");
      assert(
        !seen.has(job.name),
        `Ambiguous job in attempt ${attempt}: ${job.name}`,
      );
      seen.add(job.name);
      if (!expected.has(job.name)) {
        assert(
          gate.name === "CLI CI" &&
            job.name === "verify-cli" &&
            job.status === "completed" &&
            job.conclusion === "skipped",
          `Unexpected job: ${job.name}`,
        );
        placeholders.push(job);
        continue;
      }
      const prior = latest.get(job.name);
      assert(
        !prior || prior.run_attempt < attempt,
        "Attempts are not ordered and unique",
      );
      latest.set(job.name, job);
    }
  }
  assert.equal(
    latest.size,
    expected.size,
    `${gate.name}: incomplete expanded matrix`,
  );
  const skips = [];
  const jobs = gate.names.map((name) => {
    const job = latest.get(name);
    assert(job, `Missing expected job: ${name}`);
    assert.equal(job.status, "completed", `Incomplete latest job: ${name}`);
    if (job.conclusion !== "success") {
      const skip = conditionalSkip(gate, run, job, source, sourceProof);
      assert(skip, `Unsuccessful latest job: ${name}=${job.conclusion}`);
      skips.push(skip);
    }
    return job;
  });
  for (const placeholder of placeholders)
    for (const os of OS) {
      const replacement = latest.get(`verify-cli (${os})`);
      assert(
        replacement?.conclusion === "success" &&
          replacement.run_attempt > placeholder.run_attempt,
        "Skipped verify-cli was not superseded by all three successful expanded jobs",
      );
    }
  return {
    jobs,
    skips,
    historicalPlaceholders: placeholders.map((job) => ({
      id: job.id,
      name: job.name,
      attempt: job.run_attempt,
      conclusion: job.conclusion,
    })),
  };
}
function gitSource(file, stagingRoot) {
  const bytes = command("git", ["show", `${SHA}:${file}`]);
  const oid = command("git", ["rev-parse", `${SHA}:${file}`])
    .toString("utf8")
    .trim();
  return {
    bytes,
    proof: {
      commit: SHA,
      source: file,
      gitBlob: oid,
      ...save(path.join(stagingRoot, file), bytes),
    },
  };
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Known single-report artifact: bounded decode, no arbitrary filesystem extraction.
function singleJsonFromZip(zip, filename) {
  assert(zip.length >= 22 && zip.length <= 8 * 1024 * 1024, "Invalid ZIP size");
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--)
    if (
      zip.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + zip.readUInt16LE(i + 20) === zip.length
    ) {
      eocd = i;
      break;
    }
  assert(eocd >= 0, "Missing ZIP end record");
  assert.equal(zip.readUInt32LE(eocd + 4), 0, "Multi-disk ZIP refused");
  assert.equal(zip.readUInt16LE(eocd + 8), 1, "Expected one ZIP entry");
  assert.equal(
    zip.readUInt16LE(eocd + 10),
    1,
    "Expected exactly one ZIP entry",
  );
  const cd = zip.readUInt32LE(eocd + 16);
  assert(cd + 46 <= eocd, "Invalid central directory");
  assert.equal(
    cd + zip.readUInt32LE(eocd + 12),
    eocd,
    "Invalid central extent",
  );
  assert.equal(zip.readUInt32LE(cd), 0x02014b50, "Invalid central signature");
  const flags = zip.readUInt16LE(cd + 8),
    method = zip.readUInt16LE(cd + 10);
  const crc = zip.readUInt32LE(cd + 16),
    compressedSize = zip.readUInt32LE(cd + 20),
    size = zip.readUInt32LE(cd + 24);
  const nameLength = zip.readUInt16LE(cd + 28),
    extraLength = zip.readUInt16LE(cd + 30),
    commentLength = zip.readUInt16LE(cd + 32);
  const local = zip.readUInt32LE(cd + 42);
  assert.equal(
    cd + 46 + nameLength + extraLength + commentLength,
    eocd,
    "Unexpected central data",
  );
  assert.equal(zip.readUInt16LE(cd + 34), 0, "Wrong ZIP entry disk");
  assert.equal(flags & ~0x080e, 0, "Unsupported ZIP flags");
  assert(method === 0 || method === 8, "Unsupported ZIP compression");
  if (method === 0)
    assert.equal(flags & 6, 0, "Deflate flags on stored ZIP entry");
  assert(size > 0 && size <= 4 * 1024 * 1024, "Unbounded report size");
  assert.equal(
    zip.toString("utf8", cd + 46, cd + 46 + nameLength),
    filename,
    "Unexpected ZIP entry name",
  );
  const fileType = (zip.readUInt32LE(cd + 38) >>> 16) & 0o170000;
  assert(fileType === 0 || fileType === 0o100000, "Non-regular ZIP entry");
  assert.equal(local, 0, "Unexpected ZIP prefix");
  assert.equal(zip.readUInt32LE(local), 0x04034b50, "Invalid local signature");
  assert.equal(zip.readUInt16LE(local + 6), flags, "Local flags mismatch");
  assert.equal(zip.readUInt16LE(local + 8), method, "Local method mismatch");
  if (!(flags & 8)) {
    assert.equal(zip.readUInt32LE(local + 14), crc, "Local CRC mismatch");
    assert.equal(
      zip.readUInt32LE(local + 18),
      compressedSize,
      "Local compressed size mismatch",
    );
    assert.equal(
      zip.readUInt32LE(local + 22),
      size,
      "Local expanded size mismatch",
    );
  }
  const localNameLength = zip.readUInt16LE(local + 26);
  const start = local + 30 + localNameLength + zip.readUInt16LE(local + 28);
  assert.equal(
    zip.toString("utf8", local + 30, local + 30 + localNameLength),
    filename,
    "Local name mismatch",
  );
  assert(
    start + compressedSize <= cd,
    "Compressed data overlaps central directory",
  );
  const compressed = zip.subarray(start, start + compressedSize);
  const bytes =
    method === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: 4 * 1024 * 1024 });
  assert.equal(bytes.length, size, "Report size mismatch");
  assert.equal(crc32(bytes), crc, "Report CRC mismatch");
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return bytes;
}
function assertPmJobs(workflow) {
  return [...OS.map((os) => `verify-cli (${os})`), PM].map((name) => {
    const job = workflow.jobs.find((entry) => entry.name === name);
    assert(
      job && job.conclusion === "success" && job.status === "completed",
      `Missing successful PM job: ${name}`,
    );
    assert.equal(
      job.run_attempt,
      workflow.run.run_attempt,
      `PM must use final attempt: ${name}`,
    );
    return {
      id: job.id,
      name,
      attempt: job.run_attempt,
      url: job.html_url,
      startedAt: job.started_at,
      completedAt: job.completed_at,
    };
  });
}
function candidateFilesFromZip(zip) {
  assert(
    zip.length >= 22 && zip.length <= 128 * 1024 * 1024,
    "Invalid candidate ZIP size",
  );
  let end = -1;
  for (let p = zip.length - 22; p >= Math.max(0, zip.length - 65557); p--) {
    if (
      zip.readUInt32LE(p) === 0x06054b50 &&
      p + 22 + zip.readUInt16LE(p + 20) === zip.length
    ) {
      end = p;
      break;
    }
  }
  assert(end >= 0, "Missing candidate ZIP end");
  assert.equal(zip.readUInt32LE(end + 4), 0, "Multi-disk candidate ZIP");
  assert.equal(
    zip.readUInt16LE(end + 8),
    2,
    "Candidate ZIP must contain exactly two files",
  );
  assert.equal(
    zip.readUInt16LE(end + 10),
    2,
    "Candidate ZIP must contain exactly two files",
  );
  const centralStart = zip.readUInt32LE(end + 16);
  assert.equal(
    centralStart + zip.readUInt32LE(end + 12),
    end,
    "Invalid candidate central extent",
  );
  let offset = centralStart;
  const files = new Map();
  for (let index = 0; index < 2; index++) {
    assert(
      offset + 46 <= end && zip.readUInt32LE(offset) === 0x02014b50,
      "Invalid candidate central entry",
    );
    const flags = zip.readUInt16LE(offset + 8),
      method = zip.readUInt16LE(offset + 10);
    assert.equal(flags & ~0x080e, 0, "Unsupported candidate ZIP flags");
    assert(method === 0 || method === 8, "Unsupported candidate compression");
    const checksum = zip.readUInt32LE(offset + 16),
      compressed = zip.readUInt32LE(offset + 20),
      size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28),
      extraLength = zip.readUInt16LE(offset + 30),
      commentLength = zip.readUInt16LE(offset + 32);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    assert(
      ["manifest.json", "chainlesschain-ide.vsix"].includes(name) &&
        !files.has(name),
      "Unexpected candidate ZIP member",
    );
    const maximum = name === "manifest.json" ? 64 * 1024 : 128 * 1024 * 1024;
    assert(size > 0 && size <= maximum, "Unbounded candidate ZIP member");
    assert.equal(
      zip.readUInt16LE(offset + 34),
      0,
      "Wrong candidate entry disk",
    );
    const type = (zip.readUInt32LE(offset + 38) >>> 16) & 0o170000;
    assert(type === 0 || type === 0o100000, "Non-regular candidate ZIP entry");
    const local = zip.readUInt32LE(offset + 42);
    assert(
      local + 30 <= centralStart && zip.readUInt32LE(local) === 0x04034b50,
      "Invalid candidate local entry",
    );
    assert.equal(
      zip.readUInt16LE(local + 6),
      flags,
      "Candidate local flags mismatch",
    );
    assert.equal(
      zip.readUInt16LE(local + 8),
      method,
      "Candidate local compression mismatch",
    );
    const localNameLength = zip.readUInt16LE(local + 26);
    assert.equal(
      zip.toString("utf8", local + 30, local + 30 + localNameLength),
      name,
      "Candidate local name mismatch",
    );
    const start = local + 30 + localNameLength + zip.readUInt16LE(local + 28);
    assert(
      start + compressed <= centralStart,
      "Candidate ZIP member overlaps central directory",
    );
    if (!(flags & 8)) {
      assert.equal(
        zip.readUInt32LE(local + 14),
        checksum,
        "Candidate local CRC mismatch",
      );
      assert.equal(
        zip.readUInt32LE(local + 18),
        compressed,
        "Candidate local compressed size mismatch",
      );
      assert.equal(
        zip.readUInt32LE(local + 22),
        size,
        "Candidate local size mismatch",
      );
    }
    const packed = zip.subarray(start, start + compressed);
    const bytes =
      method === 0
        ? Buffer.from(packed)
        : inflateRawSync(packed, { maxOutputLength: maximum });
    assert.equal(bytes.length, size, "Candidate ZIP member size mismatch");
    assert.equal(crc32(bytes), checksum, "Candidate ZIP member CRC mismatch");
    files.set(name, bytes);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, end, "Unexpected candidate central data");
  return files;
}
async function collectPm(workflow, archiveRoot, sourceRoot) {
  const jobs = assertPmJobs(workflow),
    attempt = workflow.run.run_attempt;
  const artifacts = paged(
    `actions/runs/${workflow.run.id}/artifacts`,
    "artifacts",
    path.join(archiveRoot, "pm-artifacts"),
  );
  const definitions = [
    ...[
      ["ubuntu-latest", "Linux"],
      ["windows-latest", "Windows"],
      ["macos-latest", "macOS"],
    ].map(([os, label]) => ({
      name: `pm-exploration-recovery-${os}-${SHA}-${attempt}`,
      filename: `pm-exploration-recovery-${label}.json`,
      producer: `verify-cli (${os})`,
      aggregate: false,
    })),
    {
      name: `pm-exploration-recovery-test-only-aggregate-${SHA}-${attempt}`,
      filename: "pm-exploration-recovery-aggregate.json",
      producer: PM,
      aggregate: true,
    },
  ];
  const downloaded = [];
  for (const definition of definitions) {
    const matches = artifacts.entries.filter(
      (artifact) => artifact.name === definition.name,
    );
    assert.equal(
      matches.length,
      1,
      `Expected one exact-attempt artifact: ${definition.name}`,
    );
    const metadata = matches[0];
    assert.equal(metadata.expired, false, "PM artifact expired");
    assert.equal(
      metadata.workflow_run?.id,
      workflow.run.id,
      "Wrong artifact run",
    );
    assert.equal(metadata.workflow_run?.head_sha, SHA, "Wrong artifact commit");
    assert.match(
      metadata.digest,
      /^sha256:[0-9a-f]{64}$/,
      "Missing artifact SHA-256",
    );
    const producer = jobs.find((job) => job.name === definition.producer);
    const createdAt = Date.parse(metadata.created_at);
    assert(
      Number.isFinite(createdAt) &&
        createdAt >= Date.parse(producer.startedAt) &&
        createdAt <= Date.parse(producer.completedAt),
      "Artifact was not created during its final-attempt producer",
    );
    const zip = command(
      "gh",
      ["api", `repos/${REPO}/actions/artifacts/${metadata.id}/zip`],
      8 * 1024 * 1024,
    );
    assert.equal(
      zip.length,
      metadata.size_in_bytes,
      "Artifact ZIP size differs from metadata",
    );
    assert.equal(
      `sha256:${hash(zip)}`,
      metadata.digest,
      "Artifact ZIP digest differs from metadata",
    );
    const zipProof = save(
      path.join(archiveRoot, "pm-zips", `${metadata.id}.zip`),
      zip,
    );
    const bytes = singleJsonFromZip(zip, definition.filename);
    const reportProof = save(
      path.join(
        archiveRoot,
        definition.aggregate ? "pm-hosted-aggregate" : "pm-producers",
        definition.filename,
      ),
      bytes,
    );
    downloaded.push({
      artifact: {
        id: metadata.id,
        name: metadata.name,
        digest: metadata.digest,
        sizeInBytes: metadata.size_in_bytes,
        createdAt: metadata.created_at,
        workflowRun: metadata.workflow_run,
      },
      producer,
      zip: zipProof,
      report: reportProof,
      data: JSON.parse(bytes.toString("utf8")),
      aggregate: definition.aggregate,
    });
  }
  const verifierPath = "packages/cli/scripts/pm-exploration-recovery-drill.mjs";
  // The helper imports only Node builtins. Verification does not execute its
  // process fixture; materialize exactly this static import closure from Git.
  const sourceProofs = [
    verifierPath,
    "packages/cli/__tests__/helpers/pm-exploration-recovery-process.js",
    "packages/cli/package.json",
  ].map((file) => gitSource(file, sourceRoot).proof);
  const verifier = await import(
    pathToFileURL(path.join(sourceRoot, verifierPath)).href
  );
  const hosted = downloaded.find((item) => item.aggregate).data;
  const independentlyVerifiedAt = new Date().toISOString();
  const recomputed = verifier.verifyPmExplorationRecoveryEvidenceDirectory({
    evidenceDir: path.join(archiveRoot, "pm-producers"),
    releaseCommit: SHA,
    now: () => hosted.verifiedAt,
  });
  assert.deepEqual(
    recomputed,
    hosted,
    "Hosted aggregate differs from exact-commit verification of downloaded producer bytes",
  );
  const independentProof = save(
    path.join(archiveRoot, "pm-independent-verification.json"),
    jsonBytes({ independentlyVerifiedAt, sourceProofs, recomputed }),
  );
  return {
    attempt,
    jobs,
    artifactApiPages: artifacts.pages,
    sourceProofs,
    independentlyVerifiedAt,
    independentProof,
    artifacts: downloaded,
    result: "passed",
    timestampComparison:
      "Hosted verifiedAt is reused only for structural equality; independentlyVerifiedAt records this audit.",
    scope:
      "Original exact-commit synthetic test-authority verifier; no production or physical-power-loss claim.",
  };
}
function jobSummary(job) {
  return {
    id: job.id,
    name: job.name,
    attempt: job.run_attempt,
    commit: job.head_sha,
    status: job.status,
    conclusion: job.conclusion,
    url: job.html_url,
  };
}
function validateCandidate(manifest, artifact, config = CONFIG) {
  assert.equal(manifest.schema, 1, "Wrong candidate manifest schema");
  assert.equal(
    manifest.artifact,
    "chainlesschain-ide.vsix",
    "Wrong candidate filename",
  );
  assert.equal(
    manifest.package,
    "chainlesschain-ide",
    "Wrong candidate package",
  );
  assert.equal(
    manifest.publisher,
    "chainlesschain",
    "Wrong candidate publisher",
  );
  assert.equal(manifest.commit, config.commit, "Wrong candidate commit");
  assert.equal(manifest.version, config.version, "Wrong candidate version");
  assert.deepEqual(
    manifest.vsixmanifestIdentity,
    {
      id: "chainlesschain-ide",
      publisher: "chainlesschain",
      version: config.version,
    },
    "Wrong VSIX manifest identity",
  );
  assert.equal(
    manifest.sha256,
    hash(artifact),
    "Candidate manifest digest mismatch",
  );
  assert.equal(
    manifest.bytes,
    artifact.length,
    "Candidate manifest size mismatch",
  );
  assert.equal(
    config.candidate.sha256,
    hash(artifact),
    "Candidate differs from independently pinned digest",
  );
  assert.equal(
    config.candidate.bytes,
    artifact.length,
    "Candidate differs from independently pinned size",
  );
  assert.equal(
    manifest.workflowRun,
    `https://github.com/${REPO}/actions/runs/${config.runs.ideExtensions}`,
    "Wrong candidate workflow run",
  );
}
function confinedPath(file) {
  const root = fs.realpathSync(ROOT);
  let ancestor = file;
  while (!fs.existsSync(ancestor)) {
    const next = path.dirname(ancestor);
    assert.notEqual(next, ancestor, "No existing confined ancestor");
    ancestor = next;
  }
  const real = fs.realpathSync(ancestor);
  assert(
    real === root || real.startsWith(`${root}${path.sep}`),
    "Configured path follows a link outside repository",
  );
  return file;
}
async function record() {
  const output = confinedPath(path.join(ROOT, OUTPUT));
  assert(
    !fs.existsSync(output),
    "Final receipt already exists; refusing to replace it",
  );
  const archiveRoot = fs.mkdtempSync(
    path.join(
      ROOT,
      `.work/gap-validation/candidate-gates-${SHA.slice(0, 10)}-attempts-`,
    ),
  );
  const configProof = save(
    path.join(archiveRoot, "config.json"),
    jsonBytes(CONFIG),
  );
  const sourceRoot = path.join(archiveRoot, "exact-source");
  const workflows = [],
    sourceProofs = [];
  for (const gate of GATES) {
    const directory = path.join(archiveRoot, String(gate.id));
    const before = api(
      `actions/runs/${gate.id}`,
      path.join(directory, "run-before.json"),
    );
    assertRun(before.value, gate);
    const workflowSource = gitSource(
      `.github/workflows/${gate.workflow}`,
      sourceRoot,
    );
    sourceProofs.push(workflowSource.proof);
    const attempts = [];
    for (let attempt = 1; attempt <= before.value.run_attempt; attempt++) {
      const prefix = path.join(directory, `attempt-${attempt}`);
      const run = api(
        `actions/runs/${gate.id}/attempts/${attempt}`,
        `${prefix}-run.json`,
      );
      assertRun(run.value, gate, {
        attempt,
        successful: attempt === before.value.run_attempt,
      });
      const jobs = paged(
        `actions/runs/${gate.id}/attempts/${attempt}/jobs`,
        "jobs",
        `${prefix}-jobs`,
      );
      attempts.push({
        attempt,
        conclusion: run.value.conclusion,
        run: run.raw,
        pages: jobs.pages,
        jobs: jobs.entries,
      });
    }
    const matrix = selectMatrix(
      gate,
      before.value,
      attempts,
      workflowSource.bytes.toString("utf8").replaceAll("\r\n", "\n"),
      workflowSource.proof,
    );
    workflows.push({
      gate,
      run: before.value,
      before: before.raw,
      attempts,
      ...matrix,
    });
  }
  for (const file of [
    ".github/workflows/_cli-test.yml",
    ".github/workflows/_cli-linux-subreaper.yml",
  ])
    sourceProofs.push(gitSource(file, sourceRoot).proof);
  const pm = await collectPm(workflows[0], archiveRoot, sourceRoot);
  const candidateRoot = confinedPath(
    path.join(ROOT, CONFIG.candidate.directory),
  );
  const manifestBytes = fs.readFileSync(
    confinedPath(path.join(candidateRoot, "manifest.json")),
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const artifact = fs.readFileSync(
    confinedPath(path.join(candidateRoot, "chainlesschain-ide.vsix")),
  );
  validateCandidate(manifest, artifact);
  const candidateMetadata = api(
    `actions/artifacts/${CONFIG.candidate.artifactId}`,
    path.join(archiveRoot, "candidate-artifact-metadata.json"),
  );
  assert.equal(
    candidateMetadata.value.id,
    CONFIG.candidate.artifactId,
    "Wrong candidate artifact ID",
  );
  assert.equal(
    candidateMetadata.value.workflow_run?.id,
    CONFIG.runs.ideExtensions,
    "Candidate artifact belongs to another run",
  );
  assert.equal(
    candidateMetadata.value.workflow_run?.head_sha,
    SHA,
    "Candidate artifact belongs to another commit",
  );
  assert.equal(
    candidateMetadata.value.expired,
    false,
    "Candidate artifact expired",
  );
  assert.equal(
    candidateMetadata.value.name,
    "chainlesschain-ide-vscode-candidate",
    "Wrong immutable candidate artifact name",
  );
  const candidateProducer = workflows[2].jobs.find(
    (job) => job.name === "VS Code extension (immutable candidate)",
  );
  const candidateCreated = Date.parse(candidateMetadata.value.created_at);
  assert(
    Number.isFinite(candidateCreated) &&
      candidateCreated >= Date.parse(candidateProducer.started_at) &&
      candidateCreated <= Date.parse(candidateProducer.completed_at),
    "Candidate ZIP is not from the selected latest successful producer",
  );
  assert.match(
    candidateMetadata.value.digest,
    /^sha256:[0-9a-f]{64}$/,
    "Missing candidate ZIP digest",
  );
  const candidateZip = command(
    "gh",
    [
      "api",
      `repos/${REPO}/actions/artifacts/${CONFIG.candidate.artifactId}/zip`,
    ],
    128 * 1024 * 1024,
  );
  assert.equal(
    candidateZip.length,
    candidateMetadata.value.size_in_bytes,
    "Candidate ZIP metadata size mismatch",
  );
  assert.equal(
    `sha256:${hash(candidateZip)}`,
    candidateMetadata.value.digest,
    "Candidate ZIP metadata digest mismatch",
  );
  const candidateZipFiles = candidateFilesFromZip(candidateZip);
  assert.deepEqual(
    candidateZipFiles.get("manifest.json"),
    manifestBytes,
    "Local manifest differs from the exact-run immutable artifact",
  );
  assert.deepEqual(
    candidateZipFiles.get("chainlesschain-ide.vsix"),
    artifact,
    "Local VSIX differs from the exact-run immutable artifact",
  );
  const candidateZipProof = save(
    path.join(archiveRoot, "candidate-immutable.zip"),
    candidateZip,
  );
  for (const workflow of workflows) {
    const after = api(
      `actions/runs/${workflow.run.id}`,
      path.join(archiveRoot, String(workflow.run.id), "run-after.json"),
    );
    assertStableRun(workflow.run, after.value, workflow.gate);
    workflow.after = after.raw;
  }
  const receipt = {
    schema: "chainlesschain.ide-candidate-gates-readback/v3",
    recordedAt: new Date().toISOString(),
    commit: SHA,
    branch: CONFIG.branch,
    intendedTag: `ide-vscode-v${CONFIG.version}`,
    version: CONFIG.version,
    pairedCliVersion: CONFIG.pairedCliVersion,
    configuration: { value: CONFIG, proof: configProof },
    archiveDirectory: relative(archiveRoot),
    sourceProofs,
    workflows: workflows.map(
      ({
        gate,
        run,
        before,
        after,
        attempts,
        jobs,
        skips,
        historicalPlaceholders,
      }) => ({
        id: run.id,
        url: run.html_url,
        name: gate.name,
        commit: run.head_sha,
        event: run.event,
        branch: run.head_branch,
        attempt: run.run_attempt,
        status: run.status,
        conclusion: run.conclusion,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        expectedExpandedJobs: gate.names.length,
        successfulJobs: jobs.filter((job) => job.conclusion === "success")
          .length,
        rawBefore: before,
        rawAfter: after,
        conditionalSkips: skips,
        historicalPlaceholders,
        attempts: attempts.map((item) => ({
          attempt: item.attempt,
          conclusion: item.conclusion,
          jobs: item.jobs.length,
          rawRun: item.run,
          rawJobPages: item.pages,
        })),
        selection:
          "Latest execution of every exact expected matrix job across all attempt inventories; no fallback from latest non-success.",
        jobs: jobs.map(jobSummary),
      }),
    ),
    pmExplorationRecovery: pm,
    candidate: {
      artifactBytes: artifact.length,
      artifactSha256: hash(artifact),
      manifestSha256: hash(manifestBytes),
      artifactId: CONFIG.candidate.artifactId,
      producer: jobSummary(candidateProducer),
      metadata: candidateMetadata.raw,
      immutableZip: candidateZipProof,
      manifest,
    },
    limitations: [
      "Candidate gates and downloaded bytes are verified; publication and registry readback remain separate.",
      "Raw API pages and artifact ZIP/report bytes are retained in the identified local audit directory; producer JSON is also included in this receipt.",
      "Hosted fixture journeys do not close real-provider, accessibility listening, hardware/SLO or long-term production acceptance.",
      "PM recovery retains the original synthetic test-authority scope and grants no production authority.",
    ],
  };
  const bytes = jsonBytes(receipt);
  save(path.join(archiveRoot, "receipt.json"), bytes);
  save(output, bytes);
  console.log(
    JSON.stringify({
      output: OUTPUT,
      archiveDirectory: relative(archiveRoot),
      commit: SHA,
      sha256: hash(bytes),
      workflows: receipt.workflows.map((run) => ({
        name: run.name,
        attempt: run.attempt,
        successfulJobs: run.successfulJobs,
        conditionalSkips: run.conditionalSkips.length,
      })),
    }),
  );
}
function selfTest() {
  let newChecks = 0;
  const check = (operation) => {
    try {
      operation();
    } catch (cause) {
      throw new Error(
        `Offline additional check ${newChecks + 1}: ${cause.message}`,
        { cause },
      );
    }
    newChecks++;
  };
  check(() =>
    assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), DEFAULT_CONFIG),
  );
  for (const mutate of [
    (value) => {
      value.schema = 2;
    },
    (value) => {
      value.commit = "96cbf6ba56";
    },
    (value) => {
      value.commit = "A".repeat(40);
    },
    (value) => {
      value.runs.cliCi = "37054207987";
    },
    (value) => {
      value.runs.cliCi = 0;
    },
    (value) => {
      value.runs.cliCi = value.runs.ideExtensions;
    },
    (value) => {
      value.runs.native = 123;
    },
    (value) => {
      value.matrix = ["one-job"];
    },
    (value) => {
      value.runs.names = [];
    },
    (value) => {
      value.candidate.artifactId = -1;
    },
    (value) => {
      value.candidate.bytes = 0;
    },
    (value) => {
      value.candidate.sha256 = "bad";
    },
    (value) => {
      value.candidate.directory = ".work/gap-validation/../../outside";
    },
    (value) => {
      value.candidate.directory = "C:/outside";
    },
    (value) => {
      value.output = "../receipt.json";
    },
    (value) => {
      value.output = "docs/research/ide/evidence/unbound.json";
    },
    (value) => {
      value.branch = "release/../wrong";
    },
    (value) => {
      value.version = "*";
    },
    (value) => {
      delete value.pairedCliVersion;
    },
    (value) => {
      value.skipFailures = true;
    },
  ]) {
    const invalid = structuredClone(DEFAULT_CONFIG);
    mutate(invalid);
    check(() => assert.throws(() => normalizeConfig(invalid)));
  }
  const alternate = structuredClone(DEFAULT_CONFIG);
  alternate.commit = "f".repeat(40);
  alternate.version = "1.2.3";
  alternate.branch = "release/ide-vscode-1.2.3";
  alternate.runs = { cliCi: 101, cliStrictSandbox: 102, ideExtensions: 103 };
  alternate.output =
    "docs/research/ide/evidence/vscode-1.2.3-candidate-gates-ffffffffff.json";
  alternate.candidate.directory = ".work/gap-validation/another-candidate";
  const saved = CONFIG;
  try {
    configure(alternate);
    check(() => assert.equal(SHA, alternate.commit));
    check(() =>
      assert.deepEqual(
        GATES.map((gate) => gate.id),
        [101, 102, 103],
      ),
    );
    check(() =>
      assert.deepEqual(
        GATES.map((gate) => gate.names.length),
        [68, 5, 19],
      ),
    );
  } finally {
    configure(saved);
  }
  const fixtureBytes = Buffer.from("offline immutable VSIX fixture");
  const candidateConfig = structuredClone(CONFIG);
  candidateConfig.candidate.bytes = fixtureBytes.length;
  candidateConfig.candidate.sha256 = hash(fixtureBytes);
  const manifest = {
    schema: 1,
    artifact: "chainlesschain-ide.vsix",
    package: "chainlesschain-ide",
    publisher: "chainlesschain",
    version: CONFIG.version,
    commit: SHA,
    sha256: hash(fixtureBytes),
    bytes: fixtureBytes.length,
    workflowRun: `https://github.com/${REPO}/actions/runs/${CONFIG.runs.ideExtensions}`,
    vsixmanifestIdentity: {
      id: "chainlesschain-ide",
      publisher: "chainlesschain",
      version: CONFIG.version,
    },
  };
  check(() => validateCandidate(manifest, fixtureBytes, candidateConfig));
  for (const mutation of [
    { commit: "0".repeat(40) },
    { version: "0.0.0" },
    { workflowRun: "https://github.com/another/run/1" },
    { sha256: "0".repeat(64) },
    { bytes: 1 },
    { publisher: "other" },
  ])
    check(() =>
      assert.throws(() =>
        validateCandidate(
          { ...manifest, ...mutation },
          fixtureBytes,
          candidateConfig,
        ),
      ),
    );
  check(() =>
    assert.throws(() =>
      validateCandidate(manifest, Buffer.from("different"), candidateConfig),
    ),
  );
  check(() =>
    assert.throws(() =>
      validateCandidate(manifest, fixtureBytes, {
        ...candidateConfig,
        candidate: { ...candidateConfig.candidate, sha256: "0".repeat(64) },
      }),
    ),
  );
  const gate = GATES[0];
  const source =
    "\n  dry-run-publish:\n    if: github.event_name == 'pull_request'\n    steps: []\n";
  const run = { id: gate.id, event: "workflow_dispatch", run_attempt: 2 };
  const jobs = gate.names.map((name, i) => ({
    id: i + 1,
    name,
    run_id: gate.id,
    head_sha: SHA,
    run_attempt: 2,
    status: "completed",
    conclusion: name === CLI_SKIP ? "skipped" : "success",
  }));
  const select = (entries) =>
    selectMatrix(gate, run, entries, source, { sha256: "test" });
  const old = {
    id: 999,
    name: "verify-cli",
    run_id: gate.id,
    head_sha: SHA,
    run_attempt: 1,
    status: "completed",
    conclusion: "skipped",
  };
  assert.equal(
    select([
      { attempt: 1, jobs: [old] },
      { attempt: 2, jobs },
    ]).jobs.length,
    68,
  );
  assert.throws(() => select([{ attempt: 2, jobs: jobs.slice(1) }]));
  assert.throws(() => select([{ attempt: 2, jobs: [...jobs, jobs[0]] }]));
  assert.throws(() =>
    select([{ attempt: 2, jobs: [...jobs, { ...jobs[0], name: "unknown" }] }]),
  );
  assert.throws(() =>
    select([
      { attempt: 1, jobs: jobs.map((job) => ({ ...job, run_attempt: 1 })) },
      {
        attempt: 2,
        jobs: jobs.map((job, i) =>
          i === 0 ? { ...job, conclusion: "failure" } : job,
        ),
      },
    ]),
  );
  assert.throws(() =>
    select([
      {
        attempt: 2,
        jobs: jobs.map((job, i) =>
          i === 0 ? { ...job, conclusion: "skipped" } : job,
        ),
      },
    ]),
  );
  assert.throws(() =>
    select([{ attempt: 2, jobs: [...jobs, { ...old, run_attempt: 2 }] }]),
  );
  assert.throws(() =>
    selectMatrix(
      gate,
      { ...run, event: "push" },
      [{ attempt: 2, jobs }],
      source,
      {},
    ),
  );
  assert.throws(() =>
    selectMatrix(
      gate,
      run,
      [{ attempt: 2, jobs }],
      source.replace("pull_request", "workflow_dispatch"),
      {},
    ),
  );
  assert.equal(assertPmJobs({ run, jobs }).length, 4);
  assert.throws(() =>
    assertPmJobs({
      run,
      jobs: jobs.map((job) =>
        job.name === PM ? { ...job, run_attempt: 1 } : job,
      ),
    }),
  );
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.throws(() => singleJsonFromZip(Buffer.alloc(22), "report.json"));
  const report = Buffer.from("{}\n"),
    filename = Buffer.from("report.json");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(filename.length, 26);
  local.writeUInt32LE(crc32(report), 14);
  local.writeUInt32LE(report.length, 18);
  local.writeUInt32LE(report.length, 22);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE(crc32(report), 16);
  central.writeUInt32LE(report.length, 20);
  central.writeUInt32LE(report.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + filename.length, 12);
  end.writeUInt32LE(30 + filename.length + report.length, 16);
  const zip = Buffer.concat([local, filename, report, central, filename, end]);
  assert.deepEqual(singleJsonFromZip(zip, "report.json"), report);
  assert.throws(() => singleJsonFromZip(zip, "../report.json"));
  const corrupt = Buffer.from(zip);
  corrupt[30 + filename.length] ^= 1;
  assert.throws(() => singleJsonFromZip(corrupt, "report.json"));
  const firstAttempt = jobs.map((job) => ({ ...job, run_attempt: 1 }));
  const partial = select([
    { attempt: 1, jobs: firstAttempt },
    {
      attempt: 2,
      jobs: jobs.filter(
        (job) => job.name.startsWith("verify-cli (") || job.name === PM,
      ),
    },
  ]);
  assert.equal(partial.jobs.length, 68);
  assert.equal(partial.jobs[0].run_attempt, 1);
  assert.equal(partial.jobs.find((job) => job.name === PM).run_attempt, 2);
  const stable = {
    ...run,
    name: gate.name,
    head_sha: SHA,
    path: `.github/workflows/${gate.workflow}`,
    repository: { full_name: REPO },
    status: "completed",
    conclusion: "success",
    updated_at: "2026-10-03T00:00:00Z",
    head_branch: CONFIG.branch,
  };
  assertStableRun(stable, { ...stable }, gate);
  for (const change of [
    { run_attempt: 3 },
    { status: "in_progress" },
    { head_sha: "0".repeat(40) },
    { updated_at: "2026-10-03T01:00:00Z" },
  ])
    assert.throws(() =>
      assertStableRun(stable, { ...stable, ...change }, gate),
    );
  for (const [candidate, jobName] of [
    [GATES[0], CLI_SKIP],
    [GATES[2], IDE_SKIP],
  ]) {
    const exact = command("git", [
      "show",
      `${SHA}:.github/workflows/${candidate.workflow}`,
    ])
      .toString("utf8")
      .replaceAll("\r\n", "\n");
    assert(
      conditionalSkip(
        candidate,
        run,
        { name: jobName, conclusion: "skipped" },
        exact,
        { commit: SHA },
      ),
    );
    if (candidate.name === "IDE Extensions") {
      check(() =>
        assert(
          conditionalSkip(
            candidate,
            { ...run, event: "pull_request" },
            { name: jobName, conclusion: "skipped" },
            exact,
            { commit: SHA },
          ),
        ),
      );
      check(() =>
        assert.throws(() =>
          conditionalSkip(
            candidate,
            { ...run, event: "push" },
            { name: jobName, conclusion: "skipped" },
            exact,
            {},
          ),
        ),
      );
      check(() =>
        assert.throws(() =>
          conditionalSkip(
            candidate,
            { ...run, event: "pull_request" },
            { name: jobName, conclusion: "skipped" },
            exact.replaceAll(
              "github.event_name == 'push'",
              "github.event_name == 'pull_request'",
            ),
            {},
          ),
        ),
      );
      check(() =>
        assert.throws(() =>
          conditionalSkip(
            candidate,
            { ...run, event: "pull_request" },
            { name: jobName, conclusion: "skipped" },
            exact.replaceAll(
              "startsWith(github.ref, 'refs/tags/ide-jetbrains-v')",
              "startsWith(github.ref, 'refs/tags/ide-jetbrains-v') || true",
            ),
            {},
          ),
        ),
      );
    }
  }
  check(() =>
    assert.throws(() =>
      conditionalSkip(
        GATES[0],
        { ...run, event: "pull_request" },
        { name: CLI_SKIP, conclusion: "skipped" },
        source,
        {},
      ),
    ),
  );
  check(() =>
    assert.throws(() =>
      assertRun({ ...stable, head_branch: "unrelated-branch" }, gate),
    ),
  );
  check(() =>
    assert.throws(() =>
      assertRun({ ...stable, head_sha: "0".repeat(40) }, gate),
    ),
  );
  const compressed = deflateRawSync(report);
  const compressedLocal = Buffer.from(local);
  compressedLocal.writeUInt16LE(8, 8);
  compressedLocal.writeUInt32LE(compressed.length, 18);
  const compressedCentral = Buffer.from(central);
  compressedCentral.writeUInt16LE(8, 10);
  compressedCentral.writeUInt32LE(compressed.length, 20);
  const compressedEnd = Buffer.from(end);
  compressedEnd.writeUInt32LE(30 + filename.length + compressed.length, 16);
  assert.deepEqual(
    singleJsonFromZip(
      Buffer.concat([
        compressedLocal,
        filename,
        compressed,
        compressedCentral,
        filename,
        compressedEnd,
      ]),
      "report.json",
    ),
    report,
  );
  function makeCandidateZip(entries) {
    let cursor = 0;
    const locals = [],
      centrals = [];
    for (const [name, bytes, method = 0] of entries) {
      const encoded = Buffer.from(name),
        packed = method === 8 ? deflateRawSync(bytes) : bytes;
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50);
      localHeader.writeUInt16LE(method, 8);
      localHeader.writeUInt32LE(crc32(bytes), 14);
      localHeader.writeUInt32LE(packed.length, 18);
      localHeader.writeUInt32LE(bytes.length, 22);
      localHeader.writeUInt16LE(encoded.length, 26);
      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50);
      centralHeader.writeUInt16LE(method, 10);
      centralHeader.writeUInt32LE(crc32(bytes), 16);
      centralHeader.writeUInt32LE(packed.length, 20);
      centralHeader.writeUInt32LE(bytes.length, 24);
      centralHeader.writeUInt16LE(encoded.length, 28);
      centralHeader.writeUInt32LE(cursor, 42);
      locals.push(localHeader, encoded, packed);
      centrals.push(centralHeader, encoded);
      cursor += localHeader.length + encoded.length + packed.length;
    }
    const centralBytes = Buffer.concat(centrals),
      endHeader = Buffer.alloc(22);
    endHeader.writeUInt32LE(0x06054b50);
    endHeader.writeUInt16LE(entries.length, 8);
    endHeader.writeUInt16LE(entries.length, 10);
    endHeader.writeUInt32LE(centralBytes.length, 12);
    endHeader.writeUInt32LE(cursor, 16);
    return Buffer.concat([...locals, centralBytes, endHeader]);
  }
  const candidateZip = makeCandidateZip([
    ["manifest.json", jsonBytes(manifest), 8],
    ["chainlesschain-ide.vsix", fixtureBytes],
  ]);
  check(() =>
    assert.deepEqual(
      candidateFilesFromZip(candidateZip).get("chainlesschain-ide.vsix"),
      fixtureBytes,
    ),
  );
  check(() =>
    assert.deepEqual(
      candidateFilesFromZip(candidateZip).get("manifest.json"),
      jsonBytes(manifest),
    ),
  );
  check(() => assert.throws(() => candidateFilesFromZip(zip)));
  check(() =>
    assert.throws(() =>
      candidateFilesFromZip(
        makeCandidateZip([
          ["manifest.json", report],
          ["../chainlesschain-ide.vsix", fixtureBytes],
        ]),
      ),
    ),
  );
  check(() =>
    assert.throws(() =>
      candidateFilesFromZip(
        makeCandidateZip([
          ["manifest.json", report],
          ["manifest.json", report],
        ]),
      ),
    ),
  );
  const damagedCandidate = Buffer.from(candidateZip);
  damagedCandidate[30 + Buffer.byteLength("manifest.json")] ^= 1;
  check(() => assert.throws(() => candidateFilesFromZip(damagedCandidate)));
  console.log(
    `Candidate gate archiver self-test: 27 existing checks + ${newChecks} configuration/candidate checks passed; local Git source checks, no network or receipt writes.`,
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const usage =
      "Usage: node docs/research/ide/evidence/record-candidate-gates.mjs --record --config JSON | (--self-test | --validate-config) [--config JSON] | --print-default-config";
    assert(process.argv.length === 3 || process.argv.length === 5, usage);
    const mode = process.argv[2];
    assert(
      [
        "--self-test",
        "--validate-config",
        "--record",
        "--print-default-config",
      ].includes(mode),
      usage,
    );
    if (mode === "--record") {
      assert.equal(
        process.argv.length,
        5,
        "--record requires explicit --config JSON; the historical source96 template cannot be used implicitly.",
      );
    }
    if (process.argv.length === 5) {
      assert.notEqual(mode, "--print-default-config", usage);
      assert.equal(process.argv[3], "--config", usage);
      configure(
        JSON.parse(
          fs
            .readFileSync(path.resolve(ROOT, process.argv[4]), "utf8")
            .replace(/^\uFEFF/, ""),
        ),
      );
    }
    if (mode === "--self-test") selfTest();
    else if (mode === "--record") await record();
    else if (mode === "--print-default-config")
      console.log(
        JSON.stringify(
          {
            historicalOnly: true,
            usableForNewCandidate: false,
            notice:
              "Historical source96 template only, not a valid recording config envelope. New candidates require their own exact commit, branch, run IDs, artifact identity and output. Extract and update template explicitly before --record --config JSON.",
            template: DEFAULT_CONFIG,
          },
          null,
          2,
        ),
      );
    else
      console.log(
        JSON.stringify(
          {
            valid: true,
            config: CONFIG,
            requiredMatrixSizes: GATES.map((gate) => gate.names.length),
            optionalNativeGate:
              "Not supported by this schema; archive separately without replacing required gates.",
          },
          null,
          2,
        ),
      );
  } catch (error) {
    console.error(`Candidate gate archive refused: ${error.message}`);
    process.exitCode = 1;
  }
}
