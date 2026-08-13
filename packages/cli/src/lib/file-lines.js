import { closeSync, fstatSync, openSync, readSync } from "node:fs";

const DEFAULT_CHUNK_SIZE = 64 * 1024;
export const DEFAULT_MAX_FILE_LINE_BYTES = 16 * 1024 * 1024;
export const FILE_LINE_TOO_LARGE_CODE = "CC_FILE_LINE_TOO_LARGE";

function normalizeMaxLineBytes(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError("maxLineBytes must be a positive safe integer");
  }
  return parsed;
}

function normalizeChunkSize(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError("chunkSize must be a positive safe integer");
  }
  return parsed;
}

export function assertFileLineByteLength(
  byteLength,
  {
    maxLineBytes = DEFAULT_MAX_FILE_LINE_BYTES,
    code = FILE_LINE_TOO_LARGE_CODE,
    lineNo = null,
    direction = null,
    label = "File line",
  } = {},
) {
  const actualBytes = Number(byteLength);
  const maxBytes = normalizeMaxLineBytes(maxLineBytes);
  if (!Number.isSafeInteger(actualBytes) || actualBytes < 0) {
    throw new TypeError("byteLength must be a non-negative safe integer");
  }
  if (actualBytes <= maxBytes) return actualBytes;
  const error = new Error(`${label} exceeded the ${maxBytes}-byte limit`);
  error.code = code;
  error.actualBytes = actualBytes;
  error.maxBytes = maxBytes;
  if (Number.isSafeInteger(lineNo) && lineNo > 0) error.lineNo = lineNo;
  if (direction) error.direction = direction;
  throw error;
}

function assertLineByteLength(byteLength, options, details) {
  return assertFileLineByteLength(byteLength, {
    maxLineBytes: options.maxLineBytes,
    code: options.lineTooLargeCode,
    label: options.lineLabel,
    ...details,
  });
}

function joinedLineBuffer(parts, byteLength) {
  if (parts.length === 0) return Buffer.alloc(0);
  if (parts.length === 1) return parts[0];
  return Buffer.concat(parts, byteLength);
}

function recordRead(ioMetrics, bytes) {
  if (!ioMetrics || typeof ioMetrics !== "object") return;
  ioMetrics.readCalls = Math.max(0, Number(ioMetrics.readCalls) || 0) + 1;
  ioMetrics.bytesRead =
    Math.max(0, Number(ioMetrics.bytesRead) || 0) + Math.max(0, bytes || 0);
}

/**
 * Stream UTF-8 lines from a file without loading the whole file. The final
 * unterminated fragment is yielded with `terminated:false`, which lets callers
 * distinguish a crash tail from a normal record. Records are assembled as raw
 * byte slices and checked before any Buffer.concat or UTF-8 decode.
 */
