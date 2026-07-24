"use strict";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  LocalFilesAdapter,
  LOCAL_FILES_NAME,
  LOCAL_FILES_VERSION,
  canonicalizeRoots,
  scanRoots,
  scopeForRoots,
} = require("../../lib/adapters/local-files");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES } = require("../../lib/constants");
const { validateEvent } = require("../../lib/schemas");

let tmpDir;

function makeFile(relativePath, content, mtimeMs) {
  const filePath = join(tmpDir, relativePath);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
  if (mtimeMs) {
    utimesSync(filePath, mtimeMs / 1000, mtimeMs / 1000);
  }
  return filePath;
}

async function collect(iterable) {
  const rows = [];
  for await (const row of iterable) rows.push(row);
  return rows;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "local-files-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("LocalFilesAdapter contract", () => {
  it("declares the privacy-safe bounded-scan contract", () => {
    const adapter = new LocalFilesAdapter({ roots: [tmpDir] });
    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(LOCAL_FILES_NAME);
    expect(adapter.name).toBe("local-files");
    expect(adapter.version).toBe(LOCAL_FILES_VERSION);
    expect(adapter.version).toBe("0.2.0");
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        "sync:local-file-walk",
        "sync:scan-directory",
        "sync:profile-directory",
      ]),
    );
    expect(adapter.watermarkStrategy).toBe("max-captured-at");
    expect(adapter.watermarkRequiresCompleteScan).toBe(true);
    expect(adapter.initialPageBudget).toBe(1);
    expect(adapter.dataDisclosure.excludedFields.join(" ")).toMatch(
      /absolute and relative paths/i,
    );
  });

  it("derives stable scopes without exposing selected roots", () => {
    const root = join(tmpDir, "selected-private-root");
    mkdirSync(root);
    const scope = scopeForRoots([root]);
    expect(scope).toMatch(/^account:local-files:[a-f0-9]{32}$/u);
    expect(scope).not.toContain(root);
    expect(scopeForRoots([root])).toBe(scope);
  });

  it("keeps compatibility-equivalent Unicode roots in distinct scopes", () => {
    const circledRoot = join(tmpDir, "①");
    const asciiRoot = join(tmpDir, "1");
    mkdirSync(circledRoot);
    mkdirSync(asciiRoot);

    expect(scopeForRoots([circledRoot])).not.toBe(scopeForRoots([asciiRoot]));
  });

  it("treats whitespace in a selected filesystem path as identity", () => {
    const plainRoot = join(tmpDir, "selected");
    const spacedRoot = `${plainRoot} `;
    const fsMock = { realpathSync: (candidate) => candidate };

    expect(canonicalizeRoots([plainRoot, spacedRoot], fsMock)).toEqual(
      expect.arrayContaining([plainRoot, spacedRoot]),
    );
    const adapter = new LocalFilesAdapter({
      roots: spacedRoot,
      fs: fsMock,
    });
    expect(adapter.defaultScope).toBe(scopeForRoots([spacedRoot], fsMock));
    expect(adapter.defaultScope).not.toBe(scopeForRoots([plainRoot], fsMock));
  });

  it("deduplicates exact roots while retaining explicit nested roots", () => {
    const root = join(tmpDir, "root");
    const nested = join(root, "nested");
    mkdirSync(nested, { recursive: true });
    expect(canonicalizeRoots([nested, root, root, ""])).toEqual([root, nested]);
  });
});

