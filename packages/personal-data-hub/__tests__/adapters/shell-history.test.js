"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodeFs from "node:fs";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  ShellHistoryAdapter,
  SHELL_HISTORY_NAME,
  SHELL_HISTORY_VERSION,
  readHistoryFile,
} = require("../../lib/adapters/shell-history");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES } = require("../../lib/constants");
const { validateEvent } = require("../../lib/schemas");

let tmpDir;

function makeHistFile(name, lines, mtimeMs) {
  const file = join(tmpDir, name);
  writeFileSync(file, `${lines.join("\n")}\n`, "utf-8");
  if (mtimeMs) utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  return file;
}

async function collect(iterable) {
  const values = [];
  for await (const value of iterable) values.push(value);
  return values;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "shell-hist-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ShellHistoryAdapter contract and identity", () => {
  it("conforms to the PersonalDataAdapter contract", () => {
    expect(assertAdapter(new ShellHistoryAdapter())).toEqual({ ok: true });
  });

  it("declares v0.2.0 bounded complete-scan watermark semantics", () => {
    const adapter = new ShellHistoryAdapter();
    expect(adapter.name).toBe(SHELL_HISTORY_NAME);
    expect(adapter.name).toBe("shell-history");
    expect(adapter.version).toBe(SHELL_HISTORY_VERSION);
    expect(adapter.version).toBe("0.2.0");
    expect(adapter.capabilities).toContain("sync:shell-history-files");
    expect(adapter.watermarkStrategy).toBe("max-captured-at");
    expect(adapter.watermarkRequiresCompleteScan).toBe(true);
    expect(adapter.watermarkLookbackMs).toBe(1_000);
    expect(adapter.initialPageBudget).toBeGreaterThan(0);
  });

  it("isolates the default scope by canonical source set", () => {
    const first = makeHistFile("first.txt", ["one"], 1_700_000_001_000);
    const second = makeHistFile("second.txt", ["two"], 1_700_000_002_000);
    const adapter = new ShellHistoryAdapter();
    const firstSet = [
      { shell: "bash", file: first },
      { shell: "zsh", file: second },
    ];

    expect(adapter.resolveDefaultScope({ sources: firstSet })).toBe(
      adapter.resolveDefaultScope({ sources: [...firstSet].reverse() }),
    );
    expect(adapter.resolveDefaultScope({ sources: firstSet })).not.toBe(
      adapter.resolveDefaultScope({
        sources: [{ shell: "bash", file: first }],
      }),
    );
    expect(adapter.resolveDefaultScope({ sources: firstSet })).not.toContain(
      tmpDir,
    );
  });

  it("auth reports only safe source descriptors", async () => {
    const historyFile = makeHistFile(
      "private-history-name.txt",
      ["safe-test-command"],
      1_700_000_001_000,
    );
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: historyFile }],
    });
    const auth = await adapter.authenticate();

    expect(auth.ok).toBe(true);
    expect(auth.sourceCount).toBe(1);
    expect(auth.sources[0]).toMatchObject({
      shell: "bash",
      sourceName: "bash-history",
    });
    expect(auth.sources[0].sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(auth)).not.toContain(historyFile);
    expect(JSON.stringify(auth)).not.toContain(tmpDir);
  });

  it("returns a path-free error for an invalid source", async () => {
    const sensitivePath = join(tmpDir, "sensitive", "history.txt");
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: "" }],
    });
    const auth = await adapter.authenticate({
      sources: [{ shell: "bash", file: "" }],
    });
    expect(auth).toMatchObject({
      ok: false,
      reason: "INVALID_HISTORY_SOURCE",
    });
    expect(JSON.stringify(auth)).not.toContain(sensitivePath);

    let error;
    try {
      await collect(adapter.sync({ sources: [{ shell: "bash", file: "" }] }));
    } catch (caught) {
      error = caught;
    }
    expect(error?.code).toBe("INVALID_HISTORY_SOURCE");
    expect(error?.message).not.toContain(tmpDir);
  });

  it("rejects unknown shells instead of collapsing them to a generic source", async () => {
    const historyFile = makeHistFile(
      "fish-history.txt",
      ["echo private"],
      1_700_000_001_000,
    );
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "fish", file: historyFile }],
    });

    expect(await adapter.authenticate()).toMatchObject({
      ok: false,
      reason: "INVALID_HISTORY_SOURCE",
    });
    await expect(collect(adapter.sync())).rejects.toMatchObject({
      code: "INVALID_HISTORY_SOURCE",
    });
  });

  it("honors an explicit empty source list instead of falling back", async () => {
    const historyFile = makeHistFile(
      "configured.txt",
      ["echo configured"],
      1_700_000_001_000,
    );
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: historyFile }],
    });

    expect(await adapter.authenticate({ sources: [] })).toMatchObject({
      ok: false,
      reason: "NO_HISTORY_SOURCES",
    });
    await expect(collect(adapter.sync({ sources: [] }))).rejects.toMatchObject({
      code: "NO_HISTORY_SOURCES",
    });
  });

  it("distinguishes absent optional defaults from missing explicit sources", async () => {
    const missing = join(tmpDir, "missing-history.txt");
    const defaults = new ShellHistoryAdapter({
      defaultHistorySources: () => [
        { shell: "bash", file: missing, optional: true },
      ],
    });
    expect(await defaults.authenticate()).toMatchObject({
      ok: false,
      reason: "NO_HISTORY_SOURCES",
    });

    const explicit = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: missing, optional: true }],
    });
    expect(await explicit.authenticate()).toMatchObject({
      ok: false,
      reason: "INVALID_HISTORY_SOURCE",
    });
    expect(await explicit.healthCheck()).toMatchObject({
      ok: false,
      reason: "INVALID_HISTORY_SOURCE",
    });
  });

  it("deduplicates canonical sources and enforces bounded source counts", async () => {
    const historyFile = makeHistFile(
      "deduplicated.txt",
      ["echo once"],
      1_700_000_001_000,
    );
    const duplicateSources = [
      { shell: "pwsh", file: historyFile },
      { shell: "PowerShell", file: historyFile },
    ];
    const adapter = new ShellHistoryAdapter({ sources: duplicateSources });

    expect(await adapter.authenticate()).toMatchObject({
      ok: true,
      sourceCount: 1,
    });
    expect(await collect(adapter.sync())).toHaveLength(1);

    expect(
      () =>
        new ShellHistoryAdapter({
          sources: [{ shell: "bash", file: historyFile }],
          maxSources: 129,
        }),
    ).toThrow(/maxSources/);
    await expect(
      collect(
        adapter.sync({
          sources: [
            { shell: "bash", file: historyFile },
            { shell: "zsh", file: historyFile },
          ],
          maxSources: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "SHELL_HISTORY_SOURCE_LIMIT" });
  });
});

