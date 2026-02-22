# preview-manager

**Source**: `src/main/preview/preview-manager.js`

**Generated**: 2026-02-22T01:23:36.693Z

---

## class PreviewManager extends EventEmitter

```javascript
class PreviewManager extends EventEmitter
```

* 预览管理器
 * 负责项目预览功能（静态服务器、开发服务器、文件管理器）

---

## async startStaticServer(projectId, rootPath, options =

```javascript
async startStaticServer(projectId, rootPath, options =
```

* 启动静态文件服务器
   * @param {string} projectId - 项目ID
   * @param {string} rootPath - 项目根路径
   * @param {Object} options - 选项
   * @returns {Object} { url, port }

---

## async stopStaticServer(projectId)

```javascript
async stopStaticServer(projectId)
```

* 停止静态文件服务器
   * @param {string} projectId - 项目ID

---

## async startDevServer(projectId, rootPath, command = "npm run dev")

```javascript
async startDevServer(projectId, rootPath, command = "npm run dev")
```

* 启动开发服务器（npm run dev）
   * @param {string} projectId - 项目ID
   * @param {string} rootPath - 项目根路径
   * @param {string} command - 启动命令（默认 'npm run dev'）
   * @returns {Object} { url, port, process }

---

## async stopDevServer(projectId)

```javascript
async stopDevServer(projectId)
```

* 停止开发服务器
   * @param {string} projectId - 项目ID

---

## async openInExplorer(rootPath)

```javascript
async openInExplorer(rootPath)
```

* 在文件管理器中打开项目
   * @param {string} rootPath - 项目根路径

---

## async openInBrowser(url)

```javascript
async openInBrowser(url)
```

* 在外部浏览器中打开URL
   * @param {string} url - URL地址

---

## getServerInfo(projectId)

```javascript
getServerInfo(projectId)
```

* 获取运行中的服务器信息
   * @param {string} projectId - 项目ID
   * @returns {Object|null} 服务器信息

---

## async stopAll()

```javascript
async stopAll()
```

* 停止所有服务器

---

