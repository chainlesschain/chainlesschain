# 初始化修复验证指南

## 已修复的问题

1. ✅ **TemplateManager 初始化失败** - "模板管理器未初始化"
2. ✅ **OrganizationManager 初始化失败** - 组织邀请加载失败

## 如何验证修复

### 步骤 1: 停止当前应用

```bash
# Windows
taskkill /F /IM electron.exe

# 或者在任务管理器中结束所有 electron.exe 进程
```

### 步骤 2: 清理缓存（可选但推荐）

```bash
cd desktop-app-vue

# 删除 WAL 文件
del data\chainlesschain.db-wal
del data\chainlesschain.db-shm

# 或者完全重建数据库（会丢失数据！）
# del data\chainlesschain.db
```

### 步骤 3: 重新启动应用

```bash
npm run dev
```

### 步骤 4: 检查初始化日志

在应用启动时，查找以下成功日志：

#### ✅ 期望看到的成功日志:

```
[Bootstrap] ✓ TemplateManager initialized successfully
[Bootstrap] ✓ OrganizationManager initialized successfully
[TemplateManager] ✓ 成功加载 XXX 个项目模板
```

#### ❌ 不应再出现的错误:

```
模板管理器未初始化
组织管理器未初始化
Template manager not initialized
Organization manager not initialized
```

### 步骤 5: 功能测试

#### 测试 1: 模板功能

1. 导航到项目页面
2. 点击"新建项目"或"模板"按钮
3. **期望**: 能看到模板列表，没有错误
4. **期望**: Console 中没有 "模板管理器未初始化" 错误

#### 测试 2: 组织功能

1. 查看顶部导航栏的"组织邀请"按钮
2. **期望**: 按钮可以点击，没有错误
3. **期望**: Console 中没有 "加载待处理邀请失败" 错误
4. **期望**: 如果有邀请，应该能正常显示

#### 测试 3: 项目列表

1. 导航到项目页面
2. **期望**: 项目列表正常加载
3. **期望**: Console 中没有 "Failed to load projects" 错误

## 详细检查清单

### Console 日志检查

打开开发者工具（F12），查看 Console：

- [ ] 没有红色错误信息
- [ ] 看到 "✓ TemplateManager initialized successfully"
- [ ] 看到 "✓ OrganizationManager initialized successfully"
- [ ] 没有 "模板管理器未初始化" 错误
- [ ] 没有 "组织管理器未初始化" 错误

### 功能检查

- [ ] 项目页面能正常加载
- [ ] 模板列表能正常显示
- [ ] 组织邀请功能正常
- [ ] 好友列表能正常加载（如果有好友）
- [ ] 聊天会话能正常加载（如果有会话）

## 如果仍然有问题

### 问题 1: 仍然看到 "模板管理器未初始化"

**诊断步骤:**

1. 检查 `dist/main/bootstrap/core-initializer.js` 是否已更新:
   ```bash
   grep -A 5 "context.database.db" dist/main/bootstrap/core-initializer.js
   ```

   应该看到:
   ```javascript
   const manager = new ProjectTemplateManager(context.database.db);
   ```

2. 如果没有，重新构建:
   ```bash
   npm run build:main
   ```

### 问题 2: 仍然看到 "组织管理器未初始化"

**诊断步骤:**

1. 检查 `dist/main/bootstrap/social-initializer.js` 是否已更新:
   ```bash
   grep -A 5 "context.database.db" dist/main/bootstrap/social-initializer.js | grep -A 3 "OrganizationManager"
   ```

2. 如果没有，重新构建:
   ```bash
   npm run build:main
   ```

### 问题 3: 数据库相关错误

如果看到 "Database not initialized" 或类似错误:

1. 检查数据库文件权限:
   ```bash
   ls -la data/chainlesschain.db
   ```

2. 尝试完全重建数据库（**警告：会丢失数据**）:
   ```bash
   rm data/chainlesschain.db
   npm run dev
   ```

### 问题 4: 端口占用

如果启动失败，提示端口 5173 已被占用:

```bash
# 查找占用进程
netstat -ano | findstr :5173

# 结束进程 (替换 PID 为实际的进程ID)
taskkill /F /PID <PID>
```

## 技术细节

### 修复内容

**修复前:**
```javascript
const manager = new ProjectTemplateManager(context.database);
```

**修复后:**
```javascript
if (!context.database || !context.database.db) {
  throw new Error("Database not initialized or missing db instance");
}
const manager = new ProjectTemplateManager(context.database.db);
```

### 为什么会出现这个问题？

1. `DatabaseManager` 是一个包装类，提供了额外的功能（如查询缓存）
2. 内部的 SQLite 实例存储在 `database.db` 属性中
3. `TemplateManager` 和 `OrganizationManager` 直接使用 SQLite API（如 `.prepare()`）
4. 因此它们需要原始的 `db` 对象，而不是 `DatabaseManager` 包装器

### 其他管理器为什么不需要修复？

- `FriendManager`, `PostManager`, `ContactManager` 等使用 `DatabaseManager` 的抽象层
- 它们在内部通过 `this.database.db` 访问原始 db
- 因此它们可以接收 `DatabaseManager` 实例

## 成功标志

当看到以下内容时，说明修复成功：

```
[Bootstrap] 开始应用初始化...
...
[Bootstrap] ✓ TemplateManager initialized successfully
[Bootstrap] ✓ OrganizationManager initialized successfully
...
[TemplateManager] ✓ 成功加载 XXX 个项目模板
[Bootstrap] 应用初始化完成，总耗时: XXXXms
```

## 附加说明

- 修复已应用到源代码：`src/main/bootstrap/core-initializer.js` 和 `src/main/bootstrap/social-initializer.js`
- 需要运行 `npm run build:main` 才能生效
- 构建已在之前完成，直接重启应用即可验证

---

**状态**: ✅ 代码已修复，已构建
**下一步**: 重启应用并验证
**文档更新**: 2026-02-04
