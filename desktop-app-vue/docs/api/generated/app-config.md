# app-config

**Source**: `src/main/config/app-config.js`

**Generated**: 2026-02-16T22:06:51.495Z

---

## class AppConfig

```javascript
class AppConfig
```

* 应用配置管理器
 * 统一管理所有应用配置，支持环境变量和配置文件

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

## getEnvConfig()

```javascript
getEnvConfig()
```

* 从环境变量获取配置

---

## mergeConfigs(...configs)

```javascript
mergeConfigs(...configs)
```

* 深度合并配置对象

---

## saveConfig()

```javascript
saveConfig()
```

* 保存配置文件

---

## getAllConfig()

```javascript
getAllConfig()
```

* 获取所有配置

---

## getConfig(category)

```javascript
getConfig(category)
```

* 获取特定配置

---

## updateConfig(updates)

```javascript
updateConfig(updates)
```

* 更新配置

---

## resetConfig()

```javascript
resetConfig()
```

* 重置为默认配置

---

## getProjectsRootPath()

```javascript
getProjectsRootPath()
```

* 获取项目根路径

---

## resolveProjectPath(relativePath)

```javascript
resolveProjectPath(relativePath)
```

* 解析项目路径（相对路径转绝对路径）

---

## exportToEnv(envPath)

```javascript
exportToEnv(envPath)
```

* 导出配置到 .env 文件

---

## generateEnvContent()

```javascript
generateEnvContent()
```

* 生成 .env 文件内容

---

