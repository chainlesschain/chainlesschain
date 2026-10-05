import fs from "node:fs";
import path from "node:path";

export const PROCESS_RECOVERY_CGROUP_SCHEMA =
  "chainlesschain.process-recovery-cgroup/v1";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const CGROUP2_MAGIC = 0x63677270n;
const BOOT_ID = "/proc/sys/kernel/random/boot_id";

function denied(message, cause) {
  return Object.assign(
    new Error(
      `Process recovery cgroup is unavailable: ${message}`,
      cause ? { cause } : undefined,
    ),
    {
      code: "BROKER_PROCESS_RECOVERY_UNAVAILABLE",
      recoveryRequired: true,
    },
  );
}
function requireValue(value, reason) {
  if (!value) throw denied(reason);
}
function identity(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino) };
}
function same(stat, expected, prefix = "") {
  return (
    String(stat.dev) === expected[`${prefix}dev`] &&
    String(stat.ino) === expected[`${prefix}ino`]
  );
}
function rootPath(root) {
  requireValue(
    typeof root === "string" &&
      path.posix.isAbsolute(root) &&
      root !== "/" &&
      !root.includes("\0") &&
      !root.split("/").includes(".."),
    "invalid delegated root",
  );
  return path.posix.normalize(root).replace(/\/+$/u, "");
}

export function validateRecoveryCgroup(value, executionId) {
  requireValue(
    value &&
      Object.keys(value).sort().join() ===
        "bootId,dev,ino,name,root,rootdev,rootino,schema" &&
      value.schema === PROCESS_RECOVERY_CGROUP_SCHEMA &&
      UUID.test(value.bootId) &&
      UUID.test(executionId) &&
      value.name === `cc-owner-${executionId}` &&
      rootPath(value.root) === value.root &&
      [value.dev, value.ino, value.rootdev, value.rootino].every(
        (part) => typeof part === "string" && /^\d{1,30}$/u.test(part),
      ),
    "invalid persisted group identity",
  );
  return value;
}

function openDirectory(io, directory) {
  const before = io.lstatSync(directory, { bigint: true });
  requireValue(
    before.isDirectory() && !before.isSymbolicLink(),
    "cgroup path is not a directory",
  );
  requireValue(
    io.realpathSync(directory) === directory,
    "cgroup path traverses a link",
  );
  const fd = io.openSync(
    directory,
    io.constants.O_RDONLY | io.constants.O_DIRECTORY | io.constants.O_NOFOLLOW,
  );
  try {
    const opened = io.fstatSync(fd, { bigint: true });
    requireValue(
      same(opened, identity(before)),
      "cgroup directory changed while opening",
    );
    requireValue(
      BigInt(io.statfsSync(`/proc/self/fd/${fd}`, { bigint: true }).type) ===
        CGROUP2_MAGIC,
      "not a kernel cgroup v2 filesystem",
    );
    return { fd, stat: opened, pinned: `/proc/self/fd/${fd}` };
  } catch (error) {
    io.closeSync(fd);
    throw error;
  }
}

/** Kernel object identities, not PIDs, establish the recovery target. The root
 * must be explicitly delegated by the host. This is cooperative lifecycle
 * recovery, not confinement against same-UID code that can move cgroup members.
 */
