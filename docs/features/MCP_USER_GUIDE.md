# MCP (Model Context Protocol) 用户指南

**版本**: 1.0.0
**最后更新**: 2026-01-16
**状态**: POC (概念验证)

---

## 📚 目录

- [什么是 MCP](#什么是-mcp)
- [为什么使用 MCP](#为什么使用-mcp)
- [快速开始](#快速开始)
- [服务器配置](#服务器配置)
- [使用指南](#使用指南)
- [常见问题](#常见问题)
- [安全性说明](#安全性说明)

---

## 什么是 MCP

**Model Context Protocol (模型上下文协议)** 是一个开放标准，用于连接AI助手与各种外部工具和数据源。

### 核心概念

- **服务器**: 提供特定功能的独立进程（如文件系统、数据库访问）
- **工具**: 服务器提供的可调用功能（如读取文件、执行SQL查询）
- **资源**: 服务器暴露的数据（如文件、数据库表）
- **客户端**: ChainlessChain应用，连接和调用MCP服务器

---

## 为什么使用 MCP

### 优势

1. **扩展性强** 🔌
   - 轻松添加新功能，无需修改核心代码
   - 丰富的社区生态系统

2. **标准化** 📏
   - 使用统一的协议和接口
   - 兼容所有符合MCP标准的工具

3. **安全性高** 🔒
   - 服务器在隔离进程中运行
   - 细粒度的权限控制

4. **易于维护** 🛠️
   - 各服务器独立升级
   - 问题隔离，不影响主应用

### 支持的服务器

ChainlessChain目前支持以下官方MCP服务器：

| 服务器         | 功能           | 安全级别 |
| -------------- | -------------- | -------- |
| **Filesystem** | 文件读写、搜索 | 中       |
| **PostgreSQL** | 数据库查询     | 高       |
| **SQLite**     | 本地数据库访问 | 中       |
| **Git**        | Git仓库操作    | 中       |
| **Fetch**      | HTTP请求       | 中       |

---

## 快速开始

### 1. 启用 MCP 系统

1. 打开 ChainlessChain 应用
2. 进入 **设置 → MCP 服务器**
3. 开启 **启用MCP系统** 开关

![启用MCP](../images/mcp-enable.png)

### 2. 连接第一个服务器（Filesystem）

#### 步骤 1: 配置服务器

点击 **Filesystem** 服务器行的 **配置** 按钮：

```json
{
  "启用": true,
  "自动连接": true,
  "根目录路径": "D:\\code\\chainlesschain\\data",
  "允许路径": ["notes/", "imports/", "exports/"],
  "禁止路径": ["chainlesschain.db", "ukey/"],
  "只读模式": false
}
```

**重要提示**:

- **根目录路径**: 请替换为你的实际数据目录
- **允许路径**: 只有这些子目录可以被访问
- **禁止路径**: 这些路径将被永久阻止

#### 步骤 2: 连接服务器

点击 **连接** 按钮。成功后状态会显示为"已连接"。

#### 步骤 3: 测试工具

点击 **工具** 按钮查看可用工具：

- `read_file` - 读取文件内容
- `write_file` - 写入文件
- `list_directory` - 列出目录内容
- `search_files` - 搜索文件

点击 **测试** 按钮进行快速测试。

---

## 服务器配置

### Filesystem 服务器

**用途**: 访问文件系统，读写文件

**配置示例**:

```json
{
  "enabled": true,
  "autoConnect": true,
  "rootPath": "D:\\code\\chainlesschain\\data",
  "permissions": {
    "allowedPaths": ["notes/", "imports/", "exports/", "projects/"],
    "forbiddenPaths": [
      "chainlesschain.db",
      "ukey/",
      "did/private-keys/",
      "p2p/keys/"
    ],
    "readOnly": false,
    "maxFileSize": 104857600
  }
}
```

**参数说明**:

- `rootPath`: 服务器可访问的根目录（绝对路径）
- `allowedPaths`: 相对于根目录的允许路径（白名单）
- `forbiddenPaths`: 禁止访问的路径（黑名单，优先级更高）
- `readOnly`: 是否只读模式
- `maxFileSize`: 最大文件大小（字节）

### PostgreSQL 服务器

**用途**: 连接 PostgreSQL 数据库执行查询

**配置示例**:

```json
{
  "enabled": false,
  "autoConnect": false,
  "connection": {
    "host": "localhost",
    "port": 5432,
    "database": "chainlesschain",
    "user": "chainlesschain",
    "password": "${DB_PASSWORD}",
    "ssl": false
  },
  "permissions": {
    "allowedSchemas": ["public"],
    "forbiddenTables": ["users", "credentials", "api_keys"],
    "readOnly": true,
    "maxResultRows": 1000
  }
}
```

**安全建议**:

- 使用环境变量存储密码（`${DB_PASSWORD}`）
- 始终启用 `readOnly` 模式（除非需要写入）
- 限制 `maxResultRows` 防止大量数据传输

### SQLite 服务器

**用途**: 访问本地 SQLite 数据库

**配置示例**:

```json
{
  "enabled": false,
  "databasePath": "D:\\code\\chainlesschain\\data\\app.db",
  "permissions": {
    "allowedTables": ["notes", "tags", "bookmarks"],
    "forbiddenTables": ["users", "credentials"],
    "readOnly": true
  }
}
```

**注意事项**:

- 不要连接到主数据库 `chainlesschain.db`（含敏感数据）
- 推荐使用只读模式

### Git 服务器

**用途**: 查看Git仓库状态、提交历史、差异等

**配置示例**:

```json
{
  "enabled": false,
  "repositoryPath": "D:\\code\\chainlesschain",
  "permissions": {
    "allowedOperations": ["status", "log", "diff", "show"],
    "readOnly": true
  }
}
```

**安全提示**:

- 默认只允许只读操作（status, log, diff）
- 不要启用 `push` 和 `reset` 操作

---

## 使用指南

### 在 AI 对话中使用 MCP 工具

连接 MCP 服务器后，AI 助手可以自动调用这些工具：

**示例对话**:

```
你: 帮我读取 notes/meeting.md 文件

AI: 我来读取该文件。
    [调用 mcp_read_file 工具]
    文件内容如下：
    ...
```

```
你: 搜索包含 "项目计划" 的所有Markdown文件

AI: 我来搜索。
    [调用 mcp_search_files 工具]
    找到3个文件：
    1. projects/plan-2026.md
    2. notes/project-overview.md
    3. ...
```

### 手动调用工具（开发者模式）

打开开发者工具（Ctrl+Shift+I）：

```javascript
// 读取文件
const result = await window.electronAPI.invoke("mcp:call-tool", {
  serverName: "filesystem",
  toolName: "read_file",
  arguments: { path: "notes/test.txt" },
});

console.log(result.result.content);
```

```javascript
// 列出目录
const result = await window.electronAPI.invoke("mcp:call-tool", {
  serverName: "filesystem",
  toolName: "list_directory",
  arguments: { path: "projects/" },
});

console.log(result.result.entries);
```

---

## 常见问题

### Q1: 为什么服务器连接失败？

**可能原因**:

1. **MCP SDK 未安装**: 运行 `npm install @modelcontextprotocol/sdk`
2. **路径配置错误**: 检查 `rootPath` 或 `databasePath` 是否正确
3. **权限不足**: 确保应用有权限访问指定目录
4. **端口冲突**: 某些服务器可能需要特定端口

**解决方法**:

- 查看应用日志（设置 → 高级 → 查看日志）
- 手动测试服务器命令：`npx -y @modelcontextprotocol/server-filesystem <path>`

### Q2: 工具调用被安全策略阻止？

**原因**: 你尝试访问被禁止的路径或表

**解决方法**:

1. 检查 `forbiddenPaths` / `forbiddenTables` 配置
2. 如果确实需要访问，修改配置添加到白名单
3. 对于敏感操作，系统会弹出确认对话框

### Q3: 性能很慢或超时？

**优化建议**:

1. **增加超时时间**: 在配置中设置 `performance.timeout`
2. **减少数据量**: 使用 `maxResultRows` 限制查询结果
3. **启用缓存**: 在 Filesystem 配置中启用 `cacheEnabled`
4. **检查网络**: 对于远程数据库，确保网络连接稳定

### Q4: 如何添加自定义 MCP 服务器？

**步骤**:

1. 开发符合 MCP 标准的服务器（参考 [MCP SDK文档](https://github.com/modelcontextprotocol/sdk)）
2. 将服务器添加到 `server-registry.json`
3. 创建配置 schema（参考 `server-configs/` 目录）
4. 在设置页面中配置和连接

---

## 安全性说明

### 数据保护

ChainlessChain MCP 集成采用多层安全措施：

1. **服务器白名单** ✅
   - 只能加载 `server-registry.json` 中的可信服务器
   - 防止恶意服务器注入

2. **路径访问控制** 🔒
   - 白名单和黑名单双重保护
   - 禁止访问敏感文件（数据库、密钥等）

3. **用户同意流程** 👤
   - 高风险操作（写入、删除）需要用户确认
   - 显示详细操作信息

4. **进程隔离** 🛡️
   - MCP 服务器运行在独立进程中
   - 服务器崩溃不影响主应用

5. **审计日志** 📝
   - 所有 MCP 操作记录到日志
   - 可追踪和审计

### 最佳实践

1. **最小权限原则**
   - 只启用必要的服务器
   - 使用只读模式（除非确实需要写入）
   - 限制访问路径和表

2. **定期审查配置**
   - 检查已连接的服务器
   - 删除不再使用的服务器
   - 更新权限配置

3. **保护敏感数据**
   - 永远不要连接到主数据库（`chainlesschain.db`）
   - 禁止访问 `ukey/`, `did/private-keys/` 等目录
   - 使用环境变量存储密码

4. **更新和监控**
   - 保持 MCP SDK 最新版本
   - 监控性能指标和错误率
   - 定期查看审计日志

---

## 技术支持

### 获取帮助

- **官方文档**: [MCP 规范](https://modelcontextprotocol.io/)
- **开发者指南**: [测试指南](../../desktop-app-vue/src/main/mcp/TESTING_GUIDE.md)
- **问题反馈**: GitHub Issues

### 诊断信息

在报告问题时，请提供：

1. ChainlessChain 版本
2. 操作系统和版本
3. MCP 服务器名称和版本
4. 错误日志（设置 → 高级 → 导出日志）
5. 配置文件（脱敏后）

### 调试模式

启用详细日志：

```json
{
  "mcp": {
    "logging": {
      "level": "debug",
      "enableConsole": true
    }
  }
}
```

查看实时日志：

- 开发者工具（Ctrl+Shift+I） → Console
- 日志文件：`.chainlesschain/logs/mcp-*.log`

---

## 附录

### MCP 规范版本

当前实现基于：

- **MCP 规范**: 2025-11-25
- **MCP SDK**: ^0.x.x

### 更新日志

**v1.0.0 (2026-01-16)**:

- 初始发布
- 支持 Filesystem、PostgreSQL、SQLite、Git、Fetch 服务器
- UI 管理界面
- 安全策略和审计日志

---

**Happy coding with MCP! 🚀**
