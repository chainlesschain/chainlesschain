# MCP POC 快速入门指南 (Quick Start Guide)

**Version**: POC 0.1.1
**Last Updated**: 2026-01-17

---

## 🎯 当前状态 (Current Status)

| 组件 | 状态 | 说明 |
|------|------|------|
| **@modelcontextprotocol/sdk** | ✅ 已安装 | v1.25.2 |
| **配置文件** | ✅ 已创建 | `.chainlesschain/config.json` |
| **MCP 核心模块** | ✅ 已实现 | 7 个核心模块 |
| **主进程集成** | ✅ 已集成 | IPC handlers 已注册 |
| **安全策略** | ✅ 已实现 | 路径限制、审计日志 |
| **基准测试** | ✅ 可运行 | 需要手动测试 |

**快速验证**:
```bash
cd desktop-app-vue
npm run dev  # 启动应用，MCP 会自动初始化
```

---

## 📋 目标 (Objective)

本 POC (Proof of Concept) 旨在验证 Model Context Protocol (MCP) 与 ChainlessChain 集成的可行性。

**核心问题**:
1. MCP stdio 通信开销是否可接受？ (< 100ms)
2. 安全策略能否有效保护敏感数据？
3. 用户体验是否比现有实现更好？

---

## 🚀 第一步：安装依赖 ✅ 已完成

### 1. 安装 MCP SDK ✅

SDK 已安装在 `package.json` 中：
```json
"@modelcontextprotocol/sdk": "^1.25.2"
```

如需重新安装：
```bash
cd desktop-app-vue
npm install @modelcontextprotocol/sdk
```

### 2. 验证安装

```bash
npx @modelcontextprotocol/server-filesystem --help
```

如果看到帮助信息，说明安装成功。

---

## ⚙️ 第二步：配置 MCP 服务器

### 1. 复制配置模板

```bash
# 从项目根目录
copy .chainlesschain\mcp-config-example.json .chainlesschain\config.json
```

**或者** 手动编辑 `.chainlesschain/config.json` 添加以下内容：

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "filesystem": {
        "enabled": true,
        "command": "npx",
        "args": [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          "D:\\code\\chainlesschain\\data"
        ],
        "autoConnect": true,
        "permissions": {
          "allowedPaths": ["notes/", "imports/", "exports/"],
          "forbiddenPaths": ["ukey/", "did/private-keys/", "p2p/keys/"],
          "readOnly": false
        }
      }
    }
  }
}
```

### 2. 调整路径

⚠️ **重要**: 将 `args` 中的路径改为你的实际数据路径：

```json
"args": [
  "-y",
  "@modelcontextprotocol/server-filesystem",
  "你的实际路径"  // 例如: "D:\\code\\chainlesschain\\data"
]
```

---

## 🧪 第三步：运行性能基准测试

**这是 POC 最重要的步骤！**

### 运行基准测试

```bash
cd desktop-app-vue
node src/main/mcp/__tests__/benchmark-mcp-performance.js
```

### 预期输出

```
═══════════════════════════════════════════════════
  MCP PERFORMANCE BENCHMARK
  Iterations: 100
  Warmup: 10
═══════════════════════════════════════════════════

📊 BENCHMARK 1: Connection Time
─────────────────────────────────────────
  Results:
    Avg: 450.23ms
    Min: 380ms
    Max: 620ms
    P95: 550.15ms

📊 BENCHMARK 2: Direct File Read (Baseline)
─────────────────────────────────────────
  Results:
    Avg: 1.25ms
    Min: 0ms
    Max: 5ms

📊 BENCHMARK 3: MCP File Read
─────────────────────────────────────────
  Results:
    Avg: 45.67ms
    Min: 35ms
    Max: 80ms
    P95: 65.12ms

📊 BENCHMARK 4: Overhead Analysis
─────────────────────────────────────────
  Direct Call Avg: 1.25ms
  MCP Call Avg: 45.67ms

  Overhead:
    Avg: 44.42ms (3553.6%)
    Min: 30.00ms
    Max: 75.00ms
    P95: 60.00ms

  Assessment:
    ✅ EXCELLENT - Overhead < 50ms

📈 POC SUCCESS CRITERIA EVALUATION
─────────────────────────────────────────

  ✅ Connection Time
      Target: < 500ms | Acceptable: < 1s
      Actual: 450.23ms

  ✅ Tool Call Latency
      Target: < 100ms | Acceptable: < 200ms
      Actual: 45.67ms

  ✅ stdio Overhead
      Target: < 50ms | Acceptable: < 100ms
      Actual: 44.42ms

  ✅ Error Rate
      Target: < 1% | Acceptable: < 5%
      Actual: 0.0%

─────────────────────────────────────────

  Overall: 4/4 criteria met

  🎉 POC SUCCESSFUL - All criteria met!

═══════════════════════════════════════════════════
```

### 成功标准

| 指标 | 目标 | 可接受 | 不可接受 |
|------|------|--------|---------|
| **连接时间** | < 500ms | < 1s | > 2s |
| **工具调用延迟** | < 100ms | < 200ms | > 500ms |
| **stdio 开销** | < 50ms | < 100ms | > 200ms |
| **错误率** | < 1% | < 5% | > 10% |

---

## 🔧 第四步：集成到主进程 (可选)

如果基准测试通过，可以将 MCP 集成到主进程。

### 1. 修改 `src/main/index.js`

```javascript
const { integrateIntoMainProcess } = require('./mcp/examples/example-integration');