export function openRecoveryCgroup(value, executionId, runtime = {}) {
  const io = runtime.fs || fs;
  requireValue(
    (runtime.platform || process.platform) === "linux",
    "Linux cgroup v2 is required",
  );
  validateRecoveryCgroup(value, executionId);
  requireValue(
    String(io.readFileSync(BOOT_ID, "utf8")).trim() === value.bootId,
    "boot identity changed",
  );
  const root = openDirectory(io, value.root);
  let group;
  try {
    requireValue(
      same(root.stat, value, "root"),
      "delegated root identity changed",
    );
    group = openDirectory(io, path.posix.join(value.root, value.name));
    requireValue(same(group.stat, value), "recovery group identity changed");
  } catch (error) {
    if (group) io.closeSync(group.fd);
    io.closeSync(root.fd);
    throw error;
  }
  let closed = false;
  const assertIdentity = () => {
    requireValue(!closed, "group lease was closed");
    requireValue(
      String(io.readFileSync(BOOT_ID, "utf8")).trim() === value.bootId,
      "boot identity changed",
    );
    const currentRoot = io.lstatSync(value.root, { bigint: true });
    const currentGroup = io.lstatSync(path.posix.join(value.root, value.name), {
      bigint: true,
    });
    requireValue(
      currentRoot.isDirectory() &&
        !currentRoot.isSymbolicLink() &&
        same(currentRoot, value, "root") &&
        currentGroup.isDirectory() &&
        !currentGroup.isSymbolicLink() &&
        same(currentGroup, value),
      "cgroup authority was replaced",
    );
  };
  const populated = () => {
    assertIdentity();
    const bytes = io.readFileSync(`${group.pinned}/cgroup.events`, "utf8");
    requireValue(
      typeof bytes === "string" && bytes.length <= 4096,
      "invalid cgroup event payload",
    );
    const lines = bytes
      .trim()
      .split(/\n/u)
      .map((line) => line.trim().split(/\s+/u));
    const entries = lines.filter(([key]) => key === "populated");
    requireValue(
      entries.length === 1 &&
        entries[0].length === 2 &&
        ["0", "1"].includes(entries[0][1]),
      "missing or invalid populated fence",
    );
    return entries[0][1] === "1";
  };
  return Object.freeze({
    identity: Object.freeze({ ...value }),
    attachBeforeLaunch(proc) {
      assertIdentity();
      requireValue(
        Number.isSafeInteger(proc?.pid) && proc.pid > 0,
        "supervisor PID is unavailable",
      );
      requireValue(!populated(), "new recovery group was already populated");
      // The native supervisor is still blocked on its private launch socket.
      // No target can fork before this write and membership check complete.
      io.writeFileSync(`${group.pinned}/cgroup.procs`, `${proc.pid}\n`, "utf8");
      const members = String(
        io.readFileSync(`${group.pinned}/cgroup.procs`, "utf8"),
      )
        .trim()
        .split(/\s+/u);
      requireValue(
        members.includes(String(proc.pid)),
        "supervisor membership was not observed",
      );
    },
    kill() {
      assertIdentity();
      io.writeFileSync(`${group.pinned}/cgroup.kill`, "1\n", "utf8");
    },
    populated,
    confirmEmpty() {
      requireValue(!populated(), "recovery group remains populated");
      return true;
    },
    close({ remove = false } = {}) {
      if (closed) return;
      try {
        if (remove) {
          requireValue(
            !populated(),
            "cannot remove a populated recovery group",
          );
          io.rmdirSync(`${root.pinned}/${value.name}`);
        }
      } finally {
        closed = true;
        io.closeSync(group.fd);
        io.closeSync(root.fd);
      }
    },
  });
}

export function prepareRecoveryCgroup(executionId, rootInput, runtime = {}) {
  if (!rootInput) return null;
  const io = runtime.fs || fs;
  requireValue(
    (runtime.platform || process.platform) === "linux",
    "Linux cgroup v2 is required",
  );
  requireValue(UUID.test(executionId), "invalid execution identity");
  const root = rootPath(rootInput);
  const opened = openDirectory(io, root);
  const name = `cc-owner-${executionId}`;
  let created = false;
  try {
    const bootId = String(io.readFileSync(BOOT_ID, "utf8")).trim();
    requireValue(UUID.test(bootId), "boot identity is unavailable");
    // The unique group is created through the pinned delegated root.
    io.mkdirSync(`${opened.pinned}/${name}`, { mode: 0o700 });
    created = true;
    const directory = path.posix.join(root, name);
    const stat = io.lstatSync(directory, { bigint: true });
    const value = {
      schema: PROCESS_RECOVERY_CGROUP_SCHEMA,
      root,
      name,
      bootId,
      rootdev: String(opened.stat.dev),
      rootino: String(opened.stat.ino),
      ...identity(stat),
    };
    const group = openRecoveryCgroup(value, executionId, runtime);
    try {
      group.confirmEmpty();
      // Require the real kernel primitive before a recoverable launch is armed.
      const killFd = io.openSync(
        `${directory}/cgroup.kill`,
        io.constants.O_WRONLY | io.constants.O_NOFOLLOW,
      );
      io.closeSync(killFd);
      return group;
    } catch (error) {
      group.close({ remove: true });
      created = false;
      throw error;
    }
  } catch (error) {
    if (created) {
      try {
        io.rmdirSync(`${opened.pinned}/${name}`);
      } catch {
        /* No process was launched into this group. */
      }
    }
    throw denied("preparation failed", error);
  } finally {
    io.closeSync(opened.fd);
  }
}