describe("LocalFilesAdapter readiness", () => {
  it("reports only a count for readable explicit roots", async () => {
    const root = join(tmpDir, "private-root");
    mkdirSync(root);
    const result = await new LocalFilesAdapter({
      roots: [root],
    }).authenticate();
    expect(result).toMatchObject({
      ok: true,
      mode: "file-import",
      rootCount: 1,
      metadataOnly: true,
    });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(result).not.toHaveProperty("roots");
  });

  it("rejects missing explicit roots and propagates the result through health", async () => {
    const missing = join(tmpDir, "missing-private-root");
    const adapter = new LocalFilesAdapter({ roots: [missing] });
    await expect(adapter.authenticate()).resolves.toMatchObject({
      ok: false,
      reason: "LOCAL_FILES_ROOT_UNRESOLVED",
    });
    const health = await adapter.healthCheck();
    expect(health).toMatchObject({
      ok: false,
      reason: "LOCAL_FILES_ROOT_UNRESOLVED",
    });
    expect(JSON.stringify(health)).not.toContain(missing);
  });

  it("allows absent optional default folders when at least one is readable", async () => {
    const existing = join(tmpDir, "Documents");
    mkdirSync(existing);
    const adapter = new LocalFilesAdapter({
      defaultRoots: () => [existing, join(tmpDir, "Downloads")],
    });
    await expect(adapter.authenticate()).resolves.toMatchObject({
      ok: true,
      rootCount: 1,
    });
  });

  it("reports unreadable selected roots without echoing their path", async () => {
    const root = join(tmpDir, "secret");
    mkdirSync(root);
    const adapter = new LocalFilesAdapter({
      roots: [root],
      inspectRoots: () => ({
        roots: [root],
        readableRoots: [root],
        missingCount: 0,
        unreadableCount: 1,
        invalidCount: 0,
      }),
    });
    const result = await adapter.authenticate();
    expect(result).toMatchObject({
      ok: false,
      reason: "LOCAL_FILES_NOT_READABLE",
    });
    expect(JSON.stringify(result)).not.toContain(root);
  });
});

