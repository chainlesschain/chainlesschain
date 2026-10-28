import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import executionBroker from "./process-execution-broker/index.js";
import {
  fileStatIdentity,
  sameFileStatIdentity,
  samePathHandleFileIdentity,
} from "./secure-file-identity.js";

const fsp = fs.promises;
const sha256 = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fail = (code) => {
  throw Object.assign(new Error(code), { goalWorkspaceCode: code });
};
const LIMITS = Object.freeze({
  maxFiles: 50_000,
  maxBytes: 512 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024,
  maxMs: 15_000,
});

function inside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function samePath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function hasGitAncestor(root) {
  for (let current = root; ; current = path.dirname(current)) {
    try {
      await fsp.lstat(path.join(current, ".git"));
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (path.dirname(current) === current) return false;
  }
}

function gitFiles(root, maxFiles) {
  // No shell, index writes, filters, hooks, or inherited Git redirection. The
  // broker remains the sole process boundary; no provider credentials needed.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(path|systemroot|windir|temp|tmp|home|userprofile)$/i.test(key),
    ),
  );
  const result = executionBroker.spawnSync(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ".",
    ],
    {
      cwd: root,
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
      origin: "headless-goal:workspace-evidence",
      scope: "headless-goal",
      policy: "allow",
      env: { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    },
  );
  if (result.error || result.signal || result.status !== 0)
    fail("source-list-unavailable");
  const files = [...new Set(result.stdout.split("\0").filter(Boolean))].sort();
  if (files.length > maxFiles) fail("resource-limit");
  return files;
}

async function directoryFiles(root, check, maxFiles) {
  const files = [];
  let entries = 0;
  const walk = async (relative) => {
    check();
    const dir = await fsp.opendir(path.join(root, relative));
    for await (const entry of dir) {
      check();
      if (++entries > maxFiles) fail("resource-limit");
      const name = path.join(relative, entry.name);
      if (entry.name === ".git") continue;
      if (entry.isDirectory()) await walk(name);
      else files.push(name);
    }
  };
  await walk("");
  return files.sort();
}

/** Read-only content evidence. Git scope is tracked + nonignored files under
 * cwd; artifact reads also cover ignored output files. No Git scope is silently
 * replaced by a smaller directory scan when Git fails. This detects ordinary
 * concurrent changes, not a hostile writer that can perform undetectable ABA.
 */
