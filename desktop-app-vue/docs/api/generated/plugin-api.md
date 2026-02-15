# plugin-api

**Source**: `src/main/plugins/plugin-api.js`

**Generated**: 2026-02-15T07:37:13.802Z

---

## class PluginAPI

```javascript
class PluginAPI
```

* PluginAPI - 插件API接口层
 *
 * 职责：
 * - 为插件提供安全的API访问
 * - 权限检查和API调用代理
 * - API调用统计和限流

---

## buildAPI()

```javascript
buildAPI()
```

* 构建插件可访问的API对象
   * @returns {Object} API对象

---

## buildDatabaseAPI()

```javascript
buildDatabaseAPI()
```

* 数据库API

---

## buildLLMAPI()

```javascript
buildLLMAPI()
```

* LLM API

---

## buildRAGAPI()

```javascript
buildRAGAPI()
```

* RAG API

---

## buildUIAPI()

```javascript
buildUIAPI()
```

* UI API

---

## buildFileAPI()

```javascript
buildFileAPI()
```

* 文件API

---

## buildNetworkAPI()

```javascript
buildNetworkAPI()
```

* 网络API

---

## buildSystemAPI()

```javascript
buildSystemAPI()
```

* 系统API

---

## buildStorageAPI()

```javascript
buildStorageAPI()
```

* 存储API（插件专用键值存储）

---

## buildUtilsAPI()

```javascript
buildUtilsAPI()
```

* 工具API

---

## createSecureMethod(permission, fn)

```javascript
createSecureMethod(permission, fn)
```

* 创建带权限检查的安全方法
   * @param {string} permission - 需要的权限
   * @param {Function} fn - 实际执行的函数
   * @returns {Function} 安全包装的函数

---

## getSafePath(baseDir, filePath)

```javascript
getSafePath(baseDir, filePath)
```

* 获取安全路径（防止路径穿越）
   * @param {string} baseDir - 基础目录
   * @param {string} filePath - 文件路径
   * @returns {string} 安全的绝对路径

---

## updateStats(methodName)

```javascript
updateStats(methodName)
```

* 更新API调用统计
   * @param {string} methodName - 方法名

---

## async logAPICall(methodName, permission, success, duration, error = "")

```javascript
async logAPICall(methodName, permission, success, duration, error = "")
```

* 记录API调用日志
   * @param {string} methodName - 方法名
   * @param {string} permission - 权限
   * @param {boolean} success - 是否成功
   * @param {number} duration - 耗时（毫秒）
   * @param {string} error - 错误信息

---

## getStats()

```javascript
getStats()
```

* 获取API统计信息
   * @returns {Object} 统计信息

---

## getAPI()

```javascript
getAPI()
```

* 获取API对象（供沙箱使用）
   * @returns {Object} API对象

---

