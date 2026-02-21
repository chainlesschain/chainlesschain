# project-config

**Source**: `src/main/project/project-config.js`

**Generated**: 2026-02-21T22:04:25.798Z

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

