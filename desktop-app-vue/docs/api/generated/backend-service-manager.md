# backend-service-manager

**Source**: `src/main/api/backend-service-manager.js`

**Generated**: 2026-04-24T14:08:13.872Z

---

## const

```javascript
const
```

* Backend Service Manager
 * 管理桌面应用的后端服务（PostgreSQL, Redis, Qdrant, Project Service）
 * 仅在生产环境（打包后）自动启动和管理这些服务

---

## ensureDirectories()

```javascript
ensureDirectories()
```

* 确保必要的目录存在

---

## async isPortInUse(port)

```javascript
async isPortInUse(port)
```

* 检查端口是否被占用

---

## async checkService(name, port)

```javascript
async checkService(name, port)
```

* 检查服务是否正在运行

---

## async startServices()

```javascript
async startServices()
```

* 启动所有后端服务
   * 注：本方法只负责触发启动，**不阻塞**等待服务完全就绪。
   * 若调用方需要确认服务就绪，可 await this.servicesReady。

---

## async startIndividualServices()

```javascript
async startIndividualServices()
```

* 单独启动各个服务（备用方案）

---

## async waitForServices()

```javascript
async waitForServices()
```

* 等待服务启动完成（4 个服务**并行**轮询）
   * 单个服务最多等待 maxRetries * retryDelay 毫秒，4 个服务总耗时 = 最慢的那一个

---

## async stopServices()

```javascript
async stopServices()
```

* 停止所有后端服务

---

## async killServiceProcesses()

```javascript
async killServiceProcesses()
```

* 强制终止服务进程

---

## async getServicesStatus()

```javascript
async getServicesStatus()
```

* 获取服务状态

---

## async restartServices()

```javascript
async restartServices()
```

* 重启服务

---

