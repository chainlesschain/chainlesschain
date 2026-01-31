# initializer-factory

**Source**: `src\main\bootstrap\initializer-factory.js`

**Generated**: 2026-01-27T06:44:03.869Z

---

## const

```javascript
const
```

* 初始化器工厂
 * 统一管理所有模块的初始化逻辑，提供并行初始化和错误恢复能力
 *
 * @module bootstrap/initializer-factory

---

## class InitializerFactory

```javascript
class InitializerFactory
```

* 初始化结果
 * @typedef {Object} InitResult
 * @property {boolean} success - 是否成功
 * @property {string} name - 模块名称
 * @property {number} duration - 耗时(ms)
 * @property {Error} [error] - 错误信息
 * @property {*} [instance] - 初始化的实例

---

## class InitializerFactory

```javascript
class InitializerFactory
```

* 初始化器配置
 * @typedef {Object} InitializerConfig
 * @property {string} name - 模块名称
 * @property {Function} init - 初始化函数
 * @property {boolean} [required] - 是否必需（失败时是否阻止启动）
 * @property {string[]} [dependsOn] - 依赖的模块名称
 * @property {boolean} [lazy] - 是否懒加载

---

## this.initializers = new Map();

```javascript
this.initializers = new Map();
```

@type {Map<string, InitializerConfig>}

---

## this.results = new Map();

```javascript
this.results = new Map();
```

@type {Map<string, InitResult>}

---

## this.instances =

```javascript
this.instances =
```

@type {Object}

---

## this.progressCallback = null;

```javascript
this.progressCallback = null;
```

@type {Function}

---

## setProgressCallback(callback)

```javascript
setProgressCallback(callback)
```

* 设置进度回调
   * @param {Function} callback - (message: string, progress: number) => void

---

## updateProgress(message, progress)

```javascript
updateProgress(message, progress)
```

* 更新进度
   * @param {string} message - 进度消息
   * @param {number} progress - 进度百分比

---

## register(config)

```javascript
register(config)
```

* 注册初始化器
   * @param {InitializerConfig} config - 初始化器配置

---

## registerAll(configs)

```javascript
registerAll(configs)
```

* 批量注册初始化器
   * @param {InitializerConfig[]} configs - 初始化器配置数组

---

## async runOne(name, context =

```javascript
async runOne(name, context =
```

* 执行单个初始化器
   * @param {string} name - 模块名称
   * @param {Object} context - 上下文对象，包含依赖实例
   * @returns {Promise<InitResult>}

---

## async runParallel(names, context =

```javascript
async runParallel(names, context =
```

* 并行执行一组初始化器
   * @param {string[]} names - 模块名称数组
   * @param {Object} context - 上下文对象
   * @returns {Promise<InitResult[]>}

---

## async runAll(context =

```javascript
async runAll(context =
```

* 按依赖顺序执行所有初始化器
   * @param {Object} context - 上下文对象
   * @returns {Promise<Map<string, InitResult>>}

---

## async runPhased(phases, context =

```javascript
async runPhased(phases, context =
```

* 执行分阶段初始化
   * @param {Array<{name: string, modules: string[], progress: number}>} phases - 阶段配置
   * @param {Object} context - 上下文对象
   * @returns {Promise<Map<string, InitResult>>}

---

## getResult(name)

```javascript
getResult(name)
```

* 获取初始化结果
   * @param {string} name - 模块名称
   * @returns {InitResult|undefined}

---

## getInstance(name)

```javascript
getInstance(name)
```

* 获取已初始化的实例
   * @param {string} name - 模块名称
   * @returns {*}

---

## getAllInstances()

```javascript
getAllInstances()
```

* 获取所有已初始化的实例
   * @returns {Object}

---

## printStats()

```javascript
printStats()
```

* 打印初始化统计

---

## reset()

```javascript
reset()
```

* 重置所有状态

---

