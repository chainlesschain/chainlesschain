# advanced-features-ipc

**Source**: `src/main/ipc/advanced-features-ipc.js`

---

## const

```javascript
const
```

* 高级特性 IPC 处理程序
 * 将三大高级特性集成到主应用的IPC系统

---

## executeScript(script, args = [])

```javascript
executeScript(script, args = [])
```

* 执行脚本命令

---

## _sanitizeDays(days, fallback = 7)

```javascript
_sanitizeDays(days, fallback = 7)
```

* 获取总览数据

---

## _sanitizeDays(days, fallback = 7)

```javascript
_sanitizeDays(days, fallback = 7)
```

* 把 renderer 传入的 `days` 时间窗强制成安全的有界正整数。
   * 防止 datetime('now', '-N days') SQL sink 注入，以及 spawn `--days` 参数注入。
   * 非法/越界输入回退到默认值。
   * @param {*} days
   * @param {number} [fallback=7]
   * @returns {number} [1, 3650] 区间内的整数

---

## async getThresholdHistory(limit)

```javascript
async getThresholdHistory(limit)
```

* 获取阈值调整历史

---

## async getConfig()

```javascript
async getConfig()
```

* 获取配置

---

## async saveConfig(config)

```javascript
async saveConfig(config)
```

* 保存配置

---

## async getLogs(options =

```javascript
async getLogs(options =
```

* 获取日志

---

## async openControlPanel()

```javascript
async openControlPanel()
```

* 打开控制面板

---

## getDatabase()

```javascript
getDatabase()
```

* 获取数据库连接

---

