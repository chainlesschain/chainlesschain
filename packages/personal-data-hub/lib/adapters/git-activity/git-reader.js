"use strict";

// git-reader — enumerates `.git` directories under configured code roots
// and shells out `git log` to extract recent commits. No clone-time
// metadata, no remote network calls; pure local-filesystem walk.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

const MAX_SHALLOW_FILE_BYTES = 8 * 1024 * 1024;
const MAX_REACHABLE_OBJECTS = 500_001;

function sanitizedGitEnvironment(source = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (/^GIT_/iu.test(key)) continue;
    env[key] = value;
  }
  // These commands are read-only and must not inherit repository selectors,
  // trace destinations, config injection, SSH overrides, or alternate object
  // stores from a parent shell.
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_PAGER = "cat";
  return env;
}

function gitExecOptions(overrides = {}) {
  return {
    encoding: "utf-8",
    timeout: 10_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
    env: sanitizedGitEnvironment(),
    ...overrides,
  };
}

function execGit(repoDir, args, overrides = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", repoDir, ...args],
      gitExecOptions(overrides),
      (error, stdout) => {
        if (error) reject(error);
        else resolve(String(stdout || ""));
      },
    );
  });
}

function defaultCodeRoots() {
  const home = os.homedir();
  if (process.platform === "win32") {
    // Most devs on Windows use C:\code\ or ~/code/.
    const candidates = [
      "C:\\code",
      path.join(home, "code"),
      path.join(home, "projects"),
    ];
    return candidates.filter((d) => {
      try {
        return fs.statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
  }
  return [
    path.join(home, "code"),
    path.join(home, "projects"),
    path.join(home, "src"),
  ].filter((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

function metadataReadError() {
  const error = new Error("git-activity: Git metadata could not be read");
  error.code = "GIT_METADATA_READ_FAILED";
  return error;
}

function statMetadata(fsMod, target) {
  try {
    return fsMod.statSync(target);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw metadataReadError();
  }
}

function looksLikeGitMetadata(dotGit, fsMod = fs) {
  const stat = statMetadata(fsMod, dotGit);
  if (!stat) return false;
  if (stat.isDirectory()) {
    const head = statMetadata(fsMod, path.join(dotGit, "HEAD"));
    const config = statMetadata(fsMod, path.join(dotGit, "config"));
    return Boolean(head?.isFile() && config?.isFile());
  }
  if (!stat.isFile() || stat.size > 4_096) return false;
  try {
    return /^gitdir:\s*\S.+$/imu.test(
      fsMod.readFileSync(dotGit, { encoding: "utf-8" }),
    );
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw metadataReadError();
  }
}

// Find every structurally valid `.git` directory/file one level under each
// root. Skips bare and nested repos to keep the surface area predictable.
function findGitRepos(roots, opts = {}) {
  const fsMod = opts.fs || fs;
  const out = [];
  for (const root of roots) {
    let entries;
    try {
      entries = fsMod.readdirSync(root, { withFileTypes: true });
    } catch {
      const error = new Error(
        "git-activity: a configured code root could not be read",
      );
      error.code = "CODE_ROOT_READ_FAILED";
      throw error;
    }
    if (looksLikeGitMetadata(path.join(root, ".git"), fsMod)) out.push(root);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const repoDir = path.join(root, e.name);
      const dotGit = path.join(repoDir, ".git");
      if (!looksLikeGitMetadata(dotGit, fsMod)) continue;
      out.push(repoDir);
    }
  }
  return out;
}

// Git object metadata cannot contain NUL, so `%x00` provides an unambiguous
// record format even when names or subjects contain other control characters.
const FIELD_SEP = "\0";

function verifyEmptyRepository(repoDir, callback) {
  const options = gitExecOptions();
  execFile(
    "git",
    ["-C", repoDir, "rev-parse", "--verify", "--quiet", "HEAD"],
    options,
    (headError) => {
      if (!headError) {
        callback(false);
        return;
      }
      execFile(
        "git",
        ["-C", repoDir, "symbolic-ref", "--quiet", "HEAD"],
        options,
        (symbolicError, stdout) => {
          const headRef = String(stdout || "").trim();
          if (symbolicError || !/^refs\/heads\/[^\r\n]+$/u.test(headRef)) {
            callback(false);
            return;
          }
          execFile(
            "git",
            ["-C", repoDir, "show-ref", "--verify", "--quiet", headRef],
            options,
            (refError) => {
              if (!refError || Number(refError.code) !== 1) {
                callback(false);
                return;
              }
              execFile(
                "git",
                [
                  "-C",
                  repoDir,
                  "status",
                  "--porcelain=v1",
                  "--untracked-files=no",
                ],
                options,
                (statusError) => callback(!statusError),
              );
            },
          );
        },
      );
    },
  );
}

function getHeadCommit(repoDir) {
  const options = gitExecOptions();
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", repoDir, "rev-parse", "--verify", "HEAD"],
      options,
      (error, stdout) => {
        if (!error) {
          const sha = String(stdout || "")
            .trim()
            .toLowerCase();
          if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(sha)) {
            resolve(sha);
          } else {
            const parseError = new Error(
              "git-activity: invalid HEAD object id",
            );
            parseError.code = "GIT_HEAD_PARSE_FAILED";
            reject(parseError);
          }
          return;
        }
        if (Number(error.code) !== 128) {
          reject(error);
          return;
        }
        verifyEmptyRepository(repoDir, (isReadable) => {
          if (isReadable) resolve(null);
          else reject(error);
        });
      },
    );
  });
}

function shallowStateError() {
  const error = new Error(
    "git-activity: repository shallow state could not be read safely",
  );
  error.code = "GIT_SHALLOW_STATE_FAILED";
  return error;
}

function readStableShallowFile(filePath) {
  let before;
  let buffer;
  let after;
  try {
    before = fs.statSync(filePath);
    if (!before.isFile() || before.size > MAX_SHALLOW_FILE_BYTES) {
      throw shallowStateError();
    }
    buffer = fs.readFileSync(filePath);
    after = fs.statSync(filePath);
  } catch (error) {
    if (error?.code === "GIT_SHALLOW_STATE_FAILED") throw error;
    throw shallowStateError();
  }
  if (
    buffer.length !== before.size ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs
  ) {
    throw shallowStateError();
  }
  const lines = buffer
    .toString("utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  if (
    lines.length === 0 ||
    lines.some((line) => !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(line))
  ) {
    throw shallowStateError();
  }
  return [...new Set(lines)].sort();
}

async function getShallowBoundaryFingerprint(repoDir) {
  let shallow;
  try {
    shallow = (await execGit(repoDir, ["rev-parse", "--is-shallow-repository"]))
      .trim()
      .toLowerCase();
  } catch {
    throw shallowStateError();
  }
  if (shallow === "false") return null;
  if (shallow !== "true") throw shallowStateError();

  let shallowPath;
  try {
    const rawPath = (
      await execGit(repoDir, ["rev-parse", "--git-path", "shallow"])
    ).trim();
    if (
      rawPath.length === 0 ||
      rawPath.length > 4_096 ||
      rawPath.includes("\0")
    ) {
      throw shallowStateError();
    }
    shallowPath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(repoDir, rawPath);
  } catch (error) {
    if (error?.code === "GIT_SHALLOW_STATE_FAILED") throw error;
    throw shallowStateError();
  }

  const boundaries = readStableShallowFile(shallowPath);
  return crypto
    .createHash("sha256")
    .update(`git-activity\0shallow\0${boundaries.join("\0")}`, "utf8")
    .digest("hex");
}

async function listReachableCommitIds(repoDir, opts = {}) {
  const revision =
    typeof opts.revision === "string" &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(opts.revision)
      ? opts.revision.toLowerCase()
      : null;
  if (!revision) {
    const error = new Error("git-activity: invalid revision");
    error.code = "GIT_REVISION_INVALID";
    throw error;
  }
  const maxCount =
    Number.isSafeInteger(opts.maxCount) &&
    opts.maxCount > 0 &&
    opts.maxCount <= MAX_REACHABLE_OBJECTS
      ? opts.maxCount
      : MAX_REACHABLE_OBJECTS;
  const stdout = await execGit(
    repoDir,
    ["rev-list", `--max-count=${maxCount}`, revision],
    {
      timeout: 30_000,
      maxBuffer: 48 * 1024 * 1024,
    },
  );
  const ids = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  if (ids.some((value) => !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value))) {
    const error = new Error("git-activity: malformed reachable object output");
    error.code = "GIT_LOG_PARSE_FAILED";
    throw error;
  }
  return ids;
}

