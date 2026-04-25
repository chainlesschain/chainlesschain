# project-config

**Source**: `src/main/project/project-config.js`

---

## class ProjectConfig

```javascript
class ProjectConfig
```

* 项目配置管理器
 * 管理项目存储根路径等配置

---

## initialize()

```javascript
initialize()
```

* 初始化配置

---

## loadConfig()

```javascript
loadConfig()
```

* 加载配置文件

---

## async initializeAsync()

```javascript
async initializeAsync()
```

* 异步初始化配置 (M2: 启动期 IO 异步化)

---

## async loadConfigAsync()

```javascript
async loadConfigAsync()
```

* 异步加载配置文件 (M2)

---

## async saveConfigAsync()

```javascript
async saveConfigAsync()
```

* 异步保存配置文件 (M2)

---

## getDefaultConfig()

```javascript
getDefaultConfig()
```

* 获取默认配置

---

## saveConfig()

```javascript
saveConfig()
```

* 保存配置文件

---

## getProjectsRootPath()

```javascript
getProjectsRootPath()
```

* 获取项目根路径

---

## setProjectsRootPath(newPath)

```javascript
setProjectsRootPath(newPath)
```

* 设置项目根路径

---

## resolveProjectPath(relativePath)

```javascript
resolveProjectPath(relativePath)
```

* 将相对路径转换为绝对路径
   * @param {string} relativePath - 相对路径（如 /data/projects/xxx）
   * @returns {string} 绝对路径

---

## isLocalPath(filePath)

```javascript
isLocalPath(filePath)
```

* 检查路径是否为本地路径（而非远程服务器路径）

---

## getAllConfig()

```javascript
getAllConfig()
```

* 获取所有配置

---

## updateConfig(updates)

```javascript
updateConfig(updates)
```

* 更新配置

---

## async function getProjectConfigAsync()

```javascript
async function getProjectConfigAsync()
```

* 异步获取/初始化单例 (M2: 启动期 IO 异步化)
 * 启动路径调用此函数，避免阻塞事件循环。

---

