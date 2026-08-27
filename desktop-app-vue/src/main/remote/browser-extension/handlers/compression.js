/**
 * Bounded Compression Streams API handlers.
 */

/* eslint-disable no-undef */
/* global chrome, CompressionStream, DecompressionStream, TextEncoder, TextDecoder, Uint8Array, Array, ReadableStream */

import { utf8ByteLength } from "./heap-snapshot-boundary.js";

const MIB = 1024 * 1024;
const RETRY_AFTER_MS = 1000;
const SUPPORTED_FORMATS = Object.freeze(["gzip", "deflate", "deflate-raw"]);

export const DEFAULT_COMPRESSION_LIMITS = Object.freeze({
  maxActiveOperations: 4,
  maxInputBytes: MIB,
  maxCompressedBytes: 2 * MIB,
  maxDecompressedBytes: 4 * MIB,
});

export const HARD_COMPRESSION_LIMITS = Object.freeze({
  maxActiveOperations: 32,
  maxInputBytes: 8 * MIB,
  maxCompressedBytes: 16 * MIB,
  maxDecompressedBytes: 32 * MIB,
});

function normalizeLimit(value, fallback, hardLimit) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function overloaded(error, scope, limit) {
  return {
    accepted: false,
    error,
    code: "OVERLOADED",
    scope,
    retryAfterMs: RETRY_AFTER_MS,
    limit,
  };
}

export class CompressionOperationRegistry {
  constructor(options = {}) {
    const maxInputBytes = normalizeLimit(
      options.maxInputBytes,
      DEFAULT_COMPRESSION_LIMITS.maxInputBytes,
      HARD_COMPRESSION_LIMITS.maxInputBytes,
    );
    const maxCompressedBytes = normalizeLimit(
      options.maxCompressedBytes,
      DEFAULT_COMPRESSION_LIMITS.maxCompressedBytes,
      HARD_COMPRESSION_LIMITS.maxCompressedBytes,
    );
    this.limits = Object.freeze({
      maxActiveOperations: normalizeLimit(
        options.maxActiveOperations,
        DEFAULT_COMPRESSION_LIMITS.maxActiveOperations,
        HARD_COMPRESSION_LIMITS.maxActiveOperations,
      ),
      maxInputBytes,
      maxCompressedBytes,
      maxDecompressedBytes: normalizeLimit(
        options.maxDecompressedBytes,
        DEFAULT_COMPRESSION_LIMITS.maxDecompressedBytes,
        HARD_COMPRESSION_LIMITS.maxDecompressedBytes,
      ),
    });
    this.operations = new Map();
    this.activeTabs = new Map();
    this.sequence = 0;
  }

  admit(tabId, operation) {
    if (this.activeTabs.has(tabId)) {
      return overloaded(
        "A compression operation is already active for this tab",
        "compression_tab",
        { maxActiveOperationsPerTab: 1 },
      );
    }
    if (this.operations.size >= this.limits.maxActiveOperations) {
      return overloaded(
        "Compression operation capacity exceeded",
        "compression_operations",
        { maxActiveOperations: this.limits.maxActiveOperations },
      );
    }
    const lease = Object.freeze({
      id: ++this.sequence,
      tabId,
      operation,
    });
    this.operations.set(lease.id, lease);
    this.activeTabs.set(tabId, lease);
    return { accepted: true, lease };
  }

  release(lease) {
    if (!lease || this.operations.get(lease.id) !== lease) {
      return false;
    }
    this.operations.delete(lease.id);
    if (this.activeTabs.get(lease.tabId) === lease) {
      this.activeTabs.delete(lease.tabId);
    }
    return true;
  }

  getStats() {
    return { activeOperations: this.operations.size, limits: this.limits };
  }
}

export function validateCompressionFormat(format = "gzip") {
  return SUPPORTED_FORMATS.includes(format)
    ? { accepted: true, format }
    : {
        accepted: false,
        error: `Unsupported compression format: ${String(format)}`,
        code: "INVALID_ARGUMENT",
        supportedFormats: [...SUPPORTED_FORMATS],
      };
}

export function validateCompressionInput(data, maxInputBytes) {
  if (typeof data !== "string") {
    return {
      accepted: false,
      error: "Compression input must be a string",
      code: "INVALID_ARGUMENT",
    };
  }
  const bytes = utf8ByteLength(data);
  if (bytes > maxInputBytes) {
    return overloaded("Compression input is too large", "compression_input", {
      maxInputBytes,
    });
  }
  return { accepted: true, data, bytes };
}

export function validateDecompressionInput(data, maxCompressedBytes) {
  if (!Array.isArray(data)) {
    return {
      accepted: false,
      error: "Decompression input must be a byte array",
      code: "INVALID_ARGUMENT",
    };
  }
  if (data.length > maxCompressedBytes) {
    return overloaded("Compressed input is too large", "decompression_input", {
      maxCompressedBytes,
    });
  }
  for (const value of data) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return {
        accepted: false,
        error: "Decompression input contains a non-byte value",
        code: "INVALID_ARGUMENT",
      };
    }
  }
  return { accepted: true, data, bytes: data.length };
}

