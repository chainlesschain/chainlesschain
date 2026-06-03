"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  ShellHistoryAdapter,
  SHELL_HISTORY_NAME,
  SHELL_HISTORY_VERSION,
} = require("../../lib/adapters/shell-history");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES } = require("../../lib/constants");
const { validateEvent } = require("../../lib/schemas");

let tmpDir;

function makeHistFile(name, lines, mtimeMs) {
  const p = join(tmpDir, name);
  writeFileSync(p, lines.join("\n") + "\n", "utf-8");
  if (mtimeMs) utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
  return p;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "shell-hist-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ShellHistoryAdapter — contract + identity", () => {
  it("conforms to PersonalDataAdapter contract", () => {
    expect(assertAdapter(new ShellHistoryAdapter())).toEqual({ ok: true });
  });

  it("identifies as shell-history with sync:shell-history-files capability", () => {
    const a = new ShellHistoryAdapter();
    expect(a.name).toBe(SHELL_HISTORY_NAME);
    expect(a.name).toBe("shell-history");
    expect(a.version).toBe(SHELL_HISTORY_VERSION);
    expect(a.capabilities).toContain("sync:shell-history-files");
  });
});

describe("ShellHistoryAdapter.sync", () => {
  it("yields one row per non-blank line per configured shell", async () => {
    const pwshFile = makeHistFile("pwsh.txt", ["ls", "git status", "", "npm test"], 1_700_000_010_000);
    const bashFile = makeHistFile("bash.txt", ["cd /tmp", "make"], 1_700_000_020_000);
    const a = new ShellHistoryAdapter({
      sources: [
        { shell: "pwsh", file: pwshFile },
        { shell: "bash", file: bashFile },
      ],
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(5); // 3 pwsh (blank skipped) + 2 bash
    expect(raws[0].payload.shell).toBe("pwsh");
    expect(raws[0].payload.value).toBe("ls");
    expect(raws[0].payload.snapshotTs).toBe(1_700_000_010_000);
    expect(raws[3].payload.shell).toBe("bash");
    expect(raws[3].payload.value).toBe("cd /tmp");
  });

  it("strips zsh extended history prefix", async () => {
    const zshFile = makeHistFile(
      "zsh.txt",
      [
        ": 1700000001:0;ls -la",
        ": 1700000002:5;npm install",
        "plain-line-without-prefix",
      ],
      1_700_000_030_000,
    );
    const a = new ShellHistoryAdapter({ sources: [{ shell: "zsh", file: zshFile }] });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws.map((r) => r.payload.value)).toEqual([
      "ls -la",
      "npm install",
      "plain-line-without-prefix",
    ]);
  });

  it("originalId disambiguates same command at different sourceIndex", async () => {
    const f = makeHistFile("h.txt", ["ls", "ls", "ls"], 1_700_000_001_000);
    const a = new ShellHistoryAdapter({ sources: [{ shell: "bash", file: f }] });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    const ids = raws.map((r) => r.originalId);
    expect(new Set(ids).size).toBe(3);
  });

  it("respects since filter (file mtime granularity)", async () => {
    const oldF = makeHistFile("old.txt", ["a"], 1_700_000_001_000);
    const newF = makeHistFile("new.txt", ["b"], 1_700_000_005_000);
    const a = new ShellHistoryAdapter({
      sources: [
        { shell: "pwsh", file: oldF },
        { shell: "bash", file: newF },
      ],
    });
    const raws = [];
    for await (const r of a.sync({ since: 1_700_000_003_000 })) raws.push(r);
    expect(raws.map((r) => r.payload.value)).toEqual(["b"]);
  });

  it("respects limit", async () => {
    const f = makeHistFile("h.txt", ["1", "2", "3", "4", "5"], 1_700_000_001_000);
    const a = new ShellHistoryAdapter({ sources: [{ shell: "pwsh", file: f }] });
    const raws = [];
    for await (const r of a.sync({ limit: 2 })) raws.push(r);
    expect(raws).toHaveLength(2);
  });

  it("missing files silently produce nothing", async () => {
    const a = new ShellHistoryAdapter({
      sources: [{ shell: "pwsh", file: join(tmpDir, "nonexistent.txt") }],
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(0);
  });
});

describe("ShellHistoryAdapter.normalize", () => {
  it("maps shell-command → Event(OTHER) with [shell] title prefix", () => {
    const a = new ShellHistoryAdapter();
    const { events } = a.normalize({
      kind: "shell-command",
      originalId: "shell-cmd:bash:0:abc",
      capturedAt: 1_700_000_005_000,
      payload: {
        shell: "bash",
        file: "/home/u/.bash_history",
        value: "git status",
        sourceIndex: 0,
        snapshotTs: 1_700_000_001_000,
      },
    });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.subtype).toBe(EVENT_SUBTYPES.OTHER);
    expect(e.actor).toBe("self");
    expect(e.content.title).toBe("[bash] git status");
    expect(e.content.text).toBe("git status");
    expect(e.occurredAt).toBe(1_700_000_001_000);
    expect(e.extra.kind).toBe("shell-command");
    expect(e.extra.shell).toBe("bash");
    expect(validateEvent(e).valid).toBe(true);
  });

  it("truncates long commands in title (keeps full text)", () => {
    const a = new ShellHistoryAdapter();
    const longCmd = "echo " + "x".repeat(300);
    const { events } = a.normalize({
      kind: "shell-command",
      capturedAt: 1_700_000_000_000,
      originalId: "shell-cmd:pwsh:0:long",
      payload: {
        shell: "pwsh",
        value: longCmd,
        sourceIndex: 0,
        snapshotTs: 1_700_000_000_000,
      },
    });
    expect(events[0].content.title.length).toBeLessThanOrEqual(101);
    expect(events[0].content.title.endsWith("…")).toBe(true);
    expect(events[0].content.text).toBe(longCmd);
  });

  it("throws on unknown raw.kind", () => {
    expect(() => new ShellHistoryAdapter().normalize({ kind: "bogus" })).toThrow(
      /unknown raw\.kind=bogus/,
    );
  });
});
