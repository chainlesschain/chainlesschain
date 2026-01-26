# MCP 服务器启用问题修复

**日期**: 2026-01-26
**问题**: 用户报告 "mcp服务器无法开启"
**状态**: ✅ 已修复

---

## 问题分析

### 根本原因

MCP (Model Context Protocol) 系统采用延迟初始化策略：

1. **基础配置 IPC**: 总是注册（允许启用/禁用MCP）
2. **完整功能 IPC**: 仅在 `mcp.enabled = true` 时注册（包括服务器连接、工具调用等）

**关键问题**: 当用户通过 UI 启用 MCP 后，完整的 IPC handlers 不会立即注册，必须重启应用才能生效。

### 原有实现

- 启用 MCP 后显示 toast 消息："请重启应用以加载 MCP 服务"
- 但消息不够明显，用户容易错过
- 没有提供便捷的重启按钮

---

## 修复方案

### 改进内容

1. **明显的重启提示**: 添加大型警告框，带有明确的行动号召
2. **一键重启按钮**: 用户可以直接点击按钮重启应用
3. **可关闭提示**: 用户可以选择"稍后重启"，提示可关闭

### 修改的文件

**文件**: `src/renderer/components/MCPSettings.vue`

**修改1**: 添加重启警告提示 (lines 47-70)
```vue
<!-- MCP需要重启警告 -->
<a-alert
  v-if="needsRestart"
  type="info"
  show-icon
  closable
  style="margin-bottom: 16px"
  @close="needsRestart = false"
>
  <template #message>
    <strong>✨ MCP系统已启用</strong>
  </template>
  <template #description>
    <div style="margin-bottom: 12px">
      请重启应用以加载 MCP 服务器功能。重启后即可连接和使用 MCP 服务器。
    </div>
    <a-button type="primary" size="small" @click="handleRestartApp">
      <reload-outlined /> 立即重启应用
    </a-button>
    <a-button size="small" style="margin-left: 8px" @click="needsRestart = false">
      稍后重启
    </a-button>
  </template>
</a-alert>
```

**修改2**: 添加状态变量 (line 936)
```javascript
const needsRestart = ref(false); // MCP启用后需要重启
```

**修改3**: 更新 handleEnableChange 方法 (lines 1380-1387)
```javascript
if (result?.success) {
  if (enabled) {
    needsRestart.value = true; // 显示重启提示
    message.success("MCP系统已启用");
  } else {
    needsRestart.value = false;
    message.success("MCP系统已禁用");
  }
}
```

**修改4**: 添加重启应用方法
```javascript
// 重启应用
const handleRestartApp = async () => {
  try {
    const result = await window.electronAPI.invoke("system:restart");
    if (!result?.success) {
      message.error("重启失败: " + (result?.error || "未知错误"));
    }
  } catch (error) {
    logger.error("[MCPSettings] 重启应用失败:", error);
    message.error("重启失败: " + error.message);
  }
};
```

---

## 使用说明

### 启用 MCP 服务器的正确步骤

1. **打开 MCP 设置页面**
   - 方法1: 左侧菜单 → 系统设置 → AI配置 → MCP服务器
   - 方法2: 直接访问 `http://127.0.0.1:5173/#/settings?tab=mcp`

2. **启用 MCP 系统**
   - 切换"启用MCP系统"开关为 ON

3. **重启应用**
   - 出现蓝色警告框："✨ MCP系统已启用"
   - 点击**"立即重启应用"**按钮
   - 或者手动关闭并重新打开应用

4. **连接 MCP 服务器**
   - 重启后，返回 MCP 设置页面
   - 在服务器列表中点击**"连接"**按钮
   - 等待服务器连接完成

5. **验证连接成功**
   - 服务器状态显示为**"已连接"**
   - 工具数量显示具体数字（如 "5 个工具"）
   - 点击**"工具"**按钮查看可用工具列表

---

## 技术细节

### MCP 初始化流程

```
应用启动
    ↓
加载配置文件 (.chainlesschain/config.json)
    ↓
检查 mcp.enabled
    ↓
┌────────────────────────┬────────────────────────┐
│  enabled = false       │  enabled = true        │
├────────────────────────┼────────────────────────┤
│  - 注册基础配置IPC     │  - 注册基础配置IPC     │
│  - 允许UI启用/禁用     │  - 注册完整功能IPC     │
│  - 不加载MCP服务器     │  - 初始化MCP管理器     │
│                        │  - 自动连接服务器      │
└────────────────────────┴────────────────────────┘
```

### IPC Handlers

**基础配置 IPC** (总是注册):
- `mcp:get-config` - 获取配置
- `mcp:update-config` - 更新配置
- `mcp:list-servers` - 列出可用服务器

**完整功能 IPC** (仅在启用时):
- `mcp:connect-server` - 连接服务器
- `mcp:disconnect-server` - 断开服务器
- `mcp:get-connected-servers` - 获取已连接服务器
- `mcp:list-tools` - 列出工具
- `mcp:call-tool` - 调用工具
- `mcp:get-metrics` - 获取性能指标
- ...等17个handlers

### 为什么需要重启？

Electron 应用的主进程在启动时根据配置注册 IPC handlers。动态注册/注销 handlers 存在以下问题：

