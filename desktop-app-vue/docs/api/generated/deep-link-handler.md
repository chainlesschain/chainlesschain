# deep-link-handler

**Source**: `src\main\system\deep-link-handler.js`

**Generated**: 2026-01-27T06:44:03.801Z

---

## const

```javascript
const
```

* Deep Link Handler - 处理 chainlesschain:// 协议链接
 *
 * 功能:
 * - 注册自定义协议
 * - 解析邀请链接
 * - 触发邀请接受流程
 * - 处理其他深链接场景

---

## register(app)

```javascript
register(app)
```

* 注册协议处理器
   * @param {Electron.App} app - Electron app实例

---

## async handleDeepLink(urlString)

```javascript
async handleDeepLink(urlString)
```

* 处理深链接
   * @param {string} urlString - 深链接URL

---

## async handleInvitationLink(token)

```javascript
async handleInvitationLink(token)
```

* 处理邀请链接
   * @param {string} token - 邀请令牌

---

## async handleDIDLink(did)

```javascript
async handleDIDLink(did)
```

* 处理DID链接
   * @param {string} did - DID标识符

---

## async handleKnowledgeLink(knowledgeId)

```javascript
async handleKnowledgeLink(knowledgeId)
```

* 处理知识库链接
   * @param {string} knowledgeId - 知识库ID

---

## setMainWindow(mainWindow)

```javascript
setMainWindow(mainWindow)
```

* 设置主窗口引用
   * @param {Electron.BrowserWindow} mainWindow - 主窗口实例

---

## handleStartupUrl(argv)

```javascript
handleStartupUrl(argv)
```

* 处理启动时的协议URL (Windows/Linux)
   * @param {string[]} argv - 命令行参数

---

