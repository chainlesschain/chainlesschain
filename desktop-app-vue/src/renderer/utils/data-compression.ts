/**
 * Data Compression Utilities
 * 数据压缩工具 - 压缩大文件和数据传输
 *
 * Features:
 * - GZIP/Deflate compression (using pako)
 * - Automatic compression for large data
 * - Streaming compression for huge files
 * - Base64 encoding/decoding
 * - Compression ratio reporting
 * - Decompression with error handling
 *
 * Note: This uses pako library for compression. Install with:
 * npm install pako
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * Pako 库类型 (简化版)
 */
interface PakoModule {
  deflate: (data: Uint8Array, options?: { level?: number }) => Uint8Array;
  inflate: (data: Uint8Array) => Uint8Array;
  Deflate: new (options?: { level?: number }) => PakoDeflate;
  Inflate: new () => PakoInflate;
}

interface PakoDeflate {
  push: (data: Uint8Array, flush: boolean) => void;
  result: Uint8Array | null;
}

interface PakoInflate {
  push: (data: Uint8Array, flush: boolean) => void;
  result: Uint8Array | null;
}

/**
 * 压缩器选项
 */
export interface DataCompressorOptions {
  level?: number;
  threshold?: number;
  autoCompress?: boolean;
  useBase64?: boolean;
  debug?: boolean;
}

/**
 * 压缩选项
 */
export interface CompressOptions {
  level?: number;
  base64?: boolean;
}

/**
 * 解压选项
 */
export interface DecompressOptions {
  asString?: boolean;
  fromBase64?: boolean;
}

/**
 * 压缩统计
 */
export interface CompressionStats {
  totalCompressed: number;
  totalDecompressed: number;
  originalSize: number;
  compressedSize: number;
  bytesSaved: number;
}

/**
 * 压缩统计报告
 */
export interface CompressionStatsReport extends CompressionStats {
  averageCompressionRatio: string;
  bytesSavedMB: number;
}

// ==================== Pako 加载 ====================

// Dynamic import for pako (if available)
let pako: PakoModule | null = null;

// Try to import pako
const loadPako = async (): Promise<PakoModule | null> => {
  if (pako) {
    return pako;
  }

  try {
    // Try dynamic import (requires bundler support)
    const module = await import('pako');
    pako = module as unknown as PakoModule;
    return pako;
  } catch {
    logger.warn('[DataCompression] pako library not available, compression disabled');
    return null;
  }
};

// ==================== 数据压缩器类 ====================

/**
 * DataCompressor
 * 数据压缩器
 */
class DataCompressor {
  private options: Required<DataCompressorOptions>;
  private stats: CompressionStats;
  private pako: PakoModule | null;

  constructor(options: DataCompressorOptions = {}) {
    // Configuration
    this.options = {
      level: options.level || 6, // Compression level (0-9, default: 6)
      threshold: options.threshold || 1024, // Min size to compress (bytes)
      autoCompress: options.autoCompress !== false,
      useBase64: options.useBase64 || false,
      debug: options.debug || false,
    };

    // Statistics
    this.stats = {
      totalCompressed: 0,
      totalDecompressed: 0,
      originalSize: 0,
      compressedSize: 0,
      bytesSaved: 0,
    };

    // Pako instance
    this.pako = null;

    // Initialize
    this.init();
  }

  /**
   * Initialize compressor
   */
  async init(): Promise<void> {
    this.pako = await loadPako();

    if (this.options.debug && this.pako) {
      logger.info('[DataCompressor] Initialized with pako');
    }
  }

  /**
   * Compress data (string or Uint8Array)
   */
  async compress(
    data: string | Uint8Array,
    options: CompressOptions = {}
  ): Promise<Uint8Array | string> {
    if (!this.pako) {
      await this.init();
    }

    if (!this.pako) {
      logger.warn('[DataCompressor] Compression not available, returning original data');
      return data;
    }

    const { level = this.options.level, base64 = this.options.useBase64 } = options;

    try {
      // Convert string to Uint8Array if needed
      const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;

      const originalSize = input.length;

      // Check threshold
      if (this.options.autoCompress && originalSize < this.options.threshold) {
        if (this.options.debug) {
          logger.info('[DataCompressor] Data below threshold, skipping compression');
        }
        return data;
      }

      // Compress
      const compressed = this.pako.deflate(input, { level });

      const compressedSize = compressed.length;

      // Update statistics
      this.stats.totalCompressed++;
      this.stats.originalSize += originalSize;
      this.stats.compressedSize += compressedSize;
      this.stats.bytesSaved += originalSize - compressedSize;

      const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(2);

      if (this.options.debug) {
        logger.info(
          `[DataCompressor] Compressed: ${originalSize} -> ${compressedSize} bytes (${ratio}% reduction)`
        );
      }

      // Convert to base64 if requested
      if (base64) {
        return this.arrayBufferToBase64(compressed);
      }

      return compressed;
    } catch (error) {
      logger.error('[DataCompressor] Compression error:', error);
      return data; // Return original data on error
    }
  }

