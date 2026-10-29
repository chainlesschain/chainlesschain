import { queryDigest } from "./memory-query-index.js";

export const DEFAULT_DECODED_SHARD_CACHE_BYTES = 16 * 1024 * 1024;

// Cache validated object graphs, not permission to skip disk reads. Every hit
// requires the newly captured authority bytes, the current physical authority
// identity and the exact manifest generation. Values stay internal to the port.
export class MemoryShardSnapshots {
  #entries = new Map();
  #generation = null;
  #bytes = 0;

  constructor(maxBytes = DEFAULT_DECODED_SHARD_CACHE_BYTES) {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 0 ||
      maxBytes > 64 * 1024 * 1024
    )
      throw new TypeError("decodedShardCacheBytes must be 0-67108864");
    this.maxBytes = maxBytes;
  }

  observe(generation) {
    if (generation === this.#generation) return;
    this.#entries.clear();
    this.#bytes = 0;
    this.#generation = generation;
  }

  read(generation, bucket, bytes, decode) {
    if (
      !generation ||
      generation !== this.#generation ||
      bytes.length > this.maxBytes
    )
      return decode();
    const digest = queryDigest(bytes);
    const cached = this.#entries.get(bucket);
    if (cached?.digest === digest) {
      this.#entries.delete(bucket);
      this.#entries.set(bucket, cached);
      return cached.value;
    }
    if (cached) {
      this.#entries.delete(bucket);
      this.#bytes -= cached.bytes;
    }
    const value = decode();
    // A nested host operation must not repopulate a superseded generation.
    if (generation !== this.#generation) return value;
    while (
      this.#entries.size >= 32 ||
      this.#bytes + bytes.length > this.maxBytes
    ) {
      const oldest = this.#entries.keys().next().value;
      this.#bytes -= this.#entries.get(oldest).bytes;
      this.#entries.delete(oldest);
    }
    this.#entries.set(bucket, { digest, bytes: bytes.length, value });
    this.#bytes += bytes.length;
    return value;
  }
}