function listCommits(repoDir, opts = {}) {
  const sinceMs =
    Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  // git wants ISO-ish dates or relative; use unix-seconds for precision.
  const sinceArg =
    sinceMs > 0 ? `--since=@${Math.floor(sinceMs / 1000)}` : null;
  const maxN =
    Number.isInteger(opts.maxPerRepo) && opts.maxPerRepo > 0
      ? opts.maxPerRepo
      : 500;
  const skip = Number.isSafeInteger(opts.skip) && opts.skip > 0 ? opts.skip : 0;
  const revision =
    typeof opts.revision === "string" &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(opts.revision)
      ? opts.revision.toLowerCase()
      : null;
  const excludeRevision =
    typeof opts.excludeRevision === "string" &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(opts.excludeRevision)
      ? opts.excludeRevision.toLowerCase()
      : null;
  const fmt = ["%H", "%aI", "%cI", "%an", "%ae", "%s", ""].join("%x00");
  return new Promise((resolve, reject) => {
    const args = [
      "-C",
      repoDir,
      "log",
      ...(sinceArg ? [sinceArg] : []),
      ...(skip > 0 ? [`--skip=${skip}`] : []),
      `-n${maxN}`,
      `--pretty=format:${fmt}`,
      "--no-merges",
      ...(revision ? [revision] : []),
      ...(excludeRevision ? [`^${excludeRevision}`] : []),
    ];
    execFile(
      "git",
      args,
      gitExecOptions({
        timeout: 30_000,
        maxBuffer: 32 * 1024 * 1024, // 32 MB — handles repos with many commits
      }),
      (error, stdout) => {
        if (error) {
          // A valid repository with an unborn HEAD makes `git log` exit 128.
          // Confirm it is otherwise readable before treating that state as an
          // empty, complete result. Corrupt/inaccessible repositories still
          // reject so the adapter can defer its completeness watermark.
          if (Number(error.code) === 128) {
            verifyEmptyRepository(repoDir, (isReadable) => {
              if (isReadable) resolve([]);
              else reject(error);
            });
            return;
          }
          reject(error);
          return;
        }
        resolve(parseGitLog(stdout, repoDir));
      },
    );
  });
}

