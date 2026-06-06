"use strict";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

// Every test here spawns real `git` (init/config/commit) across throwaway
// repos. On Windows, under the full-suite parallel worker pool, that subprocess
// fan-out routinely blows past the 10s default and flakes. Give the whole file
// generous headroom — the work is real, the default timeout is just too tight.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

const {
  GitActivityAdapter,
  GIT_ACTIVITY_NAME,
  GIT_ACTIVITY_VERSION,
} = require("../../lib/adapters/git-activity");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES } = require("../../lib/constants");
const { validateEvent } = require("../../lib/schemas");

let tmpDir;
let codeRoot;

// Anchor fixtures to "now - 1h" so the default --since=180.days filter
// never drops them. Bumping the literal in one place avoids drift if the
// adapter's default window changes.
const FIXTURE_NOW = Date.now();
function ts(offsetSec = 0) {
  return FIXTURE_NOW - 3_600_000 + offsetSec * 1000;
}

// Build a single throwaway repo with N commits — each committed with
// GIT_AUTHOR_DATE so the timestamps are deterministic.
function makeRepo(name, commits) {
  const dir = join(codeRoot, name);
  mkdirSync(dir, { recursive: true });
  const G = (args, env = {}) =>
    execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  G(["init", "-q", "-b", "main"]);
  G(["config", "user.email", "test@example.com"]);
  G(["config", "user.name", "Test"]);
  G(["config", "commit.gpgsign", "false"]);
  let i = 0;
  for (const c of commits) {
    const file = join(dir, `f${i}.txt`);
    writeFileSync(file, `content ${i}\n`, "utf-8");
    G(["add", "."]);
    const dt = new Date(c.tsMs).toISOString();
    G(["commit", "-m", c.subject, "--author", `${c.author || "Test User"} <test@example.com>`], {
      GIT_AUTHOR_DATE: dt,
      GIT_COMMITTER_DATE: dt,
    });
    i++;
  }
  return dir;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "git-act-test-"));
  codeRoot = join(tmpDir, "code");
  mkdirSync(codeRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GitActivityAdapter — contract + identity", () => {
  it("conforms to PersonalDataAdapter contract", () => {
    expect(assertAdapter(new GitActivityAdapter())).toEqual({ ok: true });
  });

  it("identifies as git-activity with sync:git-log-local capability", () => {
    const a = new GitActivityAdapter();
    expect(a.name).toBe(GIT_ACTIVITY_NAME);
    expect(a.name).toBe("git-activity");
    expect(a.version).toBe(GIT_ACTIVITY_VERSION);
    expect(a.capabilities).toContain("sync:git-log-local");
  });
});

describe("GitActivityAdapter.authenticate", () => {
  it("NO_GIT_REPOS when codeRoot empty", async () => {
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    const r = await a.authenticate({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NO_GIT_REPOS");
  });

  it("ok when at least one repo exists", async () => {
    makeRepo("a", [{ subject: "init", tsMs: ts(0) }]);
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    const r = await a.authenticate({});
    expect(r.ok).toBe(true);
    expect(r.repoCount).toBe(1);
  });
});

describe("GitActivityAdapter.sync", () => {
  it("yields commits with author+subject+ts, originalId stable across syncs", async () => {
    makeRepo("a", [
      { subject: "first commit", tsMs: ts(1), author: "Alice" },
      { subject: "second commit", tsMs: ts(2), author: "Alice" },
    ]);
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    const raws1 = [];
    for await (const r of a.sync()) raws1.push(r);
    expect(raws1).toHaveLength(2);
    expect(raws1[0].payload.subject).toBeTruthy();
    expect(raws1[0].payload.authorName).toBe("Alice");
    expect(raws1[0].payload.repoName).toBe("a");
    expect(raws1[0].originalId).toMatch(/^git-commit:/);
    // Re-sync — originalIds should match (idempotent)
    const raws2 = [];
    for await (const r of a.sync()) raws2.push(r);
    const ids1 = raws1.map((r) => r.originalId).sort();
    const ids2 = raws2.map((r) => r.originalId).sort();
    expect(ids2).toEqual(ids1);
  });

  it("multi-repo: enumerates every .git dir under the root", async () => {
    makeRepo("repo-a", [{ subject: "a1", tsMs: ts(1) }]);
    makeRepo("repo-b", [{ subject: "b1", tsMs: ts(2) }]);
    makeRepo("repo-c", [{ subject: "c1", tsMs: ts(3) }]);
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    const repoNames = new Set(raws.map((r) => r.payload.repoName));
    expect(repoNames).toEqual(new Set(["repo-a", "repo-b", "repo-c"]));
  });

  it("respects limit", async () => {
    makeRepo("a", [
      { subject: "1", tsMs: ts(1) },
      { subject: "2", tsMs: ts(2) },
      { subject: "3", tsMs: ts(3) },
    ]);
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    const raws = [];
    for await (const r of a.sync({ limit: 2 })) raws.push(r);
    expect(raws).toHaveLength(2);
  });

  it("skips non-.git directories silently", async () => {
    makeRepo("real-repo", [{ subject: "x", tsMs: ts(1) }]);
    mkdirSync(join(codeRoot, "not-a-repo"), { recursive: true });
    writeFileSync(join(codeRoot, "not-a-repo", "README.md"), "no .git here", "utf-8");
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(1);
    expect(raws[0].payload.repoName).toBe("real-repo");
  });
});

describe("GitActivityAdapter.normalize", () => {
  it("maps commit → schema-valid Event(OTHER) with author as actor", () => {
    const a = new GitActivityAdapter();
    const { events } = a.normalize({
      kind: "commit",
      originalId: "git-commit:/code/foo:abc",
      capturedAt: 1_700_000_005_000,
      payload: {
        sha: "abcdef0123456789",
        shortSha: "abcdef01",
        authoredAtMs: 1_700_000_001_000,
        authorName: "Alice",
        authorEmail: "alice@example.com",
        subject: "Fix the bug",
        repoDir: "/code/foo",
        repoName: "foo",
      },
    });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.subtype).toBe(EVENT_SUBTYPES.OTHER);
    expect(e.actor).toBe("Alice");
    expect(e.content.title).toBe("Fix the bug");
    expect(e.occurredAt).toBe(1_700_000_001_000);
    expect(e.extra.repoName).toBe("foo");
    expect(e.extra.sha).toBe("abcdef0123456789");
    expect(validateEvent(e).valid).toBe(true);
  });

  it("truncates long commit subjects to 100 chars in title", () => {
    const a = new GitActivityAdapter();
    const longSubj = "x".repeat(200);
    const { events } = a.normalize({
      kind: "commit",
      capturedAt: 1_700_000_000_000,
      originalId: "git-commit:foo:long",
      payload: {
        sha: "deadbeef",
        shortSha: "deadbeef",
        authoredAtMs: 1_700_000_000_000,
        subject: longSubj,
        authorName: "X",
        repoName: "r",
      },
    });
    expect(events[0].content.title.length).toBeLessThanOrEqual(101);
    expect(events[0].content.title.endsWith("…")).toBe(true);
    expect(events[0].content.text).toBe(longSubj);
  });

  it("throws on unknown raw.kind", () => {
    expect(() => new GitActivityAdapter().normalize({ kind: "bogus" })).toThrow(
      /unknown raw\.kind=bogus/,
    );
  });
});
