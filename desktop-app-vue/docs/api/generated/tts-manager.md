# tts-manager

**Source**: `src/main/speech/tts-manager.js`

**Generated**: 2026-02-16T13:44:34.609Z

---

## const EventEmitter = require('events');

```javascript
const EventEmitter = require('events');
```

* Text-to-Speech Manager
 *
 * Unified interface for TTS supporting:
 * - Edge TTS (Microsoft, free, requires internet)
 * - Piper (local, fast, offline)
 *
 * Features:
 * - Provider auto-selection
 * - Fallback support
 * - Audio caching
 *
 * @module tts-manager
 * @version 1.0.0

---

## const TTSProvider =

```javascript
const TTSProvider =
```

* TTS providers

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* Default configuration

---

## class TTSManager extends EventEmitter

```javascript
class TTSManager extends EventEmitter
```

* TTS Manager

---

## async initialize(options =

```javascript
async initialize(options =
```

* Initialize the manager
   * @param {Object} options - Initialization options

---

## async checkProviders()

```javascript
async checkProviders()
```

* Check availability of all providers
   * @returns {Promise<Object>} Provider status

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

## getVoices(provider = null, language = null)

```javascript
getVoices(provider = null, language = null)
```

* Get available voices
   * @param {string} provider - Provider to get voices for
   * @param {string} language - Filter by language (optional)
   * @returns {Object} Available voices

---

## getStats()

```javascript
getStats()
```

* Get statistics
   * @returns {Object} Statistics

---

## clearCache()

```javascript
clearCache()
```

* Clear all caches

---

## async _synthesizeWithEdge(text, options)

```javascript
async _synthesizeWithEdge(text, options)
```

* Synthesize with Edge TTS
   * @private

---

## async _synthesizeWithLocal(text, options)

```javascript
async _synthesizeWithLocal(text, options)
```

* Synthesize with Local TTS
   * @private

---

## _getPreferredProvider()

```javascript
_getPreferredProvider()
```

* Get preferred provider based on availability and config
   * @private

---

## _getFallbackProvider(failedProvider)

```javascript
_getFallbackProvider(failedProvider)
```

* Get fallback provider
   * @private

---

## _setupEventForwarding()

```javascript
_setupEventForwarding()
```

* Setup event forwarding from clients
   * @private

---

## function getTTSManager(config)

```javascript
function getTTSManager(config)
```

* Get TTSManager singleton
 * @param {Object} config - Configuration
 * @returns {TTSManager}

---

