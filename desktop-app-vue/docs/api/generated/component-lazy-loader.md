# component-lazy-loader

**Source**: `src\renderer\utils\component-lazy-loader.js`

**Generated**: 2026-01-27T06:44:03.901Z

---

## import

```javascript
import
```

* Component Lazy Loading Utility
 * 组件懒加载工具，支持动态导入、预加载、错误重试
 *
 * Features:
 * - Dynamic import { logger, createLogger } from '@/utils/logger';
import with code splitting
 * - Component preloading
 * - Automatic retry on failure
 * - Loading and error states
 * - Route-level lazy loading
 * - Prefetch on hover/visibility

---

## createLazyComponent(importFn, options =

```javascript
createLazyComponent(importFn, options =
```

* Create lazy component with retry logic
   * @param {Function} importFn - Dynamic import function
   * @param {Object} options - Component options
   * @returns {Component} Vue async component

---

## async loadWithRetry(importFn, retryCount = 0)

```javascript
async loadWithRetry(importFn, retryCount = 0)
```

* Load component with retry mechanism

---

## async prefetch(importFn)

```javascript
async prefetch(importFn)
```

* Prefetch component (load in background)
   * @param {Function} importFn - Dynamic import function

---

## prefetchOnHover(importFn)

```javascript
prefetchOnHover(importFn)
```

* Prefetch on hover
   * @param {Function} importFn - Dynamic import function
   * @returns {Object} Event handlers

---

## prefetchOnVisible(element, importFn)

```javascript
prefetchOnVisible(element, importFn)
```

* Prefetch on visibility (Intersection Observer)
   * @param {HTMLElement} element - Element to observe
   * @param {Function} importFn - Dynamic import function

---

## createLazyRoutes(routes)

```javascript
createLazyRoutes(routes)
```

* Create route-level lazy components
   * @param {Array} routes - Route configurations
   * @returns {Array} Routes with lazy components

---

## preloadRoutes(routePaths)

```javascript
preloadRoutes(routePaths)
```

* Preload critical routes
   * @param {Array} routePaths - Route paths to preload

---

## getDefaultLoadingComponent()

```javascript
getDefaultLoadingComponent()
```

* Get default loading component

---

## getDefaultErrorComponent()

```javascript
getDefaultErrorComponent()
```

* Get default error component

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

* Delay utility

---

## getStats()

```javascript
getStats()
```

* Get statistics

---

## clearCache()

```javascript
clearCache()
```

* Clear cache

---

## destroy()

```javascript
destroy()
```

* Destroy

---

## export function getComponentLazyLoader(options)

```javascript
export function getComponentLazyLoader(options)
```

* Get or create component lazy loader instance

---

## export function lazyComponent(importFn, options)

```javascript
export function lazyComponent(importFn, options)
```

* Convenience function: create lazy component

---

## export function lazyRoutes(routes)

```javascript
export function lazyRoutes(routes)
```

* Convenience function: create lazy routes

---

