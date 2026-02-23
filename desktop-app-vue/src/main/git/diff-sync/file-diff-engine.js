/**
 * File Diff Engine
 * rsync-style rolling checksum + strong checksum diff algorithm
 * Content-defined chunking via Rabin fingerprints
 * Cross-file block-level deduplication
 * Delta → compression pipeline
 *
 * @module git/diff-sync/file-diff-engine
 * @version 1.1.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const crypto = require("crypto");

// Default chunk sizes
const DEFAULT_BLOCK_SIZE = 4096; // 4KB fixed block
const RABIN_AVG_SIZE = 4096; // 4KB average variable chunk
const RABIN_MIN_SIZE = 2048; // 2KB min variable chunk
const RABIN_MAX_SIZE = 16384; // 16KB max variable chunk

// Rabin fingerprint parameters
const RABIN_PRIME = 31;
const RABIN_MODULUS = (1 << 16) - 1; // 65535
const RABIN_MASK = RABIN_AVG_SIZE - 1; // For power-of-2 average size

/**
 * Adler32 rolling checksum implementation
 */
class Adler32 {
  constructor() {
    this.a = 1;
    this.b = 0;
    this.window = [];
    this.windowSize = 0;
  }

  /**
   * Initialize with a block of data
   * @param {Buffer} data
   * @param {number} offset
   * @param {number} length
   */
  init(data, offset, length) {
    this.a = 1;
    this.b = 0;
    this.window = [];
    this.windowSize = length;

    for (let i = 0; i < length && offset + i < data.length; i++) {
      const byte = data[offset + i];
      this.a = (this.a + byte) % 65521;
      this.b = (this.b + this.a) % 65521;
      this.window.push(byte);
    }
  }

  /**
   * Roll the checksum forward by one byte
   * @param {number} outByte - Byte leaving the window
   * @param {number} inByte - Byte entering the window
   */
  roll(outByte, inByte) {
    this.a = (this.a - outByte + inByte + 65521) % 65521;
    this.b =
      (this.b - this.windowSize * outByte + this.a - 1 + 65521 * 16) % 65521;
    this.window.shift();
    this.window.push(inByte);
  }

  /**
   * Get current checksum value
   * @returns {number}
   */
  digest() {
    return (this.b << 16) | this.a;
  }
}

/**
 * Content-defined chunking using Rabin fingerprints
 */
class RabinChunker {
  /**
   * Split data into variable-size chunks using Rabin fingerprinting
   * @param {Buffer} data
   * @param {Object} [options]
   * @param {number} [options.avgSize=4096]
   * @param {number} [options.minSize=2048]
   * @param {number} [options.maxSize=16384]
   * @returns {Array<{offset: number, length: number, hash: string}>}
   */
  static chunk(data, options = {}) {
    const avgSize = options.avgSize || RABIN_AVG_SIZE;
    const minSize = options.minSize || RABIN_MIN_SIZE;
    const maxSize = options.maxSize || RABIN_MAX_SIZE;
    const mask = avgSize - 1;

    const chunks = [];
    let chunkStart = 0;
    let fingerprint = 0;

    for (let i = 0; i < data.length; i++) {
      // Update Rabin fingerprint
      fingerprint = (fingerprint * RABIN_PRIME + data[i]) & RABIN_MODULUS;
      const chunkLen = i - chunkStart + 1;

      // Check for chunk boundary
      const isChunkBoundary =
        (chunkLen >= minSize && (fingerprint & mask) === 0) ||
        chunkLen >= maxSize;

      if (isChunkBoundary || i === data.length - 1) {
        const chunk = data.slice(chunkStart, i + 1);
        const hash = crypto.createHash("md5").update(chunk).digest("hex");
        chunks.push({
          offset: chunkStart,
          length: chunk.length,
          hash,
        });
        chunkStart = i + 1;
        fingerprint = 0;
      }
    }

    return chunks;
  }
}

/**
 * Block deduplication index
 */
class DeduplicationIndex {
  constructor() {
    // hash -> [{fileId, offset, length}]
    this.index = new Map();
    this._stats = {
      totalBlocks: 0,
      uniqueBlocks: 0,
      duplicateBlocks: 0,
      bytesSaved: 0,
    };
  }

  /**
   * Add blocks from a file to the dedup index
   * @param {string} fileId
   * @param {Array<{offset: number, length: number, hash: string}>} blocks
   */
  addBlocks(fileId, blocks) {
    for (const block of blocks) {
      this._stats.totalBlocks++;

      if (this.index.has(block.hash)) {
        this._stats.duplicateBlocks++;
        this._stats.bytesSaved += block.length;
        this.index
          .get(block.hash)
          .push({ fileId, offset: block.offset, length: block.length });
      } else {
        this._stats.uniqueBlocks++;
        this.index.set(block.hash, [
          { fileId, offset: block.offset, length: block.length },
        ]);
      }
    }
  }

