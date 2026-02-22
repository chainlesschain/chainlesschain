# blockchain-lazy-ipc

**Source**: `src/main/blockchain/blockchain-lazy-ipc.js`

**Generated**: 2026-02-22T01:23:36.755Z

---

## const

```javascript
const
```

* 区块链模块懒加载 IPC 包装器
 * 在首次访问时才初始化区块链模块，节省启动时间 5-10 秒

---

## async function ensureBlockchainInitialized(app)

```javascript
async function ensureBlockchainInitialized(app)
```

* 确保区块链模块已初始化
 * @param {Object} app - 应用实例
 * @returns {Promise<void>}

---

## function registerLazyBlockchainIPC(

```javascript
function registerLazyBlockchainIPC(
```

* 注册懒加载的区块链 IPC 处理器
 * @param {Object} options
 * @param {Object} options.app - 应用实例
 * @param {Object} options.database - 数据库实例
 * @param {Object} options.mainWindow - 主窗口实例

---

