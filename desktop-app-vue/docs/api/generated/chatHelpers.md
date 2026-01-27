# chatHelpers

**Source**: `src\renderer\utils\chatHelpers.js`

**Generated**: 2026-01-27T06:44:03.901Z

---

## import

```javascript
import
```

* Chat 相关工具函数
 * 从 ChatPanel.vue 提取，供多个子组件复用

---

## export const sanitizeJSONString = (jsonString) =>

```javascript
export const sanitizeJSONString = (jsonString) =>
```

* 清理JSON字符串中的控制字符（用于修复无效JSON）
 * 注意：不能转义结构性空白（换行、制表符），只移除有害的控制字符
 * @param {string} jsonString - 原始JSON字符串
 * @returns {string} 清理后的JSON字符串

---

## export const cleanForIPC = (obj) =>

```javascript
export const cleanForIPC = (obj) =>
```

* 清理对象，移除不可序列化的内容（用于IPC传输）
 * @param {any} obj - 要清理的对象
 * @returns {any} 清理后的对象

---

## export const renderMarkdown = (content) =>

```javascript
export const renderMarkdown = (content) =>
```

* 渲染 Markdown 为 HTML
 * @param {string|object} content - Markdown 内容
 * @returns {string} HTML 字符串

---

## export const formatTime = (timestamp) =>

```javascript
export const formatTime = (timestamp) =>
```

* 格式化时间为友好显示
 * @param {number|string|Date} timestamp - 时间戳
 * @returns {string} 格式化后的时间字符串

---

## export const getEmptyStateText = (contextMode) =>

```javascript
export const getEmptyStateText = (contextMode) =>
```

* 获取空状态文本
 * @param {string} contextMode - 上下文模式 (project|file|global)
 * @returns {string} 空状态文本

---

## export const getEmptyHint = (contextMode, currentFile) =>

```javascript
export const getEmptyHint = (contextMode, currentFile) =>
```

* 获取空状态提示
 * @param {string} contextMode - 上下文模式
 * @param {object} currentFile - 当前文件对象
 * @returns {string} 空状态提示文本

---

## export const getInputPlaceholder = (contextMode, currentFile) =>

```javascript
export const getInputPlaceholder = (contextMode, currentFile) =>
```

* 获取输入框占位符文本
 * @param {string} contextMode - 上下文模式
 * @param {object} currentFile - 当前文件对象
 * @returns {string} 占位符文本

---

## export const getContextInfo = (contextMode, currentFile) =>

```javascript
export const getContextInfo = (contextMode, currentFile) =>
```

* 获取上下文信息文本
 * @param {string} contextMode - 上下文模式
 * @param {object} currentFile - 当前文件对象
 * @returns {string} 上下文信息文本

---

