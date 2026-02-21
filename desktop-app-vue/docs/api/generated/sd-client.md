# sd-client

**Source**: `src/main/image-gen/sd-client.js`

**Generated**: 2026-02-21T22:45:05.291Z

---

## const EventEmitter = require('events');

```javascript
const EventEmitter = require('events');
```

* Stable Diffusion Client
 *
 * Connects to local Stable Diffusion WebUI (AUTOMATIC1111) or ComfyUI
 * for image generation capabilities.
 *
 * @module sd-client
 * @version 1.0.0

---

## const SDAPIType =

```javascript
const SDAPIType =
```

* SD API Types

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* Default configuration

---

## class SDClient extends EventEmitter

```javascript
class SDClient extends EventEmitter
```

* Stable Diffusion Client

---

## async checkStatus()

```javascript
async checkStatus()
```

* Check if SD is available
   * @returns {Promise<Object>} Status object

---

## async txt2img(prompt, options =

```javascript
async txt2img(prompt, options =
```

* Generate image from text prompt
   * @param {string} prompt - Text prompt
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated image data

---

## async img2img(prompt, initImage, options =

```javascript
async img2img(prompt, initImage, options =
```

* Generate image from image + prompt (img2img)
   * @param {string} prompt - Text prompt
   * @param {string} initImage - Base64 encoded initial image
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated image data

---

## async upscale(image, options =

```javascript
async upscale(image, options =
```

* Upscale an image
   * @param {string} image - Base64 encoded image
   * @param {Object} options - Upscale options
   * @returns {Promise<Object>} Upscaled image data

---

## async getProgress()

```javascript
async getProgress()
```

* Get current generation progress
   * @returns {Promise<Object>} Progress info

---

## async interrupt()

```javascript
async interrupt()
```

* Interrupt current generation
   * @returns {Promise<boolean>} Success

---

## async switchModel(modelName)

```javascript
async switchModel(modelName)
```

* Switch to a different model
   * @param {string} modelName - Model checkpoint name
   * @returns {Promise<boolean>} Success

---

## async _loadModels()

```javascript
async _loadModels()
```

* Load available models
   * @private

---

## async _loadSamplers()

```javascript
async _loadSamplers()
```

* Load available samplers
   * @private

---

## async _fetch(endpoint, options =

```javascript
async _fetch(endpoint, options =
```

* HTTP fetch wrapper
   * @private

---

