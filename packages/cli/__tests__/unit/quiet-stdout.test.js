/**
 * Unit tests for withQuietStdout — diverts a stream's writes to a target for the
 * duration of a function, then restores. Uses fake streams (no real stdout).
 */

import { describe, it, expect, vi } from "vitest";
import { withQuietStdout } from "../../src/runtime/quiet-stdout.js";

function fakeStream() {
  const writes = [];
  return { writes, write: vi.fn((chunk) => writes.push(String(chunk))) };
}

describe("withQuietStdout", () => {
  it("diverts writes during fn to the target, not the stream", async () => {
    const stream = fakeStream();
    const target = fakeStream();
    await withQuietStdout(
      async () => {
        stream.write("noisy bootstrap log\n");
      },
      { stream, target },
    );
    expect(target.writes).toEqual(["noisy bootstrap log\n"]);
    // the original write fn was swapped, so it recorded nothing itself
    expect(stream.writes).toEqual([]);
  });

  it("restores the original write after fn resolves", async () => {
    const stream = fakeStream();
    const target = fakeStream();
    const original = stream.write;
    await withQuietStdout(() => {}, { stream, target });
    expect(stream.write).toBe(original);
    stream.write("after\n");
    expect(stream.writes).toEqual(["after\n"]);
    expect(target.writes).toEqual([]);
  });

  it("restores the original write even when fn throws", async () => {
    const stream = fakeStream();
    const target = fakeStream();
    const original = stream.write;
    await expect(
      withQuietStdout(
        async () => {
          stream.write("during\n");
          throw new Error("boom");
        },
        { stream, target },
      ),
    ).rejects.toThrow("boom");
    expect(stream.write).toBe(original);
    expect(target.writes).toEqual(["during\n"]);
  });

  it("returns the function's resolved value", async () => {
    const stream = fakeStream();
    const target = fakeStream();
    const result = await withQuietStdout(async () => ({ db: null }), {
      stream,
      target,
    });
    expect(result).toEqual({ db: null });
  });
});
