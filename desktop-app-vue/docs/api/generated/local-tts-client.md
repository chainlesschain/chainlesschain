# local-tts-client

**Source**: `src\main\speech\local-tts-client.js`

**Generated**: 2026-01-27T06:44:03.807Z

---

## const EventEmitter = require('events');

```javascript
const EventEmitter = require('events');
```

* Local TTS Client (Piper)
 *
 * Uses Piper for fast, high-quality local text-to-speech.
 * No internet connection required.
 *
 * @module local-tts-client
 * @version 1.0.0

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

* Download a model
   * @param {string} modelId - Model ID to download
   * @returns {Promise<Object>} Download result

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

