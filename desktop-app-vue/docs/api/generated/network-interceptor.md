# network-interceptor

**Source**: `src/main/browser/actions/network-interceptor.js`

---

## const

```javascript
const
```

* NetworkInterceptor - 网络请求拦截和控制
 *
 * 支持：
 * - 请求拦截和修改
 * - 响应模拟
 * - 网络条件模拟（3G/4G/5G）
 * - 请求监听和日志
 * - WebSocket 拦截
 *
 * @module browser/actions/network-interceptor
 * @author ChainlessChain Team
 * @since v0.33.0

---

## const NetworkCondition =

```javascript
const NetworkCondition =
```

* 网络条件预设

---

## const InterceptType =

```javascript
const InterceptType =
```

* 请求拦截类型

---

## _getPage(targetId)

```javascript
_getPage(targetId)
```

* 获取页面对象
   * @private

---

## _generateRuleId()

```javascript
_generateRuleId()
```

* 生成规则 ID
   * @private

---

## addRule(rule)

```javascript
addRule(rule)
```

* 添加拦截规则
   * @param {Object} rule - 拦截规则
   * @param {string|RegExp} rule.urlPattern - URL 匹配模式
   * @param {string} rule.method - HTTP 方法（可选）
   * @param {string} rule.type - 拦截类型
   * @param {Object} rule.response - 模拟响应（type=fulfill/mock 时）
   * @param {Function} rule.handler - 自定义处理函数
   * @returns {string} 规则 ID

---

## removeRule(ruleId)

```javascript
removeRule(ruleId)
```

* 删除拦截规则
   * @param {string} ruleId - 规则 ID
   * @returns {boolean}

---

## clearRules()

```javascript
clearRules()
```

* 清除所有规则

---

## async enableInterception(targetId)

```javascript
async enableInterception(targetId)
```

* 在页面上启用拦截
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<void>}

---

## async disableInterception(targetId)

```javascript
async disableInterception(targetId)
```

* 禁用页面拦截
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<void>}

---

## _addToLog(entry)

```javascript
_addToLog(entry)
```

* 添加请求到日志
   * @private

---

## getRequestLog(filter =

```javascript
getRequestLog(filter =
```

* 获取请求日志
   * @param {Object} filter - 过滤选项
   * @returns {Array}

---

## clearRequestLog(targetId = null)

```javascript
clearRequestLog(targetId = null)
```

* 清除请求日志
   * @param {string} targetId - 标签页 ID（可选）

---

## async setNetworkCondition(targetId, condition)

```javascript
async setNetworkCondition(targetId, condition)
```

* 设置网络条件
   * @param {string} targetId - 标签页 ID
   * @param {Object|string} condition - 网络条件或预设名称
   * @returns {Promise<void>}

---

## async resetNetworkCondition(targetId)

```javascript
async resetNetworkCondition(targetId)
```

* 重置网络条件
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<void>}

---

## blockResourceTypes(targetId, resourceTypes)

```javascript
blockResourceTypes(targetId, resourceTypes)
```

* 阻止特定资源类型
   * @param {string} targetId - 标签页 ID
   * @param {Array<string>} resourceTypes - 资源类型列表
   * @returns {string} 规则 ID

---

## mockAPI(urlPattern, response)

```javascript
mockAPI(urlPattern, response)
```

* 模拟 API 响应
   * @param {string} urlPattern - URL 模式
   * @param {Object} response - 响应配置
   * @returns {string} 规则 ID

---

## async waitForRequest(targetId, urlPattern, options =

```javascript
async waitForRequest(targetId, urlPattern, options =
```

* 等待特定请求
   * @param {string} targetId - 标签页 ID
   * @param {string|RegExp} urlPattern - URL 模式
   * @param {Object} options - 等待选项
   * @returns {Promise<Object>}

---

## async waitForResponse(targetId, urlPattern, options =

```javascript
async waitForResponse(targetId, urlPattern, options =
```

* 等待特定响应
   * @param {string} targetId - 标签页 ID
   * @param {string|RegExp} urlPattern - URL 模式
   * @param {Object} options - 等待选项
   * @returns {Promise<Object>}

---

## getStatus()

```javascript
getStatus()
```

* 获取当前拦截状态
   * @returns {Object}

---

## async execute(targetId, options =

```javascript
async execute(targetId, options =
```

* 统一执行入口
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 操作选项
   * @returns {Promise<Object>}

---

