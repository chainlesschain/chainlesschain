"use strict";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// The end-to-end commit test spawns real `git` across a throwaway repo. On
// Windows, under the full-suite parallel worker pool, those subprocesses can
// slow down substantially, so retain headroom without making structural tests
// pay the same process cost.
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

const {
  GitActivityAdapter,
  GIT_ACTIVITY_NAME,
  GIT_ACTIVITY_VERSION,
} = require("../../lib/adapters/git-activity");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES } = require("../../lib/constants");
const { validateEvent } = require("../../lib/schemas");
const {
  parseGitLog,
  listCommits,
  getHeadCommit,
  getShallowBoundaryFingerprint,
  findGitRepos,
  sanitizedGitEnvironment,
} = require("../../lib/adapters/git-activity/git-reader");

let tmpDir;
let codeRoot;

// Anchor fixtures to "now - 1h" so they remain realistic while timestamps
// stay deterministic inside one test process.
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
  let i = 0;
  for (const c of commits) {
    const file = join(dir, `f${i}.txt`);
    writeFileSync(file, `content ${i}\n`, "utf-8");
    G(["add", "."]);
    const dt = new Date(c.tsMs).toISOString();
    G(
      [
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        c.subject,
        "--author",
        `${c.author || "Test User"} <test@example.com>`,
      ],
      {
        GIT_AUTHOR_DATE: dt,
        GIT_COMMITTER_DATE: dt,
      },
    );
    i++;
  }
  return dir;
}

// Discovery/limit tests only need the filesystem shape. Real `git log`
// coverage stays in the end-to-end commit test; using init/add/commit for every
// structural assertion makes the suite depend on machine-wide process load.
function makeRepoMarker(name) {
  const dir = join(codeRoot, name);
  const dotGit = join(dir, ".git");
  mkdirSync(dotGit, { recursive: true });
  writeFileSync(join(dotGit, "HEAD"), "ref: refs/heads/main\n", "utf-8");
  writeFileSync(
    join(dotGit, "config"),
    "[core]\n\trepositoryformatversion = 0\n\tbare = false\n",
    "utf-8",
  );
  return dir;
}