  /**
   * Check if a block exists in the index
   * @param {string} hash
   * @returns {boolean}
   */
  hasBlock(hash) {
    return this.index.has(hash);
  }

  /**
   * Get block references
   * @param {string} hash
   * @returns {Array}
   */
  getBlockRefs(hash) {
    return this.index.get(hash) || [];
  }

  /**
   * Get deduplication stats
   */
  getStats() {
    return { ...this._stats };
  }

  clear() {
    this.index.clear();
    this._stats = {
      totalBlocks: 0,
      uniqueBlocks: 0,
      duplicateBlocks: 0,
      bytesSaved: 0,
    };
  }
}

/**
 * File Diff Engine - rsync-style differential transfer
 */
class FileDiffEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.blockSize = options.blockSize || DEFAULT_BLOCK_SIZE;
    this.useRabinChunking = options.useRabinChunking !== false;
    this.dedupIndex = new DeduplicationIndex();

    // Compression (zstd via fzstd if available, fallback to zlib)
    this._compressor = null;
    this._decompressor = null;
    this._initCompression();
  }

  /**
   * Initialize compression
   */
  _initCompression() {
    try {
      const fzstd = require("fzstd");
      this._compressor = (data) => fzstd.compress(data);
      this._decompressor = (data) => fzstd.decompress(data);
      logger.info("[FileDiffEngine] Using fzstd compression");
    } catch (_e) {
      // Fallback to zlib
      const zlib = require("zlib");
      this._compressor = (data) => zlib.deflateSync(data, { level: 6 });
      this._decompressor = (data) => zlib.inflateSync(data);
      logger.info(
        "[FileDiffEngine] Using zlib compression (fzstd not available)",
      );
    }
  }

  /**
   * Generate rsync-style signature for a file
   * Contains rolling checksums and strong checksums for each block
   *
   * @param {Buffer} data - File data
   * @returns {Array<{index: number, weakHash: number, strongHash: string, offset: number, length: number}>}
   */
  generateSignature(data) {
    const blocks = this.useRabinChunking
      ? RabinChunker.chunk(data, { avgSize: this.blockSize })
      : this._fixedChunk(data);

    const signature = [];
    const adler = new Adler32();

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const blockData = data.slice(block.offset, block.offset + block.length);

      // Rolling (weak) checksum
      adler.init(blockData, 0, blockData.length);
      const weakHash = adler.digest();

      // Strong checksum (MD5)
      const strongHash = crypto
        .createHash("md5")
        .update(blockData)
        .digest("hex");

      signature.push({
        index: i,
        weakHash,
        strongHash,
        offset: block.offset,
        length: block.length,
      });
    }

    return signature;
  }

  /**
   * Generate delta using rsync algorithm
   * Compare target data against a signature (from base)
   *
   * @param {Buffer} targetData - New file data
   * @param {Array} baseSignature - Signature of the base file
   * @returns {Object} Delta instructions
   */
  generateDelta(targetData, baseSignature) {
    // Build lookup table from base signature
    const weakLookup = new Map();
    for (const block of baseSignature) {
      if (!weakLookup.has(block.weakHash)) {
        weakLookup.set(block.weakHash, []);
      }
      weakLookup.get(block.weakHash).push(block);
    }

    const instructions = [];
    let pos = 0;
    let insertStart = -1;
    const adler = new Adler32();

    while (pos < targetData.length) {
      // Try each possible block size from the signature
      let matched = false;

      if (pos + this.blockSize <= targetData.length) {
        adler.init(targetData, pos, this.blockSize);
        const weakHash = adler.digest();

        const candidates = weakLookup.get(weakHash);
        if (candidates) {
          // Verify with strong hash
          const blockData = targetData.slice(pos, pos + this.blockSize);
          const strongHash = crypto
            .createHash("md5")
            .update(blockData)
            .digest("hex");

          const match = candidates.find((c) => c.strongHash === strongHash);
          if (match) {
            // Flush any pending literal data
            if (insertStart >= 0) {
              instructions.push({
                type: "insert",
                data: targetData.slice(insertStart, pos),
              });
              insertStart = -1;
            }

            // Emit copy instruction
            instructions.push({
              type: "copy",
              offset: match.offset,
              length: match.length,
            });

            pos += match.length;
            matched = true;
          }
        }
      }

      if (!matched) {
        if (insertStart < 0) {
          insertStart = pos;
        }
        pos++;
      }
    }

    // Flush remaining literal data
    if (insertStart >= 0) {
      instructions.push({
        type: "insert",
        data: targetData.slice(insertStart),
      });
    }

    return {
      instructions,
      baseBlockCount: baseSignature.length,
      copyCount: instructions.filter((i) => i.type === "copy").length,
      insertCount: instructions.filter((i) => i.type === "insert").length,
    };
  }

  /**
   * Apply delta instructions to reconstruct a file
   *
   * @param {Buffer} baseData - Original file data
   * @param {Object} delta - Delta instructions
   * @returns {Buffer} Reconstructed file data
   */
  applyDelta(baseData, delta) {
    const chunks = [];

    for (const instruction of delta.instructions) {
      if (instruction.type === "copy") {
        chunks.push(
          baseData.slice(
            instruction.offset,
            instruction.offset + instruction.length,
          ),
        );
      } else if (instruction.type === "insert") {
        chunks.push(Buffer.from(instruction.data));
      }
    }

    return Buffer.concat(chunks);
  }

  /**
   * Compress data using the configured compression algorithm
   * @param {Buffer} data
   * @returns {Buffer}
   */
  compress(data) {
    if (!this._compressor) {
      return data;
    }
    try {
      return this._compressor(data);
    } catch (error) {
      logger.warn("[FileDiffEngine] Compression failed:", error.message);
      return data;
    }
  }

  /**
   * Decompress data
   * @param {Buffer} data
   * @returns {Buffer}
   */
  decompress(data) {
    if (!this._decompressor) {
      return data;
    }
    try {
      return this._decompressor(data);
    } catch (error) {
      logger.warn("[FileDiffEngine] Decompression failed:", error.message);
      return data;
    }
  }

  /**
   * Full pipeline: delta → compress
   * @param {Buffer} baseData
   * @param {Buffer} targetData
   * @returns {{ compressedDelta: Buffer, stats: Object }}
   */
  diffAndCompress(baseData, targetData) {
    const signature = this.generateSignature(baseData);
    const delta = this.generateDelta(targetData, signature);

    // Serialize delta
    const serialized = this._serializeDelta(delta);

    // Compress
    const compressed = this.compress(serialized);

    const stats = {
      originalSize: targetData.length,
      deltaSize: serialized.length,
      compressedSize: compressed.length,
      compressionRatio: 1 - compressed.length / targetData.length,
      copyBlocks: delta.copyCount,
      insertBlocks: delta.insertCount,
    };

    this.emit("diff:complete", stats);
    return { compressedDelta: compressed, stats };
  }

  /**
   * Add file blocks to deduplication index
   * @param {string} fileId
   * @param {Buffer} data
   */
  indexForDedup(fileId, data) {
    const chunks = this.useRabinChunking
      ? RabinChunker.chunk(data, { avgSize: this.blockSize })
      : this._fixedChunk(data);

    this.dedupIndex.addBlocks(fileId, chunks);
    return chunks;
  }

  /**
   * Check which blocks of a file are already known (dedup)
   * @param {Buffer} data
   * @returns {{ newBlocks: Array, existingBlocks: Array }}
   */
  checkDedup(data) {
    const chunks = this.useRabinChunking
      ? RabinChunker.chunk(data, { avgSize: this.blockSize })
      : this._fixedChunk(data);

    const newBlocks = [];
    const existingBlocks = [];

    for (const chunk of chunks) {
      if (this.dedupIndex.hasBlock(chunk.hash)) {
        existingBlocks.push(chunk);
      } else {
        newBlocks.push(chunk);
      }
    }

    return { newBlocks, existingBlocks };
  }

  /**
   * Fixed-size chunking
   * @param {Buffer} data
   * @returns {Array<{offset: number, length: number, hash: string}>}
   */
  _fixedChunk(data) {
    const chunks = [];
    for (let i = 0; i < data.length; i += this.blockSize) {
      const length = Math.min(this.blockSize, data.length - i);
      const chunk = data.slice(i, i + length);
      const hash = crypto.createHash("md5").update(chunk).digest("hex");
      chunks.push({ offset: i, length, hash });
    }
    return chunks;
  }

  /**
   * Serialize delta instructions to a buffer
   * @param {Object} delta
   * @returns {Buffer}
   */
  _serializeDelta(delta) {
    const parts = [];
    const header = Buffer.alloc(4);
    header.writeUInt32BE(delta.instructions.length, 0);
    parts.push(header);

    for (const inst of delta.instructions) {
      if (inst.type === "copy") {
        const buf = Buffer.alloc(9);
        buf[0] = 0x01; // copy
        buf.writeUInt32BE(inst.offset, 1);
        buf.writeUInt32BE(inst.length, 5);
        parts.push(buf);
      } else if (inst.type === "insert") {
        const data = Buffer.from(inst.data);
        const buf = Buffer.alloc(5);
        buf[0] = 0x02; // insert
        buf.writeUInt32BE(data.length, 1);
        parts.push(buf);
        parts.push(data);
      }
    }

    return Buffer.concat(parts);
  }

  /**
   * Get engine statistics
   */
  getStats() {
    return {
      dedup: this.dedupIndex.getStats(),
    };
  }
}

module.exports = {
  FileDiffEngine,
  Adler32,
  RabinChunker,
  DeduplicationIndex,
  DEFAULT_BLOCK_SIZE,
};
