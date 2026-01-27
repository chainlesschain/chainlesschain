# critical-rendering-path

**Source**: `src\renderer\utils\critical-rendering-path.js`

**Generated**: 2026-01-27T06:44:03.901Z

---

## export class CriticalCSSManager

```javascript
export class CriticalCSSManager
```

* Critical Rendering Path Optimization
 * 关键渲染路径优化
 *
 * Features:
 * - Critical CSS extraction and inlining
 * - Non-critical CSS lazy loading
 * - Font optimization (preload, font-display)
 * - Above-the-fold optimization
 * - Render-blocking resource optimization

---

## export class CriticalCSSManager

```javascript
export class CriticalCSSManager
```

* Critical CSS Manager
 * 关键CSS管理器

---

## extractCriticalCSS(html, css)

```javascript
extractCriticalCSS(html, css)
```

* Extract critical CSS

---

## isAboveTheFold(rule, html)

```javascript
isAboveTheFold(rule, html)
```

* Check if rule is above the fold

---

## inlineCriticalCSS()

```javascript
inlineCriticalCSS()
```

* Inline critical CSS

---

## loadNonCriticalCSS(href)

```javascript
loadNonCriticalCSS(href)
```

* Lazy load non-critical CSS

---

## deferNonCriticalCSS()

```javascript
deferNonCriticalCSS()
```

* Defer all non-critical stylesheets

---

## export class FontOptimizationManager

```javascript
export class FontOptimizationManager
```

* Font Optimization Manager
 * 字体优化管理器

---

## preloadFonts(fonts = this.options.preloadFonts)

```javascript
preloadFonts(fonts = this.options.preloadFonts)
```

* Preload fonts

---

## applyFontDisplay()

```javascript
applyFontDisplay()
```

* Apply font-display to @font-face rules

---

## useSystemFonts()

```javascript
useSystemFonts()
```

* Use system fonts for initial render

---

## supportsFontLoading()

```javascript
supportsFontLoading()
```

* Detect font loading support

---

## async loadFontsWithAPI(fonts)

```javascript
async loadFontsWithAPI(fonts)
```

* Load fonts using Font Loading API

---

## export class AboveTheFoldOptimizer

```javascript
export class AboveTheFoldOptimizer
```

* Above-the-Fold Optimizer
 * 首屏优化器

---

## isAboveTheFold(element)

```javascript
isAboveTheFold(element)
```

* Check if element is above the fold

---

## optimizeImages()

```javascript
optimizeImages()
```

* Optimize images

---

## optimizeScripts()

```javascript
optimizeScripts()
```

* Optimize scripts

---

## optimize()

```javascript
optimize()
```

* Run all optimizations

---

## export class RenderBlockingOptimizer

```javascript
export class RenderBlockingOptimizer
```

* Render Blocking Resource Optimizer
 * 渲染阻塞资源优化器

---

## optimizeStylesheets()

```javascript
optimizeStylesheets()
```

* Optimize stylesheets

---

## optimizeScripts()

```javascript
optimizeScripts()
```

* Optimize scripts

---

## addPreconnects()

```javascript
addPreconnects()
```

* Add preconnect for external domains

---

## optimize()

```javascript
optimize()
```

* Run all optimizations

---

## export function initializeCriticalPath(options =

```javascript
export function initializeCriticalPath(options =
```

* Initialize all optimizations

---

## export default

```javascript
export default
```

* Export default object

---

