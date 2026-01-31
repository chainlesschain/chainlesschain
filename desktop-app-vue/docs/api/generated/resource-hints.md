# resource-hints

**Source**: `src\renderer\utils\resource-hints.js`

**Generated**: 2026-01-27T06:44:03.894Z

---

## export function dnsPrefetch(domain)

```javascript
export function dnsPrefetch(domain)
```

* Resource Hints Utility
 * 资源提示工具
 *
 * Features:
 * - DNS Prefetch (DNS预解析)
 * - Preconnect (预连接)
 * - Prefetch (预加载)
 * - Preload (预加载关键资源)
 * - Prerender (预渲染)
 *
 * @see https://www.w3.org/TR/resource-hints/

---

## export function dnsPrefetch(domain)

```javascript
export function dnsPrefetch(domain)
```

* Add DNS prefetch hint
 * 添加DNS预解析提示
 *
 * @param {string} domain - Domain to prefetch

---

## export function preconnect(url, crossOrigin = false)

```javascript
export function preconnect(url, crossOrigin = false)
```

* Add preconnect hint
 * 添加预连接提示
 *
 * @param {string} url - URL to preconnect
 * @param {boolean} crossOrigin - Whether cross-origin

---

## export function prefetch(url, as = '')

```javascript
export function prefetch(url, as = '')
```

* Add prefetch hint
 * 添加预加载提示（低优先级）
 *
 * @param {string} url - URL to prefetch
 * @param {string} as - Resource type

---

## export function preload(url, as, options =

```javascript
export function preload(url, as, options =
```

* Add preload hint
 * 添加预加载提示（高优先级）
 *
 * @param {string} url - URL to preload
 * @param {string} as - Resource type (required)
 * @param {Object} options - Additional options

---

## export function prerender(url)

```javascript
export function prerender(url)
```

* Add prerender hint
 * 添加预渲染提示
 *
 * @param {string} url - URL to prerender

---

## export function modulePreload(url)

```javascript
export function modulePreload(url)
```

* Add modulepreload hint
 * 添加ES模块预加载提示
 *
 * @param {string} url - Module URL to preload

---

## export function batchAddHints(hints)

```javascript
export function batchAddHints(hints)
```

* Batch add resource hints
 * 批量添加资源提示
 *
 * @param {Array} hints - Array of hint configs

---

## export function removeHint(rel, href)

```javascript
export function removeHint(rel, href)
```

* Remove resource hint
 * 移除资源提示
 *
 * @param {string} rel - Hint type
 * @param {string} href - URL

---

## export function clearHintsByType(rel)

```javascript
export function clearHintsByType(rel)
```

* Clear all hints of a specific type
 * 清除特定类型的所有提示
 *
 * @param {string} rel - Hint type

---

## export function preloadRouteResources(route, resources =

```javascript
export function preloadRouteResources(route, resources =
```

* Preload critical resources for route
 * 为路由预加载关键资源
 *
 * @param {string} route - Route path
 * @param {Object} resources - Resources to preload

---

## export function setupCommonHints()

```javascript
export function setupCommonHints()
```

* Setup common resource hints
 * 设置常用资源提示

---

## export class IntelligentPrefetcher

```javascript
export class IntelligentPrefetcher
```

* Intelligent prefetch based on user behavior
 * 基于用户行为的智能预取

---

## observe(element, url, as = 'fetch')

```javascript
observe(element, url, as = 'fetch')
```

* Observe element for viewport prefetch

---

## onHover(element, url, as = 'fetch')

```javascript
onHover(element, url, as = 'fetch')
```

* Setup hover prefetch

---

## addToQueue(url, as, priority = 'low')

```javascript
addToQueue(url, as, priority = 'low')
```

* Add to prefetch queue

---

## async processQueue()

```javascript
async processQueue()
```

* Process prefetch queue

---

## destroy()

```javascript
destroy()
```

* Destroy

---

