import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  prepareRecoveryCgroup,
  openRecoveryCgroup,
} from "../../src/lib/process-execution-broker/process-recovery-cgroup.js";

function kernel() {
  const boot = randomUUID();
  let currentBoot = boot,
    serial = 10,
    populated = false,
    members = "",
    type = 0x63677270n;
  const nodes = new Map([["/delegated", 1]]),
    fds = new Map(),
    writes = [];
  const resolve = (name) =>
    String(name).replace(/^\/proc\/self\/fd\/(\d+)/u, (_, fd) =>
      fds.get(Number(fd)),
    );
  const stat = (name) => {
    const inode = nodes.get(resolve(name));
    if (!inode) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return {
      dev: 2n,
      ino: BigInt(inode),
      isDirectory: () => true,
      isSymbolicLink: () => false,
    };
  };
  const io = {
    constants: { O_RDONLY: 0, O_WRONLY: 1, O_DIRECTORY: 2, O_NOFOLLOW: 4 },
    lstatSync: stat,
    realpathSync: (name) => resolve(name),
    openSync(name) {
      const fd = ++serial;
      fds.set(fd, resolve(name));
      return fd;
    },
    fstatSync: (fd) => stat(fds.get(fd)),
    statfsSync: () => ({ type }),
    closeSync: (fd) => fds.delete(fd),
    mkdirSync(name) {
      const full = resolve(name);
      if (nodes.has(full)) throw new Error("exists");
      nodes.set(full, ++serial);
    },
    rmdirSync(name) {
      if (populated) throw new Error("busy");
      nodes.delete(resolve(name));
    },
    readFileSync(name) {
      if (name.endsWith("boot_id")) return currentBoot;
      if (name.endsWith("cgroup.events"))
        return `populated ${populated ? 1 : 0}\nfrozen 0\n`;
      if (name.endsWith("cgroup.procs")) return members;
      throw new Error("unexpected read");
    },
    writeFileSync(name, value) {
      writes.push([resolve(name), value]);
      if (name.endsWith("cgroup.procs")) {
        members = value;
        populated = true;
      } else if (name.endsWith("cgroup.kill")) {
        populated = false;
        members = "";
      } else throw new Error("unexpected write");
    },
  };
  return {
    runtime: { fs: io, platform: "linux" },
    nodes,
    fds,
    writes,
    reboot() {
      currentBoot = randomUUID();
    },
    nonKernel() {
      type = 0n;
    },
  };
}

describe("restart recovery kernel identity contract (synthetic filesystem)", () => {
  it("binds the blocked supervisor then confirms a kernel-empty kill fence", () => {
    const k = kernel(),
      id = randomUUID();
    const group = prepareRecoveryCgroup(id, "/delegated", k.runtime);
    expect(group.identity.name).toBe(`cc-owner-${id}`);
    group.attachBeforeLaunch({ pid: 123 });
    expect(group.populated()).toBe(true);
    expect(() => group.confirmEmpty()).toThrow(/remains populated/);
    expect(() => group.attachBeforeLaunch({ pid: 456 })).toThrow(
      /already populated/,
    );
    group.kill();
    expect(group.confirmEmpty()).toBe(true);
    group.close({ remove: true });
    expect(k.nodes.size).toBe(1);
    expect(k.fds.size).toBe(0);
    expect(k.writes.map(([name]) => name.split("/").at(-1))).toEqual([
      "cgroup.procs",
      "cgroup.kill",
    ]);
  });
  it.each([
    "reboot",
    "root-replacement",
    "group-replacement",
    "missing",
    "non-kernel",
  ])("refuses %s without issuing a kill", (kind) => {
    const k = kernel(),
      id = randomUUID();
    const group = prepareRecoveryCgroup(id, "/delegated", k.runtime),
      identity = group.identity;
    group.close();
    if (kind === "reboot") k.reboot();
    if (kind === "root-replacement") k.nodes.set("/delegated", 500);
    if (kind === "group-replacement")
      k.nodes.set(`/delegated/${identity.name}`, 500);
    if (kind === "missing") k.nodes.delete(`/delegated/${identity.name}`);
    if (kind === "non-kernel") k.nonKernel();
    expect(() => openRecoveryCgroup(identity, id, k.runtime)).toThrow();
    expect(k.writes).toEqual([]);
    expect(k.fds.size).toBe(0);
  });
  it("refuses post-open object replacement even through a pinned descriptor", () => {
    const k = kernel(),
      id = randomUUID();
    const group = prepareRecoveryCgroup(id, "/delegated", k.runtime);
    k.nodes.set(`/delegated/${group.identity.name}`, 800);
    expect(() => group.kill()).toThrow(/replaced/);
    group.close();
    expect(k.writes).toEqual([]);
  });
  it("requires explicit Linux delegation and never treats an ordinary directory as a group", () => {
    const k = kernel();
    k.nonKernel();
    expect(
      prepareRecoveryCgroup(randomUUID(), undefined, k.runtime),
    ).toBeNull();
    expect(() =>
      prepareRecoveryCgroup(randomUUID(), "/delegated", k.runtime),
    ).toThrow(/filesystem/);
    expect(() =>
      prepareRecoveryCgroup(randomUUID(), "/delegated", {
        ...k.runtime,
        platform: "win32",
      }),
    ).toThrow(/Linux/);
    expect(k.nodes.size).toBe(1);
  });
});
