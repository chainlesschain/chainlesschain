# SessionManager (会话管理系统)

**Status**: ✅ Implemented (v0.22.0 - Auto-Summary)
**Added**: 2026-01-16
**Updated**: 2026-01-18

SessionManager 实现智能会话上下文管理，支持跨会话连续对话和 Token 优化。基于 OpenClaude 最佳实践设计。

## 核心功能

1. **会话持久化**: 自动保存对话历史到 `.chainlesschain/memory/sessions/`
2. **智能压缩**: 集成 PromptCompressor，自动压缩长对话历史
3. **Token 优化**: 减少 30-40% Token 使用，降低 LLM 成本
4. **跨会话恢复**: 支持加载历史会话继续对话
5. **统计分析**: 追踪压缩效果和 Token 节省

### 增强功能 (v0.21.0+)

6. **会话搜索**: 按标题和消息内容全文搜索历史会话
7. **标签系统**: 为会话添加标签，支持按标签过滤和查找
8. **导出/导入**: 支持导出为 JSON/Markdown 格式，支持从 JSON 导入
9. **智能摘要**: 自动或手动生成会话摘要（支持 LLM 和简单模式）
10. **会话续接**: 智能上下文恢复，生成续接提示
11. **会话模板**: 将会话保存为模板，快速创建新会话
12. **批量操作**: 批量删除、批量添加标签、批量导出
13. **全局统计**: 跨会话的使用统计和分析

### 自动摘要功能 (v0.22.0)

14. **消息阈值触发**: 当会话消息数达到阈值时自动生成摘要
15. **后台摘要生成**: 定期检查并为无摘要会话自动生成
16. **批量摘要生成**: 一键为所有符合条件的会话生成摘要
17. **摘要覆盖率统计**: 追踪自动/手动生成的摘要比例

## 使用方式

### 创建会话

```javascript
const session = await sessionManager.createSession({
  conversationId: "conv-001",
  title: "讨论项目架构",
  metadata: { topic: "architecture" },
});
```

### 添加消息

```javascript
await sessionManager.addMessage(session.id, {
  role: "user",
  content: "如何优化数据库查询？",
});
```

### 获取有效消息（自动压缩）

```javascript
const messages = await sessionManager.getEffectiveMessages(session.id);
```

### 搜索会话

```javascript
const results = await sessionManager.searchSessions("数据库优化", {
  searchTitle: true,
  searchContent: true,
  limit: 20,
});
```

### 标签管理

```javascript
await sessionManager.addTags(session.id, ["技术讨论", "数据库"]);
const sessions = await sessionManager.findSessionsByTags(["技术讨论"]);
const allTags = await sessionManager.getAllTags();
```

### 导出/导入

```javascript
const json = await sessionManager.exportToJSON(session.id);
const markdown = await sessionManager.exportToMarkdown(session.id, {
  includeMetadata: true,
});
const imported = await sessionManager.importFromJSON(jsonData);
```

### 摘要生成

```javascript
const summary = await sessionManager.generateSummary(session.id);
await sessionManager.generateSummariesBatch({ overwrite: false });
```

### 自动摘要管理 (v0.22.0)

```javascript
const config = sessionManager.getAutoSummaryConfig();
sessionManager.updateAutoSummaryConfig({
  enabled: true,
  threshold: 5,
  interval: 300000,
  backgroundEnabled: true,
});
sessionManager.startBackgroundSummaryGenerator();
sessionManager.stopBackgroundSummaryGenerator();
```

## 配置参数

| 参数                      | 默认值 | 说明                     |
| ------------------------- | ------ | ------------------------ |
| `maxHistoryMessages`      | 10     | 压缩后保留的最大消息数   |
| `compressionThreshold`    | 10     | 触发压缩的消息数阈值     |
| `enableAutoSave`          | true   | 自动保存会话             |
| `enableCompression`       | true   | 启用智能压缩             |
| `enableAutoSummary`       | true   | 启用自动摘要生成         |
| `autoSummaryThreshold`    | 5      | 触发自动摘要的消息数阈值 |
| `autoSummaryInterval`     | 300000 | 后台摘要检查间隔（毫秒） |
| `enableBackgroundSummary` | true   | 启用后台摘要生成         |

## IPC 通道

| 通道                                 | 功能             |
| ------------------------------------ | ---------------- |
| `session:create`                     | 创建会话         |
| `session:load`                       | 加载会话         |
| `session:add-message`                | 添加消息         |
| `session:search`                     | 搜索会话         |
| `session:add-tags`                   | 添加标签         |
| `session:remove-tags`                | 移除标签         |
| `session:get-all-tags`               | 获取所有标签     |
| `session:find-by-tags`               | 按标签查找       |
| `session:export-json`                | 导出 JSON        |
| `session:export-markdown`            | 导出 Markdown    |
| `session:import-json`                | 导入 JSON        |
| `session:generate-summary`           | 生成摘要         |
| `session:resume`                     | 恢复会话         |
| `session:get-recent`                 | 获取最近会话     |
| `session:save-as-template`           | 保存为模板       |
| `session:create-from-template`       | 从模板创建       |
| `session:list-templates`             | 列出模板         |
| `session:delete-multiple`            | 批量删除         |
| `session:add-tags-multiple`          | 批量添加标签     |
| `session:get-global-stats`           | 获取全局统计     |
| `session:update-title`               | 更新会话标题     |
| `session:get-auto-summary-config`    | 获取自动摘要配置 |
| `session:update-auto-summary-config` | 更新自动摘要配置 |
| `session:start-background-summary`   | 启动后台摘要生成 |
| `session:stop-background-summary`    | 停止后台摘要生成 |
| `session:get-without-summary`        | 获取无摘要会话   |
| `session:trigger-bulk-summary`       | 触发批量摘要     |
| `session:get-auto-summary-stats`     | 获取自动摘要统计 |

## 压缩策略

SessionManager 使用 PromptCompressor 实现三种压缩策略：

1. **消息去重**: 移除重复或相似的消息
2. **历史截断**: 保留最近 N 条消息，截断旧消息
3. **智能总结**: 使用 LLM 生成长历史的摘要（需要 llmManager）

## 性能指标

- **压缩率**: 通常为 0.6-0.7（节省 30-40% tokens）
- **压缩延迟**: < 500ms（不使用 LLM 总结）
- **搜索延迟**: < 100ms（1000 条会话内）
- **存储开销**: < 1MB per session（100条消息）
- **自动摘要延迟**: 2-5s（取决于 LLM 响应速度）
- **后台生成间隔**: 默认 60 秒（可配置）

## 测试

```bash
cd desktop-app-vue
node scripts/test-session-manager.js
node scripts/test-auto-summary.js
```

## 实现文件

- **核心模块**: `desktop-app-vue/src/main/llm/session-manager.js`
- **IPC 处理器**: `desktop-app-vue/src/main/llm/session-manager-ipc.js`
- **数据库迁移**: `desktop-app-vue/src/main/database/migrations/005_llm_sessions.sql`
- **模板表迁移**: `desktop-app-vue/src/main/database/migrations/008_session_templates.sql`
- **测试脚本**: `desktop-app-vue/scripts/test-session-manager.js`

## 数据库表

- `llm_sessions`: 存储会话元数据和消息历史
- `llm_session_templates`: 存储会话模板
- `llm_usage_log`: 记录 LLM Token 使用
- `llm_budget_config`: 预算配置和限额
- `llm_cache`: 响应缓存
