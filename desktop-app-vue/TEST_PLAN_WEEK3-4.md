# IPC 单元测试计划 - Week 3-4

## 📅 进度概览

| 周期 | 任务 | 状态 | 模块数 | Handlers数 |
|-----|------|------|--------|-----------|
| Week 1 | Project模块测试 | ✅ 完成 | 3 | 66 |
| Week 2 | 核心功能模块测试 | ✅ 完成 | 4 | 77 |
| **Week 3** | **核心基础+社交模块** | 🚧 进行中 | 8 | 174 |
| **Week 4** | **媒体+区块链+其他** | 📋 计划中 | 20+ | 250+ |

---

## Week 1-2 完成总结 ✅

### Week 1: 项目管理模块 (3个测试文件, 66 handlers)

✅ **已创建测试**:
- `tests/unit/project/project-core-ipc.test.js` - 项目核心 (34 handlers)
- `tests/unit/project/project-ai-ipc.test.js` - 项目AI (15 handlers)
- `tests/unit/project/project-export-ipc.test.js` - 项目导出 (17 handlers)

### Week 2: 核心功能模块 (4个测试文件, 77 handlers)

✅ **已创建测试**:
- `tests/unit/file/file-ipc.test.js` - 文件管理 (17 handlers)
- `tests/unit/organization/organization-ipc.test.js` - 组织管理 (32 handlers)
- `tests/unit/knowledge/knowledge-ipc.test.js` - 知识管理 (17 handlers)
- `tests/unit/prompt-template/prompt-template-ipc.test.js` - 提示词模板 (11 handlers)

**累计完成**: 7个测试文件, 143 handlers (22%完成率)

---

## Week 3: 核心基础 + 社交模块 (Day 1-5)

### 目标

创建核心基础设施和社交网络模块的单元测试框架，覆盖174个IPC handlers。

### Day 1-2: 核心基础模块 (5个测试文件, 67 handlers)

#### 1. LLM 服务测试
**文件**: `tests/unit/llm/llm-ipc.test.js`
- **源文件**: `src/main/llm/llm-ipc.js`
- **Handlers**: 14
- **功能域**:
  - LLM聊天 (3 handlers)
  - 配置管理 (3 handlers)
  - 提示词处理 (3 handlers)
  - 智能选择 (2 handlers)
  - 模型管理 (3 handlers)

#### 2. RAG 检索测试
**文件**: `tests/unit/rag/rag-ipc.test.js`
- **源文件**: `src/main/rag/rag-ipc.js`
- **Handlers**: 7
- **功能域**:
  - 向量检索 (3 handlers)
  - 文档管理 (2 handlers)
  - 嵌入生成 (2 handlers)

#### 3. U-Key 硬件管理测试
**文件**: `tests/unit/ukey/ukey-ipc.test.js`
- **源文件**: `src/main/ukey/ukey-ipc.js`
- **Handlers**: 9
- **功能域**:
  - 设备检测 (2 handlers)
  - PIN验证 (2 handlers)
  - 加密操作 (3 handlers)
  - 证书管理 (2 handlers)

#### 4. 数据库管理测试
**文件**: `tests/unit/database/database-ipc.test.js`
- **源文件**: `src/main/database/database-ipc.js`
- **Handlers**: 22
- **功能域**:
  - 初始化操作 (3 handlers)
  - 数据查询 (6 handlers)
  - 数据修改 (5 handlers)
  - 加密解密 (4 handlers)
  - 备份恢复 (4 handlers)

#### 5. Git 版本控制测试
**文件**: `tests/unit/git/git-ipc.test.js`
- **源文件**: `src/main/git/git-ipc.js`
- **Handlers**: 16
- **功能域**:
  - 基本操作 (5 handlers: init, add, commit, push, pull)
  - 分支管理 (3 handlers)
  - 冲突解决 (3 handlers)
  - 历史查询 (3 handlers)
  - 配置管理 (2 handlers)

**Day 1-2 小计**: 5个测试文件, 68 handlers

---

### Day 3-4: 社交网络模块 (3个测试文件, 75 handlers)

#### 6. DID 身份管理测试
**文件**: `tests/unit/did/did-ipc.test.js`
- **源文件**: `src/main/did/did-ipc.js`
- **Handlers**: 24
- **功能域**:
  - DID创建 (3 handlers)
  - DID解析 (4 handlers)
  - 凭证管理 (6 handlers)
  - 签名验证 (5 handlers)
  - 发布服务 (6 handlers)

#### 7. P2P 网络通信测试
**文件**: `tests/unit/p2p/p2p-ipc.test.js`
- **源文件**: `src/main/p2p/p2p-ipc.js`
- **Handlers**: 18
- **功能域**:
  - 节点管理 (4 handlers)
  - 消息发送 (5 handlers)
  - 连接管理 (4 handlers)
  - 加密通信 (3 handlers)
  - 状态查询 (2 handlers)

