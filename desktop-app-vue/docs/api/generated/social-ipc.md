# social-ipc

**Source**: `src/main/social/social-ipc.js`

---

## import electron from "electron";

```javascript
import electron from "electron";
```

* Social IPC 处理器
 * 负责处理社交网络相关的前后端通信
 *
 * @module social-ipc
 * @description 提供联系人管理、好友关系、动态发布、聊天消息、群聊等社交功能的 IPC 接口

---

## function registerSocialIPC(

```javascript
function registerSocialIPC(
```

* 注册所有 Social IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.contactManager - 联系人管理器
 * @param {Object} dependencies.friendManager - 好友管理器
 * @param {Object} dependencies.postManager - 动态管理器
 * @param {Object} dependencies.database - 数据库管理器（用于聊天功能）
 * @param {Object} dependencies.groupChatManager - 群聊管理器
 * @param {Object} [dependencies.ipcMain] - Injected ipcMain (for testing)

---

