import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dockerEgressSeccompProfile,
  startDockerEgressSession,
} from "../../src/lib/sandbox-docker-egress.js";

const IMAGE = `node@sha256:${"1".repeat(64)}`;
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function fixture({
  failAttach = false,
  remote = false,
  exitCode = 0,
  privateParent = true,
  attachedRunning = false,
  beforeCommand,
  onCreate,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-egress-unit-"));
  roots.push(root);
  const records = new Map();
  const calls = [];
  let next = 1;
  const docker = async (input) => {
    const args = input[0] === "--host" ? input.slice(2) : input;
    calls.push(args);
    await beforeCommand?.(args, records);
    if (args[0] === "context")
      return remote ? "tcp://remote:2375" : "unix:///var/run/docker.sock";
    if (args[0] === "info") return JSON.stringify({ OSType: "linux" });
    if (args[0] === "create") {
      const id = String(next++).padStart(64, "0");
      const name = args[args.indexOf("--name") + 1];
      const token = args[args.indexOf("--label") + 1].split("=")[1];
      records.set(id, {
        Id: id,
        Name: name,
        Config: { Labels: { "chainless.egress.owner": token } },
        State: { Running: true, ExitCode: 0 },
        HostConfig: {
          NetworkMode: args[args.indexOf("--network") + 1],
          ReadonlyRootfs: args.includes("--read-only"),
          CapDrop: [args[args.indexOf("--cap-drop") + 1]],
          SecurityOpt: args.flatMap((value, index) =>
            value === "--security-opt" ? [args[index + 1]] : [],
          ),
        },
      });
      await onCreate?.(records.get(id), records);
      return id;
    }
    if (args[0] === "inspect") {
      const record = [...records.values()].find(
        (r) => r.Id === args[1] || r.Name === args[1],
      );
      if (!record) throw new Error("No such container");
      return JSON.stringify([record]);
    }
    if (args[0] === "rm") {
      records.delete(args[2]);
      return "";
    }
    if (args[0] === "start" && args.includes("--attach")) {
      if (failAttach) throw new Error("attach timed out");
      records.get(args[2]).State.Running = attachedRunning;
      if (exitCode) {
        const target = records.get(args[2]);
        target.State.Running = false;
        target.State.ExitCode = exitCode;
        throw Object.assign(new Error("shell exited"), {
          code: exitCode,
          stdout: "partial output",
          stderr: "command error",
        });
      }
      return "probe-output";
    }
    return "";
  };
  return {
    root,
    records,
    calls,
    start: () =>
      startDockerEgressSession(
        {
          brokerSocketPath: "/private/proxy.sock",
          workspaceRoot: root,
          relayImage: IMAGE,
          tempRoot: root,
        },
        {
          platform: "linux",
          uid: 1000,
          arch: "x64",
          docker,
          pause: async () => {},
          fs: {
            ...fs,
            realpathSync: (p) => p,
            statSync: (p) => ({
              uid: 1000,
              mode: privateParent ? 0o700 : 0o755,
              isDirectory: () => p === root || p === "/private",
              isSocket: () => p === "/private/proxy.sock",
            }),
          },
        },
      ),
  };
}

describe("Docker egress lifecycle (Docker transport simulated)", () => {
  it("does not report a still-running container as a completed command", async () => {
    const f = fixture({ attachedRunning: true });
    const session = await f.start();
    await expect(session.run("sleep 60")).rejects.toThrow("terminal state");
    expect(f.records.size).toBe(0);
  });

  it("retries failed cleanup, retaining recovery evidence until all containers are removed", async () => {
    let failRemoval = true;
    const f = fixture({
      beforeCommand(args) {
        if (args[0] === "rm" && failRemoval) {
          failRemoval = false;
          throw new Error("daemon temporarily unavailable");
        }
      },
    });
    const session = await f.start();
    const error = await session.run("true").catch((failure) => failure);
    expect(error.code).toBe("ERR_DOCKER_EGRESS_CLEANUP_INCOMPLETE");
    expect(error.errors).toHaveLength(1);
    expect(f.records.size).toBe(1);
    expect(fs.existsSync(error.cleanupStatePath)).toBe(true);
    await session.close();
    expect(f.records.size).toBe(0);
    expect(fs.existsSync(path.dirname(error.cleanupStatePath))).toBe(false);
  });

  it("preserves the execution error when cleanup also fails", async () => {
    let failRemoval = true;
    const f = fixture({
      failAttach: true,
      beforeCommand(args) {
        if (args[0] === "rm" && failRemoval)
          throw new Error("daemon temporarily unavailable");
      },
    });
    const session = await f.start();
    const error = await session.run("sleep 60").catch((failure) => failure);
    expect(error.message).toBe("attach timed out");
    expect(error.cleanupError.code).toBe(
      "ERR_DOCKER_EGRESS_CLEANUP_INCOMPLETE",
    );
    expect(error.cleanupError.errors).toHaveLength(2);
    failRemoval = false;
    await session.close();
    expect(f.records.size).toBe(0);
  });

  it("reconciles a daemon creation that appears after the CLI timed out", async () => {
    let late;
    let inspections = 0;
    const f = fixture({
      onCreate(record, records) {
        if (!record.Name.startsWith("cc-target-")) return;
        late = record;
        records.delete(record.Id);
        throw new Error("create timed out");
      },
      beforeCommand(args, records) {
        if (
          late &&
          args[0] === "inspect" &&
          args[1] === late.Name &&
          ++inspections === 2
        )
          records.set(late.Id, late);
      },
    });
    const session = await f.start();
    const error = await session.run("true").catch((failure) => failure);
    expect(error.message).toBe("create timed out");
    expect(error.cleanupError).toBeUndefined();
    expect(inspections).toBe(2);
    expect(f.records.size).toBe(0);
  });

  it("records unresolved creation instead of declaring an absent container cleaned", async () => {
    let late;
    const f = fixture({
      onCreate(record, records) {
        if (!record.Name.startsWith("cc-target-")) return;
        late = record;
        records.delete(record.Id);
        throw new Error("create timed out");
      },
    });
    const session = await f.start();
    const error = await session.run("true").catch((failure) => failure);
    expect(error.cleanupError.errors[0].code).toBe(
      "ERR_DOCKER_EGRESS_CREATE_UNRESOLVED",
    );
    expect(
      f.calls.filter((args) => args[0] === "inspect" && args[1] === late.Name),
    ).toHaveLength(3);
    const state = JSON.parse(
      fs.readFileSync(error.cleanupError.cleanupStatePath, "utf8"),
    );
    expect(state.uncertainCreations).toEqual([late.Name]);
    expect(state.cleanupRequired).toBe(true);
    f.records.set(late.Id, late);
    await session.close();
    expect(f.records.size).toBe(0);
    expect(fs.existsSync(error.cleanupError.cleanupStatePath)).toBe(false);
  });

  it("waits for an admitted create before closing and never starts its target", async () => {
    let releaseCreate;
    let admitted;
    const createStarted = new Promise((resolve) => {
      admitted = resolve;
    });
    const createReleased = new Promise((resolve) => {
      releaseCreate = resolve;
    });
    const f = fixture({
      async onCreate(record) {
        if (!record.Name.startsWith("cc-target-")) return;
        admitted();
        await createReleased;
      },
    });
    const session = await f.start();
    const running = session.run("true").catch((error) => error);
    await createStarted;
    const closing = session.close();
    releaseCreate();
    await closing;
    expect((await running).message).toContain("closed during launch");
    expect(f.records.size).toBe(0);
    expect(f.calls.some((args) => args.includes("--attach"))).toBe(false);
  });

  it("rejects revoked authority after target creation and before target start", async () => {
    const f = fixture();
    const session = await f.start();
    const beforeStart = vi.fn(async () => {
      throw new Error("authority revoked");
    });
    await expect(
      session.run("network command", { beforeStart }),
    ).rejects.toThrow("authority revoked");
    expect(beforeStart).toHaveBeenCalledOnce();
    expect(f.calls.filter((args) => args[0] === "create")).toHaveLength(2);
    expect(f.calls.some((args) => args.includes("--attach"))).toBe(false);
    expect(f.records.size).toBe(0);
  });

  it("refuses a target whose Docker isolation options differ from the requested boundary", async () => {
    const f = fixture({
      onCreate(record) {
        if (record.Name.startsWith("cc-target-")) {
          record.HostConfig.NetworkMode = "bridge";
        }
      },
    });
    const session = await f.start();
    await expect(session.run("network command")).rejects.toThrow(
      "isolation options",
    );
    expect(f.calls.some((args) => args.includes("--attach"))).toBe(false);
    expect(f.records.size).toBe(0);
  });

  it("preserves an ordinary failing command's exit code and output", async () => {
    const f = fixture({ exitCode: 7 });
    const session = await f.start();
    await expect(session.run("exit 7")).resolves.toEqual({
      stdout: "partial output",
      stderr: "command error",
      exitCode: 7,
    });
    expect(f.records.size).toBe(0);
  });

  it("refuses an exposed broker socket directory before starting containers", async () => {
    const f = fixture({ privateParent: false });
    await expect(f.start()).rejects.toThrow("private owned parent");
    expect(f.calls.some((c) => c[0] === "create")).toBe(false);
  });
  it("keeps broker mounts out of target and cleans both containers after a completed command", async () => {
    const f = fixture();
    const session = await f.start();
    const result = await session.run("printf probe-output");
    expect(result).toEqual({ stdout: "probe-output", stderr: "", exitCode: 0 });
    const creates = f.calls.filter((c) => c[0] === "create");
    expect(creates).toHaveLength(2);
    expect(creates[0]).toContain("none");
    expect(creates[1]).toContain(`container:${session.relayId}`);
    expect(creates[1].join(" ")).not.toContain("/private/proxy.sock");
    expect(creates[1]).toContain("no-new-privileges");
    expect(f.records.size).toBe(0);
    await expect(session.run("true")).rejects.toThrow("closed");
  });

  it("removes a possibly running target and its relay after the Docker attach deadline", async () => {
    const f = fixture({ failAttach: true });
    const session = await f.start();
    await expect(session.run("sleep 60", { timeoutMs: 1 })).rejects.toThrow(
      "attach timed out",
    );
    expect(f.records.size).toBe(0);
    expect(f.calls.filter((c) => c[0] === "rm")).toHaveLength(2);
  });

  it("joins concurrent close requests and rejects remote daemons before creating anything", async () => {
    const f = fixture();
    const session = await f.start();
    const first = session.close();
    expect(session.close()).toBe(first);
    await first;
    expect(f.records.size).toBe(0);
    const remote = fixture({ remote: true });
    await expect(remote.start()).rejects.toThrow("local Unix");
    expect(remote.calls.some((c) => c[0] === "create")).toBe(false);
  });

  it("does not provide a blanket allow fallback or alternate ABI in its seccomp policy", () => {
    const policy = dockerEgressSeccompProfile("x64");
    expect(policy.defaultAction).toBe("SCMP_ACT_ERRNO");
    expect(policy.architectures).toEqual(["SCMP_ARCH_X86_64"]);
    const unconditional = policy.syscalls
      .filter((rule) => rule.action === "SCMP_ACT_ALLOW" && !rule.args)
      .flatMap((rule) => rule.names);
    for (const syscall of [
      "socket",
      "socketpair",
      "recvmsg",
      "setns",
      "unshare",
      "mount",
      "ptrace",
      "pidfd_getfd",
      "io_uring_setup",
    ])
      expect(unconditional).not.toContain(syscall);
    expect(() => dockerEgressSeccompProfile("ia32")).toThrow("architecture");
  });
});
