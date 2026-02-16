# rpc-manager

**Source**: `src/main/blockchain/rpc-manager.js`

**Generated**: 2026-02-16T22:06:51.508Z

---

## const

```javascript
const
```

* RPC 提供商管理器
 *
 * 负责管理多个 RPC 节点，实现：
 * - 负载均衡
 * - 健康检查
 * - 自动故障转移
 * - 性能监控

---

## async initialize()

```javascript
async initialize()
```

* 初始化 RPC 管理器

---

## async measureLatency(provider)

```javascript
async measureLatency(provider)
```

* 测量节点延迟
   * @param {ethers.JsonRpcProvider} provider - 提供者
   * @returns {Promise<number>} 延迟（毫秒）

---

## getBestProvider()

```javascript
getBestProvider()
```

* 获取最佳节点
   * @returns {ethers.JsonRpcProvider} 提供者

---

## getNextProvider()

```javascript
getNextProvider()
```

* 获取下一个可用节点（轮询）
   * @returns {ethers.JsonRpcProvider} 提供者

---

## getHealthyNodes()

```javascript
getHealthyNodes()
```

* 获取健康节点列表
   * @returns {Array} 健康节点列表

---

## async executeWithFailover(requestFn, maxRetries = 3)

```javascript
async executeWithFailover(requestFn, maxRetries = 3)
```

* 执行带故障转移的请求
   * @param {Function} requestFn - 请求函数
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<any>} 请求结果

---

## startHealthCheck()

```javascript
startHealthCheck()
```

* 启动健康检查

---

## stopHealthCheck()

```javascript
stopHealthCheck()
```

* 停止健康检查

---

## async performHealthCheck()

```javascript
async performHealthCheck()
```

* 执行健康检查

---

## getNodeStats()

```javascript
getNodeStats()
```

* 获取节点统计信息
   * @returns {Array} 节点统计

---

## resetStats(url = null)

```javascript
resetStats(url = null)
```

* 重置节点统计
   * @param {string} url - 节点 URL（可选，不提供则重置所有）

---

## async addNode(url)

```javascript
async addNode(url)
```

* 添加新节点
   * @param {string} url - RPC URL

---

## async removeNode(url)

```javascript
async removeNode(url)
```

* 移除节点
   * @param {string} url - RPC URL

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