// 在 app.whenReady() 中
app.whenReady().then(async () => {
  // ... 现有初始化代码 ...

  // Initialize ToolManager first
  const toolManager = new ToolManager(database, functionCaller);
  await toolManager.initialize();

  // Integrate MCP (POC)
  const mcpIntegration = await integrateIntoMainProcess(toolManager);

  // ... 其余代码 ...
});
```

### 2. 测试 MCP 工具

通过 IPC 调用 MCP 工具：

```javascript
// 在渲染进程
const result = await window.electron.ipcRenderer.invoke('tool:execute', {
  toolId: 'mcp_filesystem_read_file',
  params: { path: 'notes/test.txt' }
});
```

---

## 📊 第五步：评估结果

### 1. 检查性能指标

```javascript
// 在主进程
const metrics = mcpIntegration.getPerformanceMetrics();
console.log(metrics);
```

### 2. 查看安全审计日志

```javascript
const auditLog = mcpIntegration.getSecurityAuditLog({
  decision: 'DENIED'  // 查看被拒绝的操作
});
console.log(auditLog);
```

### 3. 生成性能报告

```javascript
const report = mcpIntegration.generatePerformanceReport();
console.log(report);
```

---

## ✅ POC 成功检查清单

完成 2 周测试后，检查以下项目：

### 必须满足 (Must Have)

- [ ] **功能性**: MCP 工具正常工作，无崩溃
- [ ] **稳定性**: 错误率 < 5%
- [ ] **安全性**: 无路径穿越或未授权访问
- [ ] **性能**: stdio 开销 < 100ms

### 应该满足 (Should Have)

- [ ] **用户体验**: MCP 工具比自定义实现更易用
- [ ] **开发体验**: 添加新 MCP 服务器 < 30 分钟
- [ ] **文档**: 清晰的设置和使用指南

### 加分项 (Nice to Have)

- [ ] **性能**: stdio 开销 < 50ms
- [ ] **生态系统**: 成功集成 3+ 有用的 MCP 服务器
- [ ] **社区**: 发布了 ChainlessChain 专用 MCP 服务器

---

## 🔍 故障排除 (Troubleshooting)

### 问题 1: `npx: command not found`

**解决方案**: 确保 Node.js 和 npm 已正确安装：

```bash
node --version  # 应显示 v18+
npm --version   # 应显示 v9+
```

### 问题 2: MCP 服务器连接超时

**可能原因**:
1. 路径不存在或无权限
2. 端口被占用
3. 防火墙阻止

**解决方案**:
```bash
# 测试手动启动 MCP 服务器
npx -y @modelcontextprotocol/server-filesystem D:\code\chainlesschain\data
```

如果手动启动成功，检查配置文件中的路径。

### 问题 3: 权限被拒绝

**错误信息**: `Access denied: ... is globally forbidden`

**解决方案**: 检查 `permissions.forbiddenPaths` 配置，确保请求的路径不在禁止列表中。

### 问题 4: 性能不达标

**症状**: stdio 开销 > 100ms

**排查步骤**:
1. 检查是否有其他进程占用 CPU
2. 使用 SSD 而非 HDD
3. 减少文件大小进行测试
4. 检查网络连接（如果使用 HTTP 传输）

---

## 📝 决策点 (Decision Points)

### 第 1 周后

**评估项目**:
- 基准测试是否通过？
- 是否遇到重大技术障碍？
- 安全模型是否满足需求？

**决策**:
- ✅ **继续**: 性能和稳定性可接受 → 进入第 2 周
- ⚠️ **调整**: 发现安全问题 → 修复后重新测试
- ❌ **中止**: 性能不可接受或技术不可行 → 记录发现并归档

### 第 2 周后

**最终决策**:

1. **选项 A: 扩展集成** (全部成功标准满足)
   - 集成 5-10 个常用 MCP 服务器
   - 开发 ChainlessChain 专用 MCP 服务器
   - 计划逐步迁移内置工具

2. **选项 B: 保持现状** (部分满足或性能边缘)
   - 保留现有 Skill-Tool 系统
   - 选择性集成少数高价值 MCP 服务器
   - 每 6 个月重新评估

3. **选项 C: 中止集成** (未满足关键标准)
   - 记录失败原因和学习点
   - 归档 POC 代码
   - 关注 MCP 协议演进

---

## 📚 下一步

### 如果 POC 成功

1. **扩展服务器**:
   ```bash
   # 添加 PostgreSQL 服务器
   npm install -g @modelcontextprotocol/server-postgres
   ```

2. **开发自定义服务器**:
   - 暴露 RAG 能力为 MCP 工具
   - 暴露 DID 操作为 MCP 工具
   - 暴露 P2P 消息为 MCP 资源

3. **UI 集成**:
   - 在设置页面添加 MCP 服务器管理
   - 显示性能指标仪表板
   - 安全审计日志查看器

### 如果 POC 失败

1. **记录失败原因**
2. **分享学习点**
3. **关注 MCP 生态发展**
4. **6 个月后重新评估**

---

## 🤝 支持

遇到问题？

1. 查看 [MCP POC README](src/main/mcp/README.md)
2. 查看 [MCP 集成评估报告](.chainlesschain/MCP_INTEGRATION_EVALUATION_REPORT.md)
3. 查看 [MCP 官方文档](https://modelcontextprotocol.io)
4. 向开发团队报告问题

---

**祝 POC 顺利！** 🚀
