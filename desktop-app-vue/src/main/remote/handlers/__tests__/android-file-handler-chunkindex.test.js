/**
 * AndroidFileHandler.downloadChunk — chunkIndex validation
 *
 * Regression: uploadChunk validates chunkIndex (non-negative integer), but
 * downloadChunk used the remote-supplied chunkIndex directly. A negative/
 * non-integer value produced a bad read offset (wrong bytes or ERR_OUT_OF_RANGE),
 * and a too-large value tripped isLastChunk → prematurely closed the fd and
 * deleted the transfer so legitimate later chunks could never be fetched.
 */
import { describe, it, expect, beforeEach } from "vitest";

const { AndroidFileHandler } = require("../android-file-handler.js");

describe("AndroidFileHandler.downloadChunk chunkIndex guard", () => {
  let handler;
  beforeEach(() => {
    handler = new AndroidFileHandler();
    handler.transfers.set("t1", {
      direction: "download",
      chunkSize: 1024,
      fileSize: 4096,
      totalChunks: 4,
      sentChunks: 0,
      bytesSent: 0,
      fd: { read: async () => {}, close: async () => {} },
    });
  });

  it("rejects a negative chunkIndex", async () => {
    await expect(
      handler.downloadChunk({ transferId: "t1", chunkIndex: -1 }),
    ).rejects.toThrow(/non-negative integer/);
  });

  it("rejects a non-integer chunkIndex", async () => {
    await expect(
      handler.downloadChunk({ transferId: "t1", chunkIndex: 1.5 }),
    ).rejects.toThrow(/non-negative integer/);
  });
});
