import { describe, expect, it, vi } from "vitest";

const {
  ContextMemoryKernel,
  InMemoryMemoryPort,
} = require("../../../../../packages/context-memory-kernel/lib/index.js");
const {
  DesktopCanonicalMemoryAdapter,
} = require("../permanent-memory-adapter.js");

const AT = Date.parse("2026-08-30T08:00:00.000Z");

function canonicalHarness() {
  const memoryPort = new InMemoryMemoryPort();
  const kernel = new ContextMemoryKernel({
    memoryPort,
    clock: () => AT,
  });
  const pilot = {
    memoryRecall: vi.fn((params) => kernel.recallMemory(params)),
    memoryPropose: vi.fn((params) => kernel.proposeMemory(params)),
    memoryDecide: vi.fn((params) => kernel.decideMemory(params)),
    memoryDelete: vi.fn((params) => kernel.deleteMemory(params)),
  };
  let sequence = 0;
  const adapter = new DesktopCanonicalMemoryAdapter({
    getPilot: () => pilot,
    now: () => AT,
    uuid: () =>
      `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  });
  return { adapter, memoryPort, pilot };
}

describe("Desktop canonical permanent-memory adapter", () => {
  it("writes and reads daily notes through fixed App Server methods", async () => {
    const { adapter, pilot } = canonicalHarness();

    const saved = await adapter.writeDailyNote("ship the release", {
      append: true,
    });

    expect(saved.record).toMatchObject({
      category: "daily-note",
      content: "ship the release",
      scope: "user",
      scopeId: "local-user",
      state: "active",
    });
    await expect(adapter.readDailyNote("2026-08-30")).resolves.toBe(
      "ship the release",
    );
    await expect(adapter.getRecentDailyNotes()).resolves.toMatchObject([
      { date: "2026-08-30", content: "ship the release" },
    ]);
    expect(pilot.memoryPropose).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedSinks: ["*"],
        retentionPolicy: { mode: "durable" },
      }),
    );
    expect(pilot.memoryRecall).toHaveBeenCalledWith(
      expect.objectContaining({
        sink: "desktop.memory",
        scopeAdmissions: [{ scope: "user", scopeId: "local-user" }],
      }),
    );
  });

  it("replaces the editable MEMORY projection with revision-CAS supersede decisions", async () => {
    const { adapter, memoryPort, pilot } = canonicalHarness();
    const first = await adapter.appendToMemory("first", { section: "Design" });
    const second = await adapter.appendToMemory("second", { section: "Testing" });

    const replacement = await adapter.updateMemory("canonical document");

    await expect(adapter.readMemory()).resolves.toBe("canonical document");
    await expect(memoryPort.read(first.record.memoryId)).resolves.toMatchObject({
      state: "superseded",
      revision: 2,
    });
    await expect(memoryPort.read(second.record.memoryId)).resolves.toMatchObject({
      state: "superseded",
      revision: 2,
    });
    expect(replacement.record.supersedes).toHaveLength(2);
    expect(replacement.record.supersedes).toEqual(
      expect.arrayContaining([first.record.memoryId, second.record.memoryId]),
    );
    expect(pilot.memoryDecide).toHaveBeenCalledTimes(2);
    expect(pilot.memoryDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "supersede",
        expectedRevision: 1,
        successorMemoryId: replacement.record.memoryId,
      }),
    );
  });

  it("maps canonical recall into the existing renderer search projection", async () => {
    const { adapter } = canonicalHarness();
    const saved = await adapter.saveToMemory("deterministic release tests", {
      type: "solution",
      section: "Release",
    });

    const results = await adapter.search("release tests", { limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: saved.memoryId,
      source: "memory",
      section: "Release",
      document: {
        content: "deterministic release tests",
        metadata: {
          memoryId: saved.memoryId,
          revision: 1,
          type: "canonical-memory",
        },
      },
    });
  });

  it("fails closed when the canonical App Server is unavailable", async () => {
    const adapter = new DesktopCanonicalMemoryAdapter({ getPilot: () => null });

    await expect(adapter.readMemory()).rejects.toMatchObject({
      code: "CANONICAL_MEMORY_UNAVAILABLE",
    });
  });
});
