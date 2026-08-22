/**
 * Optional cgroup v2 resource association for one broker-launched tool.
 *
 * A caller must explicitly supply a delegated cgroup root. This module never
 * enables controllers on a parent cgroup; it creates only a uniquely named
 * child below that explicit root. If memory is not already delegated, the
 * feature is reported unavailable.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

export const LINUX_CGROUP_MODES = Object.freeze(["optional", "required"]);

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function normalizePositiveInteger(field, value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new TypeError(`invalid Linux cgroup policy: ${field}`);
  }
  return normalized;
}

function normalizeRoot(value) {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.includes("\0") ||
    !path.posix.isAbsolute(value) ||
    value.split("/").includes("..")
  ) {
    throw new TypeError("invalid Linux cgroup policy: root");
  }
  const normalized = path.posix.normalize(value);
  if (normalized === "/") {
    throw new TypeError("invalid Linux cgroup policy: root");
  }
  return normalized.replace(/\/+$/, "");
}

/**
 * Validate the only cgroup settings that can cross the broker boundary.
 * `memoryMaxBytes` is mandatory so an enabled policy always provides the
 * P1-6 per-tool memory ceiling, not merely an audit label.
 */
export function normalizeLinuxCgroupPolicy(value) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    throw new TypeError("invalid Linux cgroup policy");
  }
  const allowed = new Set([
    "mode",
    "root",
    "memoryMaxBytes",
    "memoryHighBytes",
    "pidsMax",
    "cpuQuotaMicros",
    "cpuPeriodMicros",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TypeError("invalid Linux cgroup policy field");
  }
  const mode = value.mode ?? "optional";
  if (!LINUX_CGROUP_MODES.includes(mode)) {
    throw new TypeError("invalid Linux cgroup policy: mode");
  }
  const memoryMaxBytes = normalizePositiveInteger(
    "memoryMaxBytes",
    value.memoryMaxBytes,
  );
  const memoryHighBytes =
    value.memoryHighBytes === undefined || value.memoryHighBytes === null
      ? null
      : normalizePositiveInteger("memoryHighBytes", value.memoryHighBytes);
  if (memoryHighBytes !== null && memoryHighBytes > memoryMaxBytes) {
    throw new TypeError(
      "invalid Linux cgroup policy: memoryHighBytes exceeds memoryMaxBytes",
    );
  }
  const pidsMax =
    value.pidsMax === undefined || value.pidsMax === null
      ? null
      : normalizePositiveInteger("pidsMax", value.pidsMax);
  const cpuQuotaMicros =
    value.cpuQuotaMicros === undefined || value.cpuQuotaMicros === null
      ? null
      : normalizePositiveInteger("cpuQuotaMicros", value.cpuQuotaMicros);
  const cpuPeriodMicros =
    cpuQuotaMicros === null
      ? null
      : value.cpuPeriodMicros === undefined || value.cpuPeriodMicros === null
        ? 100_000
        : normalizePositiveInteger("cpuPeriodMicros", value.cpuPeriodMicros);

  return Object.freeze({
    mode,
    root: normalizeRoot(value.root),
    memoryMaxBytes,
    memoryHighBytes,
    pidsMax,
    cpuQuotaMicros,
    cpuPeriodMicros,
  });
}

function requestedControllers(policy) {
  const controllers = ["memory"];
  if (policy.pidsMax !== null) controllers.push("pids");
  if (policy.cpuQuotaMicros !== null) controllers.push("cpu");
  return controllers;
}