describe("LocalFilesAdapter sync", () => {
  it("collects metadata in deterministic order across roots", async () => {
    const firstRoot = join(tmpDir, "root-a");
    const secondRoot = join(tmpDir, "root-b");
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);
    makeFile("root-a/z.txt", "z", 1_700_000_003_000);
    makeFile("root-a/a.md", "a", 1_700_000_001_000);
    makeFile("root-b/m.pdf", "m", 1_700_000_002_000);
    const adapter = new LocalFilesAdapter({
      roots: [secondRoot, firstRoot],
    });

    const rows = await collect(adapter.sync());
    expect(rows.map((row) => row.payload.name)).toEqual([
      "a.md",
      "z.txt",
      "m.pdf",
    ]);
    expect(rows.every((row) => row.kind === "local-file")).toBe(true);
  });

  it("never archives absolute roots or relative paths", async () => {
    const root = join(tmpDir, "highly-private-root");
    mkdirSync(root);
    makeFile(
      "highly-private-root/nested/report.pdf",
      "secret",
      1_700_000_001_000,
    );
    const [raw] = await collect(
      new LocalFilesAdapter({ roots: [root] }).sync(),
    );
    const serialized = JSON.stringify(raw);

    expect(serialized).not.toContain(tmpDir);
    expect(serialized).not.toContain("nested/");
    expect(serialized).not.toContain("nested\\\\");
    expect(raw.originalId).toMatch(/^local-file-entry:[a-f0-9]{48}$/u);
    expect(raw.scope).toMatch(/^account:local-files:[a-f0-9]{32}$/u);
    expect(Object.keys(raw.payload).sort()).toEqual([
      "extension",
      "fileHash",
      "mtimeMs",
      "name",
      "relativeDepth",
      "rootCategory",
      "rootHash",
      "size",
    ]);
    expect(raw.payload.fileHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(raw.payload.rootHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses stable identity and creates a new version when metadata changes", async () => {
    const root = join(tmpDir, "root");
    mkdirSync(root);
    const filePath = makeFile("root/a.txt", "x", 1_700_000_001_000);
    const adapter = new LocalFilesAdapter({ roots: [root] });
    const [first] = await collect(adapter.sync());
    const [same] = await collect(adapter.sync());
    expect(same.originalId).toBe(first.originalId);
    expect(same.payload.fileHash).toBe(first.payload.fileHash);

    writeFileSync(filePath, "changed", "utf-8");
    utimesSync(filePath, 1_700_000_009, 1_700_000_009);
    const [changed] = await collect(adapter.sync());
    expect(changed.payload.fileHash).toBe(first.payload.fileHash);
    expect(changed.originalId).not.toBe(first.originalId);
  });

  it("does not merge compatibility-equivalent Unicode filenames", async () => {
    const root = join(tmpDir, "root");
    mkdirSync(root);
    makeFile("root/①.txt", "x", 1_700_000_001_000);
    makeFile("root/1.txt", "x", 1_700_000_001_000);

    const rows = await collect(new LocalFilesAdapter({ roots: [root] }).sync());
    const circled = rows.find((row) => row.payload.name === "①.txt");
    const ascii = rows.find((row) => row.payload.name === "1.txt");

    expect(circled).toBeDefined();
    expect(ascii).toBeDefined();
    expect(circled.payload.fileHash).not.toBe(ascii.payload.fileHash);
    expect(circled.originalId).not.toBe(ascii.originalId);
  });

  it("uses a stable sentinel for a future file timestamp", async () => {
    const root = join(tmpDir, "root");
    mkdirSync(root);
    let now = 1_700_000_000_000;
    const adapter = new LocalFilesAdapter({
      roots: [root],
      now: () => now,
      scanRoots: () => ({
        complete: true,
        issues: [],
        records: [
          {
            root,
            relativePath: "future.txt",
            name: "future.txt",
            size: 1,
            mtimeMs: 1_900_000_000_000,
            rootCategory: "selected",
            relativeDepth: 0,
          },
        ],
      }),
    });
    const [first] = await collect(adapter.sync());
    now += 10_000;
    const [second] = await collect(adapter.sync());

    expect(first.capturedAt).toBe(1);
    expect(first.payload.mtimeMs).toBe(1);
    expect(second.capturedAt).toBe(1);
    expect(second.payload.mtimeMs).toBe(1);
    expect(second.originalId).toBe(first.originalId);
    expect(adapter.normalize(first).events[0].occurredAt).toBe(1);
    expect(adapter.normalize(second).events[0].occurredAt).toBe(1);
  });

  it("does a full rescan for persisted watermarks but honors explicit since", async () => {
    const root = join(tmpDir, "root");
    mkdirSync(root);
    makeFile("root/old.txt", "old", 1_700_000_001_000);
    makeFile("root/new.txt", "new", 1_700_000_005_000);
    const adapter = new LocalFilesAdapter({ roots: [root] });

    const replayed = await collect(
      adapter.sync({ sinceWatermark: 1_700_000_004_000 }),
    );
    expect(replayed.map((row) => row.payload.name)).toEqual([
      "new.txt",
      "old.txt",
    ]);
    const explicit = await collect(adapter.sync({ since: 1_700_000_004_000 }));
    expect(explicit.map((row) => row.payload.name)).toEqual(["new.txt"]);
  });

  it("defers completion when a limit truncates the scan and completes after expansion", async () => {
    const root = join(tmpDir, "root");
    mkdirSync(root);
    for (let index = 0; index < 3; index += 1) {
      makeFile(`root/f${index}.txt`, "x", 1_700_000_001_000 + index);
    }
    const adapter = new LocalFilesAdapter({ roots: [root] });
    const firstComplete = vi.fn();
    const first = await collect(
      adapter.sync({ limit: 2, markWatermarkComplete: firstComplete }),
    );
    expect(first).toHaveLength(2);
    expect(firstComplete).not.toHaveBeenCalled();

    const expandedComplete = vi.fn();
    const expanded = await collect(
      adapter.sync({ limit: 4, markWatermarkComplete: expandedComplete }),
    );
    expect(expanded).toHaveLength(3);
    expect(expandedComplete).toHaveBeenCalledOnce();
  });

  it("marks depth and per-root truncation incomplete", async () => {
    const root = join(tmpDir, "root");
    mkdirSync(root);
    makeFile("root/top.txt", "x", 1_700_000_001_000);
    makeFile("root/deep/child.txt", "x", 1_700_000_002_000);
    const depthComplete = vi.fn();
    await expect(
      collect(
        new LocalFilesAdapter({ roots: [root] }).sync({
          maxDepth: 1,
          maxFilesPerRoot: 1,
          markWatermarkComplete: depthComplete,
        }),
      ),
    ).rejects.toMatchObject({
      code: "LOCAL_FILES_SCAN_LIMIT_EXHAUSTED",
    });
    expect(depthComplete).not.toHaveBeenCalled();
  });

  it("fails a non-cardinality incomplete scan before yielding metadata", async () => {
    const root = join(tmpDir, "root");
    mkdirSync(root);
    const adapter = new LocalFilesAdapter({
      roots: [root],
      scanRoots: () => ({
        complete: false,
        issues: ["READ_FAILED", "ROOT_INCOMPLETE"],
        records: [
          {
            root,
            relativePath: "must-not-yield.txt",
            name: "must-not-yield.txt",
            size: 1,
            mtimeMs: 1_700_000_001_000,
            rootCategory: "selected",
            relativeDepth: 0,
          },
        ],
      }),
    });

    await expect(collect(adapter.sync())).rejects.toMatchObject({
      code: "LOCAL_FILES_SCAN_INCOMPLETE",
      issueCodes: ["READ_FAILED", "ROOT_INCOMPLETE"],
    });
  });

  it("honors pre-aborted collection signals", async () => {
    const root = join(tmpDir, "root");
    mkdirSync(root);
    const controller = new AbortController();
    controller.abort();

    await expect(
      collect(
        new LocalFilesAdapter({ roots: [root] }).sync({
          signal: controller.signal,
        }),
      ),
    ).rejects.toMatchObject({
      name: "AbortError",
      code: "ABORT_ERR",
    });
  });

  it("retains an explicitly selected nested dot-directory", () => {
    const root = join(tmpDir, "root");
    const explicit = join(root, ".explicit");
    mkdirSync(explicit, { recursive: true });
    makeFile("root/.explicit/kept.txt", "x", 1_700_000_001_000);

    const result = scanRoots([root, explicit], { maxRecords: 10 });
    expect(result.records.map((record) => record.name)).toEqual(["kept.txt"]);
    expect(result.complete).toBe(true);
    expect(result.scannedRoots).toBe(2);
  });

  it("enforces global traversal budgets across roots", () => {
    const first = join(tmpDir, "first");
    const second = join(tmpDir, "second");
    mkdirSync(join(first, "nested"), { recursive: true });
    mkdirSync(second);

    const result = scanRoots([first, second], {
      maxRecords: 10,
      maxDirectories: 1,
    });
    expect(result.complete).toBe(false);
    expect(result.issues).toContain("DIRECTORY_LIMIT");
    expect(result.visitedDirectories).toBe(1);
    expect(result.scannedRoots).toBe(1);
  });

  it("stops a scan when cancellation arrives during directory I/O", () => {
    const root = join(tmpDir, "root");
    mkdirSync(root);
    makeFile("root/a.txt", "a", 1_700_000_001_000);
    const controller = new AbortController();
    const nodeFs = require("node:fs");
    const fsMock = Object.create(nodeFs);
    fsMock.opendirSync = undefined;
    fsMock.readdirSync = (...args) => {
      const entries = nodeFs.readdirSync(...args);
      controller.abort();
      return entries;
    };

    expect(() =>
      scanRoots([root], {
        fs: fsMock,
        signal: controller.signal,
        maxRecords: 10,
      }),
    ).toThrow(
      expect.objectContaining({
        name: "AbortError",
        code: "ABORT_ERR",
      }),
    );
  });

  it("rejects Windows network and device roots before filesystem I/O", () => {
    if (process.platform !== "win32") return;
    const realpathSync = vi.fn();
    expect(() =>
      canonicalizeRoots(["\\\\server\\private-share"], { realpathSync }),
    ).toThrow(/network and device roots/u);
    expect(realpathSync).not.toHaveBeenCalled();
  });

  it("reports entry and metadata byte budgets without leaking extra rows", () => {
    const entryRoot = join(tmpDir, "entry-root");
    const byteRoot = join(tmpDir, "byte-root");
    mkdirSync(entryRoot);
    mkdirSync(byteRoot);
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      makeFile(`entry-root/${name}`, "x", 1_700_000_001_000);
    }
    makeFile("byte-root/long-name.txt", "x", 1_700_000_001_000);

    const entryLimited = scanRoots([entryRoot], {
      maxRecords: 10,
      maxEntries: 2,
    });
    expect(entryLimited.records).toHaveLength(2);
    expect(entryLimited.complete).toBe(false);
    expect(entryLimited.issues).toContain("ENTRY_LIMIT");

    const byteLimited = scanRoots([byteRoot], {
      maxRecords: 10,
      maxMetadataBytes: 1,
    });
    expect(byteLimited.records).toEqual([]);
    expect(byteLimited.complete).toBe(false);
    expect(byteLimited.issues).toContain("BYTE_LIMIT");
  });

  it("discards staged rows when the directory changes after listing", () => {
    const root = join(tmpDir, "root");
    const outside = join(tmpDir, "outside");
    const filePath = join(root, "outside-secret.txt");
    const directoryStat = {
      mtimeMs: 1,
      ctimeMs: 1,
      size: 0,
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    };
    const fileStat = {
      mtimeMs: 1,
      ctimeMs: 1,
      size: 1,
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    let rootRealpathCalls = 0;
    const fsMock = {
      lstatSync: (candidate) =>
        candidate === filePath ? fileStat : directoryStat,
      realpathSync: (candidate) => {
        if (candidate !== root) return candidate;
        rootRealpathCalls += 1;
        return rootRealpathCalls <= 3 ? root : outside;
      },
      readdirSync: () => [{ name: "outside-secret.txt" }],
    };

    const result = scanRoots([root], { fs: fsMock, maxRecords: 10 });
    expect(result.records).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining(["DIRECTORY_CHANGED", "ROOT_INCOMPLETE"]),
    );
  });

  it("skips dot-prefixed, excluded and symlink-like cache trees by policy", async () => {
    const root = join(tmpDir, "root");
    mkdirSync(root);
    makeFile("root/normal.txt", "ok", 1_700_000_001_000);
    makeFile("root/.hidden", "skip", 1_700_000_001_000);
    makeFile("root/.cache/value.txt", "skip", 1_700_000_001_000);
    makeFile("root/xwechat_files/a.txt", "skip", 1_700_000_001_000);
    makeFile("root/WXWork/b.txt", "skip", 1_700_000_001_000);
    makeFile("root/node_modules/c.txt", "skip", 1_700_000_001_000);
    makeFile("root/.git/config", "skip", 1_700_000_001_000);
    const rows = await collect(new LocalFilesAdapter({ roots: [root] }).sync());
    expect(rows.map((row) => row.payload.name)).toEqual(["normal.txt"]);
  });

  it("short-circuits an all-off request before root discovery or completion", async () => {
    const discover = vi.fn(() => {
      throw new Error("must not discover");
    });
    const complete = vi.fn();
    const adapter = new LocalFilesAdapter({ defaultRoots: discover });
    await expect(
      adapter.healthCheck({ include: { files: false } }),
    ).resolves.toMatchObject({ ok: true, skipped: true });
    const rows = await collect(
      adapter.sync({
        include: { files: false },
        markWatermarkComplete: complete,
      }),
    );
    expect(rows).toEqual([]);
    expect(discover).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("exposes scanner incompleteness to direct callers", () => {
    const root = join(tmpDir, "root");
    mkdirSync(root);
    makeFile("root/a.txt", "a", 1_700_000_001_000);
    makeFile("root/b.txt", "b", 1_700_000_002_000);
    const result = scanRoots([root], { maxRecords: 1 });
    expect(result.records).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(result.issues).toContain("FILE_LIMIT");
  });

  it("marks a per-root cap incomplete only when another file exists", () => {
    const truncatedRoot = join(tmpDir, "truncated");
    const exactRoot = join(tmpDir, "exact");
    mkdirSync(truncatedRoot);
    mkdirSync(exactRoot);
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      makeFile(`truncated/${name}`, name, 1_700_000_001_000);
    }
    for (const name of ["a.txt", "b.txt"]) {
      makeFile(`exact/${name}`, name, 1_700_000_001_000);
    }

    const truncated = scanRoots([truncatedRoot], {
      maxRecords: 10,
      maxFilesPerRoot: 2,
    });
    expect(truncated.records).toHaveLength(2);
    expect(truncated.complete).toBe(false);
    expect(truncated.issues).toContain("FILE_LIMIT");

    const exact = scanRoots([exactRoot], {
      maxRecords: 10,
      maxFilesPerRoot: 2,
    });
    expect(exact.records).toHaveLength(2);
    expect(exact.complete).toBe(true);
  });

  it("fails closed when an enqueued directory resolves outside its root", () => {
    const root = join(tmpDir, "root");
    const swapped = join(root, "swapped");
    const outside = join(tmpDir, "outside");
    const childReads = vi.fn(() => [{ name: "outside-secret.txt" }]);
    const directoryStat = {
      mtimeMs: 1,
      ctimeMs: 1,
      size: 0,
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    };
    let swappedRealpathCalls = 0;
    const fsMock = {
      lstatSync: () => directoryStat,
      realpathSync: (candidate) => {
        if (candidate !== swapped) return candidate;
        swappedRealpathCalls += 1;
        return swappedRealpathCalls <= 2 ? swapped : outside;
      },
      readdirSync: (directory) => {
        if (directory === root) return [{ name: "swapped" }];
        return childReads();
      },
    };

    const result = scanRoots([root], {
      fs: fsMock,
      maxRecords: 10,
    });

    expect(result.records).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.issues).toContain("PATH_ESCAPE");
    expect(childReads).not.toHaveBeenCalled();
  });
});