function parseGitLog(stdout, repoDir) {
  const repoName = path.basename(repoDir);
  const out = [];
  const parts = String(stdout || "").split(FIELD_SEP);
  if (parts.at(-1) === "") parts.pop();
  if (parts.length === 0) return out;
  if (parts.length % 6 !== 0) {
    const error = new Error("git-activity: malformed git log output");
    error.code = "GIT_LOG_PARSE_FAILED";
    throw error;
  }
  for (let index = 0; index < parts.length; index += 6) {
    const sha = parts[index].replace(/^[\r\n]+/u, "");
    const authoredIsoDate = parts[index + 1];
    const committedIsoDate = parts[index + 2];
    const authorName = parts[index + 3];
    const authorEmail = parts[index + 4];
    const subject = parts[index + 5];
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(sha)) {
      const error = new Error("git-activity: invalid object id in git log");
      error.code = "GIT_LOG_PARSE_FAILED";
      throw error;
    }
    const authoredDate = new Date(authoredIsoDate);
    const committedDate = new Date(committedIsoDate);
    const authoredAtMs = Number.isFinite(authoredDate.getTime())
      ? authoredDate.getTime()
      : 0;
    const committedAtMs = Number.isFinite(committedDate.getTime())
      ? committedDate.getTime()
      : 0;
    if (authoredAtMs === 0 || committedAtMs === 0) {
      const error = new Error("git-activity: invalid timestamp in git log");
      error.code = "GIT_LOG_PARSE_FAILED";
      throw error;
    }
    out.push({
      sha,
      shortSha: sha.substring(0, 8),
      authoredAtMs,
      committedAtMs,
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
  looksLikeGitMetadata,
  getHeadCommit,
  getShallowBoundaryFingerprint,
  listReachableCommitIds,
  listCommits,
  parseGitLog,
  sanitizedGitEnvironment,
};
