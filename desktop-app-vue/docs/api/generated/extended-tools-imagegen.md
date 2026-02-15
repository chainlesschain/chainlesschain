# extended-tools-imagegen

**Source**: `src/main/ai-engine/extended-tools-imagegen.js`

**Generated**: 2026-02-15T08:42:37.273Z

---

## const

```javascript
const
```

* Image Generation Tools Integration
 *
 * Registers image generation tools with the function caller:
 * - Text-to-image generation
 * - Image-to-image transformation
 * - Upscaling
 *
 * @module extended-tools-imagegen
 * @version 1.0.0

---

## class ImageGenToolsHandler

```javascript
class ImageGenToolsHandler
```

* Image Generation Tools Handler

---

## setImageGenManager(imageGenManager)

```javascript
setImageGenManager(imageGenManager)
```

* Set ImageGenManager reference
   * @param {Object} imageGenManager - ImageGenManager instance

---

## register(functionCaller)

```javascript
register(functionCaller)
```

* Register all image generation tools
   * @param {FunctionCaller} functionCaller - Function caller instance

---

## function getImageGenTools()

```javascript
function getImageGenTools()
```

* Get Image Generation Tools Handler singleton
 * @returns {ImageGenToolsHandler}

---

