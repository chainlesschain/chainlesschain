# image-gen-ipc

**Source**: `src\main\image-gen\image-gen-ipc.js`

**Generated**: 2026-01-27T06:44:03.854Z

---

## const

```javascript
const
```

* Image Generation IPC Handlers
 *
 * Provides IPC interface for image generation:
 * - Text-to-image generation
 * - Image-to-image transformation
 * - Upscaling
 * - Provider management
 *
 * @module image-gen-ipc
 * @version 1.0.0

---

## function registerImageGenIPC(options =

```javascript
function registerImageGenIPC(options =
```

* Register Image Generation IPC handlers
 * @param {Object} options - Options
 * @param {ImageGenManager} options.imageGenManager - Image generation manager instance
 * @param {Object} [options.ipcMain] - Custom IPC main (for testing)
 * @returns {Object} Handler update functions

---

## ipc.handle('image-gen:check-status', async () =>

```javascript
ipc.handle('image-gen:check-status', async () =>
```

* Check image generation status

---

## ipc.handle('image-gen:get-stats', async () =>

```javascript
ipc.handle('image-gen:get-stats', async () =>
```

* Get statistics

---

## ipc.handle('image-gen:set-dalle-key', async (event,

```javascript
ipc.handle('image-gen:set-dalle-key', async (event,
```

* Set DALL-E API key

---

## ipc.handle('image-gen:generate', async (event,

```javascript
ipc.handle('image-gen:generate', async (event,
```

* Generate image from text prompt

---

## ipc.handle('image-gen:generate-sd', async (event,

```javascript
ipc.handle('image-gen:generate-sd', async (event,
```

* Generate with Stable Diffusion specifically

---

## ipc.handle('image-gen:generate-dalle', async (event,

```javascript
ipc.handle('image-gen:generate-dalle', async (event,
```

* Generate with DALL-E specifically

---

## ipc.handle('image-gen:img2img', async (event,

```javascript
ipc.handle('image-gen:img2img', async (event,
```

* Generate image from image + prompt (img2img)

---

## ipc.handle('image-gen:create-variations', async (event,

```javascript
ipc.handle('image-gen:create-variations', async (event,
```

* Create variations (DALL-E 2)

---

## ipc.handle('image-gen:upscale', async (event,

```javascript
ipc.handle('image-gen:upscale', async (event,
```

* Upscale an image

---

## ipc.handle('image-gen:get-progress', async () =>

```javascript
ipc.handle('image-gen:get-progress', async () =>
```

* Get generation progress

---

## ipc.handle('image-gen:interrupt', async () =>

```javascript
ipc.handle('image-gen:interrupt', async () =>
```

* Interrupt current generation

---

## ipc.handle('image-gen:get-models', async () =>

```javascript
ipc.handle('image-gen:get-models', async () =>
```

* Get available models

---

## ipc.handle('image-gen:switch-model', async (event,

```javascript
ipc.handle('image-gen:switch-model', async (event,
```

* Switch SD model

---

## ipc.handle('image-gen:clear-cache', async () =>

```javascript
ipc.handle('image-gen:clear-cache', async () =>
```

* Clear generation cache

---

