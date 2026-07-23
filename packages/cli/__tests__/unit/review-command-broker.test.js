import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _deps,
  ghCli,
  gitCli,
  resolveDiffArgs,
} from "../../src/commands/review.js";

const ORIGINAL_SPAWN_SYNC = _deps.spawnSync;

afterEach(() => {
  _deps.spawnSync = ORIGINAL_SPAWN_SYNC;
});

describe("review command process Broker", () => {
  it("runs git through the review scope with a large diff buffer", () => {
    _deps.spawnSync = vi.fn(() => ({
      status: 0,
      stdout: "patch\n",
      stderr: "",
    }));
    const args = resolveDiffArgs({ range: "topic..HEAD" }).args;

    expect(gitCli(args, { cwd: "/repo" })).toBe("patch\n");
    expect(args).toEqual(["diff", "--end-of-options", "topic..HEAD"]);
    expect(_deps.spawnSync).toHaveBeenCalledWith(
      "git",
      args,
      expect.objectContaining({
        cwd: "/repo",
        maxBuffer: 256 * 1024 * 1024,
        origin: "review:command-git",
        policy: "allow",
        scope: "review",
        shell: false,
      }),
    );
  });

  it("runs gh through Broker and passes review JSON over stdin", () => {
    _deps.spawnSync = vi.fn(() => ({
      status: 0,
      stdout: "reviewed\n",
      stderr: "",
    }));

    expect(
      ghCli(["api", "repos/acme/widgets/pulls/7/reviews"], {
        cwd: "/repo",
        input: '{"event":"COMMENT"}',
      }),
    ).toBe("reviewed\n");
    expect(_deps.spawnSync).toHaveBeenCalledWith(
      "gh",
      ["api", "repos/acme/widgets/pulls/7/reviews"],
      expect.objectContaining({
        input: '{"event":"COMMENT"}',
        maxBuffer: 64 * 1024 * 1024,
        origin: "review:command-gh",
        policy: "allow",
        scope: "review",
        shell: false,
      }),
    );
  });

  it("keeps gh stderr in command failures", () => {
    _deps.spawnSync = vi.fn(() => ({
      status: 4,
      stdout: "",
      stderr: "authentication required",
    }));

    expect(() => ghCli(["pr", "view"], { cwd: "/repo" })).toThrow(
      "authentication required",
    );
  });
});
