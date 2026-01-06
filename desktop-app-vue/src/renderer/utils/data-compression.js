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

// Dynamic import for pako (if available)
let pako = null

// Try to import pako
const loadPako = async () => {
  if (pako) return pako

  try {
    // Try dynamic import (requires bundler support)
    pako = await import('pako')
    return pako
  } catch {
    console.warn('[DataCompression] pako library not available, compression disabled')
    return null
  }
}

class DataCompressor {
  constructor(options = {}) {
    // Configuration
    this.options = {
      level: options.level || 6, // Compression level (0-9, default: 6)
      threshold: options.threshold || 1024, // Min size to compress (bytes)
      autoCompress: options.autoCompress !== false,
      useBase64: options.useBase64 || false,
      debug: options.debug || false,
    }

    // Statistics
    this.stats = {
      totalCompressed: 0,
      totalDecompressed: 0,
      originalSize: 0,
      compressedSize: 0,
      bytesSaved: 0,
    }

    // Pako instance
    this.pako = null

    // Initialize
    this.init()
  }

  /**
   * Initialize compressor
   */
  async init() {
    this.pako = await loadPako()

    if (this.options.debug && this.pako) {
      console.log('[DataCompressor] Initialized with pako')
    }
  }

  /**
   * Compress data (string or Uint8Array)
   * @param {string|Uint8Array} data - Data to compress
   * @param {Object} options - Compression options
   * @returns {Promise<Uint8Array|string>} Compressed data
   */
  async compress(data, options = {}) {
    if (!this.pako) {
      await this.init()
    }

    if (!this.pako) {
      console.warn('[DataCompressor] Compression not available, returning original data')
      return data
    }

    const { level = this.options.level, base64 = this.options.useBase64 } = options

    try {
      // Convert string to Uint8Array if needed
      const input = typeof data === 'string' ? new TextEncoder().encode(data) : data

      const originalSize = input.length

      // Check threshold
      if (this.options.autoCompress && originalSize < this.options.threshold) {
        if (this.options.debug) {
          console.log('[DataCompressor] Data below threshold, skipping compression')
        }
        return data
      }

      // Compress
      const compressed = this.pako.deflate(input, { level })

      const compressedSize = compressed.length

      // Update statistics
      this.stats.totalCompressed++
      this.stats.originalSize += originalSize
      this.stats.compressedSize += compressedSize
      this.stats.bytesSaved += originalSize - compressedSize

      const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(2)

      if (this.options.debug) {
        console.log(
          `[DataCompressor] Compressed: ${originalSize} → ${compressedSize} bytes (${ratio}% reduction)`
        )
      }

      // Convert to base64 if requested
      if (base64) {
        return this.arrayBufferToBase64(compressed)
      }

      return compressed
    } catch (error) {
      console.error('[DataCompressor] Compression error:', error)
      return data // Return original data on error
    }
  }

  /**
   * Decompress data
   * @param {Uint8Array|string} data - Compressed data
   * @param {Object} options - Decompression options
   * @returns {Promise<string|Uint8Array>} Decompressed data
   */
  async decompress(data, options = {}) {
    if (!this.pako) {
      await this.init()
    }

    if (!this.pako) {
      console.warn('[DataCompressor] Decompression not available, returning original data')
      return data
    }

    const { asString = true, fromBase64 = this.options.useBase64 } = options

    try {
      // Convert from base64 if needed
      const input = fromBase64 ? this.base64ToArrayBuffer(data) : data

      // Decompress
      const decompressed = this.pako.inflate(input)

      this.stats.totalDecompressed++

      if (this.options.debug) {
        console.log(`[DataCompressor] Decompressed: ${input.length} → ${decompressed.length} bytes`)
      }

      // Convert to string if requested
      if (asString) {
        return new TextDecoder().decode(decompressed)
      }

      return decompressed
    } catch (error) {
      console.error('[DataCompressor] Decompression error:', error)
      throw error
    }
  }

  /**
   * Compress JSON object
   * @param {Object} obj - JSON object
   * @param {Object} options - Compression options
   * @returns {Promise<string|Uint8Array>} Compressed data
   */
  async compressJSON(obj, options = {}) {
    try {
      const json = JSON.stringify(obj)
      return this.compress(json, options)
    } catch (error) {
      console.error('[DataCompressor] JSON compression error:', error)
      throw error
    }
  }

