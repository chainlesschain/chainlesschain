import { describe, expect, it, vi } from "vitest";
import type { execFile } from "node:child_process";

import {
  listCheckpoints,
  listSessions,
  runCliJson,
} from "../src/cli-json.js";

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

function fakeExec(stdout: string, error: Error | null = null) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const impl = ((
    command: string,
    args: string[],
    _options: unknown,
    callback: ExecCallback,
  ) => {
    calls.push({ command, args });
    setImmediate(() => callback(error, stdout, ""));
  }) as unknown as typeof execFile;
  return { impl, calls };
}

describe("runCliJson", () => {
  it("parses JSON stdout", async () => {
    const { impl, calls } = fakeExec('{"ok":true}');
    const result = await runCliJson<{ ok: boolean }>(["session", "list"], {
      execFileImpl: impl,
    });
    expect(result).toEqual({ ok: true });
    expect(calls[0].args).toEqual(
      expect.arrayContaining(["session", "list"]),
    );
  });

  it("rejects on process failure with stderr context", async () => {
    const { impl } = fakeExec("", new Error("exit 1"));
    await expect(
      runCliJson(["session", "list"], { execFileImpl: impl }),
    ).rejects.toThrow(/session list failed/);
  });

  it("rejects on non-JSON stdout", async () => {
    const { impl } = fakeExec("plain text");
    await expect(
      runCliJson(["checkpoint", "list"], { execFileImpl: impl }),
    ).rejects.toThrow(/non-JSON/);
  });
});

describe("list helpers", () => {
  it("accepts both a bare array and a wrapped {sessions:[...]}", async () => {
    const bare = fakeExec('[{"id":"a"}]');
    expect(await listSessions({ execFileImpl: bare.impl })).toEqual([
      { id: "a" },
    ]);
    const wrapped = fakeExec('{"sessions":[{"id":"b"}]}');
    expect(await listSessions({ execFileImpl: wrapped.impl })).toEqual([
      { id: "b" },
    ]);
  });

  it("listCheckpoints unwraps {checkpoints:[...]}", async () => {
    const { impl, calls } = fakeExec('{"checkpoints":[{"id":"cp1"}]}');
    expect(await listCheckpoints({ execFileImpl: impl })).toEqual([
      { id: "cp1" },
    ]);
    expect(calls[0].args).toEqual(
      expect.arrayContaining(["checkpoint", "list", "--json"]),
    );
  });
});
