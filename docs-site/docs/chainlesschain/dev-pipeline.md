# 开发流水线编排

> **版本: v1.1.0+ | 流水线管理 | 6种部署策略 | 审批门控 | 烟雾测试 | 规范翻译 (15 IPC)**

开发流水线编排系统提供从需求到部署的全生命周期管理，支持多阶段流水线、审批门控和自动化部署。

## 系统概述

### 7 阶段流水线

```
需求解析 → 架构设计 → 代码生成 → 测试 → 代码审查 → 部署 → 监控
   │          │          │        │        │        │      │
   ▼          ▼          ▼        ▼        ▼        ▼      ▼
Requirement Architecture  Code   Testing  Code    Deploy  Post-
  Parsing     Design    Generation        Review         Deploy
                                                         Monitor
```

### 阶段状态

| 状态           | 说明         |
| -------------- | ------------ |
| `pending`      | 等待执行     |
| `running`      | 执行中       |
| `gate-waiting` | 等待审批门控 |
| `approved`     | 审批通过     |
| `rejected`     | 审批拒绝     |
| `completed`    | 完成         |
| `failed`       | 失败         |
| `skipped`      | 跳过         |

---

## 流水线模板

### 内置模板

| 模板             | 阶段                             | 适用场景   |
| ---------------- | -------------------------------- | ---------- |
| `feature`        | 全部 7 阶段                      | 新功能开发 |
| `bugfix`         | 解析 → 代码 → 测试 → 审查 → 部署 | 缺陷修复   |
| `refactor`       | 分析 → 代码 → 测试 → 审查        | 代码重构   |
| `security-audit` | 分析 → 审查 → 报告               | 安全审计   |

### Feature 流水线示例

```
1. [需求解析] NL 需求 → 结构化规范
2. [架构设计] 技术方案 → 组件设计
3. [代码生成] 架构 → 代码实现
4. [测试]    自动生成测试 → 验证循环
5. [代码审查] Debate Review 多视角审查
6. [部署]    DeployAgent 自动部署
7. [监控]    PostDeployMonitor 观测
```

---

## 审批门控

### 门控类型

| 类型        | 说明                 |
| ----------- | -------------------- |
| `auto`      | 上一阶段成功自动通过 |
| `manual`    | 需要人工审批         |
| `condition` | 满足条件自动通过     |

### 门控配置

```json
{
  "gates": {
    "after-testing": {
      "type": "condition",
      "condition": "testPassRate >= 0.95"
    },
    "before-deploy": {
      "type": "manual",
      "approvers": ["lead-did"]
    }
  }
}
```

---

## 规范翻译器

### NL → Spec 翻译

将自然语言需求翻译为结构化的技术规范：

```
用户输入: "添加一个用户资料编辑页面，支持修改头像和昵称"

翻译输出:
{
  "intent": "create-component",
  "component": "UserProfileEditor",
  "features": [
    { "name": "avatar-upload", "type": "file-input" },
    { "name": "nickname-edit", "type": "text-input" }
  ],
  "framework": "vue3",
  "route": "/profile/edit"
}
```

### 支持的意图类型

| 意图               | 说明       |
| ------------------ | ---------- |
| `create-component` | 创建新组件 |
| `add-feature`      | 添加功能   |
| `fix-bug`          | 修复缺陷   |
| `refactor`         | 重构代码   |
| `add-api`          | 添加 API   |
| `add-test`         | 添加测试   |
| `update-style`     | 更新样式   |
| `configure`        | 配置修改   |
| `general`          | 通用需求   |

### 多轮消歧

当需求不够明确时，自动提出澄清问题：

```
用户: "优化搜索"
Agent: "请明确以下信息：
  1. 是指知识库搜索还是社交搜索？
  2. 优化方向：速度、准确度还是交互体验？
  3. 是否需要修改现有 API？"
```

---

## 部署 Agent

### 部署策略

| 策略          | 说明                         |
| ------------- | ---------------------------- |
| `git-pr`      | 创建 Git 分支和 Pull Request |
| `docker`      | Docker 镜像构建和推送        |
| `npm-publish` | NPM 包发布                   |
| `local`       | 本地部署                     |
| `staging`     | 预发布环境                   |

### 部署配置

```json
{
  "deployAgent": {
    "strategy": "git-pr",
    "deployTimeoutMs": 120000,
    "smokeTestTimeoutMs": 30000,
    "autoCreateBranch": true,
    "branchPrefix": "pipeline/",
    "dryRun": false
  }
}
```

### 烟雾测试

部署后自动执行烟雾测试验证基本功能：

```
部署完成 → 执行烟雾测试 (30s 超时)
              │
              ├─ 通过 → 部署成功
              └─ 失败 → 自动回滚
```

---

## 需求解析器

### 解析能力

- **需求分类**: feature / bugfix / refactor / optimization / security / documentation
- **用户故��提取**: "作为...我希望...以便..."格式
- **验收标准生成**: 自动生成可测试的验收条件
- **边界条件识别**: 分析潜在的边界情况
- **依赖检测**: 通过代码知识图谱检测模块依赖
- **技术栈推断**: 自动识别涉及的技术（vue, api, database 等）

---

## 项目风格分析器

### 分析维度

| 维度     | 分析内容                            |
| -------- | ----------------------------------- |
| 命名约定 | camelCase / snake_case / PascalCase |
| 架构模式 | 目录结构、模块组织                  |
| 测试模式 | 测试框架、覆盖率标准                |
| 代码风格 | 缩进、引号、分号                    |
| 导入规范 | 导入顺序、别名使用                  |
| 组件规范 | 组件结构、Props 定义                |

### 缓存策略

- 分析结果缓存 10 分钟
- 目录树扫描最大深度 5 层，最多 500 文件
- 结合代码知识图谱和 Instinct 学习系统

---

## 关键文件

| 文件                                                  | 职责                   |
| ----------------------------------------------------- | ---------------------- |
| `src/main/ai-engine/cowork/pipeline-orchestrator.js`  | 流水线编排器（7 阶段） |
| `src/main/ai-engine/cowork/deploy-agent.js`           | 部署 Agent（5 种策略） |
| `src/main/ai-engine/cowork/spec-translator.js`        | NL → Spec 规范翻译     |
| `src/main/ai-engine/cowork/requirement-parser.js`     | 需求解析器             |
| `src/main/ai-engine/cowork/project-style-analyzer.js` | 项目风格分析           |
| `src/main/ai-engine/cowork/post-deploy-monitor.js`    | 部署后监控             |
| `src/main/ai-engine/cowork/evolution-ipc.js`          | IPC 处理器             |