  /**
   * Decompress data
   */
  async decompress(
    data: Uint8Array | string,
    options: DecompressOptions = {}
  ): Promise<string | Uint8Array> {
    if (!this.pako) {
      await this.init();
    }

    if (!this.pako) {
      logger.warn('[DataCompressor] Decompression not available, returning original data');
      return data;
    }

    const { asString = true, fromBase64 = this.options.useBase64 } = options;

    try {
      // Convert from base64 if needed
      const input = fromBase64 ? this.base64ToArrayBuffer(data as string) : (data as Uint8Array);

      // Decompress
      const decompressed = this.pako.inflate(input);

      this.stats.totalDecompressed++;

      if (this.options.debug) {
        logger.info(`[DataCompressor] Decompressed: ${input.length} -> ${decompressed.length} bytes`);
      }

      // Convert to string if requested
      if (asString) {
        return new TextDecoder().decode(decompressed);
      }

      return decompressed;
    } catch (error) {
      logger.error('[DataCompressor] Decompression error:', error);
      throw error;
    }
  }

  /**
   * Compress JSON object
   */
  async compressJSON(obj: any, options: CompressOptions = {}): Promise<string | Uint8Array> {
    try {
      const json = JSON.stringify(obj);
      return this.compress(json, options);
    } catch (error) {
      logger.error('[DataCompressor] JSON compression error:', error);
      throw error;
    }
  }

  /**
   * Decompress to JSON object
   */
  async decompressJSON<T = any>(data: Uint8Array | string, options: DecompressOptions = {}): Promise<T> {
    try {
      const json = await this.decompress(data, { ...options, asString: true }) as string;
      return JSON.parse(json);
    } catch (error) {
      logger.error('[DataCompressor] JSON decompression error:', error);
      throw error;
    }
  }

  /**
   * Stream compression (for large files)
   */
  compressStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    if (!this.pako) {
      logger.warn('[DataCompressor] Stream compression not available');
      return stream;
    }

    const deflate = new this.pako.Deflate({ level: this.options.level });

    return new ReadableStream({
      async start(controller) {
        const reader = stream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              // Flush remaining data
              const result = deflate.result;
              if (result) {
                controller.enqueue(result);
              }
              controller.close();
              break;
            }

            // Compress chunk
            deflate.push(value, false);

            if (deflate.result) {
              controller.enqueue(deflate.result);
            }
          }
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
    });
  }

  /**
   * Stream decompression
   */
  decompressStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    if (!this.pako) {
      logger.warn('[DataCompressor] Stream decompression not available');
      return stream;
    }

    const inflate = new this.pako.Inflate();

    return new ReadableStream({
      async start(controller) {
        const reader = stream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              // Flush remaining data
              const result = inflate.result;
              if (result) {
                controller.enqueue(result);
              }
              controller.close();
              break;
            }

            // Decompress chunk
            inflate.push(value, false);

            if (inflate.result) {
              controller.enqueue(inflate.result);
            }
          }
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
    });
  }

  /**
   * Utility: Convert ArrayBuffer to Base64
   */
  arrayBufferToBase64(buffer: Uint8Array): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';

    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
  }

  /**
   * Utility: Convert Base64 to ArrayBuffer
   */
  base64ToArrayBuffer(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  /**
   * Calculate compression ratio
   */
  getCompressionRatio(originalSize: number, compressedSize: number): string {
    return ((1 - compressedSize / originalSize) * 100).toFixed(2);
  }

  /**
   * Get statistics
   */
  getStats(): CompressionStatsReport {
    const avgRatio =
      this.stats.originalSize > 0
        ? this.getCompressionRatio(this.stats.originalSize, this.stats.compressedSize)
        : '0';

    return {
      ...this.stats,
      averageCompressionRatio: `${avgRatio}%`,
      bytesSavedMB: Math.round(this.stats.bytesSaved / 1024 / 1024),
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalCompressed: 0,
      totalDecompressed: 0,
      originalSize: 0,
      compressedSize: 0,
      bytesSaved: 0,
    };

    if (this.options.debug) {
      logger.info('[DataCompressor] Statistics reset');
    }
  }
}

// ==================== 单例实例 ====================

// Singleton instance
let compressorInstance: DataCompressor | null = null;

/**
 * Get or create data compressor instance
 */
export function getDataCompressor(options?: DataCompressorOptions): DataCompressor {
  if (!compressorInstance) {
    compressorInstance = new DataCompressor(options);
  }
  return compressorInstance;
}

// ==================== 便捷函数 ====================

/**
 * Compress data
 */
export async function compress(
  data: string | Uint8Array,
  options?: CompressOptions
): Promise<Uint8Array | string> {
  const compressor = getDataCompressor();
  return compressor.compress(data, options);
}

/**
 * Decompress data
 */
export async function decompress(
  data: Uint8Array | string,
  options?: DecompressOptions
): Promise<string | Uint8Array> {
  const compressor = getDataCompressor();
  return compressor.decompress(data, options);
}

/**
 * Compress JSON
 */
export async function compressJSON(
  obj: any,
  options?: CompressOptions
): Promise<string | Uint8Array> {
  const compressor = getDataCompressor();
  return compressor.compressJSON(obj, options);
}

/**
 * Decompress JSON
 */
export async function decompressJSON<T = any>(
  data: Uint8Array | string,
  options?: DecompressOptions
): Promise<T> {
  const compressor = getDataCompressor();
  return compressor.decompressJSON<T>(data, options);
}

// ==================== 导出 ====================

export { DataCompressor };
export default DataCompressor;
