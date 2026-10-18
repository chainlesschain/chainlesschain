import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGoal, goalFileStoreId } from "../../src/lib/goal-store.js";
import { readCliGoalCatalog } from "../../src/lib/cli-goal-catalog.js";
import {
  buildCliGoalCatalogArgs,
  parseCliGoalCatalog,
  buildCliGoalPanelsArgs,
  parseCliGoalPanels,
} from "../../../vscode-extension/src/plugin-manager.js";

let temp, root;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-catalog-"));
  root = path.join(temp, "goals");
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temp, { recursive: true, force: true });
});
function add(n, extra = {}) {
  return createGoal(
    {
      id: `goal-${String(n).padStart(3, "0")}`,
      objective: "Private full objective",
      title: `Delivery ${n}`,
      ...extra,
    },
    { root },
  );
}
const file = (id) => path.join(root, `${id}.json`);

describe("bounded standalone goal catalog", () => {
  it("returns an empty absent store without creating it", () => {
    const result = readCliGoalCatalog({ root });
    expect(result).toMatchObject({
      entries: [],
      scannedCount: 0,
      skippedCount: 0,
      nextCursor: null,
    });
    expect(fs.existsSync(root)).toBe(false);
    expect(parseCliGoalCatalog(JSON.stringify(result))).not.toBeNull();
  });

  it("pages in stable ID order and projects only bounded metadata without writing goals", () => {
    for (let i = 24; i >= 1; i--) add(i);
    const before = fs.readFileSync(file("goal-001"));
    const first = readCliGoalCatalog({ root });
    expect(first.entries).toHaveLength(20);
    expect(first.entries[0]).toEqual({
      id: "goal-001",
      title: "Delivery 1",
      status: "active",
      revision: 1,
      controlGeneration: 0,
    });
    expect(JSON.stringify(first)).not.toContain("Private full objective");
    const second = readCliGoalCatalog({ root, after: first.nextCursor });
    expect(second.entries.map((entry) => entry.id)).toEqual([
      "goal-021",
      "goal-022",
      "goal-023",
      "goal-024",
    ]);
    expect(second.nextCursor).toBeNull();
    expect(fs.readFileSync(file("goal-001"))).toEqual(before);
    expect(
      parseCliGoalCatalog(JSON.stringify(first), first.storeId)?.entries,
    ).toEqual(first.entries);
  });

  it("advances over invalid candidates, with at most one page of source reads", () => {
    for (let i = 1; i <= 42; i++) add(i);
    for (let i = 1; i <= 40; i++)
      fs.writeFileSync(file(`goal-${String(i).padStart(3, "0")}`), "broken");
    const open = vi.spyOn(fs, "openSync");
    const first = readCliGoalCatalog({ root });
    expect(first).toMatchObject({
      entries: [],
      scannedCount: 20,
      skippedCount: 20,
    });
    expect(
      open.mock.calls.filter(([name]) => String(name).endsWith(".json")),
    ).toHaveLength(20);
    const second = readCliGoalCatalog({ root, after: first.nextCursor });
    expect(second).toMatchObject({
      entries: [],
      scannedCount: 20,
      skippedCount: 20,
    });
    const last = readCliGoalCatalog({ root, after: second.nextCursor });
    expect(last.entries.map((entry) => entry.id)).toEqual([
      "goal-041",
      "goal-042",
    ]);
    expect(last.nextCursor).toBeNull();
  });

  it("rejects foreign stores, noncanonical cursors, invalid limits and directory exhaustion", () => {
    add(1);
    add(2);
    const first = readCliGoalCatalog({ root, limit: 1 });
    for (const after of [
      "../x",
      first.nextCursor + "=",
      "e30",
      "a".repeat(1025),
    ])
      expect(() => readCliGoalCatalog({ root, after })).toThrow(
        "INVALID_CURSOR",
      );
    expect(() =>
      readCliGoalCatalog({
        root: path.join(temp, "other"),
        after: first.nextCursor,
      }),
    ).toThrow("INVALID_CURSOR");
    for (const limit of [0, 21, 1.5, NaN, "1"])
      expect(() => readCliGoalCatalog({ root, limit })).toThrow(
        "INVALID_LIMIT",
      );
    let reads = 0,
      closed = false;
    vi.spyOn(fs, "opendirSync").mockReturnValue({
      readSync() {
        reads++;
        return { name: `junk-${reads}` };
      },
      closeSync() {
        closed = true;
      },
    });
    expect(() => readCliGoalCatalog({ root })).toThrow("DIRECTORY_LIMIT");
    expect(reads).toBe(2049);
    expect(closed).toBe(true);
  });

  it("counts oversized, project-owned, wrong-store and non-file records as invalid", () => {
    const g = add(1);
    fs.writeFileSync(file("goal-002"), "x".repeat(65537));
    fs.writeFileSync(
      file("goal-003"),
      JSON.stringify({
        ...g,
        id: "goal-003",
        ownerRef: { kind: "user", id: "did:fake" },
      }),
    );
    fs.writeFileSync(
      file("goal-004"),
      JSON.stringify({
        ...g,
        id: "goal-004",
        storeId: goalFileStoreId(path.join(temp, "foreign")),
      }),
    );
    fs.mkdirSync(file("goal-005"));
    expect(readCliGoalCatalog({ root })).toMatchObject({
      entries: [expect.objectContaining({ id: g.id })],
      scannedCount: 5,
      skippedCount: 4,
    });
  });

  it("strips control and bidi characters and truncates titles", () => {
    add(1, { title: "Ship\n\u001b[31m\u202erisk" + "x".repeat(200) });
    const entry = readCliGoalCatalog({ root }).entries[0];
    expect(entry.title.length).toBe(160);
    expect(entry.title).not.toMatch(/[\u0000-\u001f\u202e]/u);
  });

  it("rejects source mutation after initial read even beyond the visible title", () => {
    const g = add(1, { title: "x".repeat(300) });
    const originalOpen = fs.openSync;
    let reads = 0;
    vi.spyOn(fs, "openSync").mockImplementation((name, ...args) => {
      if (name === file(g.id) && ++reads === 2) {
        fs.writeFileSync(
          name,
          JSON.stringify({ ...g, title: g.title + "changed tail" }),
        );
      }
      return originalOpen(name, ...args);
    });
    expect(() => readCliGoalCatalog({ root })).toThrow("SOURCE_CHANGED");
  });

  it("does not treat unreadable or invalid stores as empty", () => {
    fs.writeFileSync(root, "not a directory");
    expect(() => readCliGoalCatalog({ root })).toThrow();
  });

  it("reports unsafe JSON names without exposing their text", () => {
    add(1);
    fs.writeFileSync(path.join(root, "bad..name.json"), "private");
    expect(readCliGoalCatalog({ root })).toMatchObject({
      scannedCount: 1,
      skippedCount: 0,
      invalidNameCount: 1,
    });
    expect(JSON.stringify(readCliGoalCatalog({ root }))).not.toContain(
      "bad..name",
    );
  });

  it("fails when a captured directory disappears before enumeration", () => {
    add(1);
    vi.spyOn(fs, "opendirSync").mockImplementation(() => {
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    });
    expect(() => readCliGoalCatalog({ root })).toThrow("gone");
  });

  it.skipIf(process.platform === "win32")(
    "rejects a dangling store symlink instead of calling it empty",
    () => {
      fs.symlinkSync(path.join(temp, "missing"), root);
      expect(() => readCliGoalCatalog({ root })).toThrow();
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects symlink source metadata",
    () => {
      const g = add(1);
      fs.symlinkSync(file(g.id), file("goal-002"));
      expect(readCliGoalCatalog({ root })).toMatchObject({
        scannedCount: 2,
        skippedCount: 1,
      });
    },
  );
});

describe("IDE goal catalog protocol", () => {
  it("binds selected panels to the catalog store and treats cursor as one argv value", () => {
    add(1);
    add(2);
    const result = readCliGoalCatalog({ root, limit: 1 });
    expect(buildCliGoalCatalogArgs(result.nextCursor)).toEqual([
      "goal",
      "catalog",
      "--json",
      `--after=${result.nextCursor}`,
    ]);
    expect(() => buildCliGoalCatalogArgs("--help")).not.toThrow(); // one opaque value, never a flag
    expect(() => buildCliGoalCatalogArgs("../path")).toThrow();
    expect(
      buildCliGoalPanelsArgs(
        "goal-001",
        "viewer",
        "project",
        result.storeId,
      ).at(-1),
    ).toBe(`--expected-store=${result.storeId}`);
    expect(
      parseCliGoalCatalog(JSON.stringify(result), "other-store"),
    ).toBeNull();
    expect(
      parseCliGoalPanels(
        JSON.stringify({
          schema: "chainlesschain.goal-extension-panels.v1",
          snapshot: true,
          observedAt: result.observedAt,
          goalRef: {
            id: "goal-001",
            storeId: result.storeId,
            revision: 1,
            controlGeneration: 0,
          },
          panels: [],
          dropped: [],
        }),
        { expectedStore: "other-store" },
      ),
    ).toBeNull();
  });

  it("rejects oversized, unsorted, duplicate, malformed or contradictory metadata", () => {
    add(1);
    add(2);
    const result = readCliGoalCatalog({ root });
    for (const patch of [
      { scannedCount: 0 },
      { skippedCount: 1 },
      { storeId: "other" },
      { snapshot: false },
      { nextCursor: "../path" },
      { entries: [...result.entries].reverse() },
      { entries: [result.entries[0], result.entries[0]] },
      { entries: result.entries.map((e) => ({ ...e, title: "bad\nlabel" })) },
      { entries: result.entries.map((e) => ({ ...e, revision: 1.1 })) },
    ])
      expect(
        parseCliGoalCatalog(JSON.stringify({ ...result, ...patch })),
      ).toBeNull();
    expect(parseCliGoalCatalog("x".repeat(32769))).toBeNull();
    const parsed = parseCliGoalCatalog(
      JSON.stringify({
        ...result,
        receipt: "fake",
        entries: result.entries.map((e) => ({ ...e, memory: "secret" })),
      }),
    );
    expect(JSON.stringify(parsed)).not.toMatch(/memory|receipt|secret/u);
  });
});
