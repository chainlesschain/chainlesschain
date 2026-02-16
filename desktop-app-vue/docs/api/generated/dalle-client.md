# dalle-client

**Source**: `src/main/image-gen/dalle-client.js`

**Generated**: 2026-02-16T13:44:34.661Z

---

## const EventEmitter = require('events');

```javascript
const EventEmitter = require('events');
```

* DALL-E Client
 *
 * Connects to OpenAI DALL-E API for image generation.
 * Supports DALL-E 2 and DALL-E 3.
 *
 * @module dalle-client
 * @version 1.0.0

---

## const DALLEModel =

```javascript
const DALLEModel =
```

* DALL-E model versions

---

## const ImageSizes =

```javascript
const ImageSizes =
```

* Image sizes by model

---

## const ImageQuality =

```javascript
const ImageQuality =
```

* Quality options (DALL-E 3 only)

---

## const ImageStyle =

```javascript
const ImageStyle =
```

* Style options (DALL-E 3 only)

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* Default configuration

---

## class DALLEClient extends EventEmitter

```javascript
class DALLEClient extends EventEmitter
```

* DALL-E Client

---

## setApiKey(apiKey)

```javascript
setApiKey(apiKey)
```

* Set API key
   * @param {string} apiKey - OpenAI API key

---

## checkStatus()

```javascript
checkStatus()
```

* Check if DALL-E is available
   * @returns {Object} Status object

---

## async generate(prompt, options =

```javascript
async generate(prompt, options =
```

* Generate image from text prompt
   * @param {string} prompt - Text prompt
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated image data

---

## async createVariation(image, options =

```javascript
async createVariation(image, options =
```

* Create image variations (DALL-E 2 only)
   * @param {string} image - Base64 encoded PNG image
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated variations

---

## async edit(image, prompt, mask, options =

```javascript
async edit(image, prompt, mask, options =
```

* Edit image (DALL-E 2 only)
   * @param {string} image - Base64 encoded PNG image
   * @param {string} prompt - Edit prompt
   * @param {string} mask - Base64 encoded mask (transparent areas = edit)
   * @param {Object} options - Edit options
   * @returns {Promise<Object>} Edited image

---

## getStats()

```javascript
getStats()
```

* Get usage statistics
   * @returns {Object} Statistics

---

## _updateCost(model, size, count, quality)

```javascript
_updateCost(model, size, count, quality)
```

* Update cost estimate
   * @private

---

## async _fetch(endpoint, options =

```javascript
async _fetch(endpoint, options =
```

* HTTP fetch wrapper
   * @private

---

## async _fetchFormData(endpoint, formData)

```javascript
async _fetchFormData(endpoint, formData)
```

* HTTP fetch with FormData
   * @private

---

