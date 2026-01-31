# image-optimization

**Source**: `src\renderer\utils\image-optimization.js`

**Generated**: 2026-01-27T06:44:03.899Z

---

## export class ImageFormatDetector

```javascript
export class ImageFormatDetector
```

* Smart Image Optimization System
 * 智能图片优化系统
 *
 * Features:
 * - WebP format detection and conversion
 * - Responsive image loading
 * - Image compression
 * - Placeholder generation (LQIP - Low Quality Image Placeholder)
 * - Progressive loading
 * - CDN support
 * - Network-aware loading

---

## export class ImageFormatDetector

```javascript
export class ImageFormatDetector
```

* Image Format Detector
 * 图片格式检测器

---

## async detect()

```javascript
async detect()
```

* Detect format support

---

## detectWebP()

```javascript
detectWebP()
```

* Detect WebP support

---

## detectAVIF()

```javascript
detectAVIF()
```

* Detect AVIF support

---

## getBestFormat()

```javascript
getBestFormat()
```

* Get best supported format

---

## isSupported(format)

```javascript
isSupported(format)
```

* Check if format is supported

---

## export class SmartImageLoader

```javascript
export class SmartImageLoader
```

* Smart Image Loader
 * 智能图片加载器

---

## async load(src, options =

```javascript
async load(src, options =
```

* Load image with optimizations

---

## buildOptimizedUrl(src, options =

```javascript
buildOptimizedUrl(src, options =
```

* Build optimized image URL

---

## async loadImage(src, options =

```javascript
async loadImage(src, options =
```

* Load image with placeholder

---

## getCacheKey(src, width, height, quality)

```javascript
getCacheKey(src, width, height, quality)
```

* Generate cache key

---

## async preload(srcs, priority = "low")

```javascript
async preload(srcs, priority = "low")
```

* Preload images

---

## clearCache()

```javascript
clearCache()
```

* Clear cache

---

## getCacheStats()

```javascript
getCacheStats()
```

* Get cache stats

---

## export class ResponsiveImageGenerator

```javascript
export class ResponsiveImageGenerator
```

* Responsive Image Generator
 * 响应式图片生成器

---

## generateSrcSet(src, options =

```javascript
generateSrcSet(src, options =
```

* Generate srcset

---

## generateSizes(config)

```javascript
generateSizes(config)
```

* Generate sizes attribute

---

## createResponsiveImage(src, options =

```javascript
createResponsiveImage(src, options =
```

* Create responsive image element

---

## export class ImagePlaceholderGenerator

```javascript
export class ImagePlaceholderGenerator
```

* Image Placeholder Generator
 * 图片占位符生成器

---

## static async generateBlurPlaceholder(src, options =

```javascript
static async generateBlurPlaceholder(src, options =
```

* Generate blur placeholder from image

---

## static generateColorPlaceholder(color = "#f0f0f0", width = 1, height = 1)

```javascript
static generateColorPlaceholder(color = "#f0f0f0", width = 1, height = 1)
```

* Generate solid color placeholder

---

## static generateGradientPlaceholder(

```javascript
static generateGradientPlaceholder(
```

* Generate gradient placeholder

---

## export class ProgressiveImageLoader

```javascript
export class ProgressiveImageLoader
```

* Progressive Image Loader
 * 渐进式图片加载器

---

## async load(src)

```javascript
async load(src)
```

* Load image progressively

---

## showPlaceholder(placeholderSrc)

```javascript
showPlaceholder(placeholderSrc)
```

* Show placeholder

---

## loadImage(src)

```javascript
loadImage(src)
```

* Load image

---

## showImage(img)

```javascript
showImage(img)
```

* Show full image with fade-in

---

## export default

```javascript
export default
```

* Export default object

---