#### 8. 社交网络测试
**文件**: `tests/unit/social/social-ipc.test.js`
- **源文件**: `src/main/social/social-ipc.js`
- **Handlers**: 33
- **功能域**:
  - 联系人管理 (8 handlers)
  - 好友关系 (8 handlers)
  - 社交动态 (10 handlers)
  - 聊天消息 (7 handlers)

**Day 3-4 小计**: 3个测试文件, 75 handlers

---

### Day 5: 系统配置模块 (2个测试文件, 20 handlers)

#### 9. 配置管理测试
**文件**: `tests/unit/config/config-ipc.test.js`
- **源文件**: `src/main/config/config-ipc.js`
- **Handlers**: 4
- **功能域**:
  - 配置读取 (2 handlers)
  - 配置更新 (2 handlers)

#### 10. 系统窗口控制测试
**文件**: `tests/unit/system/system-ipc.test.js`
- **源文件**: `src/main/system/system-ipc.js`
- **Handlers**: 16
- **功能域**:
  - 窗口操作 (6 handlers: minimize, maximize, close等)
  - 应用控制 (4 handlers: quit, restart等)
  - 系统信息 (3 handlers)
  - 其他功能 (3 handlers)

**Day 5 小计**: 2个测试文件, 20 handlers

---

### Week 3 总计

- **测试文件**: 10个
- **Handlers**: 163 个
- **预计工作量**: 5天
- **完成后累计**: 17个测试文件, 306 handlers (47%完成率)

---

## Week 4: 媒体处理 + 区块链 + 其他模块 (Day 6-10)

### 目标

完成剩余模块的单元测试框架，覆盖250+个IPC handlers，达到80%+覆盖率。

### Day 6-7: 媒体处理模块 (5个测试文件, 87 handlers)

#### 11. 图像管理测试
**文件**: `tests/unit/image/image-ipc.test.js`
- **源文件**: `src/main/image/image-ipc.js`
- **Handlers**: 22
- **功能域**:
  - 图像上传 (4 handlers)
  - 图像处理 (6 handlers)
  - OCR识别 (4 handlers)
  - AI分析 (4 handlers)
  - 元数据管理 (4 handlers)

#### 12. 视频处理测试
**文件**: `tests/unit/video/video-ipc.test.js`
- **源文件**: `src/main/video/video-ipc.js`
- **Handlers**: 18
- **功能域**:
  - 视频导入 (4 handlers)
  - 视频处理 (5 handlers)
  - 字幕提取 (4 handlers)
  - 转码压缩 (3 handlers)
  - AI分析 (2 handlers)

#### 13. 语音处理测试
**文件**: `tests/unit/speech/speech-ipc.test.js`
- **源文件**: `src/main/speech/speech-ipc.js`
- **Handlers**: 34
- **功能域**:
  - 语音识别 (8 handlers)
  - 语音合成 (8 handlers)
  - 实时处理 (6 handlers)
  - 配置管理 (6 handlers)
  - 其他功能 (6 handlers)

#### 14. PDF 处理测试
**文件**: `tests/unit/pdf/pdf-ipc.test.js`
- **源文件**: `src/main/pdf/pdf-ipc.js`
- **Handlers**: 4
- **功能域**:
  - PDF解析 (2 handlers)
  - PDF生成 (2 handlers)

#### 15. 文档处理测试
**文件**: `tests/unit/document/document-ipc.test.js`
- **源文件**: `src/main/document/document-ipc.js`
- **Handlers**: 1
- **功能域**:
  - PPT大纲转换 (1 handler)

**Day 6-7 小计**: 5个测试文件, 79 handlers

---

### Day 8: 区块链模块 (7个测试文件, 75 handlers)

#### 16-22. 区块链完整测试套件
- `tests/unit/blockchain/wallet-ipc.test.js` - 钱包管理 (15 handlers)
- `tests/unit/blockchain/contract-ipc.test.js` - 智能合约 (15 handlers)
- `tests/unit/blockchain/blockchain-ipc.test.js` - 区块链核心 (14 handlers)
- `tests/unit/blockchain/asset-ipc.test.js` - 资产管理 (10 handlers)
- `tests/unit/blockchain/marketplace-ipc.test.js` - 市场交易 (9 handlers)
- `tests/unit/blockchain/bridge-ipc.test.js` - 跨链桥接 (7 handlers)
- `tests/unit/blockchain/escrow-ipc.test.js` - 托管服务 (5 handlers)

**Day 8 小计**: 7个测试文件, 75 handlers

---

### Day 9-10: 其他功能模块 (10+个测试文件, 100+ handlers)

#### 23-24. 代码工具模块
- `tests/unit/code-tools/code-ipc.test.js` - 代码工具 (10 handlers)
- `tests/unit/code-tools/review-ipc.test.js` - 代码审查 (10 handlers)

#### 25-27. 企业协作模块
- `tests/unit/collaboration/collaboration-ipc.test.js` - 协作功能 (8 handlers)
- `tests/unit/vc-template/vc-template-ipc.test.js` - VC模板 (11 handlers)
- `tests/unit/automation/automation-ipc.test.js` - 自动化 (9 handlers)

