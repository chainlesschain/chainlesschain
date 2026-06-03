# 任务规划失败问题修复

## 问题描述

在使用医疗病历模板创建项目时，任务规划功能失败，出现以下错误：

```
Error: Error invoking remote method 'conversation:create': Error: No handler registered for 'conversation:create'
Error: Error invoking remote method 'conversation:get-by-project': Error: No handler registered for 'conversation:get-by-project'
```

## 根本原因

**IPC 处理器未注册** - Electron 主进程运行的是旧代码，缺少对话管理（Conversation）相关的 IPC 处理器。

虽然源代码中已经正确实现了这些处理器：
- `src/main/conversation/conversation-ipc.js` - 定义了 16 个对话相关的 IPC 处理器
- `src/main/ipc-registry.js` - 在第 634-647 行注册了 Conversation IPC

但是主进程没有重新构建，导致运行时使用的是旧版本的代码。

## 解决方案

### 1. 重新构建主进程（已完成）

```bash
cd desktop-app-vue
npm run build:main
```

### 2. 重启 Electron 应用程序（必须执行）

**重要：** 必须完全重启应用程序才能加载新的主进程代码。

```bash
# 停止当前运行的应用
# 然后重新启动
npm run dev
```

## 已注册的 Conversation IPC 处理器

修复后，以下 16 个处理器将可用：

### 对话管理
1. `conversation:get-by-project` - 根据项目ID获取对话
2. `conversation:get-by-id` - 获取对话详情
3. `conversation:create` - 创建对话
4. `conversation:update` - 更新对话
5. `conversation:delete` - 删除对话

### 消息管理
6. `conversation:create-message` - 创建消息
7. `conversation:update-message` - 更新消息
8. `conversation:get-messages` - 获取对话的所有消息

### 流式对话
9. `conversation:chat-stream` - 流式AI对话

### 流式控制
10. `conversation:stream-pause` - 暂停流式输出
11. `conversation:stream-resume` - 恢复流式输出
12. `conversation:stream-cancel` - 取消流式输出
13. `conversation:stream-stats` - 获取流式输出统计
14. `conversation:stream-list` - 获取所有活动的流式会话
15. `conversation:stream-cleanup` - 清理已完成的流式会话
16. `conversation:stream-manager-stats` - 获取管理器状态

## 验证修复

重启应用后，可以通过以下方式验证修复：

1. 打开开发者工具控制台
2. 查看主进程日志，应该看到：
   ```
   [Conversation IPC] Registered 16 conversation handlers
   ```
3. 尝试使用医疗病历模板创建项目
4. 任务规划功能应该正常工作

## 相关文件

- `src/main/conversation/conversation-ipc.js` - Conversation IPC 处理器实现
- `src/main/ipc-registry.js` - IPC 注册中心
- `src/main/index.js` - 主进程入口文件

## 预防措施

为避免类似问题，建议：

1. **开发流程**：修改主进程代码后，始终运行 `npm run build:main`
2. **热重载**：考虑实现主进程热重载功能（目前仅渲染进程支持热重载）
3. **启动检查**：在应用启动时验证关键 IPC 处理器是否已注册

## 修复日期

2026-01-11

## 修复状态

✅ 主进程已重新构建
⏳ 等待用户重启应用程序
