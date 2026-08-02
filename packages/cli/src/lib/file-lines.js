import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

const DEFAULT_CHUNK_SIZE = 64 * 1024;

function recordRead(ioMetrics, bytes) {
  if (!ioMetrics || typeof ioMetrics !== "object") return;
  ioMetrics.readCalls = Math.max(0, Number(ioMetrics.readCalls) || 0) + 1;
  ioMetrics.bytesRead =
    Math.max(0, Number(ioMetrics.bytesRead) || 0) + Math.max(0, bytes || 0);
}

/**
 * Stream UTF-8 lines from a file without loading the whole file. The final
 * unterminated fragment is yielded with `terminated:false`, which lets callers
 * distinguish a crash tail from a normal record.
 */
export function* iterateFileLinesSync(
  filePath,
  {
    chunkSize = DEFAULT_CHUNK_SIZE,
    includeEmpty = false,
    ioMetrics = null,
  } = {},
) {
  const fd = openSync(filePath, "r");
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(Math.max(1024, chunkSize));
  let pending = "";
  let lineNo = 0;
  try {
    for (;;) {
      const bytes = readSync(fd, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      recordRead(ioMetrics, bytes);
      pending += decoder.write(buffer.subarray(0, bytes));
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        let line = pending.slice(0, newline);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        pending = pending.slice(newline + 1);
        lineNo += 1;
        if (includeEmpty || line.length > 0) {
          yield { line, lineNo, terminated: true };
        }
      }
    }
    pending += decoder.end();
    if (pending.length > 0 || includeEmpty) {
      lineNo += 1;
      if (includeEmpty || pending.length > 0) {
        yield { line: pending, lineNo, terminated: false };
      }
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Read UTF-8 lines newest-first using bounded memory. Lines are assembled as
 * bytes before decoding so a multibyte character split across chunks remains
 * intact. `terminated:false` marks only the physical tail fragment.
 */
export function* iterateFileLinesReverseSync(
  filePath,
  {
    chunkSize = DEFAULT_CHUNK_SIZE,
    includeEmpty = false,
    ioMetrics = null,
  } = {},
) {
  const fd = openSync(filePath, "r");
  const size = fstatSync(fd).size;
  let endsWithNewline = false;
  if (size > 0) {
    const last = Buffer.allocUnsafe(1);
    const bytes = readSync(fd, last, 0, 1, size - 1);
    recordRead(ioMetrics, bytes);
    endsWithNewline = last[0] === 0x0a;
  }
  let position = size;
  let carry = Buffer.alloc(0);
  let isPhysicalTail = true;
  try {
    while (position > 0) {
      const length = Math.min(Math.max(1024, chunkSize), position);
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      const bytes = readSync(fd, chunk, 0, length, position);
      recordRead(ioMetrics, bytes);
      const combined = Buffer.concat([chunk, carry]);
      let end = combined.length;
      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 0x0a) continue;
        let bytes = combined.subarray(index + 1, end);
        if (bytes.length > 0 && bytes[bytes.length - 1] === 0x0d) {
          bytes = bytes.subarray(0, bytes.length - 1);
        }
        const line = bytes.toString("utf8");
        const terminated = isPhysicalTail ? endsWithNewline : true;
        // A file ending in "\n" produces one empty physical-tail slice. Skip
        // it without changing the termination status of the real last line.
        if (includeEmpty || line.length > 0) {
          yield { line, terminated };
          isPhysicalTail = false;
        }
        end = index;
      }
      carry = combined.subarray(0, end);
    }
    if (carry.length > 0 || includeEmpty) {
      let bytes = carry;
      if (bytes.length > 0 && bytes[bytes.length - 1] === 0x0d) {
        bytes = bytes.subarray(0, bytes.length - 1);
      }
      const line = bytes.toString("utf8");
      if (includeEmpty || line.length > 0) {
        yield { line, terminated: !isPhysicalTail };
      }
    }
  } finally {
    closeSync(fd);
  }
}