describe("LocalFilesAdapter normalize", () => {
  it("maps privacy-safe metadata to a valid Event", async () => {
    const root = join(tmpDir, "root");
    mkdirSync(root);
    makeFile("root/report.pdf", "x", 1_700_000_005_000);
    const adapter = new LocalFilesAdapter({ roots: [root] });
    const [raw] = await collect(adapter.sync());
    const { events } = adapter.normalize(raw);
    const [event] = events;

    expect(event.subtype).toBe(EVENT_SUBTYPES.OTHER);
    expect(event.actor).toBe("self");
    expect(event.content).toEqual({
      title: "[file] report.pdf",
      text: "report.pdf",
    });
    expect(event.extra).toMatchObject({
      kind: "local-file",
      extension: "pdf",
      size: 1,
      rootCategory: "selected",
      relativeDepth: 0,
    });
    expect(event.extra).not.toHaveProperty("path");
    expect(event.extra).not.toHaveProperty("root");
    expect(validateEvent(event).valid).toBe(true);
    expect(JSON.stringify(event)).not.toContain(root);
  });

  it("sanitizes legacy path-bearing raw envelopes instead of propagating paths", () => {
    const adapter = new LocalFilesAdapter();
    const privateRoot = join(tmpDir, "private");
    const legacyId = `local-file:${join(privateRoot, "report.txt")}:1700000000000`;
    const { events } = adapter.normalize({
      kind: "local-file",
      originalId: legacyId,
      capturedAt: 1_700_000_000_000,
      payload: {
        path: join(privateRoot, "report.txt"),
        root: privateRoot,
        name: "report.txt",
        ext: "txt",
        size: 4,
        mtimeMs: 1_700_000_000_000,
      },
    });
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain(privateRoot);
    expect(serialized).not.toContain(legacyId);
    expect(events[0].source.originalId).toMatch(
      /^local-file-entry:[a-f0-9]{48}$/u,
    );
  });

  it("bounds and sanitizes crafted filenames", () => {
    const adapter = new LocalFilesAdapter();
    const { events } = adapter.normalize({
      kind: "local-file",
      originalId: "crafted",
      capturedAt: 1_700_000_000_000,
      payload: {
        name: `C:\\Users\\private-owner\\${"x".repeat(300)}\u0000.txt`,
        size: 0,
      },
    });
    expect(events[0].content.title.length).toBeLessThanOrEqual(100);
    expect(events[0].content.title).not.toContain("/");
    expect(events[0].content.title).not.toContain("private-owner");
    expect(events[0].content.title).not.toContain("\u0000");
  });

  it("rejects unsupported raw kinds", () => {
    expect(() => new LocalFilesAdapter().normalize({ kind: "bogus" })).toThrow(
      /unknown raw\.kind=bogus/u,
    );
  });
});
