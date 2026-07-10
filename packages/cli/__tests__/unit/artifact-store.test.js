/**
 * ArtifactStore + publish_artifact tool + `cc artifacts` command (P1 #10).
 * Store is exercised against a temp dir; the tool dispatch redirects
 * HOME/USERPROFILE (same isolation as the schedule-tool tests) so nothing
 * touches the user's real ~/.chainlesschain/artifacts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ArtifactStore,
  DEFAULT_TTL_DAYS,
  MAX_ARTIFACT_BYTES,
} from "../../src/lib/artifact-store.js";
import {
  runArtifactsList,
  runArtifactsShow,
  runArtifactsRemove,
  runArtifactsClean,
} from "../../src/commands/artifacts.js";
import { executeTool, formatToolArgs } from "../../src/runtime/agent-core.js";

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("ArtifactStore", () => {
  let dir;
  let srcDir;

  beforeEach(() => {
    dir = makeTmp("cc-artstore-");
    srcDir = makeTmp("cc-artsrc-");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  function writeSource(name, content) {
    const p = path.join(srcDir, name);
    fs.writeFileSync(p, content, "utf-8");
    return p;
  }

  it("publish copies the file and records metadata (no body in the entry)", () => {
    const src = writeSource("report.md", "# Findings\nAll good.");
    const store = new ArtifactStore({ dir });
    const entry = store.publish({
      filePath: src,
      title: "Review findings",
      kind: "report",
      sessionId: "sess-1",
    });
    expect(entry.id).toMatch(/^art_/);
    expect(entry.kind).toBe("report");
    expect(entry.mime).toBe("text/markdown");
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.sessionId).toBe("sess-1");
    // the metadata object never contains the file body
    expect(JSON.stringify(entry)).not.toContain("All good");
    // the stored copy is byte-identical
    const stored = store.storedPath(entry.id);
    expect(fs.readFileSync(stored, "utf-8")).toBe("# Findings\nAll good.");
    // default TTL applied
    const ttlMs = Date.parse(entry.expiresAt) - Date.parse(entry.createdAt);
    expect(ttlMs).toBe(DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);
  });

  it("list filters by session; get finds by id; unknown kind → other", () => {
    const store = new ArtifactStore({ dir });
    const a = store.publish({
      filePath: writeSource("a.log", "aaa"),
      sessionId: "s1",
      kind: "weird-kind",
    });
    store.publish({ filePath: writeSource("b.txt", "bbb"), sessionId: "s2" });
    expect(store.list()).toHaveLength(2);
    expect(store.list({ sessionId: "s1" })).toHaveLength(1);
    expect(store.get(a.id).kind).toBe("other");
    expect(store.get("art_nope")).toBeNull();
  });

  it("survives a corrupt index row (per-row tolerance)", () => {
    const store = new ArtifactStore({ dir });
    store.publish({ filePath: writeSource("a.txt", "aaa") });
    fs.appendFileSync(path.join(dir, "index.jsonl"), "{corrupt\n", "utf-8");
    store.publish({ filePath: writeSource("b.txt", "bbb") });
    expect(store.list()).toHaveLength(2);
  });

  it("remove deletes the copy + row; cleanupExpired honors TTL via injected clock", () => {
    let nowMs = Date.UTC(2026, 0, 1);
    const store = new ArtifactStore({ dir, now: () => nowMs });
    const a = store.publish({
      filePath: writeSource("a.txt", "aaa"),
      ttlDays: 1,
    });
    const b = store.publish({
      filePath: writeSource("b.txt", "bbb"),
      ttlDays: 10,
    });
    expect(store.remove(a.id)).toBe(true);
    expect(store.remove(a.id)).toBe(false);
    expect(fs.existsSync(store.storedPath(b.id))).toBe(true);
    // advance 2 days: only b remains and it is not yet expired
    nowMs += 2 * 24 * 60 * 60 * 1000;
    expect(store.cleanupExpired()).toEqual({ removed: 0 });
    nowMs += 20 * 24 * 60 * 60 * 1000;
    expect(store.cleanupExpired()).toEqual({ removed: 1 });
    expect(store.list()).toHaveLength(0);
  });

  it("rejects missing sources, directories and oversized files", () => {
    const store = new ArtifactStore({ dir });
    expect(() =>
      store.publish({ filePath: path.join(srcDir, "nope") }),
    ).toThrow(/not found/);
    expect(() => store.publish({ filePath: srcDir })).toThrow(/regular file/);
    expect(MAX_ARTIFACT_BYTES).toBeGreaterThan(0); // guard exists (not exercised with 100MB)
  });
});

describe("cc artifacts command runners (injected store)", () => {
  let dir;
  let srcDir;
  let store;
  let logs;

  beforeEach(() => {
    dir = makeTmp("cc-artcmd-");
    srcDir = makeTmp("cc-artcmdsrc-");
    store = new ArtifactStore({ dir });
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...a) =>
      logs.push(a.join(" ")),
    );
    vi.spyOn(console, "error").mockImplementation((...a) =>
      logs.push(a.join(" ")),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  function publishOne(name = "r.md") {
    const p = path.join(srcDir, name);
    fs.writeFileSync(p, "content", "utf-8");
    return store.publish({ filePath: p, title: name, kind: "report" });
  }

  it("list --json returns the entries; empty store exits 0", () => {
    expect(runArtifactsList({ json: true }, { store })).toBe(0);
    expect(JSON.parse(logs.at(-1)).artifacts).toEqual([]);
    publishOne();
    logs = [];
    expect(runArtifactsList({ json: true }, { store })).toBe(0);
    expect(JSON.parse(logs.at(-1)).artifacts).toHaveLength(1);
  });

  it("show resolves storedPath; unknown id exits 1", () => {
    const e = publishOne();
    expect(runArtifactsShow(e.id, { json: true }, { store })).toBe(0);
    expect(JSON.parse(logs.at(-1)).storedPath).toContain(e.file);
    expect(runArtifactsShow("art_missing", {}, { store })).toBe(1);
  });

  it("remove + clean report outcomes", () => {
    const e = publishOne();
    expect(runArtifactsRemove(e.id, { json: true }, { store })).toBe(0);
    expect(JSON.parse(logs.at(-1))).toEqual({ removed: e.id, found: true });
    expect(runArtifactsClean({ json: true }, { store })).toBe(0);
    expect(JSON.parse(logs.at(-1))).toEqual({ removed: 0 });
  });
});

describe("publish_artifact tool dispatch (HOME redirected)", () => {
  let tmpHome;
  let srcDir;
  let savedHome;
  let savedUserProfile;

  beforeEach(() => {
    tmpHome = makeTmp("cc-arthome-");
    srcDir = makeTmp("cc-artsrc2-");
    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUserProfile;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  it("publishes a workspace file and returns metadata + hint", async () => {
    const src = path.join(srcDir, "findings.json");
    fs.writeFileSync(src, JSON.stringify({ ok: true }), "utf-8");
    const res = await executeTool(
      "publish_artifact",
      { path: src, title: "Findings", kind: "data" },
      { sessionId: "sess-9" },
    );
    expect(res.error).toBeUndefined();
    expect(res.published).toMatchObject({
      title: "Findings",
      kind: "data",
      mime: "application/json",
      sessionId: "sess-9",
    });
    expect(res.hint).toContain("cc artifacts");
    const stored = new ArtifactStore({
      dir: path.join(tmpHome, ".chainlesschain", "artifacts"),
    });
    expect(stored.list()).toHaveLength(1);
  });

  it("surfaces a clean error for a missing file", async () => {
    const res = await executeTool(
      "publish_artifact",
      { path: path.join(srcDir, "missing.md") },
      {},
    );
    expect(res.error).toMatch(/publish_artifact failed/);
  });

  it("formatToolArgs renders kind + title", () => {
    expect(
      formatToolArgs("publish_artifact", { kind: "report", title: "Weekly" }),
    ).toBe("report: Weekly");
  });
});
