# edge-tts-client

**Source**: `src/main/speech/edge-tts-client.js`

**Generated**: 2026-02-15T07:37:13.776Z

---

## const EventEmitter = require('events');

```javascript
const EventEmitter = require('events');
```

* Edge TTS Client
 *
 * Uses Microsoft Edge's free TTS service for speech synthesis.
 * No API key required, supports multiple languages and voices.
 *
 * @module edge-tts-client
 * @version 1.0.0

---

## const EDGE_VOICES =

```javascript
const EDGE_VOICES =
```

* Available Edge TTS voices (commonly used)

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* Default configuration

---

## class EdgeTTSClient extends EventEmitter

```javascript
class EdgeTTSClient extends EventEmitter
```

* Edge TTS Client

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

* Check if edge-tts is available
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

## async synthesizeToFile(text, outputPath, options =

```javascript
async synthesizeToFile(text, outputPath, options =
```

* Synthesize text to file
   * @param {string} text - Text to synthesize
   * @param {string} outputPath - Output file path
   * @param {Object} options - Synthesis options
   * @returns {Promise<Object>} Result

---

## getVoices(language = null)

```javascript
getVoices(language = null)
```

* Get available voices
   * @param {string} language - Filter by language code (optional)
   * @returns {Object} Available voices

---

## clearCache()

```javascript
clearCache()
```

* Clear cache

---

## _runCommand(args)

```javascript
_runCommand(args)
```

* Run edge-tts command
   * @private

---

## _parseVoiceList(output)

```javascript
_parseVoiceList(output)
```

* Parse voice list output
   * @private

---

## _getCacheKey(text, options)

```javascript
_getCacheKey(text, options)
```

* Get cache key
   * @private

---

