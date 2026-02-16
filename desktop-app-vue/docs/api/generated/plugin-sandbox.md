# plugin-sandbox

**Source**: `src/main/plugins/plugin-sandbox.js`

**Generated**: 2026-02-16T13:44:34.632Z

---

## const

```javascript
const
```

* PluginSandbox - 插件沙箱
 *
 * 职责：
 * - 在隔离环境中执行插件代码
 * - 提供安全的global对象
 * - 超时控制和资源限制
 * - 生命周期钩子调用

---

## async load()

```javascript
async load()
```

* 加载插件代码
   * @returns {Promise<Object>} 插件实例

---

## createSandboxContext()

```javascript
createSandboxContext()
```

* 创建沙箱上下文
   * @returns {Object} 沙箱上下文

---

## createRequireFunction()

```javascript
createRequireFunction()
```

* 创建受限的require函数
   * @returns {Function} require函数

---

## validatePluginInterface()

```javascript
validatePluginInterface()
```

* 验证插件接口

---

## async callHook(hookName, ...args)

```javascript
async callHook(hookName, ...args)
```

* 调用插件钩子
   * @param {string} hookName - 钩子名称
   * @param {...any} args - 参数
   * @returns {Promise<any>} 钩子返回值

---

## async enable()

```javascript
async enable()
```

* 启用插件
   * @returns {Promise<void>}

---

## async disable()

```javascript
async disable()
```

* 禁用插件
   * @returns {Promise<void>}

---

## async unload()

```javascript
async unload()
```

* 卸载插件
   * @returns {Promise<void>}

---

## async callMethod(methodName, ...args)

```javascript
async callMethod(methodName, ...args)
```

* 调用插件方法
   * @param {string} methodName - 方法名
   * @param {...any} args - 参数
   * @returns {Promise<any>} 方法返回值

---

## getState()

```javascript
getState()
```

* 获取插件状态
   * @returns {string} 状态

---

## getInstance()

```javascript
getInstance()
```

* 获取插件实例
   * @returns {Object|null} 插件实例

---

## destroy()

```javascript
destroy()
```

* 销毁沙箱

---

