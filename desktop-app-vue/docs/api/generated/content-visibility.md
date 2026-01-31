# content-visibility

**Source**: `src\renderer\utils\content-visibility.js`

**Generated**: 2026-01-27T06:44:03.901Z

---

## export const contentVisibilityDirective =

```javascript
export const contentVisibilityDirective =
```

* Content Visibility Lazy Rendering Utilities
 * Content-Visibility 懒渲染工具
 *
 * 使用 CSS content-visibility 属性优化渲染性能
 * 不在视口中的元素跳过渲染，大幅提升初始加载速度
 *
 * Features:
 * - Auto content-visibility directive
 * - Lazy render component wrapper
 * - Render budget management
 * - Performance tracking

---

## export const contentVisibilityDirective =

```javascript
export const contentVisibilityDirective =
```

* Content Visibility 指令
 * v-content-visibility
 *
 * Usage:
 * <div v-content-visibility>...</div>
 * <div v-content-visibility="{ height: 500 }">...</div>

---

## export function createContentVisibilityDirective()

```javascript
export function createContentVisibilityDirective()
```

* Create content-visibility directive
 * 创建指令

---

## export const LazyRenderComponent =

```javascript
export const LazyRenderComponent =
```

* LazyRender component wrapper
 * 懒渲染组件包装器
 *
 * Usage:
 * <LazyRender :height="500">
 *   <ExpensiveComponent />
 * </LazyRender>

---

## export class RenderBudgetManager

```javascript
export class RenderBudgetManager
```

* Render Budget Manager
 * 渲染预算管理器
 *
 * Limits the number of expensive renders per frame

---

## schedule(renderFn, priority = 'normal')

```javascript
schedule(renderFn, priority = 'normal')
```

* Add render task to queue

---

## processQueue()

```javascript
processQueue()
```

* Process render queue

---

## shouldRenderMore()

```javascript
shouldRenderMore()
```

* Check if we should render more in this frame

---

## clear()

```javascript
clear()
```

* Clear queue

---

## getStatus()

```javascript
getStatus()
```

* Get queue status

---

## export function applyContentVisibility(element, options =

```javascript
export function applyContentVisibility(element, options =
```

* Apply content-visibility to element
 * 应用 content-visibility 到元素
 *
 * @param {HTMLElement} element - Target element
 * @param {Object} options - Options

---

## export function batchApplyContentVisibility(selector, options =

```javascript
export function batchApplyContentVisibility(selector, options =
```

* Batch apply content-visibility to multiple elements
 * 批量应用到多个元素
 *
 * @param {string} selector - CSS selector
 * @param {Object} options - Options

---

## export function isContentVisibilitySupported()

```javascript
export function isContentVisibilitySupported()
```

* Check browser support for content-visibility
 * 检查浏览器支持
 *
 * @returns {boolean}

---

## export function getContentVisibilityStats()

```javascript
export function getContentVisibilityStats()
```

* Get content-visibility stats
 * 获取统计信息
 *
 * @returns {Object}

---

## export default

```javascript
export default
```

* Export default object

---