export async function captureGoalWorkspace(
  cwd,
  call,
  { signal, limits = {} } = {},
) {
  const bounds = { ...LIMITS, ...limits };
  const started = Date.now();
  let rootHandle;
  const check = () => {
    if (signal?.aborted) fail("cancelled");
    if (Date.now() - started > bounds.maxMs) fail("resource-limit");
  };
  try {
    check();
    const artifact = call?.tool === "read_file";
    const workspaceTool = call?.tool === "run_shell";
    if (!artifact && !workspaceTool) fail("tool-scope-unavailable");
    const root = await fsp.realpath(path.resolve(cwd));
    const rootStat = await fsp.stat(root, { bigint: true });
    if (!rootStat.isDirectory()) fail("workspace-unavailable");
    rootHandle = await fsp.open(root, fs.constants.O_RDONLY);
    const rootDevice = (await rootHandle.stat({ bigint: true })).dev;
    const workspaceId = sha256(
      JSON.stringify([
        root,
        String(rootStat.dev),
        String(rootStat.ino),
        String(rootStat.birthtimeNs),
      ]),
    );
    let scope;
    let list;
    if (artifact) {
      if (typeof call.args?.path !== "string" || !call.args.path)
        fail("artifact-path-unavailable");
      const target = path.resolve(root, call.args.path);
      if (!inside(root, target) || target === root) fail("outside-workspace");
      scope = "artifact";
      list = async () => [path.relative(root, target)];
    } else if (await hasGitAncestor(root)) {
      scope = "git-visible-files-under-cwd";
      list = async () => gitFiles(root, bounds.maxFiles);
    } else {
      scope = "directory-files-under-cwd";
      list = () => directoryFiles(root, check, bounds.maxFiles);
    }
    const files = await list();
    check();
    const content = createHash("sha256");
    const freshness = createHash("sha256");
    const identities = [];
    const artifacts = [];
    let totalBytes = 0;
    for (const relative of files) {
      check();
      const target = path.resolve(root, relative);
      if (!inside(root, target)) fail("outside-workspace");
      // Canonical parents must stay within this exact workspace. Symlinks,
      // submodules, special files and unreadable entries are not partial proof.
      let before;
      try {
        before = await fsp.lstat(target, { bigint: true });
      } catch (error) {
        // Deleted tracked files are part of the current source version. A
        // missing requested artifact, however, cannot support completion.
        if (scope !== "git-visible-files-under-cwd" || error.code !== "ENOENT")
          throw error;
        content.update(
          JSON.stringify({ path: relative, missing: true }) + "\n",
        );
        freshness.update(
          JSON.stringify({ path: relative, missing: true }) + "\n",
        );
        identities.push([target, null]);
        continue;
      }
      const canonical = await fsp.realpath(target);
      if (!samePath(canonical, target) || !inside(root, canonical))
        fail("linked-entry");
      if (!before.isFile() || before.nlink !== 1n) fail("unsupported-entry");
      if (before.size > BigInt(bounds.maxFileBytes)) fail("resource-limit");
      totalBytes += Number(before.size);
      if (totalBytes > bounds.maxBytes) fail("resource-limit");
      let handle;
      try {
        handle = await fsp.open(
          target,
          fs.constants.O_RDONLY |
            (fs.constants.O_NOFOLLOW || 0) |
            (fs.constants.O_NONBLOCK || 0),
        );
        const opened = await handle.stat({ bigint: true });
        if (!samePathHandleFileIdentity(before, opened, rootDevice))
          fail("workspace-changed");
        const digest = createHash("sha256");
        const buffer = Buffer.alloc(64 * 1024);
        let size = 0;
        while (true) {
          check();
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.length,
            null,
          );
          if (bytesRead === 0) break;
          size += bytesRead;
          if (size > Number(before.size)) fail("workspace-changed");
          digest.update(buffer.subarray(0, bytesRead));
        }
        const after = await fsp.lstat(target, { bigint: true });
        if (
          size !== Number(before.size) ||
          !sameFileStatIdentity(before, after) ||
          !samePathHandleFileIdentity(
            after,
            await handle.stat({ bigint: true }),
            rootDevice,
          )
        )
          fail("workspace-changed");
        const entry = {
          path: relative.split(path.sep).join("/"),
          size,
          digest: `sha256:${digest.digest("hex")}`,
        };
        content.update(JSON.stringify(entry) + "\n");
        freshness.update(
          JSON.stringify([entry.path, fileStatIdentity(after)]) + "\n",
        );
        identities.push([target, after]);
        if (artifact) artifacts.push(entry);
      } finally {
        await handle?.close();
      }
    }
    if (JSON.stringify(await list()) !== JSON.stringify(files))
      fail("workspace-changed");
    check();
    for (const [target, stat] of identities) {
      check();
      let current = null;
      try {
        current = await fsp.lstat(target, { bigint: true });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (
        stat === null
          ? current !== null
          : !current || !sameFileStatIdentity(stat, current)
      )
        fail("workspace-changed");
    }
    const finalRoot = await fsp.stat(root, { bigint: true });
    if (
      (await fsp.realpath(path.resolve(cwd))) !== root ||
      finalRoot.ino !== rootStat.ino ||
      finalRoot.dev !== rootStat.dev ||
      finalRoot.birthtimeNs !== rootStat.birthtimeNs
    )
      fail("workspace-changed");
    check();
    return {
      verified: true,
      scope,
      workspaceId,
      digest: `sha256:${content.digest("hex")}`,
      freshnessDigest: `sha256:${freshness.digest("hex")}`,
      fileCount: files.length,
      totalBytes,
      ...(artifact ? { artifacts } : {}),
    };
  } catch (error) {
    // File/provider text is not a diagnostic channel. Missing/denied/unstable
    // coverage remains unavailable and must not become a positive verdict.
    return {
      verified: false,
      reason: error.goalWorkspaceCode || "workspace-unavailable",
    };
  } finally {
    await rootHandle?.close();
  }
}
