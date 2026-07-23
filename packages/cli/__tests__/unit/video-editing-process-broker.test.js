import { afterEach, describe, expect, it } from "vitest";
import {
  _deps,
  spawnMediaProcess,
} from "../../src/skills/video-editing/media-process.js";

const originalSpawn = _deps.spawn;

afterEach(() => {
  _deps.spawn = originalSpawn;
});

describe("video editing process boundary", () => {
  it("routes media tools through literal argv and Broker provenance", () => {
    const child = { pid: 42 };
    const calls = [];
    _deps.spawn = (...args) => {
      calls.push(args);
      return child;
    };

    expect(
      spawnMediaProcess(
        "ffmpeg",
        ["-i", "input with spaces.mp4", "output.mp4"],
        { stdio: ["ignore", "pipe", "pipe"] },
        "video-editing:concat",
      ),
    ).toBe(child);
    expect(calls).toEqual([
      [
        "ffmpeg",
        ["-i", "input with spaces.mp4", "output.mp4"],
        expect.objectContaining({
          origin: "video-editing:concat",
          policy: "allow",
          scope: "video-editing",
          shell: false,
        }),
      ],
    ]);
  });
});
