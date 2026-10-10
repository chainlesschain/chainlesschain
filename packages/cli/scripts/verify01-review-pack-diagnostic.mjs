#!/usr/bin/env node
/** Execute generated operator scripts against a frozen, deterministic control.
 * This validates the evaluator; it never runs an agent or creates observations.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generateReviewPack } from "./verify01-review-pack.mjs";
import { VERIFY01_REVIEW_SPECS } from "./verify01-review-specs.mjs";
import { reviewEnvironment, REVIEW_IMAGE } from "./verify01-review-runtime.mjs";
import { extraDiagnosticControl } from "./verify01-review-diagnostic-extra-controls.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const planDir = path.join(
  repository,
  "docs/research/cli/verify01-plan-2026-10-04",
);
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const command = (name, args, options = {}) =>
  execFileSync(name, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  }).trim();

export function selectDiagnosticTasks(tasks, shard) {
  const match = /^(\d+)\/(\d+)$/u.exec(shard || "");
  assert.ok(match, "shard must be INDEX/COUNT");
  const [index, count] = match.slice(1).map(Number);
  assert.ok(
    Number.isSafeInteger(index) &&
      Number.isSafeInteger(count) &&
      index > 0 &&
      index <= count &&
      count <= tasks.length,
    "invalid diagnostic shard",
  );
  return tasks.filter((_, ordinal) => ordinal % count === index - 1);
}

export function diagnosticBehaviorControl(taskId, modulePath) {
  const source = (file) => JSON.stringify(modulePath(file));
  switch (taskId) {
    case "verify-04":
      return `
import { mergeUsagePricingBucket } from ${source("packages/cli/src/lib/usage-pricing-context.js")};
import { GPT6_PRICING_TERMS } from ${source("packages/cli/src/lib/model-context-catalog.js")};
diagnosticIt("includes cache reads and cache creation at the request pricing threshold", () => {
  const threshold = GPT6_PRICING_TERMS.longContext.threshold;
  for (const cacheField of ["cacheReadTokens", "cacheCreationTokens"]) {
    const entry = { provider: "openai", model: "gpt-6-sol" };
    const usage = { inputTokens: threshold - 1, outputTokens: 1, [cacheField]: 1 };
    mergeUsagePricingBucket(entry, usage);
    diagnosticExpect(entry.pricingBuckets).toHaveLength(1);
    diagnosticExpect(entry.pricingBuckets[0].requestInputTokens).toBe(threshold);
    diagnosticExpect(entry.pricingBuckets[0][cacheField]).toBe(1);
    mergeUsagePricingBucket(entry, { ...usage, [cacheField]: 2 });
    diagnosticExpect(entry.pricingBuckets).toHaveLength(2);
    diagnosticExpect(entry.pricingBuckets.map((bucket) => bucket.requestInputTokens)).toEqual([threshold, threshold + 1]);
    diagnosticExpect(entry.pricingBuckets.map((bucket) => bucket[cacheField])).toEqual([1, 2]);
    diagnosticExpect(entry.pricingBuckets.map((bucket) => bucket.calls)).toEqual([1, 1]);
  }
});
`;
    case "verify-07":
      return `
import { createSessionTranscriptHistoryProjection } from ${source("packages/cli/src/lib/session-transcript-history.js")};
const diagnosticHistoryEvents = Array.from({ length: 5 }, (_, index) => ({
  type: "assistant_message",
  hash: (index + 1).toString(16).padStart(64, "0"),
  data: { role: "assistant", content: "row-" + index },
}));
function diagnosticHistoryPage(events, options = {}) {
  const projection = createSessionTranscriptHistoryProjection("cursor-control", { limit: 2, ...options });
  events.forEach((event) => projection.accept(event));
  return projection.finish({ headHash: events.at(-1).hash, eventCount: events.length });
}
diagnosticIt("before cursors exclude their boundary and reach the first row in bounded calls", () => {
  const latest = diagnosticHistoryPage(diagnosticHistoryEvents);
  diagnosticExpect(latest.messages.map((row) => row.ordinal)).toEqual([3, 4]);
  diagnosticExpect(latest.nextCursor).toBeTypeOf("string");
  const previous = diagnosticHistoryPage(diagnosticHistoryEvents, { cursor: latest.nextCursor });
  diagnosticExpect(previous.messages.map((row) => row.ordinal)).toEqual([1, 2]);
  diagnosticExpect(previous.nextCursor).toBeTypeOf("string");
  const first = diagnosticHistoryPage(diagnosticHistoryEvents, { cursor: previous.nextCursor });
  diagnosticExpect(first.messages.map((row) => row.ordinal)).toEqual([0]);
  diagnosticExpect(first.nextCursor).toBeNull();
  diagnosticExpect([...first.messages, ...previous.messages, ...latest.messages].map((row) => row.text)).toEqual(["row-0", "row-1", "row-2", "row-3", "row-4"]);
});
diagnosticIt("after cursors include their offset and retain every newly appended row", () => {
  const original = diagnosticHistoryPage(diagnosticHistoryEvents.slice(0, 2));
  diagnosticExpect(original.messages.map((row) => row.ordinal)).toEqual([0, 1]);
  diagnosticExpect(original.syncCursor).toBeTypeOf("string");
  const first = diagnosticHistoryPage(diagnosticHistoryEvents, { after: original.syncCursor });
  diagnosticExpect(first.messages.map((row) => row.ordinal)).toEqual([2, 3]);
  diagnosticExpect(first.hasMore).toBe(true);
  const last = diagnosticHistoryPage(diagnosticHistoryEvents, { after: first.nextCursor });
  diagnosticExpect(last.messages.map((row) => row.ordinal)).toEqual([4]);
  diagnosticExpect(last.hasMore).toBe(false);
  const unchanged = diagnosticHistoryPage(diagnosticHistoryEvents, { after: last.nextCursor });
  diagnosticExpect(unchanged.messages).toEqual([]);
  diagnosticExpect(unchanged.hasMore).toBe(false);
});
`;
    case "verify-08":
      return `
import { branchContextDigest, withSessionBranchHistory, resolveSessionBranchHistory } from ${source("packages/cli/src/lib/session-branch-history.js")};
diagnosticIt("binds a branch capability to its parent even when context is identical", () => {
  const messages = [{ role: "user", content: "shared ancestor" }];
  const plan = { parentSessionId: "parent-a", contextDigest: branchContextDigest(messages) };
  let expired;
  withSessionBranchHistory(plan, (capability) => {
    expired = capability;
    diagnosticExpect(resolveSessionBranchHistory(capability, "parent-a", messages)).toBe(plan);
    diagnosticExpect(() => resolveSessionBranchHistory(capability, "parent-b", messages)).toThrow(/does not match/);
  });
  diagnosticExpect(() => resolveSessionBranchHistory(expired, "parent-a", messages)).toThrow(/expired/);
});
`;
    case "verify-09":
      return `
import { createSessionHistoryOrigins } from ${source("packages/cli/src/lib/session-history-origins.js")};
import { messagesToContextItems, contextItemsToMessages } from ${source("packages/cli/src/lib/context-memory-kernel/message-adapter.js")};
import { normalizeContextItem } from "@chainlesschain/context-memory-kernel";
diagnosticIt("requires the source digest even when sequence and message content match", () => {
  const messages = [{ role: "user", content: "first" }, { role: "assistant", content: "answer" }, { role: "user", content: "selected" }];
  for (const tampered of [false, true]) {
    const origins = createSessionHistoryOrigins();
    origins.snapshot(messages);
    const outputItems = messagesToContextItems(messages, { sessionId: "diagnostic-session" });
    if (tampered) outputItems[0] = normalizeContextItem({ ...outputItems[0], digest: undefined, sourceRef: { ...outputItems[0].sourceRef, digest: "sha256:" + "0".repeat(64) } });
    const output = contextItemsToMessages(outputItems);
    diagnosticExpect(output).toEqual(messages);
    origins.compact({ messages: output, canonical: { sessionId: "diagnostic-session", outputItems } });
    const prefix = origins.branchPrefix(output.slice(0, 2), "a".repeat(64), messages.length);
    if (tampered) diagnosticExpect(prefix).toBeNull();
    else diagnosticExpect(prefix.cutoff).toBe(2);
  }
});
`;
    case "verify-12":
      return `
import { transformBackgroundLaunchArgv, canonicalizeBackgroundSessionArgv } from ${source("packages/cli/src/lib/background-command-argv.js")};
diagnosticIt("preserves empty, spaced and quoted argument boundaries", () => {
  const tail = ["", "two words", 'a"quoted"path', "$(literal)"];
  const argv = ["agent", "--background", "--", ...tail];
  const grammar = { commandNames: ["agent"], optionSpecs: [{ long: "--background" }] };
  diagnosticExpect(transformBackgroundLaunchArgv(argv, grammar)).toEqual(["agent", "--", ...tail]);
  diagnosticExpect(canonicalizeBackgroundSessionArgv(["agent", "--", ...tail], { ...grammar, sessionId: "child" })).toEqual(["agent", "--session", "child", "--", ...tail]);
  diagnosticExpect(argv).toEqual(["agent", "--background", "--", ...tail]);
});
`;
    case "verify-20":
      return `
import { buildPermissionDecision } from ${source("packages/cli/src/lib/permission-decision.js")};
diagnosticIt("keeps policy deny above a conflicting approval and terminal allow", () => {
  const approval = { decision: "allow", via: "user" };
  const permissionChain = [{ layer: "approval", outcome: "allow" }];
  diagnosticExpect(buildPermissionDecision({ result: { approval, permissionChain } }).decision).toBe("allow");
  const result = buildPermissionDecision({ result: { policy: { decision: "deny", via: "managed" }, approval, permissionChain } });
  diagnosticExpect(result.decision).toBe("deny");
  diagnosticExpect(result.via).toBe("managed");
});
`;
    case "verify-21":
      return `
import diagnosticFs from "node:fs";
import diagnosticOs from "node:os";
import diagnosticPath from "node:path";
import { SegmentedMemoryPort } from ${source("packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js")};
import { createMemoryCandidate } from "@chainlesschain/context-memory-kernel";
import { STORE_SCHEMA, stateDigest } from ${source("packages/cli/src/lib/context-memory-kernel/durable-memory-port.js")};
diagnosticIt("retains every authority directory entry and byte during shadow reads", async () => {
  const root = diagnosticFs.mkdtempSync(diagnosticPath.join(diagnosticOs.tmpdir(), "cc-shadow-control-"));
  try {
    const filePath = diagnosticPath.join(root, "memory.json");
    const writer = new SegmentedMemoryPort({ filePath });
    const state = { schema: STORE_SCHEMA, schemaVersion: 1, storeRevision: 0, records: {}, events: [], reconciliations: {} };
    for (let index = 0; index < 2; index++) {
      const at = "2026-10-04T00:00:00.000Z";
      const record = createMemoryCandidate({
        memoryId: "shadow-control-" + index, scope: "project", scopeId: "diagnostic",
        category: "diagnostic", content: "retained record " + index,
        provenance: { source: "diagnostic", actor: "test", observedAt: at },
        evidenceRefs: [{ store: "diagnostic", id: "source-" + index }],
        confidence: 0.5, importance: 0.5, tags: [], sensitivity: "internal",
        allowedSinks: ["provider.local"], retentionPolicy: { mode: "durable" },
        activate: true, createdAt: at,
      }, { clock: () => Date.parse(at) });
      state.records[record.memoryId] = record;
    }
    state.digest = stateDigest(state);
    await writer.importSnapshot(state);
    const orphan = "00-" + "a".repeat(64) + ".json";
    diagnosticFs.writeFileSync(diagnosticPath.join(writer.shardDirectory, orphan), "unpublished shard");
    const snapshot = () => diagnosticFs.readdirSync(writer.shardDirectory).sort().map((name) => [name, diagnosticFs.readFileSync(diagnosticPath.join(writer.shardDirectory, name)).toString("base64")]);
    const entries = snapshot();
    const manifest = diagnosticFs.readFileSync(filePath);
    const shadow = new SegmentedMemoryPort({ filePath, readOnly: true });
    diagnosticExpect(await shadow.query()).toHaveLength(2);
    diagnosticExpect(diagnosticFs.readdirSync(writer.shardDirectory)).toContain(orphan);
    diagnosticExpect(snapshot()).toEqual(entries);
    diagnosticExpect(diagnosticFs.readFileSync(filePath)).toEqual(manifest);
    diagnosticExpect(await shadow.exportSnapshot()).toEqual(state);
    diagnosticExpect(snapshot()).toEqual(entries);
  } finally {
    diagnosticFs.rmSync(root, { recursive: true, force: true });
  }
});
`;
    case "verify-30":
      return `
import { inspectImageBudget } from ${source("packages/vscode-extension/src/chat/image-decode-budget.js")};
// APNG has one animation frame and a separate default-image canvas. Payload
// bytes are only inspected here; codec decoding is a separate admission step.
function diagnosticPngChunk(type, payload) {
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write(type, 4, 4, "ascii");
  payload.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}
function diagnosticFallbackPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(1, 0);
  const frame = Buffer.alloc(26);
  frame.writeUInt32BE(width, 4);
  frame.writeUInt32BE(height, 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), diagnosticPngChunk("IHDR", header), diagnosticPngChunk("acTL", animation), diagnosticPngChunk("IDAT", Buffer.from([120, 156])), diagnosticPngChunk("fcTL", frame), diagnosticPngChunk("fdAT", Buffer.alloc(4)), diagnosticPngChunk("IEND", Buffer.alloc(0))]);
}
diagnosticIt("includes the separate APNG default canvas in the cumulative pixel budget", () => {
  diagnosticExpect(inspectImageBudget(diagnosticFallbackPng(5000, 4000))).toMatchObject({ frames: 1, extraCanvases: 1, decodedPixels: 40000000 });
  diagnosticExpect(() => inspectImageBudget(diagnosticFallbackPng(5001, 4000))).toThrow(/fallback exceed/);
});
diagnosticIt("counts every GIF animation canvas", () => {
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  const animated = Buffer.concat([gif.subarray(0, 19), ...Array(3).fill(gif.subarray(19, -1)), Buffer.from([0x3b])]);
  diagnosticExpect(inspectImageBudget(animated)).toMatchObject({ frames: 3, decodedPixels: 3 });
});
`;
    default:
      return "";
  }
}

export function diagnosticCandidate(task, spec) {
  assert.equal(
    task.expectedFiles.length,
    1,
    "diagnostic requires one deliverable",
  );
  if (spec.doc)
    return `# Frozen outcome reporting diagnostic\n\n
This deterministic document exercises the real evaluator. It is not an agent
answer, provider observation, independent human approval or production report.
Bind the frozen plan before running packages/cli/scripts/task-outcome-report.mjs:
use --plan /review/plan.json --fingerprint, preserve that digest independently,
then use --plan-digest with the locked value. Missing observations must retain
36 task samples and 9 first-run samples and return exit code 2 with
INSUFFICIENT_EVIDENCE. Unknown costs remain null; never substitute zero.
Never report missing samples as PASS.
Never report a local baseline as improvement PASS.
Keep failed attempts and raw receipts for independent review.\n`;
  const modulePath = (file) => {
    let relative = path.posix.relative(
      path.posix.dirname(task.expectedFiles[0]),
      file,
    );
    if (!relative.startsWith(".")) relative = "./" + relative;
    return relative;
  };
  const control =
    diagnosticBehaviorControl(spec.taskId, modulePath) +
    extraDiagnosticControl(spec.taskId, modulePath(spec.sourcePath));
  // Runtime still runs the complete frozen baseline during setup and check.
  // Its unbounded cursor walks cannot be repeated inside a mutated candidate:
  // a non-advancing cursor would hang before reaching an assertion.
  const candidateBaselines =
    spec.taskId === "verify-07" ? [] : spec.baselineTests;
  return (
    "// Deterministic evaluator control; not an agent task outcome.\n" +
    candidateBaselines
      .map((file) => `import ${JSON.stringify(modulePath(file))};`)
      .join("\n") +
    "\n" +
    (control
      ? 'import { it as diagnosticIt, expect as diagnosticExpect } from "vitest";\n' +
        control
      : "")
  );
}

export function readDiagnosticReceipt(packRoot, taskId, stage, stdout) {
  const verdict = JSON.parse(stdout.trim());
  assert.equal(typeof verdict.pass, "boolean");
  assert.ok(
    new RegExp(`^${taskId}-${stage}-[a-f0-9-]+\\.json$`, "u").test(
      verdict.receipt,
    ),
    "invalid diagnostic receipt name",
  );
  const file = path.join(packRoot, "acceptance-evidence", verdict.receipt);
  const stat = fs.lstatSync(file);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
    "receipt must be a regular unaliased file",
  );
  const bytes = fs.readFileSync(file);
  assert.equal(
    hash(bytes),
    verdict.receiptDigest,
    "diagnostic receipt bytes changed",
  );
  const receipt = JSON.parse(bytes);
  assert.equal(receipt.taskId, taskId);
  assert.equal(receipt.stage, stage);
  assert.equal(receipt.pass, verdict.pass);
  assert.equal(receipt.providerAssessed, false);
  assert.equal(receipt.productionAttested, false);
  return { file, bytes, receipt, verdict };
}

export async function runPackDiagnostic({
  outputDir,
  imageId,
  sourceSha,
  shard = "1/1",
}) {
  assert.equal(
    process.platform,
    "linux",
    "real Docker diagnostic requires Linux",
  );
  assert.equal(process.version, "v22.12.0", "diagnostic requires Node 22.12.0");
  assert.match(sourceSha || "", /^[a-f0-9]{40}$/u);
  assert.match(imageId || "", /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    command("git", ["-C", repository, "rev-parse", "HEAD"]),
    sourceSha,
  );
  assert.equal(
    command("git", [
      "-C",
      repository,
      "status",
      "--porcelain",
      "--untracked-files=no",
    ]),
    "",
    "diagnostic source must be a clean commit",
  );
  const root = path.resolve(outputDir);
  assert.ok(!fs.existsSync(root), "diagnostic output must be new");
  const catalog = json(path.join(planDir, "tasks.json"));
  const selected = selectDiagnosticTasks(catalog.tasks, shard);
  const inspected = JSON.parse(
    command("docker", ["image", "inspect", imageId], {
      env: reviewEnvironment(),
    }),
  )[0];
  assert.equal(inspected.Id, imageId);
  assert.ok(
    inspected.RepoTags?.includes(REVIEW_IMAGE),
    "image reference does not match diagnostic pin",
  );
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-review-pack-diagnostic-"),
  );
  const workspace = path.join(scratch, "workspace");
  fs.mkdirSync(workspace);
  const archive = path.join(scratch, "frozen.tar");
  command(
    "git",
    [
      "-C",
      repository,
      "archive",
      "--format=tar",
      "--output",
      archive,
      catalog.projectCommit,
    ],
    { timeout: 120000 },
  );
  command("tar", ["-xf", archive, "-C", workspace], { timeout: 120000 });
  const archiveHasher = createHash("sha256");
  for await (const chunk of fs.createReadStream(archive))
    archiveHasher.update(chunk);
  fs.mkdirSync(root);
  const packRoot = path.join(root, "pack");
  const pack = generateReviewPack({ outputDir: packRoot, imageId, planDir });
  const review = json(path.join(packRoot, "review.json"));
  const specs = new Map(
    VERIFY01_REVIEW_SPECS.map((spec) => [spec.taskId, spec]),
  );
  const readback = {
    schema: "chainlesschain.verify01-review-pack-diagnostic/v1",
    sourceCommit: sourceSha,
    projectCommit: catalog.projectCommit,
    recordedAt: new Date().toISOString(),
    shard,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    imageId,
    imageReference: REVIEW_IMAGE,
    imageRepoDigests: inspected.RepoDigests,
    frozenArchiveDigest: "sha256:" + archiveHasher.digest("hex"),
    reviewDigest: pack.reviewDigest,
    tasks: [],
    passed: false,
    boundaries: {
      formalSamplesCreated: false,
      agentExecuted: false,
      providerAssessed: false,
      independentHumanReview: false,
      productionAttested: false,
      releaseEligible: false,
    },
    control:
      "Candidate modules import frozen baseline tests and add deterministic behavioral controls. This exercises generated evaluators and behavioral mutants, not agent performance.",
  };
  const rawRoot = path.join(root, "stages");
  fs.mkdirSync(rawRoot);
  function stage(task, name) {
    const entry = review.tasks.find((item) => item.taskId === task.id)[name];
    const bytes = fs.readFileSync(path.join(packRoot, entry.path));
    assert.equal(hash(bytes), entry.digest);
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        bytes.toString("utf8"),
        workspace,
        String(Date.now() + 640000),
      ],
      {
        cwd: packRoot,
        env: reviewEnvironment(),
        encoding: "utf8",
        shell: false,
        timeout: 645000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const raw = {
      taskId: task.id,
      stage: name,
      scriptDigest: entry.digest,
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
    const rawFile = `${task.id}-${name}.json`;
    const rawBytes = Buffer.from(JSON.stringify(raw, null, 2) + "\n");
    fs.writeFileSync(path.join(rawRoot, rawFile), rawBytes, { flag: "wx" });
    const summary = {
      file: "stages/" + rawFile,
      digest: hash(rawBytes),
      bytes: rawBytes.length,
      exitCode: raw.exitCode,
      signal: raw.signal,
      pass: false,
    };
    try {
      assert.equal(raw.error, null);
      assert.equal(raw.signal, null);
      const parsed = readDiagnosticReceipt(packRoot, task.id, name, raw.stdout);
      assert.equal(
        raw.exitCode,
        name === "setup" && !parsed.receipt.pass ? 1 : 0,
        "generated stage exit disagrees with its actual verdict",
      );
      Object.assign(summary, {
        pass: parsed.receipt.pass,
        detail: parsed.receipt.detail,
        receipt: "pack/acceptance-evidence/" + parsed.verdict.receipt,
        receiptDigest: parsed.verdict.receiptDigest,
        tests: parsed.receipt.tests,
        mutations: parsed.receipt.mutations,
      });
    } catch (error) {
      summary.detail = error.message;
    }
    return summary;
  }
  try {
    for (const task of selected) {
      const spec = specs.get(task.id);
      const sourcePath = path.join(workspace, spec.sourcePath);
      const sourceDigest = hash(fs.readFileSync(sourcePath));
      const setup = stage(task, "setup");
      const row = {
        taskId: task.id,
        setup,
        check: null,
        sourceRestored: false,
      };
      const candidate = path.join(workspace, task.expectedFiles[0]);
      if (setup.pass) {
        fs.mkdirSync(path.dirname(candidate), { recursive: true });
        fs.writeFileSync(candidate, diagnosticCandidate(task, spec), {
          flag: "wx",
        });
        try {
          row.check = stage(task, "check");
        } finally {
          fs.unlinkSync(candidate);
        }
      }
      row.sourceRestored = hash(fs.readFileSync(sourcePath)) === sourceDigest;
      row.passed =
        setup.pass &&
        row.check?.pass === true &&
        row.sourceRestored &&
        row.check.mutations.length === (spec.mutants?.length || 0);
      readback.tasks.push(row);
      fs.writeFileSync(
        path.join(root, "readback.json"),
        JSON.stringify(readback, null, 2) + "\n",
      );
      console.log(
        JSON.stringify({
          taskId: row.taskId,
          passed: row.passed,
          setup: setup.detail,
          check: row.check?.detail,
          mutants: row.check?.mutations.length,
        }),
      );
    }
    readback.passed =
      readback.tasks.length === selected.length &&
      readback.tasks.every((task) => task.passed);
    readback.completedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(root, "readback.json"),
      JSON.stringify(readback, null, 2) + "\n",
    );
    return readback;
  } finally {
    // Only the private mkdtemp tree is removed. Raw evaluator outputs remain.
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        "output-dir": { type: "string" },
        "image-id": { type: "string" },
        "source-sha": { type: "string" },
        shard: { type: "string", default: "1/1" },
      },
    });
    assert.ok(values["output-dir"], "--output-dir is required");
    const result = await runPackDiagnostic({
      outputDir: values["output-dir"],
      imageId: values["image-id"],
      sourceSha: values["source-sha"],
      shard: values.shard,
    });
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
