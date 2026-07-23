import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _deps,
  defaultFetchEvents,
  defaultRunAgent,
} from "../../src/commands/routine.js";

const ORIGINAL_SPAWN = _deps.spawn;
const ORIGINAL_EXEC_FILE = _deps.execFile;

function createChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  return child;
}

afterEach(() => {
  _deps.spawn = ORIGINAL_SPAWN;
  _deps.execFile = ORIGINAL_EXEC_FILE;
});

describe("routine command process Broker", () => {
  it("runs the agent through Broker and sends the prompt only over stdin", async () => {
    const child = createChild();
    let stdin = "";
    child.stdin.setEncoding("utf8");
    child.stdin.on("data", (chunk) => (stdin += chunk));
    _deps.spawn = vi.fn(() => child);

    const completed = defaultRunAgent({ prompt: "private routine prompt" });
    child.stdout.write(
      `${JSON.stringify({ result: "done", usage: { input_tokens: 2 }, total_cost_usd: 0.01 })}\n`,
    );
    child.emit("close", 0);

    await expect(completed).resolves.toEqual({
      exitCode: 0,
      output: "done",
      usage: { input_tokens: 2 },
      costUsd: 0.01,
    });
    expect(stdin).toBe("private routine prompt");
    expect(_deps.spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["agent", "--output-format", "json"]),
      expect.objectContaining({
        origin: "routine:agent",
        policy: "allow",
        scope: "routine",
        shell: false,
      }),
    );
    const [, args] = _deps.spawn.mock.calls[0];
    expect(args).not.toContain("private routine prompt");
    expect(args).not.toContain("-p");
  });

  it("fetches GitHub events through Broker with an argv-safe repo", async () => {
    _deps.execFile = vi.fn((file, args, options, callback) => {
      callback(
        null,
        JSON.stringify([
          { id: "evt-1", type: "PushEvent", actor: { login: "ignored" } },
        ]),
        "",
      );
      return {};
    });

    await expect(defaultFetchEvents("acme/widgets")).resolves.toEqual([
      { id: "evt-1", type: "PushEvent" },
    ]);
    expect(_deps.execFile).toHaveBeenCalledWith(
      "gh",
      ["api", "repos/acme/widgets/events", "--paginate=false"],
      expect.objectContaining({
        encoding: "utf8",
        timeout: 8000,
        windowsHide: true,
        origin: "routine:github-events",
        policy: "allow",
        scope: "routine",
        shell: false,
      }),
      expect.any(Function),
    );
  });

  it("keeps GitHub event failures best-effort", async () => {
    _deps.execFile = vi.fn((_file, _args, _options, callback) => {
      callback(new Error("gh unavailable"), "", "failed");
      return {};
    });

    await expect(defaultFetchEvents("acme/widgets")).resolves.toEqual([]);
  });
});
