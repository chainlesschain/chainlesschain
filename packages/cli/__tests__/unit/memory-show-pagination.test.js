import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { applyMemoryCommand } from "@chainlesschain/context-memory-kernel";
import { registerMemoryCommand } from "../../src/commands/memory.js";
import { CliCanonicalMemoryService } from "../../src/lib/context-memory-kernel/memory-service.js";
import { SegmentedMemoryPort } from "../../src/lib/context-memory-kernel/segmented-memory-port.js";
import { createDurableMemoryFixture } from "../../scripts/persistent-capacity-benchmark.mjs";

const mocks = vi.hoisted(() => ({
  service: null,
  context: {},
  shutdown: vi.fn(),
  legacyList: vi.fn(),
  logger: { error: vi.fn(), log: vi.fn(), info: vi.fn() },
}));
vi.mock("../../src/runtime/bootstrap.js", () => ({
  bootstrap: async () => mocks.context,
  shutdown: mocks.shutdown,
}));
vi.mock("../../src/lib/context-memory-kernel/index.js", () => ({
  createCliCanonicalMemoryService: () => mocks.service,
}));
vi.mock("../../src/lib/logger.js", () => ({ logger: mocks.logger }));
vi.mock("../../src/lib/memory-manager.js", async (importOriginal) => ({
  ...(await importOriginal()),
  listMemory: mocks.legacyList,
}));

let root, port, output, priorExitCode;
async function run(args) {
  const program = new Command();
  program.exitOverride();
  registerMemoryCommand(program);
  await program.parseAsync(["node", "cc", "memory", "show", ...args]);
  return output.mock.calls.length
    ? JSON.parse(output.mock.calls.at(-1)[0])
    : null;
}

beforeEach(async () => {
  priorExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.clearAllMocks();
  mocks.context = {};
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-memory-page-command-"));
  port = new SegmentedMemoryPort({ filePath: path.join(root, "memory.json") });
  await port.importSnapshot(createDurableMemoryFixture(35));
  mocks.service = new CliCanonicalMemoryService({
    runtime: { memoryPort: port, decision: { canonical: true } },
  });
  output = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  process.exitCode = priorExitCode;
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("memory show pagination", () => {
  it("continues a filtered page through the CLI without duplicates, retaining metadata", async () => {
    const category = (await port.listRecords({ limit: 1 }))[0].category;
    const all = await mocks.service.list({ category, limit: 100 });
    const first = await run(["--page", "--json", "--category", category, "--limit", "7"]);
    expect(first.entries).toEqual(all.slice(0, 7));
    expect(first.nextCursor).toBeTypeOf("string");
    expect(first.storeRevision).toBe(await port.getRevision());
    const second = await run(["--json", "--cursor", first.nextCursor, "--category", category, "--limit", "7"]);
    expect(second.entries).toEqual(all.slice(7, 14));
    expect(new Set([...first.entries, ...second.entries].map(row => row.id)).size).toBe(14);
    expect(mocks.shutdown).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBeUndefined();
  });

  it("keeps non-paged JSON as the existing array and reports the final page", async () => {
    const expected = await mocks.service.list({ limit: 100 });
    const original = await run(["--json", "--limit", "100"]);
    expect(original).toEqual(expected);
    expect(Array.isArray(original)).toBe(true);
    const page = await run(["--page", "--json", "--limit", "100"]);
    expect(page).toEqual({ entries: expected, nextCursor: null, storeRevision: await port.getRevision() });
  });

  it("rejects a cursor after a write and shuts down without emitting stale rows", async () => {
    const first = await run(["--page", "--json", "--limit", "3"]);
    const record = await port.read(first.entries[0].id);
    const transition = applyMemoryCommand(record, { type: "reinforce", expectedRevision: record.revision, confidenceDelta: 0.01, authority: "test", at: "2026-10-05T00:00:00.000Z" });
    expect(await port.commit(transition, record.revision)).toMatchObject({ ok: true });
    output.mockClear();
    await run(["--json", "--cursor", first.nextCursor, "--limit", "3"]);
    expect(process.exitCode).toBe(1);
    expect(output).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledOnce();
    expect(mocks.shutdown).toHaveBeenCalledTimes(2);
  });

  it("rejects changed filters and malformed cursors instead of silently restarting", async () => {
    const first = await run(["--page", "--json", "--limit", "3"]);
    output.mockClear();
    await run(["--json", "--cursor", first.nextCursor, "--category", "another-category"]);
    expect(process.exitCode).toBe(1);
    expect(output).not.toHaveBeenCalled();
    await run(["--json", "--cursor", "not-a-cursor"]);
    expect(output).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledTimes(2);
    expect(mocks.shutdown).toHaveBeenCalledTimes(3);
  });

  it("does not substitute a canonical page while the legacy memory authority is active", async () => {
    mocks.context = { db: { getDatabase: () => ({}) } };
    mocks.service = { decision: { canonical: false }, listPage: vi.fn() };
    mocks.legacyList.mockReturnValue([{ id: "legacy-entry", content: "legacy" }]);
    expect(await run(["--json"])).toEqual([{ id: "legacy-entry", content: "legacy" }]);
    output.mockClear();
    await run(["--page", "--json"]);
    expect(process.exitCode).toBe(1);
    expect(mocks.service.listPage).not.toHaveBeenCalled();
    expect(mocks.legacyList).toHaveBeenCalledOnce();
    expect(output).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledWith("Failed: Paged memory listing requires canonical memory mode");
    expect(mocks.shutdown).toHaveBeenCalledTimes(2);
  });
});
