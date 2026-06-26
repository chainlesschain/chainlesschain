// @vitest-environment node

/**
 * FileTransferManager.handleRequestChunks — chunk-resend slice regression.
 *
 * fs.readFileSync(path, {start,end}) IGNORES start/end (those are
 * createReadStream/fd options) and returns the WHOLE file, so on the
 * resume/retry path every re-requested chunk overwrote the receiver's slot with
 * the full file content → reassembly produced a corrupt file and the sha256
 * integrity check failed. Each chunk must be its own [start,end) byte slice.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const FileTransferManager = require("../file-transfer-manager.js");

describe("FileTransferManager.handleRequestChunks", () => {
  let tmpFile;

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });

  it("resends each chunk's exact byte range, not the whole file", async () => {
    const content = Buffer.from("ABCDEFGHIJKLMNOP"); // 16 bytes
    tmpFile = path.join(os.tmpdir(), `ftm-test-${Date.now()}.bin`);
    fs.writeFileSync(tmpFile, content);

    const mgr = new FileTransferManager({ on: vi.fn() }, { chunkSize: 4 });
    mgr.uploads.set("t1", {
      transferId: "t1",
      filePath: tmpFile,
      fileSize: content.length,
    });

    const sent = [];
    mgr.sendChunk = vi.fn(async (_task, idx, data) => {
      sent.push({ idx, data: Buffer.from(data).toString() });
    });

    await mgr.handleRequestChunks("peer", {
      transferId: "t1",
      chunks: [0, 2, 3],
    });

    // Before the fix every `data` was the whole "ABCDEFGHIJKLMNOP".
    expect(sent).toEqual([
      { idx: 0, data: "ABCD" }, // bytes [0,4)
      { idx: 2, data: "IJKL" }, // bytes [8,12)
      { idx: 3, data: "MNOP" }, // bytes [12,16) — last (short) chunk
    ]);
  });

  it("ignores an out-of-range chunk index without crashing", async () => {
    const content = Buffer.from("ABCD");
    tmpFile = path.join(os.tmpdir(), `ftm-test2-${Date.now()}.bin`);
    fs.writeFileSync(tmpFile, content);

    const mgr = new FileTransferManager({ on: vi.fn() }, { chunkSize: 4 });
    mgr.uploads.set("t1", {
      transferId: "t1",
      filePath: tmpFile,
      fileSize: content.length,
    });
    const sent = [];
    mgr.sendChunk = vi.fn(async (_t, idx) => sent.push(idx));

    await mgr.handleRequestChunks("peer", { transferId: "t1", chunks: [0, 9] });

    expect(sent).toEqual([0]); // chunk 9 (start 36 > fileSize) skipped
  });
});
