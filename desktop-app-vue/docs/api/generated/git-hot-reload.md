# git-hot-reload

**Source**: `src/main/git/git-hot-reload.js`

**Generated**: 2026-02-15T08:42:37.238Z

---

## const chokidar = require('chokidar');

```javascript
const chokidar = require('chokidar');
```

* Git Hot Reload Module
 * 监听Git仓库文件变化，实时通知前端更新
 *
 * 功能：
 * - 监听仓库文件变化（使用chokidar）
 * - 防抖处理，避免频繁触发
 * - 自动检测Git状态变化
 * - 通知前端更新UI

---

## gitLog('GitHotReload', '初始化Git热重载模块');

```javascript
gitLog('GitHotReload', '初始化Git热重载模块');
```

',
      '*

---

## gitLog('GitHotReload', '初始化Git热重载模块');

```javascript
gitLog('GitHotReload', '初始化Git热重载模块');
```

',
      '*

---

## start()

```javascript
start()
```

* 启动文件监听

---

## async stop()

```javascript
async stop()
```

* 停止文件监听

---

## handleFileChange(eventType, filePath)

```javascript
handleFileChange(eventType, filePath)
```

* 处理文件变化
   * @param {string} eventType - 事件类型 (add/change/unlink)
   * @param {string} filePath - 文件路径

---

## scheduleStatusCheck()

```javascript
scheduleStatusCheck()
```

* 调度状态检查（防抖）

---

## async checkGitStatus()

```javascript
async checkGitStatus()
```

* 检查Git状态并通知变化

---

## hasStatusChanged(oldStatus, newStatus)

```javascript
hasStatusChanged(oldStatus, newStatus)
```

* 比较两个状态是否有变化
   * @param {Object} oldStatus - 旧状态
   * @param {Object} newStatus - 新状态
   * @returns {boolean}

---

## setupGitManagerListeners()

```javascript
setupGitManagerListeners()
```

* 设置Git管理器事件监听

---

## async refresh()

```javascript
async refresh()
```

* 手动触发状态检查

---

## setEnabled(enabled)

```javascript
setEnabled(enabled)
```

* 启用/禁用热重载
   * @param {boolean} enabled

---

## setDebounceDelay(delay)

```javascript
setDebounceDelay(delay)
```

* 设置防抖延迟
   * @param {number} delay - 延迟时间（毫秒）

---

## getStatus()

```javascript
getStatus()
```

* 获取监听状态
   * @returns {Object}

---

