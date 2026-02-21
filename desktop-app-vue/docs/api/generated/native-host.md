# native-host

**Source**: `src/main/native-messaging/native-host.js`

**Generated**: 2026-02-21T22:45:05.277Z

---

## const fs = require('fs');

```javascript
const fs = require('fs');
```

* ChainlessChain Native Messaging Host
 * 浏览器扩展通过 Native Messaging 与桌面应用通信的桥梁

---

## function log(message)

```javascript
function log(message)
```

* 写日志

---

## function readMessage()

```javascript
function readMessage()
```

* 读取消息
 * Chrome Native Messaging 使用特殊的消息格式：
 * - 前 4 字节：消息长度（32位小端整数）
 * - 后续字节：JSON 消息内容

---

## function sendMessage(message)

```javascript
function sendMessage(message)
```

* 发送消息

---

## async function handleMessage(message)

```javascript
async function handleMessage(message)
```

* 处理消息

---

## async function clipPageToApp(data)

```javascript
async function clipPageToApp(data)
```

* 剪藏页面到桌面应用
 * 通过 HTTP 请求或 IPC Socket 与主进程通信

---

## async function main()

```javascript
async function main()
```

* 主函数

---