export async function compressPayloadInPage(
  inputData,
  format,
  maxCompressedBytes,
) {
  if (typeof CompressionStream === "undefined") {
    return { error: "CompressionStream not supported" };
  }
  try {
    const inputBytes = new TextEncoder().encode(inputData);
    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue(inputBytes);
        controller.close();
      },
    });
    const reader = inputStream
      .pipeThrough(new CompressionStream(format))
      .getReader();
    const chunks = [];
    let compressedBytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value?.byteLength) {
        continue;
      }
      if (compressedBytes + value.byteLength > maxCompressedBytes) {
        await reader.cancel("compressed output limit exceeded");
        chunks.length = 0;
        return {
          accepted: false,
          error: "Compressed output is too large",
          code: "OVERLOADED",
          scope: "compression_output",
          retryAfterMs: 1000,
          limit: { maxCompressedBytes },
        };
      }
      chunks.push(value);
      compressedBytes += value.byteLength;
    }

    const compressed = new Uint8Array(compressedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      compressed.set(chunk, offset);
      offset += chunk.byteLength;
    }
    chunks.length = 0;
    return {
      compressed: Array.from(compressed),
      originalSize: inputBytes.byteLength,
      compressedSize: compressedBytes,
      ratio:
        inputBytes.byteLength === 0
          ? "0.00%"
          : `${((compressedBytes / inputBytes.byteLength) * 100).toFixed(2)}%`,
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function decompressPayloadInPage(
  compressedData,
  format,
  maxDecompressedBytes,
) {
  if (typeof DecompressionStream === "undefined") {
    return { error: "DecompressionStream not supported" };
  }
  try {
    const inputBytes = new Uint8Array(compressedData);
    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue(inputBytes);
        controller.close();
      },
    });
    const reader = inputStream
      .pipeThrough(new DecompressionStream(format))
      .getReader();
    const decoder = new TextDecoder();
    const textChunks = [];
    let decompressedBytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value?.byteLength) {
        continue;
      }
      if (decompressedBytes + value.byteLength > maxDecompressedBytes) {
        await reader.cancel("decompressed output limit exceeded");
        textChunks.length = 0;
        return {
          accepted: false,
          error: "Decompressed output is too large",
          code: "OVERLOADED",
          scope: "decompression_output",
          retryAfterMs: 1000,
          limit: { maxDecompressedBytes },
        };
      }
      decompressedBytes += value.byteLength;
      textChunks.push(decoder.decode(value, { stream: true }));
    }
    textChunks.push(decoder.decode());
    return {
      decompressed: textChunks.join(""),
      decompressedSize: decompressedBytes,
    };
  } catch (error) {
    return { error: error.message };
  }
}

const compressionOperations = new CompressionOperationRegistry();

export async function compressData(tabId, data, format = "gzip") {
  const formatValidation = validateCompressionFormat(format);
  if (!formatValidation.accepted) {
    return formatValidation;
  }
  const inputValidation = validateCompressionInput(
    data,
    compressionOperations.limits.maxInputBytes,
  );
  if (!inputValidation.accepted) {
    return inputValidation;
  }
  const admission = compressionOperations.admit(tabId, "compress");
  if (!admission.accepted) {
    return admission;
  }
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: compressPayloadInPage,
      args: [
        inputValidation.data,
        formatValidation.format,
        compressionOperations.limits.maxCompressedBytes,
      ],
    });
    return result[0]?.result || { error: "Compression produced no result" };
  } catch (error) {
    return { error: error.message };
  } finally {
    compressionOperations.release(admission.lease);
  }
}

export async function decompressData(tabId, data, format = "gzip") {
  const formatValidation = validateCompressionFormat(format);
  if (!formatValidation.accepted) {
    return formatValidation;
  }
  const inputValidation = validateDecompressionInput(
    data,
    compressionOperations.limits.maxCompressedBytes,
  );
  if (!inputValidation.accepted) {
    return inputValidation;
  }
  const admission = compressionOperations.admit(tabId, "decompress");
  if (!admission.accepted) {
    return admission;
  }
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: decompressPayloadInPage,
      args: [
        inputValidation.data,
        formatValidation.format,
        compressionOperations.limits.maxDecompressedBytes,
      ],
    });
    return result[0]?.result || { error: "Decompression produced no result" };
  } catch (error) {
    return { error: error.message };
  } finally {
    compressionOperations.release(admission.lease);
  }
}

export async function getSupportedCompressionFormats(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        compressionSupported: typeof CompressionStream !== "undefined",
        decompressionSupported: typeof DecompressionStream !== "undefined",
        formats: ["gzip", "deflate", "deflate-raw"],
      }),
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function isCompressionSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        supported:
          typeof CompressionStream !== "undefined" &&
          typeof DecompressionStream !== "undefined",
      }),
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export const compressionHandlers = {
  "compression.compress": ({ tabId, data, format }) =>
    compressData(tabId, data, format),
  "compression.decompress": ({ tabId, data, format }) =>
    decompressData(tabId, data, format),
  "compression.getSupportedFormats": ({ tabId }) =>
    getSupportedCompressionFormats(tabId),
  "compression.isSupported": ({ tabId }) => isCompressionSupported(tabId),
};