describe("ShellHistoryAdapter.sync", () => {
  it("expands scan and reader defaults beyond the former record ceiling", async () => {
    const historyFile = join(tmpDir, "adaptive-budget.txt");
    let readerOptions = null;
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: historyFile }],
      readAllHistory: (_sources, options) => {
        readerOptions = options;
        return {
          next: () => ({ done: true, value: { complete: true } }),
        };
      },
    });
    let watermarkComplete = false;

    await collect(
      adapter.sync({
        pageSize: 10_000,
        maxPages: 101,
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );

    expect(readerOptions).toMatchObject({
      maxRecords: 1_010_000,
      maxFileBytes: 64 * 1024 * 1024,
      maxLines: 1_000_000,
      maxCommandChars: 262_144,
    });
    expect(watermarkComplete).toBe(true);
  });

  it("does not discover or read command history after an explicit opt-out", async () => {
    let discoveryCalls = 0;
    let readCalls = 0;
    const adapter = new ShellHistoryAdapter({
      defaultHistorySources: () => {
        discoveryCalls += 1;
        return [];
      },
      readAllHistory: () => {
        readCalls += 1;
        return [][Symbol.iterator]();
      },
    });
    discoveryCalls = 0;

    let watermarkComplete = false;
    expect(
      await collect(
        adapter.sync({
          include: { commands: false },
          markWatermarkComplete: () => {
            watermarkComplete = true;
          },
        }),
      ),
    ).toEqual([]);
    expect(discoveryCalls).toBe(0);
    expect(readCalls).toBe(0);
    expect(watermarkComplete).toBe(false);
  });

  it("yields one row per non-blank line and never archives source paths", async () => {
    const pwshFile = makeHistFile(
      "pwsh.txt",
      ["ls", "git status", "", "npm test"],
      1_700_000_010_000,
    );
    const bashFile = makeHistFile(
      "bash.txt",
      ["cd /tmp", "make"],
      1_700_000_020_000,
    );
    const adapter = new ShellHistoryAdapter({
      sources: [
        { shell: "pwsh", file: pwshFile },
        { shell: "bash", file: bashFile },
      ],
    });
    const raws = await collect(adapter.sync());

    expect(raws).toHaveLength(5);
    expect(raws[0].payload).toMatchObject({
      shell: "pwsh",
      sourceName: "powershell-history",
      value: "ls",
      capturedAt: 1_700_000_010_000,
      snapshotTs: 1_700_000_010_000,
      timestampSource: "file-mtime",
    });
    expect(raws[0].capturedAt).toBe(1_700_000_010_000);
    expect(raws[0].payload.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(raws[0].payload).not.toHaveProperty("file");
    expect(raws[3].payload).toMatchObject({
      shell: "bash",
      value: "cd /tmp",
    });
    expect(JSON.stringify(raws)).not.toContain(pwshFile);
    expect(JSON.stringify(raws)).not.toContain(bashFile);
  });

  it("prefers zsh extended-history timestamps over file mtime", async () => {
    const zshFile = makeHistFile(
      "zsh.txt",
      [
        ": 1700000001:0;ls -la",
        ": 1700000002:5;npm install",
        "plain-line-without-prefix",
      ],
      1_700_000_030_000,
    );
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "zsh", file: zshFile }],
    });
    const raws = await collect(adapter.sync());

    expect(raws.map((raw) => raw.payload.value)).toEqual([
      "ls -la",
      "npm install\nplain-line-without-prefix",
    ]);
    expect(raws.map((raw) => raw.capturedAt)).toEqual([
      1_700_000_001_000, 1_700_000_002_000,
    ]);
    expect(raws.map((raw) => raw.payload.timestampSource)).toEqual([
      "zsh-extended-history",
      "zsh-extended-history",
    ]);
  });

  it("uses a bash #<epoch> marker for the next non-blank command", async () => {
    const bashFile = makeHistFile(
      "bash-timestamps.txt",
      ["#1700000001", "", "first", "#1700000002", "second", "fallback"],
      1_700_000_030_000,
    );
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: bashFile }],
    });
    const raws = await collect(adapter.sync());

    expect(raws.map((raw) => raw.payload.value)).toEqual([
      "first",
      "second\nfallback",
    ]);
    expect(raws.map((raw) => raw.capturedAt)).toEqual([
      1_700_000_001_000, 1_700_000_002_000,
    ]);
    expect(raws.map((raw) => raw.payload.timestampSource)).toEqual([
      "bash-epoch",
      "bash-epoch",
    ]);
  });

  it("keeps PSReadLine backtick continuations as one command", async () => {
    const historyFile = makeHistFile(
      "pwsh-multiline.txt",
      [
        "Get-ChildItem `",
        "  | Where-Object Length -gt 0 `",
        "  | Select-Object -First 1",
        "Get-Date",
      ],
      1_700_000_030_000,
    );
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "pwsh", file: historyFile }],
    });

    const raws = await collect(adapter.sync());

    expect(raws.map((raw) => raw.payload.value)).toEqual([
      "Get-ChildItem `\n  | Where-Object Length -gt 0 `\n  | Select-Object -First 1",
      "Get-Date",
    ]);
    expect(new Set(raws.map((raw) => raw.originalId)).size).toBe(2);
  });

  it("groups every line between Bash and zsh history delimiters", () => {
    const bashFile = makeHistFile(
      "bash-multiline.txt",
      [
        "#1700000001",
        "for item in one two; do",
        '  echo "$item"',
        "done",
        "#1700000002",
        "printf done",
      ],
      1_700_000_030_000,
    );
    const zshFile = makeHistFile(
      "zsh-multiline.txt",
      [
        ": 1700000001:0;for item in one two; do",
        '  echo "$item"',
        "done",
        ": 1700000002:0;printf done",
      ],
      1_700_000_030_000,
    );

    expect(
      readHistoryFile({ shell: "bash", file: bashFile }).rows.map(
        (row) => row.value,
      ),
    ).toEqual(['for item in one two; do\n  echo "$item"\ndone', "printf done"]);
    expect(
      readHistoryFile({ shell: "zsh", file: zshFile }).rows.map(
        (row) => row.value,
      ),
    ).toEqual(['for item in one two; do\n  echo "$item"\ndone', "printf done"]);
  });

  it("defers and drops a truncated multiline tail", () => {
    const historyFile = makeHistFile(
      "truncated-multiline.txt",
      ["Get-ChildItem `", "  | Select-Object -First 1"],
      1_700_000_030_000,
    );
    const parsed = readHistoryFile(
      { shell: "pwsh", file: historyFile },
      { maxLines: 1 },
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.complete).toBe(false);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        "SOURCE_LINE_LIMIT",
        "POWERSHELL_RECORD_TRUNCATED",
      ]),
    );
  });

  it("uses sourceHash, contentHash, and occurrence for originalId", async () => {
    const historyFile = makeHistFile(
      "duplicates.txt",
      ["ls", "ls", "ls"],
      1_700_000_001_000,
    );
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: historyFile }],
    });
    const raws = await collect(adapter.sync());

    expect(raws.map((raw) => raw.payload.occurrence)).toEqual([0, 1, 2]);
    expect(new Set(raws.map((raw) => raw.originalId)).size).toBe(3);
    for (const raw of raws) {
      expect(raw.payload.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(raw.payload.entryHash).toBe(raw.payload.contentHash);
      expect(raw.originalId).toBe(
        `shell-cmd:${raw.payload.sourceHash}:${raw.payload.contentHash}:${raw.payload.occurrence}`,
      );
      expect(raw.originalId).not.toContain(historyFile);
    }
  });

  it("uses timestamp-aware entry hashes only for embedded timestamp rows", async () => {
    const timestampedFile = makeHistFile(
      "timestamp-identity.txt",
      ["#1700000001", "same-command", "#1700000002", "same-command"],
      1_700_000_030_000,
    );
    const timestampedAdapter = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: timestampedFile }],
    });
    const timestamped = await collect(timestampedAdapter.sync());

    expect(timestamped.map((raw) => raw.payload.contentHash)).toEqual([
      timestamped[0].payload.contentHash,
      timestamped[0].payload.contentHash,
    ]);
    expect(timestamped.map((raw) => raw.payload.occurrence)).toEqual([0, 0]);
    expect(timestamped[0].payload.entryHash).not.toBe(
      timestamped[1].payload.entryHash,
    );
    expect(timestamped[0].originalId).not.toBe(timestamped[1].originalId);
    expect(timestampedAdapter.normalize(timestamped[0]).events[0].id).not.toBe(
      timestampedAdapter.normalize(timestamped[1]).events[0].id,
    );

    const fallbackFile = makeHistFile(
      "mtime-identity.txt",
      ["same-command"],
      1_700_000_001_000,
    );
    const fallbackAdapter = new ShellHistoryAdapter({
      sources: [{ shell: "pwsh", file: fallbackFile }],
    });
    const [before] = await collect(fallbackAdapter.sync());
    writeFileSync(fallbackFile, "same-command\nnew-command\n", "utf-8");
    utimesSync(
      fallbackFile,
      1_700_000_050_000 / 1000,
      1_700_000_050_000 / 1000,
    );
    const [after] = await collect(fallbackAdapter.sync());

    expect(after.payload.entryHash).toBe(after.payload.contentHash);
    expect(after.originalId).toBe(before.originalId);
    expect(fallbackAdapter.normalize(after).events[0].id).toBe(
      fallbackAdapter.normalize(before).events[0].id,
    );
  });

  it("filters by the selected row timestamp", async () => {
    const oldFile = makeHistFile("old.txt", ["old"], 1_700_000_001_000);
    const newFile = makeHistFile("new.txt", ["new"], 1_700_000_005_000);
    const adapter = new ShellHistoryAdapter({
      sources: [
        { shell: "pwsh", file: oldFile },
        { shell: "bash", file: newFile },
      ],
    });

    const raws = await collect(adapter.sync({ since: 1_700_000_003_000 }));
    expect(raws.map((raw) => raw.payload.value)).toEqual(["new"]);
  });

  it("does not mark a limit-truncated scan complete", async () => {
    const historyFile = makeHistFile(
      "limited.txt",
      ["1", "2", "3", "4", "5"],
      1_700_000_001_000,
    );
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "pwsh", file: historyFile }],
    });
    let watermarkComplete = false;
    const raws = await collect(
      adapter.sync({
        limit: 2,
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );

    expect(raws).toHaveLength(2);
    expect(watermarkComplete).toBe(false);
  });

  it("explicit missing files defer completion without exposing their path", async () => {
    const missing = join(tmpDir, "nonexistent.txt");
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "pwsh", file: missing, optional: true }],
    });
    let watermarkComplete = false;
    const raws = await collect(
      adapter.sync({
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );
    expect(raws).toEqual([]);
    expect(watermarkComplete).toBe(false);
    expect(JSON.stringify(raws)).not.toContain(missing);
  });

  it("treats absent optional default history files as complete", async () => {
    const missing = join(tmpDir, "absent-default.txt");
    const adapter = new ShellHistoryAdapter({
      defaultHistorySources: () => [
        { shell: "bash", file: missing, optional: true },
      ],
    });
    let watermarkComplete = false;
    const raws = await collect(
      adapter.sync({
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );

    expect(raws).toEqual([]);
    expect(watermarkComplete).toBe(true);
  });

  it("marks a watermark complete only after a full scan", async () => {
    const historyFile = makeHistFile(
      "complete.txt",
      ["one", "two"],
      1_700_000_001_000,
    );
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: historyFile }],
    });
    let watermarkComplete = false;
    const raws = await collect(
      adapter.sync({
        pageSize: 2,
        maxPages: 1,
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );

    expect(raws).toHaveLength(2);
    expect(watermarkComplete).toBe(true);
  });

  it("defers the watermark when pageSize times maxPages truncates the scan", async () => {
    const historyFile = makeHistFile(
      "paged.txt",
      ["one", "two", "three"],
      1_700_000_001_000,
    );
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: historyFile }],
    });
    let watermarkComplete = false;
    const raws = await collect(
      adapter.sync({
        pageSize: 1,
        maxPages: 2,
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );

    expect(raws.map((raw) => raw.payload.value)).toEqual(["one", "two"]);
    expect(watermarkComplete).toBe(false);
  });

  it("defers the watermark on file, line, and command truncation", async () => {
    const cases = [
      {
        name: "file-size",
        lines: ["one", "two"],
        options: { maxFileBytes: 3 },
        expected: [],
      },
      {
        name: "line-count",
        lines: ["one", "two", "three"],
        options: { maxLines: 2 },
        expected: ["one", "two"],
      },
      {
        name: "command-length",
        lines: ["12345", "ok"],
        options: { maxCommandChars: 4 },
        expected: ["ok"],
      },
    ];

    for (const testCase of cases) {
      const historyFile = makeHistFile(
        `${testCase.name}.txt`,
        testCase.lines,
        1_700_000_001_000,
      );
      const adapter = new ShellHistoryAdapter({
        sources: [{ shell: "bash", file: historyFile }],
      });
      let watermarkComplete = false;
      const raws = await collect(
        adapter.sync({
          ...testCase.options,
          markWatermarkComplete: () => {
            watermarkComplete = true;
          },
        }),
      );
      expect(raws.map((raw) => raw.payload.value)).toEqual(testCase.expected);
      expect(watermarkComplete).toBe(false);
    }
  });

  it("defers the watermark on invalid UTF-8", async () => {
    const historyFile = join(tmpDir, "invalid-utf8.txt");
    writeFileSync(historyFile, Buffer.from([0xc3, 0x28]));
    utimesSync(historyFile, 1_700_000_001_000 / 1000, 1_700_000_001_000 / 1000);
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: historyFile }],
    });
    let watermarkComplete = false;
    const raws = await collect(
      adapter.sync({
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );

    expect(raws).toEqual([]);
    expect(watermarkComplete).toBe(false);
  });

  it("defers completion when a stable-stat read returns fewer bytes", async () => {
    const historyFile = makeHistFile(
      "short-read.txt",
      ["one", "two"],
      1_700_000_001_000,
    );
    let readCalls = 0;
    const shortReadFs = new Proxy(nodeFs, {
      get(target, property) {
        if (property !== "readSync") return target[property];
        return (descriptor, buffer, offset, length, position) => {
          readCalls += 1;
          if (readCalls > 1) return 0;
          return target.readSync(
            descriptor,
            buffer,
            offset,
            Math.min(1, length),
            position,
          );
        };
      },
    });
    const parsed = readHistoryFile(
      { shell: "bash", file: historyFile },
      { fs: shortReadFs },
    );

    expect(parsed).toMatchObject({
      complete: false,
      rows: [],
      issues: ["SOURCE_SHORT_READ"],
    });
  });

  it("requires stable descriptor stats and a successful close", () => {
    const historyFile = makeHistFile(
      "descriptor-stability.txt",
      ["one", "two"],
      1_700_000_001_000,
    );
    let fstatCalls = 0;
    const changingDescriptorFs = new Proxy(nodeFs, {
      get(target, property) {
        if (property !== "fstatSync") return target[property];
        return (descriptor) => {
          fstatCalls += 1;
          const actual = target.fstatSync(descriptor);
          return fstatCalls >= 2
            ? { ...actual, mtimeMs: actual.mtimeMs + 1 }
            : actual;
        };
      },
    });
    expect(
      readHistoryFile(
        { shell: "bash", file: historyFile },
        { fs: changingDescriptorFs },
      ),
    ).toMatchObject({
      complete: false,
      rows: [],
      issues: ["SOURCE_DESCRIPTOR_UNSTABLE"],
    });

    const closeFailingFs = new Proxy(nodeFs, {
      get(target, property) {
        if (property !== "closeSync") return target[property];
        return (descriptor) => {
          target.closeSync(descriptor);
          throw new Error("close failed");
        };
      },
    });
    expect(
      readHistoryFile(
        { shell: "bash", file: historyFile },
        { fs: closeFailingFs },
      ),
    ).toMatchObject({
      complete: false,
      rows: [],
      issues: ["SOURCE_CLOSE_FAILED"],
    });
  });

  it("bounds embedded epochs and defers malformed or future records", async () => {
    const now = 1_700_000_000_000;
    const bashFile = makeHistFile(
      "bounded-epochs.txt",
      [
        "#1700086401",
        "future-fallback",
        "#946684799",
        "past-fallback",
        "#1700000000",
        "valid-embedded",
      ],
      1_700_000_010_000,
    );
    const parsed = readHistoryFile({ shell: "bash", file: bashFile }, { now });

    expect(parsed.complete).toBe(false);
    expect(parsed.issues).toContain("BASH_TIMESTAMP_INVALID");
    expect(parsed.rows.map((row) => row.timestampSource)).toEqual([
      "file-mtime",
      "file-mtime",
      "bash-epoch",
    ]);
    expect(parsed.rows[2].capturedAt).toBe(now);

    const zshFile = makeHistFile(
      "malformed-zsh.txt",
      [": 1700086401:0;future", ": 1700000000:not-a-duration;malformed"],
      1_700_000_010_000,
    );
    const zsh = readHistoryFile({ shell: "zsh", file: zshFile }, { now });
    expect(zsh.complete).toBe(false);
    expect(zsh.rows).toEqual([]);
    expect(zsh.issues).toEqual(
      expect.arrayContaining(["ZSH_TIMESTAMP_INVALID", "ZSH_RECORD_MALFORMED"]),
    );
  });

  it("closes the underlying iterator on early consumer exit and read errors", async () => {
    const historyFile = makeHistFile(
      "iterator-cleanup.txt",
      ["placeholder"],
      1_700_000_001_000,
    );
    const row = {
      shell: "bash",
      sourceName: "bash-history",
      sourceHash: "a".repeat(64),
      value: "echo cleanup",
      contentHash: "b".repeat(64),
      entryHash: "b".repeat(64),
      occurrence: 0,
      sourceIndex: 0,
      capturedAt: 1_700_000_001_000,
      snapshotTs: 1_700_000_001_000,
      timestampSource: "file-mtime",
    };
    let earlyReturnCalls = 0;
    const earlyAdapter = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: historyFile }],
      readAllHistory: () => ({
        next: () => ({ done: false, value: row }),
        return: () => {
          earlyReturnCalls += 1;
          return { done: true };
        },
      }),
    });
    for await (const raw of earlyAdapter.sync()) {
      expect(raw.kind).toBe("shell-command");
      break;
    }
    expect(earlyReturnCalls).toBe(1);

    let errorReturnCalls = 0;
    const errorAdapter = new ShellHistoryAdapter({
      sources: [{ shell: "bash", file: historyFile }],
      readAllHistory: () => ({
        next: () => {
          throw new Error(historyFile);
        },
        return: () => {
          errorReturnCalls += 1;
          return { done: true };
        },
      }),
    });
    await expect(collect(errorAdapter.sync())).rejects.toMatchObject({
      code: "SHELL_HISTORY_READ_FAILED",
    });
    expect(errorReturnCalls).toBe(1);
  });
});

