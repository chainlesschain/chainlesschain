"use strict";

const {
  IPFSBoundaryError,
  createOverloadedError,
} = require("./ipfs-boundaries.js");

class IPFSContentRuntime {
  constructor(getBoundaries) {
    if (typeof getBoundaries !== "function") {
      throw new TypeError("getBoundaries must be a function");
    }
    this.getBoundaries = getBoundaries;
    this.activeReads = new Set();
    this.activeWrites = new Set();
    this.writeGeneration = 0;
  }

  acquireWrite() {
    const boundaries = this.getBoundaries();
    if (this.activeWrites.size >= boundaries.maxConcurrentWrites) {
      throw createOverloadedError(boundaries, "write admission full");
    }
    const token = { generation: this.writeGeneration };
    this.activeWrites.add(token);
    return token;
  }

  releaseWrite(token) {
    this.activeWrites.delete(token);
  }

  assertWriteActive(token) {
    if (token.generation !== this.writeGeneration) {
      throw new IPFSBoundaryError(
        "CANCELLED",
        "IPFS node stopped during write",
      );
    }
  }

  _acquireRead() {
    const boundaries = this.getBoundaries();
    if (this.activeReads.size >= boundaries.maxConcurrentReads) {
      throw createOverloadedError(boundaries);
    }

    const token = {
      boundaries,
      controller: new AbortController(),
      iterator: null,
      iteratorClosed: false,
      settled: false,
      cancelReject: null,
      timeout: null,
    };
    token.cancelPromise = new Promise((_, reject) => {
      token.cancelReject = reject;
    });
    token.cancelPromise.catch(() => {});
    token.deadlinePromise = new Promise((_, reject) => {
      token.timeout = setTimeout(() => {
        if (token.settled) return;
        const error = new IPFSBoundaryError(
          "DEADLINE_EXCEEDED",
          `IPFS read exceeded ${boundaries.readTimeoutMs} ms`,
          { timeoutMs: boundaries.readTimeoutMs },
        );
        token.controller.abort(error);
        reject(error);
      }, boundaries.readTimeoutMs);
      token.timeout.unref?.();
    });
    token.deadlinePromise.catch(() => {});
    this.activeReads.add(token);
    return token;
  }

  _closeIterator(token) {
    if (
      token.iteratorClosed ||
      !token.iterator ||
      typeof token.iterator.return !== "function"
    ) {
      return;
    }
    token.iteratorClosed = true;
    Promise.resolve(token.iterator.return()).catch(() => {});
  }

  stop(reason = "IPFS node stopped during read") {
    this.writeGeneration += 1;
    for (const token of this.activeReads) {
      if (token.settled) continue;
      const error = new IPFSBoundaryError("CANCELLED", reason);
      token.controller.abort(error);
      token.cancelReject(error);
      this._closeIterator(token);
    }
  }

  async read(unixfs, cid, maxStoredBytes) {
    if (!unixfs || typeof unixfs.cat !== "function") {
      throw new Error("IPFS UnixFS reader is unavailable");
    }

    const token = this._acquireRead();
    const chunks = [];
    let totalBytes = 0;
    let chunkCount = 0;

    try {
      const iterable = unixfs.cat(cid, { signal: token.controller.signal });
      if (!iterable || typeof iterable[Symbol.asyncIterator] !== "function") {
        throw new IPFSBoundaryError(
          "INVALID_RESPONSE",
          "IPFS cat did not return an async iterable",
        );
      }
      token.iterator = iterable[Symbol.asyncIterator]();

      while (true) {
        const result = await Promise.race([
          token.iterator.next(),
          token.deadlinePromise,
          token.cancelPromise,
        ]);
        if (result.done) break;

        chunkCount += 1;
        if (chunkCount > token.boundaries.maxReadChunks) {
          throw new IPFSBoundaryError(
            "TOO_MANY_CHUNKS",
            `IPFS read exceeded ${token.boundaries.maxReadChunks} chunks`,
            { limitChunks: token.boundaries.maxReadChunks },
          );
        }

        const value = result.value;
        if (!Buffer.isBuffer(value) && !ArrayBuffer.isView(value)) {
          throw new IPFSBoundaryError(
            "INVALID_RESPONSE",
            "IPFS cat yielded a non-binary chunk",
          );
        }
        const chunkBytes = value.byteLength;
        if (totalBytes + chunkBytes > maxStoredBytes) {
          throw new IPFSBoundaryError(
            "PAYLOAD_TOO_LARGE",
            `IPFS content exceeds ${maxStoredBytes} bytes`,
            { limitBytes: maxStoredBytes },
          );
        }
        totalBytes += chunkBytes;
        chunks.push(
          Buffer.isBuffer(value)
            ? value
            : Buffer.from(value.buffer, value.byteOffset, value.byteLength),
        );
      }

      return Buffer.concat(chunks, totalBytes);
    } catch (error) {
      token.controller.abort(error);
      this._closeIterator(token);
      throw error;
    } finally {
      chunks.length = 0;
      token.settled = true;
      clearTimeout(token.timeout);
      this.activeReads.delete(token);
    }
  }
}

module.exports = { IPFSContentRuntime };
