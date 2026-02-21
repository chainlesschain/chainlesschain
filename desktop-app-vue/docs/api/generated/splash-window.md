# splash-window

**Source**: `src/main/splash/splash-window.js`

**Generated**: 2026-02-21T20:04:16.199Z

---

## const

```javascript
const
```

* Splash Window Manager
 * 启动画面窗口管理器
 *
 * 在应用启动时显示一个轻量级的启动画面，展示启动进度和状态

---

## async create()

```javascript
async create()
```

* 创建 Splash 窗口
   * @returns {Promise<boolean>} 是否创建成功

---

## updateProgress(step, percentage)

```javascript
updateProgress(step, percentage)
```

* 更新进度
   * @param {string} step - 当前步骤描述
   * @param {number} percentage - 进度百分比 (0-100)

---

## showError(message)

```javascript
showError(message)
```

* 显示错误信息
   * @param {string} message - 错误信息

---

## close(fadeOut = true)

```javascript
close(fadeOut = true)
```

* 关闭 Splash 窗口
   * @param {boolean} fadeOut - 是否使用淡出效果

---

## isActive()

```javascript
isActive()
```

* 检查窗口是否存在
   * @returns {boolean}

---

