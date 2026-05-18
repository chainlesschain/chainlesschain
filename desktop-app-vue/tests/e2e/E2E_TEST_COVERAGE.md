# E2E 测试覆盖情况清单

生成时间: 2026-01-25

## 测试覆盖统计

| 分类 | 总页面数 | 已测试 | 未测试 | 覆盖率 |
|-----|---------|--------|--------|--------|
| 工作台 | 6 | 5 | 1 | 83% |
| 知识管理 | 7 | 1 | 6 | 14% |
| AI工具 | 4 | 2 | 2 | 50% |
| 项目管理 | 10 | 4 | 6 | 40% |
| 社交网络 | 9 | 2 | 7 | 22% |
| 交易市场 | 7 | 0 | 7 | 0% |
| 开发工具 | 2 | 0 | 2 | 0% |
| 企业版 | 8 | 0 | 8 | 0% |
| 内容聚合 | 5 | 1 | 4 | 20% |
| 插件生态 | 4 | 0 | 4 | 0% |
| 多媒体处理 | 2 | 0 | 2 | 0% |
| 系统设置 | 8 | 1 | 7 | 13% |
| 系统监控 | 8 | 0 | 8 | 0% |
| **总计** | **80** | **16** | **64** | **20%** |

## 详细页面清单

### 1. 工作台 (Workspace)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| 知识首页 | / | ✅ 已测试 | project-*.e2e.test.ts |
| 我的项目 | /projects | ✅ 已测试 | project/project-creation.e2e.test.ts |
| 项目详情 | /projects/:id | ✅ 已测试 | project/detail/*.e2e.test.ts (10+文件) |
| 我的知识 | /knowledge/list | ✅ 已测试 | (隐式测试) |
| AI对话 | /ai/chat | ✅ 已测试 | ai/ai-chat.e2e.test.ts |
| 工作区管理 | /projects/workspace | ❌ 未测试 | - |

### 2. 知识管理 (Knowledge Management)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| 知识图谱 | /knowledge/graph | ❌ 未测试 | - |
| 知识详情 | /knowledge/:id | ✅ 已测试 | (隐式测试) |
| 文件导入 | /file-import | ❌ 未测试 | - |
| 图片上传 | /image-upload | ❌ 未测试 | - |
| 提示词模板 | /prompt-templates | ❌ 未测试 | - |
| 知识付费 | /knowledge-store | ❌ 未测试 | - |
| 我的购买 | /my-purchases | ❌ 未测试 | - |

### 3. AI工具 (AI Tools)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| AI助手 | /ai/prompts | ✅ 已测试 | ai/ai-assistant.e2e.test.ts |
| AI对话 | /ai/chat | ✅ 已测试 | ai/ai-chat.e2e.test.ts |
| 音频导入 | /audio/import | ❌ 未测试 | - |
| 多媒体处理 | /multimedia/demo | ❌ 未测试 | - |

### 4. 项目管理 (Project Management)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| 项目列表 | /projects | ✅ 已测试 | project/project-creation.e2e.test.ts |
| 新建项目 | /projects/new | ✅ 已测试 | project/project-creation.e2e.test.ts |
| 项目详情 | /projects/:id | ✅ 已测试 | project/detail/*.e2e.test.ts |
| 项目编辑 | /projects/:id/edit | ✅ 已测试 | project/detail/*.e2e.test.ts |
| 项目分类 | /projects/categories | ❌ 未测试 | - |
| 项目列表管理 | /projects/management | ❌ 未测试 | - |
| 模板管理 | /template-management | ❌ 未测试 | - |
| 项目市场 | /projects/market | ❌ 未测试 | - |
| 协作项目 | /projects/collaboration | ❌ 未测试 | - |
| 已归档项目 | /projects/archived | ❌ 未测试 | - |

### 5. 社交网络 (Social Network)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| DID身份 | /did | ✅ 部分测试 | integration/did-invitation.spec.js |
| 可验证凭证 | /credentials | ❌ 未测试 | - |
| 联系人 | /contacts | ❌ 未测试 | - |
| 好友管理 | /friends | ❌ 未测试 | - |
| 动态广场 | /posts | ❌ 未测试 | - |
| P2P加密消息 | /p2p-messaging | ✅ 部分测试 | integration/signal-protocol-e2e.test.js |
| 离线消息队列 | /offline-queue | ❌ 未测试 | - |
| 聊天窗口 | /chat | ❌ 未测试 | - |
| 通话记录 | /call-history | ❌ 未测试 | - |

### 6. 交易市场 (Trading Market)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| 交易中心 | /trading | ❌ 未测试 | - |
| 交易市场 | /marketplace | ❌ 未测试 | - |
| 智能合约 | /contracts | ❌ 未测试 | - |
| 信用评分 | /credit-score | ❌ 未测试 | - |
| 我的评价 | /my-reviews | ❌ 未测试 | - |
| 钱包管理 | /wallet | ❌ 未测试 | - |
| 跨链桥 | /bridge | ❌ 未测试 | - |

### 7. 开发与设计 (Dev Tools)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| Web IDE | /webide | ❌ 未测试 | - |
| 设计编辑器 | /design/:projectId | ❌ 未测试 | - |

### 8. 企业版 (Enterprise)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| 组织管理 | /organizations | ❌ 未测试 | - |
| 成员管理 | /org/:orgId/members | ❌ 未测试 | - |
| 角色管理 | /org/:orgId/roles | ❌ 未测试 | - |
| 组织设置 | /org/:orgId/settings | ❌ 未测试 | - |
| 活动日志 | /org/:orgId/activities | ❌ 未测试 | - |
| 组织知识库 | /org/:orgId/knowledge | ❌ 未测试 | - |
| 企业仪表板 | /enterprise/dashboard | ❌ 未测试 | - |
| 权限管理 | /permissions | ❌ 未测试 | - |

### 9. 内容聚合 (Content Aggregation)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| RSS订阅 | /rss/feeds | ✅ 部分测试 | integration/rss-email-integration.spec.js |
| 文章阅读 | /rss/article/:feedId | ❌ 未测试 | - |
| 邮件管理 | /email/accounts | ❌ 未测试 | - |
| 写邮件 | /email/compose | ❌ 未测试 | - |
| 阅读邮件 | /email/read/:id | ❌ 未测试 | - |

### 10. 插件生态 (Plugin Ecosystem)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| 插件管理 | /settings/plugins | ❌ 未测试 | - |
| 插件市场 | /plugins/marketplace | ❌ 未测试 | - |
| 插件发布 | /plugins/publisher | ❌ 未测试 | - |
| 插件页面 | /plugin/:pluginId | ❌ 未测试 | - |

### 11. 多媒体处理 (Multimedia)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| 音频导入 | /audio/import | ❌ 未测试 | - |
| 多媒体演示 | /multimedia/demo | ❌ 未测试 | - |

### 12. 系统设置 (System Settings)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| 通用设置 | /settings | ❌ 未测试 | - |
| 系统配置 | /settings/system | ❌ 未测试 | - |
| 插件管理 | /settings/plugins | ❌ 未测试 | - |
| 数据库安全 | /settings/database-security | ❌ 未测试 | - |
| 技能管理 | /settings/skills | ✅ 已测试 | features/skill-management.e2e.test.ts |
| 工具管理 | /settings/tools | ❌ 未测试 | - |
| 语音输入测试 | /settings/voice-input | ❌ 未测试 | - |
| 外部设备 | /external-devices | ❌ 未测试 | - |

### 13. 系统监控 (System Monitoring)

| 页面 | 路由 | 测试状态 | 测试文件 |
|-----|------|---------|----------|
| 数据库性能 | /database/performance | ❌ 未测试 | - |
| LLM性能 | /llm/performance | ❌ 未测试 | - |
| 会话管理 | /sessions | ❌ 未测试 | - |
| 标签管理 | /tags | ❌ 未测试 | - |
| Memory仪表板 | /memory | ❌ 未测试 | - |
| 错误监控 | /error/monitor | ❌ 未测试 | - |
| 性能监控 | /performance/dashboard | ❌ 未测试 | - |
| 同步冲突 | /sync/conflicts | ❌ 未测试 | - |

## 现有测试文件列表

### AI功能测试 (7个文件)
- ai/ai-assistant.e2e.test.ts
- ai/ai-chat.e2e.test.ts
- ai/code-execution.e2e.test.ts
- ai/intent-to-completion.e2e.test.ts
- ai/intent-to-completion-extended.e2e.test.ts
- ai/interactive-planning.e2e.test.ts
- ai/stream-control.e2e.test.ts

### 项目管理测试 (13个文件)
- project/project-creation.e2e.test.ts
- project/project-settings.e2e.test.ts
- project/project-task-planning.e2e.test.ts
- project/project-workflow.test.ts
- project/detail/project-detail-basic.e2e.test.ts
- project/detail/project-detail-comprehensive.e2e.test.ts
- project/detail/project-detail-core.e2e.test.ts
- project/detail/project-detail-ai-creating.e2e.test.ts
- project/detail/project-detail-conversation-sidebar.e2e.test.ts
- project/detail/project-detail-editors.e2e.test.ts
- project/detail/project-detail-export.e2e.test.ts
- project/detail/project-detail-file-manage.e2e.test.ts
- project/detail/project-detail-layout-git.e2e.test.ts

### 文件操作测试 (4个文件)
- file/file-operations.e2e.test.ts
- file/excel-editor.e2e.test.ts
- file/word-editor.e2e.test.ts
- file/word-preview.e2e.test.ts

### 集成测试 (4个文件)
- integration/did-invitation.spec.js
- integration/global-settings-wizard.spec.js
- integration/rss-email-integration.spec.js
- integration/signal-protocol-e2e.test.js

### 功能测试 (2个文件)
- features/skill-management.e2e.test.ts
- features/volcengine-text.e2e.test.ts

## 优先级建议

### P0 - 核心功能 (必须覆盖)
1. 知识图谱 (/knowledge/graph)
2. 文件导入 (/file-import)
3. 图片上传 (/image-upload)
4. 工作区管理 (/projects/workspace)
5. 项目分类 (/projects/categories)

### P1 - 重要功能 (高优先级)
1. 提示词模板 (/prompt-templates)
2. 模板管理 (/template-management)
3. 项目市场 (/projects/market)
4. 协作项目 (/projects/collaboration)
5. 已归档项目 (/projects/archived)
6. DID身份完整测试 (/did)
7. 联系人 (/contacts)
8. 好友管理 (/friends)

### P2 - 系统功能 (中优先级)
1. 系统设置 (/settings)
2. 系统配置 (/settings/system)
3. LLM性能 (/llm/performance)
4. 数据库性能 (/database/performance)
5. 会话管理 (/sessions)
6. 错误监控 (/error/monitor)

### P3 - 高级功能 (低优先级)
1. 交易市场所有页面
2. 企业版所有页面
3. Web IDE
4. 设计编辑器
5. 多媒体处理

## 测试执行计划

### 第一阶段 (本次执行) - 核心页面
- [ ] 知识图谱测试
- [ ] 文件导入测试
- [ ] 图片上传测试
- [ ] 工作区管理测试
- [ ] 项目分类测试
- [ ] 提示词模板测试
- [ ] 模板管理测试
- [ ] 项目市场测试
- [ ] 协作项目测试
- [ ] 已归档项目测试

### 第二阶段 - 社交功能
- [ ] DID身份完整测试
- [ ] 可验证凭证测试
- [ ] 联系人测试
- [ ] 好友管理测试
- [ ] 动态广场测试
- [ ] P2P消息完整测试
- [ ] 离线队列测试
- [ ] 聊天窗口测试
- [ ] 通话记录测试

### 第三阶段 - 系统功能
- [ ] 系统设置测试
- [ ] 系统配置测试
- [ ] 数据库安全测试
- [ ] 工具管理测试
- [ ] 数据库性能测试
- [ ] LLM性能测试
- [ ] 会话管理测试
- [ ] 标签管理测试
- [ ] Memory仪表板测试
- [ ] 错误监控测试
- [ ] 性能监控测试
- [ ] 同步冲突测试

### 第四阶段 - 高级功能
- [ ] 交易中心及所有交易相关页面
- [ ] 企业版所有页面
- [ ] Web IDE测试
- [ ] 设计编辑器测试
- [ ] 内容聚合完整测试
- [ ] 插件生态完整测试
- [ ] 多媒体处理测试

## 备注

- 所有测试应使用统一的测试辅助函数 (tests/e2e/helpers/common.ts)
- 测试应覆盖基本页面加载、核心交互、错误处理
- 每个测试文件应包含清晰的测试描述和断言
- 测试超时设置为120秒
- 使用E2E测试模式绕过认证检查 (window.__E2E_TEST_MODE__ 或 ?e2e=true)
