# code-splitting

**Source**: `src\renderer\utils\code-splitting.js`

**Generated**: 2026-01-27T06:44:03.901Z

---

## import

```javascript
import
```

* Advanced Code Splitting Utilities
 * 高级代码分割工具
 *
 * Features:
 * - Smart component lazy loading with retry
 * - Prefetch on hover/viewport
 * - Loading error handling with fallback
 * - Chunk name generation for better debugging
 * - Bundle size tracking

---

## export function lazyLoad(loader, options =

```javascript
export function lazyLoad(loader, options =
```

* Create a lazy-loaded component with advanced features
 * 创建具有高级功能的懒加载组件
 *
 * @param {Function} loader - Component loader function
 * @param {Object} options - Options
 * @returns {Component}

---

## export function lazyRoute(loader, options =

```javascript
export function lazyRoute(loader, options =
```

* Create lazy route component
 * 创建懒加载路由组件
 *
 * @param {Function} loader - Component loader
 * @param {Object} options - Options
 * @returns {Component}

---

## export function prefetchComponent(loader, chunkName = 'component')

```javascript
export function prefetchComponent(loader, chunkName = 'component')
```

* Prefetch component
 * 预取组件
 *
 * @param {Function} loader - Component loader
 * @param {string} chunkName - Chunk name

---

## export function createRouteGroup(groupName, routes)

```javascript
export function createRouteGroup(groupName, routes)
```

* Create route group with shared chunk
 * 创建共享chunk的路由组
 *
 * @param {string} groupName - Group name
 * @param {Object} routes - Routes in group
 * @returns {Object}

---

## export function trackBundleSize(chunkName, size)

```javascript
export function trackBundleSize(chunkName, size)
```

* Analyze bundle size (development only)
 * 分析bundle大小（仅开发环境）
 *
 * @param {string} chunkName - Chunk name
 * @param {number} size - Size in bytes

---

## export function getBundleSizeReport()

```javascript
export function getBundleSizeReport()
```

* Get bundle size report
 * 获取bundle大小报告
 *
 * @returns {Object}

---

## export function smartLoad(loader, options =

```javascript
export function smartLoad(loader, options =
```

* Smart component loader with prefetch on interaction
 * 智能组件加载器（交互时预取）
 *
 * @param {Function} loader - Component loader
 * @param {Object} options - Options
 * @returns {Object}

---

## export class ProgressiveLoader

```javascript
export class ProgressiveLoader
```

* Progressive loading helper
 * 渐进式加载辅助函数
 *
 * Load components in priority order

---

## add(loader, priority = 'normal', chunkName = 'component')

```javascript
add(loader, priority = 'normal', chunkName = 'component')
```

* Add component to load queue

---

## async processQueue()

```javascript
async processQueue()
```

* Process load queue

---

## clear()

```javascript
clear()
```

* Clear queue

---

## export default

```javascript
export default
```

* Export default object

---

