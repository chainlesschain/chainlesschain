# data-compression

**Source**: `src\renderer\utils\data-compression.js`

**Generated**: 2026-01-27T06:44:03.900Z

---

## let pako = null

```javascript
let pako = null
```

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

---

## async init()

```javascript
async init()
```

* Initialize compressor

---

## async compress(data, options =

```javascript
async compress(data, options =
```

* Compress data (string or Uint8Array)
   * @param {string|Uint8Array} data - Data to compress
   * @param {Object} options - Compression options
   * @returns {Promise<Uint8Array|string>} Compressed data

---

## async decompress(data, options =

```javascript
async decompress(data, options =
```

* Decompress data
   * @param {Uint8Array|string} data - Compressed data
   * @param {Object} options - Decompression options
   * @returns {Promise<string|Uint8Array>} Decompressed data

---

## async compressJSON(obj, options =

```javascript
async compressJSON(obj, options =
```

* Compress JSON object
   * @param {Object} obj - JSON object
   * @param {Object} options - Compression options
   * @returns {Promise<string|Uint8Array>} Compressed data

---

## async decompressJSON(data, options =

```javascript
async decompressJSON(data, options =
```

* Decompress to JSON object
   * @param {Uint8Array|string} data - Compressed data
   * @param {Object} options - Decompression options
   * @returns {Promise<Object>} Decompressed JSON object

---

## compressStream(stream)

```javascript
compressStream(stream)
```

* Stream compression (for large files)
   * @param {ReadableStream} stream - Input stream
   * @returns {ReadableStream} Compressed stream

---

## decompressStream(stream)

```javascript
decompressStream(stream)
```

* Stream decompression
   * @param {ReadableStream} stream - Compressed stream
   * @returns {ReadableStream} Decompressed stream

---

## arrayBufferToBase64(buffer)

```javascript
arrayBufferToBase64(buffer)
```

* Utility: Convert ArrayBuffer to Base64

---

## base64ToArrayBuffer(base64)

```javascript
base64ToArrayBuffer(base64)
```

* Utility: Convert Base64 to ArrayBuffer

---

## getCompressionRatio(originalSize, compressedSize)

```javascript
getCompressionRatio(originalSize, compressedSize)
```

* Calculate compression ratio
   * @param {number} originalSize - Original size in bytes
   * @param {number} compressedSize - Compressed size in bytes
   * @returns {number} Compression ratio (0-100%)

---

## getStats()

```javascript
getStats()
```

* Get statistics

---

## resetStats()

```javascript
resetStats()
```

* Reset statistics

---

## export function getDataCompressor(options)

```javascript
export function getDataCompressor(options)
```

* Get or create data compressor instance

---

## export async function compress(data, options)

```javascript
export async function compress(data, options)
```

* Convenience functions

---

## export async function compress(data, options)

```javascript
export async function compress(data, options)
```

* Compress data

---

## export async function decompress(data, options)

```javascript
export async function decompress(data, options)
```

* Decompress data

---

## export async function compressJSON(obj, options)

```javascript
export async function compressJSON(obj, options)
```

* Compress JSON

---

## export async function decompressJSON(data, options)

```javascript
export async function decompressJSON(data, options)
```

* Decompress JSON

---

