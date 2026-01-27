# intelligent-prefetch

**Source**: `src\renderer\utils\intelligent-prefetch.js`

**Generated**: 2026-01-27T06:44:03.898Z

---

## class IntelligentPrefetchManager

```javascript
class IntelligentPrefetchManager
```

* Intelligent Prefetch Manager
 * 智能预取管理器 - 基于用户行为预测并预加载资源
 *
 * Features:
 * - Mouse hover prefetching
 * - Viewport intersection prefetching
 * - Idle time prefetching
 * - Network-aware prefetching (adapt to connection speed)
 * - Priority queue management
 * - Cache integration
 * - Machine learning-based predictions

---

## init()

```javascript
init()
```

* Initialize prefetch manager

---

## async prefetch(resource, options =

```javascript
async prefetch(resource, options =
```

* Prefetch a resource
   * @param {string|Function} resource - URL or loader function
   * @param {Object} options - Prefetch options

---

## addToQueue(item)

```javascript
addToQueue(item)
```

* Add to prefetch queue with priority

---

## async processQueue()

```javascript
async processQueue()
```

* Process prefetch queue

---

## async prefetchFetch(url)

```javascript
async prefetchFetch(url)
```

* Prefetch using fetch

---

## async prefetchImage(url)

```javascript
async prefetchImage(url)
```

* Prefetch image

---

## async prefetchScript(url)

```javascript
async prefetchScript(url)
```

* Prefetch script

---

## async prefetchStyle(url)

```javascript
async prefetchStyle(url)
```

* Prefetch stylesheet

---

## async prefetchComponent(loader)

```javascript
async prefetchComponent(loader)
```

* Prefetch Vue component

---

## enableHoverPrefetch(element, resource, options =

```javascript
enableHoverPrefetch(element, resource, options =
```

* Hover prefetching

---

## enableHoverPrefetch(element, resource, options =

```javascript
enableHoverPrefetch(element, resource, options =
```

* Enable hover prefetching for an element
   * @param {HTMLElement} element - Element to watch
   * @param {string|Function} resource - Resource to prefetch
   * @param {Object} options - Prefetch options

---

## enableViewportPrefetch(element, resource, options =

```javascript
enableViewportPrefetch(element, resource, options =
```

* Viewport intersection prefetching

---

## enableViewportPrefetch(element, resource, options =

```javascript
enableViewportPrefetch(element, resource, options =
```

* Enable viewport prefetching for an element
   * @param {HTMLElement} element - Element to watch
   * @param {string|Function} resource - Resource to prefetch
   * @param {Object} options - Prefetch options

---

## startIdlePrefetch()

```javascript
startIdlePrefetch()
```

* Idle time prefetching

---

## startIdlePrefetch()

```javascript
startIdlePrefetch()
```

* Start idle prefetching

---

## processIdleQueue(deadline)

```javascript
processIdleQueue(deadline)
```

* Process prefetch queue during idle time

---

## getNetworkInfo()

```javascript
getNetworkInfo()
```

* Network awareness

---

## getNetworkInfo()

```javascript
getNetworkInfo()
```

* Get current network information

---

## shouldPrefetch(priority)

```javascript
shouldPrefetch(priority)
```

* Check if should prefetch based on network

---

## adjustConcurrency()

```javascript
adjustConcurrency()
```

* Adjust concurrency based on network

---

## isDataSaverEnabled()

```javascript
isDataSaverEnabled()
```

* Check if data saver is enabled

---

## disable(element)

```javascript
disable(element)
```

* Disable prefetching for an element

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

* Destroy and cleanup

---

## export function getIntelligentPrefetchManager(options)

```javascript
export function getIntelligentPrefetchManager(options)
```

* Get or create intelligent prefetch manager instance

---

## export async function prefetch(resource, options)

```javascript
export async function prefetch(resource, options)
```

* Convenience function: prefetch a resource

---

## export function enableHoverPrefetch(element, resource, options)

```javascript
export function enableHoverPrefetch(element, resource, options)
```

* Convenience function: enable hover prefetch

---

## export function enableViewportPrefetch(element, resource, options)

```javascript
export function enableViewportPrefetch(element, resource, options)
```

* Convenience function: enable viewport prefetch

---

