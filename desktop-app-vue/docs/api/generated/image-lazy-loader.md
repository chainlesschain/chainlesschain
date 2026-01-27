# image-lazy-loader

**Source**: `src\renderer\utils\image-lazy-loader.js`

**Generated**: 2026-01-27T06:44:03.899Z

---

## class ImageLazyLoader

```javascript
class ImageLazyLoader
```

* Image Lazy Loading Utility
 * 基于 Intersection Observer API 的图片懒加载工具
 *
 * Features:
 * - Automatic lazy loading with configurable threshold
 * - Progressive image loading (placeholder -> low-res -> full-res)
 * - Preload support for critical images
 * - Error handling and retry mechanism
 * - Memory-efficient with automatic cleanup

---

## init()

```javascript
init()
```

* Initialize Intersection Observer

---

## observe(img, options =

```javascript
observe(img, options =
```

* Observe an image element
   * @param {HTMLImageElement} img - Image element
   * @param {Object} options - Additional options

---

## async loadImage(img)

```javascript
async loadImage(img)
```

* Load image with progressive enhancement
   * @param {HTMLImageElement} img - Image element

---

## async loadProgressively(img, metadata)

```javascript
async loadProgressively(img, metadata)
```

* Progressive loading: blur-up effect

---

## async loadFullRes(img, metadata)

```javascript
async loadFullRes(img, metadata)
```

* Load full resolution image directly

---

## preloadImage(src)

```javascript
preloadImage(src)
```

* Preload image (returns Promise)

---

## fadeTransition(img, newSrc)

```javascript
fadeTransition(img, newSrc)
```

* Fade transition between images

---

## async handleLoadError(img, metadata, error)

```javascript
async handleLoadError(img, metadata, error)
```

* Handle load errors with retry mechanism

---

## unobserve(img)

```javascript
unobserve(img)
```

* Unobserve an image

---

## preloadCritical(imageSrcs)

```javascript
preloadCritical(imageSrcs)
```

* Preload critical images (above the fold)

---

## getStats()

```javascript
getStats()
```

* Get statistics

---

## updateAverageLoadTime(newTime)

```javascript
updateAverageLoadTime(newTime)
```

* Update average load time

---

## delay(ms)

```javascript
delay(ms)
```

* Utility: delay

---

## destroy()

```javascript
destroy()
```

* Cleanup and disconnect

---

## export function getLazyLoader(options)

```javascript
export function getLazyLoader(options)
```

* Get or create lazy loader instance

---

