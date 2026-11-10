import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { CliCanonicalMemoryService } from "../../src/lib/context-memory-kernel/memory-service.js";
import { createCliContextMemoryRuntime } from "../../src/lib/context-memory-kernel/runtime.js";
import { registerMemoryCommand } from "../../src/commands/memory.js";

const mocks = vi.hoisted(() => ({
  service: null,
  context: {},
  bootstrap: vi.fn(),
  shutdown: vi.fn(),
  legacyExport: vi.fn(),
  logger: { error: vi.fn(), info: vi.fn(), success: vi.fn(), log: vi.fn() },
}));
vi.mock("../../src/runtime/bootstrap.js", () => ({
  bootstrap: (...args) => mocks.bootstrap(...args),
  shutdown: mocks.shutdown,
}));
vi.mock("../../src/lib/context-memory-kernel/index.js", () => ({
  createCliCanonicalMemoryService: () => mocks.service,
}));
vi.mock("../../src/lib/logger.js", () => ({ logger: mocks.logger }));
vi.mock("../../src/lib/memory-manager.js", async (importOriginal) => ({
  ...(await importOriginal()),
  exportMemory: mocks.legacyExport,
}));

const parent = fs.realpathSync.native(os.tmpdir());
let directory, runtime, service, original, output, priorExitCode;
beforeEach(async () => {
  priorExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.clearAllMocks();
  mocks.shutdown.mockReset().mockResolvedValue(undefined);
  directory = fs.mkdtempSync(
    path.join(parent, "cc-memory-correction-command-"),
  );
  runtime = createCliContextMemoryRuntime({
    memoryFilePath: path.join(directory, "memory.json"),
    purgePorts: [],
    env: { CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default" },
  });
  service = new CliCanonicalMemoryService({ runtime });
  mocks.service = service;
  original = await service.addScoped("部署规则：使用旧区域。", {
    memoryId: "memory-deployment-rule",
    category: "deployment",
    scope: "user",
    scopeId: "local-user",
    allowedSinks: ["provider.ollama"],
    sensitivity: "personal",
    importance: 0.8,
  });
  mocks.context = { db: { getDatabase: () => ({ fixture: true }) } };
  mocks.bootstrap.mockResolvedValue(mocks.context);
  mocks.legacyExport.mockImplementation(() => {
    throw Error("Unexpected legacy migration");
  });
  output = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  process.exitCode = priorExitCode;
  vi.restoreAllMocks();
  if (
    path.dirname(directory) !== parent ||
    !path.basename(directory).startsWith("cc-memory-correction-command-")
  )
    throw Error("Unsafe correction fixture cleanup");
  fs.rmSync(directory, { recursive: true, force: true });
});
async function run(args) {
  output.mockClear();
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeErr() {} });
  registerMemoryCommand(program);
  await program.parseAsync(["node", "cc", "memory", ...args]);
  return output.mock.calls.length
    ? JSON.parse(output.mock.calls.at(-1)[0])
    : null;
}

