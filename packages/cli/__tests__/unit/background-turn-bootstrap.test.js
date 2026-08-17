import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_TURN_BOOTSTRAP_ENV,
  BACKGROUND_TURN_BOOTSTRAP_READY,
  BACKGROUND_TURN_BOOTSTRAP_RELEASE,
  containReleasedBackgroundTurnDisconnect,
  createBackgroundTurnBootstrapMessage,
  matchesBackgroundTurnBootstrapMessage,
} from "../../src/lib/background-turn-bootstrap-protocol.js";

const bootstrapUrl = new URL(
  "../../src/workers/background-turn-bootstrap.js",
  import.meta.url,
);

function waitForReady(child, authority) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for turn bootstrap ready")),
      10_000,
    );
    child.on("message", (message) => {
      if (
        matchesBackgroundTurnBootstrapMessage(
          message,
          BACKGROUND_TURN_BOOTSTRAP_READY,
          authority,
        )
      ) {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
}

function waitForCondition(operation, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (operation()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

function posixProcessState(pid) {
  const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
    timeout: 1_000,
  });
  const state = String(result.stdout || "")
    .trim()
    .charAt(0)
    .toUpperCase();
  return state || null;
}

function posixProcessCanExecute(pid) {
  const state = posixProcessState(pid);
  return state !== null && state !== "Z" && state !== "X";
}

describe("background turn pre-main bootstrap", () => {
  const roots = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function launch(options = {}) {
    const root = mkdtempSync(join(tmpdir(), "cc-turn-bootstrap-"));
    roots.push(root);
    const marker = join(root, "agent-main-ran.txt");
    const entry = join(root, "entry.mjs");
    writeFileSync(
      entry,
      options.entrySource ||
        `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.CC_TEST_TURN_MARKER, "ran");\n`,
    );
    const authority = {
      nonce: "test-nonce",
      workerGeneration: "test-generation",
      attempt: 1,
    };
    const child = spawn(
      process.execPath,
      [`--import=${bootstrapUrl.href}`, entry],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          CC_TEST_TURN_MARKER: marker,
          [BACKGROUND_TURN_BOOTSTRAP_ENV.nonce]: authority.nonce,
          [BACKGROUND_TURN_BOOTSTRAP_ENV.workerGeneration]:
            authority.workerGeneration,
          [BACKGROUND_TURN_BOOTSTRAP_ENV.attempt]: String(authority.attempt),
          [BACKGROUND_TURN_BOOTSTRAP_ENV.testTimeoutMs]: "1000",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
        detached: options.detached === true,
      },
    );
    return { authority, child, marker };
  }

  it("contains only a released POSIX disconnect in the current process group", () => {
    const signalProcessGroup = vi.fn();
    let resumeHandler;
    const resumeSignalTarget = {
      once: vi.fn((signal, handler) => {
        resumeHandler = handler;
      }),
      removeListener: vi.fn(),
    };

    expect(
      containReleasedBackgroundTurnDisconnect({
        released: true,
        platform: "linux",
        currentPid: 4321,
        signalProcessGroup,
        resumeSignalTarget,
      }),
    ).toBe(true);
    expect(resumeSignalTarget.once).toHaveBeenCalledWith(
      "SIGCONT",
      expect.any(Function),
    );
    expect(signalProcessGroup).toHaveBeenCalledOnce();
    expect(signalProcessGroup).toHaveBeenCalledWith(-4321, "SIGSTOP");

    resumeHandler();
    expect(signalProcessGroup.mock.calls).toEqual([
      [-4321, "SIGSTOP"],
      [-4321, "SIGKILL"],
    ]);

    signalProcessGroup.mockClear();
    resumeSignalTarget.once.mockClear();
    expect(
      containReleasedBackgroundTurnDisconnect({
        released: false,
        platform: "linux",
        currentPid: 4321,
        signalProcessGroup,
        resumeSignalTarget,
      }),
    ).toBe(false);
    expect(
      containReleasedBackgroundTurnDisconnect({
        released: true,
        platform: "win32",
        currentPid: 4321,
        signalProcessGroup,
        resumeSignalTarget,
      }),
    ).toBe(false);
    expect(signalProcessGroup).not.toHaveBeenCalled();
    expect(resumeSignalTarget.once).not.toHaveBeenCalled();
  });

  it("returns to the historical fail-closed path when containment signalling fails", () => {
    const denied = Object.assign(new Error("signal denied"), { code: "EPERM" });
    const signalProcessGroup = vi.fn(() => {
      throw denied;
    });
    let resumeHandler;
    const resumeSignalTarget = {
      once: vi.fn((signal, handler) => {
        resumeHandler = handler;
      }),
      removeListener: vi.fn(),
    };

    expect(
      containReleasedBackgroundTurnDisconnect({
        released: true,
        platform: "darwin",
        currentPid: 4321,
        signalProcessGroup,
        resumeSignalTarget,
      }),
    ).toBe(false);
    expect(resumeSignalTarget.removeListener).toHaveBeenCalledWith(
      "SIGCONT",
      resumeHandler,
    );
    expect(signalProcessGroup.mock.calls).toEqual([
      [-4321, "SIGSTOP"],
      [-4321, "SIGKILL"],
    ]);
  });

  it("falls back only to SIGKILL on the same group when SIGSTOP fails", () => {
    const denied = Object.assign(new Error("stop denied"), { code: "EPERM" });
    const signalProcessGroup = vi
      .fn()
      .mockImplementationOnce(() => {
        throw denied;
      })
      .mockReturnValueOnce(true);
    let resumeHandler;
    const resumeSignalTarget = {
      once: vi.fn((signal, handler) => {
        resumeHandler = handler;
      }),
      removeListener: vi.fn(),
    };

    expect(
      containReleasedBackgroundTurnDisconnect({
        released: true,
        platform: "linux",
        currentPid: 4321,
        signalProcessGroup,
        resumeSignalTarget,
      }),
    ).toBe(true);
    expect(resumeSignalTarget.removeListener).toHaveBeenCalledWith(
      "SIGCONT",
      resumeHandler,
    );
    expect(signalProcessGroup.mock.calls).toEqual([
      [-4321, "SIGSTOP"],
      [-4321, "SIGKILL"],
    ]);
  });

  it("fails closed if a resumed released group cannot be killed", () => {
    const denied = Object.assign(new Error("kill denied"), { code: "EPERM" });
    const signalProcessGroup = vi.fn((pid, signal) => {
      if (signal === "SIGKILL") throw denied;
    });
    const onResumedKillFailure = vi.fn();
    let resumeHandler;

    expect(
      containReleasedBackgroundTurnDisconnect({
        released: true,
        platform: "linux",
        currentPid: 4321,
        signalProcessGroup,
        resumeSignalTarget: {
          once: (signal, handler) => {
            resumeHandler = handler;
          },
          removeListener: vi.fn(),
        },
        onResumedKillFailure,
      }),
    ).toBe(true);
    expect(signalProcessGroup).toHaveBeenCalledWith(-4321, "SIGSTOP");

    resumeHandler();
    expect(signalProcessGroup.mock.calls).toEqual([
      [-4321, "SIGSTOP"],
      [-4321, "SIGKILL"],
    ]);
    expect(onResumedKillFailure).toHaveBeenCalledOnce();
  });

  it("does not execute Agent main before a matching durable release", async () => {
    const { authority, child, marker } = launch();
    const ready = await waitForReady(child, authority);
    expect(ready.pid).toBe(child.pid);
    expect(existsSync(marker)).toBe(false);

    const exitPromise = once(child, "exit");
    child.send(
      createBackgroundTurnBootstrapMessage(
        BACKGROUND_TURN_BOOTSTRAP_RELEASE,
        ready,
      ),
    );
    const [code, signal] = await exitPromise;
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(readFileSync(marker, "utf8")).toBe("ran");
  });

  it("exits without Agent work when the worker dies before pid commit", async () => {
    const { authority, child, marker } = launch();
    await waitForReady(child, authority);
    expect(existsSync(marker)).toBe(false);

    const exitPromise = once(child, "exit");
    child.disconnect();
    const [code] = await exitPromise;
    expect(code).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "freezes a released detached Agent group until an external SIGKILL retires it",
    async () => {
      const entrySource = [
        'import { spawn } from "node:child_process";',
        'import { writeFileSync } from "node:fs";',
        'const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
        "descendant.unref();",
        "writeFileSync(process.env.CC_TEST_TURN_MARKER, JSON.stringify({ pid: process.pid, descendantPid: descendant.pid }));",
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n");
      const { authority, child, marker } = launch({
        detached: true,
        entrySource,
      });
      let descendantPid = null;
      let groupRetired = false;
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      const exitPromise = once(child, "exit");
      try {
        const ready = await waitForReady(child, authority);
        child.send(
          createBackgroundTurnBootstrapMessage(
            BACKGROUND_TURN_BOOTSTRAP_RELEASE,
            ready,
          ),
        );
        await waitForCondition(() => existsSync(marker), "Agent main marker");
        const evidence = JSON.parse(readFileSync(marker, "utf8"));
        descendantPid = Number(evidence.descendantPid);
        expect(evidence.pid).toBe(child.pid);
        expect(Number.isSafeInteger(descendantPid)).toBe(true);

        child.disconnect();
        await waitForCondition(
          () =>
            posixProcessState(child.pid) === "T" &&
            posixProcessState(descendantPid) === "T",
          "released Agent process-group freeze",
        );
        await waitForCondition(
          () =>
            stderr.includes(
              "[background-turn-bootstrap] worker IPC disconnected before turn completion\n",
            ),
          "disconnect diagnostic",
        );

        process.kill(-child.pid, "SIGKILL");
        const [, signal] = await exitPromise;
        expect(signal).toBe("SIGKILL");
        await waitForCondition(
          () => !posixProcessCanExecute(descendantPid),
          "descendant retirement",
        );
        groupRetired = true;
      } finally {
        const childUnsettled =
          child.exitCode === null && child.signalCode === null;
        const descendantStillExecutable =
          Number.isSafeInteger(descendantPid) &&
          posixProcessCanExecute(descendantPid);
        if (!groupRetired && (childUnsettled || descendantStillExecutable)) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            // The detached group already retired.
          }
        }
        if (childUnsettled) {
          await Promise.race([
            exitPromise,
            new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000)),
          ]);
        }
      }
    },
  );
});