  /**
   * Decompress to JSON object
   * @param {Uint8Array|string} data - Compressed data
   * @param {Object} options - Decompression options
   * @returns {Promise<Object>} Decompressed JSON object
   */
  async decompressJSON(data, options = {}) {
    try {
      const json = await this.decompress(data, { ...options, asString: true })
      return JSON.parse(json)
    } catch (error) {
      console.error('[DataCompressor] JSON decompression error:', error)
      throw error
    }
  }

  /**
   * Stream compression (for large files)
   * @param {ReadableStream} stream - Input stream
   * @returns {ReadableStream} Compressed stream
   */
  compressStream(stream) {
    if (!this.pako) {
      console.warn('[DataCompressor] Stream compression not available')
      return stream
    }

    const deflate = new this.pako.Deflate({ level: this.options.level })

    return new ReadableStream({
      async start(controller) {
        const reader = stream.getReader()

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) {
              // Flush remaining data
              const result = deflate.result
              if (result) {
                controller.enqueue(result)
              }
              controller.close()
              break
            }

            // Compress chunk
            deflate.push(value, false)

            if (deflate.result) {
              controller.enqueue(deflate.result)
            }
          }
        } catch (error) {
          controller.error(error)
        } finally {
          reader.releaseLock()
        }
      },
    })
  }

  /**
   * Stream decompression
   * @param {ReadableStream} stream - Compressed stream
   * @returns {ReadableStream} Decompressed stream
   */
  decompressStream(stream) {
    if (!this.pako) {
      console.warn('[DataCompressor] Stream decompression not available')
      return stream
    }

    const inflate = new this.pako.Inflate()

    return new ReadableStream({
      async start(controller) {
        const reader = stream.getReader()

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) {
              // Flush remaining data
              const result = inflate.result
              if (result) {
                controller.enqueue(result)
              }
              controller.close()
              break
            }

            // Decompress chunk
            inflate.push(value, false)

            if (inflate.result) {
              controller.enqueue(inflate.result)
            }
          }
        } catch (error) {
          controller.error(error)
        } finally {
          reader.releaseLock()
        }
      },
    })
  }

  /**
   * Utility: Convert ArrayBuffer to Base64
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer)
    let binary = ''

    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }

    return btoa(binary)
  }

  /**
   * Utility: Convert Base64 to ArrayBuffer
   */
  base64ToArrayBuffer(base64) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }

    return bytes
  }

  /**
   * Calculate compression ratio
   * @param {number} originalSize - Original size in bytes
   * @param {number} compressedSize - Compressed size in bytes
   * @returns {number} Compression ratio (0-100%)
   */
  getCompressionRatio(originalSize, compressedSize) {
    return ((1 - compressedSize / originalSize) * 100).toFixed(2)
  }

  /**
   * Get statistics
   */
  getStats() {
    const avgRatio =
      this.stats.originalSize > 0
        ? this.getCompressionRatio(this.stats.originalSize, this.stats.compressedSize)
        : 0

    return {
      ...this.stats,
      averageCompressionRatio: `${avgRatio}%`,
      bytesSavedMB: Math.round(this.stats.bytesSaved / 1024 / 1024),
    }
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalCompressed: 0,
      totalDecompressed: 0,
      originalSize: 0,
      compressedSize: 0,
      bytesSaved: 0,
    }

    if (this.options.debug) {
      console.log('[DataCompressor] Statistics reset')
    }
  }
}

// Singleton instance
let compressorInstance = null

/**
 * Get or create data compressor instance
 */
export function getDataCompressor(options) {
  if (!compressorInstance) {
    compressorInstance = new DataCompressor(options)
  }
  return compressorInstance
}

/**
 * Convenience functions
 */

/**
 * Compress data
 */
export async function compress(data, options) {
  const compressor = getDataCompressor()
  return compressor.compress(data, options)
}

/**
 * Decompress data
 */
export async function decompress(data, options) {
  const compressor = getDataCompressor()
  return compressor.decompress(data, options)
}

/**
 * Compress JSON
 */
export async function compressJSON(obj, options) {
  const compressor = getDataCompressor()
  return compressor.compressJSON(obj, options)
}

/**
 * Decompress JSON
 */
export async function decompressJSON(data, options) {
  const compressor = getDataCompressor()
  return compressor.decompressJSON(data, options)
}

export default DataCompressor
