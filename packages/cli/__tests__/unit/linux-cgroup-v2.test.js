import { describe, expect, it } from "vitest";
import {
  applyLinuxCgroupV2ToPlan,
  normalizeLinuxCgroupPolicy,
  prepareLinuxCgroupV2,
} from "../../src/lib/process-execution-broker/linux-cgroup-v2.js";
import {
  applySandbox,
  postSpawnSandbox,
  SANDBOX_BOUNDARIES,
} from "../../src/lib/process-execution-broker/platform-sandbox.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

function missing(pathname) {
  const error = new Error(`missing ${pathname}`);
  error.code = "ENOENT";
  return error;
}

function createDelegatedCgroupFs({
  controllers = "memory cpu pids",
  delegated = controllers,
} = {}) {
  const root = "/delegated/chainlesschain";
  const files = new Map([
    [`${root}/cgroup.controllers`, controllers],
    [`${root}/cgroup.subtree_control`, delegated],
  ]);
  const directories = new Set([root]);
  const writes = [];
  return {
    root,
    writes,
    directories,
    fs: {
      existsSync(pathname) {
        return (
          pathname === "/usr/bin/prlimit" ||
          files.has(pathname) ||
          directories.has(pathname)
        );
      },
      readFileSync(pathname) {
        if (!files.has(pathname)) throw missing(pathname);
        return files.get(pathname);
      },
      mkdirSync(pathname) {
        if (directories.has(pathname)) {
          const error = new Error("already exists");
          error.code = "EEXIST";
          throw error;
        }
        directories.add(pathname);
      },
      writeFileSync(pathname, content) {
        const parent = pathname.slice(0, pathname.lastIndexOf("/"));
        if (!directories.has(parent)) throw missing(parent);
        const value = String(content);
        files.set(pathname, value);
        writes.push({ pathname, value });
      },
      rmdirSync(pathname) {
        if (!directories.delete(pathname)) throw missing(pathname);
        for (const key of [...files.keys()]) {
          if (key.startsWith(`${pathname}/`)) files.delete(key);
        }
      },
    },
  };
}

function policy(root, overrides = {}) {
  return {
    mode: "required",
    root,
    memoryMaxBytes: 128 * 1024 * 1024,
    ...overrides,
  };
}