describe("ShellHistoryAdapter.normalize", () => {
  it("maps shell-command to a path-free schema-valid Event", () => {
    const adapter = new ShellHistoryAdapter();
    const historyFile = join(tmpDir, "must-not-leak.txt");
    const { events } = adapter.normalize({
      kind: "shell-command",
      originalId: "legacy-shell-command",
      capturedAt: 1_700_000_005_000,
      payload: {
        shell: "bash",
        file: historyFile,
        value: "git status",
        sourceIndex: 0,
        snapshotTs: 1_700_000_001_000,
        timestampSource: "file-mtime",
      },
    });

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.subtype).toBe(EVENT_SUBTYPES.OTHER);
    expect(event.actor).toBe("self");
    expect(event.content).toEqual({
      title: "[bash] git status",
      text: "git status",
    });
    expect(event.occurredAt).toBe(1_700_000_005_000);
    expect(event.extra).toMatchObject({
      kind: "shell-command",
      shell: "bash",
      sourceName: "bash-history",
      sourceIndex: 0,
      timestampSource: "file-mtime",
      temporalSemantics: "first-observed-snapshot",
    });
    expect(event.extra.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.extra.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.extra).not.toHaveProperty("file");
    expect(JSON.stringify(event)).not.toContain(historyFile);
    expect(JSON.stringify(event)).not.toContain(tmpDir);
    expect(validateEvent(event).valid).toBe(true);
  });

  it("uses the precise shell timestamp and timestampSource in the entity", () => {
    const adapter = new ShellHistoryAdapter();
    const { events } = adapter.normalize({
      kind: "shell-command",
      capturedAt: 1_700_000_002_000,
      payload: {
        shell: "zsh",
        sourceName: "zsh-history",
        sourceHash: "a".repeat(64),
        contentHash: "b".repeat(64),
        occurrence: 0,
        value: "echo test",
        timestampSource: "zsh-extended-history",
      },
    });
    expect(events[0].occurredAt).toBe(1_700_000_002_000);
    expect(events[0].extra.timestampSource).toBe("zsh-extended-history");
    expect(validateEvent(events[0]).valid).toBe(true);
  });

  it("preserves an embedded timestamp through sync and normalize", async () => {
    const historyFile = makeHistFile(
      "zsh-normalize.txt",
      [": 1700000001:0;echo test"],
      1_700_000_030_000,
    );
    const adapter = new ShellHistoryAdapter({
      sources: [{ shell: "zsh", file: historyFile }],
    });
    const [raw] = await collect(adapter.sync());
    const { events } = adapter.normalize(raw);

    expect(raw.capturedAt).toBe(1_700_000_001_000);
    expect(raw.payload.snapshotTs).toBe(1_700_000_030_000);
    expect(events[0].occurredAt).toBe(1_700_000_001_000);
    expect(events[0].extra.timestampSource).toBe("zsh-extended-history");
  });

  it("truncates long commands in the title and keeps full bounded text", () => {
    const adapter = new ShellHistoryAdapter();
    const longCommand = `echo ${"x".repeat(300)}`;
    const { events } = adapter.normalize({
      kind: "shell-command",
      capturedAt: 1_700_000_000_000,
      originalId: "legacy-long-command",
      payload: {
        shell: "pwsh",
        value: longCommand,
        sourceIndex: 0,
        snapshotTs: 1_700_000_000_000,
      },
    });
    expect(events[0].content.title.length).toBeLessThanOrEqual(101);
    expect(events[0].content.title.endsWith("…")).toBe(true);
    expect(events[0].content.text).toBe(longCommand);
  });

  it("throws a sanitized error on an unknown raw kind", () => {
    expect(() =>
      new ShellHistoryAdapter().normalize({
        kind: join(tmpDir, "sensitive-kind"),
      }),
    ).toThrow(/unsupported raw record kind/);
    try {
      new ShellHistoryAdapter().normalize({
        kind: join(tmpDir, "sensitive-kind"),
      });
    } catch (error) {
      expect(error.message).not.toContain(tmpDir);
    }
  });

  it("throws a sanitized error for crafted invalid timestamps", () => {
    const sensitiveTimestamp = join(tmpDir, "not-a-timestamp");
    const adapter = new ShellHistoryAdapter();
    const cases = [
      {
        kind: "shell-command",
        capturedAt: 0,
        payload: { shell: "bash", value: "echo zero" },
      },
      {
        kind: "shell-command",
        capturedAt: 1_700_000_001_000,
        payload: {
          shell: "bash",
          value: "echo string",
          capturedAt: sensitiveTimestamp,
        },
      },
      {
        kind: "shell-command",
        capturedAt: 1_700_000_001_000,
        payload: {
          shell: "pwsh",
          value: "echo negative",
          snapshotTs: -1,
        },
      },
    ];

    for (const raw of cases) {
      let error;
      try {
        adapter.normalize(raw);
      } catch (caught) {
        error = caught;
      }
      expect(error?.code).toBe("SHELL_HISTORY_INVALID_TIMESTAMP");
      expect(error?.message).toBe("shell-history.normalize: invalid timestamp");
      expect(error?.message).not.toContain(tmpDir);
      expect(error?.message).not.toContain(sensitiveTimestamp);
    }
  });
});