function readControllerSet(fs, pathname) {
  return new Set(
    String(fs.readFileSync(pathname, "utf8") || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );
}

function unavailable(reason) {
  return Object.freeze({ ok: false, reason });
}

function cgroupEvidence(policy, state, reason = null) {
  return Object.freeze({
    kind: "linux-cgroup-v2-tool-memory-v1",
    mode: policy.mode,
    state,
    reason,
    memoryMaxBytes: policy.memoryMaxBytes,
    ...(policy.memoryHighBytes !== null
      ? { memoryHighBytes: policy.memoryHighBytes }
      : {}),
    ...(policy.pidsMax !== null ? { pidsMax: policy.pidsMax } : {}),
    ...(policy.cpuQuotaMicros !== null
      ? {
          cpuQuotaMicros: policy.cpuQuotaMicros,
          cpuPeriodMicros: policy.cpuPeriodMicros,
        }
      : {}),
  });
}

function removeChildCgroup(fs, cgroupPath) {
  try {
    fs.rmdirSync(cgroupPath);
    return true;
  } catch (error) {
    // It is safe to retry at process exit. In particular, an already-attached
    // child makes rmdir return EBUSY until the broker's exit fence fires.
    return error?.code === "ENOENT";
  }
}

/**
 * Pre-create and configure a child cgroup. Attaching a PID is deliberately a
 * separate synchronous post-spawn step, because only child_process.spawn()
 * knows the real tool PID. All failures are converted to stable availability
 * reasons so a required policy can fail closed without exposing host paths.
 */
export function prepareLinuxCgroupV2(policyInput, runtime = {}) {
  const policy = normalizeLinuxCgroupPolicy(policyInput);
  if (!policy) return unavailable("linux_cgroup_not_configured");
  if (runtime.platform !== "linux") {
    return unavailable("linux_cgroup_platform_unavailable");
  }
  const fs = runtime.fs;
  if (
    !fs ||
    typeof fs.readFileSync !== "function" ||
    typeof fs.mkdirSync !== "function" ||
    typeof fs.writeFileSync !== "function" ||
    typeof fs.rmdirSync !== "function"
  ) {
    return unavailable("linux_cgroup_runtime_unavailable");
  }

  const controllers = requestedControllers(policy);
  let supported;
  let delegated;
  try {
    supported = readControllerSet(
      fs,
      path.posix.join(policy.root, "cgroup.controllers"),
    );
    delegated = readControllerSet(
      fs,
      path.posix.join(policy.root, "cgroup.subtree_control"),
    );
  } catch {
    return unavailable("linux_cgroup_v2_unavailable");
  }
  if (controllers.some((controller) => !supported.has(controller))) {
    return unavailable("linux_cgroup_controller_unavailable");
  }
  if (controllers.some((controller) => !delegated.has(controller))) {
    return unavailable("linux_cgroup_controller_not_delegated");
  }

  const cgroupPath = path.posix.join(policy.root, `cc-tool-${randomUUID()}`);
  try {
    fs.mkdirSync(cgroupPath, { mode: 0o700 });
  } catch {
    return unavailable("linux_cgroup_create_failed");
  }

  const limits = [
    ["memory.max", String(policy.memoryMaxBytes)],
    ...(policy.memoryHighBytes !== null
      ? [["memory.high", String(policy.memoryHighBytes)]]
      : []),
    ...(policy.pidsMax !== null ? [["pids.max", String(policy.pidsMax)]] : []),
    ...(policy.cpuQuotaMicros !== null
      ? [["cpu.max", `${policy.cpuQuotaMicros} ${policy.cpuPeriodMicros}`]]
      : []),
  ];
  try {
    for (const [file, content] of limits) {
      fs.writeFileSync(path.posix.join(cgroupPath, file), content, "utf8");
    }
  } catch {
    removeChildCgroup(fs, cgroupPath);
    return unavailable("linux_cgroup_limit_write_failed");
  }

  let attached = false;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return true;
    const removed = removeChildCgroup(fs, cgroupPath);
    if (removed) cleaned = true;
    return removed;
  };
  return Object.freeze({
    ok: true,
    evidence: cgroupEvidence(policy, "prepared"),
    attach(proc) {
      const pid = Number(proc?.pid);
      if (!Number.isSafeInteger(pid) || pid < 1) {
        cleanup();
        const error = new Error("Linux cgroup post-spawn PID is unavailable");
        error.code = "ERR_LINUX_CGROUP_ATTACH";
        error.cgroupReason = "linux_cgroup_invalid_pid";
        throw error;
      }
      try {
        fs.writeFileSync(
          path.posix.join(cgroupPath, "cgroup.procs"),
          `${pid}\n`,
          "utf8",
        );
        attached = true;
      } catch {
        cleanup();
        const error = new Error("Linux cgroup post-spawn association failed");
        error.code = "ERR_LINUX_CGROUP_ATTACH";
        error.cgroupReason = "linux_cgroup_attach_failed";
        throw error;
      }
      return true;
    },
    cleanup,
    status() {
      return Object.freeze({
        ...cgroupEvidence(policy, attached ? "enforced" : "prepared"),
        attached,
      });
    },
  });
}

