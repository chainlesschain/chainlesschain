/**
 * MediaHandler.playSound — file path injection guard
 *
 * Regression: playSound interpolated a remote-supplied `file` into shell /
 * PowerShell commands (SoundPlayer '${file}', afplay "${file}") with no
 * validation, so a peer could break out of the quoting and run a second command
 * (e.g. "'); calc.exe; ('"). The sibling `sound` param is allowlist-mapped.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("child_process", () => ({
  exec: vi.fn((cmd, cb) => cb(null, { stdout: "", stderr: "" })),
}));
vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { MediaHandler } = require("../media-handler.js");

describe("MediaHandler.playSound file injection guard", () => {
  let handler;
  beforeEach(() => {
    handler = new MediaHandler();
  });

  it("rejects a file path with quote-breakout metacharacters", async () => {
    await expect(
      handler.playSound({ file: "'); calc.exe; ('" }, {}),
    ).rejects.toThrow(/Invalid sound file path/);
  });

  it("rejects a file path with command-chaining metacharacters", async () => {
    await expect(
      handler.playSound({ file: '"; rm -rf ~; "' }, {}),
    ).rejects.toThrow(/Invalid sound file path/);
  });
});
