import { describe, expect, it } from "vitest";
import {
  buildLinuxBwrapDescriptorScrubbedLaunch,
  LINUX_BWRAP_DESCRIPTOR_SCRUBBER_ARGV0,
  LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PASSES,
  LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT,
  LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT_SHA256,
  linuxBwrapDescriptorScrubberPolicyBinding,
  parseLinuxBwrapDescriptorScrubbedLaunch,
} from "../../src/lib/process-execution-broker/linux-bwrap-descriptor-launch.js";

describe("Linux bubblewrap inherited-descriptor scrubber", () => {
  const options = (stdio, env = null) => ({
    shell: false,
    stdio,
    env: env || { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  });

  it("appends pinned Bash after the preserved range and unwraps exact argv", () => {
    const stdio = ["ignore", "pipe", "pipe", 30, 31, 32, 33, 34, 35, 36, 37];
    const launch = buildLinuxBwrapDescriptorScrubbedLaunch({
      scrubberChildFd: 10,
      preservedMaxFd: 9,
      activeStdioThrough: 2,
      nodeIpcChildFd: null,
      executableChildFd: 3,
      executableArgs: ["--help", "untrusted argument stays argv"],
    });

    expect(launch.command).toBe("/proc/self/fd/10");
    expect(launch.args.slice(0, 5)).toEqual([
      "--noprofile",
      "--norc",
      "-c",
      LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT,
      LINUX_BWRAP_DESCRIPTOR_SCRUBBER_ARGV0,
    ]);
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        options(stdio),
      ),
    ).toEqual({
      scrubberChildFd: 10,
      preservedMaxFd: 9,
      activeStdioThrough: 2,
      nodeIpcChildFd: null,
      executableChildFd: 3,
      executableArgs: ["--help", "untrusted argument stays argv"],
      launchArgs: launch.args,
      options: {
        shell: false,
        stdio,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
        },
      },
      stdio,
      callerEnvironment: {
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
      shell: false,
      serialization: undefined,
    });
    expect(LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT_SHA256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PASSES).toBe(3);
    expect(LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT).toContain(
      "exec {chainless_fd}>&-",
    );
    expect(LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT).toContain(
      "shopt -s execfail",
    );
    expect(LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT).toContain(
      "chainless_sweep_seen_executable=0",
    );
    expect(LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT).toContain(
      "chainless_sweep_seen_executable != 1",
    );
    expect(LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT).not.toContain("eval");
  });

  it.each([
    ["legacy direct bwrap", "/proc/self/fd/3", ["--help"]],
    [
      "mutated fixed script",
      "/proc/self/fd/10",
      [
        "--noprofile",
        "--norc",
        "-c",
        `${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT}\n:`,
        LINUX_BWRAP_DESCRIPTOR_SCRUBBER_ARGV0,
        "9",
        "3",
        "--help",
      ],
    ],
    [
      "noncanonical executable fd",
      "/proc/self/fd/10",
      [
        "--noprofile",
        "--norc",
        "-c",
        LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT,
        LINUX_BWRAP_DESCRIPTOR_SCRUBBER_ARGV0,
        "9",
        "03",
        "--help",
      ],
    ],
  ])("rejects %s grammar", (_label, command, args) => {
    const stdio = ["ignore", "pipe", "pipe", 30, 31, 32, 33, 34, 35, 36, 37];
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(command, args, options(stdio)),
    ).toBeNull();
  });

  it("rejects a missing or non-numeric appended Bash descriptor", () => {
    const launch = buildLinuxBwrapDescriptorScrubbedLaunch({
      scrubberChildFd: 5,
      preservedMaxFd: 4,
      executableChildFd: 3,
      executableArgs: ["--help"],
    });
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        options(["ignore", "pipe", "pipe", 30, 31]),
      ),
    ).toBeNull();
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        options(["ignore", "pipe", "pipe", 30, 31, "ignore"]),
      ),
    ).toBeNull();
  });

  it("rejects sparse preserved slots and duplicate helper parent fds", () => {
    const launch = buildLinuxBwrapDescriptorScrubbedLaunch({
      scrubberChildFd: 6,
      preservedMaxFd: 5,
      executableChildFd: 3,
      executableArgs: ["--help"],
    });
    const sparse = ["ignore", "pipe", "pipe", 30, 31, 32, 33];
    delete sparse[4];
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        options(sparse),
      ),
    ).toBeNull();
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        options(["ignore", "pipe", "pipe", 30, 31, 32, 30]),
      ),
    ).toBeNull();
  });

  it("accepts only actually-overwriting active pipe/ipc slots", () => {
    const launch = buildLinuxBwrapDescriptorScrubbedLaunch({
      scrubberChildFd: 7,
      preservedMaxFd: 6,
      executableChildFd: 5,
      executableArgs: ["--help"],
    });
    const stdio = ["ignore", "pipe", "pipe", "pipe", "ipc", 31, 32, 33];
    const parsed = parseLinuxBwrapDescriptorScrubbedLaunch(
      launch.command,
      launch.args,
      options(stdio),
      { activeStdioThrough: 4 },
    );
    expect(parsed?.nodeIpcChildFd).toBe(4);
    expect(parsed?.activeStdioThrough).toBe(4);
    const unsafe = [...stdio];
    unsafe[4] = "ignore";
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        options(unsafe),
        { activeStdioThrough: 4 },
      ),
    ).toBeNull();
    unsafe[4] = 44;
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        options(unsafe),
        { activeStdioThrough: 4 },
      ),
    ).toBeNull();
  });

  it.each([
    ["extra BASH_ENV", { BASH_ENV: "/tmp/evil" }],
    ["extra LD_PRELOAD", { LD_PRELOAD: "/tmp/evil.so" }],
    ["extra SHELLOPTS", { SHELLOPTS: "xtrace" }],
  ])("rejects %s", (_label, extra) => {
    const launch = buildLinuxBwrapDescriptorScrubbedLaunch({
      scrubberChildFd: 5,
      preservedMaxFd: 4,
      executableChildFd: 3,
      executableArgs: ["--help"],
    });
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        options(["ignore", "pipe", "pipe", 30, 31, 32], {
          PATH: "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
          ...extra,
        }),
      ),
    ).toBeNull();
  });

  it("rejects polluted option or environment prototypes", () => {
    const launch = buildLinuxBwrapDescriptorScrubbedLaunch({
      scrubberChildFd: 5,
      preservedMaxFd: 4,
      executableChildFd: 3,
      executableArgs: ["--help"],
    });
    const pollutedEnvironment = Object.create({ BASH_ENV: "/tmp/evil" });
    Object.assign(pollutedEnvironment, {
      PATH: "/usr/bin:/bin",
      LANG: "C",
      LC_ALL: "C",
    });
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        options(["ignore", "pipe", "pipe", 30, 31, 32], pollutedEnvironment),
      ),
    ).toBeNull();

    const pollutedOptions = Object.create({ env: { BASH_ENV: "/tmp/evil" } });
    pollutedOptions.stdio = ["ignore", "pipe", "pipe", 30, 31, 32];
    pollutedOptions.env = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        pollutedOptions,
      ),
    ).toBeNull();
  });

  it("rejects accessor-backed options, environment, stdio, or argv", () => {
    const launch = buildLinuxBwrapDescriptorScrubbedLaunch({
      scrubberChildFd: 5,
      preservedMaxFd: 4,
      executableChildFd: 3,
      executableArgs: ["--help"],
    });
    const stdio = ["ignore", "pipe", "pipe", 30, 31, 32];

    const accessorEnvironment = { LANG: "C", LC_ALL: "C" };
    Object.defineProperty(accessorEnvironment, "PATH", {
      enumerable: true,
      get: () => "/usr/bin:/bin",
    });
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        options(stdio, accessorEnvironment),
      ),
    ).toBeNull();

    const accessorStdio = [...stdio];
    Object.defineProperty(accessorStdio, 3, { get: () => 30 });
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        options(accessorStdio),
      ),
    ).toBeNull();

    const accessorArgs = [...launch.args];
    Object.defineProperty(accessorArgs, accessorArgs.length - 1, {
      get: () => "--help",
    });
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        accessorArgs,
        options(stdio),
      ),
    ).toBeNull();

    const accessorOptions = options(stdio);
    Object.defineProperty(accessorOptions, "shell", { get: () => false });
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        launch.command,
        launch.args,
        accessorOptions,
      ),
    ).toBeNull();
  });

  it("rejects sparse/accessor executable argv at construction", () => {
    const sparse = ["--help"];
    sparse.length = 2;
    expect(() =>
      buildLinuxBwrapDescriptorScrubbedLaunch({
        scrubberChildFd: 5,
        preservedMaxFd: 4,
        executableChildFd: 3,
        executableArgs: sparse,
      }),
    ).toThrow("linux_bwrap_descriptor_scrubber_layout_invalid");

    const accessor = ["--help"];
    Object.defineProperty(accessor, 0, { get: () => "--help" });
    expect(() =>
      buildLinuxBwrapDescriptorScrubbedLaunch({
        scrubberChildFd: 5,
        preservedMaxFd: 4,
        executableChildFd: 3,
        executableArgs: accessor,
      }),
    ).toThrow("linux_bwrap_descriptor_scrubber_layout_invalid");
  });

  it("requires shell false and no serialization override", () => {
    const launch = buildLinuxBwrapDescriptorScrubbedLaunch({
      scrubberChildFd: 5,
      preservedMaxFd: 4,
      executableChildFd: 3,
      executableArgs: ["--help"],
    });
    const stdio = ["ignore", "pipe", "pipe", 30, 31, 32];
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(launch.command, launch.args, {
        ...options(stdio),
        shell: true,
      }),
    ).toBeNull();
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(launch.command, launch.args, {
        ...options(stdio),
        serialization: "advanced",
      }),
    ).toBeNull();
  });

  it("deep-snapshots and freezes the typed executable identity", () => {
    const identity = {
      path: "/usr/bin/bash",
      fileId: { dev: "8", ino: "42" },
      sha256: "a".repeat(64),
      bytes: 1024,
      mtimeMs: 123,
      mode: 0o100755,
      uid: 0,
      gid: 0,
    };
    const binding = linuxBwrapDescriptorScrubberPolicyBinding(identity, {
      scrubberChildFd: 5,
      preservedMaxFd: 4,
      activeStdioThrough: 2,
      nodeIpcChildFd: null,
      executableChildFd: 3,
    });
    identity.sha256 = "b".repeat(64);
    identity.fileId.ino = "99";
    expect(binding.executableIdentity).toMatchObject({
      sha256: "a".repeat(64),
      fileId: { dev: "8", ino: "42" },
    });
    expect(Object.isFrozen(binding.executableIdentity)).toBe(true);
    expect(Object.isFrozen(binding.executableIdentity.fileId)).toBe(true);
  });
});
