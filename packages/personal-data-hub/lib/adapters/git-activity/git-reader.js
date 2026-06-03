"use strict";

// git-reader — enumerates `.git` directories under configured code roots
// and shells out `git log` to extract recent commits. No clone-time
// metadata, no remote network calls; pure local-filesystem walk.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

function defaultCodeRoots() {
  const home = os.homedir();
  if (process.platform === "win32") {
    // Most devs on Windows use C:\code\ or ~/code/.
    const candidates = ["C:\\code", path.join(home, "code"), path.join(home, "projects")];
    return candidates.filter((d) => {
      try {
        return fs.statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
  }
  return [path.join(home, "code"), path.join(home, "projects"), path.join(home, "src")].filter(
    (d) => {
      try {
        return fs.statSync(d).isDirectory();
      } catch {
        return false;
      }
    },
  );
}

// Find every `.git` directory one level under each root. Skips bare /
// nested repos for v0.1 — keeps the surface area predictable.
function findGitRepos(roots, opts = {}) {
  const fsMod = opts.fs || fs;
  const out = [];
  for (const root of roots) {
    let entries;
    try {
      entries = fsMod.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const repoDir = path.join(root, e.name);
      const dotGit = path.join(repoDir, ".git");
      if (!fsMod.existsSync(dotGit)) continue;
      out.push(repoDir);
    }
  }
  return out;
}

// Run git log against one repo. The pipe delimiter is safer than a single
// char because commit messages may contain tabs or pipes — we add a
// recognizable sentinel between fields. Bail to [] on any spawn error so
// one corrupt repo doesn't sink the whole sync.
const FIELD_SEP = ""; // SOH — guaranteed absent from commit metadata
const ROW_SEP = ""; // RS

function listCommits(repoDir, opts = {}) {
  const sinceMs = Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  // git wants ISO-ish dates or relative; use unix-seconds for precision.
  const sinceArg = sinceMs > 0 ? `--since=@${Math.floor(sinceMs / 1000)}` : "--since=180.days";
  const maxN = Number.isInteger(opts.maxPerRepo) && opts.maxPerRepo > 0 ? opts.maxPerRepo : 500;
  const fmt = ["%H", "%aI", "%an", "%ae", "%s"].join(FIELD_SEP) + ROW_SEP;
  let stdout = "";
  try {
    stdout = execFileSync(
      "git",
      [
        "-C",
        repoDir,
        "log",
        sinceArg,
        `-n${maxN}`,
        `--pretty=format:${fmt}`,
        "--no-merges",
      ],
      {
        encoding: "utf-8",
        timeout: 30_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 32 * 1024 * 1024, // 32 MB — handles repos with many commits
      },
    );
  } catch {
    return [];
  }
  const repoName = path.basename(repoDir);
  const out = [];
  for (const raw of stdout.split(ROW_SEP)) {
    const line = raw.replace(/^[\r\n]+/, "").replace(/[\r\n]+$/, "");
    if (!line) continue;
    const parts = line.split(FIELD_SEP);
    if (parts.length < 5) continue;
    const [sha, isoDate, authorName, authorEmail, subject] = parts;
    const d = new Date(isoDate);
    const ts = Number.isFinite(d.getTime()) ? d.getTime() : 0;
    if (ts === 0) continue;
    out.push({
      sha,
      shortSha: sha.substring(0, 8),
      authoredAtMs: ts,
      authorName: authorName || "",
      authorEmail: authorEmail || "",
      subject: subject || "",
      repoDir,
      repoName,
    });
  }
  return out;
}

module.exports = {
  defaultCodeRoots,
  findGitRepos,
  listCommits,
};