function unavailablePlan(plan, policy, reason) {
  return Object.freeze({
    contractVersion: 1,
    applied: false,
    platform: plan.platform,
    profile: plan.profile,
    command: plan.command,
    args: [...(plan.args || [])],
    options: { ...(plan.options || {}) },
    enforcement: null,
    backend: null,
    candidateBackend: "linux-cgroup-v2",
    guarantees: [],
    reason,
    resourceControl: cgroupEvidence(policy, "unavailable", reason),
    cleanup: plan.cleanup,
    postSpawn: Object.freeze({ required: false, mode: "none" }),
  });
}

/**
 * Decorate an existing platform plan. Optional policy preserves the existing
 * plan on hosts without a delegated cgroup; required policy returns an
 * unavailable plan so ProcessExecutionBroker's resource-limits boundary
 * rejects before native spawn.
 */
export function applyLinuxCgroupV2ToPlan(plan, policyInput, runtime = {}) {
  const policy = normalizeLinuxCgroupPolicy(policyInput);
  if (!policy) return plan;
  if (!plan?.applied) {
    return policy.mode === "required"
      ? unavailablePlan(
          plan,
          policy,
          plan?.reason || "linux_cgroup_unavailable",
        )
      : Object.freeze({
          ...plan,
          resourceControl: cgroupEvidence(
            policy,
            "unavailable",
            plan?.reason || "linux_cgroup_unavailable",
          ),
        });
  }
  if (runtime.sync === true) {
    const reason = "linux_cgroup_post_spawn_unavailable_for_sync";
    return policy.mode === "required"
      ? unavailablePlan(plan, policy, reason)
      : Object.freeze({
          ...plan,
          resourceControl: cgroupEvidence(policy, "unavailable", reason),
        });
  }
  if (plan.postSpawn?.required) {
    return policy.mode === "required"
      ? unavailablePlan(plan, policy, "linux_cgroup_post_spawn_conflict")
      : Object.freeze({
          ...plan,
          resourceControl: cgroupEvidence(
            policy,
            "unavailable",
            "linux_cgroup_post_spawn_conflict",
          ),
        });
  }
  const prepared = prepareLinuxCgroupV2(policy, runtime);
  if (!prepared.ok) {
    if (policy.mode === "required") {
      return unavailablePlan(plan, policy, prepared.reason);
    }
    return Object.freeze({
      ...plan,
      resourceControl: cgroupEvidence(policy, "unavailable", prepared.reason),
    });
  }

  let cleaned = false;
  const upstreamCleanup = plan.cleanup;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      prepared.cleanup();
    } finally {
      upstreamCleanup?.();
    }
  };
  return Object.freeze({
    ...plan,
    guarantees: Object.freeze([
      ...new Set([...(plan.guarantees || []), "resource-limits"]),
    ]),
    resourceControl: cgroupEvidence(policy, "prepared"),
    cleanup,
    postSpawn: Object.freeze({ required: true, mode: "sync" }),
    postSpawnLinux: (proc) => {
      const attached = prepared.attach(proc);
      // ProcessExecutionBroker installs its generic cleanup listener before
      // this post-spawn association. If a later broker bookkeeping step fails
      // and invokes cleanup while the child is still alive, this second exit
      // listener retries the cgroup rmdir after the kernel has drained it.
      proc?.once?.("exit", () => {
        prepared.cleanup();
      });
      return attached;
    },
  });
}