describe("Linux cgroup v2 tool resource control", () => {
  it("requires an explicit delegated root and a per-tool memory maximum", () => {
    expect(() => normalizeLinuxCgroupPolicy({})).toThrow(/memoryMaxBytes/);
    expect(() =>
      normalizeLinuxCgroupPolicy({
        root: "/delegated/../escape",
        memoryMaxBytes: 1,
      }),
    ).toThrow(/root/);
    expect(
      normalizeLinuxCgroupPolicy(
        policy("/delegated/chainlesschain", { mode: "optional" }),
      ),
    ).toMatchObject({
      mode: "optional",
      memoryMaxBytes: 128 * 1024 * 1024,
    });
  });

  it("writes memory and optional controllers before synchronously attaching one tool PID", () => {
    const harness = createDelegatedCgroupFs();
    const prepared = prepareLinuxCgroupV2(
      policy(harness.root, {
        memoryHighBytes: 96 * 1024 * 1024,
        pidsMax: 32,
        cpuQuotaMicros: 50_000,
        cpuPeriodMicros: 100_000,
      }),
      { platform: "linux", fs: harness.fs },
    );

    expect(prepared.ok).toBe(true);
    expect(harness.writes.map((entry) => entry.pathname)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/memory\.max$/),
        expect.stringMatching(/\/memory\.high$/),
        expect.stringMatching(/\/pids\.max$/),
        expect.stringMatching(/\/cpu\.max$/),
      ]),
    );
    expect(prepared.attach({ pid: 4312 })).toBe(true);
    expect(harness.writes.at(-1)).toMatchObject({
      pathname: expect.stringMatching(/\/cgroup\.procs$/),
      value: "4312\n",
    });
    expect(prepared.status()).toMatchObject({
      state: "enforced",
      attached: true,
    });
    expect(prepared.cleanup()).toBe(true);
  });

  it("reports unavailable rather than claiming enforcement without delegated memory", () => {
    const harness = createDelegatedCgroupFs({ delegated: "cpu pids" });
    const prepared = prepareLinuxCgroupV2(policy(harness.root), {
      platform: "linux",
      fs: harness.fs,
    });
    expect(prepared).toEqual({
      ok: false,
      reason: "linux_cgroup_controller_not_delegated",
    });

    const plan = applyLinuxCgroupV2ToPlan(
      {
        contractVersion: 1,
        applied: true,
        platform: "linux",
        profile: "default",
        command: "tool",
        args: [],
        options: {},
        enforcement: "linux-prlimit",
        backend: "linux-prlimit",
        guarantees: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
        reason: null,
        postSpawn: { required: false, mode: "none" },
      },
      policy(harness.root),
      { platform: "linux", fs: harness.fs },
    );
    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-cgroup-v2",
      reason: "linux_cgroup_controller_not_delegated",
      resourceControl: { state: "unavailable" },
    });
  });

  it("keeps optional sync launches on prlimit and rejects required sync cgroups", () => {
    const harness = createDelegatedCgroupFs();
    const basePlan = {
      contractVersion: 1,
      applied: true,
      platform: "linux",
      profile: "default",
      command: "tool",
      args: [],
      options: {},
      enforcement: "linux-prlimit",
      backend: "linux-prlimit",
      guarantees: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
      reason: null,
      postSpawn: { required: false, mode: "none" },
    };
    const optional = applyLinuxCgroupV2ToPlan(
      basePlan,
      policy(harness.root, { mode: "optional" }),
      { platform: "linux", fs: harness.fs, sync: true },
    );
    expect(optional).toMatchObject({
      applied: true,
      postSpawn: { required: false, mode: "none" },
      resourceControl: {
        state: "unavailable",
        reason: "linux_cgroup_post_spawn_unavailable_for_sync",
      },
    });

    const required = applyLinuxCgroupV2ToPlan(basePlan, policy(harness.root), {
      platform: "linux",
      fs: harness.fs,
      sync: true,
    });
    expect(required).toMatchObject({
      applied: false,
      reason: "linux_cgroup_post_spawn_unavailable_for_sync",
    });
  });

  it("turns required cgroup policy into a broker resource boundary", () => {
    const normalized = executionBroker._normalizeSandboxPolicy({
      sandboxPolicy: {
        linuxCgroup: policy("/delegated/chainlesschain"),
      },
    });
    expect(normalized.linuxCgroup).toMatchObject({ mode: "required" });
    expect(normalized.requiredBoundaries).toContain(
      SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
    );
  });

  it("decorates the broker Linux plan with synchronous cgroup association", () => {
    const harness = createDelegatedCgroupFs();
    const plan = applySandbox(
      "tool",
      ["--run"],
      {},
      {
        profile: "default",
        linuxCgroup: policy(harness.root),
      },
      {
        platform: "linux",
        fs: harness.fs,
        tmpdir: () => "/tmp",
        homedir: () => "/home/tester",
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      backend: "linux-prlimit",
      postSpawn: { required: true, mode: "sync" },
      resourceControl: {
        kind: "linux-cgroup-v2-tool-memory-v1",
        state: "prepared",
      },
    });
    expect(plan.guarantees).toContain(SANDBOX_BOUNDARIES.RESOURCE_LIMITS);
    expect(postSpawnSandbox({ pid: 991 }, plan, { platform: "linux" })).toBe(
      true,
    );
    expect(harness.writes.at(-1)).toMatchObject({
      pathname: expect.stringMatching(/\/cgroup\.procs$/),
      value: "991\n",
    });
    plan.cleanup();
  });
});