describe("canonical memory inspect and correct", () => {
  it("corrects the inspected identity once and preserves its authority metadata", async () => {
    const before = await runtime.memoryPort.read(
      original.memory_id || original.id,
    );
    const inspected = await run(["inspect", before.memoryId, "--json"]);
    expect(inspected).toMatchObject({
      id: before.memoryId,
      revision: 1,
      content: before.content,
      digest: before.digest,
    });
    const corrected = await run([
      "correct",
      before.memoryId,
      "部署规则：使用新区域。",
      "--expected-revision",
      "1",
      "--json",
    ]);
    expect(corrected).toMatchObject({
      id: before.memoryId,
      revision: 2,
      content: "部署规则：使用新区域。",
      receipt: {
        operation: "correct",
        previousRevision: 1,
        previousRecordDigest: before.digest,
      },
    });
    const after = await runtime.memoryPort.read(before.memoryId);
    for (const key of [
      "memoryId",
      "state",
      "scope",
      "scopeId",
      "allowedSinks",
      "sensitivity",
      "retentionPolicy",
      "category",
      "createdAt",
    ])
      expect(after[key]).toEqual(before[key]);
    expect(after.digest).not.toBe(before.digest);
    expect((await service.list()).map((x) => x.id)).toEqual([before.memoryId]);
    expect(mocks.legacyExport).not.toHaveBeenCalled();
    const replay = await run([
      "correct",
      before.memoryId,
      "another edit",
      "--expected-revision",
      "1",
      "--json",
    ]);
    expect(replay.error.code).toBe("revision_conflict");
    expect(replay.noAutomaticReplay).toBe(true);
    expect((await service.inspect(before.memoryId)).content).toBe(
      corrected.content,
    );
  });

  it("rejects reference-backed correction before the service commits or emits a success", async () => {
    const { record } = await runtime.kernel.proposeMemory({
      memoryId: "reference-backed-memory",
      scope: "user",
      scopeId: "local-user",
      category: "rule",
      content: "original body",
      contentRef: {
        store: "external-content",
        objectId: "original-body",
        digest: `sha256:${"a".repeat(64)}`,
        byteLength: 13,
        summary: "original summary",
        recoverable: true,
      },
      provenance: { source: "test", observedAt: new Date().toISOString() },
      evidenceRefs: [{ store: "test", id: "original-rule" }],
      confidence: 0.8,
      importance: 0.8,
      sensitivity: "personal",
      allowedSinks: ["provider.ollama"],
      retentionPolicy: { mode: "durable" },
      activate: true,
    });
    const before = await runtime.memoryPort.exportSnapshot();
    const commit = vi.spyOn(runtime.memoryPort, "commit");
    const result = await run([
      "correct",
      record.memoryId,
      "replacement",
      "--expected-revision",
      "1",
      "--json",
    ]);
    expect(result.error.code).toBe("memory_correction_content_ref_unsupported");
    expect(result.error.message).toMatch(/content reconciliation/);
    expect(result.noAutomaticReplay).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(commit).not.toHaveBeenCalled();
    expect(await runtime.memoryPort.exportSnapshot()).toEqual(before);
  });

  it("reads exact identities without migration, memory writes or prefix matching", async () => {
    const before = await runtime.memoryPort.exportSnapshot();
    await run(["inspect", original.id, "--json"]);
    expect(await runtime.memoryPort.exportSnapshot()).toEqual(before);
    const missing = await run(["inspect", "memory-deployment", "--json"]);
    expect(missing.error.code).toBe("CONTEXT_MEMORY_NOT_FOUND");
    expect(mocks.legacyExport).not.toHaveBeenCalled();
    expect(await runtime.memoryPort.exportSnapshot()).toEqual(before);
  });

  it("permits only one concurrent correction of the same expected revision", async () => {
    const results = await Promise.allSettled([
      service.correct(original.id, { content: "new A", expectedRevision: 1 }),
      service.correct(original.id, { content: "new B", expectedRevision: 1 }),
    ]);
    const success = results.filter((x) => x.status === "fulfilled");
    const conflicts = results.filter((x) => x.status === "rejected");
    expect(success).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason.code).toBe("revision_conflict");
    expect(await service.inspect(original.id)).toMatchObject({
      revision: 2,
      content: success[0].value.content,
    });
  });

  it.each(["0", "-1", "1.5", "NaN", "2junk", "9007199254740992"])(
    "rejects invalid revision %s before bootstrap or any mutation",
    async (revision) => {
      const snapshot = await runtime.memoryPort.exportSnapshot();
      const result = await run([
        "correct",
        original.id,
        "new",
        "--expected-revision",
        revision,
        "--json",
      ]);
      expect(result.error).toBeDefined();
      expect(process.exitCode).toBe(1);
      expect(mocks.bootstrap).not.toHaveBeenCalled();
      expect(await runtime.memoryPort.exportSnapshot()).toEqual(snapshot);
    },
  );

  it("requires an explicit revision and never falls back to the legacy writer", async () => {
    await expect(
      run(["correct", original.id, "new", "--json"]),
    ).rejects.toMatchObject({ code: "commander.missingMandatoryOptionValue" });
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    mocks.service = { decision: { canonical: false }, correct: vi.fn() };
    const result = await run([
      "correct",
      original.id,
      "new",
      "--expected-revision",
      "1",
      "--json",
    ]);
    expect(result.error.message).toMatch(/canonical memory mode/);
    expect(mocks.service.correct).not.toHaveBeenCalled();
    expect(mocks.legacyExport).not.toHaveBeenCalled();
  });

  it("reports a published maintenance failure without claiming success or retrying", async () => {
    const correct = vi.spyOn(service, "correct").mockRejectedValue(
      Object.assign(new Error("Published; inspect current state"), {
        code: "CONTEXT_MEMORY_COMMIT_PUBLISHED",
        committed: true,
        storeRevision: 2,
        durability: "directory-sync-unsupported",
        cleanupComplete: false,
      }),
    );
    const result = await run([
      "correct",
      original.id,
      "new",
      "--expected-revision",
      "1",
      "--json",
    ]);
    expect(result).toMatchObject({
      error: { code: "CONTEXT_MEMORY_COMMIT_PUBLISHED" },
      committed: true,
      storeRevision: 2,
      cleanupComplete: false,
      noAutomaticReplay: true,
    });
    expect(process.exitCode).toBe(2);
    expect(correct).toHaveBeenCalledOnce();
  });

  it("routes setup and shutdown diagnostics away from JSON stdout", async () => {
    mocks.bootstrap.mockImplementation(async () => {
      process.stdout.write("bootstrap diagnostic\n");
      return mocks.context;
    });
    mocks.shutdown.mockImplementation(async () => {
      process.stdout.write("shutdown diagnostic\n");
    });
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const inspected = await run(["inspect", original.id, "--json"]);
    expect(inspected.id).toBe(original.id);
    expect(stderr.mock.calls.map((args) => String(args[0]))).toEqual([
      "bootstrap diagnostic\n",
      "shutdown diagnostic\n",
    ]);
  });
});