function fakeSha(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function fakeCommit(repoDir, suffix = "1") {
  return {
    sha: fakeSha(`${repoDir}-${suffix}`),
    repoDir,
    repoName: repoDir.split(/[\\/]/).pop(),
    authoredAtMs: ts(1),
    authorName: "Test",
    authorEmail: "test@example.com",
    subject: `commit ${suffix}`,
  };
}

async function collectCursorPage(adapter, opts = {}) {
  const raws = [];
  let cursor = null;
  let completed = false;
  for await (const raw of adapter.sync({
    ...opts,
    updateWatermark: (value) => {
      cursor = value;
    },
    markWatermarkComplete: () => {
      completed = true;
    },
  })) {
    raws.push(raw);
  }
  return { raws, cursor, completed };
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
    expect(a.version).toBe("0.4.0");
    expect(a.capabilities).toContain("sync:git-log-local");
    expect(a.watermarkStrategy).toBe("explicit");
    expect(a.watermarkRequiresCompleteScan).toBe(true);
    expect(a.dataDisclosure.excludedFields).toEqual(
      expect.arrayContaining([
        "absolute repository/root paths",
        "raw Git object SHA",
        "remote URLs and credentials",
      ]),
    );
  });

  it("uses the same scoped identity for codeRoots, roots, and profilePath", () => {
    const fromCodeRoots = new GitActivityAdapter({
      codeRoots: [codeRoot],
    }).defaultScope;
    const fromRoots = new GitActivityAdapter({ roots: [codeRoot] })
      .defaultScope;
    const fromProfile = new GitActivityAdapter({
      profilePath: codeRoot,
    }).defaultScope;
    const different = new GitActivityAdapter({
      profilePath: join(tmpDir, "other"),
    }).defaultScope;

    expect(fromRoots).toBe(fromCodeRoots);
    expect(fromProfile).toBe(fromCodeRoots);
    expect(different).not.toBe(fromCodeRoots);
    expect(fromCodeRoots).not.toContain(codeRoot);
  });

  it("keeps the root scope stable when a repository is added", () => {
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    const before = a.resolveDefaultScope();
    makeRepoMarker("new-repository");
    const after = a.resolveDefaultScope();

    expect(after).toBe(before);
    expect(after).not.toContain(codeRoot);
  });

  it("does not fall back to default roots after an explicit empty selection", async () => {
    let defaultRootCalls = 0;
    const a = new GitActivityAdapter({
      codeRoots: [],
      defaultCodeRoots: () => {
        defaultRootCalls += 1;
        return [codeRoot];
      },
    });

    expect(a.resolveDefaultScope()).toBeUndefined();
    expect((await a.authenticate({})).reason).toBe("NO_CODE_ROOTS");
    expect(defaultRootCalls).toBe(0);

    const configured = new GitActivityAdapter({ codeRoots: [codeRoot] });
    expect((await configured.authenticate({ roots: [] })).reason).toBe(
      "NO_CODE_ROOTS",
    );
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
    makeRepoMarker("a");
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    const r = await a.authenticate({});
    expect(r.ok).toBe(true);
    expect(r.repoCount).toBe(1);
    expect(JSON.stringify(r)).not.toContain(codeRoot);
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
    expect(raws1[0].payload.commitHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(raws1[0].payload.repoHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(raws1[0].payload).not.toHaveProperty("repoDir");
    expect(raws1[0].payload).not.toHaveProperty("sha");
    expect(raws1[0].originalId).toMatch(/^git-activity-commit:/);
    expect(raws1[0].originalId).not.toContain(codeRoot);
    expect(raws1[0].capturedAt).toBe(raws1[0].payload.authoredAtMs);
    // Re-sync — originalIds should match (idempotent)
    const raws2 = [];
    for await (const r of a.sync()) raws2.push(r);
    const ids1 = raws1.map((r) => r.originalId).sort();
    const ids2 = raws2.map((r) => r.originalId).sort();
    expect(ids2).toEqual(ids1);
    expect(JSON.stringify(raws1)).not.toContain(codeRoot);
  });

  it("redacts known roots, repository paths, and the raw Git SHA from metadata", async () => {
    const repoDir = makeRepoMarker("private-repo");
    const rawSha = fakeSha("private-commit");
    const slashRoot = codeRoot.replace(/\\/gu, "/");
    const a = new GitActivityAdapter({ roots: [codeRoot] });
    a._deps.listCommits = async () => [
      {
        sha: rawSha,
        repoDir,
        repoName: repoDir,
        authoredAtMs: ts(1),
        authorName: `Author at ${codeRoot}`,
        authorEmail: `${rawSha}@example.invalid`,
        subject: `Update ${repoDir} under ${slashRoot} (${rawSha})`,
      },
    ];

    const raws = [];
    for await (const raw of a.sync()) raws.push(raw);
    const serialized = JSON.stringify(raws);

    expect(raws).toHaveLength(1);
    expect(raws[0].payload.repoName).toBe("private-repo");
    expect(raws[0].payload.subject).toContain("[redacted]");
    expect(serialized).not.toContain(codeRoot);
    expect(serialized).not.toContain(slashRoot);
    expect(serialized).not.toContain(rawSha);
  });

  it("redacts unrelated absolute paths, remote URLs, and Git object IDs", async () => {
    makeRepoMarker("privacy-repo");
    const rawSha = fakeSha("primary");
    const foreignSha = fakeSha("foreign");
    const foreignWindowsPath = "D:\\Private\\secret.txt";
    const foreignPosixPath = "/srv/private/secret.txt";
    const remoteUrl = "https://user:password@example.invalid/private.git";
    const prefixedPosixPath = "path:/absolute/private.txt";
    const bracketedPosixPath = "[/bracket/private.txt]";
    const backtickPosixPath = "`/backtick/private.txt`";
    const homeRelativePath = "~/private/secret.txt";
    const abbreviatedSha = "deadbeef1234";
    const underscoredSha = `_prefix_${foreignSha}_suffix_`;
    const commaPosixPath = "location,/comma/private.txt";
    const underscoredWindowsPath = `_prefix_${foreignWindowsPath}`;
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    a._deps.listCommits = async () => [
      {
        sha: rawSha,
        authoredAtMs: ts(1),
        authorName: "Test",
        authorEmail: "test@example.invalid",
        subject: [
          foreignWindowsPath,
          foreignPosixPath,
          remoteUrl,
          foreignSha,
          prefixedPosixPath,
          bracketedPosixPath,
          backtickPosixPath,
          homeRelativePath,
          abbreviatedSha,
          underscoredSha,
          commaPosixPath,
          underscoredWindowsPath,
        ].join(" "),
      },
    ];

    const raws = [];
    for await (const raw of a.sync()) raws.push(raw);
    const serialized = JSON.stringify(raws);

    expect(raws).toHaveLength(1);
    expect(serialized).not.toContain(foreignWindowsPath);
    expect(serialized).not.toContain(foreignPosixPath);
    expect(serialized).not.toContain(remoteUrl);
    expect(serialized).not.toContain(foreignSha);
    expect(serialized).not.toContain(prefixedPosixPath);
    expect(serialized).not.toContain(bracketedPosixPath);
    expect(serialized).not.toContain(backtickPosixPath);
    expect(serialized).not.toContain(homeRelativePath);
    expect(serialized).not.toContain(abbreviatedSha);
    expect(serialized).not.toContain(foreignSha);
    expect(serialized).not.toContain("/comma/private.txt");
    expect(serialized).not.toContain(foreignWindowsPath);
    expect(raws[0].payload.subject).toContain("[redacted-path]");
    expect(raws[0].payload.subject).toContain("[redacted-url]");
    expect(raws[0].payload.subject).toContain("[redacted-git-object]");
  });

  it("redacts a repository basename that looks like a Git object id", async () => {
    const sensitiveRepoName = fakeSha("repository-name");
    const repoDir = makeRepoMarker(sensitiveRepoName);
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    a._deps.listCommits = async () => [fakeCommit(repoDir)];
    const raws = [];

    for await (const raw of a.sync()) raws.push(raw);

    expect(raws).toHaveLength(1);
    expect(raws[0].payload.repoName).toBe("[redacted-git-object]");
    expect(JSON.stringify(raws)).not.toContain(sensitiveRepoName);
  });

  it("multi-repo: enumerates every .git dir under the root", async () => {
    makeRepoMarker("repo-a");
    makeRepoMarker("repo-b");
    makeRepoMarker("repo-c");
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    a._deps.listCommits = async (repoDir) => [fakeCommit(repoDir)];
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    const repoNames = new Set(raws.map((r) => r.payload.repoName));
    expect(repoNames).toEqual(new Set(["repo-a", "repo-b", "repo-c"]));
  });

  it("persists only safe graph hashes and skips an unchanged repository", async () => {
    const repoDir = makeRepoMarker("cursor-repo");
    const rawHead = fakeSha("cursor-head");
    const commit = { ...fakeCommit(repoDir), sha: rawHead };
    let listCalls = 0;
    const a = new GitActivityAdapter({
      codeRoots: [codeRoot],
      getHeadCommit: async () => rawHead,
      listCommits: async () => {
        listCalls += 1;
        return [commit];
      },
    });

    const first = await collectCursorPage(a);
    const second = await collectCursorPage(a, {
      sinceWatermark: first.cursor,
    });

    expect(first.raws).toHaveLength(1);
    expect(first.completed).toBe(true);
    expect(first.cursor).toMatch(/^git-v1:/u);
    expect(first.cursor).not.toContain(codeRoot);
    expect(first.cursor).not.toContain(repoDir);
    expect(first.cursor).not.toContain(rawHead);
    expect(second.raws).toEqual([]);
    expect(second.completed).toBe(true);
    expect(second.cursor).toBe(first.cursor);
    expect(listCalls).toBe(1);
  });

  it("collects a backdated history when a repository is added without changing scope", async () => {
    const firstRepo = makeRepoMarker("existing");
    const addedRepo = makeRepoMarker("added-later");
    const firstHead = fakeSha("existing-head");
    const addedHead = fakeSha("added-head");
    let discovered = [firstRepo];
    const a = new GitActivityAdapter({
      codeRoots: [codeRoot],
      findGitRepos: () => discovered,
      getHeadCommit: async (repoDir) =>
        repoDir === firstRepo ? firstHead : addedHead,
      listCommits: async (repoDir) => [
        {
          ...fakeCommit(repoDir),
          sha: repoDir === firstRepo ? firstHead : addedHead,
          authoredAtMs: ts(-100_000),
          committedAtMs: ts(-100_000),
        },
      ],
    });
    const stableScope = a.defaultScope;

    const first = await collectCursorPage(a);
    discovered = [firstRepo, addedRepo];
    const second = await collectCursorPage(a, {
      sinceWatermark: first.cursor,
    });

    expect(a.resolveDefaultScope()).toBe(stableScope);
    expect(second.raws).toHaveLength(1);
    expect(second.raws[0].payload.repoName).toBe("added-later");
    expect(second.completed).toBe(true);
  });

  it("replays safely when HEAD is rewritten to backdated commits", async () => {
    const repoDir = makeRepoMarker("rewritten");
    const oldHead = fakeSha("old-head");
    const newHead = fakeSha("new-head");
    let currentHead = oldHead;
    let commits = [
      {
        ...fakeCommit(repoDir, "old"),
        sha: oldHead,
        committedAtMs: ts(10),
      },
    ];
    const a = new GitActivityAdapter({
      codeRoots: [codeRoot],
      getHeadCommit: async () => currentHead,
      listCommits: async (_repoDir, options) =>
        commits.slice(options.skip, options.skip + options.maxPerRepo),
    });

    const first = await collectCursorPage(a);
    currentHead = newHead;
    commits = [
      {
        ...fakeCommit(repoDir, "rewritten"),
        sha: newHead,
        authoredAtMs: ts(-200_000),
        committedAtMs: ts(-200_000),
      },
    ];
    const second = await collectCursorPage(a, {
      sinceWatermark: first.cursor,
    });

    expect(second.raws).toHaveLength(1);
    expect(second.raws[0].payload.subject).toBe("commit rewritten");
    expect(second.raws[0].capturedAt).toBe(ts(-200_000));
    expect(second.completed).toBe(true);
  });

  it("resumes a large repository with a safe offset cursor across pages", async () => {
    const repoDir = makeRepoMarker("paged");
    const rawHead = fakeSha("paged-head");
    const commits = ["one", "two", "three"].map((suffix, index) => ({
      ...fakeCommit(repoDir, suffix),
      sha: index === 0 ? rawHead : fakeSha(`paged-${suffix}`),
      authoredAtMs: ts(30 - index),
      committedAtMs: ts(30 - index),
    }));
    const seenSkips = [];
    const a = new GitActivityAdapter({
      codeRoots: [codeRoot],
      getHeadCommit: async () => rawHead,
      listCommits: async (_repoDir, options) => {
        seenSkips.push(options.skip);
        return commits.slice(options.skip, options.skip + options.maxPerRepo);
      },
    });

    const first = await collectCursorPage(a, { pageSize: 1, maxPages: 1 });
    const second = await collectCursorPage(a, {
      sinceWatermark: first.cursor,
      pageSize: 1,
      maxPages: 1,
    });
    const third = await collectCursorPage(a, {
      sinceWatermark: second.cursor,
      pageSize: 1,
      maxPages: 1,
    });

    expect(
      [...first.raws, ...second.raws, ...third.raws].map(
        (raw) => raw.payload.subject,
      ),
    ).toEqual(["commit one", "commit two", "commit three"]);
    expect(
      new Set(
        [...first.raws, ...second.raws, ...third.raws].map(
          (raw) => raw.originalId,
        ),
      ).size,
    ).toBe(3);
    expect([first.completed, second.completed, third.completed]).toEqual([
      true,
      true,
      true,
    ]);
    expect(seenSkips).toEqual([0, 1, 2]);
    expect(third.cursor).toMatch(/^git-v1:/u);
  });

  it("resumes real git log pages against a pinned HEAD revision", async () => {
    makeRepo("real-paged", [
      { subject: "first", tsMs: ts(1), author: "Test" },
      { subject: "second", tsMs: ts(2), author: "Test" },
      { subject: "third", tsMs: ts(3), author: "Test" },
    ]);
    const adapter = new GitActivityAdapter({ codeRoots: [codeRoot] });
    const pages = [];
    let cursor;

    for (let index = 0; index < 3; index += 1) {
      const page = await collectCursorPage(adapter, {
        sinceWatermark: cursor,
        pageSize: 1,
        maxPages: 1,
      });
      pages.push(page);
      cursor = page.cursor;
    }

    expect(
      pages.flatMap((page) => page.raws.map((raw) => raw.payload.subject)),
    ).toEqual(["third", "second", "first"]);
    expect(pages.every((page) => page.completed)).toBe(true);
    expect(cursor).toMatch(/^git-v1:/u);
  });

  it("resumes a pinned backfill when HEAD keeps advancing", async () => {
    const repoDir = makeRepoMarker("active-paged");
    let sequence = 0;
    const makeLinearCommit = (subject) => ({
      ...fakeCommit(repoDir, subject),
      sha: fakeSha(subject),
      authoredAtMs: ts(100 + sequence),
      committedAtMs: ts(100 + sequence++),
      subject,
    });
    let commits = [
      makeLinearCommit("old-4"),
      makeLinearCommit("old-3"),
      makeLinearCommit("old-2"),
      makeLinearCommit("old-1"),
    ];
    const listFromRevision = (options) => {
      const revisionIndex = options.revision
        ? commits.findIndex((commit) => commit.sha === options.revision)
        : 0;
      const start = revisionIndex < 0 ? 0 : revisionIndex;
      let end = commits.length;
      if (options.excludeRevision) {
        const excluded = commits.findIndex(
          (commit) => commit.sha === options.excludeRevision,
        );
        if (excluded >= start) end = excluded;
      }
      return commits
        .slice(start, end)
        .slice(options.skip, options.skip + options.maxPerRepo);
    };
    const adapter = new GitActivityAdapter({
      codeRoots: [codeRoot],
      getHeadCommit: async () => commits[0].sha,
      listReachableCommitIds: async (_repoDir, options) => {
        const start = commits.findIndex(
          (commit) => commit.sha === options.revision,
        );
        return commits
          .slice(Math.max(0, start), Math.max(0, start) + options.maxCount)
          .map((commit) => commit.sha);
      },
      listCommits: async (_repoDir, options) => listFromRevision(options),
    });

    const first = await collectCursorPage(adapter, {
      pageSize: 1,
      maxPages: 1,
    });
    commits.unshift(makeLinearCommit("new-0"));
    const constrained = await collectCursorPage(adapter, {
      sinceWatermark: first.cursor,
      pageSize: 1,
      maxPages: 1,
    });
    commits.unshift(makeLinearCommit("new-1"));
    const expanded = await collectCursorPage(adapter, {
      sinceWatermark: first.cursor,
      pageSize: 3,
      maxPages: 1,
    });
    commits.unshift(makeLinearCommit("new-2"));
    const continued = await collectCursorPage(adapter, {
      sinceWatermark: expanded.cursor,
      pageSize: 3,
      maxPages: 1,
    });

    expect(first.raws.map((raw) => raw.payload.subject)).toEqual(["old-4"]);
    expect(constrained.raws.map((raw) => raw.payload.subject)).toEqual([
      "new-0",
    ]);
    expect(constrained.cursor).toBeNull();
    expect(constrained.completed).toBe(false);
    expect(new Set(expanded.raws.map((raw) => raw.payload.subject))).toEqual(
      new Set(["new-1", "new-0", "old-3"]),
    );
    expect(expanded.completed).toBe(true);
    expect(expanded.cursor).toMatch(/^git-v1:/u);
    expect(expanded.cursor).not.toContain(fakeSha("old-4"));
    expect(new Set(continued.raws.map((raw) => raw.payload.subject))).toEqual(
      new Set(["new-2", "old-2", "old-1"]),
    );
    expect(continued.completed).toBe(true);
  });

  it("replays newly reachable history after deepen and unshallow", async () => {
    const sourceRepo = makeRepo("shallow-source", [
      { subject: "first", tsMs: ts(1), author: "Test" },
      { subject: "second", tsMs: ts(2), author: "Test" },
      { subject: "third", tsMs: ts(3), author: "Test" },
    ]);
    const shallowRepo = join(tmpDir, "shallow-copy");
    execFileSync(
      "git",
      ["clone", "-q", "--depth=1", pathToFileURL(sourceRepo).href, shallowRepo],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const adapter = new GitActivityAdapter({ profilePath: shallowRepo });

    const initialFingerprint = await getShallowBoundaryFingerprint(shallowRepo);
    const initial = await collectCursorPage(adapter);
    const initialHead = await getHeadCommit(shallowRepo);

    execFileSync(
      "git",
      ["-C", shallowRepo, "fetch", "-q", "--deepen=1", "origin", "main"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const deepenedFingerprint =
      await getShallowBoundaryFingerprint(shallowRepo);
    const deepened = await collectCursorPage(adapter, {
      sinceWatermark: initial.cursor,
    });

    execFileSync(
      "git",
      ["-C", shallowRepo, "fetch", "-q", "--unshallow", "origin", "main"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const unshallowedFingerprint =
      await getShallowBoundaryFingerprint(shallowRepo);
    const unshallowed = await collectCursorPage(adapter, {
      sinceWatermark: deepened.cursor,
    });

    expect(initial.raws.map((raw) => raw.payload.subject)).toEqual(["third"]);
    expect(await getHeadCommit(shallowRepo)).toBe(initialHead);
    expect(initialFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(deepenedFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(deepenedFingerprint).not.toBe(initialFingerprint);
    expect(deepened.raws.map((raw) => raw.payload.subject)).toEqual(
      expect.arrayContaining(["second"]),
    );
    expect(unshallowedFingerprint).toBeNull();
    expect(unshallowed.raws.map((raw) => raw.payload.subject)).toEqual(
      expect.arrayContaining(["first"]),
    );
    expect(deepened.completed).toBe(true);
    expect(unshallowed.completed).toBe(true);
  });

  it("round-trips a shallow fingerprint without replaying an unchanged graph", async () => {
    const sourceRepo = makeRepo("shallow-stable-source", [
      { subject: "first", tsMs: ts(1), author: "Test" },
      { subject: "second", tsMs: ts(2), author: "Test" },
    ]);
    const shallowRepo = join(tmpDir, "shallow-stable-copy");
    execFileSync(
      "git",
      ["clone", "-q", "--depth=1", pathToFileURL(sourceRepo).href, shallowRepo],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const adapter = new GitActivityAdapter({ profilePath: shallowRepo });

    const initial = await collectCursorPage(adapter);
    const unchanged = await collectCursorPage(adapter, {
      sinceWatermark: initial.cursor,
    });

    expect(initial.raws).toHaveLength(1);
    expect(initial.cursor).toMatch(/^git-v1:/u);
    expect(unchanged.raws).toEqual([]);
    expect(unchanged.completed).toBe(true);
    expect(unchanged.cursor).toBe(initial.cursor);
  });

  it("migrates a legacy numeric watermark by replaying into a graph cursor", async () => {
    const repoDir = makeRepoMarker("legacy-cursor");
    const rawHead = fakeSha("legacy-head");
    const a = new GitActivityAdapter({
      codeRoots: [codeRoot],
      getHeadCommit: async () => rawHead,
      listCommits: async () => [
        {
          ...fakeCommit(repoDir),
          sha: rawHead,
          committedAtMs: ts(-500_000),
        },
      ],
    });

    const result = await collectCursorPage(a, {
      sinceWatermark: String(ts(0)),
    });

    expect(result.raws).toHaveLength(1);
    expect(result.cursor).toMatch(/^git-v1:/u);
    expect(result.completed).toBe(true);
  });

  it("respects limit", async () => {
    const repoDir = makeRepoMarker("a");
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    a._deps.listCommits = async () => [
      fakeCommit(repoDir, "1"),
      fakeCommit(repoDir, "2"),
      fakeCommit(repoDir, "3"),
    ];
    const raws = [];
    for await (const r of a.sync({ limit: 2 })) raws.push(r);
    expect(raws).toHaveLength(2);
  });

  it("fails closed instead of permanently slicing repositories at maxRepos", async () => {
    const first = makeRepoMarker("repo-limit-a");
    const second = makeRepoMarker("repo-limit-b");
    let listCalls = 0;
    const adapter = new GitActivityAdapter({
      codeRoots: [codeRoot],
      findGitRepos: () => [first, second],
      listCommits: async () => {
        listCalls += 1;
        return [];
      },
    });

    await expect(
      (async () => {
        for await (const raw of adapter.sync({ maxRepos: 1 })) {
          // The limit must fail before reading any repository history.
          void raw;
        }
      })(),
    ).rejects.toMatchObject({ code: "GIT_REPO_LIMIT_EXCEEDED" });
    expect(listCalls).toBe(0);
  });

  it("skips non-.git directories silently", async () => {
    const repoDir = makeRepoMarker("real-repo");
    mkdirSync(join(codeRoot, "not-a-repo"), { recursive: true });
    writeFileSync(
      join(codeRoot, "not-a-repo", "README.md"),
      "no .git here",
      "utf-8",
    );
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    a._deps.listCommits = async () => [fakeCommit(repoDir)];
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(1);
    expect(raws[0].payload.repoName).toBe("real-repo");
  });

  it("ignores directories with an empty .git marker", async () => {
    mkdirSync(join(codeRoot, "false-positive", ".git"), { recursive: true });
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    const auth = await a.authenticate({});

    expect(auth.ok).toBe(false);
    expect(auth.reason).toBe("NO_GIT_REPOS");
  });

  it("treats a readable repository with no commits as a complete empty scan", async () => {
    const repoDir = join(codeRoot, "empty-repo");
    mkdirSync(repoDir, { recursive: true });
    execFileSync("git", ["-C", repoDir, "init", "-q", "-b", "main"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    let watermarkCompleted = false;
    const raws = [];

    for await (const raw of a.sync({
      markWatermarkComplete: () => {
        watermarkCompleted = true;
      },
    })) {
      raws.push(raw);
    }

    expect(raws).toEqual([]);
    expect(watermarkCompleted).toBe(true);
  });

  it("does not treat a repository with a broken HEAD object as empty", async () => {
    const repoDir = join(codeRoot, "broken-head");
    mkdirSync(repoDir, { recursive: true });
    execFileSync("git", ["-C", repoDir, "init", "-q", "-b", "main"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    writeFileSync(
      join(repoDir, ".git", "refs", "heads", "main"),
      `${"0".repeat(40)}\n`,
      "utf-8",
    );

    await expect(listCommits(repoDir, { maxPerRepo: 2 })).rejects.toBeTruthy();
  });

  it("collects a selected repository root instead of requiring its parent", async () => {
    const repoDir = makeRepo("selected-repo", [
      { subject: "selected", tsMs: ts(1), author: "Test" },
    ]);
    const a = new GitActivityAdapter({ profilePath: repoDir });
    const raws = [];

    for await (const raw of a.sync()) raws.push(raw);

    expect(raws).toHaveLength(1);
    expect(raws[0].payload.repoName).toBe("selected-repo");
  });

  it("reads independent repositories concurrently", async () => {
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    a._deps.findRepos = () => ["repo-a", "repo-b", "repo-c"];
    let inFlight = 0;
    let maxInFlight = 0;
    a._deps.listCommits = async (repoDir) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const repoName = repoDir.split(/[\\/]/).pop();
      const delay =
        repoName === "repo-a" ? 30 : repoName === "repo-b" ? 20 : 10;
      await new Promise((resolve) => setTimeout(resolve, delay));
      inFlight -= 1;
      return [
        {
          sha: fakeSha(repoDir),
          repoDir,
          repoName,
          authoredAtMs: ts(1),
          subject: repoDir,
        },
      ];
    };

    const raws = [];
    for await (const raw of a.sync({ repoConcurrency: 3 })) raws.push(raw);

    expect(maxInFlight).toBe(3);
    expect(raws.map((raw) => raw.payload.repoName).sort()).toEqual([
      "repo-a",
      "repo-b",
      "repo-c",
    ]);
  });

  it("isolates a failed repository and continues collecting the others", async () => {
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    a._deps.findRepos = () => ["good-a", "broken", "good-b"];
    a._deps.listCommits = async (repoDir) => {
      const repoName = repoDir.split(/[\\/]/).pop();
      if (repoName === "broken") throw new Error("repository disappeared");
      return [
        {
          sha: fakeSha(repoDir),
          repoDir,
          repoName,
          authoredAtMs: ts(1),
          subject: repoName,
        },
      ];
    };

    const raws = [];
    let watermarkCompleted = false;
    for await (const raw of a.sync({
      markWatermarkComplete: () => {
        watermarkCompleted = true;
      },
    })) {
      raws.push(raw);
    }

    expect(raws.map((raw) => raw.payload.repoName).sort()).toEqual([
      "good-a",
      "good-b",
    ]);
    expect(watermarkCompleted).toBe(false);
  });

  it("uses the authored timestamp watermark and defers on a page budget", async () => {
    const repoDir = makeRepoMarker("bounded");
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    a._deps.listCommits = async (_repoDir, options) => [
      fakeCommit(repoDir, String(options.maxPerRepo)),
      fakeCommit(repoDir, "extra"),
    ];

    let watermarkCompleted = false;
    const raws = [];
    for await (const raw of a.sync({
      sinceWatermark: ts(-10),
      pageSize: 1,
      maxPages: 1,
      markWatermarkComplete: () => {
        watermarkCompleted = true;
      },
    })) {
      raws.push(raw);
    }

    expect(raws).toHaveLength(1);
    expect(watermarkCompleted).toBe(false);
    expect(raws[0].capturedAt).toBe(raws[0].payload.authoredAtMs);
  });

  it("uses committer time for the watermark while preserving author time for the event", async () => {
    const repoDir = makeRepoMarker("two-clocks");
    const authoredAtMs = ts(1);
    const committedAtMs = ts(20);
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    a._deps.listCommits = async () => [
      {
        ...fakeCommit(repoDir),
        authoredAtMs,
        committedAtMs,
      },
    ];
    const raws = [];

    for await (const raw of a.sync()) raws.push(raw);
    const event = a.normalize(raws[0]).events[0];

    expect(raws[0].capturedAt).toBe(committedAtMs);
    expect(raws[0].payload.authoredAtMs).toBe(authoredAtMs);
    expect(raws[0].payload.committedAtMs).toBe(committedAtMs);
    expect(event.occurredAt).toBe(authoredAtMs);
    expect(event.source.capturedAt).toBe(committedAtMs);
  });

  it("defers the watermark when an exact page boundary leaves repositories unscanned", async () => {
    const first = makeRepoMarker("first");
    const second = makeRepoMarker("second");
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    a._deps.findRepos = () => [first, second];
    a._deps.listCommits = async (repoDir) => [fakeCommit(repoDir)];
    let calls = 0;
    const original = a._deps.listCommits;
    a._deps.listCommits = async (...args) => {
      calls += 1;
      return original(...args);
    };
    let watermarkCompleted = false;
    const raws = [];

    for await (const raw of a.sync({
      pageSize: 1,
      maxPages: 1,
      repoConcurrency: 1,
      markWatermarkComplete: () => {
        watermarkCompleted = true;
      },
    })) {
      raws.push(raw);
    }

    expect(raws).toHaveLength(1);
    expect(calls).toBe(1);
    expect(watermarkCompleted).toBe(false);
  });

  it("does not mark a partial stored-cursor page complete without an updater", async () => {
    const repoDir = makeRepoMarker("no-updater");
    const rawHead = fakeSha("no-updater-head");
    const commits = ["one", "two", "three"].map((suffix, index) => ({
      ...fakeCommit(repoDir, suffix),
      sha: index === 0 ? rawHead : fakeSha(`no-updater-${suffix}`),
      authoredAtMs: ts(40 - index),
      committedAtMs: ts(40 - index),
    }));
    const adapter = new GitActivityAdapter({
      codeRoots: [codeRoot],
      getHeadCommit: async () => rawHead,
      listCommits: async (_repoDir, options) =>
        commits.slice(options.skip, options.skip + options.maxPerRepo),
    });
    const first = await collectCursorPage(adapter, {
      pageSize: 1,
      maxPages: 1,
    });
    let completed = false;
    const second = [];

    for await (const raw of adapter.sync({
      sinceWatermark: first.cursor,
      pageSize: 1,
      maxPages: 1,
      markWatermarkComplete: () => {
        completed = true;
      },
    })) {
      second.push(raw);
    }

    expect(second).toHaveLength(1);
    expect(completed).toBe(false);
  });

  it("bounds each concurrent repository query by its share of the page", async () => {
    const repos = ["a", "b", "c", "d"].map((name) => makeRepoMarker(name));
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    a._deps.findRepos = () => repos;
    const queryLimits = [];
    a._deps.listCommits = async (repoDir, options) => {
      queryLimits.push(options.maxPerRepo);
      return [fakeCommit(repoDir)];
    };
    let watermarkCompleted = false;
    const raws = [];

    for await (const raw of a.sync({
      pageSize: 8,
      maxPages: 1,
      repoConcurrency: 4,
      markWatermarkComplete: () => {
        watermarkCompleted = true;
      },
    })) {
      raws.push(raw);
    }

    expect(raws).toHaveLength(4);
    expect(queryLimits).toEqual([3, 3, 3, 3]);
    expect(watermarkCompleted).toBe(true);
  });

  it("truncates an oversized subject without blocking a complete watermark", async () => {
    const repoDir = makeRepoMarker("large-subject");
    const a = new GitActivityAdapter({ codeRoots: [codeRoot] });
    a._deps.listCommits = async () => [
      {
        ...fakeCommit(repoDir),
        subject: "x".repeat(20_000),
      },
    ];
    let watermarkCompleted = false;
    const raws = [];

    for await (const raw of a.sync({
      markWatermarkComplete: () => {
        watermarkCompleted = true;
      },
    })) {
      raws.push(raw);
    }

    expect(raws).toHaveLength(1);
    expect(raws[0].payload.subject).toHaveLength(16_384);
    expect(raws[0].payload.subjectTruncated).toBe(true);
    expect(a.normalize(raws[0]).events[0].extra.subjectTruncated).toBe(true);
    expect(watermarkCompleted).toBe(true);
  });
});

describe("git activity log parser", () => {
  it("preserves SOH and record-separator controls inside a subject", () => {
    const sha = fakeSha("control-subject");
    const subject = "keep\u0001both\u001econtrols";
    const stdout = [
      sha,
      "2026-07-24T12:00:00.000Z",
      "2026-07-24T12:01:00.000Z",
      "Author",
      "author@example.invalid",
      subject,
      "",
    ].join("\0");

    const commits = parseGitLog(stdout, codeRoot);

    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe(subject);
    expect(commits[0].committedAtMs).toBe(
      new Date("2026-07-24T12:01:00.000Z").getTime(),
    );
  });

  it("rejects truncated records instead of silently advancing", () => {
    expect(() =>
      parseGitLog(`${fakeSha("truncated")}\0date\0author`, codeRoot),
    ).toThrow(/malformed git log output/u);
  });
});

describe("git repository discovery", () => {
  it("removes inherited Git repository selectors and trace destinations", () => {
    const env = sanitizedGitEnvironment({
      PATH: "safe-path",
      GIT_DIR: "C:\\private\\.git",
      Git_Work_Tree: "C:\\private",
      GIT_TRACE: "C:\\private\\trace.log",
      GIT_TRACE2_EVENT: "C:\\private\\trace2.json",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "include.path",
      GIT_CONFIG_VALUE_0: "C:\\private\\config",
      GIT_SSH_COMMAND: "unsafe-command",
    });

    expect(env.PATH).toBe("safe-path");
    expect(env.GIT_OPTIONAL_LOCKS).toBe("0");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_PAGER).toBe("cat");
    expect(env).not.toHaveProperty("GIT_DIR");
    expect(env).not.toHaveProperty("Git_Work_Tree");
    expect(env).not.toHaveProperty("GIT_TRACE");
    expect(env).not.toHaveProperty("GIT_TRACE2_EVENT");
    expect(env).not.toHaveProperty("GIT_CONFIG_COUNT");
    expect(env).not.toHaveProperty("GIT_CONFIG_KEY_0");
    expect(env).not.toHaveProperty("GIT_CONFIG_VALUE_0");
    expect(env).not.toHaveProperty("GIT_SSH_COMMAND");
  });

  it("reads a validated HEAD object id and recognizes an unborn repository", async () => {
    const repoDir = makeRepo("head-repo", [
      { subject: "head", tsMs: ts(1), author: "Test" },
    ]);
    const emptyRepo = join(codeRoot, "unborn-repo");
    mkdirSync(emptyRepo, { recursive: true });
    execFileSync("git", ["-C", emptyRepo, "init", "-q", "-b", "main"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(await getHeadCommit(repoDir)).toMatch(/^[0-9a-f]{40,64}$/u);
    expect(await getHeadCommit(emptyRepo)).toBeNull();
  });

  it("fails safely instead of treating inaccessible metadata as absent", () => {
    const absent = Object.assign(new Error("absent"), { code: "ENOENT" });
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    const fakeFs = {
      readdirSync: () => [
        {
          name: "blocked",
          isDirectory: () => true,
        },
      ],
      statSync: (target) => {
        if (String(target).includes("blocked")) throw denied;
        throw absent;
      },
    };

    expect(() => findGitRepos(["selected-root"], { fs: fakeFs })).toThrow(
      /Git metadata could not be read/u,
    );
  });
});

describe("GitActivityAdapter.normalize", () => {
  it("maps commit → schema-valid Event(OTHER) with author as actor", () => {
    const a = new GitActivityAdapter();
    const { events } = a.normalize({
      kind: "commit",
      originalId: "git-activity-commit:repo-hash:commit-hash",
      capturedAt: 1_700_000_005_000,
      payload: {
        commitHash: "a".repeat(64),
        shortCommitHash: "a".repeat(12),
        authoredAtMs: 1_700_000_001_000,
        authorName: "Alice",
        authorEmail: "alice@example.com",
        subject: "Fix the bug",
        repoName: "foo",
        repoHash: "b".repeat(64),
      },
    });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.subtype).toBe(EVENT_SUBTYPES.OTHER);
    expect(e.actor).toBe("Alice");
    expect(e.content.title).toBe("Fix the bug");
    expect(e.occurredAt).toBe(1_700_000_001_000);
    expect(e.extra.repoName).toBe("foo");
    expect(e.extra.commitHash).toBe("a".repeat(64));
    expect(e.extra.repoHash).toBe("b".repeat(64));
    expect(e.extra).not.toHaveProperty("repoDir");
    expect(e.extra).not.toHaveProperty("sha");
    expect(validateEvent(e).valid).toBe(true);
  });

  it("truncates long commit subjects to 100 chars in title", () => {
    const a = new GitActivityAdapter();
    const longSubj = "x".repeat(200);
    const { events } = a.normalize({
      kind: "commit",
      capturedAt: 1_700_000_000_000,
      originalId: `git-activity-commit:${"c".repeat(64)}`,
      payload: {
        commitHash: "c".repeat(64),
        shortCommitHash: "c".repeat(12),
        authoredAtMs: 1_700_000_000_000,
        subject: longSubj,
        authorName: "X",
        repoName: "r",
        repoHash: "d".repeat(64),
      },
    });
    expect(events[0].content.title.length).toBeLessThanOrEqual(101);
    expect(events[0].content.title.endsWith("…")).toBe(true);
    expect(events[0].content.text).toBe(longSubj);
  });

  it("sanitizes crafted and legacy raw envelopes during reprocessing", () => {
    const adapter = new GitActivityAdapter();
    const legacyRepoDir = "C:\\Sensitive Workspace\\private-repository";
    const legacySha = fakeSha("legacy-private-object");
    const raw = {
      kind: "commit",
      originalId: `git-commit:${legacyRepoDir}:${legacySha}`,
      capturedAt: 1_700_000_005_000,
      payload: {
        sha: legacySha,
        repoDir: legacyRepoDir,
        repoName: legacyRepoDir,
        authoredAtMs: 1_700_000_001_000,
        authorName: `Author ${legacyRepoDir}`,
        authorEmail: `${legacySha}@example.invalid`,
        subject: `Update ${legacyRepoDir} at ${legacySha}`,
      },
    };

    const { events } = adapter.normalize(raw);
    const serialized = JSON.stringify(events);

    expect(events).toHaveLength(1);
    expect(serialized).not.toContain(legacyRepoDir);
    expect(serialized).not.toContain(legacySha);
    expect(events[0].source.originalId).toMatch(
      /^git-activity-commit:[0-9a-f]{24}:[0-9a-f]{40}$/u,
    );
    expect(events[0].extra.commitHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(events[0].extra.repoHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(events[0].extra).not.toHaveProperty("repoDir");
    expect(events[0].extra).not.toHaveProperty("sha");
    expect(validateEvent(events[0]).valid).toBe(true);
  });

  it("throws on unknown raw.kind", () => {
    expect(() => new GitActivityAdapter().normalize({ kind: "bogus" })).toThrow(
      /unknown raw kind/u,
    );
  });
});
