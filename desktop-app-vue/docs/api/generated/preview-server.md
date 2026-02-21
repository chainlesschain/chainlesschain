# preview-server

**Source**: `src/main/engines/preview-server.js`

**Generated**: 2026-02-21T22:04:25.837Z

---

## const

```javascript
const
```

* 本地预览服务器
 * 提供Web项目的本地预览功能

---

## async start(projectPath, port = 3000)

```javascript
async start(projectPath, port = 3000)
```

* 启动预览服务器
   * @param {string} projectPath - 项目根路径
   * @param {number} port - 端口号(可选)
   * @returns {Promise<Object>} 服务器信息

---

## async stop()

```javascript
async stop()
```

* 停止预览服务器
   * @returns {Promise<Object>}

---

## async restart(projectPath = null)

```javascript
async restart(projectPath = null)
```

* 重启预览服务器
   * @param {string} projectPath - 项目路径(可选)
   * @returns {Promise<Object>}

---

## generateDirectoryListing(directoryPath)

```javascript
generateDirectoryListing(directoryPath)
```

* 生成目录列表HTML
   * @param {string} directoryPath - 目录路径
   * @returns {string} HTML内容
   * @private

---

## getStatus()

```javascript
getStatus()
```

* 获取服务器状态
   * @returns {Object} 状态信息

---

## async changePort(newPort)

```javascript
async changePort(newPort)
```

* 更改端口
   * @param {number} newPort - 新端口号
   * @returns {Promise<Object>}

---