export function* iterateFileLinesSync(
  filePath,
  {
    chunkSize = DEFAULT_CHUNK_SIZE,
    includeEmpty = false,
    ioMetrics = null,
    maxLineBytes = DEFAULT_MAX_FILE_LINE_BYTES,
    lineTooLargeCode = FILE_LINE_TOO_LARGE_CODE,
    lineLabel = "File line",
  } = {},
) {
  const lineOptions = {
    maxLineBytes: normalizeMaxLineBytes(maxLineBytes),
    lineTooLargeCode,
    lineLabel,
  };
  const buffer = Buffer.allocUnsafe(
    Math.min(normalizeChunkSize(chunkSize), lineOptions.maxLineBytes),
  );
  const fd = openSync(filePath, "r");
  let pendingParts = [];
  let pendingBytes = 0;
  let lineNo = 0;
  try {
    for (;;) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      recordRead(ioMetrics, bytesRead);
      let start = 0;
      let newline = buffer.indexOf(0x0a, start);
      while (newline >= 0 && newline < bytesRead) {
        const segment = buffer.subarray(start, newline);
        const lineByteLength = pendingBytes + segment.length;
        lineNo += 1;
        assertLineByteLength(lineByteLength, lineOptions, {
          lineNo,
          direction: "forward",
        });
        let lineBytes = joinedLineBuffer(
          segment.length > 0 ? [...pendingParts, segment] : pendingParts,
          lineByteLength,
        );
        if (lineBytes.length > 0 && lineBytes[lineBytes.length - 1] === 0x0d) {
          lineBytes = lineBytes.subarray(0, lineBytes.length - 1);
        }
        if (includeEmpty || lineBytes.length > 0) {
          yield {
            line: lineBytes.toString("utf8"),
            lineNo,
            terminated: true,
          };
        }
        pendingParts = [];
        pendingBytes = 0;
        start = newline + 1;
        newline = buffer.indexOf(0x0a, start);
      }

      const trailing = buffer.subarray(start, bytesRead);
      const nextPendingBytes = pendingBytes + trailing.length;
      assertLineByteLength(nextPendingBytes, lineOptions, {
        lineNo: lineNo + 1,
        direction: "forward",
      });
      if (trailing.length > 0) pendingParts.push(Buffer.from(trailing));
      pendingBytes = nextPendingBytes;
    }

    if (pendingBytes > 0 || includeEmpty) {
      lineNo += 1;
      assertLineByteLength(pendingBytes, lineOptions, {
        lineNo,
        direction: "forward",
      });
      if (includeEmpty || pendingBytes > 0) {
        const pending = joinedLineBuffer(pendingParts, pendingBytes);
        yield {
          line: pending.toString("utf8"),
          lineNo,
          terminated: false,
        };
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
    maxLineBytes = DEFAULT_MAX_FILE_LINE_BYTES,
    lineTooLargeCode = FILE_LINE_TOO_LARGE_CODE,
    lineLabel = "File line",
  } = {},
) {
  const lineOptions = {
    maxLineBytes: normalizeMaxLineBytes(maxLineBytes),
    lineTooLargeCode,
    lineLabel,
  };
  const readChunkSize = Math.min(
    normalizeChunkSize(chunkSize),
    lineOptions.maxLineBytes,
  );
  const fd = openSync(filePath, "r");
  let carryParts = [];
  let carryBytes = 0;
  let isPhysicalTail = true;
  try {
    const size = fstatSync(fd).size;
    let endsWithNewline = false;
    if (size > 0) {
      const last = Buffer.allocUnsafe(1);
      const bytesRead = readSync(fd, last, 0, 1, size - 1);
      recordRead(ioMetrics, bytesRead);
      endsWithNewline = last[0] === 0x0a;
    }

    let position = size;
    while (position > 0) {
      const length = Math.min(readChunkSize, position);
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      const bytesRead = readSync(fd, chunk, 0, length, position);
      recordRead(ioMetrics, bytesRead);
      let end = bytesRead;
      for (let index = bytesRead - 1; index >= 0; index -= 1) {
        if (chunk[index] !== 0x0a) continue;
        const segment = chunk.subarray(index + 1, end);
        const lineByteLength = segment.length + carryBytes;
        assertLineByteLength(lineByteLength, lineOptions, {
          direction: "reverse",
        });
        let lineBytes = joinedLineBuffer(
          segment.length > 0 ? [segment, ...carryParts] : carryParts,
          lineByteLength,
        );
        if (lineBytes.length > 0 && lineBytes[lineBytes.length - 1] === 0x0d) {
          lineBytes = lineBytes.subarray(0, lineBytes.length - 1);
        }
        const line = lineBytes.toString("utf8");
        const terminated = isPhysicalTail ? endsWithNewline : true;
        // A file ending in "\n" produces one empty physical-tail slice. Skip
        // it without changing the termination status of the real last line.
        if (includeEmpty || line.length > 0) {
          yield { line, terminated };
          isPhysicalTail = false;
        }
        carryParts = [];
        carryBytes = 0;
        end = index;
      }

      const prefix = chunk.subarray(0, end);
      const nextCarryBytes = prefix.length + carryBytes;
      assertLineByteLength(nextCarryBytes, lineOptions, {
        direction: "reverse",
      });
      if (prefix.length > 0) carryParts.unshift(Buffer.from(prefix));
      carryBytes = nextCarryBytes;
    }

    if (carryBytes > 0 || includeEmpty) {
      assertLineByteLength(carryBytes, lineOptions, { direction: "reverse" });
      let lineBytes = joinedLineBuffer(carryParts, carryBytes);
      if (lineBytes.length > 0 && lineBytes[lineBytes.length - 1] === 0x0d) {
        lineBytes = lineBytes.subarray(0, lineBytes.length - 1);
      }
      const line = lineBytes.toString("utf8");
      if (includeEmpty || line.length > 0) {
        yield { line, terminated: !isPhysicalTail };
      }
    }
  } finally {
    closeSync(fd);
  }
}
