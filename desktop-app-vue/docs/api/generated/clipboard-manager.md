# clipboard-manager

**Source**: `src/main/browser/actions/clipboard-manager.js`

**Generated**: 2026-02-15T10:10:53.440Z

---

## const

```javascript
const
```

* ClipboardManager - 剪贴板管理器
 *
 * 高级剪贴板操作：
 * - 文本/图片/HTML 复制粘贴
 * - 剪贴板历史记录
 * - 跨标签页剪贴板同步
 * - 敏感内容过滤
 *
 * @module browser/actions/clipboard-manager
 * @author ChainlessChain Team
 * @since v0.33.0

---

## const ClipboardType =

```javascript
const ClipboardType =
```

* 剪贴板内容类型

---

## const SENSITIVE_PATTERNS = [

```javascript
const SENSITIVE_PATTERNS = [
```

* 敏感内容模式

---

## constructor(browserEngine = null, config =

```javascript
constructor(browserEngine = null, config =
```

* @param {Object} browserEngine - Browser engine instance
   * @param {Object} config - Configuration options
   * @param {Object} [dependencies] - Optional dependency injection for testing

---

## setBrowserEngine(browserEngine)

```javascript
setBrowserEngine(browserEngine)
```

* 设置浏览器引擎
   * @param {Object} browserEngine

---

## copyText(text, options =

```javascript
copyText(text, options =
```

* 复制文本到剪贴板
   * @param {string} text - 文本内容
   * @param {Object} options - 选项
   * @returns {Object}

---

## copyHTML(html, fallbackText = "")

```javascript
copyHTML(html, fallbackText = "")
```

* 复制 HTML 到剪贴板
   * @param {string} html - HTML 内容
   * @param {string} fallbackText - 纯文本回退
   * @returns {Object}

---

## copyImage(imageData)

```javascript
copyImage(imageData)
```

* 复制图片到剪贴板
   * @param {string|Buffer} imageData - 图片数据（base64 或 Buffer）
   * @returns {Object}

---

## async copyFromElement(targetId, selector, options =

```javascript
async copyFromElement(targetId, selector, options =
```

* 从页面元素复制
   * @param {string} targetId - 标签页 ID
   * @param {string} selector - 元素选择器
   * @param {Object} options - 选项
   * @returns {Promise<Object>}

---

## read(type = null)

```javascript
read(type = null)
```

* 读取剪贴板内容
   * @param {string} type - 内容类型
   * @returns {Object}

---

## async pasteToElement(targetId, selector, options =

```javascript
async pasteToElement(targetId, selector, options =
```

* 粘贴到页面元素
   * @param {string} targetId - 标签页 ID
   * @param {string} selector - 元素选择器
   * @param {Object} options - 选项
   * @returns {Promise<Object>}

---

## async simulatePaste(targetId)

```javascript
async simulatePaste(targetId)
```

* 模拟键盘粘贴
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>}

---

## clear()

```javascript
clear()
```

* 清空剪贴板
   * @returns {Object}

---

## getFormats()

```javascript
getFormats()
```

* 获取可用格式
   * @returns {Array}

---

## getHistory(limit = 20)

```javascript
getHistory(limit = 20)
```

* 获取历史记录
   * @param {number} limit - 返回数量
   * @returns {Array}

---

## restoreFromHistory(index)

```javascript
restoreFromHistory(index)
```

* 从历史记录恢复
   * @param {number} index - 历史索引
   * @returns {Object}

---

## clearHistory()

```javascript
clearHistory()
```

* 清除历史

---

## _checkSensitive(text)

```javascript
_checkSensitive(text)
```

* 检查敏感内容
   * @private

---

## _stripHTML(html)

```javascript
_stripHTML(html)
```

* 去除 HTML 标签
   * @private

---

## _recordHistory(entry)

```javascript
_recordHistory(entry)
```

* 记录历史
   * @private

---

## _updateStats(type, action)

```javascript
_updateStats(type, action)
```

* 更新统计
   * @private

---

## _startSync()

```javascript
_startSync()
```

* 启动同步
   * @private

---

## stopSync()

```javascript
stopSync()
```

* 停止同步

---

## getStats()

```javascript
getStats()
```

* 获取统计
   * @returns {Object}

---

## resetStats()

```javascript
resetStats()
```

* 重置统计

---

## cleanup()

```javascript
cleanup()
```

* 清理

---