#### 28-29. 知识图谱与信用
- `tests/unit/knowledge-graph/graph-ipc.test.js` - 知识图谱 (11 handlers)
- `tests/unit/credit/credit-ipc.test.js` - 信用评分 (7 handlers)

#### 30-35. 其他功能
- `tests/unit/vc/vc-ipc.test.js` - 可验证凭证 (10 handlers)
- `tests/unit/identity-context/identity-context-ipc.test.js` - 身份上下文 (7 handlers)
- `tests/unit/template/template-ipc.test.js` - 模板管理 (20 handlers)
- `tests/unit/import/import-ipc.test.js` - 文件导入 (5 handlers)
- `tests/unit/sync/sync-ipc.test.js` - 数据同步 (4 handlers)
- `tests/unit/notification/notification-ipc.test.js` - 通知管理 (5 handlers)
- `tests/unit/category-ipc.test.js` - 分类管理 (7 handlers)

**Day 9-10 小计**: 13个测试文件, 105 handlers

---

### Week 4 总计

- **测试文件**: 25个
- **Handlers**: 259 个
- **预计工作量**: 5天
- **完成后累计**: 42个测试文件, 565 handlers (87%完成率)

---

## 📊 最终目标

### 覆盖率统计

| 项目 | Week 1-2 | Week 3 | Week 4 | 总计 |
|-----|---------|--------|--------|------|
| **测试文件数** | 7 | 10 | 25 | **42** |
| **Handlers数** | 143 | 163 | 259 | **565** |
| **覆盖率** | 22% | 47% | 87% | **87%** |
| **模块数** | 7 | 10 | 25 | **42** |

### 剩余未覆盖模块 (13%)

以下模块由于复杂性或依赖问题，暂不创建测试：
- `project/project-rag-ipc.js` - 项目RAG (10 handlers)
- `project/project-git-ipc.js` - 项目Git (14 handlers)
- `skill-tool-system/skill-tool-ipc.js` - 技能工具系统
- `webide/webide-ipc.js` - Web IDE
- `ai-engine/ai-engine-ipc.js` - AI引擎
- 其他高级/实验性功能模块

**剩余Handlers**: ~86个 (13%)

---

## ⚠️ 测试限制说明

### 当前测试模式

所有测试采用**基础注册验证模式**:
- ✅ 验证IPC handlers是否正确注册
- ✅ 验证handler是函数类型
- ✅ 验证所有预期channels存在
- ❌ 不测试handler具体执行逻辑

### 技术限制

**Vitest CommonJS Mock问题**:
- 源文件使用 `const { ipcMain } = require('electron')` (CommonJS)
- Vitest的 `vi.mock()` 无法正确拦截 `require()` 调用
- 导致无法mock electron模块的实际行为

### 解决方案（长期）

Week 3-4完成后，研究以下解决方案：

1. **迁移到ESM** (推荐)
   - 将主进程源文件改为 `import`/`export`
   - Vitest对ESM有更好的mock支持
   - 工作量：中等，风险：低

2. **切换到Jest**
   - Jest对CommonJS mock支持更好
   - 工作量：低，风险：低
   - 缺点：Jest性能较Vitest慢

3. **自定义Mock系统**
   - 编写自定义的模块加载器
   - 工作量：高，风险：中
   - 优点：完全控制mock行为

---

## 📋 实施步骤

### Week 3 执行计划

**Day 1 (今天)**:
1. ✅ 创建本测试计划文档
2. 🚧 创建LLM IPC测试
3. 🚧 创建RAG IPC测试
4. 🚧 创建U-Key IPC测试

**Day 2**:
1. 创建Database IPC测试
2. 创建Git IPC测试

**Day 3**:
1. 创建DID IPC测试
2. 创建P2P IPC测试

**Day 4**:
1. 创建Social IPC测试
2. 创建Config IPC测试

**Day 5**:
1. 创建System IPC测试
2. Week 3总结和提交
3. Code Review

### Week 4 执行计划

**Day 6-7**: 媒体处理模块 (5个测试文件)
**Day 8**: 区块链模块 (7个测试文件)
**Day 9-10**: 其他功能模块 (13个测试文件)

---

## 🎯 成功标准

### Week 3 验收

- ✅ 10个新测试文件创建完成
- ✅ 所有测试通过 `npm test`
- ✅ 覆盖163个IPC handlers
- ✅ 测试文件符合统一格式
- ✅ Git commit with详细文档

### Week 4 验收

- ✅ 25个新测试文件创建完成
- ✅ 所有测试通过 `npm test`
- ✅ 覆盖259个IPC handlers
- ✅ 总覆盖率达到87%
- ✅ 完整的测试报告

---

**创建时间**: 2026-01-03
**当前进度**: Week 3 Day 1
**预计完成**: Week 4 Day 10
**总工作量**: 10天（Week 3-4各5天）
