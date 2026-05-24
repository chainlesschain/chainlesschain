"use strict";

// GitActivityAdapter — yields recent commits from every .git repo found
// under the user's code roots as a developer-activity timeline.
//
// Pure local: shells out `git log` per repo, no remote fetches.

const path = require("node:path");

const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const {
  defaultCodeRoots,
  findGitRepos,
  listCommits,
} = require("./git-reader");

const NAME = "git-activity";
const VERSION = "0.1.0";

class GitActivityAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:git-log-local"];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 48 };
    this.dataDisclosure = {
      fields: ["commits:sha,authoredAtMs,authorName,authorEmail,subject,repoName"],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { commits: true },
    };
    this._deps = {
      defaultRoots: defaultCodeRoots,
      findRepos: findGitRepos,
      listCommits,
    };
    this._rootsOverride = Array.isArray(opts.codeRoots) ? opts.codeRoots : null;
  }

  _resolveRoots(opts) {
    if (Array.isArray(opts?.codeRoots) && opts.codeRoots.length > 0) {
      return opts.codeRoots;
    }
    if (this._rootsOverride && this._rootsOverride.length > 0) return this._rootsOverride;
    return this._deps.defaultRoots();
  }

  async authenticate(ctx = {}) {
    const roots = this._resolveRoots(ctx);
    if (!roots || roots.length === 0) {
      return {
        ok: false,
        reason: "NO_CODE_ROOTS",
        message: "no default code roots found (tried C:\\code on Win, ~/code ~/projects on Unix); pass opts.codeRoots",
      };
    }
    const repos = this._deps.findRepos(roots);
    if (repos.length === 0) {
      return {
        ok: false,
        reason: "NO_GIT_REPOS",
        message: `no .git directories under any of: ${roots.join(", ")}`,
      };
    }
    return { ok: true, mode: "file-import", codeRoots: roots, repoCount: repos.length };
  }

  async healthCheck() {
    const roots = this._resolveRoots({});
    const ok = roots && roots.length > 0;
    return { ok, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const roots = this._resolveRoots(opts);
    if (!roots || roots.length === 0) {
      throw new Error("git-activity.sync: no code roots — pass opts.codeRoots");
    }
    const repos = this._deps.findRepos(roots);
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPerRepo =
      Number.isInteger(opts.maxPerRepo) && opts.maxPerRepo > 0 ? opts.maxPerRepo : 500;
    const capturedAt = Date.now();
    let emitted = 0;
    for (const repoDir of repos) {
      if (emitted >= limit) return;
      const commits = this._deps.listCommits(repoDir, { since: opts.since, maxPerRepo });
      for (const c of commits) {
        if (emitted >= limit) return;
        yield {
          kind: "commit",
          // sha is globally unique within git's universe — repo path keeps
          // multi-clone scenarios distinct (same sha in two clones = two rows).
          originalId: `git-commit:${repoDir}:${c.sha}`,
          capturedAt,
          payload: c,
        };
        emitted += 1;
      }
    }
  }

  normalize(raw) {
    const ingestedAt = Date.now();
    const source = (originalId) => ({
      adapter: NAME,
      adapterVersion: VERSION,
      capturedAt: raw.capturedAt,
      capturedBy: CAPTURED_BY.SQLITE,
      originalId,
    });

    if (raw.kind === "commit") {
      const p = raw.payload || {};
      const subj = typeof p.subject === "string" && p.subject ? p.subject : "(no subject)";
      const event = {
        id: `event-git-commit-${p.shortSha || p.sha}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: Number.isInteger(p.authoredAtMs) ? p.authoredAtMs : raw.capturedAt,
        ingestedAt,
        source: source(raw.originalId),
        actor: p.authorName || p.authorEmail || "self",
        content: {
          title: subj.length > 100 ? subj.substring(0, 100) + "…" : subj,
          text: subj,
        },
        extra: {
          kind: "git-commit",
          sha: p.sha || null,
          shortSha: p.shortSha || null,
          repoName: p.repoName || null,
          repoDir: p.repoDir || null,
          authorName: p.authorName || null,
          authorEmail: p.authorEmail || null,
        },
      };
      return { events: [event], persons: [], places: [], items: [], topics: [] };
    }

    throw new Error(`git-activity.normalize: unknown raw.kind=${raw.kind}`);
  }
}

module.exports = {
  GitActivityAdapter,
  GIT_ACTIVITY_NAME: NAME,
  GIT_ACTIVITY_VERSION: VERSION,
};
