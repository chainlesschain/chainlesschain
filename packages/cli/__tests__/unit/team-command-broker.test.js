import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _deps,
  makeShellRunTask,
  spawnAgent,
} from "../../src/commands/team.js";

const ORIGINAL_SPAWN = _deps.spawn;

function createChild({ stdin = false } = {}) {
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  if (stdin) child.stdin = new PassThrough();
  return child;
}

afterEach(() => {
  _deps.spawn = ORIGINAL_SPAWN;
});

describe("team command process Broker", () => {
  it("runs explicit --exec tasks through the shell Broker scope", async () => {
    const child = createChild();
    _deps.spawn = vi.fn(() => child);
    const runTask = makeShellRunTask(console);

    const completed = runTask({
      task: { key: "build", metadata: { command: "npm run build" } },
    });
    child.emit("close", 0);

    await expect(completed).resolves.toEqual({ code: 0 });
    expect(_deps.spawn).toHaveBeenCalledWith(
      "npm run build",
      [],
      expect.objectContaining({
        cwd: process.cwd(),
        shell: true,
        origin: "team:shell",
        policy: "allow",
        scope: "team",
      }),
    );
  });

  it("reports shell stderr when a task exits non-zero", async () => {
    const child = createChild();
    _deps.spawn = vi.fn(() => child);
    const completed = makeShellRunTask(console)({
      task: { key: "test", metadata: { command: "npm test" } },
    });

    child.stderr.write("tests failed");
    child.emit("close", 2);

    await expect(completed).rejects.toThrow("tests failed");
  });

  it("runs teammate agents through Broker with the prompt only on stdin", async () => {
    const child = createChild({ stdin: true });
    let stdin = "";
    child.stdin.setEncoding("utf8");
    child.stdin.on("data", (chunk) => (stdin += chunk));
    _deps.spawn = vi.fn(() => child);

    const completed = spawnAgent("private teammate prompt", "/repo", {
      permissionMode: "plan",
      model: "test-model",
    });
    child.emit("close", 0);

    await expect(completed).resolves.toEqual({ code: 0 });
    expect(stdin).toBe("private teammate prompt");
    const [file, args, options] = _deps.spawn.mock.calls[0];
    expect(file).toBe(process.execPath);
    expect(args).toEqual(
      expect.arrayContaining([
        "agent",
        "--permission-mode",
        "plan",
        "--output-format",
        "text",
        "--model",
        "test-model",
      ]),
    );
    expect(args).not.toContain("private teammate prompt");
    expect(args).not.toContain("-p");
    expect(options).toEqual(
      expect.objectContaining({
        cwd: "/repo",
        windowsHide: true,
        origin: "team:agent",
        policy: "allow",
        scope: "team",
        shell: false,
      }),
    );
    expect(options.env.CLAUDECODE).toBe("1");
  });
});
