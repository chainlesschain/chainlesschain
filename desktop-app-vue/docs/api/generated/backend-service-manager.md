# backend-service-manager

**Source**: `src/main/api/backend-service-manager.js`

**Generated**: 2026-02-16T13:44:34.685Z

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

* 等待服务启动完成

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

