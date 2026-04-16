# local-tts-client

**Source**: `src/main/speech/local-tts-client.js`

**Generated**: 2026-04-16T04:17:05.837Z

---

## const EventEmitter = require("events");

```javascript
const EventEmitter = require("events");
```

* Local TTS Client (Piper)
 *
 * Uses Piper for fast, high-quality local text-to-speech.
 * No internet connection required.
 *
 * @module local-tts-client
 * @version 1.0.0

---

## const _deps =

```javascript
const _deps =
```

@type {{ fs: typeof fs, https: any, http: any, fsSync: typeof import('fs') }}

---

## const PIPER_MODELS =

```javascript
const PIPER_MODELS =
```

* Piper voice models

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* Default configuration

---

## class LocalTTSClient extends EventEmitter

```javascript
class LocalTTSClient extends EventEmitter
```

* Local TTS Client using Piper

---

## async initialize(options =

```javascript
async initialize(options =
```

* Initialize client
   * @param {Object} options - Initialization options

---

## async checkStatus()

```javascript
async checkStatus()
```

* Check if Piper is available
   * @returns {Promise<Object>} Status object

---

## async synthesize(text, options =

```javascript
async synthesize(text, options =
```

* Synthesize text to speech
   * @param {string} text - Text to synthesize
   * @param {Object} options - Synthesis options
   * @returns {Promise<Object>} Audio data

---

## getModels()

```javascript
getModels()
```

* Get available models
   * @returns {Object} Available models

---

## async downloadModel(modelId)

```javascript
async downloadModel(modelId)
```

* Download a Piper voice model from GitHub releases
   * @param {string} modelId - Model ID from PIPER_MODELS (e.g. "en_US-lessac-medium")
   * @returns {Promise<Object>} Download result with paths to .onnx and .json files

---

## _downloadFile(url, destPath)

```javascript
_downloadFile(url, destPath)
```

* Download a file via HTTPS with redirect following
   * @private

---

## clearCache()

```javascript
clearCache()
```

* Clear cache

---

## async _detectPiperPath()

```javascript
async _detectPiperPath()
```

* Detect Piper path
   * @private

---

## async _scanModels()

```javascript
async _scanModels()
```

* Scan for available models
   * @private

---

## _runCommand(args, timeout = 30000)

```javascript
_runCommand(args, timeout = 30000)
```

* Run piper command
   * @private

---

## _synthesizeWithStdin(text, args, outputFile)

```javascript
_synthesizeWithStdin(text, args, outputFile)
```

* Synthesize with text via stdin
   * @private

---

## _getCacheKey(text, options)

```javascript
_getCacheKey(text, options)
```

* Get cache key
   * @private

---