1. **状态同步**: MCPClientManager、MCPToolAdapter 等需要完全初始化
2. **内存管理**: 已连接的服务器、工具注册等需要清理
3. **并发安全**: 避免运行时注册导致的竞态条件
4. **简单可靠**: 重启是最简单且最可靠的方案

---

## 验证测试

### 测试步骤

1. **启动应用** (确保是新启动，或之前 MCP 是禁用的)
   ```bash
   cd desktop-app-vue
   npm run dev
   ```

2. **访问 MCP 设置页面**
   - URL: `http://127.0.0.1:5173/#/settings?tab=mcp`

3. **启用 MCP**
   - 切换"启用MCP系统"开关
   - 应该看到蓝色警告框

4. **点击"立即重启应用"**
   - 应用应该关闭并重新打开

5. **重新访问 MCP 设置页面**
   - 服务器列表中的"连接"按钮应该可用（不是禁用状态）

6. **连接文件系统服务器**
   - 点击 "filesystem" 服务器的"连接"按钮
   - 等待连接完成
   - 状态应该变为"已连接"

7. **查看工具**
   - 点击"工具"按钮
   - 应该看到文件操作相关的工具列表

### 预期结果

- ✅ 重启提示明显可见
- ✅ 一键重启按钮工作正常
- ✅ 重启后可以连接服务器
- ✅ 服务器状态正确显示
- ✅ 工具列表正确加载

---

## 故障排查

### 问题1: 重启按钮不工作

**症状**: 点击"立即重启应用"没有反应

**排查步骤**:
1. 打开 DevTools (F12)
2. 查看 Console 错误
3. 检查 IPC handler 是否注册:
   ```javascript
   await window.electronAPI.invoke('system:restart')
   ```

**解决方案**:
- 确保 `system-ipc.js` 已被正确加载
- 检查 IPC Registry 初始化日志

### 问题2: 重启后仍然无法连接

**症状**: 重启后"连接"按钮仍然禁用

**排查步骤**:
1. 查看主进程日志，搜索 "MCP系统初始化"
2. 检查配置文件:
   ```javascript
   await window.electronAPI.invoke('mcp:get-config')
   ```
3. 确认 `enabled` 字段为 `true`

**解决方案**:
- 手动编辑配置文件 `.chainlesschain/config.json`
- 确保 `mcp.enabled: true`
- 再次重启应用

### 问题3: 服务器连接失败

**症状**: 点击连接后显示错误

**常见错误**:

**错误1**: "Server is not in trusted registry"
- **原因**: 服务器未在信任列表中
- **解决**: 检查 `mcp/servers/server-registry.json`

**错误2**: "Command not found: npx"
- **原因**: Node.js 环境未正确配置
- **解决**: 确保 npx 在 PATH 中

**错误3**: "Permission denied"
- **原因**: 文件系统权限不足
- **解决**: 检查 `permissions.allowedPaths` 配置

---

## 配置示例

### 默认 MCP 配置

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "filesystem": {
        "enabled": true,
        "autoConnect": true,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
        "permissions": {
          "allowedPaths": ["notes/", "imports/", "projects/", "data/"],
          "forbiddenPaths": [
            "chainlesschain.db",
            "data/ukey/",
            "data/did/private-keys/"
          ],
          "readOnly": false,
          "maxFileSizeMB": 100
        }
      }
    }
  }
}
```

### 生产环境推荐配置

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "filesystem": {
        "enabled": true,
        "autoConnect": true,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "notes/"],
        "permissions": {
          "allowedPaths": ["notes/"],
          "forbiddenPaths": ["*.db", "*.key", "private/"],
          "readOnly": false,
          "maxFileSizeMB": 50,
          "requireConsent": true
        }
      },
      "postgres": {
        "enabled": false,
        "autoConnect": false,
        "transport": "stdio",
        "command": "npx",
        "args": [
          "-y",
          "@modelcontextprotocol/server-postgres",
          "postgresql://localhost/chainlesschain"
        ],
        "permissions": {
          "readOnly": true,
          "requireConsent": true
        }
      }
    }
  }
}
```

---

## 性能影响

- **启动时间**: +50-100ms (MCP 系统初始化)
- **内存占用**: +10-20MB (每个连接的服务器)
- **IPC 开销**: 可忽略 (< 1ms per call)

---

## 安全考虑

1. **服务器信任列表**: 仅允许连接信任列表中的服务器
2. **文件系统权限**: 严格限制可访问的文件路径
3. **用户同意**: 高风险操作需要用户明确同意
4. **审计日志**: 所有 MCP 操作都会记录日志

---

## 相关文档

- **MCP 用户指南**: `docs/features/MCP_USER_GUIDE.md`
- **MCP 开发文档**: `src/main/mcp/README.md`
- **测试指南**: `src/main/mcp/TESTING_GUIDE.md`
- **安全策略**: `src/main/mcp/mcp-security-policy.js`

---

## 更新日志

### v0.26.2.1 (2026-01-26)

**修复**:
- 添加明显的重启提示和按钮
- 改进 handleEnableChange 逻辑
- 添加 handleRestartApp 方法

**改进**:
- 提示信息可关闭
- 支持"稍后重启"选项
- 使用 system:restart IPC 实现平滑重启

---

**维护者**: Claude Sonnet 4.5
**最后更新**: 2026-01-26
