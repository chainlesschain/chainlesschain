# image-gen-manager

**Source**: `src/main/image-gen/image-gen-manager.js`

**Generated**: 2026-02-15T10:10:53.418Z

---

## const EventEmitter = require("events");

```javascript
const EventEmitter = require("events");
```

* Image Generation Manager
 *
 * Unified interface for image generation supporting:
 * - Local: Stable Diffusion (AUTOMATIC1111, ComfyUI)
 * - Cloud: OpenAI DALL-E (2/3)
 *
 * Features:
 * - Provider fallback
 * - Generation caching
 * - Cost tracking
 *
 * @module image-gen-manager
 * @version 1.0.0

---

## const ImageProvider =

```javascript
const ImageProvider =
```

* Image generation providers

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* Default configuration

---

## class ImageGenManager extends EventEmitter

```javascript
class ImageGenManager extends EventEmitter
```

* Image Generation Manager

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

## async generate(prompt, options =

```javascript
async generate(prompt, options =
```

* Generate image from text prompt
   * @param {string} prompt - Text prompt
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated image(s)

---

## async img2img(prompt, initImage, options =

```javascript
async img2img(prompt, initImage, options =
```

* Generate image from image + prompt (img2img)
   * @param {string} prompt - Text prompt
   * @param {string} initImage - Base64 encoded initial image
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated image(s)

---

## async upscale(image, options =

```javascript
async upscale(image, options =
```

* Upscale an image
   * @param {string} image - Base64 encoded image
   * @param {Object} options - Upscale options
   * @returns {Promise<Object>} Upscaled image

---

## async createVariations(image, options =

```javascript
async createVariations(image, options =
```

* Create image variations (DALL-E 2 only)
   * @param {string} image - Base64 encoded image
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Variations

---

## async getProgress()

```javascript
async getProgress()
```

* Get generation progress (SD only)
   * @returns {Promise<Object>} Progress info

---

## async interrupt()

```javascript
async interrupt()
```

* Interrupt current generation (SD only)
   * @returns {Promise<boolean>} Success

---

## async getModels()

```javascript
async getModels()
```

* Get available models (SD)
   * @returns {Promise<Array>} Available models

---

## async switchModel(modelName)

```javascript
async switchModel(modelName)
```

* Switch SD model
   * @param {string} modelName - Model name
   * @returns {Promise<boolean>} Success

---

## setDALLEApiKey(apiKey)

```javascript
setDALLEApiKey(apiKey)
```

* Set DALL-E API key
   * @param {string} apiKey - OpenAI API key

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

* Clear cache

---

## async _generateWithSD(prompt, options)

```javascript
async _generateWithSD(prompt, options)
```

* Generate with Stable Diffusion
   * @private

---

## async _generateWithDALLE(prompt, options)

```javascript
async _generateWithDALLE(prompt, options)
```

* Generate with DALL-E
   * @private

---

## _getPreferredProvider()

```javascript
_getPreferredProvider()
```

* Get preferred provider based on availability
   * @private

---

## _getFallbackProvider(failedProvider)

```javascript
_getFallbackProvider(failedProvider)
```

* Get fallback provider
   * @private

---

## _getFromCache(prompt, options)

```javascript
_getFromCache(prompt, options)
```

* Get from cache
   * @private

---

## _addToCache(prompt, options, result)

```javascript
_addToCache(prompt, options, result)
```

* Add to cache
   * @private

---

## _getCacheKey(prompt, options)

```javascript
_getCacheKey(prompt, options)
```

* Get cache key
   * @private

---

## async _saveImages(result, prompt)

```javascript
async _saveImages(result, prompt)
```

* Save images to disk
   * @private

---

## _setupEventForwarding()

```javascript
_setupEventForwarding()
```

* Setup event forwarding from clients
   * @private

---

## function getImageGenManager(config)

```javascript
function getImageGenManager(config)
```

* Get ImageGenManager singleton
 * @param {Object} config - Configuration
 * @returns {ImageGenManager}

---

